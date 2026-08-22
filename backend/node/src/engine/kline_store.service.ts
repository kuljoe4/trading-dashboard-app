import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Kline as KlineEntity } from '../models/entities/Kline.entity';

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

  // BOLT OPTIMIZATION: Stable caches for completed candles to allow O(1) lookbacks
  private readonly hlStableCache = new Map<string, { time: number; minLow: number; maxHigh: number; count: number }>();

  // BOLT OPTIMIZATION: Cache pre-parsed milliseconds values for interval strings
  private readonly intervalMsCache = new Map<string, number>();

  constructor(
    @InjectRepository(KlineEntity)
    private readonly klineRepository: Repository<KlineEntity>,
  ) {}

  private readMaxCandles(): number {
    const parsed = Number(process.env.KLINE_MAX_CANDLES || 200);
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 50), 500) : 200;
  }

  getMaxCandles(): number {
    return this.MAX_CANDLES;
  }
  private static readonly EMPTY_ARRAY: Candle[] = [];

  async upsertCandle(symbol: string, interval: string, kline: any) {
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
        // Persist completed candle to DB if it's new
        this.persistCandle(symbol, interval, lastCandle).catch(() => {});

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
   * BOLT OPTIMIZATION: Calculate min/max extremes in a single pass with stable caching for completed candles.
   * This turns O(N) into O(1) for the vast majority of calls and eliminates hot-path string allocations/logging.
   */
  private parseIntervalToMs(interval: string): number {
    // Robust Defensive Guard: ensure interval is a valid, non-empty string before slicing or parsing
    if (typeof interval !== 'string' || !interval) {
      return 60 * 1000; // default to 1m
    }

    // BOLT OPTIMIZATION: Return cached parsed ms value if present to skip string slicing/parsing
    const cached = this.intervalMsCache.get(interval);
    if (cached !== undefined) return cached;

    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1), 10);
    let ms = 60 * 1000; // default to 1m
    if (!isNaN(value) && value > 0) {
      switch (unit) {
        case 'm': ms = value * 60 * 1000; break;
        case 'h': ms = value * 60 * 60 * 1000; break;
        case 'd': ms = value * 24 * 60 * 60 * 1000; break;
        case 'w': ms = value * 7 * 24 * 60 * 60 * 1000; break;
        case 'M': ms = value * 30 * 24 * 60 * 60 * 1000; break;
      }
    }
    this.intervalMsCache.set(interval, ms);
    return ms;
  }

  /**
   * Helper to verify if the last completed candle is too old relative to the expected interval.
   * Returns true if stale, false otherwise.
   */
  private isLookbackStale(
    targetCandle: Candle,
    expectedIntervalMs: number,
    symbol: string,
    interval: string
  ): boolean {
    if (targetCandle.time > 1000000000000) {
      const ageMs = Date.now() - targetCandle.time;
      const maxAgeMs = expectedIntervalMs * 2.5;
      if (ageMs > maxAgeMs) {
        this.logger.warn(
          `[Lookback Validation] STALE_DATA: Completed candle for ${symbol} (${interval}) is too old. Age: ${Math.round(ageMs / 1000)}s (Last Candle Time: ${targetCandle.time}), Max Allowed: ${Math.round(maxAgeMs / 1000)}s. Triggering fallback to Pct SL.`,
        );
        return true;
      }
    }
    return false;
  }

  getLookbackExtremes(
    symbol: string,
    interval: string,
    period: number,
  ): { minLow: number; maxHigh: number } {
    const effectiveInterval = (!interval || interval === 'default') ? '1m' : interval;
    const key = `${symbol}_${effectiveInterval}`;
    const candles = this.klines.get(key) || [];

    if (candles.length <= 1) {
      return { minLow: 0, maxHigh: 0 };
    }

    const endIdx = candles.length - 1;
    const startIdx = Math.max(0, endIdx - period);
    const targetCandle = candles[endIdx - 1];

    const expectedIntervalMs = this.parseIntervalToMs(interval);

    // BOLT OPTIMIZATION: Try stable cache FIRST before any O(N) loops.
    // Since completed candles are immutable, the gap detection and extremes result remains static.
    // We only need to check freshness dynamically (which is O(1) time comparison).
    const stableKey = `${symbol}:${effectiveInterval}:${period}`;
    const stable = this.hlStableCache.get(stableKey);

    if (stable && stable.time === targetCandle.time && stable.count === period) {
      if (this.isLookbackStale(targetCandle, expectedIntervalMs, symbol, effectiveInterval)) {
        return { minLow: 0, maxHigh: 0 };
      }
      return { minLow: stable.minLow, maxHigh: stable.maxHigh };
    }

    if (this.isLookbackStale(targetCandle, expectedIntervalMs, symbol, interval)) {
      return { minLow: 0, maxHigh: 0 };
    }

    // 2. Gap Detection: Scan consecutive completed candles within the lookback window for any time gaps.
    for (let i = startIdx + 1; i < endIdx; i++) {
      const currentCandle = candles[i];
      const prevCandle = candles[i - 1];
      const delta = currentCandle.time - prevCandle.time;
      if (delta > expectedIntervalMs * 1.5) {
        this.logger.warn(
          `[Lookback Validation] TIME_GAP: Detected data gap of ${Math.round(delta / 1000)}s between consecutive candles at times ${prevCandle.time} and ${currentCandle.time} for ${symbol} (${interval}). Expected Interval: ${Math.round(expectedIntervalMs / 1000)}s (Threshold: ${Math.round(expectedIntervalMs * 1.5 / 1000)}s). Lookback period: ${period}. Triggering fallback to Pct SL.`,
        );
        return { minLow: 0, maxHigh: 0 };
      }
    }

    let minLow = Infinity;
    let maxHigh = -Infinity;

    for (let i = startIdx; i < endIdx; i++) {
      const candle = candles[i];
      if (candle.low < minLow) minLow = candle.low;
      if (candle.high > maxHigh) maxHigh = candle.high;
    }

    // Maintain stable cache
    this.hlStableCache.set(stableKey, {
      time: targetCandle.time,
      minLow,
      maxHigh,
      count: period,
    });

    if (this.hlStableCache.size > 1000) {
      const iter = this.hlStableCache.keys();
      for (let i = 0; i < 100; i++) {
        const next = iter.next();
        if (next.done) break;
        this.hlStableCache.delete(next.value);
      }
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

    // Persist to DB for future boots
    this.bulkPersist(symbol, interval, trimmed).catch(() => {});
  }

  async loadFromDb(symbol: string, interval: string, count: number): Promise<number> {
    try {
      const entities = await this.klineRepository.find({
        where: { symbol, interval },
        order: { time: 'DESC' },
        take: count,
      });

      if (entities.length > 0) {
        const candles: Candle[] = entities.reverse().map(e => ({
          time: Number(e.time),
          open: Number(e.open),
          high: Number(e.high),
          low: Number(e.low),
          close: Number(e.close),
          volume: Number(e.volume),
        }));

        this.klines.set(`${symbol}_${interval}`, candles);
        return candles.length;
      }
    } catch (err: any) {
      this.logger.error(`Failed to load klines from DB: ${err.message}`);
    }
    return 0;
  }

  private async persistCandle(symbol: string, interval: string, candle: Candle) {
    try {
      const id = `${symbol}_${interval}_${candle.time}`;
      await this.klineRepository.upsert({
        id,
        symbol,
        interval,
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      }, ['id']);
    } catch (err) {}
  }

  private async bulkPersist(symbol: string, interval: string, candles: Candle[]) {
    try {
      const entities = candles.map(c => ({
        id: `${symbol}_${interval}_${c.time}`,
        symbol,
        interval,
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      // Chunk large inserts to avoid parameter limits
      for (let i = 0; i < entities.length; i += 100) {
        await this.klineRepository.upsert(entities.slice(i, i + 100), ['id']);
      }
    } catch (err) {}
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
   * Clear all stored klines to free up memory (Deep Sleep)
   */
  clear() {
    this.klines.clear();
    this.hlStableCache.clear();
    this.logger.verbose('KlineStore cleared');
  }
}
