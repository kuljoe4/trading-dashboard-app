import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { v4 as uuid } from 'uuid';
import { roundEight } from '../lib/math';

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);
  
  /**
   * Check if a new trade can be entered based on risk limits
   */
  canEnter(
    activeTrades: Trade[],
    closedTrades: Trade[],
    balance: number,
    symbol: string,
    config: SessionConfig,
    totalSlUsed: number
  ): { canEnter: boolean; reason: string } {
    // Check global max open trades
    const maxOpenTrades = config.max_open_trades ?? 5;
    const maxOpenTradesPerSymbol = config.max_open_trades_per_symbol ?? 1;
    const maxTotalRiskPct = config.max_total_risk_pct ?? 5.0;
    const totalSlGuardUsdt = config.total_sl_guard_usdt ?? 200.0;

    if (activeTrades.length >= maxOpenTrades) {
      return {
        canEnter: false,
        reason: `Global max open trades (${maxOpenTrades}) reached`
      };
    }

    // Check max trades per period (sliding window)
    const maxTradesPeriod = config.max_trades_per_period ?? 0;
    const periodMin = config.trades_period_min ?? 60;

    if (maxTradesPeriod > 0) {
      const now = Date.now();
      const periodStartMs = now - periodMin * 60 * 1000;
      let tradesInPeriod = 0;

      // BOLT OPTIMIZATION: Manual loops to avoid array spread and multiple filters
      for (const t of activeTrades) {
        if (t.entry_ts && new Date(t.entry_ts).getTime() >= periodStartMs) {
          tradesInPeriod++;
        }
      }

      // If we already reached the limit, exit early
      if (tradesInPeriod >= maxTradesPeriod) {
        return {
          canEnter: false,
          reason: `Max trades per period (${maxTradesPeriod} per ${periodMin}m) reached`
        };
      }

      for (const t of closedTrades) {
        if (t.entry_ts && new Date(t.entry_ts).getTime() >= periodStartMs) {
          tradesInPeriod++;
          if (tradesInPeriod >= maxTradesPeriod) break;
        }
      }

      if (tradesInPeriod >= maxTradesPeriod) {
        return {
          canEnter: false,
          reason: `Max trades per period (${maxTradesPeriod} per ${periodMin}m) reached`
        };
      }
    }

    // Check per-symbol max open trades
    const symbolTradeCount = activeTrades.filter(t => t.symbol === symbol).length;
    if (symbolTradeCount >= maxOpenTradesPerSymbol) {
      return {
        canEnter: false,
        reason: `Max open trades for ${symbol} (${maxOpenTradesPerSymbol}) reached`
      };
    }

    // Check total risk percentage
    const totalRiskPct = (totalSlUsed / balance) * 100;
    if (totalRiskPct >= maxTotalRiskPct) {
      return {
        canEnter: false,
        reason: `Total risk ${totalRiskPct.toFixed(2)}% >= max ${maxTotalRiskPct}%`
      };
    }

    // Check absolute SL guard in USDT
    if (totalSlUsed >= totalSlGuardUsdt) {
      return {
        canEnter: false,
        reason: `Total SL ${totalSlUsed.toFixed(2)} USDT >= guard ${totalSlGuardUsdt} USDT`
      };
    }

    // Check Time-of-Day historical performance
    if (config.risk_use_tod_stats && closedTrades.length > 5) {
      const currentHour = new Date().getUTCHours();
      let hourTradesCount = 0;
      let wins = 0;

      // BOLT OPTIMIZATION: Single loop to calculate stats without intermediate arrays
      for (const t of closedTrades) {
        if (t.exit_ts) {
          const exitTs = new Date(t.exit_ts);
          if (exitTs.getUTCHours() === currentHour) {
            hourTradesCount++;
            if ((t.pnl || 0) > 0) wins++;
          }
        }
      }

      if (hourTradesCount >= 3) {
        const winRate = (wins / hourTradesCount) * 100;
        const minWinRate = config.tod_min_winrate ?? 40.0;

        if (winRate < minWinRate) {
          return {
            canEnter: false,
            reason: `Historical performance for hour ${currentHour} is low (${winRate.toFixed(1)}% WR)`
          };
        }
      }
    }

    return { canEnter: true, reason: 'OK' };
  }

  /**
   * Calculate stop loss price based on SL type configuration
   * BOLT OPTIMIZATION: Accept scalar min/max extremes instead of arrays to reduce memory churn.
   */
  computeSl(
    entryPrice: number,
    direction: 'LONG' | 'SHORT',
    config: SessionConfig,
    minLow?: number,
    maxHigh?: number
  ): number {
    if (config.sl_type === 'pct') {
      // Simple percentage-based SL
      const distance = entryPrice * ((config.sl_distance_pct ?? 0.8) / 100);
      return direction === 'LONG' ? entryPrice - distance : entryPrice + distance;
    }

    // SL based on lookback period extremes
    if (config.sl_type === 'lookback_low/high') {
      if (minLow === undefined || maxHigh === undefined || minLow === 0 || maxHigh === 0 || minLow === Infinity || maxHigh === -Infinity) {
        // Fallback to percentage if lookback data not available
        return this.computeSl(entryPrice, direction, { ...config, sl_type: 'pct' });
      }

      const minPct = config.sl_min_pct ?? 0.3;
      const maxPct = config.sl_max_pct ?? 3.0;
      const minDistance = entryPrice * (minPct / 100);
      const maxDistance = entryPrice * (maxPct / 100);

      if (direction === 'LONG') {
        const structuralSl = minLow;
        const rawDistance = Math.abs(entryPrice - structuralSl);
        const clampedDistance = Math.min(Math.max(rawDistance, minDistance), maxDistance);
        return entryPrice - clampedDistance;
      }

      const structuralSl = maxHigh;
      const rawDistance = Math.abs(structuralSl - entryPrice);
      const clampedDistance = Math.min(Math.max(rawDistance, minDistance), maxDistance);
      return entryPrice + clampedDistance;
    }

    throw new Error(`Unknown sl_type: ${config.sl_type}`);
  }

  /**
   * Calculate position size (quantity) based on risk parameters
   */
  computePositionSize(
    balance: number,
    entryPrice: number,
    slPrice: number,
    direction: 'LONG' | 'SHORT',
    config: SessionConfig
  ): number {
    if (balance <= 0 || entryPrice <= 0) return 0;

    const riskAmount = balance * ((config.risk_pct_per_trade ?? 1.0) / 100);
    const slDistance = Math.abs(entryPrice - slPrice);
    
    if (slDistance <= 0) return 0;

    // qty = risk_amount / (sl_distance)
    // For futures, adjust based on entry_price as well
    const qty = roundEight(riskAmount / slDistance);
    return qty;
  }

  /**
   * Calculate initial Take Profit price based on exit RR sequence
   */
  computeTp(
    entryPrice: number,
    slPrice: number,
    direction: 'LONG' | 'SHORT',
    config: SessionConfig,
  ): number | null {
    if (config.tp_mode === 'exp_rr_seq') {
      return null;
    }

    const risk = Math.abs(entryPrice - slPrice);
    if (risk <= 0) return entryPrice;

    const initialRr = config.tp_ratio || 2;
    const reward = risk * initialRr;

    return direction === 'LONG'
      ? entryPrice + reward
      : entryPrice - reward;
  }

  /**
   * Calculate Risk:Reward ratio
   */
  calculateRiskRewardRatio(
    entryPrice: number,
    slPrice: number,
    tpPrice: number,
    direction: 'LONG' | 'SHORT'
  ): number {
    const risk = Math.abs(entryPrice - slPrice);
    const reward = Math.abs(tpPrice - entryPrice);
    
    if (risk <= 0) return 0;
    
    return reward / risk;
  }
}
