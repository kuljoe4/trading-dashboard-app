import { Injectable, Logger } from '@nestjs/common';
import { KlineStoreService } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

@Injectable()
export class SignalEngineService {
  private readonly logger = new Logger(SignalEngineService.name);

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string) => Promise<boolean>
  > = {
    momentum_pct: this.momentumPctSignal.bind(this),
    breakout_hl: this.breakoutHlSignal.bind(this),
    engulfing: this.engulfingSignal.bind(this),
    ma: this.maSignal.bind(this),
    ema: this.emaSignal.bind(this),
    ema_cross: this.emaSignal.bind(this),
  };

  constructor(private readonly klineStore: KlineStoreService) {}

  async checkEntry(
    symbol: string,
    config: SessionConfig,
    interval: string = '1m',
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
        const fired = await handler(symbol, config, interval);
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

    // BOLT OPTIMIZATION: Use direct loop instead of slice().map() to avoid intermediate array allocations
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
      const candles = await this.klineStore.getRecentCandles(
        symbol,
        interval,
        2,
      );
      if (candles.length < 2) return false;

      const prevCandle = candles[0];
      const currCandle = candles[1];

      // Engulfing: current candle high > prev high AND current low < prev low
      return currCandle.high > prevCandle.high && currCandle.low < prevCandle.low;
    } catch (error) {
      this.logger.debug(`Engulfing signal error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
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
      const candles = await this.klineStore.getRecentCandles(
        symbol,
        interval,
        period + 1,
      );
      if (candles.length < period + 1) return false;

      // BOLT OPTIMIZATION: Work directly on Candle array to avoid map() and slice()
      const ma = this.calculateSMA(candles, 0, period);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;

      // Crossover: prev <= ma AND curr > ma (bullish) OR prev >= ma AND curr < ma (bearish)
      return (prevClose <= ma && currClose > ma) ||
        (prevClose >= ma && currClose < ma);
    } catch (error) {
      this.logger.debug(`MA signal error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async emaSignal(
    symbol: string,
    config: any,
    interval: string,
  ): Promise<boolean> {
    try {
      const period = parseInt(config.signal_params?.ema_period || '12', 10);
      const candles = await this.klineStore.getRecentCandles(
        symbol,
        interval,
        period + 1,
      );
      if (candles.length < period + 1) return false;

      // BOLT OPTIMIZATION: Work directly on Candle array to avoid map()
      const ema = this.calculateEMA(candles, period);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;

      // Crossover: prev <= ema AND curr > ema (bullish) OR prev >= ema AND curr < ema (bearish)
      return (prevClose <= ema && currClose > ema) ||
        (prevClose >= ema && currClose < ema);
    } catch (error) {
      this.logger.debug(`EMA signal error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
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
