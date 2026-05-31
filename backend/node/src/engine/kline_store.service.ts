import { Injectable, Logger } from '@nestjs/common';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Injectable()
export class KlineStoreService {
  private readonly logger = new Logger(KlineStoreService.name);
  private klines: Map<string, Candle[]> = new Map();
  private readonly MAX_CANDLES = this.readMaxCandles();

  private readMaxCandles(): number {
    const parsed = Number(process.env.KLINE_MAX_CANDLES || 200);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 50), 500) : 200;
  }

  getMaxCandles(): number {
    return this.MAX_CANDLES;
  }

  upsertCandle(symbol: string, interval: string, kline: any) {
    const key = `${symbol}_${interval}`;
    let existing = this.klines.get(key);
    if (!existing) {
      existing = [];
      this.klines.set(key, existing);
    }

    // Parse kline data from Binance format
    // BOLT: Use open time (t) instead of close time (T) for more reliable interval indexing
    const candle: Candle = {
      time: parseInt(kline.t || kline[0] || Date.now(), 10),
      open: parseFloat(kline.o || kline[1] || 0),
      high: parseFloat(kline.h || kline[2] || 0),
      low: parseFloat(kline.l || kline[3] || 0),
      close: parseFloat(kline.c || kline[4] || 0),
      volume: parseFloat(kline.q || kline[7] || 0), // Standardize to Quote Volume (USDT)
    };

    const isValidCandle = [candle.open, candle.high, candle.low, candle.close].every(
      (value) => Number.isFinite(value) && value > 0,
    );

    if (!isValidCandle) {
      this.logger.verbose(
        `Ignoring invalid candle for ${symbol}/${interval} at ${candle.time}: open=${candle.open}, high=${candle.high}, low=${candle.low}, close=${candle.close}`,
      );
      return;
    }

    const lastIdx = existing.length - 1;

    // BOLT OPTIMIZATION: O(1) paths for real-time streams
    if (existing.length > 0) {
      const lastCandle = existing[lastIdx];
      
      if (lastCandle.time === candle.time) {
        // Update current candle
        existing[lastIdx] = candle;
        return;
      } 
      
      if (candle.time > lastCandle.time) {
        // New candle arriving
        existing.push(candle);
        if (existing.length > this.MAX_CANDLES) {
          existing.shift(); // O(1) removal from start (for small N like 500)
        }
        return;
      }
    } else {
      existing.push(candle);
      return;
    }

    // Fallback for out-of-order candles (rare in real-time)
    const idx = existing.findIndex(c => c.time === candle.time);
    if (idx !== -1) {
      existing[idx] = candle;
    } else {
      existing.push(candle);
      existing.sort((a, b) => a.time - b.time);
      if (existing.length > this.MAX_CANDLES) {
        existing.shift();
      }
    }
  }

  getRecentCandles(symbol: string, interval: string, count: number): Candle[] {
    const key = `${symbol}_${interval}`;
    const candles = this.klines.get(key) || [];
    return candles.slice(-count);
  }

  /**
   * BOLT OPTIMIZATION: Provides direct access to the internal candle array.
   * Consumers MUST NOT mutate this array. Use for indexing to avoid slice() allocations.
   */
  getRawCandles(symbol: string, interval: string): Candle[] {
    const key = `${symbol}_${interval}`;
    return this.klines.get(key) || [];
  }

  /**
   * BOLT OPTIMIZATION: Calculate min/max extremes in a single pass without array allocations (slice/map).
   */
  getLookbackExtremes(
    symbol: string,
    interval: string,
    period: number,
  ): { minLow: number; maxHigh: number } {
    const key = `${symbol}_${interval}`;
    const candles = this.klines.get(key) || [];

    if (candles.length === 0) {
      return { minLow: 0, maxHigh: 0 };
    }

    const startIdx = Math.max(0, candles.length - period);
    let minLow = Infinity;
    let maxHigh = -Infinity;

    for (let i = startIdx; i < candles.length; i++) {
      const candle = candles[i];
      if (candle.low < minLow) minLow = candle.low;
      if (candle.high > maxHigh) maxHigh = candle.high;
    }

    return { minLow, maxHigh };
  }

  async seedFromRest(symbol: string, interval: string, klines: any[]) {
    const key = `${symbol}_${interval}`;
    const candles: Candle[] = klines.map((k: any) => ({
      time: parseInt(k[0], 10),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[7]),
    }));

    // Keep only the last N candles
    const trimmed = candles.slice(-this.MAX_CANDLES);
    this.klines.set(key, trimmed);
    this.logger.verbose(`Seeded ${trimmed.length} candles for ${symbol}/${interval}`);
  }

  getStats(): { keys: string[]; counts: Record<string, number> } {
    const counts: Record<string, number> = {};
    for (const [key, candles] of this.klines) {
      counts[key] = candles.length;
    }
    return {
      keys: Array.from(this.klines.keys()),
      counts,
    };
  }
}
