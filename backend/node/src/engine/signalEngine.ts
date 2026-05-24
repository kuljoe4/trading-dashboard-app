import { Injectable, Logger } from '@nestjs/common';
import { KlineStoreService } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

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

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string, side?: 'LONG' | 'SHORT', purpose?: 'entry' | 'exit') => Promise<boolean | SignalDetail>
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

  async checkEntry(
    symbol: string,
    config: SessionConfig,
    interval: string = '1m',
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): Promise<{ allFired: boolean; firedSignals: string[]; reason: string; details?: Record<string, SignalDetail> }> {
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

    for (const signalType of config.enabled_signals) {
      const handler = this.signalHandlers[signalType];
      if (!handler) {
        failedSignals.push(signalType);
        continue;
      }

      try {
        const result = await handler(symbol, config, interval, side, purpose);
        const fired = typeof result === 'boolean' ? result : result.fired;
        
        if (typeof result !== 'boolean') {
          details[signalType] = result;
        }

        if (fired) {
          firedSignals.push(signalType);
        } else {
          failedSignals.push(signalType);
        }
      } catch (error) {
        this.logger.warn(`Signal ${signalType} error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
        failedSignals.push(signalType);
      }
    }

    const logic = config.signal_logic || 'all';
    const allFired = logic === 'any'
      ? firedSignals.length > 0
      : failedSignals.length === 0;
    const reason =
      `Signals fired: ${firedSignals.length}/${config.enabled_signals.length}` +
      (firedSignals.length > 0 ? ` (${firedSignals.join(', ')})` : '') +
      (failedSignals.length > 0 ? `; Failed: ${failedSignals.join(', ')}` : '');

    return { allFired, firedSignals, reason, details };
  }

  private async momentumPctSignal(
    symbol: string,
    config: SessionConfig,
    interval: string,
  ): Promise<SignalDetail> {
    const lookback = Math.max(config.scan_lookback || 3, 1);
    const candles = await this.klineStore.getRecentCandles(symbol, interval, lookback + 1);
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
      value: Number(pct.toFixed(2)),
      threshold,
      unit: '%',
      metric: 'Momentum',
      description: `Price moved ${pct.toFixed(2)}% over ${lookback} periods`,
    };
  }

  private async breakoutHlSignal(
    symbol: string,
    config: SessionConfig,
    interval: string,
  ): Promise<SignalDetail> {
    const lookback = Math.max(config.scan_lookback || 3, 2);
    const candles = await this.klineStore.getRecentCandles(symbol, interval, lookback + 1);
    
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
    for (let i = 0; i < candles.length - 1; i++) {
      if (candles[i].high > maxHigh) maxHigh = candles[i].high;
      if (candles[i].low < minLow) minLow = candles[i].low;
    }

    const fired = current.close > maxHigh || current.close < minLow;
    const value = current.close > maxHigh ? current.close - maxHigh : minLow - current.close;

    return {
      fired,
      value: Number(value.toFixed(2)),
      threshold: 0,
      unit: 'dist',
      metric: 'Breakout',
      description: fired 
        ? `Price broke ${current.close > maxHigh ? 'HIGH' : 'LOW'} of ${lookback} periods`
        : `Price within ${lookback} period range (${minLow.toFixed(2)} - ${maxHigh.toFixed(2)})`,
    };
  }

  private async engulfingSignal(
    symbol: string,
    config: any,
    interval: string,
  ): Promise<SignalDetail> {
    try {
      const candles = await this.klineStore.getRecentCandles(symbol, interval, 2);
      if (candles.length < 2) {
        return { fired: false, value: 0, threshold: 0, unit: 'bool', metric: 'Engulfing', description: 'Insufficient data', insufficientData: true };
      }

      const prevCandle = candles[0];
      const currCandle = candles[1];
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

  private async maSignal(
    symbol: string,
    config: any,
    interval: string,
  ): Promise<SignalDetail> {
    try {
      const period = parseInt(config.signal_params?.ma_period || '20', 10);
      const candles = await this.klineStore.getRecentCandles(symbol, interval, period + 1);
      if (candles.length < period + 1) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'MA Cross', description: 'Insufficient data', insufficientData: true };
      }

      const ma = this.calculateSMA(candles, 0, period);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;
      const diff = currClose - ma;
      const prevDiff = prevClose - ma;
      const fired = (prevDiff <= 0 && diff > 0) || (prevDiff >= 0 && diff < 0);
      
      return {
        fired,
        value: Number(currClose.toFixed(2)),
        threshold: Number(ma.toFixed(2)),
        unit: 'price',
        metric: 'MA Cross',
        description: `Price crossed MA(${period})`,
      };
    } catch (error) {
      this.logger.debug(`MA signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: 0, threshold: 0, unit: 'error', metric: 'MA Cross', description: 'Signal error' };
    }
  }

  private async emaSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): Promise<SignalDetail> {
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

      const candles = await this.klineStore.getRecentCandles(symbol, interval, period + 1);
      if (candles.length < period + 1) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'EMA Cross', description: 'Insufficient data', insufficientData: true };
      }

      const ema = this.calculateEMA(candles, period);
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
        value: Number(currClose.toFixed(2)),
        threshold: Number(ema.toFixed(2)),
        unit: 'price',
        metric: 'EMA Cross',
        description: `Price crossed EMA(${period})`,
      };
    } catch (error) {
      this.logger.debug(`EMA signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: 0, threshold: 0, unit: 'error', metric: 'EMA Cross', description: 'Signal error' };
    }
  }

  private async emaDualCrossSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): Promise<SignalDetail> {
    try {
      const params = config.signal_params || {};
      const fastPeriod = purpose === 'exit'
        ? parseInt(params.exit_ema_fast || '9', 10)
        : parseInt(params.entry_ema_fast || '9', 10);
      const slowPeriod = purpose === 'exit'
        ? parseInt(params.exit_ema_slow || '21', 10)
        : parseInt(params.entry_ema_slow || '21', 10);

      const maxPeriod = Math.max(fastPeriod, slowPeriod);
      const candles = await this.klineStore.getRecentCandles(symbol, interval, maxPeriod + 2);
      if (candles.length < maxPeriod + 1) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'EMA Dual', description: 'Insufficient data', insufficientData: true };
      }

      const fastEmas = this.calculateEMALastTwo(candles, fastPeriod);
      const slowEmas = this.calculateEMALastTwo(candles, slowPeriod);

      if (!fastEmas || !slowEmas) {
        return { fired: false, value: 0, threshold: 0, unit: 'price', metric: 'EMA Dual', description: 'Insufficient EMA data', insufficientData: true };
      }

      const [prevFast, currFast] = fastEmas;
      const [prevSlow, currSlow] = slowEmas;

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
        value: Number(currFast.toFixed(2)),
        threshold: Number(currSlow.toFixed(2)),
        unit: 'price',
        metric: 'EMA Dual',
        description: `EMA(${fastPeriod}) crossed EMA(${slowPeriod})`,
      };
    } catch (error) {
      this.logger.debug(`EMA Dual Cross signal error: ${error instanceof Error ? error.message : String(error)}`);
      return { fired: false, value: 0, threshold: 0, unit: 'error', metric: 'EMA Dual', description: 'Signal error' };
    }
  }

  private async emaCloseSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): Promise<SignalDetail> {
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

      const candles = await this.klineStore.getRecentCandles(symbol, interval, period + 1);
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

      const ema = this.calculateEMA(candles, period);
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
        value: Number(currClose.toFixed(2)),
        threshold: Number(ema.toFixed(2)),
        unit: 'price',
        metric: 'EMA Close',
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
   */
  private calculateEMALastTwo(candles: any[], period: number): [number, number] | null {
    if (candles.length < period + 1) return null;
    const multiplier = 2 / (period + 1);

    let prevEma = NaN;
    let ema = this.calculateSMA(candles, 0, period);

    for (let i = period; i < candles.length; i++) {
      prevEma = ema;
      ema = candles[i].close * multiplier + ema * (1 - multiplier);
    }

    if (Number.isNaN(prevEma)) return null;
    return [prevEma, ema];
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

  private calculateEMA(candles: any[], period: number): number {
    if (candles.length === 0) return 0;
    if (candles.length < period) return this.calculateSMA(candles, 0, candles.length);

    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(candles, 0, period);

    for (let i = period; i < candles.length; i++) {
      ema = candles[i].close * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }
}
