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

interface SignalEntryResult {
  allFired: boolean;
  firedSignals: string[];
  reason: string;
  details: Record<string, SignalDetail>;
}

@Injectable()
export class SignalEngineService {
  private readonly logger = new Logger(SignalEngineService.name);

  private readonly signalHandlers: Record<
    string,
    (symbol: string, config: any, interval: string) => Promise<SignalDetail>
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
  ): Promise<SignalEntryResult> {
    if (!config.enabled_signals || config.enabled_signals.length === 0) {
      return {
        allFired: false,
        firedSignals: [],
        reason: 'No signals enabled',
        details: {},
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
        const detail = await handler(symbol, config, interval);
        details[signalType] = detail;
        if (detail.fired) {
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
    if (candles.length < lookback + 1) {
      return {
        fired: false,
        value: 0,
        threshold: config.scan_pct_threshold || 0,
        unit: '%',
        metric: 'Momentum %',
        description: 'Not enough candles',
      };
    }

    const first = candles[candles.length - 1 - lookback].close;
    const last = candles[candles.length - 1].close;
    const pct = ((last - first) / first) * 100;
    const value = Math.abs(pct);
    const threshold = config.scan_pct_threshold || 0;
    return {
      fired: value >= threshold,
      value,
      threshold,
      unit: '%',
      metric: 'Momentum %',
      description: `${value.toFixed(2)}% vs threshold ${threshold.toFixed(2)}%`,
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
        unit: 'pts',
        metric: 'Breakout H/L',
        description: 'Not enough candles',
      };
    }

    const current = candles[candles.length - 1];

    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (let i = 0; i < candles.length - 1; i++) {
      if (candles[i].high > maxHigh) maxHigh = candles[i].high;
      if (candles[i].low < minLow) minLow = candles[i].low;
    }

    const breakoutAbove = current.close - maxHigh;
    const breakoutBelow = minLow - current.close;
    const fired = breakoutAbove > 0 || breakoutBelow > 0;
    const value = fired ? Math.max(breakoutAbove, breakoutBelow) : 0;
    const description = breakoutAbove > 0
      ? `Above high by ${breakoutAbove.toFixed(2)}`
      : breakoutBelow > 0
        ? `Below low by ${breakoutBelow.toFixed(2)}`
        : 'No breakout';

    return {
      fired,
      value,
      threshold: 0,
      unit: 'pts',
      metric: 'Breakout H/L',
      description,
    };
  }

  private async engulfingSignal(
    symbol: string,
    config: any,
    interval: string,
  ): Promise<SignalDetail> {
    try {
      const candles = await this.klineStore.getRecentCandles(
        symbol,
        interval,
        2,
      );
      if (candles.length < 2) {
        return {
          fired: false,
          value: 0,
          threshold: 1,
          unit: 'pts',
          metric: 'Engulfing',
          description: 'Not enough candles',
        };
      }

      const prevCandle = candles[0];
      const currCandle = candles[1];
      const fired = currCandle.high > prevCandle.high && currCandle.low < prevCandle.low;

      return {
        fired,
        value: fired ? 1 : 0,
        threshold: 1,
        unit: 'pts',
        metric: 'Engulfing',
        description: fired ? 'Engulfing candle detected' : 'No engulfing candle',
      };
    } catch (error) {
      this.logger.debug(`Engulfing signal error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 1,
        unit: 'pts',
        metric: 'Engulfing',
        description: 'Signal error',
      };
    }
  }

  private async maSignal(
    symbol: string,
    config: any,
    interval: string,
  ): Promise<SignalDetail> {
    try {
      const period = parseInt(config.signal_params?.ma_period || '20', 10);
      const candles = await this.klineStore.getRecentCandles(
        symbol,
        interval,
        period + 1,
      );
      if (candles.length < period + 1) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: 'pts',
          metric: 'MA Cross',
          description: 'Not enough candles',
        };
      }

      const ma = this.calculateSMA(candles, 0, period);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;
      const diff = currClose - ma;
      const prevDiff = prevClose - ma;
      const fired = (prevDiff <= 0 && diff > 0) || (prevDiff >= 0 && diff < 0);

      return {
        fired,
        value: diff,
        threshold: 0,
        unit: 'pts',
        metric: 'MA Cross',
        description: `Close − MA = ${diff.toFixed(2)}`,
      };
    } catch (error) {
      this.logger.debug(`MA signal error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: 'pts',
        metric: 'MA Cross',
        description: 'Signal error',
      };
    }
  }

  private async emaSignal(
    symbol: string,
    config: any,
    interval: string,
  ): Promise<SignalDetail> {
    try {
      const period = parseInt(config.signal_params?.ema_period || '12', 10);
      const candles = await this.klineStore.getRecentCandles(
        symbol,
        interval,
        period + 1,
      );
      if (candles.length < period + 1) {
        return {
          fired: false,
          value: 0,
          threshold: 0,
          unit: 'pts',
          metric: 'EMA Cross',
          description: 'Not enough candles',
        };
      }

      const ema = this.calculateEMA(candles, period);
      const prevClose = candles[candles.length - 2].close;
      const currClose = candles[candles.length - 1].close;
      const diff = currClose - ema;
      const prevDiff = prevClose - ema;
      const fired = (prevDiff <= 0 && diff > 0) || (prevDiff >= 0 && diff < 0);

      return {
        fired,
        value: diff,
        threshold: 0,
        unit: 'pts',
        metric: 'EMA Cross',
        description: `Close − EMA = ${diff.toFixed(2)}`,
      };
    } catch (error) {
      this.logger.debug(`EMA signal error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        fired: false,
        value: 0,
        threshold: 0,
        unit: 'pts',
        metric: 'EMA Cross',
        description: 'Signal error',
      };
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
