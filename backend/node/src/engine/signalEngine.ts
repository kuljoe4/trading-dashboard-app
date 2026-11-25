import { Injectable, Logger } from '@nestjs/common';
import { KlineStoreService, Candle } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';
import { roundTo } from '../lib/math';

interface SignalDetail {
  fired: boolean;
  status?: 'approaching' | 'fired' | 'blocked' | 'stale';
  rejected?: boolean;
  value: number;
  threshold: number;
  prevFast?: number;
  prevSlow?: number;
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
  mode?: string;
  expansion_pct?: number;
  max_expansion_pct?: number;
  evaluated_at_ms?: number;
  [key: string]: any;
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

  // BOLT OPTIMIZATION: WeakMap cache for resolved signal parameter lookups per signal_params object
  private readonly paramResolutionCache = new WeakMap<object, Map<string, any>>();

  // BOLT OPTIMIZATION: Stable caches for completed candles to allow O(1) incremental updates
  private readonly emaStableCache = new Map<string, { time: number; value: number; count: number }>();
  private readonly smaStableCache = new Map<string, { time: number; value: number; count: number }>();

  // BOLT OPTIMIZATION: Stable cache for MACD calculations to bypass redundant passes on same dataset
  private readonly macdCache = new Map<string, { macdLine: number[]; signalLine: number[]; histogram: number[]; insufficientData: boolean }>();

  // BOLT OPTIMIZATION: Stable cache for Supertrend calculations to bypass redundant passes on same dataset
  private readonly supertrendCache = new Map<string, { supertrend: number[]; direction: ('up' | 'down')[]; insufficientData: boolean }>();

  // BOLT OPTIMIZATION: Cache resolved base signal types and handlers to eliminate redundant string manipulation
  private readonly handlerResolutionCache = new Map<string, { baseType: string; handler: Function | null }>();

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string, side?: 'LONG' | 'SHORT', purpose?: 'entry' | 'exit', candles?: Candle[], minimal?: boolean, signalType?: string, trade?: any) => boolean | SignalDetail
  > = {
    momentum_pct: this.momentumPctSignal.bind(this),
    breakout_hl: this.breakoutHlSignal.bind(this),
    engulfing: this.engulfingSignal.bind(this),
    ma: this.maSignal.bind(this),
    ema: this.emaSignal.bind(this),
    ema_cross: this.emaSignal.bind(this),
    ema_price_cross: this.emaSignal.bind(this),
    ema_dual: this.emaDualSignal.bind(this),
    ema_dual_cross: this.emaDualCrossSignal.bind(this),
    ema_close: this.emaCloseSignal.bind(this),
    ema_dual_close: this.emaDualCloseSignal.bind(this),
    macd_impulse: this.macdImpulseSignal.bind(this),
    macd_fade: this.macdFadeSignal.bind(this),
    macd_pbc: this.macdPbcSignal.bind(this),
    supertrend: this.supertrendSignal.bind(this),
    knife_catch: this.knifeCatchSignal.bind(this),
    htf_breakout: this.htfBreakoutSignal.bind(this),
    prev_day_breakout: this.htfBreakoutSignal.bind(this),
    trigger_candle_exit: this.triggerCandleExitSignal.bind(this),
    entry_candle_boundary: this.triggerCandleExitSignal.bind(this),
  };

  constructor(private readonly klineStore: KlineStoreService) {}

  private formatAdaptiveNumber(value: number, signed = false): string {
    if (!Number.isFinite(value)) return '0';
    if (value === 0) return signed ? '+0.00' : '0.00';
    const abs = Math.abs(value);
    let decimals = 2;
    if (abs < 0.000001) decimals = 8;
    else if (abs < 0.0001) decimals = 6;
    else if (abs < 0.01) decimals = 5;
    else if (abs < 1) decimals = 4;
    else if (abs < 10) decimals = 3;
    const formatted = abs.toFixed(decimals);
    const sign = value < 0 ? '-' : (signed ? '+' : '');
    return `${sign}${formatted}`;
  }

  public resolveSignalParam(
    params: any,
    signalType: string,
    baseSignalType: string,
    paramKey: string,
    defaultValue: any
  ): any {
    if (!params || typeof params !== 'object') return defaultValue;

    let paramMap = this.paramResolutionCache.get(params);
    if (!paramMap) {
      paramMap = new Map<string, any>();
      this.paramResolutionCache.set(params, paramMap);
    }

    const cacheKey = `${signalType}:${baseSignalType}:${paramKey}:${defaultValue}`;
    if (paramMap.has(cacheKey)) {
      return paramMap.get(cacheKey);
    }

    let result: any;
    if (signalType === baseSignalType) {
      result = params[paramKey] !== undefined ? params[paramKey] : defaultValue;
    } else {
      const suffix = signalType.substring(baseSignalType.length);

      const suffixedKey = `${paramKey}${suffix}`;
      if (params[suffixedKey] !== undefined) {
        result = params[suffixedKey];
      } else if (paramKey.startsWith(baseSignalType)) {
        const replacedKey = signalType + paramKey.substring(baseSignalType.length);
        if (params[replacedKey] !== undefined) {
          result = params[replacedKey];
        } else {
          result = params[paramKey] !== undefined ? params[paramKey] : defaultValue;
        }
      } else {
        result = params[paramKey] !== undefined ? params[paramKey] : defaultValue;
      }
    }

    paramMap.set(cacheKey, result);
    return result;
  }

  getRequiredWarmup(config: SessionConfig): number {
    if ((!config.enabled_signals || config.enabled_signals.length === 0) && (!config.exit_signals || config.exit_signals.length === 0)) return 0;

    const cached = this.warmupCache.get(config);
    if (cached !== undefined) return cached;

    let maxReq = 0;
    const params: any = config.signal_params || {};

    const resolveParam = (sigType: string, bType: string, key: string, fallback: any) => {
      return this.resolveSignalParam(params, sigType, bType, key, fallback);
    };

    const processSignal = (signalType: string) => {
      let baseType = signalType;
      let handler = this.signalHandlers[signalType];

      if (!handler) {
        const lastUnderscore = signalType.lastIndexOf('_');
        if (lastUnderscore > 0) {
          const potentialBase = signalType.substring(0, lastUnderscore);
          if (this.signalHandlers[potentialBase]) {
            baseType = potentialBase;
          }
        }
      }

      if (baseType === 'momentum_pct') {
        maxReq = Math.max(maxReq, (config.scan_lookback || 3) + 1);
      } else if (baseType === 'breakout_hl') {
        maxReq = Math.max(maxReq, (config.scan_lookback || 3) + 1);
      } else if (baseType === 'ma') {
        const periodVal = resolveParam(signalType, baseType, 'ma_period', '20');
        const period = parseInt(String(periodVal), 10);
        maxReq = Math.max(maxReq, period + 1);
      } else if (baseType === 'ema' || baseType === 'ema_cross' || baseType === 'ema_price_cross' || baseType === 'ema_close') {
        const exitPeriodVal = resolveParam(signalType, baseType, 'exit_ema_period', null);
        const entryPeriodVal = resolveParam(signalType, baseType, 'entry_ema_period', null);
        const basePeriodVal = resolveParam(signalType, baseType, 'ema_period', '12');

        const exitPeriod = parseInt(String(exitPeriodVal || basePeriodVal), 10);
        const entryPeriod = parseInt(String(entryPeriodVal || basePeriodVal), 10);
        const period = Math.max(exitPeriod, entryPeriod);

        maxReq = Math.max(maxReq, period * 2);
      } else if (baseType === 'ema_dual_cross' || baseType === 'ema_dual_close' || baseType === 'ema_dual') {
        const entryFastVal = resolveParam(signalType, baseType, 'entry_ema_fast', null);
        const exitFastVal = resolveParam(signalType, baseType, 'exit_ema_fast', null);
        const entrySlowVal = resolveParam(signalType, baseType, 'entry_ema_slow', null);
        const exitSlowVal = resolveParam(signalType, baseType, 'exit_ema_slow', null);

        const fast = Math.max(
          parseInt(String(entryFastVal || '9'), 10),
          parseInt(String(exitFastVal || '9'), 10)
        );
        const slow = Math.max(
          parseInt(String(entrySlowVal || '21'), 10),
          parseInt(String(exitSlowVal || '21'), 10)
        );

        maxReq = Math.max(maxReq, Math.max(fast, slow) * 2);

        const macdFilter = resolveParam(signalType, baseType, 'ema_dual_macd_filter', false);
        if (macdFilter === true || macdFilter === 'true') {
          const mFast = parseInt(String(resolveParam(signalType, baseType, 'macd_fast', '12')), 10);
          const mSlow = parseInt(String(resolveParam(signalType, baseType, 'macd_slow', '26')), 10);
          const mSig = parseInt(String(resolveParam(signalType, baseType, 'macd_signal', '9')), 10);
          maxReq = Math.max(maxReq, (Math.max(mFast, mSlow) + mSig) * 2);
        }
      } else if (baseType === 'engulfing') {
        const lookbackVal = resolveParam(signalType, baseType, 'engulfing_lookback', config.engulfing_lookback || '1');
        const lookback = parseInt(String(lookbackVal), 10);
        maxReq = Math.max(maxReq, lookback + 1);
      } else if (baseType === 'macd_impulse' || baseType === 'macd_fade' || baseType === 'macd_pbc') {
        const fastVal = resolveParam(signalType, baseType, 'macd_fast', '12');
        const slowVal = resolveParam(signalType, baseType, 'macd_slow', '26');
        const sigVal = resolveParam(signalType, baseType, 'macd_signal', '9');
        const emaVal = resolveParam(signalType, baseType, 'macd_pbc_trend_ema', '50');

        const fast = parseInt(String(fastVal), 10);
        const slow = parseInt(String(slowVal), 10);
        const signal = parseInt(String(sigVal), 10);
        const emaPeriod = parseInt(String(emaVal), 10);
        maxReq = Math.max(maxReq, (Math.max(fast, slow) + signal) * 2, emaPeriod * 2);
      } else if (baseType === 'supertrend') {
        const periodVal = resolveParam(signalType, baseType, 'supertrend_period', '10');
        const period = parseInt(String(periodVal), 10);
        maxReq = Math.max(maxReq, period * 5);
      } else if (baseType === 'knife_catch') {
        const lookbackVal = resolveParam(signalType, baseType, 'knife_lookback', '3');
        const lookback = parseInt(String(lookbackVal), 10);
        maxReq = Math.max(maxReq, lookback + 1);
      } else if (baseType === 'htf_breakout' || baseType === 'prev_day_breakout') {
        const lookbackVal = resolveParam(signalType, baseType, 'htf_breakout_lookback', config.htf_breakout_lookback || 5);
        const lookback = parseInt(String(lookbackVal), 10) || 5;
        maxReq = Math.max(maxReq, lookback + 2);
      } else if (baseType === 'trigger_candle_exit' || baseType === 'entry_candle_boundary') {
        const nVal = resolveParam(signalType, baseType, 'trigger_candle_exit_n', 0);
        const n = parseInt(String(nVal), 10) || 0;
        maxReq = Math.max(maxReq, n + 2);
      }
    };

    if (config.enabled_signals) {
      for (const signalType of config.enabled_signals) {
        processSignal(signalType);
      }
    }

    if (config.exit_signals) {
      for (const signalType of config.exit_signals) {
        processSignal(signalType);
      }
    }

    if (config.trigger_candle_exit_enabled) {
      processSignal('trigger_candle_exit');
    }

    this.warmupCache.set(config, maxReq);
    return maxReq;
  }

  private resolveBaseSignalType(signalType: string): string {
    if (this.signalHandlers[signalType]) return signalType;
    const lastUnderscore = signalType.lastIndexOf('_');
    if (lastUnderscore > 0) {
      const potentialBase = signalType.substring(0, lastUnderscore);
      if (this.signalHandlers[potentialBase]) {
        return potentialBase;
      }
    }
    return signalType;
  }

  private resolveEffectiveSignalInterval(config: SessionConfig, signalType: string, fallbackInterval: string): string {
    const baseType = this.resolveBaseSignalType(signalType);
    let tf = config.signal_timeframes?.[signalType] || config.signal_timeframes?.[baseType] || fallbackInterval;
    if (!tf || tf === 'default') tf = fallbackInterval;
    return tf;
  }

  public getRequiredWarmupForSignal(config: SessionConfig, signalType: string, purpose: 'entry' | 'exit' = 'entry'): number {
    const baseType = this.resolveBaseSignalType(signalType);
    const params: any = config.signal_params || {};
    const resolveParam = (sigType: string, bType: string, key: string, fallback: any) => {
      return this.resolveSignalParam(params, sigType, bType, key, fallback);
    };

    if (baseType === 'momentum_pct' || baseType === 'breakout_hl') {
      return Math.max(config.scan_lookback || 3, 1) + 1;
    } else if (baseType === 'ma') {
      return parseInt(String(resolveParam(signalType, baseType, 'ma_period', '20')), 10) + 1;
    } else if (baseType === 'ema' || baseType === 'ema_cross' || baseType === 'ema_price_cross' || baseType === 'ema_close') {
      const exitPeriodVal = resolveParam(signalType, baseType, 'exit_ema_period', null);
      const entryPeriodVal = resolveParam(signalType, baseType, 'entry_ema_period', null);
      const basePeriodVal = resolveParam(signalType, baseType, 'ema_period', '12');
      const exitPeriod = parseInt(String(exitPeriodVal || basePeriodVal), 10);
      const entryPeriod = parseInt(String(entryPeriodVal || basePeriodVal), 10);
      return (purpose === 'exit' ? Math.max(exitPeriod, 1) : Math.max(entryPeriod, exitPeriod)) * 2;
    } else if (baseType === 'ema_dual_cross' || baseType === 'ema_dual_close' || baseType === 'ema_dual') {
      const entryFastVal = resolveParam(signalType, baseType, 'entry_ema_fast', null) || resolveParam(signalType, baseType, 'exit_ema_fast', '9');
      const exitFastVal = resolveParam(signalType, baseType, 'exit_ema_fast', null) || resolveParam(signalType, baseType, 'entry_ema_fast', '9');
      const entrySlowVal = resolveParam(signalType, baseType, 'entry_ema_slow', null) || resolveParam(signalType, baseType, 'exit_ema_slow', '21');
      const exitSlowVal = resolveParam(signalType, baseType, 'exit_ema_slow', null) || resolveParam(signalType, baseType, 'entry_ema_slow', '21');
      const fast = purpose === 'exit'
        ? parseInt(String(exitFastVal), 10)
        : Math.max(parseInt(String(entryFastVal), 10), parseInt(String(exitFastVal), 10));
      const slow = purpose === 'exit'
        ? parseInt(String(exitSlowVal), 10)
        : Math.max(parseInt(String(entrySlowVal), 10), parseInt(String(exitSlowVal), 10));
      let req = Math.max(fast, slow) * 2;
      const macdFilter = resolveParam(signalType, baseType, 'ema_dual_macd_filter', false);
      if (macdFilter === true || macdFilter === 'true') {
        const mFast = parseInt(String(resolveParam(signalType, baseType, 'macd_fast', '12')), 10);
        const mSlow = parseInt(String(resolveParam(signalType, baseType, 'macd_slow', '26')), 10);
        const mSig = parseInt(String(resolveParam(signalType, baseType, 'macd_signal', '9')), 10);
        req = Math.max(req, (Math.max(mFast, mSlow) + mSig) * 2);
      }
      return req;
    } else if (baseType === 'engulfing') {
      const lookback = parseInt(String(resolveParam(signalType, baseType, 'engulfing_lookback', config.engulfing_lookback || '1')), 10);
      return lookback + 1;
    } else if (baseType === 'macd_impulse' || baseType === 'macd_fade' || baseType === 'macd_pbc') {
      const fast = parseInt(String(resolveParam(signalType, baseType, 'macd_fast', '12')), 10);
      const slow = parseInt(String(resolveParam(signalType, baseType, 'macd_slow', '26')), 10);
      const signal = parseInt(String(resolveParam(signalType, baseType, 'macd_signal', '9')), 10);
      let req = (Math.max(fast, slow) + signal) * 2;
      if (baseType === 'macd_pbc') {
        const emaPeriod = parseInt(String(resolveParam(signalType, baseType, 'macd_pbc_trend_ema', '50')), 10);
        req = Math.max(req, emaPeriod * 2);
      }
      return req;
    } else if (baseType === 'supertrend') {
      return parseInt(String(resolveParam(signalType, baseType, 'supertrend_period', '10')), 10) * 5;
    } else if (baseType === 'knife_catch') {
      return parseInt(String(resolveParam(signalType, baseType, 'knife_lookback', '3')), 10) + 1;
    } else if (baseType === 'htf_breakout' || baseType === 'prev_day_breakout') {
      const lookback = parseInt(String(resolveParam(signalType, baseType, 'htf_breakout_lookback', config.htf_breakout_lookback ?? 1)), 10) || 1;
      return lookback + 1;
    } else if (baseType === 'trigger_candle_exit' || baseType === 'entry_candle_boundary') {
      const n = parseInt(String(resolveParam(signalType, baseType, 'trigger_candle_exit_n', 0)), 10) || 0;
      return n + 2;
    }
    return Math.max((config.scan_lookback || 3) + 1, 2);
  }

  public getRequiredWarmupForInterval(
    config: SessionConfig,
    targetInterval: string,
    purpose: 'entry' | 'exit' = 'entry',
    activeSignalsOverride?: string[],
  ): number {
    const activeSignals = activeSignalsOverride || (purpose === 'exit'
      ? [
          ...(config.exit_signals || []),
          ...(config.trigger_candle_exit_enabled && !(config.exit_signals || []).includes('trigger_candle_exit') ? ['trigger_candle_exit'] : []),
        ]
      : (config.enabled_signals || []));

    let maxReq = 0;
    const params: any = config.signal_params || {};

    for (const signalType of activeSignals) {
      const baseType = this.resolveBaseSignalType(signalType);
      if (baseType === 'htf_breakout' || baseType === 'prev_day_breakout') {
        const refTf = String(
          this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_ref_timeframe', (config as any).htf_breakout_ref_timeframe || '1d')
        );
        const trigTfCfg = String(
          this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_trigger_timeframe', (config as any).htf_breakout_trigger_timeframe || '1h')
        );
        const effTrigTf = (!trigTfCfg || trigTfCfg === 'default') ? targetInterval : trigTfCfg;
        const mode = String(
          this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_mode', (config as any).htf_breakout_mode || 'close_break')
        );
        if (targetInterval === refTf) {
          const lookback = Math.max(1, parseInt(String(this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_lookback', config.htf_breakout_lookback ?? 1)), 10) || 1);
          maxReq = Math.max(maxReq, lookback + 1);
        }
        if (targetInterval === effTrigTf) {
          maxReq = Math.max(maxReq, mode === 'closed_candle_confirm' ? 2 : 1);
        }
        continue;
      }

      const signalTf = this.resolveEffectiveSignalInterval(config, signalType, targetInterval);
      if (signalTf === targetInterval) {
        maxReq = Math.max(maxReq, this.getRequiredWarmupForSignal(config, signalType, purpose));
      }
    }

    return maxReq;
  }

  checkEntry(
    symbol: string,
    config: SessionConfig,
    interval: string = '1m',
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
    minimal: boolean = false,
    passedCandles?: Candle[],
    trade?: any,
    candlesByInterval?: Map<string, Candle[]>,
  ): { allFired: boolean; firedSignals: string[]; reason: string; details?: Record<string, SignalDetail> } {
    const evaluatedAtMs = Date.now();
    // BOLT OPTIMIZATION: Dynamically select correct active signals depending on purpose.
    // Avoids requiring caller to clone the config object on every check.
    const activeSignals = purpose === 'exit'
      ? [
          ...(config.exit_signals || []),
          ...(config.trigger_candle_exit_enabled && !(config.exit_signals || []).includes('trigger_candle_exit') ? ['trigger_candle_exit'] : []),
        ]
      : (config.enabled_signals || []);
    if (activeSignals.length === 0) {
      return {
        allFired: false,
        firedSignals: [],
        reason: purpose === 'exit' ? 'No exit signals enabled' : 'No signals enabled',
      };
    }

    const logic = purpose === 'exit' ? (config.exit_signal_logic || 'any') : (config.signal_logic || 'all');
    const requiredConfigured = purpose === 'exit' ? (config.required_exit_signals || []) : (config.required_signals || []);

    let requiredSet: string[] = [];
    let optionalSet: string[] = [];

    if (logic === 'combo') {
      if (requiredConfigured.length > 0) {
        requiredSet = activeSignals.filter(s => requiredConfigured.includes(s));
        optionalSet = activeSignals.filter(s => !requiredConfigured.includes(s));
      } else {
        const baseSignals = activeSignals.filter(s => {
          let base = s;
          const lastUnderscore = s.lastIndexOf('_');
          if (lastUnderscore > 0) {
            const potentialBase = s.substring(0, lastUnderscore);
            if (/^\d+$/.test(s.substring(lastUnderscore + 1)) && this.signalHandlers[potentialBase]) base = potentialBase;
          }
          return s === base;
        });
        if (baseSignals.length > 0 && baseSignals.length < activeSignals.length) {
          requiredSet = baseSignals;
          optionalSet = activeSignals.filter(s => !baseSignals.includes(s));
        } else {
          requiredSet = [activeSignals[0]];
          optionalSet = activeSignals.slice(1);
        }
      }
    }

    const candles = candlesByInterval
      ? (candlesByInterval.get(interval) || passedCandles || [])
      : (passedCandles || this.klineStore.getRawCandles(symbol, interval));

    // Warm-up check scoped strictly to signals evaluating on the base interval when reading from klineStore or candlesByInterval,
    // so multi-timeframe indicators (e.g. ema_dual on 1h with MACD=70) never falsely block shorter-history base pairs (e.g. 1d with 60 candles).
    const requiredWarmup = (passedCandles && !candlesByInterval)
      ? activeSignals.reduce((m, s) => {
          const bType = this.resolveBaseSignalType(s);
          if (bType === 'htf_breakout' || bType === 'prev_day_breakout') {
            return Math.max(m, 1);
          }
          return Math.max(m, this.getRequiredWarmupForSignal(config, s, purpose));
        }, 0)
      : this.getRequiredWarmupForInterval(config, interval, purpose, activeSignals);

    const onlyBreakoutSignals = activeSignals.every((s) => {
      const bType = this.resolveBaseSignalType(s);
      return bType === 'htf_breakout' || bType === 'prev_day_breakout';
    });

    if (requiredWarmup > 0 && candles.length < requiredWarmup && (minimal || !onlyBreakoutSignals)) {
      return {
        allFired: false,
        firedSignals: [],
        reason: `Indicator warm-up in progress (${candles.length}/${requiredWarmup} candles on ${interval})`,
        details: minimal ? undefined : {
          warmup: {
            fired: false,
            value: candles.length,
            threshold: requiredWarmup,
            unit: 'candles',
            metric: 'Warmup',
            description: `Waiting for mathematical convergence on ${interval}`,
            insufficientData: true,
            timeframe: interval,
            candleCount: candles.length,
            evaluated_at_ms: evaluatedAtMs,
          }
        }
      };
    }

    // BOLT OPTIMIZATION: Avoid array/object allocations when minimal mode is active
    const firedSignals: string[] = minimal ? [] : [];
    const failedSignals: string[] = minimal ? [] : [];
    const warmupReasons: string[] = [];
    const details: Record<string, SignalDetail> = minimal ? {} : {};

    for (const signalType of activeSignals) {
      // BOLT OPTIMIZATION: Check for cached resolved handler first
      let resolved = this.handlerResolutionCache.get(signalType);
      if (!resolved) {
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
        resolved = { baseType: baseSignalType, handler: handler || null };
        this.handlerResolutionCache.set(signalType, resolved);
      }

      const { baseType: baseSignalType, handler } = resolved;

      if (!handler) {
        if (minimal) {
          if (logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
          if (logic === 'combo' && requiredSet.includes(signalType)) return { allFired: false, firedSignals: [], reason: 'minimal' };
        } else {
          failedSignals.push(signalType);
        }
        continue;
      }

      try {
        let signalInterval = config.signal_timeframes?.[signalType] || config.signal_timeframes?.[baseSignalType] || interval;
        if (signalInterval === 'default') {
          signalInterval = interval;
        }
        const signalCandles = candlesByInterval
          ? (candlesByInterval.get(signalInterval) || (signalInterval === interval ? candles : []))
          : (passedCandles || ((signalInterval !== interval)
            ? this.klineStore.getRawCandles(symbol, signalInterval)
            : candles));

        const isCrossTfSplit = baseSignalType === 'htf_breakout' || baseSignalType === 'prev_day_breakout';
        if (!isCrossTfSplit) {
          const sigReqWarmup = this.getRequiredWarmupForSignal(config, signalType, purpose);
          if (signalCandles.length < sigReqWarmup) {
            const warmMsg = `Indicator warm-up in progress (${signalCandles.length}/${sigReqWarmup} candles on ${signalInterval} for ${signalType})`;
            if (minimal) {
              if (logic === 'all') return { allFired: false, firedSignals: [], reason: warmMsg };
              if (logic === 'combo' && requiredSet.includes(signalType)) return { allFired: false, firedSignals: [], reason: warmMsg };
              failedSignals.push(signalType);
              continue;
            }
            failedSignals.push(signalType);
            warmupReasons.push(warmMsg);
            details[signalType] = {
              fired: false,
              value: signalCandles.length,
              threshold: sigReqWarmup,
              unit: 'candles',
              metric: baseSignalType,
              description: `Timeframe ${signalInterval} warm-up in progress (${signalCandles.length}/${sigReqWarmup})`,
              insufficientData: true,
              timeframe: signalInterval,
              candleCount: signalCandles.length,
              evaluated_at_ms: evaluatedAtMs,
            };
            continue;
          }
        }

        const effectiveConfig = candlesByInterval
          ? ({ ...config, _bt_candles_by_interval: candlesByInterval } as any)
          : config;
        const result = handler(symbol, effectiveConfig, signalInterval, side, purpose, signalCandles, minimal, signalType, trade);
        const fired = typeof result === 'boolean' ? result : result.fired;

        if (fired) firedSignals.push(signalType);
        else failedSignals.push(signalType);

        if (!minimal) {
          if (typeof result !== 'boolean') {
            details[signalType] = { ...result, metric: result.metric || baseSignalType, evaluated_at_ms: evaluatedAtMs };
            if (result.insufficientData && result.description) {
              warmupReasons.push(result.description);
            }
          }
        } else {
          // Early exit if logic is satisfied
          if (fired && logic === 'any') return { allFired: true, firedSignals: [], reason: 'minimal' };
          if (!fired && logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
          if (!fired && logic === 'combo' && requiredSet.includes(signalType)) return { allFired: false, firedSignals: [], reason: 'minimal' };
        }
      } catch (error) {
        this.logger.warn(`Signal ${signalType} error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
        if (minimal) {
          if (logic === 'all') return { allFired: false, firedSignals: [], reason: 'minimal' };
          if (logic === 'combo' && requiredSet.includes(signalType)) return { allFired: false, firedSignals: [], reason: 'minimal' };
        } else {
          failedSignals.push(signalType);
        }
      }
    }

    if (minimal) {
      if (logic === 'combo') {
        const requiredSatisfied = requiredSet.every(s => firedSignals.includes(s));
        const optionalSatisfied = optionalSet.length === 0 || optionalSet.some(s => firedSignals.includes(s));
        return { allFired: requiredSatisfied && optionalSatisfied, firedSignals: [], reason: 'minimal' };
      }
      if (logic === 'all') {
        return { allFired: failedSignals.length === 0 && firedSignals.length === activeSignals.length, firedSignals: [], reason: 'minimal' };
      }
      return { allFired: firedSignals.length > 0, firedSignals: [], reason: 'minimal' };
    }

    let allFired = false;
    if (logic === 'any') {
      allFired = firedSignals.length > 0;
    } else if (logic === 'all') {
      allFired = failedSignals.length === 0;
    } else if (logic === 'combo') {
      const requiredSatisfied = requiredSet.every(s => firedSignals.includes(s));
      const optionalSatisfied = optionalSet.length === 0 || optionalSet.some(s => firedSignals.includes(s));
      allFired = requiredSatisfied && optionalSatisfied;
    }

    const reason = (!allFired && warmupReasons.length > 0 && failedSignals.every(f => Boolean(details[f]?.insufficientData)))
      ? warmupReasons[0]
      : logic === 'combo'
        ? `Combo (${requiredSet.join(' AND ')} [Req] + ${optionalSet.join(' OR ')} [Opt]): ${firedSignals.length}/${activeSignals.length} fired`
        : `Signals fired: ${firedSignals.length}/${activeSignals.length}` +
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
    signalType: string = 'engulfing',
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

    // BOLT OPTIMIZATION: Use centralized KlineStore extremes which implements stable caching (completed candles only for breakout comparison).
    const { minLow, maxHigh } = this.klineStore.getLookbackExtremes(symbol, interval, lookback, false);

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
    signalType: string = 'engulfing',
  ): boolean | SignalDetail {
    try {
      // DIRECTION-AWARE: For exit signals, we search for the opposite pattern direction
      const evaluatedSide = (purpose === 'exit' && side)
        ? (side === 'LONG' ? 'SHORT' : 'LONG')
        : side;
      side = evaluatedSide;

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      const params = config.signal_params || {};
      const lookbackVal = this.resolveSignalParam(params, signalType, 'engulfing', 'engulfing_lookback', config.engulfing_lookback || 1);
      const streakVal = this.resolveSignalParam(params, signalType, 'engulfing', 'engulfing_streak', config.engulfing_streak || 1);
      const sequentialVal = this.resolveSignalParam(params, signalType, 'engulfing', 'engulfing_sequential', config.engulfing_sequential !== false);
      const modeVal = this.resolveSignalParam(params, signalType, 'engulfing', 'engulfing_mode', config.engulfing_mode || 'range');
      const volConfirmVal = this.resolveSignalParam(params, signalType, 'engulfing', 'engulfing_volume_confirm', config.engulfing_volume_confirm || false);
      const maxExpansionVal = this.resolveSignalParam(params, signalType, 'engulfing', 'engulfing_max_expansion_pct', config.engulfing_max_expansion_pct ?? config.engulfing_expansion_cap_pct ?? 0);

      const lookback = Math.max(parseInt(String(lookbackVal), 10) || 1, 1);
      const streakReq = Math.min(Math.max(parseInt(String(streakVal), 10) || lookback, 1), lookback);
      const sequential = sequentialVal === true || sequentialVal === 'true';
      const mode = String(modeVal);
      const volConfirm = volConfirmVal === true || volConfirmVal === 'true';
      const maxExpansion = Math.max(0, parseFloat(String(maxExpansionVal)) || 0);

      const closeOnlyMode = mode === 'close_range' || mode === 'close_body';
      const softMode = mode === 'soft_range' || mode === 'soft_body';

      if (candles.length < lookback + (closeOnlyMode ? 2 : 1)) {
        return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'Engulfing', description: closeOnlyMode ? 'Waiting for closed confirmation candle' : 'Insufficient data', insufficientData: true };
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
          value: curr.close,
          threshold: 0, // Fallback target when no streak is found
          unit: 'price',
          metric: 'Engulfing',
          description: sequential
            ? `Previous ${streakReq} candles not ${side === 'LONG' ? 'bearish' : 'bullish'}`
            : `No ${streakReq}-candle ${side === 'LONG' ? 'bearish' : 'bullish'} streak found in last ${lookback} candles`,
          engulfing_pattern: {
            direction: side === 'SHORT' ? 'bearish' : 'bullish',
            mode,
            lookback,
            streak_required: streakReq,
            streak_found: 0,
            sequential,
            volume_confirm: volConfirm,
            close_only: closeOnlyMode,
            soft_mode: softMode,
            state: 'waiting_streak',
          },
        };
      }

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

      // Inline pure helper function to evaluate engulfing condition at a specific index
      const evaluateEngulfingAt = (idx: number, isVolConfirmReq: boolean): { fired: boolean; reason: string } => {
        const candle = candles[idx];
        const isBullish = candle.close > candle.open;
        const isBearish = candle.close < candle.open;

        const cBodyHigh = Math.max(candle.open, candle.close);
        const cBodyLow = Math.min(candle.open, candle.close);

        const bodyEngulfs = cBodyHigh > aggregateBodyHigh && cBodyLow < aggregateBodyLow;
        const rangeEngulfs = candle.high > aggregateHigh && candle.low < aggregateLow;

        const softRangeEngulfs = side === 'SHORT' ? candle.close < aggregateLow : candle.close > aggregateHigh;
        const softBodyEngulfs = side === 'SHORT' ? candle.close < aggregateBodyLow : candle.close > aggregateBodyHigh;

        const volumeConfirms = candle.volume > candles[idx - 1].volume;

        let evalFired = false;
        let evalReason = '';

        if (side === 'LONG') {
          if (!isBullish) {
            evalFired = false;
            evalReason = 'Not a bullish candle';
          } else {
            if (mode === 'body') evalFired = bodyEngulfs;
            else if (mode === 'range') evalFired = rangeEngulfs;
            else if (mode === 'strict') evalFired = bodyEngulfs && rangeEngulfs;
            else if (mode === 'close_range') evalFired = softRangeEngulfs;
            else if (mode === 'close_body') evalFired = softBodyEngulfs;
            else if (mode === 'soft_range') evalFired = softRangeEngulfs;
            else if (mode === 'soft_body') evalFired = softBodyEngulfs;

            if (evalFired && isVolConfirmReq && !volumeConfirms) {
              evalFired = false;
              evalReason = 'Insufficient volume confirmation';
            } else if (!evalFired) {
              evalReason = mode === 'body' ? 'Body did not engulf' :
                       mode === 'range' ? 'Range did not engulf' :
                       mode === 'strict' ? 'Strict engulfing failed' :
                       mode === 'close_body' || mode === 'soft_body' ? `Close did not clear prior ${streakReq}-candle body high` :
                       `Close did not clear prior ${streakReq}-candle high`;
            }
          }
        } else if (side === 'SHORT') {
          if (!isBearish) {
            evalFired = false;
            evalReason = 'Not a bearish candle';
          } else {
            if (mode === 'body') evalFired = bodyEngulfs;
            else if (mode === 'range') evalFired = rangeEngulfs;
            else if (mode === 'strict') evalFired = bodyEngulfs && rangeEngulfs;
            else if (mode === 'close_range') evalFired = softRangeEngulfs;
            else if (mode === 'close_body') evalFired = softBodyEngulfs;
            else if (mode === 'soft_range') evalFired = softRangeEngulfs;
            else if (mode === 'soft_body') evalFired = softBodyEngulfs;

            if (evalFired && isVolConfirmReq && !volumeConfirms) {
              evalFired = false;
              evalReason = 'Insufficient volume confirmation';
            } else if (!evalFired) {
              evalReason = mode === 'body' ? 'Body did not engulf' :
                       mode === 'range' ? 'Range did not engulf' :
                       mode === 'strict' ? 'Strict engulfing failed' :
                       mode === 'close_body' || mode === 'soft_body' ? `Close did not clear prior ${streakReq}-candle body low` :
                       `Close did not clear prior ${streakReq}-candle low`;
            }
          }
        } else {
          // Universal Signal check (no side provided)
          if (mode === 'body') evalFired = bodyEngulfs;
          else if (mode === 'range') evalFired = rangeEngulfs;
          else if (mode === 'close_range' || mode === 'soft_range') evalFired = candle.close > aggregateHigh || candle.close < aggregateLow;
          else if (mode === 'close_body' || mode === 'soft_body') evalFired = candle.close > aggregateBodyHigh || candle.close < aggregateBodyLow;
          else evalFired = bodyEngulfs && rangeEngulfs;

          if (evalFired && isVolConfirmReq && !volumeConfirms) evalFired = false;
        }

        if (evalFired && maxExpansion > 0) {
          let expansionPct = 0;
          if (side === 'LONG') {
            expansionPct = aggregateHigh > 0 ? ((candle.close - aggregateHigh) / aggregateHigh) * 100 : 0;
          } else if (side === 'SHORT') {
            expansionPct = aggregateLow > 0 ? ((aggregateLow - candle.close) / aggregateLow) * 100 : 0;
          } else {
            const longExp = aggregateHigh > 0 ? ((candle.close - aggregateHigh) / aggregateHigh) * 100 : 0;
            const shortExp = aggregateLow > 0 ? ((aggregateLow - candle.close) / aggregateLow) * 100 : 0;
            expansionPct = Math.max(longExp, shortExp);
          }

          if (expansionPct > maxExpansion) {
            evalFired = false;
            evalReason = `Entry overextended: expansion (${expansionPct.toFixed(2)}%) exceeds cap (${maxExpansion}%)`;
          }
        }

        return { fired: evalFired, reason: evalReason };
      };

      // Check if an earlier candle already satisfied the engulfing condition against this streak
      let alreadyEngulfed = false;
      for (let j = foundStreakEnd; j < signalIdx; j++) {
        const earlierEval = evaluateEngulfingAt(j, volConfirm);
        if (earlierEval.fired) {
          alreadyEngulfed = true;
          break;
        }
      }

      let currEval = evaluateEngulfingAt(signalIdx, volConfirm);
      let fired = currEval.fired;
      let reason = currEval.reason;

      if (fired && alreadyEngulfed) {
        fired = false;
        reason = 'Already engulfed by an earlier candle';
      }

      let threshold = (mode === 'close_body' || mode === 'soft_body')
        ? (side === 'SHORT' ? aggregateBodyLow : aggregateBodyHigh)
        : (side === 'SHORT' ? aggregateLow : aggregateHigh);

      const predictedSl = side === 'LONG' ? aggregateLow : aggregateHigh;

      const currExpansionPct = side === 'SHORT'
        ? (aggregateLow > 0 ? ((aggregateLow - curr.close) / aggregateLow) * 100 : 0)
        : (aggregateHigh > 0 ? ((curr.close - aggregateHigh) / aggregateHigh) * 100 : 0);

      if (minimal) return fired;

      const liveClose = candles[candles.length - 1]?.close ?? curr.close;

      return {
        fired,
        value: curr.close,
        closed_value: roundTo(curr.close, 8),
        live_price: roundTo(liveClose, 8),
        threshold: threshold,
        unit: 'price',
        metric: (closeOnlyMode || softMode) ? 'Close Engulf' : 'Engulfing',
        description: fired
          ? (softMode ? `Live candle broke through ${streakReq}-candle cluster` : closeOnlyMode ? `Closed candle close-engulfed ${streakReq}-candle streak` : `Engulfing pattern (${mode}) detected`)
          : (reason || 'No engulfing pattern'),
        threshold_is_price: true,
        pattern_low: aggregateLow !== Infinity ? aggregateLow : undefined,
        pattern_high: aggregateHigh !== -Infinity ? aggregateHigh : undefined,
        body_low: aggregateBodyLow !== Infinity ? aggregateBodyLow : undefined,
        body_high: aggregateBodyHigh !== -Infinity ? aggregateBodyHigh : undefined,
        streak_start: foundStreakStart,
        streak_end: foundStreakEnd,
        streak_start_ts: candles[foundStreakStart]?.time,
        streak_end_ts: candles[foundStreakEnd - 1]?.time,
        slPrice: predictedSl !== Infinity && predictedSl !== -Infinity ? predictedSl : undefined,
        mode,
        expansion_pct: currExpansionPct > 0 ? parseFloat(currExpansionPct.toFixed(2)) : 0,
        max_expansion_pct: maxExpansion > 0 ? maxExpansion : undefined,
        engulfing_pattern: {
          direction: side === 'SHORT' ? 'bearish' : 'bullish',
          mode,
          lookback,
          streak_required: streakReq,
          streak_found: Math.max(0, foundStreakEnd - foundStreakStart),
          sequential,
          volume_confirm: volConfirm,
          close_only: closeOnlyMode,
          soft_mode: softMode,
          already_engulfed: alreadyEngulfed,
          expansion_pct: currExpansionPct > 0 ? parseFloat(currExpansionPct.toFixed(2)) : 0,
          max_expansion_pct: maxExpansion > 0 ? maxExpansion : null,
          state: fired ? 'confirmed' : (alreadyEngulfed ? 'late' : 'waiting_break'),
        },
      };
    } catch (error) {
      this.logger.debug(`Engulfing signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: passedCandles?.[passedCandles.length - 1]?.close || 0, threshold: 0, unit: 'error', metric: 'Engulfing', description: 'Signal error' };
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
        return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'MA Cross', description: 'Insufficient data', insufficientData: true, threshold_is_price: true };
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
      return { fired: false, value: passedCandles?.[passedCandles.length - 1]?.close || 0, threshold: 0, unit: 'error', metric: 'MA Cross', description: 'Signal error', threshold_is_price: true };
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
        return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'EMA Cross', description: 'Insufficient data', insufficientData: true, threshold_is_price: true };
      }

      const emaTwo = this.calculateEMALastTwo(candles, period, interval, symbol);
      const emaRes = emaTwo
        ? { value: emaTwo.values[1], prevValue: emaTwo.values[0], insufficientData: emaTwo.insufficientData }
        : (() => {
            const fallback = this.calculateEMA(candles, period, interval, symbol, `EMA(${period})`);
            return { value: fallback.value, prevValue: fallback.value, insufficientData: fallback.insufficientData };
          })();
      const ema = emaRes.value;
      const prevEma = emaRes.prevValue;
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;

      let fired = false;
      let isOnSatisfiedSide = false;

      if (purpose === 'entry') {
        if (side === 'LONG') {
          fired = prevClose <= prevEma && currClose > ema;
          isOnSatisfiedSide = currClose > ema;
        } else if (side === 'SHORT') {
          fired = prevClose >= prevEma && currClose < ema;
          isOnSatisfiedSide = currClose < ema;
        } else {
          fired = (prevClose <= prevEma && currClose > ema) || (prevClose >= prevEma && currClose < ema);
          isOnSatisfiedSide = true;
        }
      } else {
        if (side === 'LONG') {
          fired = prevClose >= prevEma && currClose < ema;
          isOnSatisfiedSide = currClose < ema;
        } else if (side === 'SHORT') {
          fired = prevClose <= prevEma && currClose > ema;
          isOnSatisfiedSide = currClose > ema;
        } else {
          fired = false;
          isOnSatisfiedSide = false;
        }
      }

      if (minimal) return fired;

      return {
        fired,
        status: fired ? 'fired' : isOnSatisfiedSide ? 'stale' : 'approaching',
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
      return { fired: false, value: passedCandles?.[passedCandles.length - 1]?.close || 0, threshold: 0, unit: 'error', metric: 'EMA Cross', description: 'Signal error', threshold_is_price: true };
    }
  }

  private emaDualSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
    passedCandles?: Candle[],
    minimal?: boolean,
    signalType?: string,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const signalTypeKey = signalType || arguments[7] || 'ema_dual';
      const baseType = 'ema_dual';

      const fastVal = purpose === 'exit'
        ? this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_fast', this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_fast', '9'))
        : this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_fast', this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_fast', '9'));
      const slowVal = purpose === 'exit'
        ? this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_slow', this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_slow', '21'))
        : this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_slow', this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_slow', '21'));

      const fastPeriod = parseInt(String(fastVal || '9'), 10) || 9;
      const slowPeriod = parseInt(String(slowVal || '21'), 10) || 21;

      const maxPeriod = Math.max(fastPeriod, slowPeriod);
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < maxPeriod + 1) {
        return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'EMA Dual', description: 'Insufficient data', insufficientData: true, threshold_is_price: true };
      }

      const fastRes = this.calculateEMAAt(candles, candles.length - 1, fastPeriod, interval, symbol);
      const slowRes = this.calculateEMAAt(candles, candles.length - 1, slowPeriod, interval, symbol);

      if (fastRes.insufficientData || slowRes.insufficientData) {
        return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'EMA Dual', description: 'Insufficient EMA data', insufficientData: true, threshold_is_price: true };
      }

      const currFast = fastRes.value;
      const currSlow = slowRes.value;

      let fired = false;
      const threshold = side === 'SHORT' ? Math.min(currFast, currSlow) : Math.max(currFast, currSlow);

      if (purpose === 'entry') {
        if (side === 'LONG') fired = currFast > currSlow;
        else if (side === 'SHORT') fired = currFast < currSlow;
        else fired = true;
      } else {
        if (side === 'LONG') fired = currFast < currSlow;
        else if (side === 'SHORT') fired = currFast > currSlow;
        else fired = false;
      }

      const macdFilter = this.resolveSignalParam(params, signalTypeKey, 'ema_dual', 'ema_dual_macd_filter', false);
      let macdRejected = false;
      let macdHistValue = 0;
      let macdFilterMeta: any = undefined;

      if ((fired || !minimal) && (macdFilter === true || macdFilter === 'true')) {
        const mFast = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual', 'macd_fast', '12')), 10);
        const mSlow = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual', 'macd_slow', '26')), 10);
        const mSig = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual', 'macd_signal', '9')), 10);

        const macdRes = this.calculateMACD(candles, mFast, mSlow, mSig, symbol, interval);
        if (!macdRes.insufficientData && macdRes.histogram.length > 0) {
          const idx = macdRes.histogram.length - 1;
          macdHistValue = macdRes.histogram[idx];
          const prevHistVal = idx >= 1 ? macdRes.histogram[idx - 1] : 0;
          const isExit = purpose === 'exit';
          const expectPositive = isExit ? side === 'SHORT' : side !== 'SHORT';
          const isMacdAligned = expectPositive ? macdHistValue > 0 : macdHistValue < 0;

          if (fired) {
            if (!isExit) {
              if (side === 'SHORT' && macdHistValue >= 0) {
                fired = false;
                macdRejected = true;
              } else if (side === 'LONG' && macdHistValue <= 0) {
                fired = false;
                macdRejected = true;
              }
            } else {
              if (side === 'SHORT' && macdHistValue <= 0) {
                fired = false;
                macdRejected = true;
              } else if (side === 'LONG' && macdHistValue >= 0) {
                fired = false;
                macdRejected = true;
              }
            }
          }

          if (!minimal) {
            macdFilterMeta = {
              enabled: true,
              mode: 'ema_filter',
              fast: mFast,
              slow: mSlow,
              signal: mSig,
              histogram: roundTo(macdHistValue, 8),
              prev_histogram: roundTo(prevHistVal, 8),
              recent_hist: macdRes.histogram.slice(Math.max(0, idx - 5), idx + 1).map((v) => roundTo(v, 8)),
              aligned: isMacdAligned,
              rejected: macdRejected,
              expected_sign: expectPositive ? 'positive' : 'negative',
              expected_label: expectPositive ? 'Green (+Hist)' : 'Red (-Hist)',
              gates: [
                {
                  key: 'macd_hist',
                  label: `MACD(${mFast}/${mSlow}/${mSig}) ${expectPositive ? '> 0 (Green)' : '< 0 (Red)'}`,
                  passed: isMacdAligned,
                  rejected: macdRejected,
                  value: this.formatAdaptiveNumber(macdHistValue, true),
                },
              ],
            };
          }
        }
      }

      if (minimal) return fired;

      return {
        fired,
        status: fired ? 'fired' : macdRejected ? 'blocked' : 'approaching',
        rejected: macdRejected,
        value: currFast,
        threshold: currSlow,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Dual' : 'Entry EMA Dual',
        description: macdRejected
          ? `Rejected by MACD (${this.formatAdaptiveNumber(macdHistValue, false)})`
          : `Fast (${fastPeriod}): ${this.formatAdaptiveNumber(currFast)}, Slow (${slowPeriod}): ${this.formatAdaptiveNumber(currSlow)}`,
        threshold_is_price: true,
        ...(macdFilterMeta ? { macd_filter: macdFilterMeta } : {}),
      };
    } catch (error) {
      this.logger.debug(`EMA Dual signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: passedCandles?.[passedCandles.length - 1]?.close || 0, threshold: 0, unit: 'error', metric: 'EMA Dual', description: 'Signal error', threshold_is_price: true };
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
    signalType?: string,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const signalTypeKey = signalType || arguments[7] || 'ema_dual_cross';
      const baseType = 'ema_dual_cross';

      const fastVal = purpose === 'exit'
        ? this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_fast', this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_fast', '9'))
        : this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_fast', this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_fast', '9'));
      const slowVal = purpose === 'exit'
        ? this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_slow', this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_slow', '21'))
        : this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_slow', this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_slow', '21'));

      const fastPeriod = parseInt(String(fastVal || '9'), 10) || 9;
      const slowPeriod = parseInt(String(slowVal || '21'), 10) || 21;

      const maxPeriod = Math.max(fastPeriod, slowPeriod);
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < maxPeriod + 1) {
        return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'EMA Dual', description: 'Insufficient data', insufficientData: true, threshold_is_price: true };
      }

      const fastRes = this.calculateEMALastTwo(candles, fastPeriod, interval, symbol);
      const slowRes = this.calculateEMALastTwo(candles, slowPeriod, interval, symbol);

      if (!fastRes || !slowRes) {
        return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'EMA Dual', description: 'Insufficient EMA data', insufficientData: true, threshold_is_price: true };
      }

      const [prevFast, currFast] = fastRes.values;
      const [prevSlow, currSlow] = slowRes.values;

      let fired = false;
      let isOnSatisfiedSide = false;

      if (purpose === 'entry') {
        if (side === 'LONG') {
          fired = prevFast <= prevSlow && currFast > currSlow;
          isOnSatisfiedSide = currFast > currSlow;
        } else if (side === 'SHORT') {
          fired = prevFast >= prevSlow && currFast < currSlow;
          isOnSatisfiedSide = currFast < currSlow;
        } else {
          fired = (prevFast <= prevSlow && currFast > currSlow) || (prevFast >= prevSlow && currFast < currSlow);
          isOnSatisfiedSide = false;
        }
      } else {
        if (side === 'LONG') {
          fired = prevFast >= prevSlow && currFast < currSlow;
          isOnSatisfiedSide = currFast < currSlow;
        } else if (side === 'SHORT') {
          fired = prevFast <= prevSlow && currFast > currSlow;
          isOnSatisfiedSide = currFast > currSlow;
        } else {
          fired = false;
          isOnSatisfiedSide = false;
        }
      }

      const isCrossEvent = fired;

      const macdFilter = this.resolveSignalParam(params, signalTypeKey, 'ema_dual_cross', 'ema_dual_macd_filter', false);
      let macdRejected = false;
      let macdHistValue = 0;
      let macdFilterMeta: any = undefined;

      if ((fired || !minimal) && (macdFilter === true || macdFilter === 'true')) {
        const mFast = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual_cross', 'macd_fast', '12')), 10);
        const mSlow = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual_cross', 'macd_slow', '26')), 10);
        const mSig = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual_cross', 'macd_signal', '9')), 10);

        const macdRes = this.calculateMACD(candles, mFast, mSlow, mSig, symbol, interval);
        if (!macdRes.insufficientData && macdRes.histogram.length > 0) {
          const idx = macdRes.histogram.length - 1;
          macdHistValue = macdRes.histogram[idx];
          const prevHistVal = idx >= 1 ? macdRes.histogram[idx - 1] : 0;
          const isExit = purpose === 'exit';
          const expectPositive = isExit ? side === 'SHORT' : side !== 'SHORT';
          const isMacdAligned = expectPositive ? macdHistValue > 0 : macdHistValue < 0;

          if (fired) {
            if (!isExit) {
              if (side === 'SHORT' && macdHistValue >= 0) {
                fired = false;
                macdRejected = true;
              } else if (side === 'LONG' && macdHistValue <= 0) {
                fired = false;
                macdRejected = true;
              }
            } else {
              if (side === 'SHORT' && macdHistValue <= 0) {
                fired = false;
                macdRejected = true;
              } else if (side === 'LONG' && macdHistValue >= 0) {
                fired = false;
                macdRejected = true;
              }
            }
          }

          if (!minimal) {
            macdFilterMeta = {
              enabled: true,
              mode: 'ema_filter',
              fast: mFast,
              slow: mSlow,
              signal: mSig,
              histogram: roundTo(macdHistValue, 8),
              prev_histogram: roundTo(prevHistVal, 8),
              recent_hist: macdRes.histogram.slice(Math.max(0, idx - 5), idx + 1).map((v) => roundTo(v, 8)),
              aligned: isMacdAligned,
              rejected: macdRejected,
              expected_sign: expectPositive ? 'positive' : 'negative',
              expected_label: expectPositive ? 'Green (+Hist)' : 'Red (-Hist)',
              gates: [
                {
                  key: 'macd_hist',
                  label: `MACD(${mFast}/${mSlow}/${mSig}) ${expectPositive ? '> 0 (Green)' : '< 0 (Red)'}`,
                  passed: isMacdAligned,
                  rejected: macdRejected,
                  value: this.formatAdaptiveNumber(macdHistValue, true),
                },
              ],
            };
          }
        }
      }

      if (minimal) return fired;

      let status: 'approaching' | 'fired' | 'blocked' | 'stale';
      if (fired) {
        status = 'fired';
      } else if (macdRejected) {
        status = 'blocked';
      } else if (isOnSatisfiedSide && !isCrossEvent) {
        status = 'stale';
      } else {
        status = 'approaching';
      }

      let description = `EMA(${fastPeriod}) crossed EMA(${slowPeriod})`;
      if (macdRejected) {
        const expectedColor = purpose === 'exit'
          ? (side === 'SHORT' ? 'Green' : 'Red')
          : (side === 'SHORT' ? 'Red' : 'Green');
        description = `EMA(${fastPeriod}) crossed EMA(${slowPeriod}), but rejected by MACD histogram (${this.formatAdaptiveNumber(macdHistValue, false)} is ${macdHistValue >= 0 ? 'Green' : 'Red'}, expected ${expectedColor})`;
      } else if (status === 'stale') {
        description = `EMA(${fastPeriod}) already crossed EMA(${slowPeriod}) (Fast ${this.formatAdaptiveNumber(currFast)} vs Slow ${this.formatAdaptiveNumber(currSlow)}) — doesn't pass until cross resets`;
      } else if (status === 'approaching') {
        description = `Awaiting EMA(${fastPeriod}) cross EMA(${slowPeriod}) (Fast ${this.formatAdaptiveNumber(currFast)} vs Slow ${this.formatAdaptiveNumber(currSlow)})`;
      }

      return {
        fired,
        status,
        value: roundTo(currFast, 8),
        threshold: roundTo(currSlow, 8),
        prevFast: roundTo(prevFast, 8),
        prevSlow: roundTo(prevSlow, 8),
        insufficientData: fastRes.insufficientData || slowRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Dual Cross' : 'Entry EMA Dual Cross',
        description,
        threshold_is_price: true,
        slPrice: roundTo(currSlow, 8),
        rejected: macdRejected,
        ...(macdFilterMeta ? { macd_filter: macdFilterMeta } : {}),
      };
    } catch (error) {
      this.logger.debug(`EMA Dual Cross signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: passedCandles?.[passedCandles.length - 1]?.close || 0, threshold: 0, unit: 'error', metric: 'EMA Dual', description: 'Signal error', threshold_is_price: true };
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
    signalType?: string,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const signalTypeKey = signalType || arguments[7] || 'ema_dual_close';
      const baseType = 'ema_dual_close';

      const fastVal = purpose === 'exit'
        ? this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_fast', this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_fast', '9'))
        : this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_fast', this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_fast', '9'));
      const slowVal = purpose === 'exit'
        ? this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_slow', this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_slow', '21'))
        : this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_slow', this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_slow', '21'));

      const fastPeriod = parseInt(String(fastVal || '9'), 10) || 9;
      const slowPeriod = parseInt(String(slowVal || '21'), 10) || 21;

      const maxPeriod = Math.max(fastPeriod, slowPeriod);
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);

      // We need at least one completed candle after warmup
      if (candles.length < maxPeriod + 2) {
        return {
          fired: false,
          value: candles[candles.length - 1]?.close || 0,
          threshold: 0,
          unit: 'price',
          metric: 'EMA Dual Close',
          description: 'Insufficient candle data',
          insufficientData: true,
          threshold_is_price: true,
        };
      }

      // Use the last COMPLETED candle (index len - 2)
      const completedCandleIdx = candles.length - 2;
      const completedClose = candles[completedCandleIdx].close;

      const fastRes = this.calculateEMAAt(candles, completedCandleIdx, fastPeriod, interval, symbol);
      const slowRes = this.calculateEMAAt(candles, completedCandleIdx, slowPeriod, interval, symbol);

      const fastEma = fastRes.value;
      const slowEma = slowRes.value;

      // Calculate prevFast and prevSlow for exit estimation spread velocity
      const prevCompletedCandleIdx = completedCandleIdx - 1;
      let prevFast = fastEma;
      let prevSlow = slowEma;
      if (prevCompletedCandleIdx >= 0) {
        prevFast = this.calculateEMAAt(candles, prevCompletedCandleIdx, fastPeriod, interval, symbol).value;
        prevSlow = this.calculateEMAAt(candles, prevCompletedCandleIdx, slowPeriod, interval, symbol).value;
      }

      let fired = false;
      if (purpose === 'entry') {
        if (side === 'LONG') fired = fastEma > slowEma;
        else if (side === 'SHORT') fired = fastEma < slowEma;
        else fired = true;
      } else {
        // Exit: EMA trend inverted
        if (side === 'LONG') fired = fastEma < slowEma;
        else if (side === 'SHORT') fired = fastEma > slowEma;
        else fired = false;
      }
      const closedEmaAligned = fired;

      const macdFilter = this.resolveSignalParam(params, signalTypeKey, 'ema_dual_close', 'ema_dual_macd_filter', false);
      let macdRejected = false;
      let macdHistValue = 0;
      let macdFilterMeta: any = undefined;

      if ((fired || !minimal) && (macdFilter === true || macdFilter === 'true')) {
        const mFast = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual_close', 'macd_fast', '12')), 10);
        const mSlow = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual_close', 'macd_slow', '26')), 10);
        const mSig = parseInt(String(this.resolveSignalParam(params, signalTypeKey, 'ema_dual_close', 'macd_signal', '9')), 10);

        const macdRes = this.calculateMACD(candles, mFast, mSlow, mSig, symbol, interval);
        if (!macdRes.insufficientData && macdRes.histogram.length > 1) {
          const idx = macdRes.histogram.length - 2; // Last completed candle
          macdHistValue = macdRes.histogram[idx];
          const prevHistVal = idx >= 1 ? macdRes.histogram[idx - 1] : 0;
          const isExit = purpose === 'exit';
          const expectPositive = isExit ? side === 'SHORT' : side !== 'SHORT';
          const isMacdAligned = expectPositive ? macdHistValue > 0 : macdHistValue < 0;

          if (fired) {
            if (!isExit) {
              if (side === 'SHORT' && macdHistValue >= 0) {
                fired = false;
                macdRejected = true;
              } else if (side === 'LONG' && macdHistValue <= 0) {
                fired = false;
                macdRejected = true;
              }
            } else {
              if (side === 'SHORT' && macdHistValue <= 0) {
                fired = false;
                macdRejected = true;
              } else if (side === 'LONG' && macdHistValue >= 0) {
                fired = false;
                macdRejected = true;
              }
            }
          }

          if (!minimal) {
            macdFilterMeta = {
              enabled: true,
              mode: 'ema_filter',
              fast: mFast,
              slow: mSlow,
              signal: mSig,
              histogram: roundTo(macdHistValue, 8),
              prev_histogram: roundTo(prevHistVal, 8),
              recent_hist: macdRes.histogram.slice(Math.max(0, idx - 5), idx + 1).map((v) => roundTo(v, 8)),
              aligned: isMacdAligned,
              rejected: macdRejected,
              expected_sign: expectPositive ? 'positive' : 'negative',
              expected_label: expectPositive ? 'Green (+Hist)' : 'Red (-Hist)',
              gates: [
                {
                  key: 'macd_hist',
                  label: `MACD(${mFast}/${mSlow}/${mSig}) ${expectPositive ? '> 0 (Green)' : '< 0 (Red)'}`,
                  passed: isMacdAligned,
                  rejected: macdRejected,
                  value: this.formatAdaptiveNumber(macdHistValue, true),
                },
              ],
            };
          }
        }
      }

      if (minimal) return fired;

      let description = `Last closed candle (${this.formatAdaptiveNumber(completedClose)}) ${fired ? 'is' : 'not'} favorably aligned with EMA(${fastPeriod}) and EMA(${slowPeriod})`;
      if (macdRejected) {
        const expectedColor = purpose === 'exit'
          ? (side === 'SHORT' ? 'Green' : 'Red')
          : (side === 'SHORT' ? 'Red' : 'Green');
        description = `Closed candle aligned with EMA(${fastPeriod}/${slowPeriod}), but rejected by MACD histogram (${this.formatAdaptiveNumber(macdHistValue, false)} is ${macdHistValue >= 0 ? 'Green' : 'Red'}, expected ${expectedColor})`;
      }

      const formingCandle = candles[candles.length - 1];
      const liveClose = formingCandle?.close ?? completedClose;
      const liveFastRes = this.calculateEMAAt(candles, candles.length - 1, fastPeriod, interval, symbol);
      const liveSlowRes = this.calculateEMAAt(candles, candles.length - 1, slowPeriod, interval, symbol);
      const liveFast = liveFastRes.value || fastEma;
      const liveSlow = liveSlowRes.value || slowEma;

      let liveEmaAligned = false;
      if (purpose === 'entry') {
        if (side === 'LONG') liveEmaAligned = liveFast > liveSlow;
        else if (side === 'SHORT') liveEmaAligned = liveFast < liveSlow;
        else liveEmaAligned = true;
      } else {
        if (side === 'LONG') liveEmaAligned = liveFast < liveSlow;
        else if (side === 'SHORT') liveEmaAligned = liveFast > liveSlow;
        else liveEmaAligned = false;
      }

      const tfUnit = String(interval || '1m').slice(-1);
      const tfNum = parseInt(String(interval || '1m').slice(0, -1), 10) || 1;
      const tfMs = tfUnit === 'm' ? tfNum * 60000 : tfUnit === 'h' ? tfNum * 3600000 : tfUnit === 'd' ? tfNum * 86400000 : tfUnit === 'w' ? tfNum * 7 * 86400000 : 60000;
      const candleCloseTs = formingCandle?.time && formingCandle.time > 1000000000000
        ? formingCandle.time + tfMs
        : undefined;
      const nowMs = Date.now();
      const trigCloseCountdownMs = candleCloseTs
        ? Math.max(0, candleCloseTs - nowMs)
        : Math.max(0, tfMs - (nowMs % tfMs));
      const candleConfirmState = closedEmaAligned
        ? 'closed_beyond'
        : (liveEmaAligned ? 'wicked_only' : 'below');

      return {
        fired,
        status: fired ? 'fired' : macdRejected ? 'blocked' : 'approaching',
        value: roundTo(fastEma, 8),
        threshold: roundTo(slowEma, 8),
        closed_value: roundTo(fastEma, 8),
        closed_threshold: roundTo(slowEma, 8),
        closed_fast: roundTo(fastEma, 8),
        closed_slow: roundTo(slowEma, 8),
        closed_close: roundTo(completedClose, 8),
        live_price: roundTo(liveFast, 8),
        live_threshold: roundTo(liveSlow, 8),
        live_fast: roundTo(liveFast, 8),
        live_slow: roundTo(liveSlow, 8),
        live_close: roundTo(liveClose, 8),
        close_wait: true,
        closed_aligned: closedEmaAligned,
        live_aligned: liveEmaAligned,
        candle_confirm_state: candleConfirmState,
        timeframe: interval,
        trig_close_countdown_ms: trigCloseCountdownMs,
        ...(candleCloseTs ? { candle_close_ts: candleCloseTs } : {}),
        insufficientData: fastRes.insufficientData || slowRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Dual Close' : 'Entry EMA Dual Close',
        description,
        threshold_is_price: true,
        slPrice: roundTo(slowEma, 8),
        rejected: macdRejected,
        prevFast: roundTo(prevFast, 8),
        prevSlow: roundTo(prevSlow, 8),
        ...(macdFilterMeta ? { macd_filter: macdFilterMeta } : {}),
      };
    } catch (error) {
      this.logger.debug(`EMA Dual Close signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: passedCandles?.[passedCandles.length - 1]?.close || 0,
        threshold: 0,
        unit: 'error',
        metric: 'EMA Dual Close',
        description: 'Signal error',
        threshold_is_price: true
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
    signalType?: string,
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const signalTypeKey = signalType || arguments[7] || 'ema_close';
      const baseType = 'ema_close';
      const rawPeriod = purpose === 'exit'
        ? this.resolveSignalParam(params, signalTypeKey, baseType, 'exit_ema_period', this.resolveSignalParam(params, signalTypeKey, baseType, 'ema_period', '12'))
        : this.resolveSignalParam(params, signalTypeKey, baseType, 'entry_ema_period', this.resolveSignalParam(params, signalTypeKey, baseType, 'ema_period', '12'));
      const period = parseInt(String(rawPeriod || '12'), 10) || 12;

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      if (candles.length < period + 2) {
        return {
          fired: false,
          value: candles[candles.length - 1]?.close || 0,
          threshold: 0,
          unit: 'price',
          metric: 'EMA Close',
          description: 'Insufficient candle data',
          insufficientData: true,
          threshold_is_price: true,
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

      const formingCandle = candles[candles.length - 1];
      const liveClose = formingCandle?.close ?? completedClose;
      const liveEmaRes = this.calculateEMAAt(candles, candles.length - 1, period, interval, symbol);
      const liveEma = liveEmaRes.value || ema;

      let liveAligned = false;
      if (purpose === 'entry') {
        if (side === 'LONG') liveAligned = liveClose > liveEma;
        else if (side === 'SHORT') liveAligned = liveClose < liveEma;
        else liveAligned = true;
      } else {
        if (side === 'LONG') liveAligned = liveClose < liveEma;
        else if (side === 'SHORT') liveAligned = liveClose > liveEma;
        else liveAligned = false;
      }

      const tfUnit = String(interval || '1m').slice(-1);
      const tfNum = parseInt(String(interval || '1m').slice(0, -1), 10) || 1;
      const tfMs = tfUnit === 'm' ? tfNum * 60000 : tfUnit === 'h' ? tfNum * 3600000 : tfUnit === 'd' ? tfNum * 86400000 : tfUnit === 'w' ? tfNum * 7 * 86400000 : 60000;
      const candleCloseTs = formingCandle?.time && formingCandle.time > 1000000000000
        ? formingCandle.time + tfMs
        : undefined;
      const nowMs = Date.now();
      const trigCloseCountdownMs = candleCloseTs
        ? Math.max(0, candleCloseTs - nowMs)
        : Math.max(0, tfMs - (nowMs % tfMs));
      const candleConfirmState = fired
        ? 'closed_beyond'
        : (liveAligned ? 'wicked_only' : 'below');

      return {
        fired,
        status: fired ? 'fired' : 'approaching',
        value: roundTo(completedClose, 8),
        closed_value: roundTo(completedClose, 8),
        threshold: roundTo(ema, 8),
        closed_threshold: roundTo(ema, 8),
        live_price: roundTo(liveClose, 8),
        live_threshold: roundTo(liveEma, 8),
        close_wait: true,
        closed_aligned: fired,
        live_aligned: liveAligned,
        candle_confirm_state: candleConfirmState,
        timeframe: interval,
        trig_close_countdown_ms: trigCloseCountdownMs,
        ...(candleCloseTs ? { candle_close_ts: candleCloseTs } : {}),
        insufficientData: emaRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Close' : 'Entry EMA Close',
        description: `Last closed candle (${this.formatAdaptiveNumber(completedClose)}) ${fired ? 'is' : 'not'} favorably aligned with EMA(${period})`,
        threshold_is_price: true,
        slPrice: roundTo(ema, 8),
      };
    } catch (error) {
      this.logger.debug(`EMA Close signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: passedCandles?.[passedCandles.length - 1]?.close || 0,
        threshold: 0,
        unit: 'error',
        metric: 'EMA Close',
        description: 'Signal error',
        threshold_is_price: true,
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

    const firstCandleTime = candles[0]?.time ?? 0;
    const targetCandle = candles[index];
    const isBacktestKey = Boolean(symbol && symbol.startsWith('__bt__:'));
    const cacheKey = symbol ? `${symbol}:${interval}:${period}:${firstCandleTime}:${targetCandle.time}:${targetCandle.close}:${len}:dual` : null;
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
    const stableKey = (symbol && !isBacktestKey) ? `${symbol}:${interval}:${period}` : null;
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
        if (this.emaStableCache.size > 1000) {
          const iter = this.emaStableCache.keys();
          for (let i = 0; i < 100; i++) {
            const next = iter.next();
            if (next.done) break;
            this.emaStableCache.delete(next.value);
          }
        }
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
    const isBacktestKey = Boolean(symbol && symbol.startsWith('__bt__:'));
    const stableKey = (symbol && !isBacktestKey && interval && period && isCompletedUpdate) ? `${symbol}:${interval}:${period}` : null;
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

    const firstCandleTime = candles[0]?.time ?? 0;
    const targetCandle = candles[index];
    const isBacktestKey = Boolean(symbol && symbol.startsWith('__bt__:'));
    const cacheKey = symbol ? `${symbol}:${interval}:${period}:${firstCandleTime}:${targetCandle.time}:${targetCandle.close}:${len}` : null;
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
    const stableKey = (symbol && !isBacktestKey) ? `${symbol}:${interval}:${period}` : null;
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
        if (this.emaStableCache.size > 1000) {
          const iter = this.emaStableCache.keys();
          for (let i = 0; i < 100; i++) {
            const next = iter.next();
            if (next.done) break;
            this.emaStableCache.delete(next.value);
          }
        }
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
   * BOLT OPTIMIZATION: Calculates scalar MACD Histogram value at a specific offset from the end (0 = latest, 1 = completed)
   * by delegating to calculateMACD (utilizing O(1) cache lookups when available) to eliminate array allocations and redundant iterations.
   */
  public calculateMACDLast(
    candles: Candle[],
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
    symbol?: string,
    interval?: string,
    offsetFromEnd: number = 0,
  ): { macdLine: number; signalLine: number; histogram: number; insufficientData: boolean } {
    const res = this.calculateMACD(candles, fastPeriod, slowPeriod, signalPeriod, symbol, interval);
    if (res.insufficientData || !res.histogram || res.histogram.length <= offsetFromEnd) {
      return { macdLine: 0, signalLine: 0, histogram: 0, insufficientData: true };
    }
    const idx = res.histogram.length - 1 - offsetFromEnd;
    return {
      macdLine: res.macdLine[idx],
      signalLine: res.signalLine[idx],
      histogram: res.histogram[idx],
      insufficientData: false,
    };
  }

  /**
   * Calculates MACD values (MACD Line, Signal Line, and Histogram) matching standard mathematical definitions.
   * Designed with O(1) loop structures, no external library allocations, and stable O(1) caching.
   */
  public calculateMACD(
    candles: Candle[],
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
    symbol?: string,
    interval?: string,
  ): { macdLine: number[]; signalLine: number[]; histogram: number[]; insufficientData: boolean } {
    const len = candles.length;
    const minNeeded = Math.max(fastPeriod, slowPeriod) + signalPeriod;
    const insufficientData = len < minNeeded * 2;

    if (len < minNeeded) {
      // For short lengths, return zero-filled arrays to prevent returning uninitialized values
      const macdLine = new Array<number>(len).fill(0);
      const signalLine = new Array<number>(len).fill(0);
      const histogram = new Array<number>(len).fill(0);
      return { macdLine, signalLine, histogram, insufficientData: true };
    }

    // BOLT OPTIMIZATION: Check stable cache BEFORE allocating output arrays
    const firstCandle = candles[0];
    const midCandle = candles[Math.floor(len / 2)];
    const lastCandle = candles[len - 1];
    const cacheKey = symbol && interval ?
      `${symbol}:${interval}:${fastPeriod}:${slowPeriod}:${signalPeriod}:${len}:${firstCandle.time}:${midCandle.time}:${lastCandle.time}:${lastCandle.close}` :
      `anon:${fastPeriod}:${slowPeriod}:${signalPeriod}:${len}:${firstCandle.time}:${midCandle.time}:${lastCandle.time}:${lastCandle.close}`;

    const cached = this.macdCache.get(cacheKey);
    if (cached) return cached;

    // Allocate arrays ONLY on cache miss
    const macdLine = new Array<number>(len);
    const signalLine = new Array<number>(len);
    const histogram = new Array<number>(len);

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

    // BOLT OPTIMIZATION: Loop splitting to completely avoid branching instructions inside the hot loop.
    if (slowPeriod >= fastPeriod) {
      // 1. i = 0 to fastPeriod - 2
      const limit1 = fastPeriod - 1;
      for (let i = 0; i < limit1; i++) {
        macdLine[i] = 0;
      }

      // 2. i = fastPeriod - 1
      fastEma = fastSum / fastPeriod;
      macdLine[limit1] = fastEma;

      // 3. i = fastPeriod to slowPeriod - 2
      const limit2 = slowPeriod - 1;
      for (let i = fastPeriod; i < limit2; i++) {
        fastEma += fastMult * (candles[i].close - fastEma);
        macdLine[i] = fastEma;
      }

      // 4. i = slowPeriod - 1
      if (limit2 >= fastPeriod) {
        fastEma += fastMult * (candles[limit2].close - fastEma);
      }
      slowEma = slowSum / slowPeriod;
      macdLine[limit2] = fastEma - slowEma;

      // 5. i = slowPeriod to len - 1
      for (let i = slowPeriod; i < len; i++) {
        fastEma += fastMult * (candles[i].close - fastEma);
        slowEma += slowMult * (candles[i].close - slowEma);
        macdLine[i] = fastEma - slowEma;
      }
    } else {
      // Fallback path in case parameters are inverted/invalid (slowPeriod < fastPeriod)
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
    }

    // Now, calculate Signal EMA of MACD Line.
    // The MACD line is fully mature starting from slowPeriod - 1.
    const startIdx = slowPeriod - 1;
    let signalSum = 0;
    for (let i = startIdx; i < startIdx + signalPeriod; i++) {
      signalSum += macdLine[i];
    }
    let signalEma = signalSum / signalPeriod;

    // BOLT OPTIMIZATION: Loop splitting for the second loop as well to eliminate branching checks.
    const limit = startIdx + signalPeriod - 1;

    // 1. i = 0 to limit - 1
    for (let i = 0; i < limit; i++) {
      signalLine[i] = 0;
      histogram[i] = 0;
    }

    // 2. i = limit
    signalLine[limit] = signalEma;
    histogram[limit] = macdLine[limit] - signalEma;

    // 3. i = limit + 1 to len - 1
    for (let i = limit + 1; i < len; i++) {
      signalEma += signalMult * (macdLine[i] - signalEma);
      signalLine[i] = signalEma;
      histogram[i] = macdLine[i] - signalEma;
    }

    const result = { macdLine, signalLine, histogram, insufficientData };

    // Bounded cache eviction (O(1) iterator eviction instead of O(N) Array.from)
    if (this.macdCache.size >= 1000) {
      const iter = this.macdCache.keys();
      for (let i = 0; i < 100; i++) {
        const next = iter.next();
        if (next.done) break;
        this.macdCache.delete(next.value);
      }
    }
    this.macdCache.set(cacheKey, result);

    return result;
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
    signalType: string = 'macd_impulse',
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const fastPeriod = parseInt(String(this.resolveSignalParam(params, signalType, 'macd_impulse', 'macd_fast', '12')), 10) || 12;
      const slowPeriod = parseInt(String(this.resolveSignalParam(params, signalType, 'macd_impulse', 'macd_slow', '26')), 10) || 26;
      const signalPeriod = parseInt(String(this.resolveSignalParam(params, signalType, 'macd_impulse', 'macd_signal', '9')), 10) || 9;
      const strictExpansionVal = this.resolveSignalParam(params, signalType, 'macd_impulse', 'macd_strict_expansion', true);
      const strictExpansion = strictExpansionVal === true || strictExpansionVal === 'true';
      const maxEntryCandle = Math.min(2, Math.max(1, parseInt(String(
        this.resolveSignalParam(params, signalType, 'macd_impulse', 'macd_impulse_max_entry_candle', 2)
      ), 10) || 2));

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
        symbol,
        interval,
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
      const prevHist = histogram[histogram.length - 2] ?? 0;
      const recentHist = histogram.slice(-6).map((v) => roundTo(v, 8));

      let fired = false;
      let count = 0;
      let description = '';
      let rejected = false;
      let strictExpansionPassed = !strictExpansion;
      let strictRefHist = prevHist;

      if (side === 'LONG') {
        if (currHist <= 0) {
          if (minimal) return false;
          return {
            fired: false,
            value: 0,
            threshold: 1,
            unit: 'bars',
            metric: 'MACD Impulse',
            description: `Histogram is not bullish (Green) | Value: ${roundTo(currHist, 8)}`,
            macd_filter: {
              enabled: true,
              mode: 'macd_impulse',
              fast: fastPeriod,
              slow: slowPeriod,
              signal: signalPeriod,
              histogram: roundTo(currHist, 8),
              prev_histogram: roundTo(prevHist, 8),
              recent_hist: recentHist,
              aligned: false,
              rejected: false,
              expected_sign: 'positive',
              expected_label: 'Green (+Hist)',
              gates: [
                {
                  key: 'hist_color',
                  label: 'Hist > 0 (Green)',
                  passed: false,
                  value: `${currHist >= 0 ? '+' : ''}${roundTo(currHist, 6)}`,
                },
                {
                  key: 'bar_window',
                  label: `Window (1–${maxEntryCandle} bars)`,
                  passed: false,
                  value: `0 / ${maxEntryCandle} bars`,
                },
                ...(strictExpansion
                  ? [
                      {
                        key: 'strict_expansion',
                        label: 'Strict Expansion',
                        passed: false,
                        value: 'Awaiting +Hist',
                      },
                    ]
                  : []),
              ],
            },
          };
        }

        // Count consecutive green bars backward
        let idx = histogram.length - 1;
        while (idx >= 0 && histogram[idx] > 0) {
          count++;
          idx--;
        }

        if (count >= 1 && count <= maxEntryCandle) {
          fired = true;
          description = `MACD Impulse Green #${count}`;

          if (strictExpansion) {
            if (count === 1) {
              const prevRed = idx >= 0 ? histogram[idx] : 0;
              strictRefHist = prevRed;
              strictExpansionPassed = currHist > Math.abs(prevRed);
              if (!strictExpansionPassed) {
                fired = false;
                rejected = true;
                description = `Rejected: Green #1 (${roundTo(currHist, 8)}) is not strictly expanding over previous Red (${roundTo(prevRed, 8)})`;
              }
            } else { // count === 2
              const prevGreen = histogram[histogram.length - 2];
              strictRefHist = prevGreen;
              strictExpansionPassed = currHist > prevGreen;
              if (!strictExpansionPassed) {
                fired = false;
                rejected = true;
                description = `Rejected: Green #2 (${roundTo(currHist, 8)}) is not expanding over Green #1 (${roundTo(prevGreen, 8)})`;
              }
            }
          }
        } else {
          fired = false;
          rejected = count > maxEntryCandle;
          description = `Rejected: Green bar count is ${count} (Entry Window: 1-${maxEntryCandle})`;
        }
      } else if (side === 'SHORT') {
        if (currHist >= 0) {
          if (minimal) return false;
          return {
            fired: false,
            value: 0,
            threshold: 1,
            unit: 'bars',
            metric: 'MACD Impulse',
            description: `Histogram is not bearish (Red) | Value: ${roundTo(currHist, 8)}`,
            macd_filter: {
              enabled: true,
              mode: 'macd_impulse',
              fast: fastPeriod,
              slow: slowPeriod,
              signal: signalPeriod,
              histogram: roundTo(currHist, 8),
              prev_histogram: roundTo(prevHist, 8),
              recent_hist: recentHist,
              aligned: false,
              rejected: false,
              expected_sign: 'negative',
              expected_label: 'Red (-Hist)',
              gates: [
                {
                  key: 'hist_color',
                  label: 'Hist < 0 (Red)',
                  passed: false,
                  value: `${currHist >= 0 ? '+' : ''}${roundTo(currHist, 6)}`,
                },
                {
                  key: 'bar_window',
                  label: `Window (1–${maxEntryCandle} bars)`,
                  passed: false,
                  value: `0 / ${maxEntryCandle} bars`,
                },
                ...(strictExpansion
                  ? [
                      {
                        key: 'strict_expansion',
                        label: 'Strict Expansion',
                        passed: false,
                        value: 'Awaiting -Hist',
                      },
                    ]
                  : []),
              ],
            },
          };
        }

        // Count consecutive red bars backward
        let idx = histogram.length - 1;
        while (idx >= 0 && histogram[idx] < 0) {
          count++;
          idx--;
        }

        if (count >= 1 && count <= maxEntryCandle) {
          fired = true;
          description = `MACD Impulse Red #${count}`;

          if (strictExpansion) {
            if (count === 1) {
              const prevGreen = idx >= 0 ? histogram[idx] : 0;
              strictRefHist = prevGreen;
              strictExpansionPassed = Math.abs(currHist) > Math.abs(prevGreen);
              if (!strictExpansionPassed) {
                fired = false;
                rejected = true;
                description = `Rejected: Red #1 (${roundTo(currHist, 8)}) is not strictly expanding over previous Green (${roundTo(prevGreen, 8)})`;
              }
            } else { // count === 2
              const prevRed = histogram[histogram.length - 2];
              strictRefHist = prevRed;
              strictExpansionPassed = Math.abs(currHist) > Math.abs(prevRed);
              if (!strictExpansionPassed) {
                fired = false;
                rejected = true;
                description = `Rejected: Red #2 (${roundTo(currHist, 8)}) is not expanding over Red #1 (${roundTo(prevRed, 8)})`;
              }
            }
          }
        } else {
          fired = false;
          rejected = count > maxEntryCandle;
          description = `Rejected: Red bar count is ${count} (Entry Window: 1-${maxEntryCandle})`;
        }
      }

      if (minimal) return fired;

      const isAlignedColor = side === 'SHORT' ? currHist < 0 : currHist > 0;
      const windowPassed = count >= 1 && count <= maxEntryCandle;

      return {
        fired,
        rejected,
        status: fired ? 'fired' : rejected ? 'blocked' : 'approaching',
        value: count,
        threshold: maxEntryCandle,
        insufficientData,
        unit: 'bars',
        metric: 'MACD Impulse',
        description,
        macd_filter: {
          enabled: true,
          mode: 'macd_impulse',
          fast: fastPeriod,
          slow: slowPeriod,
          signal: signalPeriod,
          histogram: roundTo(currHist, 8),
          prev_histogram: roundTo(prevHist, 8),
          recent_hist: recentHist,
          bar_count: count,
          max_entry_candle: maxEntryCandle,
          strict_expansion: strictExpansion,
          aligned: fired,
          rejected,
          expected_sign: side === 'SHORT' ? 'negative' : 'positive',
          expected_label: side === 'SHORT' ? 'Red (-Hist)' : 'Green (+Hist)',
          gates: [
            {
              key: 'hist_color',
              label: side === 'SHORT' ? 'Hist < 0 (Red)' : 'Hist > 0 (Green)',
              passed: isAlignedColor,
              value: `${currHist >= 0 ? '+' : ''}${roundTo(currHist, 6)}`,
            },
            {
              key: 'bar_window',
              label: `Window (1–${maxEntryCandle} bars)`,
              passed: windowPassed,
              rejected: count > maxEntryCandle,
              value: `Bar #${count} / ${maxEntryCandle}`,
            },
            ...(strictExpansion
              ? [
                  {
                    key: 'strict_expansion',
                    label: 'Strict Expansion',
                    passed: windowPassed && strictExpansionPassed,
                    rejected: windowPassed && !strictExpansionPassed,
                    value: `${roundTo(Math.abs(currHist), 5)} vs ${roundTo(Math.abs(strictRefHist), 5)}`,
                  },
                ]
              : []),
          ],
        },
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
    signalType: string = 'macd_pbc',
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const fastPeriod = parseInt(String(this.resolveSignalParam(params, signalType, 'macd_pbc', 'macd_fast', config.macd_fast || '12')), 10) || 12;
      const slowPeriod = parseInt(String(this.resolveSignalParam(params, signalType, 'macd_pbc', 'macd_slow', config.macd_slow || '26')), 10) || 26;
      const signalPeriod = parseInt(String(this.resolveSignalParam(params, signalType, 'macd_pbc', 'macd_signal', config.macd_signal || '9')), 10) || 9;
      const trendEmaPeriod = parseInt(String(this.resolveSignalParam(params, signalType, 'macd_pbc', 'macd_pbc_trend_ema', config.macd_pbc_trend_ema || '50')), 10) || 50;
      const lookbackWindow = parseInt(String(this.resolveSignalParam(params, signalType, 'macd_pbc', 'macd_pbc_lookback', config.macd_pbc_lookback || '10')), 10) || 10;
      const maxContinuation = Math.max(1, parseInt(String(this.resolveSignalParam(params, signalType, 'macd_pbc', 'macd_pbc_max_continuation', config.macd_pbc_max_continuation || '2')), 10) || 2);

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      const absoluteMin = Math.max(Math.max(fastPeriod, slowPeriod) + signalPeriod, trendEmaPeriod + 1);
      const minRequired = Math.max((Math.max(fastPeriod, slowPeriod) + signalPeriod) * 2, trendEmaPeriod * 2);

      if (candles.length < absoluteMin) {
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
      const trendAligned = side === 'SHORT' ? !isBullishTrend : isBullishTrend;

      if ((side === 'LONG' && !isBullishTrend) || (side === 'SHORT' && isBullishTrend)) {
        if (minimal) return false;
        const { histogram: earlyHist } = this.calculateMACD(
          candles,
          fastPeriod,
          slowPeriod,
          signalPeriod,
          symbol,
          interval,
        );
        const eLen = earlyHist.length;
        const eCurrHist = eLen > 0 ? earlyHist[eLen - 1] : 0;
        const ePrevHist = eLen > 1 ? earlyHist[eLen - 2] : 0;
        const eSlopeExpanding = side === 'SHORT' ? eCurrHist < ePrevHist : eCurrHist > ePrevHist;
        return {
          fired: false,
          value: roundTo(currentCandle.close, 8),
          threshold: roundTo(trendEma, 8),
          unit: 'price',
          metric: 'MACD PBC',
          description:
            side === 'LONG'
              ? `Price (${currentCandle.close}) is below Trend EMA(${trendEmaPeriod}) (${trendEma.toFixed(4)})`
              : `Price (${currentCandle.close}) is above Trend EMA(${trendEmaPeriod}) (${trendEma.toFixed(4)})`,
          threshold_is_price: true,
          macd_filter: {
            enabled: true,
            mode: 'macd_pbc',
            fast: fastPeriod,
            slow: slowPeriod,
            signal: signalPeriod,
            histogram: roundTo(eCurrHist, 8),
            prev_histogram: roundTo(ePrevHist, 8),
            recent_hist: earlyHist.slice(-6).map((v) => roundTo(v, 8)),
            aligned: false,
            rejected: false,
            expected_sign: side === 'SHORT' ? 'negative' : 'positive',
            expected_label: side === 'SHORT' ? 'Expanding -Slope' : 'Expanding +Slope',
            gates: [
              {
                key: 'trend_ema',
                label: `Trend EMA(${trendEmaPeriod})`,
                passed: false,
                value: `${roundTo(currentCandle.close, 4)} vs ${roundTo(trendEma, 4)}`,
              },
              {
                key: 'pullback',
                label: `Pullback (${lookbackWindow}b)`,
                passed: false,
                value: 'Blocked by Trend',
              },
              {
                key: 'slope',
                label: side === 'SHORT' ? 'Slope (< Prev)' : 'Slope (> Prev)',
                passed: eSlopeExpanding,
                value: `${roundTo(ePrevHist, 5)} → ${roundTo(eCurrHist, 5)}`,
              },
              {
                key: 'cont_window',
                label: `Window (1–${maxContinuation}b)`,
                passed: false,
                value: `0 / ${maxContinuation}`,
              },
            ],
          },
        };
      }

      // 2. Calculate MACD Histogram
      const { histogram, insufficientData } = this.calculateMACD(
        candles,
        fastPeriod,
        slowPeriod,
        signalPeriod,
        symbol,
        interval,
      );

      const hLen = histogram.length;
      const currHist = histogram[hLen - 1];
      const prevHist = histogram[hLen - 2];

      let fired = false;
      let rejected = false;
      let continuationCount = 0;
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

      let hadPullback = false;
      const startScan = hLen - 2;
      const endScan = Math.max(1, hLen - 1 - lookbackWindow);
      for (let i = startScan; i >= endScan; i--) {
        const histPrev = histogram[i];
        const histPrevPrev = histogram[i - 1];
        if (side === 'LONG') {
          if (histPrev < histPrevPrev) {
            hadPullback = true;
            break;
          }
        } else {
          if (histPrev > histPrevPrev) {
            hadPullback = true;
            break;
          }
        }
      }

      const slopeExpanding = side === 'SHORT' ? currHist < prevHist : currHist > prevHist;

      if (side === 'LONG') {
        const isExpandingPositive = currHist > prevHist;

        if (isExpandingPositive && hadPullback) {
          let idx = hLen - 1;
          while (idx >= 1 && histogram[idx] > histogram[idx - 1]) {
            continuationCount++;
            idx--;
          }

          if (purpose !== 'exit' && continuationCount > maxContinuation) {
            fired = false;
            rejected = true;
            description = `Rejected: MACD PBC continuation candle count is ${continuationCount} (Entry Window: 1-${maxContinuation})`;
          } else {
            fired = true;
            description = `MACD Pullback-to-Continuation LONG confirmed. Slope reversed: ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}. Stop-Loss armed at Swing Low: ${roundTo(slPrice, 8)}`;
          }
        } else if (!isExpandingPositive) {
          description = `Histogram is not expanding positive: ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}`;
        } else {
          description = `No pullback detected in prior ${lookbackWindow} bars`;
        }
      } else if (side === 'SHORT') {
        const isExpandingNegative = currHist < prevHist;

        if (isExpandingNegative && hadPullback) {
          let idx = hLen - 1;
          while (idx >= 1 && histogram[idx] < histogram[idx - 1]) {
            continuationCount++;
            idx--;
          }

          if (purpose !== 'exit' && continuationCount > maxContinuation) {
            fired = false;
            rejected = true;
            description = `Rejected: MACD PBC continuation candle count is ${continuationCount} (Entry Window: 1-${maxContinuation})`;
          } else {
            fired = true;
            description = `MACD Pullback-to-Continuation SHORT confirmed. Slope reversed: ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}. Stop-Loss armed at Swing High: ${roundTo(slPrice, 8)}`;
          }
        } else if (!isExpandingNegative) {
          description = `Histogram is not expanding negative: ${roundTo(prevHist, 8)} -> ${roundTo(currHist, 8)}`;
        } else {
          description = `No pullback detected in prior ${lookbackWindow} bars`;
        }
      }

      if (minimal) return fired;

      const triggerPatternHigh = roundTo(currentCandle.high, 8);
      const triggerPatternLow = roundTo(currentCandle.low, 8);
      const triggerBodyHigh = roundTo(Math.max(currentCandle.open, currentCandle.close), 8);
      const triggerBodyLow = roundTo(Math.min(currentCandle.open, currentCandle.close), 8);

      return {
        fired,
        rejected,
        status: fired ? 'fired' : rejected ? 'blocked' : 'approaching',
        value: roundTo(currHist, 8),
        threshold: roundTo(prevHist, 8),
        insufficientData: insufficientData || emaRes.insufficientData || (candles.length < minRequired),
        unit: 'histogram',
        metric: 'MACD PBC',
        description,
        slPrice: fired ? roundTo(slPrice, 8) : undefined,
        pattern_high: fired ? triggerPatternHigh : undefined,
        pattern_low: fired ? triggerPatternLow : undefined,
        body_high: fired ? triggerBodyHigh : undefined,
        body_low: fired ? triggerBodyLow : undefined,
        macd_filter: {
          enabled: true,
          mode: 'macd_pbc',
          fast: fastPeriod,
          slow: slowPeriod,
          signal: signalPeriod,
          histogram: roundTo(currHist, 8),
          prev_histogram: roundTo(prevHist, 8),
          recent_hist: histogram.slice(-6).map((v) => roundTo(v, 8)),
          aligned: fired,
          rejected,
          expected_sign: side === 'SHORT' ? 'negative' : 'positive',
          expected_label: side === 'SHORT' ? 'Expanding -Slope' : 'Expanding +Slope',
          gates: [
            {
              key: 'trend_ema',
              label: `Trend EMA(${trendEmaPeriod})`,
              passed: trendAligned,
              value: `${roundTo(currentCandle.close, 4)} ${side === 'SHORT' ? '<' : '>'} ${roundTo(trendEma, 4)}`,
            },
            {
              key: 'pullback',
              label: `Pullback (${lookbackWindow}b)`,
              passed: hadPullback,
              value: hadPullback ? 'Detected' : 'Waiting',
            },
            {
              key: 'slope',
              label: side === 'SHORT' ? 'Slope (< Prev)' : 'Slope (> Prev)',
              passed: slopeExpanding,
              value: `${roundTo(prevHist, 5)} → ${roundTo(currHist, 5)}`,
            },
            {
              key: 'cont_window',
              label: `Window (1–${maxContinuation}b)`,
              passed: continuationCount >= 1 && continuationCount <= maxContinuation,
              rejected,
              value: continuationCount > 0 ? `Bar #${continuationCount} / ${maxContinuation}` : `0 / ${maxContinuation}`,
            },
          ],
        },
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
        symbol,
        interval,
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

      const flippedZero = side === 'SHORT' ? currHist > 0 : currHist < 0;
      const contracted2Bars =
        side === 'SHORT'
          ? currHist > prevHist && prevHist > prevPrevHist
          : currHist < prevHist && prevHist < prevPrevHist;

      return {
        fired,
        value: roundTo(currHist, 8),
        threshold: roundTo(prevHist, 8),
        insufficientData,
        unit: '',
        metric: 'MACD Fade',
        description,
        macd_filter: {
          enabled: true,
          mode: 'macd_fade',
          fast: fastPeriod,
          slow: slowPeriod,
          signal: signalPeriod,
          histogram: roundTo(currHist, 8),
          prev_histogram: roundTo(prevHist, 8),
          recent_hist: histogram.slice(-6).map((v) => roundTo(v, 8)),
          aligned: fired,
          rejected: false,
          expected_sign: side === 'SHORT' ? 'positive' : 'negative',
          expected_label: 'Contraction / Flip',
          gates: [
            {
              key: 'color_flip',
              label: side === 'SHORT' ? 'Flipped Green (> 0)' : 'Flipped Red (< 0)',
              passed: flippedZero,
              value: `${currHist >= 0 ? '+' : ''}${roundTo(currHist, 6)}`,
            },
            {
              key: 'contraction_2b',
              label: '2-Bar Contraction',
              passed: contracted2Bars,
              value: `${roundTo(prevPrevHist, 4)}→${roundTo(prevHist, 4)}→${roundTo(currHist, 4)}`,
            },
          ],
        },
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
   * BOLT OPTIMIZATION: Added O(1) stable caching on immutable completed candles to completely eliminate redundant runs on the hot path.
   */
  public calculateSupertrend(
    candles: Candle[],
    period: number,
    multiplier: number,
    symbol?: string,
    interval?: string,
  ): { supertrend: number[]; direction: ('up' | 'down')[]; insufficientData: boolean } {
    const len = candles.length;
    const insufficientData = len < period * 3;

    const supertrend = new Array<number>(len).fill(0);
    const direction = new Array<'up' | 'down'>(len).fill('up');

    if (len < period + 1) {
      return { supertrend, direction, insufficientData: true };
    }

    // BOLT OPTIMIZATION: Check stable cache using robust compound key to avoid collision across assets, timeframes, and parameters
    const firstCandle = candles[0];
    const midCandle = candles[Math.floor(len / 2)];
    const lastCandle = candles[len - 1];
    const cacheKey = symbol && interval ?
      `${symbol}:${interval}:${period}:${multiplier}:${len}:${firstCandle.time}:${midCandle.time}:${lastCandle.time}:${lastCandle.close}` :
      `anon:${period}:${multiplier}:${len}:${firstCandle.time}:${midCandle.time}:${lastCandle.time}:${lastCandle.close}`;

    const cached = this.supertrendCache.get(cacheKey);
    if (cached) return cached;

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

    const result = { supertrend, direction, insufficientData };

    // Bounded cache eviction (O(1) iterator eviction instead of O(N) Array.from)
    if (this.supertrendCache.size >= 1000) {
      const iter = this.supertrendCache.keys();
      for (let i = 0; i < 100; i++) {
        const next = iter.next();
        if (next.done) break;
        this.supertrendCache.delete(next.value);
      }
    }
    this.supertrendCache.set(cacheKey, result);

    return result;
  }

  /**
   * Knife Catch Signal: Quantifies rapid Rate-Of-Change (ROC) acceleration and wick rejection
   */
  public knifeCatchSignal(
    symbol: string,
    config: any,
    interval: string,
    side: 'LONG' | 'SHORT' = 'LONG',
    purpose: 'entry' | 'exit' = 'entry',
    candles?: Candle[],
    minimal = false,
    signalType = 'knife_catch'
  ): boolean | SignalDetail {
    const klines = candles || this.klineStore.getRawCandles(symbol, interval);
    const len = klines.length;

    if (len < 3) {
      if (minimal) return false;
      return { fired: false, value: 0, threshold: 0, unit: '%', metric: 'ROC', description: 'Insufficient data' };
    }

    const params = config.signal_params || {};
    const rocThreshold = parseFloat(String(this.resolveSignalParam(params, signalType, 'knife_catch', 'knife_roc_threshold', '2.0')));
    const wickPctThreshold = parseFloat(String(this.resolveSignalParam(params, signalType, 'knife_catch', 'knife_wick_pct', '30.0')));
    const lookback = parseInt(String(this.resolveSignalParam(params, signalType, 'knife_catch', 'knife_lookback', '3')), 10);

    const curr = klines[len - 1];
    const prevIndex = Math.max(0, len - 1 - lookback);
    const baseCandle = klines[prevIndex];

    if (!baseCandle || baseCandle.close <= 0) {
      if (minimal) return false;
      return { fired: false, value: 0, threshold: rocThreshold, unit: '%', metric: 'ROC', description: 'Invalid candle data' };
    }

    const roc = Math.abs((curr.close - baseCandle.close) / baseCandle.close) * 100;
    const range = curr.high - curr.low;
    let wickPct = 0;

    if (range > 0) {
      const lowerWick = Math.min(curr.open, curr.close) - curr.low;
      const upperWick = curr.high - Math.max(curr.open, curr.close);
      wickPct = side === 'LONG' ? (lowerWick / range) * 100 : (upperWick / range) * 100;
    }

    const fired = roc >= rocThreshold && wickPct >= wickPctThreshold;

    if (minimal) return fired;

    return {
      fired,
      value: roundTo(roc, 2),
      threshold: rocThreshold,
      unit: '%',
      metric: 'ROC %',
      description: fired
        ? `Knife Catch triggered: ROC ${roc.toFixed(2)}% >= ${rocThreshold}%, Wick ${wickPct.toFixed(1)}% >= ${wickPctThreshold}%`
        : `ROC ${roc.toFixed(2)}% / Wick ${wickPct.toFixed(1)}%`,
    };
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
      const period = parseInt(
        params.supertrend_period !== undefined && params.supertrend_period !== null && params.supertrend_period !== ''
          ? String(params.supertrend_period)
          : '10',
        10
      );
      const multiplier = parseFloat(
        params.supertrend_multiplier !== undefined && params.supertrend_multiplier !== null && params.supertrend_multiplier !== ''
          ? String(params.supertrend_multiplier)
          : '3'
      );
      const mode = params.supertrend_mode || 'trend'; // 'trend' | 'crossover'

      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);

      if (candles.length < period + 5) {
        return {
          fired: false,
          value: candles[candles.length - 1]?.close || 0,
          threshold: 0,
          unit: 'price',
          metric: 'Supertrend',
          description: 'Insufficient candle data',
          insufficientData: true,
          threshold_is_price: true,
        };
      }

      const { supertrend, direction, insufficientData } = this.calculateSupertrend(
        candles,
        period,
        multiplier,
        symbol,
        interval,
      );

      // Use the last COMPLETED candle (index len - 2) to prevent whipsaws from live candle fluctuations
      const completedCandleIdx = candles.length - 2;
      const currClose = candles[completedCandleIdx].close;
      const currST = supertrend[completedCandleIdx];
      const currDir = direction[completedCandleIdx];
      const prevDir = direction[completedCandleIdx - 1];

      let fired = false;
      let description = '';

      const isExit = purpose === 'exit';

      if (side === 'LONG') {
        if (isExit) {
          if (mode === 'crossover') {
            fired = prevDir === 'up' && currDir === 'down';
            description = fired ? 'Exit Supertrend crossed bearish (trend reversal)' : 'No bearish crossover for exit';
          } else { // 'trend'
            fired = currDir === 'down';
            description = fired ? 'Exit Supertrend is bearish (trend reversal)' : 'Supertrend is still bullish';
          }
        } else {
          if (mode === 'crossover') {
            fired = prevDir === 'down' && currDir === 'up';
            description = fired ? 'Supertrend crossed bullish (uptrend began)' : 'No bullish crossover';
          } else { // 'trend'
            fired = currDir === 'up';
            description = fired ? 'Supertrend is bullish' : 'Supertrend is bearish';
          }
        }
      } else if (side === 'SHORT') {
        if (isExit) {
          if (mode === 'crossover') {
            fired = prevDir === 'down' && currDir === 'up';
            description = fired ? 'Exit Supertrend crossed bullish (trend reversal)' : 'No bullish crossover for exit';
          } else { // 'trend'
            fired = currDir === 'up';
            description = fired ? 'Exit Supertrend is bullish (trend reversal)' : 'Supertrend is still bearish';
          }
        } else {
          if (mode === 'crossover') {
            fired = prevDir === 'up' && currDir === 'down';
            description = fired ? 'Supertrend crossed bearish (downtrend began)' : 'No bearish crossover';
          } else { // 'trend'
            fired = currDir === 'down';
            description = fired ? 'Supertrend is bearish' : 'Supertrend is bullish';
          }
        }
      }

      if (minimal) return fired;

      const liveClose = candles[candles.length - 1]?.close ?? currClose;

      return {
        fired,
        value: roundTo(currClose, 8),
        closed_value: roundTo(currClose, 8),
        live_price: roundTo(liveClose, 8),
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
        value: passedCandles?.[passedCandles.length - 1]?.close || 0,
        threshold: 0,
        unit: 'price',
        metric: 'Supertrend',
        description: 'Signal error',
        threshold_is_price: true,
      };
    }
  }

  /**
   * HTF / Previous-Day Breakout Signal (PDH / PDL Breakout):
   * Evaluates a trigger candle close (or wick/closed confirmation) against a higher-timeframe
   * reference extreme (e.g. 1h candle close > prev 1d candle high for LONG, < prev 1d low for SHORT).
   */
  public htfBreakoutSignal(
    symbol: string,
    config: any,
    interval: string,
    side: 'LONG' | 'SHORT' = 'LONG',
    purpose: 'entry' | 'exit' = 'entry',
    passedCandles?: Candle[],
    minimal = false,
    signalType = 'htf_breakout',
  ): boolean | SignalDetail {
    try {
      const params = config.signal_params || {};
      const baseType = signalType.startsWith('prev_day_breakout') ? 'prev_day_breakout' : 'htf_breakout';

      // 1. Resolve Timeframes
      const refTf = String(
        this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_ref_timeframe', config.htf_breakout_ref_timeframe || '1d')
      );
      const trigTfConfig = String(
        this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_trigger_timeframe', config.htf_breakout_trigger_timeframe || '1h')
      );
      const effectiveTrigTf = (trigTfConfig === 'default' || !trigTfConfig) ? interval : trigTfConfig;

      // 2. Resolve Parameters
      const lookbackVal = this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_lookback', config.htf_breakout_lookback ?? 1);
      const lookback = Math.max(1, parseInt(String(lookbackVal), 10) || 1);

      const mode = String(
        this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_mode', config.htf_breakout_mode || 'close_break')
      ); // 'close_break' | 'closed_candle_confirm' | 'wick_break'

      const refLevelType = String(
        this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_reference_level', config.htf_breakout_reference_level || 'high_low')
      ); // 'high_low' | 'open_close_body' | 'close_only'

      const bufferPct = Math.max(0, parseFloat(String(
        this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_buffer_pct', config.htf_breakout_buffer_pct ?? 0)
      )) || 0);

      const maxExpansionPct = Math.max(0, parseFloat(String(
        this.resolveSignalParam(params, signalType, baseType, 'htf_breakout_max_expansion_pct', config.htf_breakout_max_expansion_pct ?? 0)
      )) || 0);

      // 3. Retrieve Reference Candles (Higher Timeframe, e.g. 1d)
      const btCandlesByInterval: Map<string, Candle[]> | undefined = (config as any)?._bt_candles_by_interval;
      const refCandles = btCandlesByInterval
        ? (btCandlesByInterval.get(refTf) || [])
        : this.klineStore.getRawCandles(symbol, refTf);
      // Need at least 1 completed candle + 1 active forming candle (or lookback + 1)
      if (!refCandles || refCandles.length < lookback + 1) {
        if (minimal) return false;
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: 'price',
          metric: 'HTF Breakout',
          description: `Insufficient ${refTf} reference data (${refCandles ? refCandles.length : 0}/${lookback + 1} candles)`,
          insufficientData: true,
          threshold_is_price: true,
        };
      }

      // 4. Retrieve Trigger Candles (e.g. 1h)
      const trigCandles = btCandlesByInterval
        ? (btCandlesByInterval.get(effectiveTrigTf) || (effectiveTrigTf === interval ? passedCandles : []) || [])
        : ((passedCandles && effectiveTrigTf === interval)
          ? passedCandles
          : this.klineStore.getRawCandles(symbol, effectiveTrigTf));

      const minTrigCandles = mode === 'closed_candle_confirm' ? 2 : 1;
      if (!trigCandles || trigCandles.length < minTrigCandles) {
        if (minimal) return false;
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: 'price',
          metric: 'HTF Breakout',
          description: `Insufficient ${effectiveTrigTf} trigger data (${trigCandles ? trigCandles.length : 0}/${minTrigCandles} candles)`,
          insufficientData: true,
          threshold_is_price: true,
        };
      }

      // 5. Calculate Reference Level from Completed Reference Candles
      // Notice: refCandles[refCandles.length - 1] is actively forming (today's candle).
      // Completed candles are up to index refCandles.length - 2.
      const completedRefEnd = refCandles.length - 1; // exclusive upper bound
      const completedRefStart = Math.max(0, completedRefEnd - lookback);

      let refHigh = -Infinity;
      let refLow = Infinity;
      let refBodyHigh = -Infinity;
      let refBodyLow = Infinity;
      let refClose = 0;

      for (let i = completedRefStart; i < completedRefEnd; i++) {
        const c = refCandles[i];
        if (c.high > refHigh) refHigh = c.high;
        if (c.low < refLow) refLow = c.low;
        const bH = Math.max(c.open, c.close);
        const bL = Math.min(c.open, c.close);
        if (bH > refBodyHigh) refBodyHigh = bH;
        if (bL < refBodyLow) refBodyLow = bL;
        refClose = c.close;
      }

      let targetRefHigh = refHigh;
      let targetRefLow = refLow;
      if (refLevelType === 'open_close_body') {
        targetRefHigh = refBodyHigh;
        targetRefLow = refBodyLow;
      } else if (refLevelType === 'close_only') {
        targetRefHigh = refClose;
        targetRefLow = refClose;
      }

      // 6. Evaluate Trigger Candle & Forming Candle
      const formingCandle = trigCandles[trigCandles.length - 1];
      const evalCandle = (mode === 'closed_candle_confirm')
        ? trigCandles[trigCandles.length - 2]
        : formingCandle;

      const currentPrice = evalCandle.close;
      const currentHigh = evalCandle.high;
      const currentLow = evalCandle.low;
      const livePrice = formingCandle ? formingCandle.close : currentPrice;
      const liveHigh = formingCandle ? Math.max(currentHigh, formingCandle.high) : currentHigh;
      const liveLow = formingCandle ? Math.min(currentLow, formingCandle.low) : currentLow;

      const targetSpan = targetRefHigh > targetRefLow ? (targetRefHigh - targetRefLow) : 0;
      const wickSpan = refHigh > refLow ? (refHigh - refLow) : 0;
      const refCandleSpan = targetSpan > 0 ? targetSpan : wickSpan;

      let fired = false;
      let rejected = false;
      let thresholdPrice = 0;
      let expansionCapPrice: number | null = null;
      let effectiveMaxExpPct: number | null = null;
      let candleConfirmState: 'closed_beyond' | 'wicked_only' | 'below' = 'below';
      let description = '';
      const isExit = purpose === 'exit';
      const wantUpperRef = isExit ? side === 'SHORT' : side === 'LONG';
      const activeRefForDist = wantUpperRef ? targetRefHigh : targetRefLow;
      const rawRefRangePct = activeRefForDist > 0 && refCandleSpan > 0
        ? (refCandleSpan / activeRefForDist) * 100
        : 0;
      const refRangePct = rawRefRangePct > 0 ? roundTo(rawRefRangePct, 4) : 0;

      if (side === 'LONG') {
        // Base breakout threshold with buffer %
        const bufferAmount = (bufferPct > 0) ? targetRefHigh * (bufferPct / 100) : 0;
        thresholdPrice = targetRefHigh + bufferAmount;
        if (maxExpansionPct > 0 && !isExit && refCandleSpan > 0 && targetRefHigh > 0) {
          effectiveMaxExpPct = roundTo((refCandleSpan / targetRefHigh) * maxExpansionPct, 6);
          expansionCapPrice = targetRefHigh + refCandleSpan * (maxExpansionPct / 100);
        }

        if (!isExit) {
          // LONG ENTRY
          if (mode === 'wick_break') {
            fired = currentHigh > thresholdPrice;
            candleConfirmState = currentPrice > thresholdPrice ? 'closed_beyond' : (currentHigh > thresholdPrice ? 'wicked_only' : 'below');
          } else if (mode === 'closed_candle_confirm') {
            fired = currentPrice > thresholdPrice;
            if (currentPrice > thresholdPrice) {
              candleConfirmState = 'closed_beyond';
            } else if (liveHigh > thresholdPrice || livePrice > thresholdPrice) {
              candleConfirmState = 'wicked_only';
            } else {
              candleConfirmState = 'below';
            }
          } else {
            fired = currentPrice > thresholdPrice;
            candleConfirmState = currentPrice > thresholdPrice ? 'closed_beyond' : (currentHigh > thresholdPrice ? 'wicked_only' : 'below');
          }

          // Anti-overexpansion ceiling guard (% of HTF reference candle distance)
          if (expansionCapPrice !== null && (currentPrice > expansionCapPrice || livePrice > expansionCapPrice)) {
            const effLabel = effectiveMaxExpPct !== null
              ? (effectiveMaxExpPct < 0.01 ? effectiveMaxExpPct.toFixed(4) : effectiveMaxExpPct.toFixed(2))
              : String(maxExpansionPct);
            const refLabel = refRangePct.toFixed(2);
            if (fired) {
              fired = false;
              rejected = true;
              description = `Rejected: price ${currentPrice.toFixed(4)} expanded > ${effLabel}% (${maxExpansionPct}% of ${refLabel}% ${refTf} range) above ${refTf} level (${expansionCapPrice.toFixed(4)})`;
            } else if (livePrice > expansionCapPrice) {
              rejected = true;
            }
          }

          if (fired && !description) {
            description = `${effectiveTrigTf} candle (${mode === 'wick_break' ? 'high' : 'close'} ${mode === 'wick_break' ? currentHigh.toFixed(4) : currentPrice.toFixed(4)}) breached prev ${lookback === 1 ? '' : lookback + ' '}${refTf} high (${targetRefHigh.toFixed(4)})`;
          } else if (!description) {
            description = `Monitoring ${effectiveTrigTf} close (${livePrice.toFixed(4)}) vs prev ${refTf} high (${targetRefHigh.toFixed(4)})`;
          }
        } else {
          // LONG EXIT (failed breakout or breakdown below reference level)
          thresholdPrice = targetRefLow;
          fired = currentPrice < targetRefLow;
          candleConfirmState = fired ? 'closed_beyond' : (liveLow < targetRefLow ? 'wicked_only' : 'below');
          description = fired
            ? `Exit: ${effectiveTrigTf} candle dropped below prev ${refTf} level (${targetRefLow.toFixed(4)})`
            : `Holding above prev ${refTf} level (${targetRefLow.toFixed(4)})`;
        }
      } else {
        // SHORT
        const bufferAmount = (bufferPct > 0) ? targetRefLow * (bufferPct / 100) : 0;
        thresholdPrice = targetRefLow - bufferAmount;
        if (maxExpansionPct > 0 && !isExit && refCandleSpan > 0 && targetRefLow > 0) {
          effectiveMaxExpPct = roundTo((refCandleSpan / targetRefLow) * maxExpansionPct, 6);
          expansionCapPrice = targetRefLow - refCandleSpan * (maxExpansionPct / 100);
        }

        if (!isExit) {
          // SHORT ENTRY
          if (mode === 'wick_break') {
            fired = currentLow < thresholdPrice;
            candleConfirmState = currentPrice < thresholdPrice ? 'closed_beyond' : (currentLow < thresholdPrice ? 'wicked_only' : 'below');
          } else if (mode === 'closed_candle_confirm') {
            fired = currentPrice < thresholdPrice;
            if (currentPrice < thresholdPrice) {
              candleConfirmState = 'closed_beyond';
            } else if (liveLow < thresholdPrice || livePrice < thresholdPrice) {
              candleConfirmState = 'wicked_only';
            } else {
              candleConfirmState = 'below';
            }
          } else {
            fired = currentPrice < thresholdPrice;
            candleConfirmState = currentPrice < thresholdPrice ? 'closed_beyond' : (currentLow < thresholdPrice ? 'wicked_only' : 'below');
          }

          // Anti-overexpansion floor guard (% of HTF reference candle distance)
          if (expansionCapPrice !== null && (currentPrice < expansionCapPrice || livePrice < expansionCapPrice)) {
            const effLabel = effectiveMaxExpPct !== null
              ? (effectiveMaxExpPct < 0.01 ? effectiveMaxExpPct.toFixed(4) : effectiveMaxExpPct.toFixed(2))
              : String(maxExpansionPct);
            const refLabel = refRangePct.toFixed(2);
            if (fired) {
              fired = false;
              rejected = true;
              description = `Rejected: price ${currentPrice.toFixed(4)} expanded > ${effLabel}% (${maxExpansionPct}% of ${refLabel}% ${refTf} range) below ${refTf} level (${expansionCapPrice.toFixed(4)})`;
            } else if (livePrice < expansionCapPrice) {
              rejected = true;
            }
          }

          if (fired && !description) {
            description = `${effectiveTrigTf} candle (${mode === 'wick_break' ? 'low' : 'close'} ${mode === 'wick_break' ? currentLow.toFixed(4) : currentPrice.toFixed(4)}) broke below prev ${lookback === 1 ? '' : lookback + ' '}${refTf} low (${targetRefLow.toFixed(4)})`;
          } else if (!description) {
            description = `Monitoring ${effectiveTrigTf} close (${livePrice.toFixed(4)}) vs prev ${refTf} low (${targetRefLow.toFixed(4)})`;
          }
        } else {
          // SHORT EXIT (reclamation above reference level)
          thresholdPrice = targetRefHigh;
          fired = currentPrice > targetRefHigh;
          candleConfirmState = fired ? 'closed_beyond' : (liveHigh > targetRefHigh ? 'wicked_only' : 'below');
          description = fired
            ? `Exit: ${effectiveTrigTf} candle rose above prev ${refTf} level (${targetRefHigh.toFixed(4)})`
            : `Holding below prev ${refTf} level (${targetRefHigh.toFixed(4)})`;
        }
      }

      if (minimal) return fired;

      const slPrice = side === 'LONG' ? targetRefLow : targetRefHigh;
      const tfUnit = effectiveTrigTf.slice(-1);
      const tfNum = parseInt(effectiveTrigTf.slice(0, -1), 10) || 1;
      const tfMs = tfUnit === 'm' ? tfNum * 60000 : tfUnit === 'h' ? tfNum * 3600000 : tfUnit === 'd' ? tfNum * 86400000 : 3600000;
      const trigCloseCountdownMs = Math.max(0, tfMs - (Date.now() % tfMs));
      const expansionPct = side === 'LONG'
        ? ((livePrice - targetRefHigh) / targetRefHigh) * 100
        : ((targetRefLow - livePrice) / targetRefLow) * 100;

      return {
        fired,
        rejected,
        value: roundTo(livePrice, 8),
        closed_value: roundTo(currentPrice, 8),
        threshold: roundTo(thresholdPrice, 8),
        ref_high: roundTo(targetRefHigh, 8),
        ref_low: roundTo(targetRefLow, 8),
        pattern_high: roundTo(targetRefHigh, 8),
        pattern_low: roundTo(targetRefLow, 8),
        buffer_pct: bufferPct,
        breakout_level: roundTo(thresholdPrice, 8),
        max_expansion_pct: maxExpansionPct,
        effective_max_expansion_pct: effectiveMaxExpPct !== null ? roundTo(effectiveMaxExpPct, 6) : null,
        ref_range_pct: refRangePct,
        expansion_cap: expansionCapPrice !== null ? roundTo(expansionCapPrice, 8) : null,
        live_price: roundTo(livePrice, 8),
        candle_high: roundTo(liveHigh, 8),
        candle_low: roundTo(liveLow, 8),
        candle_confirm_state: candleConfirmState,
        trig_close_countdown_ms: trigCloseCountdownMs,
        slPrice: roundTo(slPrice, 8),
        unit: 'price',
        metric: 'HTF Breakout',
        description,
        threshold_is_price: true,
        ref_timeframe: refTf,
        trigger_timeframe: effectiveTrigTf,
        mode,
        lookback,
        reference_level: refLevelType,
        expansion_pct: roundTo(expansionPct, 8),
      };
    } catch (error) {
      this.logger.debug(`HTF Breakout signal error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: passedCandles?.[passedCandles.length - 1]?.close || 0,
        threshold: 0,
        unit: 'price',
        metric: 'HTF Breakout',
        description: 'Signal error',
        threshold_is_price: true,
      };
    }
  }

  /**
   * Trigger Candle Exit Signal:
   * Exits when candle closes below the low of the trigger candle (or N prev/next surrounding candles) for LONG,
   * or closes above the high of the trigger candle (or N prev/next surrounding candles) for SHORT.
   */
  triggerCandleExitSignal(
    symbol: string,
    config: SessionConfig,
    interval: string = '1h',
    side: 'LONG' | 'SHORT' = 'LONG',
    purpose: 'entry' | 'exit' = 'exit',
    candles?: Candle[],
    minimal: boolean = false,
    signalType: string = 'trigger_candle_exit',
    trade?: any
  ): boolean | SignalDetail {
    const activeTrade = trade || (config as any)._active_trade;
    if (!activeTrade) {
      if (minimal) return false;
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: 'price',
        metric: 'Trigger Candle Exit',
        label: side === 'LONG' ? 'Trigger Candle Low' : 'Trigger Candle High',
        description: 'No active trade context available for trigger candle exit',
        threshold_is_price: true,
      };
    }

    const params = config.signal_params || {};
    const baseType = 'trigger_candle_exit';

    const nVal = this.resolveSignalParam(params, signalType, baseType, 'trigger_candle_exit_n', config.trigger_candle_exit_n ?? 0);
    const n = Math.max(0, parseInt(String(nVal), 10) || 0);

    const offsetMode = this.resolveSignalParam(params, signalType, baseType, 'trigger_candle_exit_offset_mode', config.trigger_candle_exit_offset_mode || 'prev_and_next');
    const evalMode = this.resolveSignalParam(params, signalType, baseType, 'trigger_candle_exit_mode', config.trigger_candle_exit_mode || 'close');
    const bufferPctVal = this.resolveSignalParam(params, signalType, baseType, 'trigger_candle_exit_buffer_pct', config.trigger_candle_exit_buffer_pct ?? 0);
    const bufferPct = Math.max(0, parseFloat(String(bufferPctVal)) || 0);

    const configuredTf = this.resolveSignalParam(params, signalType, baseType, 'trigger_candle_exit_timeframe', config.trigger_candle_exit_timeframe || 'default');
    const targetTf = (configuredTf && configuredTf !== 'default')
      ? configuredTf
      : (activeTrade.trigger_candle_timeframe || config.htf_breakout_trigger_timeframe || interval || '1h');

    const btCandlesByInterval: Map<string, Candle[]> | undefined = (config as any)?._bt_candles_by_interval;
    const tfCandles = btCandlesByInterval
      ? (btCandlesByInterval.get(targetTf) || (targetTf === interval ? candles : []) || [])
      : ((targetTf === interval && candles && candles.length > 0)
        ? candles
        : (this.klineStore ? this.klineStore.getRawCandles(symbol, targetTf) : (candles || [])));

    if (!tfCandles || tfCandles.length < 1) {
      if (minimal) return false;
      return {
        fired: false,
        insufficientData: true,
        value: 0,
        threshold: 0,
        unit: 'price',
        metric: 'Trigger Candle Exit',
        label: side === 'LONG' ? 'Trigger Candle Low' : 'Trigger Candle High',
        description: `Insufficient klines for ${symbol} on ${targetTf}`,
        threshold_is_price: true,
      };
    }

    // Determine baseline boundary:
    // If trade has recorded trigger candle low/high, start with it
    let boundaryPrice = side === 'LONG' ? activeTrade.trigger_candle_low : activeTrade.trigger_candle_high;
    const triggerTs = activeTrade.trigger_candle_time || (activeTrade.entry_ts instanceof Date ? activeTrade.entry_ts.getTime() : (activeTrade.entry_ts ? new Date(activeTrade.entry_ts).getTime() : 0));

    if (triggerTs > 0 && tfCandles.length > 0) {
      // Find the candle in tfCandles closest to / matching triggerTs
      let triggerIdx = -1;
      for (let i = tfCandles.length - 1; i >= 0; i--) {
        if (tfCandles[i].time <= triggerTs) {
          triggerIdx = i;
          break;
        }
      }

      if (triggerIdx >= 0) {
        let startIdx = triggerIdx;
        let endIdx = triggerIdx;

        if (offsetMode === 'prev_only') {
          startIdx = Math.max(0, triggerIdx - n);
          endIdx = triggerIdx;
        } else if (offsetMode === 'next_only') {
          startIdx = triggerIdx;
          endIdx = Math.min(tfCandles.length - 1, triggerIdx + n);
        } else {
          // prev_and_next
          startIdx = Math.max(0, triggerIdx - n);
          endIdx = Math.min(tfCandles.length - 1, triggerIdx + n);
        }

        const windowSlice = tfCandles.slice(startIdx, endIdx + 1);
        if (windowSlice.length > 0) {
          if (side === 'LONG') {
            boundaryPrice = Math.min(...windowSlice.map(c => c.low));
          } else {
            boundaryPrice = Math.max(...windowSlice.map(c => c.high));
          }
        }
      }
    }

    // If still undefined or invalid, fallback to entry_price
    if (boundaryPrice === undefined || boundaryPrice <= 0 || isNaN(boundaryPrice)) {
      boundaryPrice = Number(activeTrade.entry_price);
    }

    // Apply buffer if configured
    let effectiveBoundary = boundaryPrice;
    if (bufferPct > 0) {
      if (side === 'LONG') {
        effectiveBoundary = boundaryPrice * (1 - bufferPct / 100);
      } else {
        effectiveBoundary = boundaryPrice * (1 + bufferPct / 100);
      }
    }

    // Candle to evaluate:
    const evalCandle = tfCandles[tfCandles.length - 1];
    const evalPrice = evalMode === 'wick'
      ? (side === 'LONG' ? evalCandle.low : evalCandle.high)
      : evalCandle.close;

    let fired = false;
    if (side === 'LONG') {
      fired = evalPrice < effectiveBoundary;
    } else {
      fired = evalPrice > effectiveBoundary;
    }

    if (minimal) return fired;

    const opStr = side === 'LONG' ? '<' : '>';
    const labelStr = side === 'LONG' ? 'Trigger Candle Low' : 'Trigger Candle High';
    const desc = fired
      ? `Exit: ${targetTf} candle ${evalMode} (${evalPrice.toFixed(4)}) ${opStr} boundary (${effectiveBoundary.toFixed(4)}) [N=${n}, ${offsetMode}]`
      : `Holding: ${targetTf} candle ${evalMode} (${evalPrice.toFixed(4)}) within boundary (${effectiveBoundary.toFixed(4)})`;

    return {
      fired,
      value: roundTo(evalPrice, 8),
      threshold: roundTo(effectiveBoundary, 8),
      unit: 'price',
      metric: 'Trigger Candle Exit',
      label: labelStr,
      description: desc,
      threshold_is_price: true,
      details: {
        eval_price: evalPrice,
        boundary_price: effectiveBoundary,
        raw_boundary: boundaryPrice,
        trigger_candle_low: activeTrade.trigger_candle_low,
        trigger_candle_high: activeTrade.trigger_candle_high,
        trigger_candle_time: activeTrade.trigger_candle_time,
        n,
        offset_mode: offsetMode,
        eval_mode: evalMode,
        target_tf: targetTf,
      }
    };
  }

  /**
   * Prunes indicator caches for symbols that are no longer in the active watchlist or open trades.
   * Also enforces bounds on warningCache and array-heavy MACD/Supertrend caches.
   */
  public pruneCaches(activeSymbols?: Set<string>) {
    if (this.warningCache.size > 500) {
      this.warningCache.clear();
    }
    if (!activeSymbols || activeSymbols.size === 0) return;

    const pruneMapBySymbolPrefix = (map: Map<string, any>) => {
      for (const key of Array.from(map.keys())) {
        const sepIdx = key.indexOf(':');
        if (sepIdx > 0) {
          const sym = key.slice(0, sepIdx);
          if (!activeSymbols.has(sym)) {
            map.delete(key);
          }
        }
      }
    };

    pruneMapBySymbolPrefix(this.emaCache);
    pruneMapBySymbolPrefix(this.emaDualCache);
    pruneMapBySymbolPrefix(this.emaStableCache);
    pruneMapBySymbolPrefix(this.smaStableCache);
    pruneMapBySymbolPrefix(this.macdCache);
    pruneMapBySymbolPrefix(this.supertrendCache);
  }

  /**
   * Clears all transient indicator calculation caches (used during Deep Sleep or session stop).
   */
  public clearCaches() {
    this.warningCache.clear();
    this.emaCache.clear();
    this.emaDualCache.clear();
    this.emaStableCache.clear();
    this.smaStableCache.clear();
    this.macdCache.clear();
    this.supertrendCache.clear();
  }

  /**
   * Removes backtest-namespaced (`__bt__:`) cache entries without disturbing live/paper caches.
   */
  public clearBacktestCaches() {
    const purgeBacktestKeys = (map: Map<string, any>) => {
      for (const key of Array.from(map.keys())) {
        if (key.startsWith('__bt__:')) {
          map.delete(key);
        }
      }
    };
    purgeBacktestKeys(this.emaCache);
    purgeBacktestKeys(this.emaDualCache);
    purgeBacktestKeys(this.emaStableCache);
    purgeBacktestKeys(this.smaStableCache);
    purgeBacktestKeys(this.macdCache);
    purgeBacktestKeys(this.supertrendCache);
  }
}
