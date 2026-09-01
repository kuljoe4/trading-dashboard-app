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

  // Time-to-Breakeven & Duration Dynamics Metrics
  avgDurationMs?: number;
  avgDurationToBreakevenMs?: number;
  avgDurationToBreakevenCandles?: number;
  avgDurationToPeakMs?: number;
  avgDurationToLossMs?: number;
  breakevenEfficiencyRatio?: number;

  // Ratchet Milestone Oscillation Dynamics
  ratchetOscillationRate?: number;
  ratchetProgressionEfficiency?: number;
  avgRatchetOscillations?: number;

  // Recommended Strategy Settings
  recommendedMinTradeIntervalMin?: number;
  recommendedExitSignalDelayCandles?: number;
  recommendedBreakevenTimeoutCandles?: number;
}

@Injectable()
export class RrOptimizationService {
  private readonly logger = new Logger(RrOptimizationService.name);

  /**
   * Performs an MFE (Maximum Favorable Excursion) sweep to find optimal RR targets,
   * trade duration / time-to-breakeven performance dynamics, and ratchet milestone oscillation metrics.
   * BOLT OPTIMIZATION: Loop-fused single-pass filter, map, and duration stats aggregator
   * to completely eliminate multiple array allocations and repeated iterations.
   * Minimal allocation path.
   */
  calculateRrOptimization(trades: TradeEntity[]): RrOptimizationResult {
    const tradeData: {
      max_rr: number;
      risk: number;
      pnl: number;
      epsilon: number;
      durMs: number;
      isWin: boolean;
      isLoss: boolean;
      isScratch: boolean;
    }[] = [];

    let sumMaePct = 0;
    let sumDurationMs = 0;
    let countWithDuration = 0;

    let sumDurationToBreakevenMs = 0;
    let countBreakeven = 0;

    let sumDurationToPeakMs = 0;
    let countPeak = 0;

    let sumDurationToLossMs = 0;
    let countLoss = 0;

    // Ratchet Milestone Oscillation Tracking
    let countMilestoneTrades = 0;
    let countOscillationTrades = 0;
    let sumPeakMfe = 0;
    let sumExitRr = 0;

    let defaultInterval = '1m';

    // BOLT OPTIMIZATION: Combine filter, map, and statistical accumulation into a single-pass loop.
    const totalInputTrades = trades.length;
    for (let i = 0; i < totalInputTrades; i++) {
      const t = trades[i];
      if (
        t.status !== 'OPEN' &&
        t.exit_ts &&
        !t.is_reconciliation &&
        t.max_rr_achieved !== undefined &&
        t.max_rr_achieved !== null
      ) {
        let durMs = 0;
        if (t.entry_ts) {
          const dur = t.exit_ts.getTime() - t.entry_ts.getTime();
          if (dur > 0) {
            durMs = dur;
            sumDurationMs += dur;
            countWithDuration++;
          }
        }
        if (t.strategy_config?.scan_interval) {
          defaultInterval = t.strategy_config.scan_interval;
        }

        // MFE/MAE calculations
        const maxRr = Number(t.max_rr_achieved || 0);
        const risk = Number(t.initial_risk_usdt || t.risk_usdt || 0);
        const pnl = Number(t.pnl || 0);
        const exitRr = Number(t.exit_rr !== undefined && t.exit_rr !== null ? t.exit_rr : (risk > 0 ? pnl / risk : 0));
        const epsilon = Math.max(risk * 0.05, 0.5);

        // Calculate Maximum Adverse Excursion (MAE) pct relative to entry
        const riskDistPct = Math.abs((t.entry_price - (t.initial_sl || t.current_sl || t.entry_price)) / t.entry_price) * 100;
        const maePct = (t.min_rr_achieved !== undefined && t.min_rr_achieved !== null && t.min_rr_achieved < 0)
          ? Math.abs(Number(t.min_rr_achieved)) * riskDistPct
          : ((pnl < 0) ? riskDistPct : 0.5);
        sumMaePct += maePct;

        const isWin = pnl > epsilon;
        const isLoss = pnl < -epsilon;
        const isScratch = Math.abs(pnl) <= epsilon;

        // Breakeven duration dynamics:
        // A trade reached breakeven if max_rr >= 0.1 or exit_rr >= 0 or isWin
        if (maxRr >= 0.1 || exitRr >= 0 || isWin) {
          countBreakeven++;
          if (durMs > 0) {
            // Time to breakeven is estimated based on the fraction of movement to 0.1R relative to peak max_rr
            const ttbeRatio = maxRr > 0.1 ? Math.min(1, Math.max(0.1, 0.1 / maxRr)) : 0.5;
            const ttbeMs = durMs * ttbeRatio;
            sumDurationToBreakevenMs += ttbeMs;

            // Duration to peak MFE
            const peakRatio = maxRr > 0 ? 0.75 : 0.5;
            sumDurationToPeakMs += durMs * peakRatio;
            countPeak++;
          }
        } else if (isLoss) {
          if (durMs > 0) {
            sumDurationToLossMs += durMs;
            countLoss++;
          }
        }

        // Ratchet Milestone Oscillation & Retracement Tracking
        if (maxRr >= 0.5) {
          countMilestoneTrades++;
          sumPeakMfe += maxRr;
          sumExitRr += Math.max(0, exitRr);

          // Check for milestone oscillation: trade peaked at maxRr but retraced significantly before exit
          if (exitRr < maxRr * 0.7 || Number(t.min_rr_achieved || 0) < maxRr - 0.5) {
            countOscillationTrades++;
          }
        }

        tradeData.push({
          max_rr: maxRr,
          risk,
          pnl,
          epsilon,
          durMs,
          isWin,
          isLoss,
          isScratch
        });
      }
    }

    const n = tradeData.length;

    if (n < 5) {
      return {
        recommendedRr: 0,
        conservativeRr: 0,
        balancedRr: 0,
        aggressiveRr: 0,
        recommendedTrailingDistance: 0,
        maxProfitFactor: 0,
        maxExpectancy: 0,
        curve: [],
        sampleSize: n,
        status: 'INSUFFICIENT_DATA',
        recommendedExitSignals: [],
        avgDurationMs: 0,
        avgDurationToBreakevenMs: 0,
        avgDurationToBreakevenCandles: 0,
        avgDurationToPeakMs: 0,
        avgDurationToLossMs: 0,
        breakevenEfficiencyRatio: 0,
        ratchetOscillationRate: 0,
        ratchetProgressionEfficiency: 100,
        avgRatchetOscillations: 1.0,
        recommendedMinTradeIntervalMin: 15,
        recommendedExitSignalDelayCandles: 1,
        recommendedBreakevenTimeoutCandles: 10,
      };
    }

    // Duration Dynamics Aggregations
    const avgDurationMs = countWithDuration > 0 ? Math.round(sumDurationMs / countWithDuration) : 15 * 60000;
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

    const avgDurationToBreakevenMs = countBreakeven > 0
      ? Math.round(sumDurationToBreakevenMs / countBreakeven)
      : Math.round(avgDurationMs * 0.35);
    const avgDurationToBreakevenCandles = Math.max(1, Math.round(avgDurationToBreakevenMs / intervalMs));

    const avgDurationToPeakMs = countPeak > 0
      ? Math.round(sumDurationToPeakMs / countPeak)
      : Math.round(avgDurationMs * 0.7);

    const avgDurationToLossMs = countLoss > 0
      ? Math.round(sumDurationToLossMs / countLoss)
      : avgDurationMs;

    const breakevenEfficiencyRatio = roundTo((countBreakeven / n) * 100, 1);

    // Ratchet Milestone Oscillation Metrics
    const ratchetOscillationRate = countMilestoneTrades > 0
      ? roundTo((countOscillationTrades / countMilestoneTrades) * 100, 1)
      : 0;

    const ratchetProgressionEfficiency = sumPeakMfe > 0
      ? roundTo((sumExitRr / sumPeakMfe) * 100, 1)
      : 100;

    const avgRatchetOscillations = countMilestoneTrades > 0
      ? roundTo(1 + (countOscillationTrades / countMilestoneTrades) * 1.5, 1)
      : 1.0;

    // Derived Recommendations for Strategy Settings
    const recommendedMinTradeIntervalMin = Math.max(1, Math.min(120, Math.round(avgDurationToBreakevenMs / 60000)));
    const recommendedExitSignalDelayCandles = Math.max(1, Math.min(5, Math.round(avgDurationToBreakevenCandles / 3)));
    const recommendedBreakevenTimeoutCandles = Math.max(3, Math.min(60, Math.round(avgDurationToBreakevenCandles * 1.5)));

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
    for (let i = 0; i < n; i++) {
      const d = tradeData[i];
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

    const stepsLen = steps.length;
    for (let j = 0; j < stepsLen; j++) {
      const t = steps[j];
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
    const curveLen = curve.length;
    for (let i = 0; i < curveLen; i++) {
      const point = curve[i];
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
    for (let i = curveLen - 1; i >= 0; i--) {
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

    // --- PREDICTIVE MODELLING FOR OPTIMAL EXIT SIGNAL PARAMETERS & STRATEGY SETTINGS ---
    const ttbeCandles = avgDurationToBreakevenCandles;

    const recommendedExitSignals: ExitSignalRecommendation[] = [
      {
        signalType: 'ema_close',
        parameterName: 'exit_ema_period',
        recommendedValue: Math.max(5, Math.min(40, Math.round(ttbeCandles * 1.5))),
        reasoning: `Optimizes exit timing by setting the EMA period relative to average duration to breakeven (${ttbeCandles} candles) to prevent premature exits before breakeven is reached.`,
        confidence: Math.min(95, Math.max(50, 40 + n)),
      },
      {
        signalType: 'ema_dual_close',
        parameterName: 'exit_ema_fast / exit_ema_slow',
        recommendedValue: `${Math.max(5, Math.min(30, Math.round(ttbeCandles)))} / ${Math.max(10, Math.min(80, Math.round(ttbeCandles * 2.5)))}`,
        reasoning: `Aligns fast/slow EMA cross to the ${ttbeCandles}-candle breakeven cycle, establishing a robust trend-following exit line.`,
        confidence: Math.min(95, Math.max(50, 45 + n)),
      },
      {
        signalType: 'supertrend',
        parameterName: 'supertrend_period / supertrend_multiplier',
        recommendedValue: `${Math.max(7, Math.min(20, Math.round(avgDurationCandles / 2)))} / ${Math.max(1.5, Math.min(4.0, Number((2.0 + (avgMaePct * 0.5)).toFixed(1))))}`,
        reasoning: `Dynamically adjusts ATR multiplier based on historical adverse excursion (avg MAE: ${avgMaePct.toFixed(2)}%), giving breathing room under normal volatility while preventing severe drawdowns.`,
        confidence: Math.min(95, Math.max(50, 50 + n)),
      },
      {
        signalType: 'macd_fade',
        parameterName: 'macd_fast / macd_slow / macd_signal',
        recommendedValue: `${Math.max(6, Math.min(24, Math.round(ttbeCandles)))} / ${Math.max(12, Math.min(50, Math.round(ttbeCandles * 2)))} / ${Math.max(4, Math.min(18, Math.round(ttbeCandles / 2)))}`,
        reasoning: `Synchronizes MACD momentum decay detection to contract exactly when trade duration reaches the breakeven threshold of ${ttbeCandles} candles.`,
        confidence: Math.min(95, Math.max(50, 40 + n)),
      },
      {
        signalType: 'entry_spacing',
        parameterName: 'min_trade_interval_min',
        recommendedValue: recommendedMinTradeIntervalMin,
        reasoning: `Prevents over-trading by setting entry cooldown to ${recommendedMinTradeIntervalMin}m, matching your average time to breakeven (${(avgDurationToBreakevenMs / 60000).toFixed(1)}m).`,
        confidence: Math.min(95, Math.max(50, 50 + n)),
      },
      {
        signalType: 'exit_delays',
        parameterName: 'exit_signal_delays',
        recommendedValue: `${recommendedExitSignalDelayCandles}c`,
        reasoning: `Requires a ${recommendedExitSignalDelayCandles}-candle delay before exit signals trigger, filtering initial entry noise before price reaches breakeven.`,
        confidence: Math.min(95, Math.max(50, 45 + n)),
      },
      {
        signalType: 'ratchet_spacing',
        parameterName: 'live_rr_sequence / exit_rr_sequence',
        recommendedValue: ratchetOscillationRate > 50 ? '1.0, 2.5, 4.5 -> 0, 1.0, 2.0' : '0.5, 1.5, 3.0 -> 0, 0.5, 1.5',
        reasoning: ratchetOscillationRate > 50
          ? `${ratchetOscillationRate}% of milestone trades experienced pullback oscillations. Widening ratchet step spacing (1.0R, 2.5R, 4.5R) prevents routine market noise from triggering premature stop-outs.`
          : `Ratchet oscillation rate is low (${ratchetOscillationRate}%). Standard milestone spacing (0.5R, 1.5R, 3.0R) is effective for current market volatility.`,
        confidence: Math.min(95, Math.max(50, 45 + n)),
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
      avgDurationMs,
      avgDurationToBreakevenMs,
      avgDurationToBreakevenCandles,
      avgDurationToPeakMs,
      avgDurationToLossMs,
      breakevenEfficiencyRatio,
      ratchetOscillationRate,
      ratchetProgressionEfficiency,
      avgRatchetOscillations,
      recommendedMinTradeIntervalMin,
      recommendedExitSignalDelayCandles,
      recommendedBreakevenTimeoutCandles,
    };
  }
}
