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

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string, side?: 'LONG' | 'SHORT', purpose?: 'entry' | 'exit', candles?: Candle[]) => boolean | SignalDetail
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

    const candles = this.klineStore.getRawCandles(symbol, interval);

    // Warm-up check for technical indicators
    if (purpose === 'entry') {
      const requiredWarmup = this.getRequiredWarmup(config);
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
        const result = handler(symbol, config, interval, side, purpose, candles);
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
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
  ): SignalDetail {
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
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
  ): SignalDetail {
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

    let maxHigh = -Infinity;
    let minLow = Infinity;
    const startIdx = Math.max(0, candles.length - lookback - 1);
    for (let i = startIdx; i < candles.length - 1; i++) {
      if (candles[i].high > maxHigh) maxHigh = candles[i].high;
      if (candles[i].low < minLow) minLow = candles[i].low;
    }

    const isLong = side === 'LONG';
    const target = isLong ? minLow : maxHigh; // Target for EXIT is the opposite side of the range
    const fired = isLong ? current.close <= target : current.close >= target;

    return {
      fired,
      value: roundTo(current.close, 4),
      threshold: roundTo(target, 4),
      unit: 'price',
      metric: 'Breakout HL',
      description: fired 
        ? `Price breached ${isLong ? 'LOW' : 'HIGH'} of ${lookback} periods`
        : `Monitoring ${lookback} period ${isLong ? 'Low' : 'High'} level`,
      threshold_is_price: true,
    };
  }

  private engulfingSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose?: 'entry' | 'exit',
    passedCandles?: Candle[],
  ): SignalDetail {
    try {
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
      const lookback = Math.max(config.engulfing_lookback || 1, 1);

      if (candles.length < lookback + 1) {
        return { fired: false, value: 0, threshold: 0, unit: 'bool', metric: 'Engulfing', description: 'Insufficient data', insufficientData: true };
      }

      const curr = candles[candles.length - 1];
      const prevCandles = candles.slice(candles.length - 1 - lookback, candles.length - 1);

      const mode = config.engulfing_mode || 'range';
      const volConfirm = config.engulfing_volume_confirm || false;

      const isBullish = curr.close > curr.open;
      const isBearish = curr.close < curr.open;

      // Calculate aggregate range and body of the lookback period
      let aggregateHigh = -Infinity;
      let aggregateLow = Infinity;
      let aggregateBodyHigh = -Infinity;
      let aggregateBodyLow = Infinity;
      let allReverse = true;

      for (const p of prevCandles) {
        if (p.high > aggregateHigh) aggregateHigh = p.high;
        if (p.low < aggregateLow) aggregateLow = p.low;

        const bH = Math.max(p.open, p.close);
        const bL = Math.min(p.open, p.close);
        if (bH > aggregateBodyHigh) aggregateBodyHigh = bH;
        if (bL < aggregateBodyLow) aggregateBodyLow = bL;

        // Directional check: for LONG entry, all previous must be Bearish (Reverse Engulfing)
        if (side === 'LONG' && p.close > p.open) allReverse = false;
        if (side === 'SHORT' && p.close < p.open) allReverse = false;
      }

      const currBodyHigh = Math.max(curr.open, curr.close);
      const currBodyLow = Math.min(curr.open, curr.close);
      
      const bodyEngulfs = currBodyHigh > aggregateBodyHigh && currBodyLow < aggregateBodyLow;
      const rangeEngulfs = curr.high > aggregateHigh && curr.low < aggregateLow;
      const volumeConfirms = curr.volume > prevCandles[prevCandles.length - 1].volume;

      let fired = false;
      let reason = '';

      if (side === 'LONG') {
        if (!isBullish) {
          fired = false;
          reason = 'Not a bullish candle';
        } else if (!allReverse) {
          fired = false;
          reason = `Previous ${lookback} candles not bearish`;
        } else {
          if (mode === 'body') fired = bodyEngulfs;
          else if (mode === 'range') fired = rangeEngulfs;
          else if (mode === 'strict') fired = bodyEngulfs && rangeEngulfs;

          if (fired && volConfirm && !volumeConfirms) {
            fired = false;
            reason = 'Insufficient volume confirmation';
          } else if (!fired) {
            reason = mode === 'body' ? 'Body did not engulf' : mode === 'range' ? 'Range did not engulf' : 'Strict engulfing failed';
          }
        }
      } else if (side === 'SHORT') {
        if (!isBearish) {
          fired = false;
          reason = 'Not a bearish candle';
        } else if (!allReverse) {
          fired = false;
          reason = `Previous ${lookback} candles not bullish`;
        } else {
          if (mode === 'body') fired = bodyEngulfs;
          else if (mode === 'range') fired = rangeEngulfs;
          else if (mode === 'strict') fired = bodyEngulfs && rangeEngulfs;

          if (fired && volConfirm && !volumeConfirms) {
            fired = false;
            reason = 'Insufficient volume confirmation';
          } else if (!fired) {
            reason = mode === 'body' ? 'Body did not engulf' : mode === 'range' ? 'Range did not engulf' : 'Strict engulfing failed';
          }
        }
      } else {
        // Generic (no side) - default to old behavior but with mode awareness
        if (mode === 'body') fired = bodyEngulfs;
        else if (mode === 'range') fired = rangeEngulfs;
        else fired = bodyEngulfs && rangeEngulfs;

        if (fired && volConfirm && !volumeConfirms) fired = false;
      }

      return {
        fired,
        value: fired ? 1 : 0,
        threshold: 1,
        unit: 'bool',
        metric: 'Engulfing',
        description: fired ? `Engulfing pattern (${mode}) detected` : (reason || 'No engulfing pattern'),
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
  ): SignalDetail {
    try {
      const period = parseInt(config.signal_params?.ma_period || '20', 10);
      const candles = passedCandles || this.klineStore.getRawCandles(symbol, interval);
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
        threshold_is_price: true,
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
  ): SignalDetail {
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

      return {
        fired,
        value: roundTo(currClose, 2),
        threshold: roundTo(ema, 2),
        insufficientData: emaRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Cross' : 'Entry EMA Cross',
        description: `Price crossed EMA(${period})`,
        threshold_is_price: true,
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

      return {
        fired,
        value: roundTo(currFast, 2),
        threshold: roundTo(currSlow, 2),
        insufficientData: fastRes.insufficientData || slowRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Dual' : 'Entry EMA Dual',
        description: `EMA(${fastPeriod}) crossed EMA(${slowPeriod})`,
        threshold_is_price: true,
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

      return {
        fired,
        value: roundTo(completedClose, 2),
        threshold: roundTo(threshold, 2),
        insufficientData: fastRes.insufficientData || slowRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Dual Close' : 'Entry EMA Dual Close',
        description: `Last closed candle (${completedClose.toFixed(2)}) ${fired ? 'is' : 'not'} favorably aligned with EMA(${fastPeriod}) and EMA(${slowPeriod})`,
        threshold_is_price: true,
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
  ): SignalDetail {
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

      return {
        fired,
        value: roundTo(completedClose, 2),
        threshold: roundTo(ema, 2),
        insufficientData: emaRes.insufficientData,
        unit: 'price',
        metric: purpose === 'exit' ? 'Exit EMA Close' : 'Entry EMA Close',
        description: `Last closed candle (${completedClose.toFixed(2)}) ${fired ? 'is' : 'not'} favorably aligned with EMA(${period})`,
        threshold_is_price: true,
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
}
