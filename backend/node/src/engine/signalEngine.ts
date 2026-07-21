import { Injectable, Logger } from '@nestjs/common';
import { KlineStoreService, Candle } from './kline_store.service';
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
  threshold_is_price?: boolean;
  pattern_low?: number;
  pattern_high?: number;
  body_low?: number;
  body_high?: number;
  streak_start?: number;
  streak_end?: number;
  streak_start_ts?: number;
  streak_end_ts?: number;
  slPrice?: number;
}

@Injectable()
export class SignalEngineService {
  private readonly logger = new Logger(SignalEngineService.name);
  private readonly warningCache: Set<string> = new Set();
  private readonly warmupCache = new WeakMap<SessionConfig, number>();
  private readonly emaCache = new Map<string, { value: number; insufficientData: boolean }>();
  private readonly emaDualCache = new Map<string, { values: [number, number]; insufficientData: boolean }>();

  // BOLT OPTIMIZATION: Cache for EMA multipliers to avoid redundant divisions
  private readonly multiplierCache = new Map<number, number>();

  // BOLT OPTIMIZATION: Stable caches for completed candles to allow O(1) incremental updates
  private readonly emaStableCache = new Map<string, { time: number; value: number; count: number }>();
  private readonly smaStableCache = new Map<string, { time: number; value: number; count: number }>();

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string, side?: 'LONG' | 'SHORT', purpose?: 'entry' | 'exit', candles?: Candle[], minimal?: boolean) => boolean | SignalDetail
  > = {
    momentum_pct: this.momentumPctSignal.bind(this),
    breakout_hl: this.breakoutHlSignal.bind(this),
    engulfing: this.engulfingSignal.bind(this),
    ma: this.maSignal.bind(this),
    ema: this.emaSignal.bind(this),
    ema_cross: this.emaSignal.bind(this),
    ema_price_cross: this.emaSignal.bind(this),
    ema_dual_cross: this.emaDualCrossSignal.bind(this),
    ema_close: this.emaCloseSignal.bind(this),
    ema_dual_close: this.emaDualCloseSignal.bind(this),
    macd_impulse: this.macdImpulseSignal.bind(this),
    macd_fade: this.macdFadeSignal.bind(this),
    macd_pbc: this.macdPbcSignal.bind(this),
    supertrend: this.supertrendSignal.bind(this),
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
      } else if (signalType === 'ema_dual_cross' || signalType === 'ema_dual_close') {
        const fast = parseInt(params.entry_ema_fast || '9', 10);
        const slow = parseInt(params.entry_ema_slow || '21', 10);
        maxReq = Math.max(maxReq, Math.max(fast, slow) * 2);
      } else if (signalType === 'engulfing') {
        const lookback = parseInt(params.engulfing_lookback || config.engulfing_lookback || '1', 10);
        maxReq = Math.max(maxReq, lookback + 1);
      } else if (signalType === 'macd_impulse' || signalType === 'macd_fade' || signalType === 'macd_pbc') {
        const fast = parseInt(params.macd_fast || '12', 10);
        const slow = parseInt(params.macd_slow || '26', 10);
        const signal = parseInt(params.macd_signal || '9', 10);
        const emaPeriod = parseInt(params.macd_pbc_trend_ema || '50', 10);
        maxReq = Math.max(maxReq, (Math.max(fast, slow) + signal) * 2, emaPeriod * 2);
      } else if (signalType === 'supertrend') {
        const period = parseInt(params.supertrend_period || '10', 10);
        maxReq = Math.max(maxReq, period * 5);
      }
    }

    // Also consider exit signals if applicable, but usually warmup is for entry scanning
    if (config.exit_signals) {
      for (const signalType of config.exit_signals) {
        if (signalType === 'ema_close') {
          const period = parseInt(params.exit_ema_period || params.ema_period || '12', 10);
          maxReq = Math.max(maxReq, period * 2);
        } else if (signalType === 'ema_dual_cross' || signalType === 'ema_dual_close') {
          const fast = parseInt(params.exit_ema_fast || '9', 10);
          const slow = parseInt(params.exit_ema_slow || '21', 10);
          maxReq = Math.max(maxReq, Math.max(fast, slow) * 2);
        } else if (signalType === 'macd_impulse' || signalType === 'macd_fade' || signalType === 'macd_pbc') {
          const fast = parseInt(params.macd_fast || '12', 10);
          const slow = parseInt(params.macd_slow || '26', 10);
          const signal = parseInt(params.macd_signal || '9', 10);
          const emaPeriod = parseInt(params.macd_pbc_trend_ema || '50', 10);
          maxReq = Math.max(maxReq, (Math.max(fast, slow) + signal) * 2, emaPeriod * 2);
        } else if (signalType === 'supertrend') {
          const period = parseInt(params.supertrend_period || '10', 10);
          maxReq = Math.max(maxReq, period * 5);
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
    // BOLT OPTIMIZATION: Dynamically select correct active signals depending on purpose.
    // Avoids requiring caller to clone the config object on every check.
    const activeSignals = purpose === 'exit'
      ? (config.exit_signals || [])
      : (config.enabled_signals || []);
    if (activeSignals.length === 0) {
      return {
        allFired: false,
        firedSignals: [],
        reason: purpose === 'exit' ? 'No exit signals enabled' : 'No signals enabled',
      };
    }

    const logic = purpose === 'exit' ? (config.exit_signal_logic || 'any') : (config.signal_logic || 'all');
    const candles = this.klineStore.getRawCandles(symbol, interval);

    // Warm-up check for technical indicators
    if (purpose === 'entry') {
      const requiredWarmup = this.getRequiredWarmup(config);
      if (candles.length < requiredWarmup) {
        return {
          allFired: false,
          firedSignals: [],
          reason: `Indicator warm-up in progress (${candles.length}/${requiredWarmup} candles)`,
          details: minimal ? undefined : {
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

    // BOLT OPTIMIZATION: Avoid array/object allocations when minimal mode is active
    const firedSignals: string[] = minimal ? [] : [];
    const failedSignals: string[] = minimal ? [] : [];
    const details: Record<string, SignalDetail> = minimal ? {} : {};

    for (const signalType of activeSignals) {
      // DYNAMIC SUFFIX ROUTING: Resolve base signal type for suffixed keys (e.g. ema_close_fast -> ema_close)
      let baseSignalType = signalType;
      let handler = this.signalHandlers[signalType];

      if (!handler) {
        const lastUnderscore = signalType.lastIndexOf('_');
        if (lastUnderscore > 0) {
          const potentialBase = signalType.substring(0, lastUnderscore);
          if (this.signalHandlers[potentialBase]) {
            baseSignalType = potentialBase;
            handler = this.signalHandlers[potentialBase];
          }
        }
      }

      if (!handler) {
        if (minimal) {
          if (logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
        } else {
          failedSignals.push(signalType);
        }
        continue;
      }

      try {
        const signalInterval = config.signal_timeframes?.[signalType] || interval;
        const signalCandles = (signalInterval !== interval)
          ? this.klineStore.getRawCandles(symbol, signalInterval)
          : candles;

        const result = handler(symbol, config, signalInterval, side, purpose, signalCandles, minimal);
        const fired = typeof result === 'boolean' ? result : result.fired;
        
        if (!minimal) {
          if (typeof result !== 'boolean') details[signalType] = { ...result, metric: result.metric || baseSignalType };
          if (fired) firedSignals.push(signalType);
          else failedSignals.push(signalType);
        } else {
          // Early exit if logic is satisfied
          if (fired && logic === 'any') return { allFired: true, firedSignals: [], reason: 'minimal' };
          if (!fired && logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
        }
      } catch (error) {
        this.logger.warn(`Signal ${signalType} error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
        if (minimal) {
          if (logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
        } else {
          failedSignals.push(signalType);
        }
      }
    }

    if (minimal) {
      // If we finished the loop in minimal mode:
      // - any: none fired -> false
      // - all: all fired -> true
      return { allFired: logic === 'all', firedSignals: [], reason: 'minimal' };
    }

    const allFired = logic === 'any'
      ? firedSignals.length > 0
      : failedSignals.length === 0;

    const reason =
      `Signals fired: ${firedSignals.length}/${activeSignals.length}` +
      (firedSignals.length > 0 ? ` (${firedSignals.join(', ')})` : '') +
      (failedSignals.length > 0 ? `; Failed: ${failedSignals.join(', ')}` : '');

    return { allFired, firedSignals, reason, details };
  }

  private momentumPctSignal(
    symbol: string,
    config: SessionConfig,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    const lookback = Math.max(config.scan_lookback || 3, 1);
    const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
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

    if (minimal) return fired;
    
    return {
      fired,
      value: roundTo(pct, 2),
      threshold,
      unit: '%',
      metric: 'Momentum',
      description: `Price moved ${pct.toFixed(2)}% over ${lookback} periods`,
    };
  }

  /**
   * BOLT OPTIMIZATION: Calculates Breakout HL signal using optimized KlineStore lookbacks.
   * This leverages the centralized stable cache in KlineStore for O(1) execution.
   */
  private breakoutHlSignal(
    symbol: string,
    config: SessionConfig,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    const lookback = Math.max(config.scan_lookback || 3, 2);
    const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
    
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

    // BOLT OPTIMIZATION: Use centralized KlineStore extremes which implements stable caching.
    const { minLow, maxHigh } = this.klineStore.getLookbackExtremes(symbol, interval, lookback);

    const isLong = side === 'LONG';
    const target = isLong ? minLow : maxHigh; // Target for EXIT is the opposite side of the range
    const fired = isLong ? current.close <= target : current.close >= target;

    if (minimal) return fired;

    return {
      fired,
      value: roundTo(current.close, 8),
      threshold: roundTo(target, 8),
      unit: 'price',
      metric: 'Breakout HL',
      description: fired 
        ? `Price breached ${isLong ? 'LOW' : 'HIGH'} of ${lookback} periods`
        : `Monitoring ${lookback} period ${isLong ? 'Low' : 'High'} level`,
      threshold_is_price: true,
      slPrice: roundTo(target, 8),
    };
  }

  private engulfingSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      // DIRECTION-AWARE: For exit signals, we search for the opposite pattern direction
      const evaluatedSide = (purpose === 'exit' && side)
        ? (side === 'LONG' ? 'SHORT' : 'LONG')
        : side;
      side = evaluatedSide;

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      const lookback = Math.max(config.engulfing_lookback || 1, 1);
      const streakReq = Math.min(Math.max(config.engulfing_streak || lookback, 1), lookback);
      const sequential = config.engulfing_sequential !== false;
      const mode = config.engulfing_mode || 'range';
      const volConfirm = config.engulfing_volume_confirm || false;
      const closeOnlyMode = mode === 'close_range' || mode === 'close_body';
      const softMode = mode === 'soft_range' || mode === 'soft_body';

      if (candles.length < lookback + (closeOnlyMode ? 2 : 1)) {
        return { fired: false, value: 0, threshold: 0, unit: 'bool', metric: 'Engulfing', description: closeOnlyMode ? 'Waiting for closed confirmation candle' : 'Insufficient data', insufficientData: true };
      }

      // Closed close-only modes intentionally ignore the actively forming candle.
      // The signal candle is the last completed candle, and entry happens on the next/live candle.
      const signalIdx = closeOnlyMode ? candles.length - 2 : candles.length - 1;
      const curr = candles[signalIdx];
      const searchStartIdx = Math.max(0, signalIdx - lookback);

      let foundStreakStart = -1;
      let foundStreakEnd = -1;

      // NEAREST N SEARCH: Identify the contiguous reversal cluster within search window
      if (sequential) {
        const sStart = signalIdx - streakReq;
        if (sStart >= searchStartIdx) {
          let allReverse = true;
          for (let i = sStart; i < signalIdx; i++) {
            const p = candles[i];
            const isReverse = side === 'LONG' ? p.close < p.open : p.close > p.open;
            if (!isReverse) { allReverse = false; break; }
          }
          if (allReverse) {
            foundStreakStart = sStart;
            foundStreakEnd = signalIdx;
          }
        }
      } else {
        // Search backwards from the signal candle for the nearest streak of streakReq
        for (let end = signalIdx; end >= searchStartIdx + streakReq; end--) {
          let allReverse = true;
          for (let i = end - streakReq; i < end; i++) {
            const p = candles[i];
            const isReverse = side === 'LONG' ? p.close < p.open : p.close > p.open;
            if (!isReverse) { allReverse = false; break; }
          }
          if (allReverse) {
            foundStreakStart = end - streakReq;
            foundStreakEnd = end;
            break;
          }
        }
      }

      if (foundStreakStart === -1) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: 'bool',
          metric: 'Engulfing',
          description: sequential
            ? `Previous ${streakReq} candles not ${side === 'LONG' ? 'bearish' : 'bullish'}`
            : `No ${streakReq}-candle ${side === 'LONG' ? 'bearish' : 'bullish'} streak found in last ${lookback} candles`
        };
      }

      const isBullish = curr.close > curr.open;
      const isBearish = curr.close < curr.open;

      // Calculate aggregate range and body of the FOUND streak only
      let aggregateHigh = -Infinity;
      let aggregateLow = Infinity;
      let aggregateBodyHigh = -Infinity;
      let aggregateBodyLow = Infinity;

      for (let i = foundStreakStart; i < foundStreakEnd; i++) {
        const p = candles[i];
        if (p.high > aggregateHigh) aggregateHigh = p.high;
        if (p.low < aggregateLow) aggregateLow = p.low;

        const bH = Math.max(p.open, p.close);
        const bL = Math.min(p.open, p.close);
        if (bH > aggregateBodyHigh) aggregateBodyHigh = bH;
        if (bL < aggregateBodyLow) aggregateBodyLow = bL;
      }

      const currBodyHigh = Math.max(curr.open, curr.close);
      const currBodyLow = Math.min(curr.open, curr.close);
      
      const bodyEngulfs = currBodyHigh > aggregateBodyHigh && currBodyLow < aggregateBodyLow;
      const rangeEngulfs = curr.high > aggregateHigh && curr.low < aggregateLow;

      const softRangeEngulfs = side === 'SHORT' ? curr.close < aggregateLow : curr.close > aggregateHigh;
      const softBodyEngulfs = side === 'SHORT' ? curr.close < aggregateBodyLow : curr.close > aggregateBodyHigh;

      const volumeConfirms = curr.volume > candles[signalIdx - 1].volume;

      let fired = false;
      let reason = '';
      let threshold = (mode === 'close_body' || mode === 'soft_body')
        ? (side === 'SHORT' ? aggregateBodyLow : aggregateBodyHigh)
        : (side === 'SHORT' ? aggregateLow : aggregateHigh);

      if (side === 'LONG') {
        if (!isBullish) {
          fired = false;
          reason = 'Not a bullish candle';
        } else {
          if (mode === 'body') fired = bodyEngulfs;
          else if (mode === 'range') fired = rangeEngulfs;
          else if (mode === 'strict') fired = bodyEngulfs && rangeEngulfs;
          else if (mode === 'close_range') fired = softRangeEngulfs;
          else if (mode === 'close_body') fired = softBodyEngulfs;
          else if (mode === 'soft_range') fired = softRangeEngulfs;
          else if (mode === 'soft_body') fired = softBodyEngulfs;

          if (fired && volConfirm && !volumeConfirms) {
            fired = false;
            reason = 'Insufficient volume confirmation';
          } else if (!fired) {
            reason = mode === 'body' ? 'Body did not engulf' :
                     mode === 'range' ? 'Range did not engulf' :
                     mode === 'strict' ? 'Strict engulfing failed' :
                     mode === 'close_body' || mode === 'soft_body' ? `Close did not clear prior ${streakReq}-candle body high` :
                     `Close did not clear prior ${streakReq}-candle high`;
          }
        }
      } else if (side === 'SHORT') {
        if (!isBearish) {
          fired = false;
          reason = 'Not a bearish candle';
        } else {
          if (mode === 'body') fired = bodyEngulfs;
          else if (mode === 'range') fired = rangeEngulfs;
          else if (mode === 'strict') fired = bodyEngulfs && rangeEngulfs;
          else if (mode === 'close_range') fired = softRangeEngulfs;
          else if (mode === 'close_body') fired = softBodyEngulfs;
          else if (mode === 'soft_range') fired = softRangeEngulfs;
          else if (mode === 'soft_body') fired = softBodyEngulfs;

          if (fired && volConfirm && !volumeConfirms) {
            fired = false;
            reason = 'Insufficient volume confirmation';
          } else if (!fired) {
            reason = mode === 'body' ? 'Body did not engulf' :
                     mode === 'range' ? 'Range did not engulf' :
                     mode === 'strict' ? 'Strict engulfing failed' :
                     mode === 'close_body' || mode === 'soft_body' ? `Close did not clear prior ${streakReq}-candle body low` :
                     `Close did not clear prior ${streakReq}-candle low`;
          }
        }
      } else {
        // Universal Signal check (no side provided)
        if (mode === 'body') fired = bodyEngulfs;
        else if (mode === 'range') fired = rangeEngulfs;
        else if (mode === 'close_range' || mode === 'soft_range') fired = curr.close > aggregateHigh || curr.close < aggregateLow;
        else if (mode === 'close_body' || mode === 'soft_body') fired = curr.close > aggregateBodyHigh || curr.close < aggregateBodyLow;
        else fired = bodyEngulfs && rangeEngulfs;

        if (fired && volConfirm && !volumeConfirms) fired = false;
      }

      const predictedSl = side === 'LONG' ? aggregateLow : aggregateHigh;

      if (minimal) return fired;

      return {
        fired,
        value: (closeOnlyMode || softMode) ? curr.close : (fired ? 1 : 0),
        threshold: (closeOnlyMode || softMode) ? threshold : 1,
        unit: (closeOnlyMode || softMode) ? 'price' : 'bool',
        metric: (closeOnlyMode || softMode) ? 'Close Engulf' : 'Engulfing',
        description: fired
          ? (softMode ? `Live candle broke through ${streakReq}-candle cluster` : closeOnlyMode ? `Closed candle close-engulfed ${streakReq}-candle streak` : `Engulfing pattern (${mode}) detected`)
          : (reason || 'No engulfing pattern'),
        threshold_is_price: closeOnlyMode || softMode,
        pattern_low: aggregateLow !== Infinity ? aggregateLow : undefined,
        pattern_high: aggregateHigh !== -Infinity ? aggregateHigh : undefined,
        body_low: aggregateBodyLow !== Infinity ? aggregateBodyLow : undefined,
        body_high: aggregateBodyHigh !== -Infinity ? aggregateBodyHigh : undefined,
        streak_start: foundStreakStart,
        streak_end: foundStreakEnd,
        streak_start_ts: candles[foundStreakStart]?.time,
        streak_end_ts: candles[foundStreakEnd - 1]?.time,
        slPrice: predictedSl !== Infinity && predictedSl !== -Infinity ? predictedSl : undefined,
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
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const period = parseInt(config.signal_params?.ma_period || '20', 10);
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < period + 1) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'MA Cross', description: 'Insufficient data', insufficientData: true };
      }

      const ma = this.calculateSMA(candles, candles.length - period - 1, candles.length - 1, symbol, interval, period);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;
      const diff = currClose - ma;
      const prevDiff = prevClose - ma;
      const fired = (prevDiff <= 0 && diff > 0) || (prevDiff >= 0 && diff < 0);

      if (minimal) return fired;
      
      return {
        fired,
        value: roundTo(currClose, 8),
        threshold: roundTo(ma, 8),
        unit: 'price',
        metric: 'MA Cross',
        description: `Price crossed MA(${period})`,
        threshold_is_price: true,
        slPrice: roundTo(ma, 8),
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
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
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

      if (minimal) return fired;

      return {
        fired,
        value: roundTo(currClose, 8),
        threshold: roundTo(ema, 8),
        insufficientData: emaRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Cross' : 'Entry EMA Cross',
        description: `Price crossed EMA(${period})`,
        threshold_is_price: true,
        slPrice: roundTo(ema, 8),
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
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const fastPeriod = purpose === 'exit'
        ? parseInt(params.exit_ema_fast || '9', 10)
        : parseInt(params.entry_ema_fast || '9', 10);
      const slowPeriod = purpose === 'exit'
        ? parseInt(params.exit_ema_slow || '21', 10)
        : parseInt(params.entry_ema_slow || '21', 10);

      const maxPeriod = Math.max(fastPeriod, slowPeriod);
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
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

      if (minimal) return fired;

      return {
        fired,
        value: roundTo(currFast, 8),
        threshold: roundTo(currSlow, 8),
        insufficientData: fastRes.insufficientData || slowRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Dual' : 'Entry EMA Dual',
        description: `EMA(${fastPeriod}) crossed EMA(${slowPeriod})`,
        threshold_is_price: true,
        slPrice: roundTo(currSlow, 8),
      };
    } catch (error) {
      this.logger.debug(`EMA Dual Cross signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: 0, threshold: 0, unit: 'error', metric: 'EMA Dual', description: 'Signal error' };
    }
  }

  /**
   * DATA-07: EMA Dual Close Signal.
   * "Close" variant means it strictly uses the LAST COMPLETED candle's close
   * rather than real-time price crossing. This prevents whipsaws from mid-candle fluctuations.
   */
  private emaDualCloseSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const fastPeriod = purpose === 'exit'
        ? parseInt(params.exit_ema_fast || '9', 10)
        : parseInt(params.entry_ema_fast || '9', 10);
      const slowPeriod = purpose === 'exit'
        ? parseInt(params.exit_ema_slow || '21', 10)
        : parseInt(params.entry_ema_slow || '21', 10);

      const maxPeriod = Math.max(fastPeriod, slowPeriod);
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);

      // We need at least one completed candle after warmup
      if (candles.length < maxPeriod + 2) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: 'price',
          metric: 'EMA Dual Close',
          description: 'Insufficient candle data',
          insufficientData: true,
        };
      }

      // Use the last COMPLETED candle (index len - 2)
      const completedCandleIdx = candles.length - 2;
      const completedClose = candles[completedCandleIdx].close;

      const fastRes = this.calculateEMAAt(candles, completedCandleIdx, fastPeriod, interval, symbol);
      const slowRes = this.calculateEMAAt(candles, completedCandleIdx, slowPeriod, interval, symbol);

      const fastEma = fastRes.value;
      const slowEma = slowRes.value;

      let fired = false;
      const threshold = side === 'SHORT' ? Math.min(fastEma, slowEma) : Math.max(fastEma, slowEma);

      if (purpose === 'entry') {
        if (side === 'LONG') fired = completedClose > fastEma && completedClose > slowEma;
        else if (side === 'SHORT') fired = completedClose < fastEma && completedClose < slowEma;
        else fired = true;
      } else {
        // Exit: price closed opposite of entry trend
        if (side === 'LONG') fired = completedClose < fastEma || completedClose < slowEma;
        else if (side === 'SHORT') fired = completedClose > fastEma || completedClose > slowEma;
        else fired = false;
      }

      if (minimal) return fired;

      return {
        fired,
        value: roundTo(completedClose, 8),
        threshold: roundTo(threshold, 8),
        insufficientData: fastRes.insufficientData || slowRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Dual Close' : 'Entry EMA Dual Close',
        description: `Last closed candle (${completedClose.toFixed(2)}) ${fired ? 'is' : 'not'} favorably aligned with EMA(${fastPeriod}) and EMA(${slowPeriod})`,
        threshold_is_price: true,
        slPrice: roundTo(slowEma, 8),
      };
    } catch (error) {
      this.logger.debug(`EMA Dual Close signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: 'error',
        metric: 'EMA Dual Close',
        description: 'Signal error',
      };
    }
  }

  /**
   * DATA-07: EMA Close Signal.
   * Strictly uses the LAST COMPLETED candle's close for comparison.
   */
  private emaCloseSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < period + 2) {
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

      const completedCandleIdx = candles.length - 2;
      const completedClose = candles[completedCandleIdx].close;

      const emaRes = this.calculateEMAAt(candles, completedCandleIdx, period, interval, symbol);
      const ema = emaRes.value;

      let fired = false;
      if (purpose === 'entry') {
        if (side === 'LONG') fired = completedClose > ema;
        else if (side === 'SHORT') fired = completedClose < ema;
        else fired = true;
      } else {
        if (side === 'LONG') fired = completedClose < ema;
        else if (side === 'SHORT') fired = completedClose > ema;
        else fired = false;
      }

      if (minimal) return fired;

      return {
        fired,
        value: roundTo(completedClose, 8),
        threshold: roundTo(ema, 8),
        insufficientData: emaRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Close' : 'Entry EMA Close',
        description: `Last closed candle (${completedClose.toFixed(2)}) ${fired ? 'is' : 'not'} favorably aligned with EMA(${period})`,
        threshold_is_price: true,
        slPrice: roundTo(ema, 8),
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
   * DATA-07: Returns EMA values at [index-1, index].
   * Optimized for both live and historical lookups.
   */
  private calculateEMALastTwoAt(
    candles: any[],
    index: number,
    period: number,
    interval: string,
    symbol?: string
  ): { values: [number, number]; insufficientData: boolean } | null {
    const len = index + 1;
    if (len < period + 1) return null;

    const targetCandle = candles[index];
    const cacheKey = symbol ? `${symbol}:${interval}:${period}:${targetCandle.time}:${targetCandle.close}:${len}:dual` : null;
    if (cacheKey) {
      const cached = this.emaDualCache.get(cacheKey);
      if (cached) return cached;
    }

    const insufficientData = len < period * 2;

    // BOLT OPTIMIZATION: Use cached multiplier to avoid redundant division
    let multiplier = this.multiplierCache.get(period);
    if (multiplier === undefined) {
      multiplier = 2 / (period + 1);
      this.multiplierCache.set(period, multiplier);
    }

    let prevEma = 0;
    let ema = 0;

    const isLiveUpdate = index === candles.length - 1;
    const isCompletedUpdate = index === candles.length - 2;
    const stableKey = symbol ? `${symbol}:${interval}:${period}` : null;
    const stable = (stableKey && (isLiveUpdate || isCompletedUpdate)) ? this.emaStableCache.get(stableKey) : null;

    if (isLiveUpdate && stable && stable.time === candles[index - 1].time && stable.count === index) {
      prevEma = stable.value;
      ema = prevEma + multiplier * (targetCandle.close - prevEma);
    }
    else if (isCompletedUpdate && stable && stable.time === targetCandle.time && stable.count === len) {
      // For completed candle, we need the one BEFORE it as well
      // We look for a stable cache of index-1
      const stablePrev = this.calculateEMAAt(candles, index - 1, period, interval, symbol);
      prevEma = stablePrev.value;
      ema = stable.value;
    }
    else {
      // Full Scan (O(N))
      ema = this.calculateSMA(candles, 0, period);
      for (let i = period; i < len; i++) {
        prevEma = ema;
        ema += multiplier * (candles[i].close - ema);
      }

      // Maintain stable cache if we just scanned up to the last completed candle
      if (stableKey && index === candles.length - 2) {
        this.emaStableCache.set(stableKey, {
          time: targetCandle.time,
          value: ema,
          count: len,
        });
      }
    }

    if (Number.isNaN(prevEma)) return null;
    const result: { values: [number, number]; insufficientData: boolean } = { values: [prevEma, ema], insufficientData };
    if (cacheKey) {
      this.emaDualCache.set(cacheKey, result);
      if (this.emaDualCache.size > 1000) {
        // BOLT OPTIMIZATION: Use direct iterator for O(1) eviction to avoid O(N) Array.from allocation
        const iter = this.emaDualCache.keys();
        for (let i = 0; i < 100; i++) {
          const next = iter.next();
          if (next.done) break;
          this.emaDualCache.delete(next.value);
        }
      }
      this.emaDualCache.set(cacheKey, result);
    }
    return result;
  }

  /**
   * BOLT OPTIMIZATION: Returns only the last two EMA values [previous, current]
   * to avoid large array allocations in the hot scanner path.
   */
  private calculateEMALastTwo(candles: any[], period: number, interval: string, symbol?: string): { values: [number, number]; insufficientData: boolean } | null {
    return this.calculateEMALastTwoAt(candles, candles.length - 1, period, interval, symbol);
  }

  /**
   * BOLT OPTIMIZATION: Calculates SMA with stable caching for completed candles.
   * This turns O(N) into O(1) for the vast majority of calls.
   */
  private calculateSMA(
    candles: any[],
    start: number,
    end: number,
    symbol?: string,
    interval?: string,
    period?: number
  ): number {
    const count = end - start;
    if (count <= 0) return 0;

    // BOLT OPTIMIZATION: Try stable cache if we are scanning up to the last completed candle
    const isCompletedUpdate = end === candles.length - 1;
    const stableKey = (symbol && interval && period && isCompletedUpdate) ? `${symbol}:${interval}:${period}` : null;
    if (stableKey) {
      const targetCandle = candles[end - 1];
      const stable = this.smaStableCache.get(stableKey);
      if (stable && stable.time === targetCandle.time && stable.count === count) {
        return stable.value;
      }
    }

    let sum = 0;
    for (let i = start; i < end; i++) {
      sum += candles[i].close;
    }
    const sma = sum / count;

    // Maintain stable cache if it's the last completed candle
    if (stableKey) {
      const targetCandle = candles[end - 1];
      this.smaStableCache.set(stableKey, {
        time: targetCandle.time,
        value: sma,
        count,
      });

      // Simple O(1) eviction
      if (this.smaStableCache.size > 1000) {
        const iter = this.smaStableCache.keys();
        for (let i = 0; i < 100; i++) {
          const next = iter.next();
          if (next.done) break;
          this.smaStableCache.delete(next.value);
        }
      }
    }

    return sma;
  }

  /**
   * DATA-07: Calculates EMA at a specific index in the candle array.
   * Efficiently handles both historical lookups and incremental updates.
   */
  private calculateEMAAt(
    candles: any[],
    index: number,
    period: number,
    interval: string,
    symbol?: string,
    metric?: string
  ): { value: number; insufficientData: boolean } {
    const len = index + 1;
    if (len <= 0) return { value: 0, insufficientData: true };

    const targetCandle = candles[index];
    const cacheKey = symbol ? `${symbol}:${interval}:${period}:${targetCandle.time}:${targetCandle.close}:${len}` : null;
    if (cacheKey) {
      const cached = this.emaCache.get(cacheKey);
      if (cached) return cached;
    }

    const insufficientData = len < period * 2;
    const minNeeded = period + 1;

    // For absolute minimum histories, just use SMA
    if (len < minNeeded) {
      const res = { value: this.calculateSMA(candles, 0, len), insufficientData: true };
      if (cacheKey) {
        if (this.emaCache.size >= 1000 && !this.emaCache.has(cacheKey)) {
          const iter = this.emaCache.keys();
          for (let i = 0; i < 100; i++) {
            const key = iter.next().value;
            if (key !== undefined) this.emaCache.delete(key);
          }
        }
        this.emaCache.set(cacheKey, res);
      }
      return res;
    }

    // BOLT OPTIMIZATION: Use cached multiplier to avoid redundant division
    let multiplier = this.multiplierCache.get(period);
    if (multiplier === undefined) {
      multiplier = 2 / (period + 1);
      this.multiplierCache.set(period, multiplier);
    }

    let ema = 0;

    // BOLT OPTIMIZATION: Try incremental path for the most common case (last or second-to-last candle)
    const isLiveUpdate = index === candles.length - 1;
    const isCompletedUpdate = index === candles.length - 2;
    const stableKey = symbol ? `${symbol}:${interval}:${period}` : null;
    const stable = (stableKey && (isLiveUpdate || isCompletedUpdate)) ? this.emaStableCache.get(stableKey) : null;

    // Case 1: Calculating for the live candle using the stable prefix
    if (isLiveUpdate && stable && stable.time === candles[index - 1].time && stable.count === index) {
      ema = stable.value + multiplier * (targetCandle.close - stable.value);
    }
    // Case 2: Calculating for the last completed candle (it IS the stable prefix)
    else if (isCompletedUpdate && stable && stable.time === targetCandle.time && stable.count === len) {
      ema = stable.value;
    }
    else {
      // Full Scan (O(N))
      ema = this.calculateSMA(candles, 0, period);
      for (let i = period; i < len; i++) {
        ema += multiplier * (candles[i].close - ema);
      }

      // Maintain stable cache if we just scanned up to the last completed candle
      if (stableKey && index === candles.length - 2) {
        this.emaStableCache.set(stableKey, {
          time: targetCandle.time,
          value: ema,
          count: len,
        });
      }
    }

    const result = { value: ema, insufficientData };
    if (cacheKey) {
      this.emaCache.set(cacheKey, result);
      if (this.emaCache.size > 1000) {
        // BOLT OPTIMIZATION: Use direct iterator for O(1) eviction to avoid O(N) Array.from allocation
        const iter = this.emaCache.keys();
        for (let i = 0; i < 100; i++) {
          const next = iter.next();
          if (next.done) break;
          this.emaCache.delete(next.value);
        }
      }
      this.emaCache.set(cacheKey, result);
    }
    return result;
  }

  /**
   * Calculates EMA using the full available candle history for maximum convergence.
   * BOLT OPTIMIZATION: Uses stable cache to provide O(1) incremental updates for the live candle.
   */
  private calculateEMA(candles: any[], period: number, interval: string, symbol?: string, metric?: string): { value: number; insufficientData: boolean } {
    return this.calculateEMAAt(candles, candles.length - 1, period, interval, symbol, metric);
  }

  /**
   * Calculates MACD values (MACD Line, Signal Line, and Histogram) matching standard mathematical definitions.
   * Designed with O(1) loop structures and no external library allocations.
   */
  public calculateMACD(
    candles: Candle[],
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
  ): { macdLine: number[]; signalLine: number[]; histogram: number[]; insufficientData: boolean } {
    const len = candles.length;
    const minNeeded = Math.max(fastPeriod, slowPeriod) + signalPeriod;
    const insufficientData = len < minNeeded * 2;

    const macdLine = new Array<number>(len).fill(0);
    const signalLine = new Array<number>(len).fill(0);
    const histogram = new Array<number>(len).fill(0);

    if (len < minNeeded) {
      return { macdLine, signalLine, histogram, insufficientData: true };
    }

    const fastMult = 2 / (fastPeriod + 1);
    const slowMult = 2 / (slowPeriod + 1);
    const signalMult = 2 / (signalPeriod + 1);

    // Initial SMA for fast and slow EMAs
    let fastEma = 0;
    let slowEma = 0;

    let fastSum = 0;
    for (let i = 0; i < fastPeriod; i++) fastSum += candles[i].close;
    fastEma = fastSum / fastPeriod;

    let slowSum = 0;
    for (let i = 0; i < slowPeriod; i++) slowSum += candles[i].close;
    slowEma = slowSum / slowPeriod;

    for (let i = 0; i < len; i++) {
      if (i >= fastPeriod) {
        fastEma += fastMult * (candles[i].close - fastEma);
      } else if (i === fastPeriod - 1) {
        fastEma = fastSum / fastPeriod;
      }

      if (i >= slowPeriod) {
        slowEma += slowMult * (candles[i].close - slowEma);
      } else if (i === slowPeriod - 1) {
        slowEma = slowSum / slowPeriod;
      }

      macdLine[i] = fastEma - slowEma;
    }

    // Now, calculate Signal EMA of MACD Line.
    // The MACD line is fully mature starting from slowPeriod - 1.
    const startIdx = slowPeriod - 1;
    let signalSum = 0;
    for (let i = startIdx; i < startIdx + signalPeriod; i++) {
      signalSum += macdLine[i];
    }
    let signalEma = signalSum / signalPeriod;

    for (let i = 0; i < len; i++) {
      if (i < startIdx + signalPeriod - 1) {
        signalLine[i] = 0;
        histogram[i] = 0;
      } else if (i === startIdx + signalPeriod - 1) {
        signalLine[i] = signalEma;
        histogram[i] = macdLine[i] - signalEma;
      } else {
        signalEma += signalMult * (macdLine[i] - signalEma);
        signalLine[i] = signalEma;
        histogram[i] = macdLine[i] - signalEma;
      }
    }

    return { macdLine, signalLine, histogram, insufficientData };
  }

  /**
   * Premium MACD Impulse Signal. Matches Phase 4 of the institutional momentum pullback strategy.
   * Enforces exact sequence color counts and optional strict expanding checks.
   */
  private macdImpulseSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const fastPeriod = parseInt(params.macd_fast || '12', 10);
      const slowPeriod = parseInt(params.macd_slow || '26', 10);
      const signalPeriod = parseInt(params.macd_signal || '9', 10);
      const strictExpansion = params.macd_strict_expansion === true || params.macd_strict_expansion === 'true';

      const maxPeriod = Math.max(fastPeriod, slowPeriod) + signalPeriod;
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);

      if (candles.length < maxPeriod + 5) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: '',
          metric: 'MACD Impulse',
          description: 'Insufficient candle data',
          insufficientData: true,
        };
      }

      const { histogram, insufficientData } = this.calculateMACD(
        candles,
        fastPeriod,
        slowPeriod,
        signalPeriod,
      );

      if (histogram.length < 5) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: '',
          metric: 'MACD Impulse',
          description: 'No histogram generated',
          insufficientData: true,
        };
      }

      const currHist = histogram[histogram.length - 1];

      let fired = false;
      let count = 0;
      let description = '';

      if (side === 'LONG') {
        if (currHist <= 0) {
          return {
            fired: false,
            value: 0,
            threshold: 1,
            unit: 'bars',
            metric: 'MACD Impulse',
            description: `Histogram is not bullish (Green) | Value: ${roundTo(currHist, 8)}`,
          };
        }

        // Count consecutive green bars backward
        let idx = histogram.length - 1;
        while (idx >= 0 && histogram[idx] > 0) {
          count++;
          idx--;
        }

        if (count === 1 || count === 2) {
          fired = true;
          description = `MACD Impulse Green #${count}`;

          if (strictExpansion) {
            if (count === 1) {
              const prevRed = idx >= 0 ? histogram[idx] : 0;
              if (currHist <= Math.abs(prevRed)) {
                fired = false;
                description = `Rejected: Green #1 (${roundTo(currHist, 8)}) is not strictly expanding over previous Red (${roundTo(prevRed, 8)})`;
              }
            } else { // count === 2
              const prevGreen = histogram[histogram.length - 2];
              if (currHist <= prevGreen) {
                fired = false;
                description = `Rejected: Green #2 (${roundTo(currHist, 8)}) is not expanding over Green #1 (${roundTo(prevGreen, 8)})`;
              }
            }
          }
        } else {
          fired = false;
          description = `Rejected: Green bar count is ${count} (Entry Window: 1-2)`;
        }
      } else if (side === 'SHORT') {
        if (currHist >= 0) {
          return {
            fired: false,
            value: 0,
            threshold: 1,
            unit: 'bars',
            metric: 'MACD Impulse',
            description: `Histogram is not bearish (Red) | Value: ${roundTo(currHist, 8)}`,
          };
        }

        // Count consecutive red bars backward
        let idx = histogram.length - 1;
        while (idx >= 0 && histogram[idx] < 0) {
          count++;
          idx--;
        }

        if (count === 1 || count === 2) {
          fired = true;
          description = `MACD Impulse Red #${count}`;

          if (strictExpansion) {
            if (count === 1) {
              const prevGreen = idx >= 0 ? histogram[idx] : 0;
              if (Math.abs(currHist) <= Math.abs(prevGreen)) {
                fired = false;
                description = `Rejected: Red #1 (${roundTo(currHist, 8)}) is not strictly expanding over previous Green (${roundTo(prevGreen, 8)})`;
              }
            } else { // count === 2
              const prevRed = histogram[histogram.length - 2];
              if (Math.abs(currHist) <= Math.abs(prevRed)) {
                fired = false;
                description = `Rejected: Red #2 (${roundTo(currHist, 8)}) is not expanding over Red #1 (${roundTo(prevRed, 8)})`;
              }
            }
          }
        } else {
          fired = false;
          description = `Rejected: Red bar count is ${count} (Entry Window: 1-2)`;
        }
      }

      if (minimal) return fired;

      return {
        fired,
        value: count,
        threshold: 2,
        insufficientData,
        unit: 'bars',
        metric: 'MACD Impulse',
        description,
      };
    } catch (error) {
      this.logger.debug(`MACD Impulse signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 2,
        unit: 'bars',
        metric: 'MACD Impulse',
        description: 'Signal error',
      };
    }
  }

  /**
   * Premium MACD Pullback-to-Continuation (PBC) Signal.
   * Leverages a Trend EMA (e.g., 50 EMA) to filter general trend direction,
   * identifies a clear histogram pullback (color flip, contraction, or zero-line crossover),
   * and triggers entry on continuation slope confirmation (increasing green bars for long, decreasing red bars for short).
   * Also computes the pullback swing high/low dynamically to set as the exact Stop Loss (`slPrice`).
   */
  private macdPbcSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const fastPeriod = parseInt(params.macd_fast || '12', 10);
      const slowPeriod = parseInt(params.macd_slow || '26', 10);
      const signalPeriod = parseInt(params.macd_signal || '9', 10);
      const trendEmaPeriod = parseInt(params.macd_pbc_trend_ema || '50', 10);
      const lookbackWindow = parseInt(params.macd_pbc_lookback || '10', 10);

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      const minRequired = Math.max((Math.max(fastPeriod, slowPeriod) + signalPeriod) * 2, trendEmaPeriod * 2);

      if (candles.length < minRequired) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: '',
          metric: 'MACD PBC',
          description: 'Insufficient candle data',
          insufficientData: true,
        };
      }

      // 1. Calculate Trend Filter (EMA 50 / specified period)
      const currentCandle = candles[candles.length - 1];
      const emaRes = this.calculateEMA(candles, trendEmaPeriod, interval, symbol, `EMA(${trendEmaPeriod})`);
      const trendEma = emaRes.value;

      // Ensure trend direction matches requested entry side
      const isBullishTrend = currentCandle.close > trendEma;
      if (side === 'LONG' && !isBullishTrend) {
        return {
          fired: false,
          value: roundTo(currentCandle.close, 8),
          threshold: roundTo(trendEma, 8),
          unit: 'price',
          metric: 'MACD PBC',
          description: `Price (${currentCandle.close}) is below Trend EMA(${trendEmaPeriod}) (${trendEma.toFixed(4)})`,
          threshold_is_price: true,
        };
      }
      if (side === 'SHORT' && isBullishTrend) {
        return {
          fired: false,
          value: roundTo(currentCandle.close, 8),
          threshold: roundTo(trendEma, 8),
          unit: 'price',
          metric: 'MACD PBC',
          description: `Price (${currentCandle.close}) is above Trend EMA(${trendEmaPeriod}) (${trendEma.toFixed(4)})`,
          threshold_is_price: true,
        };
      }

      // 2. Calculate MACD Histogram
      const { histogram, insufficientData } = this.calculateMACD(
        candles,
        fastPeriod,
        slowPeriod,
        signalPeriod,
      );

      const hLen = histogram.length;
      const currHist = histogram[hLen - 1];
      const prevHist = histogram[hLen - 2];
      const prevPrevHist = histogram[hLen - 3];

      let fired = false;
      let description = '';
      let slPrice = 0;

      // Find Swing High / Low over pullback window
      const startScanIdx = Math.max(0, candles.length - lookbackWindow);
      let extremeVal = side === 'LONG' ? Infinity : -Infinity;
      for (let i = startScanIdx; i < candles.length; i++) {
        if (side === 'LONG') {
          if (candles[i].low < extremeVal) extremeVal = candles[i].low;
        } else {
          if (candles[i].high > extremeVal) extremeVal = candles[i].high;
        }
      }
      slPrice = extremeVal;

      if (side === 'LONG') {
        // Long entry criteria:
        // - We had a pullback (at least one previous histogram bar is less than or equal to a prior one, or histogram went below 0)
        // - Currently, histogram is positive AND expanding (current > previous)
        const hadPullback = (prevHist < prevPrevHist) || prevHist <= 0 || prevPrevHist <= 0;
        const isExpandingPositive = currHist > 0 && currHist > prevHist;

        if (isExpandingPositive && hadPullback) {
          fired = true;
          description = `MACD Pullback-to-Continuation LONG confirmed. Slope reversed: ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}. Stop-Loss armed at Swing Low: ${roundTo(slPrice, 8)}`;
        } else if (!isExpandingPositive) {
          description = `Histogram is not expanding positive: ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}`;
        } else {
          description = `No pullback detected in prior 2 bars: ${roundTo(prevPrevHist, 8)} -> ${roundTo(prevHist, 8)}`;
        }
      } else if (side === 'SHORT') {
        // Short entry criteria:
        // - We had a pullback (at least one previous histogram bar is greater than or equal to a prior one, or histogram went above 0)
        // - Currently, histogram is negative AND expanding downwards (current < previous)
        const hadPullback = (prevHist > prevPrevHist) || prevHist >= 0 || prevPrevHist >= 0;
        const isExpandingNegative = currHist < 0 && currHist < prevHist;

        if (isExpandingNegative && hadPullback) {
          fired = true;
          description = `MACD Pullback-to-Continuation SHORT confirmed. Slope reversed: ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}. Stop-Loss armed at Swing High: ${roundTo(slPrice, 8)}`;
        } else if (!isExpandingNegative) {
          description = `Histogram is not expanding negative: ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}`;
        } else {
          description = `No pullback detected in prior 2 bars: ${roundTo(prevPrevHist, 8)} -> ${roundTo(prevHist, 8)}`;
        }
      }

      if (minimal) return fired;

      return {
        fired,
        value: roundTo(currHist, 8),
        threshold: roundTo(prevHist, 8),
        insufficientData: insufficientData || emaRes.insufficientData,
        unit: 'histogram',
        metric: 'MACD PBC',
        description,
        slPrice: fired ? roundTo(slPrice, 8) : undefined,
      };
    } catch (error) {
      this.logger.debug(`MACD PBC signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: 'histogram',
        metric: 'MACD PBC',
        description: 'Signal error',
      };
    }
  }

  /**
   * Premium MACD Fade Exit Signal. Matches Phase 5 of the institutional momentum pullback strategy.
   * Detects 2 consecutive contracting histogram bars or a complete direction/color reversal.
   */
  private macdFadeSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const fastPeriod = parseInt(params.macd_fast || '12', 10);
      const slowPeriod = parseInt(params.macd_slow || '26', 10);
      const signalPeriod = parseInt(params.macd_signal || '9', 10);

      const maxPeriod = Math.max(fastPeriod, slowPeriod) + signalPeriod;
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);

      if (candles.length < maxPeriod + 5) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: '',
          metric: 'MACD Fade',
          description: 'Insufficient candle data',
          insufficientData: true,
        };
      }

      const { histogram, insufficientData } = this.calculateMACD(
        candles,
        fastPeriod,
        slowPeriod,
        signalPeriod,
      );

      if (histogram.length < 5) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: '',
          metric: 'MACD Fade',
          description: 'No histogram generated',
          insufficientData: true,
        };
      }

      const currHist = histogram[histogram.length - 1];
      const prevHist = histogram[histogram.length - 2];
      const prevPrevHist = histogram[histogram.length - 3];

      let fired = false;
      let description = '';

      if (side === 'LONG') {
        // Long position exit: green bars are contracting (decreasing) or flipped red
        if (currHist < 0) {
          fired = true;
          description = `MACD flipped bearish (Red histogram: ${roundTo(currHist, 8)})`;
        } else if (currHist < prevHist && prevHist < prevPrevHist) {
          fired = true;
          description = `MACD contracting for 2 bars: ${roundTo(prevPrevHist, 8)} -> ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}`;
        } else {
          fired = false;
          description = 'MACD momentum holding or expanding';
        }
      } else if (side === 'SHORT') {
        // Short position exit: red bars are contracting (increasing towards 0) or flipped green
        if (currHist > 0) {
          fired = true;
          description = `MACD flipped bullish (Green histogram: ${roundTo(currHist, 8)})`;
        } else if (currHist > prevHist && prevHist > prevPrevHist) {
          fired = true;
          description = `MACD contracting for 2 bars: ${roundTo(prevPrevHist, 8)} -> ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}`;
        } else {
          fired = false;
          description = 'MACD momentum holding or expanding';
        }
      }

      if (minimal) return fired;

      return {
        fired,
        value: roundTo(currHist, 8),
        threshold: roundTo(prevHist, 8),
        insufficientData,
        unit: '',
        metric: 'MACD Fade',
        description,
      };
    } catch (error) {
      this.logger.debug(`MACD Fade signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: '',
        metric: 'MACD Fade',
        description: 'Signal error',
      };
    }
  }

  /**
   * Premium Supertrend calculation matching standard mathematical definition.
   * Leverages Wilder's RMA for ATR calculation.
   * BOLT OPTIMIZATION: Removed six redundant intermediate array allocations (tr, atr, basicUpper, basicLower, finalUpper, finalLower).
   * Calculates everything on-the-fly using scalar variables in a single-pass loop.
   * This achieves zero-allocation windowing for internal arrays, significantly reducing garbage collection pressure.
   */
  public calculateSupertrend(
    candles: Candle[],
    period: number,
    multiplier: number,
  ): { supertrend: number[]; direction: ('up' | 'down')[]; insufficientData: boolean } {
    const len = candles.length;
    const insufficientData = len < period * 3;

    const supertrend = new Array<number>(len).fill(0);
    const direction = new Array<'up' | 'down'>(len).fill('up');

    if (len < period + 1) {
      return { supertrend, direction, insufficientData: true };
    }

    // 1. Calculate TR sum for the initial period to bootstrap ATR
    let trSum = candles[0].high - candles[0].low;
    for (let i = 1; i < period; i++) {
      const hL = candles[i].high - candles[i].low;
      const hC = Math.abs(candles[i].high - candles[i - 1].close);
      const lC = Math.abs(candles[i].low - candles[i - 1].close);
      trSum += Math.max(hL, hC, lC);
    }

    let prevAtr = trSum / period;

    // 2. Initialize variables for tracking final bands and supertrend
    const initHl2 = (candles[period - 1].high + candles[period - 1].low) / 2;
    let prevFinalUpper = initHl2 + multiplier * prevAtr;
    let prevFinalLower = initHl2 - multiplier * prevAtr;

    supertrend[period - 1] = prevFinalUpper;
    direction[period - 1] = 'down';

    // 3. Main single-pass loop over the remaining candles
    for (let i = period; i < len; i++) {
      // Calculate TR for index i
      const hL = candles[i].high - candles[i].low;
      const hC = Math.abs(candles[i].high - candles[i - 1].close);
      const lC = Math.abs(candles[i].low - candles[i - 1].close);
      const tr = Math.max(hL, hC, lC);

      // Calculate ATR for index i
      const atr = (prevAtr * (period - 1) + tr) / period;
      prevAtr = atr;

      // Calculate basic bands
      const hl2 = (candles[i].high + candles[i].low) / 2;
      const basicUpper = hl2 + multiplier * atr;
      const basicLower = hl2 - multiplier * atr;

      // Calculate final bands
      const prevClose = candles[i - 1].close;
      let finalUpper = 0;
      let finalLower = 0;

      if (basicUpper < prevFinalUpper || prevClose > prevFinalUpper) {
        finalUpper = basicUpper;
      } else {
        finalUpper = prevFinalUpper;
      }

      if (basicLower > prevFinalLower || prevClose < prevFinalLower) {
        finalLower = basicLower;
      } else {
        finalLower = prevFinalLower;
      }

      // Calculate Supertrend and direction
      const prevST = supertrend[i - 1];
      if (prevST === prevFinalUpper) {
        if (candles[i].close > finalUpper) {
          supertrend[i] = finalLower;
          direction[i] = 'up'; // bullish breakout
        } else {
          supertrend[i] = finalUpper;
          direction[i] = 'down';
        }
      } else { // prevST === prevFinalLower
        if (candles[i].close < finalLower) {
          supertrend[i] = finalUpper;
          direction[i] = 'down'; // bearish breakout
        } else {
          supertrend[i] = finalLower;
          direction[i] = 'up';
        }
      }

      // Update band trackers for the next iteration
      prevFinalUpper = finalUpper;
      prevFinalLower = finalLower;
    }

    return { supertrend, direction, insufficientData };
  }

  /**
   * Premium Supertrend Signal. Supports bullish/bearish crossovers and trend filtering.
   */
  private supertrendSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
    minimal?: boolean,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const period = parseInt(params.supertrend_period || '10', 10);
      const multiplier = parseFloat(params.supertrend_multiplier || '3');
      const mode = params.supertrend_mode || 'trend'; // 'trend' | 'crossover'

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);

      if (candles.length < period + 5) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: 'price',
          metric: 'Supertrend',
          description: 'Insufficient candle data',
          insufficientData: true,
        };
      }

      const { supertrend, direction, insufficientData } = this.calculateSupertrend(
        candles,
        period,
        multiplier,
      );

      const currClose = candles[candles.length - 1].close;
      const currST = supertrend[supertrend.length - 1];
      const currDir = direction[direction.length - 1];
      const prevDir = direction[direction.length - 2];

      let fired = false;
      let description = '';

      if (side === 'LONG') {
        if (mode === 'crossover') {
          fired = prevDir === 'down' && currDir === 'up';
          description = fired ? 'Supertrend crossed bullish (uptrend began)' : 'No bullish crossover';
        } else { // 'trend'
          fired = currDir === 'up';
          description = fired ? 'Supertrend is bullish' : 'Supertrend is bearish';
        }
      } else if (side === 'SHORT') {
        if (mode === 'crossover') {
          fired = prevDir === 'up' && currDir === 'down';
          description = fired ? 'Supertrend crossed bearish (downtrend began)' : 'No bearish crossover';
        } else { // 'trend'
          fired = currDir === 'down';
          description = fired ? 'Supertrend is bearish' : 'Supertrend is bullish';
        }
      }

      if (minimal) return fired;

      return {
        fired,
        value: roundTo(currClose, 8),
        threshold: roundTo(currST, 8),
        insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit Supertrend' : 'Supertrend',
        description,
        threshold_is_price: true,
        slPrice: roundTo(currST, 8),
      };
    } catch (error) {
      this.logger.debug(`Supertrend signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: 'price',
        metric: 'Supertrend',
        description: 'Signal error',
      };
    }
  }
}
