import { Injectable, Logger } from '@nestjs/common';
import { TradeEntity } from '../models/entities/Trade.entity';
import { roundTo } from '../lib/math';

export interface ExitSignalRecommendation {
  signalType: string;
  parameterName: string;
  recommendedValue: any;
  reasoning: string;
  confidence: number;
}

export interface RrOptimizationPoint {
  threshold: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  wins: number;
  scratches: number;
  losses: number;
}

export interface RrOptimizationResult {
  recommendedRr: number; // Legacy, same as balanced
  conservativeRr: number;
  balancedRr: number;
  aggressiveRr: number;
  recommendedTrailingDistance: number;
  maxProfitFactor: number;
  maxExpectancy: number;
  curve: RrOptimizationPoint[];
  sampleSize: number;
  status: 'OPTIMAL' | 'PRELIMINARY' | 'INSUFFICIENT_DATA' | 'STALE';
  recommendedExitSignals?: ExitSignalRecommendation[];
}

@Injectable()
export class RrOptimizationService {
  private readonly logger = new Logger(RrOptimizationService.name);

  /**
   * Performs an MFE (Maximum Favorable Excursion) sweep to find optimal RR targets.
   * BOLT OPTIMIZATION: O(N log N) sort + O(N) sweep using cumulative counters.
   * Minimal allocation path.
   */
  calculateRrOptimization(trades: TradeEntity[]): RrOptimizationResult {
    const closedTrades = trades.filter(t =>
      t.status !== 'OPEN' &&
      t.exit_ts &&
      !t.is_reconciliation &&
      t.max_rr_achieved !== undefined &&
      t.max_rr_achieved !== null
    );

    if (closedTrades.length < 5) {
      return {
        recommendedRr: 0,
        conservativeRr: 0,
        balancedRr: 0,
        aggressiveRr: 0,
        recommendedTrailingDistance: 0,
        maxProfitFactor: 0,
        maxExpectancy: 0,
        curve: [],
        sampleSize: closedTrades.length,
        status: 'INSUFFICIENT_DATA',
        recommendedExitSignals: [],
      };
    }

    // Performance Engineering: Pre-calculate outcomes and epsilons for all trades
    let sumMaePct = 0;
    const tradeData = closedTrades.map(t => {
      const risk = Number(t.initial_risk_usdt || t.risk_usdt || 0);
      const pnl = Number(t.pnl || 0);
      const epsilon = Math.max(risk * 0.05, 0.5);

      // Calculate Maximum Adverse Excursion (MAE) pct relative to entry
      // MAE pct is effectively how far the trade went against us.
      // We first calculate the full risk distance percentage at entry.
      const riskDistPct = Math.abs((t.entry_price - (t.initial_sl || t.current_sl || t.entry_price)) / t.entry_price) * 100;
      // If t.min_rr_achieved is tracked and negative, we have an exact, high-fidelity adverse excursion!
      // Otherwise, we gracefully fall back to the legacy loss estimation / safe win baseline.
      const maePct = (t.min_rr_achieved !== undefined && t.min_rr_achieved !== null && t.min_rr_achieved < 0)
        ? Math.abs(Number(t.min_rr_achieved)) * riskDistPct
        : ((pnl < 0) ? riskDistPct : 0.5);
      sumMaePct += maePct;

      return {
        max_rr: Number(t.max_rr_achieved || 0),
        risk,
        pnl,
        epsilon,
        isWin: pnl > epsilon,
        isLoss: pnl < -epsilon,
        isScratch: Math.abs(pnl) <= epsilon
      };
    });

    const n = tradeData.length;
    // Strategy: Recommend trailing distance at 2x Average Adverse Excursion to survive normal noise
    const avgMaePct = sumMaePct / n;
    const recommendedTrailingDistance = roundTo(Math.max(0.5, avgMaePct * 2), 2);

    // Sort descending by MFE
    tradeData.sort((a, b) => b.max_rr - a.max_rr);
    const curve: RrOptimizationPoint[] = [];

    // State for sweep
    let countWinsOverT = 0;
    let sumRiskWinsOverT = 0;
    let countScratchesOverT = 0;

    let sumPnlWinsUnderT = 0;
    let sumLossUnderT = 0;
    let countWinsUnderT = 0;
    let countLossesUnderT = 0;
    let countScratchesUnderT = 0;

    // Initialize "Under T" with all trades
    for (const d of tradeData) {
      if (d.isWin) {
        sumPnlWinsUnderT += d.pnl;
        countWinsUnderT++;
      } else if (d.isLoss) {
        sumLossUnderT += Math.abs(d.pnl);
        countLossesUnderT++;
      } else {
        countScratchesUnderT++;
      }
    }

    // Determine range: 0.1 to P95 of max_rr_achieved
    const p95Mfe = tradeData[Math.floor(n * 0.05)].max_rr;
    const sweepLimit = Math.max(0.1, Math.min(p95Mfe + 0.1, 10));

    let ptr = 0;
    const steps: number[] = [];
    for (let t = sweepLimit; t >= 0.1; t = roundTo(t - 0.1, 1)) {
      steps.push(t);
    }

    for (const t of steps) {
      // Move trades that now satisfy max_rr >= T
      while (ptr < n && tradeData[ptr].max_rr >= t) {
        const d = tradeData[ptr];

        // Remove from Under T
        if (d.isWin) {
          sumPnlWinsUnderT -= d.pnl;
          countWinsUnderT--;
        } else if (d.isLoss) {
          sumLossUnderT -= Math.abs(d.pnl);
          countLossesUnderT--;
        } else {
          countScratchesUnderT--;
        }

        // Add to Over T (Simulated harvest at T)
        const simulatedPnl = t * d.risk;
        if (simulatedPnl > d.epsilon) {
          countWinsOverT++;
          sumRiskWinsOverT += d.risk;
        } else {
          // Even if it reached T, the gain is within epsilon
          countScratchesOverT++;
        }

        ptr++;
      }

      const simulatedWins = countWinsOverT + countWinsUnderT;
      const simulatedLosses = countLossesUnderT;
      const simulatedScratches = countScratchesOverT + countScratchesUnderT;

      const grossProfit = (t * sumRiskWinsOverT) + sumPnlWinsUnderT;
      const grossLoss = sumLossUnderT;
      const totalRelevant = simulatedWins + simulatedLosses + simulatedScratches;

      const winRate = totalRelevant > 0 ? (simulatedWins / totalRelevant) * 100 : 0;
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 100 : 0);
      const expectancy = totalRelevant > 0 ? (grossProfit - grossLoss) / totalRelevant : 0;

      curve.push({
        threshold: t,
        winRate: roundTo(winRate, 2),
        profitFactor: roundTo(profitFactor, 2),
        expectancy: roundTo(expectancy, 2),
        wins: simulatedWins,
        scratches: simulatedScratches,
        losses: simulatedLosses
      });
    }

    let balancedRr = 0;
    let aggressiveRr = 0;
    let conservativeRr = 0;
    let maxPF = 0;
    let maxExp = -Infinity;

    // 1. Find Balanced (Max PF) and Aggressive (Max Expectancy)
    for (const point of curve) {
      if (point.profitFactor > maxPF) {
        maxPF = point.profitFactor;
        balancedRr = point.threshold;
      }
      if (point.expectancy > maxExp) {
        maxExp = point.expectancy;
        aggressiveRr = point.threshold;
      }
    }

    // 2. Find Conservative (High Win Rate + Positive PF)
    // Heuristic: Highest RR where Win Rate >= 60% and PF > 1.1
    for (let i = curve.length - 1; i >= 0; i--) {
      const p = curve[i];
      if (p.winRate >= 60 && p.profitFactor > 1.1) {
        conservativeRr = p.threshold;
        break;
      }
    }
    // Fallback if no 60% WR point: use the first point with PF > 1.1
    if (conservativeRr === 0) {
      const firstProfitable = curve.find(p => p.profitFactor > 1.1);
      conservativeRr = firstProfitable ? firstProfitable.threshold : curve[0].threshold;
    }

    // --- PREDICTIVE MODELLING FOR OPTIMAL EXIT SIGNAL PARAMETERS ---
    let sumDurationMs = 0;
    let countWithDuration = 0;
    let defaultInterval = '1m';

    for (const t of closedTrades) {
      if (t.entry_ts && t.exit_ts) {
        const dur = t.exit_ts.getTime() - t.entry_ts.getTime();
        if (dur > 0) {
          sumDurationMs += dur;
          countWithDuration++;
        }
      }
      if (t.strategy_config?.scan_interval) {
        defaultInterval = t.strategy_config.scan_interval;
      }
    }

    const avgDurationMs = countWithDuration > 0 ? sumDurationMs / countWithDuration : 15 * 60000;
    const intervalToMs = (interval: string): number => {
      const match = String(interval || '1m').match(/^(\d+)([mhdM])$/);
      if (!match) return 60000;
      const val = parseInt(match[1], 10);
      const unit = match[2];
      if (unit === 'm') return val * 60000;
      if (unit === 'h') return val * 3600000;
      if (unit === 'd') return val * 86400000;
      return 60000;
    };
    const intervalMs = intervalToMs(defaultInterval);
    const avgDurationCandles = Math.max(3, Math.round(avgDurationMs / intervalMs));

    const recommendedExitSignals: ExitSignalRecommendation[] = [
      {
        signalType: 'ema_close',
        parameterName: 'exit_ema_period',
        recommendedValue: Math.max(5, Math.min(40, Math.round(avgDurationCandles / 3))),
        reasoning: `Optimizes exit timing by setting the EMA period to roughly 1/3 of the average trade duration (${avgDurationCandles} candles) to prevent whipsaws while locking in gains.`,
        confidence: Math.min(95, Math.max(50, 40 + n)),
      },
      {
        signalType: 'ema_dual_close',
        parameterName: 'exit_ema_fast / exit_ema_slow',
        recommendedValue: `${Math.max(5, Math.min(30, Math.round(avgDurationCandles / 4)))} / ${Math.max(10, Math.min(80, Math.round(avgDurationCandles / 2)))}`,
        reasoning: `Aligns the fast/slow EMA cross to the dominant trend cycles of ${avgDurationCandles} candles, establishing a robust trend-following stop.`,
        confidence: Math.min(95, Math.max(50, 45 + n)),
      },
      {
        signalType: 'supertrend',
        parameterName: 'supertrend_period / supertrend_multiplier',
        recommendedValue: `${Math.max(7, Math.min(20, Math.round(avgDurationCandles / 2)))} / ${Math.max(1.5, Math.min(4.0, Number((2.0 + (avgMaePct * 0.5)).toFixed(1))))}`,
        reasoning: `Dynamically adjusts the ATR multiplier based on historical adverse excursion (avg MAE: ${avgMaePct.toFixed(2)}%), giving breathing room under normal volatility while preventing severe drawdowns.`,
        confidence: Math.min(95, Math.max(50, 50 + n)),
      },
      {
        signalType: 'macd_fade',
        parameterName: 'macd_fast / macd_slow / macd_signal',
        recommendedValue: `${Math.max(6, Math.min(24, Math.round(avgDurationCandles / 4)))} / ${Math.max(12, Math.min(50, Math.round(avgDurationCandles / 2)))} / ${Math.max(4, Math.min(18, Math.round(avgDurationCandles / 6)))}`,
        reasoning: `Synchronizes MACD momentum decay detection to contract exactly when trade duration of ${avgDurationCandles} candles matures.`,
        confidence: Math.min(95, Math.max(50, 40 + n)),
      }
    ];

    return {
      recommendedRr: balancedRr,
      conservativeRr,
      balancedRr,
      aggressiveRr,
      recommendedTrailingDistance,
      maxProfitFactor: roundTo(maxPF, 2),
      maxExpectancy: roundTo(maxExp, 2),
      curve: curve.reverse(),
      sampleSize: n,
      status: n >= 20 ? 'OPTIMAL' : 'PRELIMINARY',
      recommendedExitSignals,
    };
  }
}
