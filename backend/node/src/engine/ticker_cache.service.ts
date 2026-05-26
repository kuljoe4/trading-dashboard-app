import { Injectable, Logger } from '@nestjs/common';

export interface Ticker {
  symbol: string;
  price: number;
  volume_24h: number;
}

@Injectable()
export class TickerCacheService {
  private readonly logger = new Logger(TickerCacheService.name);
  private tickers: Map<string, Ticker> = new Map();
  private _topByVolumeCache: { [key: string]: { data: Ticker[], timestamp: number } } = {};

  /**
   * BOLT OPTIMIZATION: Optimized to use object reuse and avoid redundant parseFloat.
   * Reduces GC pressure by avoiding ~18,000 object allocations per minute in the hot loop.
   */
  bulkUpdate(tickers: any[]) {
    // BOLT OPTIMIZATION: Use index-based loop for performance and object reuse to reduce GC pressure
    const len = tickers.length;
    for (let i = 0; i < len; i++) {
      const t = tickers[i];
      const symbol = t.s || t.symbol;
      if (symbol) {
        const existing = this.tickers.get(symbol);

        // Handle both WS (!miniTicker) and REST (ticker/24hr) field names
        const priceStr = t.c || t.lastPrice || t.price;
        const volumeStr = t.q || t.quoteVolume || t.v || t.volume_24h;

        if (existing) {
          // Mutate existing object to avoid new allocations every 2s
          if (priceStr !== undefined) existing.price = parseFloat(priceStr);
          if (volumeStr !== undefined) existing.volume_24h = parseFloat(volumeStr);
        } else {
          this.tickers.set(symbol, {
            symbol,
            price: priceStr !== undefined ? parseFloat(priceStr) : 0,
            volume_24h: volumeStr !== undefined ? parseFloat(volumeStr) : 0,
          });
        }
      }
    }
  }

  getPrice(symbol: string): number | null {
    const ticker = this.tickers.get(symbol);
    return ticker ? ticker.price : null;
  }

  /**
   * Get full ticker data for a symbol in O(1)
   */
  getTicker(symbol: string): Ticker | null {
    return this.tickers.get(symbol) || null;
  }

  async getLatestTickers(): Promise<Ticker[]> {
    return Array.from(this.tickers.values());
  }

  getCacheSize(): number {
    return this.tickers.size;
  }

  async topByVolume(n: number, excluded: string[] = []): Promise<Ticker[]> {
    const cacheKey = `${n}_${[...excluded].sort().join(',')}`;
    const cached = this._topByVolumeCache[cacheKey];
    const CACHE_TTL_MS = 30000; // 30 seconds

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.data;
    }

    const all = Array.from(this.tickers.values());
    this.logger.debug(`topByVolume requested ${n} symbols. Cache size: ${all.length}. Cache miss - recomputing.`);

    const result = all
      .filter(t => !excluded.includes(t.symbol))
      .sort((a, b) => b.volume_24h - a.volume_24h)
      .slice(0, n);

    this._topByVolumeCache[cacheKey] = {
      data: result,
      timestamp: Date.now()
    };

    return result;
  }
}
