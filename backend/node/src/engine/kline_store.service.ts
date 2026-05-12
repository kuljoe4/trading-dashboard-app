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
    const existing = this.klines.get(key) || [];

    // Parse kline data from Binance format
    const candle: Candle = {
      time: parseInt(kline.T || kline[6] || Date.now(), 10),
      open: parseFloat(kline.o || kline[1] || 0),
      high: parseFloat(kline.h || kline[2] || 0),
      low: parseFloat(kline.l || kline[3] || 0),
      close: parseFloat(kline.c || kline[4] || 0),
      volume: parseFloat(kline.v || kline[7] || 0),
    };

    // O(1) Update: Check if it's the current candle being updated or a new one
    // We prioritize the latest timestamp to maintain chronological order
    if (existing.length > 0) {
      const last = existing[existing.length - 1];
      if (last.time === candle.time) {
        existing[existing.length - 1] = candle;
      } else if (candle.time > last.time) {
        existing.push(candle);
      } else {
        // Late arriving candle, falling back to safe but slower update to ensure data integrity
        const idx = existing.findIndex(c => c.time === candle.time);
        if (idx !== -1) {
          existing[idx] = candle;
        } else {
          existing.push(candle);
          existing.sort((a, b) => a.time - b.time);
        }
      }
    } else {
      existing.push(candle);
    }

    // Keep only the last N candles
    if (existing.length > this.MAX_CANDLES) {
      existing.shift();
    }
    this.klines.set(key, existing);
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
