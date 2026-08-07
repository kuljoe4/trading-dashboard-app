import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { v4 as uuid } from 'uuid';
import { roundEight } from '../lib/math';
import { ConfigValidationException } from '../lib/exceptions';

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);

  // BOLT OPTIMIZATION: Cache for closed trade aggregates to avoid redundant O(N) scans
  private _closedStatsCache: {
    key: string;
    stats: {
      tradesIn24h: number;
      tradesInPeriod: number;
      hourTradesCount: number;
      wins: number;
      oldestTradeIn24hTs: number;
      oldestTradeInPeriodTs: number;
    }
  } | null = null;
  
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
    totalSlUsed: number,
    enteringCount = 0,
    marketScore?: number,
    prospectiveRiskPct?: number,
    globalSlGuardOverride?: number
  ): ReturnType<RiskEngineService['checkFrequencyAndPerformanceLimits']> {
    const now = Date.now();

    const strategyLabel = config.strategy_label || 'Momentum Strategy';
    const isBaseStrategy = strategyLabel === 'Momentum Strategy';

    // BOLT OPTIMIZATION: Fused loop to compute strategy trade metrics without intermediate .filter() arrays
    let activeTradesCountForStrategy = 0;
    let symbolTradeCount = 0;
    let totalSlUsedForStrategy = 0;

    for (let i = 0; i < activeTrades.length; i++) {
      const t = activeTrades[i];
      const isTradeBase = !t.strategy_label || t.strategy_label === 'Momentum Strategy';
      const matchesStrategy = isBaseStrategy ? isTradeBase : t.strategy_label === strategyLabel;

      if (matchesStrategy) {
        activeTradesCountForStrategy++;
        totalSlUsedForStrategy += t.risk_usdt || 0;
        if (t.symbol === symbol) {
          symbolTradeCount++;
        }
      }
    }

    // 1. Static Configuration Checks
    const maxOpenTrades = config.max_open_trades ?? 5;
    const maxOpenTradesPerSymbol = config.max_open_trades_per_symbol ?? 1;
    const maxTotalRiskPct = config.max_total_risk_pct ?? 5.0;
    const totalSlGuardUsdt = config.total_sl_guard_usdt ?? 200.0;

    // Global stop loss guard check across ALL strategies for absolute portfolio safety
    const globalSlGuard = globalSlGuardOverride !== undefined ? globalSlGuardOverride : (config.total_sl_guard_usdt ?? 200.0);
    if (totalSlUsed >= globalSlGuard) {
      return { canEnter: false, reason: `Global Total SL ${Number(totalSlUsed || 0).toFixed(2)} USDT >= guard ${globalSlGuard} USDT` };
    }

    // BOLT: Include enteringCount in capacity check to prevent exceeding limits during concurrency (strategy-scoped)
    if (activeTradesCountForStrategy + enteringCount >= maxOpenTrades) {
      const maxOpenMsg = isBaseStrategy ? `Global max open trades (${maxOpenTrades}) reached` : `Strategy max open trades (${maxOpenTrades}) reached`;
      return { canEnter: false, reason: `${maxOpenMsg} (incl. ${enteringCount} pending)${!isBaseStrategy ? ' for label "' + strategyLabel + '"' : ''}` };
    }

    if (symbolTradeCount >= maxOpenTradesPerSymbol) {
      return { canEnter: false, reason: `Max open trades for ${symbol} (${maxOpenTradesPerSymbol}) reached${!isBaseStrategy ? ' for label "' + strategyLabel + '"' : ''}` };
    }

    const riskPerTrade = prospectiveRiskPct !== undefined ? prospectiveRiskPct : (config.risk_pct_per_trade ?? 1.0);
    // In base strategy (or tests), fallback to the passed totalSlUsed to maintain backward compatibility
    const slUsed = isBaseStrategy ? totalSlUsed : totalSlUsedForStrategy;
    const totalRiskPct = balance > 0 ? (slUsed / balance) * 100 : 0;

    // SRE: Tight Gating. Ensure prospective total risk (current + next entry) does not exceed ceiling.
    if (totalRiskPct + riskPerTrade > maxTotalRiskPct + 0.0001) {
      const nominalRisk = config.risk_pct_per_trade ?? 1.0;
      const isScaledUp = prospectiveRiskPct !== undefined && prospectiveRiskPct > nominalRisk;
      // Small account exception: if we are scaling up to meet MIN_NOTIONAL, and the unscaled nominal risk would fit within limits,
      // allow the trade so small balances (such as the $14.85 balance in the logs) are not locked out from executing.
      const allowScaleException = isScaledUp && (config.auto_scale_min_notional ?? true) && (totalRiskPct + nominalRisk <= maxTotalRiskPct + 0.0001);

      if (!allowScaleException) {
        return {
          canEnter: false,
          reason: `Risk ceiling reached for label "${strategyLabel}": ${totalRiskPct.toFixed(2)}% + ${riskPerTrade.toFixed(2)}% prospective > ${maxTotalRiskPct}% max`
        };
      } else {
        this.logger.log(`[Risk Engine] Allowing min_notional scaled risk overshoot exception for "${strategyLabel}": nominal ${nominalRisk.toFixed(2)}% fits, scaled is ${riskPerTrade.toFixed(2)}%`);
      }
    }

    if (totalSlUsedForStrategy >= totalSlGuardUsdt) {
      return { canEnter: false, reason: `Strategy Total SL ${Number(totalSlUsedForStrategy || 0).toFixed(2)} USDT >= guard ${totalSlGuardUsdt} USDT for label "${strategyLabel}"` };
    }

    // 2. Frequency, Spacing & Performance Check (ULTRA-OPTIMIZED SINGLE PASS - strategy-scoped)
    // BOLT OPTIMIZATION: Pass the raw, unfiltered arrays directly to avoid intermediate array allocations
    return this.checkFrequencyAndPerformanceLimits(activeTrades, closedTrades, config, now, enteringCount, symbol, marketScore);
  }

  /**
   * BOLT OPTIMIZATION: Consolidates Period, 24h, Spacing, and TOD Performance checks into a single O(N) pass.
   * Avoids spread operators and array allocations to prevent stack overflow on large trade histories.
   * Performs strategy-level filtering on-the-fly inside loops to operate with zero garbage-collection memory allocations.
   */
  private checkFrequencyAndPerformanceLimits(
    activeTrades: Trade[],
    closedTrades: Trade[],
    config: SessionConfig,
    now: number,
    enteringCount = 0,
    symbol = 'DUMMY',
    marketScore?: number
  ): {
    canEnter: boolean;
    reason: string;
    isAdaptiveTightened?: boolean;
    tradesInPeriod?: number;
    maxTradesPeriod?: number;
    tradesIn24h?: number;
    maxTrades24h?: number;
    mostRecentTradeTs?: number;
    oldestTradeIn24hTs?: number;
    oldestTradeInPeriodTs?: number;
    nextSlotTs?: number;
    effectivePeriodMs?: number;
    jitterFactor?: number;
  } {
    const strategyLabel = config.strategy_label || 'Momentum Strategy';
    const isBaseStrategy = strategyLabel === 'Momentum Strategy';

    const maxTradesPeriod = config.max_trades_per_period || 0;
    const periodMinBase = config.trades_period_min || 60;
    const maxTrades24h = config.max_trades_24h || 0;
    const shapingEnabled = config.frequency_shaping_enabled ?? false;
    const minIntervalMsBase = shapingEnabled ? (config.min_trade_interval_min ?? 0) * 60 * 1000 : 0;
    const jitterPct = shapingEnabled ? (config.trades_jitter_pct ?? 0) : 0;
    const useTodStats = config.risk_use_tod_stats && closedTrades.length > 5;
    const currentHour = useTodStats ? new Date().getUTCHours() : -1;

    // BOLT: Determine mostRecentTradeTs first to calculate jitter and period window upfront.
    // This is O(1) + O(Active) where Active is typically < 10.
    // BOLT: If trades are currently entering, treat 'now' as the most recent trade TS to enforce spacing.
    let mostRecentTradeTs = enteringCount > 0 ? now : 0;
    for (let i = 0; i < activeTrades.length; i++) {
      const t = activeTrades[i];
      // BOLT OPTIMIZATION: On-the-fly strategy check to bypass array allocations
      const isTradeBase = !t.strategy_label || t.strategy_label === 'Momentum Strategy';
      const matchesStrategy = isBaseStrategy ? isTradeBase : t.strategy_label === strategyLabel;
      if (!matchesStrategy) continue;

      // Include all trades with a valid entry_ts in spacing calculation
      const entryRaw = t.entry_ts;
      if (entryRaw) {
        const ts = entryRaw instanceof Date ? entryRaw.getTime() : new Date(entryRaw).getTime();
        if (ts > mostRecentTradeTs) mostRecentTradeTs = ts;
      }
    }

    // Find absolute most recent organic trade across ALL closed trades matching strategy.
    // We scan the top slice of closed trades to ensure we don't miss a recent one
    // if the list isn't perfectly sorted by entry time.
    let foundCount = 0;
    for (let i = 0; i < closedTrades.length; i++) {
      const t = closedTrades[i];
      const isTradeBase = !t.strategy_label || t.strategy_label === 'Momentum Strategy';
      const matchesStrategy = isBaseStrategy ? isTradeBase : t.strategy_label === strategyLabel;
      if (!matchesStrategy) continue;

      // Include all trades with a valid entry_ts in spacing calculation
      const entryRaw = t.entry_ts;
      if (entryRaw) {
        const ts = entryRaw instanceof Date ? entryRaw.getTime() : new Date(entryRaw).getTime();
        if (ts > mostRecentTradeTs) mostRecentTradeTs = ts;
      }
      foundCount++;
      if (foundCount >= 20) break;
    }

    // BOLT: Stability Guard for Jitter. If mostRecentTradeTs is 0 (first trade),
    // use a stable anchor to prevent sin(0) from always resulting in 0 jitter.
    const effectiveMostRecentTs = mostRecentTradeTs || 1717171717171;

    // Apply stable jitter to the period window to prevent "stampeding".
    // SRE: Floor effectiveMostRecentTs to 10s to ensure jitter is stable across high-frequency loop iterations (Issue 3)
    // BOLT: Market-Aware Jitter incorporates symbol-specific offset to prevent cross-symbol stampeding.
    // SRE: Replaced character-sum with FNV-1a for better distribution and order sensitivity.
    let symbolHash = 0x811c9dc5;
    for (let i = 0; i < symbol.length; i++) {
      symbolHash ^= symbol.charCodeAt(i);
      symbolHash = Math.imul(symbolHash, 0x01000193);
    }
    symbolHash = symbolHash >>> 0;

    const jitterSeed = (Math.floor(effectiveMostRecentTs / 10000) * 10000) + (symbolHash % 10000);

    // PERFORMANCE: Market-aware scaling. High quality signals (high score) reduce jitter for faster entry.
    const effectiveJitterPct = (config.trades_jitter_market_aware && marketScore !== undefined)
      ? jitterPct * Math.max(0, 1 - (marketScore / 100))
      : jitterPct;

    // SRE: Replaced Math.sin with a 32-bit mix hash for stable deterministic jitter on large integers.
    const getHash = (n: number) => {
      let h = n >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
      h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
      h = h ^ (h >>> 15);
      return (h >>> 0) / 4294967296;
    };

    const jitterFactor = (effectiveJitterPct > 0 && symbol !== 'DUMMY')
      ? 1 + (getHash(jitterSeed) * effectiveJitterPct) / 100
      : 1;

    const effectivePeriodMs = periodMinBase * 60 * 1000 * jitterFactor;
    const periodStartMs = now - effectivePeriodMs;
    const dayAgo = now - (24 * 60 * 60 * 1000);

    let tradesIn24h = enteringCount;
    let tradesInPeriod = enteringCount;
    let hourTradesCount = 0;
    let wins = 0;
    let oldestTradeInPeriodTs = now;
    let oldestTradeIn24hTs = now;

    // BOLT: Manual iteration for O(1) memory overhead.
    // Assuming closedTrades are sorted descending (most recent first).
    const processTrade = (t: Trade, isClosed: boolean): boolean => {
      // Include all trades with a valid entry_ts in rolling window counts
      const entryRaw = t.entry_ts;
      if (!entryRaw) return true;
      const entryTs = entryRaw instanceof Date ? entryRaw.getTime() : new Date(entryRaw).getTime();
      if (entryTs === 0) return true;

      // BOLT: Optimization - Early exit if trade is older than 24h and we are in the closedTrades list.
      if (isClosed && entryTs < dayAgo) return false;

      // BOLT OPTIMIZATION: On-the-fly strategy check
      const isTradeBase = !t.strategy_label || t.strategy_label === 'Momentum Strategy';
      const matchesStrategy = isBaseStrategy ? isTradeBase : t.strategy_label === strategyLabel;
      if (!matchesStrategy) return true;

      // Track rolling 24h limit
      if (entryTs >= dayAgo) {
        tradesIn24h++;
        if (entryTs < oldestTradeIn24hTs) oldestTradeIn24hTs = entryTs;
      }

      // Track rolling period limit
      if (entryTs >= periodStartMs) {
        tradesInPeriod++;
        if (entryTs < oldestTradeInPeriodTs) oldestTradeInPeriodTs = entryTs;
      }

      // Track Time-of-Day stats
      const exitRaw = t.exit_ts;
      if (useTodStats && exitRaw) {
        const exitTs = exitRaw instanceof Date ? exitRaw : new Date(exitRaw);
        if (exitTs.getUTCHours() === currentHour) {
          hourTradesCount++;
          if ((t.pnl || 0) > 0) wins++;
        }
      }
      return true;
    };

    for (let i = 0; i < activeTrades.length; i++) {
      processTrade(activeTrades[i], false);
    }

    // BOLT OPTIMIZATION: Use cached closed trade stats if available for the current window.
    // SRE: Use 5s bucketing for the timestamps in the cache key to stabilize hits during high frequency loops.
    // Include strategy_label to prevent cache collision across different strategy variants.
    const cacheKey = `${strategyLabel}_${closedTrades.length}_${closedTrades[0]?.id || 'none'}_${currentHour}_${Math.floor(dayAgo / 5000)}_${Math.floor(periodStartMs / 5000)}`;

    if (this._closedStatsCache && this._closedStatsCache.key === cacheKey) {
      const s = this._closedStatsCache.stats;
      tradesIn24h += s.tradesIn24h;
      tradesInPeriod += s.tradesInPeriod;
      hourTradesCount += s.hourTradesCount;
      wins += s.wins;
      if (s.oldestTradeIn24hTs < oldestTradeIn24hTs) oldestTradeIn24hTs = s.oldestTradeIn24hTs;
      if (s.oldestTradeInPeriodTs < oldestTradeInPeriodTs) oldestTradeInPeriodTs = s.oldestTradeInPeriodTs;
    } else {
      // Cache Miss: Perform O(N) scan over closed trades
      const closedBase = {
        tradesIn24h: 0,
        tradesInPeriod: 0,
        hourTradesCount: 0,
        wins: 0,
        oldestTradeIn24hTs: now,
        oldestTradeInPeriodTs: now,
      };

      // Create a temporary processing function for closed trades to populate closedBase
      const processClosed = (t: Trade): boolean => {
        // Include all trades with a valid entry_ts in rolling window counts
        const entryRaw = t.entry_ts;
        if (!entryRaw) return true;
        const entryTs = entryRaw instanceof Date ? entryRaw.getTime() : new Date(entryRaw).getTime();
        if (entryTs === 0) return true;
        if (entryTs < dayAgo) return false;

        // BOLT OPTIMIZATION: On-the-fly strategy check
        const isTradeBase = !t.strategy_label || t.strategy_label === 'Momentum Strategy';
        const matchesStrategy = isBaseStrategy ? isTradeBase : t.strategy_label === strategyLabel;
        if (!matchesStrategy) return true;

        if (entryTs >= dayAgo) {
          closedBase.tradesIn24h++;
          if (entryTs < closedBase.oldestTradeIn24hTs) closedBase.oldestTradeIn24hTs = entryTs;
        }
        if (entryTs >= periodStartMs) {
          closedBase.tradesInPeriod++;
          if (entryTs < closedBase.oldestTradeInPeriodTs) closedBase.oldestTradeInPeriodTs = entryTs;
        }
        const exitRaw = t.exit_ts;
        if (useTodStats && exitRaw) {
          const exitTs = exitRaw instanceof Date ? exitRaw : new Date(exitRaw);
          if (exitTs.getUTCHours() === currentHour) {
            closedBase.hourTradesCount++;
            if ((t.pnl || 0) > 0) closedBase.wins++;
          }
        }
        return true;
      };

      for (let i = 0; i < closedTrades.length; i++) {
        if (!processClosed(closedTrades[i])) break;
      }

      // Update Cache
      this._closedStatsCache = { key: cacheKey, stats: closedBase };

      // Add closedBase to running totals
      tradesIn24h += closedBase.tradesIn24h;
      tradesInPeriod += closedBase.tradesInPeriod;
      hourTradesCount += closedBase.hourTradesCount;
      wins += closedBase.wins;
      if (closedBase.oldestTradeIn24hTs < oldestTradeIn24hTs) oldestTradeIn24hTs = closedBase.oldestTradeIn24hTs;
      if (closedBase.oldestTradeInPeriodTs < oldestTradeInPeriodTs) oldestTradeInPeriodTs = closedBase.oldestTradeInPeriodTs;
    }

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
          return {
            canEnter: false,
            reason: `Historical performance for hour ${currentHour} is low (${Number(winRate || 0).toFixed(1)}% WR)`,
            isAdaptiveTightened,
            tradesInPeriod,
            maxTradesPeriod: Math.max(1, Math.floor(maxTradesPeriod * (isAdaptiveTightened ? 0.5 : 1.0))),
            tradesIn24h,
            maxTrades24h,
            mostRecentTradeTs,
            oldestTradeIn24hTs,
          oldestTradeInPeriodTs,
          effectivePeriodMs,
          jitterFactor
          };
        }
      }
    }

    // 1. Min Interval Spacing Check
    const effectiveMinIntervalMs = minIntervalMsBase * adaptiveMultiplier;
    const effectiveMaxTradesPeriod = isAdaptiveTightened
      ? Math.max(1, Math.floor(maxTradesPeriod * 0.5))
      : maxTradesPeriod;

    if (effectiveMinIntervalMs > 0 && mostRecentTradeTs > 0) {
      const elapsed = now - mostRecentTradeTs;
      if (elapsed < effectiveMinIntervalMs) {
        const waitMin = Math.ceil((effectiveMinIntervalMs - elapsed) / 60000);
        const adaptiveNote = isAdaptiveTightened ? ' (Adaptive TOD Tightening)' : '';
        return {
          canEnter: false,
          reason: `Trade spacing active${adaptiveNote}. Wait ~${waitMin}m before next entry.`,
          isAdaptiveTightened,
          tradesInPeriod,
          maxTradesPeriod: effectiveMaxTradesPeriod,
          tradesIn24h,
          maxTrades24h,
          mostRecentTradeTs,
          oldestTradeIn24hTs,
          oldestTradeInPeriodTs,
          effectivePeriodMs,
          jitterFactor
        };
      }
    }

    // 2. Rolling Period Limit (with Jitter and Adaptive Scaling)
    if (effectiveMaxTradesPeriod > 0 && tradesInPeriod >= effectiveMaxTradesPeriod) {
      const nextSlotMs = oldestTradeInPeriodTs + effectivePeriodMs - now;
      const nextSlotMin = Math.ceil(nextSlotMs / 60000);
      const adaptiveNote = isAdaptiveTightened ? ' (Adaptive TOD Tightening)' : '';
      return {
        canEnter: false,
        reason: `Max trades per period reached (${maxTradesPeriod}/${Math.round(effectivePeriodMs / 60000)}m)${adaptiveNote}. Next slot in ~${nextSlotMin}m.`,
        isAdaptiveTightened,
        tradesInPeriod,
        maxTradesPeriod: effectiveMaxTradesPeriod,
        tradesIn24h,
        maxTrades24h,
        mostRecentTradeTs,
        oldestTradeIn24hTs,
        oldestTradeInPeriodTs,
        nextSlotTs: oldestTradeInPeriodTs + effectivePeriodMs,
        effectivePeriodMs,
        jitterFactor
      };
    }

    // 3. Rolling 24h Limit
    if (maxTrades24h > 0 && tradesIn24h >= maxTrades24h) {
      const nextSlotTs = oldestTradeIn24hTs + (24 * 60 * 60 * 1000);
      const nextSlotMs = nextSlotTs - now;
      const nextSlotHours = Number(nextSlotMs / (60 * 60 * 1000)).toFixed(1);
      return {
        canEnter: false,
        reason: `Rolling 24h limit reached (${tradesIn24h}/${maxTrades24h}). Next slot in ~${nextSlotHours}h.`,
        isAdaptiveTightened,
        tradesInPeriod,
        maxTradesPeriod: effectiveMaxTradesPeriod,
        tradesIn24h,
        maxTrades24h,
        mostRecentTradeTs,
        oldestTradeIn24hTs,
        oldestTradeInPeriodTs,
        nextSlotTs,
        effectivePeriodMs,
        jitterFactor
      };
    }

    return {
      canEnter: true,
      reason: 'OK',
      isAdaptiveTightened,
      tradesInPeriod,
      maxTradesPeriod: effectiveMaxTradesPeriod,
      tradesIn24h,
      maxTrades24h,
      mostRecentTradeTs,
      oldestTradeIn24hTs,
      oldestTradeInPeriodTs,
      effectivePeriodMs,
      jitterFactor
    };
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
    symbol?: string,
    patternLow?: number,
    patternHigh?: number,
    bodyLow?: number,
    bodyHigh?: number,
    supertrendSlPrice?: number
  ): { slPrice: number; rejected: boolean; reason?: string } {
    if (config.sl_type === 'trailing') {
      return this.computeSl(entryPrice, direction, { ...config, sl_type: 'pct' } as SessionConfig, minLow, maxHigh, symbol, patternLow, patternHigh, bodyLow, bodyHigh, supertrendSlPrice);
    }

    if (config.sl_type === 'supertrend') {
      if (supertrendSlPrice === undefined || supertrendSlPrice <= 0 || isNaN(supertrendSlPrice) || !isFinite(supertrendSlPrice)) {
        this.logger.warn(`[RiskEngine] ${symbol || 'Trade'} Supertrend stop-loss price unavailable or invalid (value: ${supertrendSlPrice}). Falling back to Pct SL.`);
        return this.computeSl(entryPrice, direction, { ...config, sl_type: 'pct' } as SessionConfig, minLow, maxHigh, symbol, patternLow, patternHigh, bodyLow, bodyHigh, supertrendSlPrice);
      }

      const minPct = config.sl_min_pct ?? 0.3;
      const maxPct = config.sl_max_pct ?? 3.0;
      const action = config.sl_out_of_bounds_action || 'clamp';

      let finalSl = supertrendSlPrice;
      const distancePct = Math.abs(finalSl - entryPrice) / entryPrice * 100;

      let rejected = false;
      let reason = undefined;

      if (distancePct < minPct) {
        if (action === 'clamp') {
          const minDistance = entryPrice * (minPct / 100);
          finalSl = direction === 'LONG' ? entryPrice - minDistance : entryPrice + minDistance;
        } else {
          rejected = true;
          reason = `Supertrend SL distance (${distancePct.toFixed(2)}%) is below minimum of ${minPct}%`;
        }
      } else if (distancePct > maxPct) {
        if (action === 'clamp') {
          const maxDistance = entryPrice * (maxPct / 100);
          finalSl = direction === 'LONG' ? entryPrice - maxDistance : entryPrice + maxDistance;
        } else {
          rejected = true;
          reason = `Supertrend SL distance (${distancePct.toFixed(2)}%) exceeds maximum of ${maxPct}%`;
        }
      }

      this.logger.debug(`[RiskEngine] ${symbol || 'Trade'} Supertrend SL: ${Number(finalSl || 0).toFixed(5)} (dist: ${distancePct.toFixed(2)}%)`);
      return { slPrice: finalSl, rejected, reason };
    }

    if (config.sl_type === 'pct') {
      // Simple percentage-based SL
      const distance = entryPrice * ((config.sl_distance_pct ?? 0.8) / 100);
      const sl = direction === 'LONG' ? entryPrice - distance : entryPrice + distance;
      this.logger.debug(`[RiskEngine] ${symbol || 'Trade'} Pct SL: ${Number(sl || 0).toFixed(5)} (dist: ${config.sl_distance_pct}%)`);
      return { slPrice: sl, rejected: false };
    }

    // SL based on lookback period extremes
    if (config.sl_type === 'lookback_low/high') {
      if (minLow === undefined || maxHigh === undefined || minLow === 0 || maxHigh === 0 || minLow === Infinity || maxHigh === -Infinity) {
        // Fallback to percentage if lookback data not available
        this.logger.warn(`[RiskEngine] ${symbol || 'Trade'} Lookback extremes unavailable (minLow: ${minLow}, maxHigh: ${maxHigh}). Falling back to Pct SL.`);
        return this.computeSl(entryPrice, direction, { ...config, sl_type: 'pct' } as SessionConfig, undefined, undefined, symbol);
      }

      const minPct = config.sl_min_pct ?? 0.3;
      const maxPct = config.sl_max_pct ?? 3.0;
      const action = config.sl_out_of_bounds_action || 'clamp';
      const minDistance = entryPrice * (minPct / 100);
      const maxDistance = entryPrice * (maxPct / 100);

      let structuralSl: number;      let rawDistance: number;

      if (direction === 'LONG') {
        structuralSl = minLow;
        rawDistance = Math.abs(entryPrice - structuralSl);
      } else {
        structuralSl = maxHigh;
        rawDistance = Math.abs(structuralSl - entryPrice);
      }

      const rawDistPct = (rawDistance / entryPrice) * 100;
      let clampType: 'RAW' | 'MIN_CLAMP' | 'MAX_CLAMP' | 'REJECT' = 'RAW';
      let finalDistance = rawDistance;
      let rejected = false;
      let reason: string | undefined;

      if (rawDistance < minDistance) {
        if (action === 'reject') {
           clampType = 'REJECT';
           rejected = true;
           reason = `Lookback SL dist ${rawDistPct.toFixed(2)}% below min ${minPct}%`;
        } else {
           finalDistance = minDistance;
           clampType = 'MIN_CLAMP';
        }
      } else if (rawDistance > maxDistance) {
        if (action === 'reject') {
           clampType = 'REJECT';
           rejected = true;
           reason = `Lookback SL dist ${rawDistPct.toFixed(2)}% above max ${maxPct}%`;
        } else {
           finalDistance = maxDistance;
           clampType = 'MAX_CLAMP';
        }
      }

      const slPrice = direction === 'LONG' ? entryPrice - finalDistance : entryPrice + finalDistance;

      this.logger.debug(`[RiskEngine] ${symbol || 'Trade'} Lookback SL Journey:
        Entry: ${entryPrice}
        Extreme (${direction === 'LONG' ? 'Low' : 'High'}): ${structuralSl}
        Raw Dist: ${Number(rawDistance || 0).toFixed(5)} (${rawDistPct.toFixed(2)}%)
        Min: ${minPct}% (${Number(minDistance || 0).toFixed(5)}), Max: ${maxPct}% (${Number(maxDistance || 0).toFixed(5)})
        Action: ${action.toUpperCase()}, Result: ${clampType} -> Dist: ${Number(finalDistance || 0).toFixed(5)}
        Final SL: ${Number(slPrice || 0).toFixed(5)}`);

      return { slPrice, rejected, reason };
    }

    if (config.sl_type === 'engulfing_boundary' || config.sl_type === 'streak_extreme') {
      // Use Body boundary for 'body' or 'close_body' modes, otherwise Range.
      // NOTE: We still prefer the absolute 'outer' boundary (Range) for protection if it's a structural play,
      // but if the user chose body mode, they might prefer the 'body' boundary.
      // For now, we prioritize Range (patternLow/High) as it's the more conservative structural stop.
      // However, we check if the specific mode-based data is available.

      const mode = config.engulfing_mode || 'range';
      const useBody = mode === 'body' || mode === 'close_body';

      let structuralSl = direction === 'LONG' ? patternLow : patternHigh;

      // If we specifically want body-based or if range is missing but body is present
      if ((useBody && (direction === 'LONG' ? bodyLow : bodyHigh) !== undefined) || (structuralSl === undefined && (direction === 'LONG' ? bodyLow : bodyHigh) !== undefined)) {
        structuralSl = direction === 'LONG' ? bodyLow : bodyHigh;
      }

      if (structuralSl === undefined || structuralSl <= 0) {
        this.logger.warn(`[RiskEngine] ${symbol || 'Trade'} Engulfing boundary unavailable. Falling back to Pct SL.`);
        return this.computeSl(entryPrice, direction, { ...config, sl_type: 'pct' } as SessionConfig, undefined, undefined, symbol);
      }

      const minPct = config.sl_min_pct ?? 0.3;
      const maxPct = config.sl_max_pct ?? 3.0;
      const action = config.sl_out_of_bounds_action || 'clamp';
      const minDistance = entryPrice * (minPct / 100);
      const maxDistance = entryPrice * (maxPct / 100);

      const rawDistance = Math.abs(entryPrice - structuralSl);
      const rawDistPct = (rawDistance / entryPrice) * 100;

      let finalDistance = rawDistance;
      let rejected = false;
      let reason: string | undefined;

      if (rawDistance < minDistance) {
        if (action === 'reject') {
          rejected = true;
          reason = `Engulfing SL dist ${rawDistPct.toFixed(2)}% below min ${minPct}%`;
        } else {
          finalDistance = minDistance;
        }
      } else if (rawDistance > maxDistance) {
        if (action === 'reject') {
          rejected = true;
          reason = `Engulfing SL dist ${rawDistPct.toFixed(2)}% above max ${maxPct}%`;
        } else {
          finalDistance = maxDistance;
        }
      }

      const slPrice = direction === 'LONG' ? entryPrice - finalDistance : entryPrice + finalDistance;
      this.logger.debug(`[RiskEngine] ${symbol || 'Trade'} Engulfing SL: ${Number(slPrice || 0).toFixed(5)} (dist: ${((finalDistance/entryPrice)*100).toFixed(2)}%)`);

      return { slPrice, rejected, reason };
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
    config: SessionConfig,
    symbol?: string
  ): { qty: number; rejected?: boolean; reason?: string; isNominalOvershoot?: boolean } {
    this.logger.debug(`[RiskEngine] ${symbol || 'Trade'} Size Check: Balance=${balance}, Entry=${entryPrice}, SL=${slPrice}, Dist=${Number(Math.abs(entryPrice - slPrice) || 0).toFixed(5)}`);
    if (balance <= 0 || entryPrice <= 0) return { qty: 0 };

    const riskAmount = balance * ((config.risk_pct_per_trade ?? 1.0) / 100);
    const slDistance = Math.abs(entryPrice - slPrice);
    
    if (slDistance <= 0) return { qty: 0 };

    // qty = risk_amount / (sl_distance)
    // For futures, adjust based on entry_price as well
    let qty = roundEight(riskAmount / slDistance);

    // PERFORMANCE: Implement dynamic notional scaling floor.
    // Binance absolute minimum for Futures is 5 USDT. We use 5.01 for a safety buffer.
    const autoScale = config.auto_scale_min_notional ?? true;
    const MIN_NOTIONAL = 5.0;
    const MIN_NOTIONAL_SCALED = 5.01;

    let currentNotional = qty * entryPrice;
    let isNominalOvershoot = false;

    if (autoScale) {
      if (currentNotional < MIN_NOTIONAL_SCALED) {
         // RISK-HARDENING: Implement a 3x risk overshoot ceiling for auto-scaling.
         // Prevents tiny accounts with tight stops from being exposed to massive unplanned drawdown.
         const scaledQty = roundEight(MIN_NOTIONAL_SCALED / entryPrice);
         const scaledRisk = Math.abs(entryPrice - slPrice) * scaledQty;

         const overshootRatio = scaledRisk / riskAmount;
         const MAX_OVERSHOOT = 3.0;

         if (overshootRatio > MAX_OVERSHOOT) {
            const reason = `Min notional $${MIN_NOTIONAL_SCALED} forces ${overshootRatio.toFixed(1)}x risk overshoot (Max ${MAX_OVERSHOOT}x).`;
            this.logger.warn(`[RiskEngine] ${symbol || 'Trade'} setup rejected: ${reason}`);
            return { qty: 0, rejected: true, reason };
         }

         this.logger.debug(`[RiskEngine] Scaled qty up to meet MIN_NOTIONAL (${Number(currentNotional || 0).toFixed(2)} -> ${MIN_NOTIONAL_SCALED})`);
         qty = scaledQty;
         isNominalOvershoot = true;
      }
    } else {
       // SRE: Risk Hardening Logic (User Requirement 2)
       // This is only enabled when auto-scaling is DISABLED.
       const hardeningEnabled = config.risk_hardening_enabled ?? false;
       if (hardeningEnabled) {
          const maxRiskPct = config.max_single_trade_risk_pct ?? 20.0;
          const currentRiskPct = (qty * Math.abs(entryPrice - slPrice) / balance) * 100;

          if (currentRiskPct > maxRiskPct) {
             const reason = `Setup forces ${currentRiskPct.toFixed(1)}% account risk (Max ${maxRiskPct}% via Hardening). Account too small for setup.`;
             this.logger.warn(`[RiskEngine] ${symbol || 'Trade'} setup rejected: ${reason}`);
             return { qty: 0, rejected: true, reason };
          }
       }

       if (currentNotional < MIN_NOTIONAL) {
          const reason = `Trade notional ${Number(currentNotional || 0).toFixed(2)} is below minimum ${MIN_NOTIONAL} USDT.`;
          this.logger.warn(`[RiskEngine] Trade setup discarded: ${reason}`);
          return { qty: 0, rejected: true, reason };
       }
    }

    return { qty, isNominalOvershoot };
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
