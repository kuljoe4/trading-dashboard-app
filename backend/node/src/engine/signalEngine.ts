import { Injectable, Logger } from '@nestjs/common';
import { KlineStoreService } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';
import { roundTo } from '../lib/math';

interface SignalDetail {
  fired: boolean;
  value: number;
  threshold: number;
  unit: string;
  metric: string;
  description: string;
  insufficientData?: boolean;
}

@Injectable()
export class SignalEngineService {
  private readonly logger = new Logger(SignalEngineService.name);
  private readonly warningCache: Set<string> = new Set();
  private readonly warmupCache = new WeakMap<SessionConfig, number>();
  private readonly emaCache = new Map<string, { value: number; insufficientData: boolean }>();
  private readonly emaDualCache = new Map<string, { values: [number, number]; insufficientData: boolean }>();

  // BOLT OPTIMIZATION: Stable caches for completed candles to allow O(1) incremental updates
  private readonly emaStableCache = new Map<string, { time: number; value: number; count: number }>();

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string, side?: 'LONG' | 'SHORT', purpose?: 'entry' | 'exit') => boolean | SignalDetail
  > = {
    momentum_pct: this.momentumPctSignal.bind(this),
    breakback_hl: this.breakoutHlSignal.bind(this), // Typo in existing code? It's breakout_hl
    breakout_hl: this.breakoutHlSignal.bind(this),
    engulfing: this.engulfingSignal.bind(this),
    ma: this.maSignal.bind(this),
    ema: this.emaSignal.bind(this),
    ema_cross: this.emaSignal.bind(this),
    ema_price_cross: this.emaSignal.bind(this),
    ema_dual_cross: this.emaDualCrossSignal.bind(this),
    ema_close: this.emaCloseSignal.bind(this),
  };

  constructor(private readonly klineStore: KlineStoreService) {}

  getRequiredWarmup(config: SessionConfig): number {
    if (!config.enabled_signals || config.enabled_signals.length === 0) return 0;

    const cached = this.warmupCache.get(config);
    if (cached !== undefined) return cached;

    let maxReq = 0;
    const params: any = config.signal_params || {};

    for (const signalType of config.enabled_signals) {
      if (signalType === 'momentum_pct') {
        maxReq = Math.max(maxReq, (config.scan_lookback || 3) + 1);
      } else if (signalType === 'breakout_hl') {
        maxReq = Math.max(maxReq, (config.scan_lookback || 3) + 1);
      } else if (signalType === 'ma') {
        const period = parseInt(params.ma_period || '20', 10);
        maxReq = Math.max(maxReq, period + 1);
      } else if (signalType === 'ema' || signalType === 'ema_cross' || signalType === 'ema_price_cross' || signalType === 'ema_close') {
        const period = parseInt(params.entry_ema_period || params.ema_period || '12', 10);
        maxReq = Math.max(maxReq, period * 2);
      } else if (signalType === 'ema_dual_cross') {
        const fast = parseInt(params.entry_ema_fast || '9', 10);
        const slow = parseInt(params.entry_ema_slow || '21', 10);
        maxReq = Math.max(maxReq, Math.max(fast, slow) * 2);
      } else if (signalType === 'engulfing') {
        maxReq = Math.max(maxReq, 2);
      }
    }

    // Also consider exit signals if applicable, but usually warmup is for entry scanning
    if (config.exit_signals) {
      for (const signalType of config.exit_signals) {
        if (signalType === 'ema_close') {
          const period = parseInt(params.exit_ema_period || params.ema_period || '12', 10);
          maxReq = Math.max(maxReq, period * 2);
        } else if (signalType === 'ema_dual_cross') {
          const fast = parseInt(params.exit_ema_fast || '9', 10);
          const slow = parseInt(params.exit_ema_slow || '21', 10);
          maxReq = Math.max(maxReq, Math.max(fast, slow) * 2);
        }
      }
    }

    this.warmupCache.set(config, maxReq);
    return maxReq;
  }

  checkEntry(
    symbol: string,
    config: SessionConfig,
    interval: string = '1m',
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
    minimal: boolean = false,
  ): { allFired: boolean; firedSignals: string[]; reason: string; details?: Record<string, SignalDetail> } {
    if (!config.enabled_signals || config.enabled_signals.length === 0) {
      return {
        allFired: false,
        firedSignals: [],
        reason: 'No signals enabled',
      };
    }

    const firedSignals: string[] = [];
    const failedSignals: string[] = [];
    const details: Record<string, SignalDetail> = {};
    const logic = config.signal_logic || 'all';

    // Warm-up check for technical indicators
    if (purpose === 'entry') {
      const requiredWarmup = this.getRequiredWarmup(config);
      const candles = this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < requiredWarmup) {
        return {
          allFired: false,
          firedSignals: [],
          reason: `Indicator warm-up in progress (${candles.length}/${requiredWarmup} candles)`,
          details: {
            warmup: {
              fired: false,
              value: candles.length,
              threshold: requiredWarmup,
              unit: 'candles',
              metric: 'Warmup',
              description: 'Waiting for mathematical convergence',
              insufficientData: true,
            }
          }
        };
      }
    }

    for (const signalType of config.enabled_signals) {
      const handler = this.signalHandlers[signalType];
      if (!handler) {
        failedSignals.push(signalType);
        if (minimal && logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
        continue;
      }

      try {
        const result = handler(symbol, config, interval, side, purpose);
        const fired = typeof result === 'boolean' ? result : result.fired;
        
        if (!minimal && typeof result !== 'boolean') {
          details[signalType] = result;
        }

        if (fired) {
          firedSignals.push(signalType);
          if (minimal && logic === 'any') return { allFired: true, firedSignals: [], reason: 'minimal' };
        } else {
          failedSignals.push(signalType);
          if (minimal && logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
        }
      } catch (error) {
        this.logger.warn(`Signal ${signalType} error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
        failedSignals.push(signalType);
        if (minimal && logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
      }
    }

    const allFired = logic === 'any'
      ? firedSignals.length > 0
      : failedSignals.length === 0;

    if (minimal) return { allFired, firedSignals: [], reason: 'minimal' };

    const reason =
      `Signals fired: ${firedSignals.length}/${config.enabled_signals.length}` +
      (firedSignals.length > 0 ? ` (${firedSignals.join(', ')})` : '') +
      (failedSignals.length > 0 ? `; Failed: ${failedSignals.join(', ')}` : '');

    return { allFired, firedSignals, reason, details };
  }

  private momentumPctSignal(
    symbol: string,
    config: SessionConfig,
    interval: string,
  ): SignalDetail {
    const lookback = Math.max(config.scan_lookback || 3, 1);
    const candles = this.klineStore.getRawCandles(symbol, interval);
    const threshold = config.scan_pct_threshold || 0;
    
    if (candles.length < lookback + 1) {
      return {
        fired: false,
        value: 0,
        threshold,
        unit: '%',
        metric: 'Momentum',
        description: 'Insufficient candle data',
        insufficientData: true,
      };
    }

    const first = candles[candles.length - 1 - lookback].close;
    const last = candles[candles.length - 1].close;
    const pct = ((last - first) / first) * 100;
    const fired = Math.abs(pct) >= threshold;
    
    return {
      fired,
      value: roundTo(pct, 2),
      threshold,
      unit: '%',
      metric: 'Momentum',
      description: `Price moved ${pct.toFixed(2)}% over ${lookback} periods`,
    };
  }

  private breakoutHlSignal(
    symbol: string,
    config: SessionConfig,
    interval: string,
  ): SignalDetail {
    const lookback = Math.max(config.scan_lookback || 3, 2);
    const candles = this.klineStore.getRawCandles(symbol, interval);
    
    if (candles.length < lookback + 1) {
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: 'price',
        metric: 'Breakout',
        description: 'Insufficient candle data',
        insufficientData: true,
      };
    }

    const current = candles[candles.length - 1];

    let maxHigh = -Infinity;
    let minLow = Infinity;
    const startIdx = Math.max(0, candles.length - lookback - 1);
    for (let i = startIdx; i < candles.length - 1; i++) {
      if (candles[i].high > maxHigh) maxHigh = candles[i].high;
      if (candles[i].low < minLow) minLow = candles[i].low;
    }

    const fired = current.close > maxHigh || current.close < minLow;
    const value = current.close > maxHigh ? current.close - maxHigh : minLow - current.close;

    return {
      fired,
      value: roundTo(value, 2),
      threshold: 0,
      unit: 'dist',
      metric: 'Breakout',
      description: fired 
        ? `Price broke ${current.close > maxHigh ? 'HIGH' : 'LOW'} of ${lookback} periods`
        : `Price within ${lookback} period range (${minLow.toFixed(2)} - ${maxHigh.toFixed(2)})`,
    };
  }

  private engulfingSignal(
    symbol: string,
    config: any,
    interval: string,
  ): SignalDetail {
    try {
      const candles = this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < 2) {
        return { fired: false, value: 0, threshold: 0, unit: 'bool', metric: 'Engulfing', description: 'Insufficient data', insufficientData: true };
      }

      const prevCandle = candles[candles.length - 2];
      const currCandle = candles[candles.length - 1];
      const fired = currCandle.high > prevCandle.high && currCandle.low < prevCandle.low;
      
      return {
        fired,
        value: fired ? 1 : 0,
        threshold: 1,
        unit: 'bool',
        metric: 'Engulfing',
        description: fired ? 'Engulfing pattern detected' : 'No engulfing pattern',
      };
    } catch (error) {
      this.logger.debug(`Engulfing signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: 0, threshold: 0, unit: 'error', metric: 'Engulfing', description: 'Signal error' };
    }
  }

  private maSignal(
    symbol: string,
    config: any,
    interval: string,
  ): SignalDetail {
    try {
      const period = parseInt(config.signal_params?.ma_period || '20', 10);
      const candles = this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < period + 1) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'MA Cross', description: 'Insufficient data', insufficientData: true };
      }

      const ma = this.calculateSMA(candles, candles.length - period - 1, candles.length - 1);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;
      const diff = currClose - ma;
      const prevDiff = prevClose - ma;
      const fired = (prevDiff <= 0 && diff > 0) || (prevDiff >= 0 && diff < 0);
      
      return {
        fired,
        value: roundTo(currClose, 2),
        threshold: roundTo(ma, 2),
        unit: 'price',
        metric: 'MA Cross',
        description: `Price crossed MA(${period})`,
      };
    } catch (error) {
      this.logger.debug(`MA signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: 0, threshold: 0, unit: 'error', metric: 'MA Cross', description: 'Signal error' };
    }
  }

  private emaSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): SignalDetail {
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

      const candles = this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < period + 1) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'EMA Cross', description: 'Insufficient data', insufficientData: true };
      }

      const emaRes = this.calculateEMA(candles, period, interval, symbol, `EMA(${period})`);
      const ema = emaRes.value;
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;

      let fired = false;
      if (purpose === 'entry') {
        if (side === 'LONG') fired = prevClose <= ema && currClose > ema;
        else if (side === 'SHORT') fired = prevClose >= ema && currClose < ema;
        else fired = (prevClose <= ema && currClose > ema) || (prevClose >= ema && currClose < ema);
      } else {
        if (side === 'LONG') fired = prevClose >= ema && currClose < ema;
        else if (side === 'SHORT') fired = prevClose <= ema && currClose > ema;
        else fired = false;
      }

      return {
        fired,
        value: roundTo(currClose, 2),
        threshold: roundTo(ema, 2),
        insufficientData: emaRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Cross' : 'Entry EMA Cross',
        description: `Price crossed EMA(${period})`,
      };
    } catch (error) {
      this.logger.debug(`EMA signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: 0, threshold: 0, unit: 'error', metric: 'EMA Cross', description: 'Signal error' };
    }
  }

  private emaDualCrossSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): SignalDetail {
    try {
      const params = config.signal_params || {};
      const fastPeriod = purpose === 'exit'
        ? parseInt(params.exit_ema_fast || '9', 10)
        : parseInt(params.entry_ema_fast || '9', 10);
      const slowPeriod = purpose === 'exit'
        ? parseInt(params.exit_ema_slow || '21', 10)
        : parseInt(params.entry_ema_slow || '21', 10);

      const maxPeriod = Math.max(fastPeriod, slowPeriod);
      const candles = this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < maxPeriod + 1) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'EMA Dual', description: 'Insufficient data', insufficientData: true };
      }

      const fastRes = this.calculateEMALastTwo(candles, fastPeriod, interval, symbol);
      const slowRes = this.calculateEMALastTwo(candles, slowPeriod, interval, symbol);

      if (!fastRes || !slowRes) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'EMA Dual', description: 'Insufficient EMA data', insufficientData: true };
      }

      const [prevFast, currFast] = fastRes.values;
      const [prevSlow, currSlow] = slowRes.values;

      let fired = false;
      if (purpose === 'entry') {
        if (side === 'LONG') fired = prevFast <= prevSlow && currFast > currSlow;
        else if (side === 'SHORT') fired = prevFast >= prevSlow && currFast < currSlow;
        else fired = (prevFast <= prevSlow && currFast > currSlow) || (prevFast >= prevSlow && currFast < currSlow);
      } else {
        if (side === 'LONG') fired = prevFast >= prevSlow && currFast < currSlow;
        else if (side === 'SHORT') fired = prevFast <= prevSlow && currFast > currSlow;
        else fired = false;
      }

      return {
        fired,
        value: roundTo(currFast, 2),
        threshold: roundTo(currSlow, 2),
        insufficientData: fastRes.insufficientData || slowRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Dual' : 'Entry EMA Dual',
        description: `EMA(${fastPeriod}) crossed EMA(${slowPeriod})`,
      };
    } catch (error) {
      this.logger.debug(`EMA Dual Cross signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: 0, threshold: 0, unit: 'error', metric: 'EMA Dual', description: 'Signal error' };
    }
  }

  private emaCloseSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): SignalDetail {
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

      const candles = this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < period + 1) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: 'price',
          metric: 'EMA Close',
          description: 'Insufficient candle data',
          insufficientData: true,
        };
      }

      const emaRes = this.calculateEMA(candles, period, interval, symbol, `EMA Close(${period})`);
      const ema = emaRes.value;
      const currClose = candles[candles.length - 1].close;

      let fired = false;
      if (purpose === 'entry') {
        if (side === 'LONG') fired = currClose > ema;
        else if (side === 'SHORT') fired = currClose < ema;
        else fired = true;
      } else {
        if (side === 'LONG') fired = currClose < ema;
        else if (side === 'SHORT') fired = currClose > ema;
        else fired = false;
      }

      return {
        fired,
        value: roundTo(currClose, 2),
        threshold: roundTo(ema, 2),
        insufficientData: emaRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Close' : 'Entry EMA Close',
        description: `Price ${fired ? 'crossed' : 'is outside'} EMA(${period})`,
      };
    } catch (error) {
      this.logger.debug(`EMA Close signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: 'error',
        metric: 'EMA Close',
        description: 'Signal error',
      };
    }
  }

  /**
   * BOLT OPTIMIZATION: Returns only the last two EMA values [previous, current]
   * to avoid large array allocations in the hot scanner path.
   * Uses the full available candle history for maximum convergence.
   * Refactored to use stable cache for O(1) incremental updates.
   */
  private calculateEMALastTwo(candles: any[], period: number, interval: string, symbol?: string): { values: [number, number]; insufficientData: boolean } | null {
    const len = candles.length;
    const minNeeded = period + 1;
    if (len < minNeeded) return null;

    const lastCandle = candles[len - 1];
    const cacheKey = symbol ? `${symbol}:${interval}:${period}:${lastCandle.time}:${lastCandle.close}:${len}` : null;
    if (cacheKey) {
      const cached = this.emaDualCache.get(cacheKey);
      if (cached) return cached;
    }

    const insufficientData = len < period * 2;
    if (insufficientData && symbol) {
      const warningKey = `${symbol}:EMA:${period}`;
      if (!this.warningCache.has(warningKey)) {
        this.logger.warn(`[Convergence] ${symbol}: Sub-optimal data for EMA(${period}). Available: ${len}, Recommended: ${period * 2}.`);
        this.warningCache.add(warningKey);
      }
    }

    const multiplier = 2 / (period + 1);
    let prevEma = 0;
    let ema = 0;

    // BOLT OPTIMIZATION: Try O(1) incremental path using stable prefix
    const stableKey = symbol ? `${symbol}:${interval}:${period}` : null;
    const prevCandle = candles[len - 2];
    const stable = stableKey ? this.emaStableCache.get(stableKey) : null;

    if (stable && stable.time === prevCandle.time && stable.count === len - 1) {
      prevEma = stable.value;
      ema = prevEma + multiplier * (lastCandle.close - prevEma);
    } else {
      // Full Scan (O(N))
      ema = this.calculateSMA(candles, 0, period);
      for (let i = period; i < len - 1; i++) {
        prevEma = ema;
        ema += multiplier * (candles[i].close - ema);
      }

      // Update stable cache for the completed candles
      if (stableKey) {
        this.emaStableCache.set(stableKey, {
          time: prevCandle.time,
          value: ema,
          count: len - 1,
        });
      }

      // One more step for the live candle
      prevEma = ema;
      ema += multiplier * (lastCandle.close - ema);
    }

    if (Number.isNaN(prevEma)) return null;
    const result: { values: [number, number]; insufficientData: boolean } = { values: [prevEma, ema], insufficientData };
    if (cacheKey) {
      this.emaDualCache.set(cacheKey, result);
      if (this.emaDualCache.size > 500) {
        const firstKey = this.emaDualCache.keys().next().value;
        if (firstKey) this.emaDualCache.delete(firstKey);
      }
    }
    return result;
  }

  private calculateSMA(candles: any[], start: number, end: number): number {
    const count = end - start;
    if (count <= 0) return 0;

    let sum = 0;
    for (let i = start; i < end; i++) {
      sum += candles[i].close;
    }
    return sum / count;
  }

  /**
   * Calculates EMA using the full available candle history for maximum convergence.
   * BOLT OPTIMIZATION: Uses stable cache to provide O(1) incremental updates for the live candle.
   */
  private calculateEMA(candles: any[], period: number, interval: string, symbol?: string, metric?: string): { value: number; insufficientData: boolean } {
    const len = candles.length;
    if (len === 0) return { value: 0, insufficientData: true };

    const minNeeded = period + 1;
    const lastCandle = candles[len - 1];
    const cacheKey = symbol ? `${symbol}:${interval}:${period}:${lastCandle.time}:${lastCandle.close}:${len}` : null;
    if (cacheKey) {
      const cached = this.emaCache.get(cacheKey);
      if (cached) return cached;
    }

    const insufficientData = len < period * 2;
    if (insufficientData && symbol) {
      const warningKey = `${symbol}:${metric || 'EMA'}:${period}`;
      if (!this.warningCache.has(warningKey)) {
        this.logger.warn(`[Convergence] ${symbol}: Sub-optimal data for ${metric || 'EMA'}(${period}). Available: ${len}, Recommended: ${period * 2}.`);
        this.warningCache.add(warningKey);
      }
    }

    // For absolute minimum histories (less than period + 1), just use SMA
    if (len < minNeeded) {
      const res = { value: this.calculateSMA(candles, 0, len), insufficientData: true };
      if (cacheKey) this.emaCache.set(cacheKey, res);
      return res;
    }

    const multiplier = 2 / (period + 1);
    let ema = 0;

    // BOLT OPTIMIZATION: Try O(1) incremental path using stable prefix from last closed candle
    const stableKey = symbol ? `${symbol}:${interval}:${period}` : null;
    const prevCandle = candles[len - 2];
    const stable = stableKey ? this.emaStableCache.get(stableKey) : null;

    if (stable && stable.time === prevCandle.time && stable.count === len - 1) {
      // Incremental Update (O(1))
      ema = stable.value + multiplier * (lastCandle.close - stable.value);
    } else {
      // Full Scan (O(N))
      ema = this.calculateSMA(candles, 0, period);
      for (let i = period; i < len - 1; i++) {
        ema += multiplier * (candles[i].close - ema);
      }

      // Populate stable cache with the EMA of all COMPLETED candles (up to len - 1)
      if (stableKey) {
        this.emaStableCache.set(stableKey, {
          time: prevCandle.time,
          value: ema,
          count: len - 1,
        });
      }

      // Final step: Include the current live candle
      ema += multiplier * (lastCandle.close - ema);
    }

    const result = { value: ema, insufficientData };
    if (cacheKey) {
      this.emaCache.set(cacheKey, result);
      if (this.emaCache.size > 500) {
        const firstKey = this.emaCache.keys().next().value;
        if (firstKey) this.emaCache.delete(firstKey);
      }
    }
    return result;
  }
}
