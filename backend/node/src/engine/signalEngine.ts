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
<<<<<<< HEAD
  ): Promise<SignalDetail> {
=======
    side?: 'LONG' | 'SHORT',
    purpose: 'entry' | 'exit' = 'entry',
  ): Promise<boolean> {
>>>>>>> origin/feat-advanced-ema-signals-4129875549209421020
    try {
      const params = config.signal_params || {};
      const period = purpose === 'exit'
        ? parseInt(params.exit_ema_period || params.ema_period || '12', 10)
        : parseInt(params.entry_ema_period || params.ema_period || '12', 10);

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

<<<<<<< HEAD
      return {
        fired,
        value: diff,
        threshold: 0,
        unit: 'pts',
        metric: 'EMA Cross',
        description: `Close − EMA = ${diff.toFixed(2)}`,
      };
=======
      if (purpose === 'entry') {
        if (side === 'LONG') return prevClose <= ema && currClose > ema;
        if (side === 'SHORT') return prevClose >= ema && currClose < ema;
        // If side not specified, allow both
        return (prevClose <= ema && currClose > ema) || (prevClose >= ema && currClose < ema);
      } else {
        // Exit logic: cross opposite way of position
        if (side === 'LONG') return prevClose >= ema && currClose < ema;
        if (side === 'SHORT') return prevClose <= ema && currClose > ema;
        return false;
      }
>>>>>>> origin/feat-advanced-ema-signals-4129875549209421020
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
      const candles = await this.klineStore.getRecentCandles(
        symbol,
        interval,
        maxPeriod + 2,
      );
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
      this.logger.debug(`EMA Dual Cross signal error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
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

      const candles = await this.klineStore.getRecentCandles(
        symbol,
        interval,
        period + 1,
      );
      if (candles.length < period + 1) return false;

      const ema = this.calculateEMA(candles, period);
      const currClose = candles[candles.length - 1].close;

      if (purpose === 'entry') {
        if (side === 'LONG') return currClose > ema;
        if (side === 'SHORT') return currClose < ema;
        return true; // Already on some side
      } else {
        // Exit if closed on the wrong side
        if (side === 'LONG') return currClose < ema;
        if (side === 'SHORT') return currClose > ema;
        return false;
      }
    } catch (error) {
      this.logger.debug(`EMA Close signal error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private calculateEMASeries(candles: any[], period: number): number[] {
    if (candles.length < period) return [];
    const multiplier = 2 / (period + 1);
    const result: number[] = [];

    let ema = this.calculateSMA(candles, 0, period);
    // Note: This is a simplified series calculation for the tail of the candles
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
