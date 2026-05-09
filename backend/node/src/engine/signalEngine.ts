import { Injectable, Logger } from '@nestjs/common';
import { KlineStoreService, Candle } from './kline_store.service';
import { SessionConfig } from '../../models/session_config';

@Injectable()
export class SignalEngineService {
  private readonly logger = new Logger(SignalEngineService.name);

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string) => Promise<boolean>
  > = {
    engulfing: this.engulfingSignal.bind(this),
    ma: this.maSignal.bind(this),
    ema: this.emaSignal.bind(this),
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
        this.logger.warn(`Signal ${signalType} error for ${symbol}: ${error.message}`);
        failedSignals.push(signalType);
      }
    }

    const allFired = failedSignals.length === 0;
    const reason =
      `Signals fired: ${firedSignals.length}/${config.enabled_signals.length}` +
      (firedSignals.length > 0 ? ` (${firedSignals.join(', ')})` : '') +
      (failedSignals.length > 0 ? `; Failed: ${failedSignals.join(', ')}` : '');

    return { allFired, firedSignals, reason };
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
      this.logger.debug(`Engulfing signal error for ${symbol}: ${error.message}`);
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

      const closes = candles.map((c) => c.close);
      const ma = this.calculateSMA(closes.slice(0, period));
      const prevClose = closes[closes.length - 2];
      const currClose = closes[closes.length - 1];

      // Crossover: prev <= ma AND curr > ma (bullish) OR prev >= ma AND curr < ma (bearish)
      return (prevClose <= ma && currClose > ma) ||
        (prevClose >= ma && currClose < ma);
    } catch (error) {
      this.logger.debug(`MA signal error for ${symbol}: ${error.message}`);
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

      const closes = candles.map((c) => c.close);
      const ema = this.calculateEMA(closes, period);
      const prevClose = closes[closes.length - 2];
      const currClose = closes[closes.length - 1];

      // Crossover: prev <= ema AND curr > ema (bullish) OR prev >= ema AND curr < ema (bearish)
      return (prevClose <= ema && currClose > ema) ||
        (prevClose >= ema && currClose < ema);
    } catch (error) {
      this.logger.debug(`EMA signal error for ${symbol}: ${error.message}`);
      return false;
    }
  }

  private calculateSMA(prices: number[]): number {
    if (prices.length === 0) return 0;
    return prices.reduce((sum, price) => sum + price, 0) / prices.length;
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length < period) return this.calculateSMA(prices);

    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(prices.slice(0, period));

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }
}
    }
  }

  private async emaSignal(symbol: string, config: any): Promise<boolean> {
    try {
      const period = parseInt(config.signal_params?.ema_period || '12', 10);
      const candles = await this.klineStore.getRecentCandles(symbol, '1m', period + 1);
      if (candles.length < period + 1) return false;

      const closes = candles.map(c => parseFloat(c[4]));
      const ema = this.calculateEMA(closes.slice(-period), period);
      const prevClose = closes[closes.length - 2];
      const currClose = closes[closes.length - 1];

      return (prevClose <= ema && currClose > ema) || (prevClose >= ema && currClose < ema);
    } catch (error) {
      this.logger.error(`EMA signal error for ${symbol}: ${error.message}`);
      return false;
    }
  }

  private calculateSMA(prices: number[]): number {
    return prices.reduce((sum, price) => sum + price, 0) / prices.length;
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return this.calculateSMA(prices);
    
    const multiplier = 2 / (period + 1);
    let ema = this.calculateSMA(prices.slice(-period));
    
    for (let i = prices.length - period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }
    
    return ema;
  }
}