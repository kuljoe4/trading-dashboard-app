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
  private readonly MAX_CANDLES = 500;

  async upsertCandle(symbol: string, interval: string, kline: any) {
    const key = `${symbol}_${interval}`;
    let existing = this.klines.get(key);
    if (!existing) {
      existing = [];
      this.klines.set(key, existing);
    }

    // Parse kline data from Binance format
    const candle: Candle = {
      time: parseInt(kline.T || kline[6] || Date.now(), 10),
      open: parseFloat(kline.o || kline[1] || 0),
      high: parseFloat(kline.h || kline[2] || 0),
      low: parseFloat(kline.l || kline[3] || 0),
      close: parseFloat(kline.c || kline[4] || 0),
      volume: parseFloat(kline.v || kline[7] || 0),
    };

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

  async getRecentCandles(symbol: string, interval: string, count: number): Promise<Candle[]> {
    const key = `${symbol}_${interval}`;
    const candles = this.klines.get(key) || [];
    return candles.slice(-count);
  }

  async getLookbackExtremes(
    symbol: string,
    interval: string,
    period: number,
  ): Promise<{ lows: number[]; highs: number[] }> {
    const candles = await this.getRecentCandles(symbol, interval, period);
    if (candles.length === 0) {
      return { lows: [], highs: [] };
    }

    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);

    return { lows, highs };
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
    this.logger.debug(`Seeded ${trimmed.length} candles for ${symbol}/${interval}`);
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
