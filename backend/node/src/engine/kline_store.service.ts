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
  private static readonly EMPTY_ARRAY: Candle[] = [];

  upsertCandle(symbol: string, interval: string, kline: any) {
    const key = `${symbol}_${interval}`;
    let existing = this.klines.get(key);
    if (!existing) {
      existing = [];
      this.klines.set(key, existing);
    }

    // BOLT OPTIMIZATION: Parse kline data into local variables first to avoid premature object allocation
    // Use open time (t) instead of close time (T) for more reliable interval indexing
    const time = parseInt(kline.t || kline[0] || Date.now(), 10);
    const open = parseFloat(kline.o || kline[1] || 0);
    const high = parseFloat(kline.h || kline[2] || 0);
    const low = parseFloat(kline.l || kline[3] || 0);
    const close = parseFloat(kline.c || kline[4] || 0);
    const volume = parseFloat(kline.q || kline[7] || 0); // Standardize to Quote Volume (USDT)

    // BOLT OPTIMIZATION: Replace [].every() with direct numeric checks to avoid array allocation and functional calls
    const isValidCandle = Number.isFinite(open) && open > 0 &&
                          Number.isFinite(high) && high > 0 &&
                          Number.isFinite(low) && low > 0 &&
                          Number.isFinite(close) && close > 0;

    if (!isValidCandle) {
      this.logger.verbose(
        `Ignoring invalid candle for ${symbol}/${interval} at ${time}: open=${open}, high=${high}, low=${low}, close=${close}`,
      );
      return;
    }

    const lastIdx = existing.length - 1;

    // BOLT OPTIMIZATION: O(1) paths for real-time streams
    if (existing.length > 0) {
      const lastCandle = existing[lastIdx];
      
      if (lastCandle.time === time) {
        // BOLT OPTIMIZATION: Mutate existing object in-place to avoid new allocations for every market tick
        lastCandle.open = open;
        lastCandle.high = high;
        lastCandle.low = low;
        lastCandle.close = close;
        lastCandle.volume = volume;
        return;
      } 
      
      if (time > lastCandle.time) {
        // New candle arriving - allocate only once per interval
        existing.push({ time, open, high, low, close, volume });
        if (existing.length > this.MAX_CANDLES) {
          existing.shift(); // O(1) removal from start (for small N like 500)
        }
        return;
      }
    } else {
      existing.push({ time, open, high, low, close, volume });
      return;
    }

    // Fallback for out-of-order candles (rare in real-time)
    const idx = existing.findIndex(c => c.time === time);
    if (idx !== -1) {
      const c = existing[idx];
      c.open = open;
      c.high = high;
      c.low = low;
      c.close = close;
      c.volume = volume;
    } else {
      existing.push({ time, open, high, low, close, volume });
      existing.sort((a, b) => a.time - b.time);
      if (existing.length > this.MAX_CANDLES) {
        existing.shift();
      }
    }
  }

  getRecentCandles(symbol: string, interval: string, count: number): Candle[] {
    const key = `${symbol}_${interval}`;
    const candles = this.klines.get(key);
    if (!candles) return KlineStoreService.EMPTY_ARRAY;
    return candles.slice(-count);
  }

  /**
   * BOLT OPTIMIZATION: Provides direct access to the internal candle array.
   * Consumers MUST NOT mutate this array. Use for indexing to avoid slice() allocations.
   */
  getRawCandles(symbol: string, interval: string): Candle[] {
    const key = `${symbol}_${interval}`;
    return this.klines.get(key) || KlineStoreService.EMPTY_ARRAY;
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

  /**
   * Prune klines for symbols that are no longer in the active watchlist
   */
  prune(activeKeys: Set<string>) {
    const initialSize = this.klines.size;
    for (const key of this.klines.keys()) {
      if (!activeKeys.has(key)) {
        this.klines.delete(key);
      }
    }
    const finalSize = this.klines.size;
    if (initialSize !== finalSize) {
      this.logger.verbose(`Pruned KlineStore: ${initialSize} -> ${finalSize} keys`);
    }
  }

  /**
   * Clear all stored klines to free up memory (Deep Sleep)
   */
  clear() {
    this.klines.clear();
    this.logger.verbose('KlineStore cleared');
  }
}
