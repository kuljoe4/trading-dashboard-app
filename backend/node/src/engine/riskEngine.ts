import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { v4 as uuid } from 'uuid';
import { roundEight } from '../lib/math';
import { ConfigValidationException } from '../lib/exceptions';

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);
  
  /**
   * Check if a new trade can be entered based on risk limits
   * Refactored for rolling windows, randomization, and spacing.
   */
  canEnter(
    activeTrades: Trade[],
    closedTrades: Trade[],
    balance: number,
    symbol: string,
    config: SessionConfig,
    totalSlUsed: number
  ): { canEnter: boolean; reason: string; isAdaptiveTightened?: boolean } {
    const now = Date.now();

    // 1. Static Configuration Checks
    const maxOpenTrades = config.max_open_trades ?? 5;
    const maxOpenTradesPerSymbol = config.max_open_trades_per_symbol ?? 1;
    const maxTotalRiskPct = config.max_total_risk_pct ?? 5.0;
    const totalSlGuardUsdt = config.total_sl_guard_usdt ?? 200.0;

    if (activeTrades.length >= maxOpenTrades) {
      return { canEnter: false, reason: `Global max open trades (${maxOpenTrades}) reached` };
    }

    const symbolTradeCount = activeTrades.filter(t => t.symbol === symbol).length;
    if (symbolTradeCount >= maxOpenTradesPerSymbol) {
      return { canEnter: false, reason: `Max open trades for ${symbol} (${maxOpenTradesPerSymbol}) reached` };
    }

    const totalRiskPct = (totalSlUsed / balance) * 100;
    if (totalRiskPct >= maxTotalRiskPct) {
      return { canEnter: false, reason: `Total risk ${totalRiskPct.toFixed(2)}% >= max ${maxTotalRiskPct}%` };
    }

    if (totalSlUsed >= totalSlGuardUsdt) {
      return { canEnter: false, reason: `Total SL ${totalSlUsed.toFixed(2)} USDT >= guard ${totalSlGuardUsdt} USDT` };
    }

    // 2. Frequency, Spacing & Performance Check (ULTRA-OPTIMIZED SINGLE PASS)
    return this.checkFrequencyAndPerformanceLimits(activeTrades, closedTrades, config, now);
  }

  /**
   * BOLT OPTIMIZATION: Consolidates Period, 24h, Spacing, and TOD Performance checks into a single O(N) pass.
   * Avoids spread operators and array allocations to prevent stack overflow on large trade histories.
   */
  private checkFrequencyAndPerformanceLimits(
    activeTrades: Trade[],
    closedTrades: Trade[],
    config: SessionConfig,
    now: number
  ): { canEnter: boolean; reason: string; isAdaptiveTightened?: boolean } {
    const maxTradesPeriod = config.max_trades_per_period ?? 0;
    const periodMinBase = config.trades_period_min ?? 60;
    const maxTrades24h = config.max_trades_24h ?? 50;
    const shapingEnabled = config.frequency_shaping_enabled ?? false;
    const minIntervalMsBase = shapingEnabled ? (config.min_trade_interval_min ?? 0) * 60 * 1000 : 0;
    const jitterPct = shapingEnabled ? (config.trades_jitter_pct ?? 0) : 0;
    const useTodStats = config.risk_use_tod_stats && closedTrades.length > 5;
    const currentHour = useTodStats ? new Date().getUTCHours() : -1;

    let tradesInPeriod = 0;
    let tradesIn24h = 0;
    let hourTradesCount = 0;
    let wins = 0;
    let oldestTradeInPeriodTs = now;
    let oldestTradeIn24hTs = now;
    let mostRecentTradeTs = 0;

    // BOLT: Manual iteration for O(1) memory overhead and no stack risk
    const processTrade = (t: Trade) => {
      const entryTs = t.entry_ts ? new Date(t.entry_ts).getTime() : 0;
      if (entryTs === 0) return;

      if (entryTs > mostRecentTradeTs) mostRecentTradeTs = entryTs;

      // Track rolling 24h limit (evaluated after jitter to keep check sequence logical)
      if (entryTs >= now - (24 * 60 * 60 * 1000)) {
        tradesIn24h++;
        if (entryTs < oldestTradeIn24hTs) oldestTradeIn24hTs = entryTs;
      }

      // Track Time-of-Day stats
      if (useTodStats && t.exit_ts) {
        const exitTs = new Date(t.exit_ts);
        if (exitTs.getUTCHours() === currentHour) {
          hourTradesCount++;
          if ((t.pnl || 0) > 0) wins++;
        }
      }
    };

    for (let i = 0; i < activeTrades.length; i++) processTrade(activeTrades[i]);
    for (let i = 0; i < closedTrades.length; i++) processTrade(closedTrades[i]);

    // Apply stable jitter to the period window to prevent "stampeding"
    // Using 0 as fallback ensures predictable behavior when history is empty
    const jitterFactor = jitterPct > 0
      ? 1 + ((Math.abs(Math.sin(mostRecentTradeTs || 0)) * jitterPct) / 100)
      : 1;

    const effectivePeriodMs = periodMinBase * 60 * 1000 * jitterFactor;
    const periodStartMs = now - effectivePeriodMs;

    // Second pass (conceptual, but actually just tracking period count in the first pass would be better)
    // Refactoring to consolidate counts properly in first pass:
    tradesInPeriod = 0;
    const processTradeForPeriod = (t: Trade) => {
      const entryTs = t.entry_ts ? new Date(t.entry_ts).getTime() : 0;
      if (entryTs >= periodStartMs) {
        tradesInPeriod++;
        if (entryTs < oldestTradeInPeriodTs) oldestTradeInPeriodTs = entryTs;
      }
    };

    for (let i = 0; i < activeTrades.length; i++) processTradeForPeriod(activeTrades[i]);
    for (let i = 0; i < closedTrades.length; i++) processTradeForPeriod(closedTrades[i]);

    // 4. TOD Performance Check (Pre-calculated for Adaptive Spacing)
    let adaptiveMultiplier = 1.0;
    let isAdaptiveTightened = false;
    if (useTodStats && hourTradesCount >= 3) {
      const winRate = (wins / hourTradesCount) * 100;
      const minWinRate = config.tod_min_winrate ?? 40.0;
      if (winRate < minWinRate) {
        if (config.frequency_tod_integration && shapingEnabled) {
          adaptiveMultiplier = 2.0; // Double the interval, half the period limit
          isAdaptiveTightened = true;
        } else {
          return { canEnter: false, reason: `Historical performance for hour ${currentHour} is low (${winRate.toFixed(1)}% WR)` };
        }
      }
    }

    // 1. Min Interval Spacing Check
    const effectiveMinIntervalMs = minIntervalMsBase * adaptiveMultiplier;
    if (effectiveMinIntervalMs > 0 && mostRecentTradeTs > 0) {
      const elapsed = now - mostRecentTradeTs;
      if (elapsed < effectiveMinIntervalMs) {
        const waitMin = Math.ceil((effectiveMinIntervalMs - elapsed) / 60000);
        const adaptiveNote = isAdaptiveTightened ? ' (Adaptive TOD Tightening)' : '';
        return { canEnter: false, reason: `Trade spacing active${adaptiveNote}. Wait ~${waitMin}m before next entry.`, isAdaptiveTightened };
      }
    }

    // 2. Rolling Period Limit (with Jitter and Adaptive Scaling)
    const effectiveMaxTradesPeriod = isAdaptiveTightened
      ? Math.max(1, Math.floor(maxTradesPeriod * 0.5))
      : maxTradesPeriod;

    if (effectiveMaxTradesPeriod > 0 && tradesInPeriod >= effectiveMaxTradesPeriod) {
      const nextSlotMs = oldestTradeInPeriodTs + effectivePeriodMs - now;
      const nextSlotMin = Math.ceil(nextSlotMs / 60000);
      const adaptiveNote = isAdaptiveTightened ? ' (Adaptive TOD Tightening)' : '';
      return {
        canEnter: false,
        reason: `Max trades per period reached (${maxTradesPeriod}/${Math.round(effectivePeriodMs / 60000)}m)${adaptiveNote}. Next slot in ~${nextSlotMin}m.`,
        isAdaptiveTightened
      };
    }

    // 3. Rolling 24h Limit
    if (maxTrades24h > 0 && tradesIn24h >= maxTrades24h) {
      const nextSlotMs = oldestTradeIn24hTs + (24 * 60 * 60 * 1000) - now;
      const nextSlotHours = (nextSlotMs / (60 * 60 * 1000)).toFixed(1);
      return {
        canEnter: false,
        reason: `Rolling 24h limit reached (${tradesIn24h}/${maxTrades24h}). Next slot in ~${nextSlotHours}h.`,
        isAdaptiveTightened
      };
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
    maxHigh?: number,
    symbol?: string
  ): number {
    if (config.sl_type === 'pct') {
      // Simple percentage-based SL
      const distance = entryPrice * ((config.sl_distance_pct ?? 0.8) / 100);
      const sl = direction === 'LONG' ? entryPrice - distance : entryPrice + distance;
      this.logger.debug(`[RiskEngine] ${symbol || 'Trade'} Pct SL: ${sl.toFixed(5)} (dist: ${config.sl_distance_pct}%)`);
      return sl;
    }

    // SL based on lookback period extremes
    if (config.sl_type === 'lookback_low/high') {
      if (minLow === undefined || maxHigh === undefined || minLow === 0 || maxHigh === 0 || minLow === Infinity || maxHigh === -Infinity) {
        // Fallback to percentage if lookback data not available
        this.logger.warn(`[RiskEngine] ${symbol || 'Trade'} Lookback extremes unavailable (minLow: ${minLow}, maxHigh: ${maxHigh}). Falling back to Pct SL.`);
        return this.computeSl(entryPrice, direction, { ...config, sl_type: 'pct' }, undefined, undefined, symbol);
      }

      const minPct = config.sl_min_pct ?? 0.3;
      const maxPct = config.sl_max_pct ?? 3.0;
      const minDistance = entryPrice * (minPct / 100);
      const maxDistance = entryPrice * (maxPct / 100);

      let structuralSl: number;
      let rawDistance: number;

      if (direction === 'LONG') {
        structuralSl = minLow;
        rawDistance = Math.abs(entryPrice - structuralSl);
      } else {
        structuralSl = maxHigh;
        rawDistance = Math.abs(structuralSl - entryPrice);
      }

      const clampedDistance = Math.min(Math.max(rawDistance, minDistance), maxDistance);
      const finalSl = direction === 'LONG' ? entryPrice - clampedDistance : entryPrice + clampedDistance;

      this.logger.debug(`[RiskEngine] ${symbol || 'Trade'} Lookback SL Journey:
        Entry: ${entryPrice}
        Extreme (${direction === 'LONG' ? 'Low' : 'High'}): ${structuralSl}
        Raw Dist: ${rawDistance.toFixed(5)} (${((rawDistance / entryPrice) * 100).toFixed(2)}%)
        Clamped Dist: ${clampedDistance.toFixed(5)} (${((clampedDistance / entryPrice) * 100).toFixed(2)}%) [Min: ${minPct}%, Max: ${maxPct}%]
        Final SL: ${finalSl.toFixed(5)}`);

      return finalSl;
    }

    throw new ConfigValidationException(`Unknown sl_type: ${config.sl_type}`);
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
