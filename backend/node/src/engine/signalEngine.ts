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
}

@Injectable()
export class SignalEngineService {
  private readonly logger = new Logger(SignalEngineService.name);

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string, side?: 'LONG' | 'SHORT', purpose?: 'entry' | 'exit') => Promise<boolean>
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
  ): Promise<{ allFired: boolean; firedSignals: string[]; reason: string }> {
    if (!config.enabled_signals || config.enabled_signals.length === 0) {
      return {
        allFired: false,
        firedSignals: [],
        reason: 'No signals enabled',
      };
    }

    const firedSignals: string[] = [];
    const failedSignals: string[] = [];

    for (const signalType of config.enabled_signals) {
      const handler = this.signalHandlers[signalType];
      if (!handler) {
        failedSignals.push(signalType);
        continue;
      }

      try {
        const fired = await handler(symbol, config, interval, side, purpose);
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

    return { allFired, firedSignals, reason };
  }

  private async momentumPctSignal(
    symbol: string,
    config: SessionConfig,
    interval: string,
  ): Promise<boolean> {
    const lookback = Math.max(config.scan_lookback || 3, 1);
    const candles = await this.klineStore.getRecentCandles(symbol, interval, lookback + 1);
    if (candles.length < lookback + 1) return false;

    const first = candles[candles.length - 1 - lookback].close;
    const last = candles[candles.length - 1].close;
    const pct = ((last - first) / first) * 100;
    return Math.abs(pct) >= (config.scan_pct_threshold || 0);
  }

  private async breakoutHlSignal(
    symbol: string,
    config: SessionConfig,
    interval: string,
  ): Promise<boolean> {
    const lookback = Math.max(config.scan_lookback || 3, 2);
    const candles = await this.klineStore.getRecentCandles(symbol, interval, lookback + 1);
    if (candles.length < lookback + 1) return false;

    const current = candles[candles.length - 1];

    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (let i = 0; i < candles.length - 1; i++) {
      if (candles[i].high > maxHigh) maxHigh = candles[i].high;
      if (candles[i].low < minLow) minLow = candles[i].low;
    }

    return current.close > maxHigh || current.close < minLow;
  }

  private async engulfingSignal(
    symbol: string,
    config: any,
    interval: string,
  ): Promise<boolean> {
    try {
      const candles = await this.klineStore.getRecentCandles(symbol, interval, 2);
      if (candles.length < 2) return false;

      const prevCandle = candles[0];
      const currCandle = candles[1];
      return currCandle.high > prevCandle.high && currCandle.low < prevCandle.low;
    } catch (error) {
      this.logger.debug(`Engulfing signal error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async maSignal(
    symbol: string,
    config: any,
    interval: string,
  ): Promise<boolean> {
    try {
      const period = parseInt(config.signal_params?.ma_period || '20', 10);
      const candles = await this.klineStore.getRecentCandles(symbol, interval, period + 1);
      if (candles.length < period + 1) return false;

      const ma = this.calculateSMA(candles, 0, period);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;
      const diff = currClose - ma;
      const prevDiff = prevClose - ma;
      return (prevDiff <= 0 && diff > 0) || (prevDiff >= 0 && diff < 0);
    } catch (error) {
      this.logger.debug(`MA signal error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async emaSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): Promise<boolean> {
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

      const candles = await this.klineStore.getRecentCandles(symbol, interval, period + 1);
      if (candles.length < period + 1) return false;

      const ema = this.calculateEMA(candles, period);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;

      if (purpose === 'entry') {
        if (side === 'LONG') return prevClose <= ema && currClose > ema;
        if (side === 'SHORT') return prevClose >= ema && currClose < ema;
        return (prevClose <= ema && currClose > ema) || (prevClose >= ema && currClose < ema);
      } else {
        if (side === 'LONG') return prevClose >= ema && currClose < ema;
        if (side === 'SHORT') return prevClose <= ema && currClose > ema;
        return false;
      }
    } catch (error) {
      this.logger.debug(`EMA signal error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async emaDualCrossSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): Promise<boolean> {
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
      if (candles.length < maxPeriod + 1) return false;

      const fastEmas = this.calculateEMASeries(candles, fastPeriod);
      const slowEmas = this.calculateEMASeries(candles, slowPeriod);

      if (fastEmas.length < 2 || slowEmas.length < 2) return false;

      const prevFast = fastEmas[fastEmas.length - 2];
      const currFast = fastEmas[fastEmas.length - 1];
      const prevSlow = slowEmas[slowEmas.length - 2];
      const currSlow = slowEmas[slowEmas.length - 1];

      if (purpose === 'entry') {
        if (side === 'LONG') return prevFast <= prevSlow && currFast > currSlow;
        if (side === 'SHORT') return prevFast >= prevSlow && currFast < currSlow;
        return (prevFast <= prevSlow && currFast > currSlow) || (prevFast >= prevSlow && currFast < currSlow);
      } else {
        if (side === 'LONG') return prevFast >= prevSlow && currFast < currSlow;
        if (side === 'SHORT') return prevFast <= prevSlow && currFast > currSlow;
        return false;
      }
    } catch (error) {
      this.logger.debug(`EMA Dual Cross signal error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async emaCloseSignal(
    symbol: string,
    config: any,
    interval: string,
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): Promise<boolean> {
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

      const candles = await this.klineStore.getRecentCandles(symbol, interval, period + 1);
      if (candles.length < period + 1) return false;

      const ema = this.calculateEMA(candles, period);
      const currClose = candles[candles.length - 1].close;

      if (purpose === 'entry') {
        if (side === 'LONG') return currClose > ema;
        if (side === 'SHORT') return currClose < ema;
        return true;
      } else {
        if (side === 'LONG') return currClose < ema;
        if (side === 'SHORT') return currClose > ema;
        return false;
      }
    } catch (error) {
      this.logger.debug(`EMA Close signal error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private calculateEMASeries(candles: any[], period: number): number[] {
    if (candles.length < period) return [];
    const multiplier = 2 / (period + 1);
    const result: number[] = [];

    let ema = this.calculateSMA(candles, 0, period);
    for (let i = period; i < candles.length; i++) {
      ema = candles[i].close * multiplier + ema * (1 - multiplier);
      result.push(ema);
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
