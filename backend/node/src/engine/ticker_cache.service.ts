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

  async bulkUpdate(tickers: any[]) {
    for (const t of tickers) {
      const symbol = t.s || t.symbol;
      if (symbol) {
        // Handle both WS (!miniTicker) and REST (ticker/24hr) field names
        const price = parseFloat(t.c || t.lastPrice || t.price || 0);
        const volume = parseFloat(t.q || t.quoteVolume || t.v || t.volume_24h || 0);

        this.tickers.set(symbol, {
          symbol,
          price,
          volume_24h: volume,
        });
      }
    }
  }

  async getPrice(symbol: string): Promise<number | null> {
    const ticker = this.tickers.get(symbol);
    return ticker ? ticker.price : null;
  }

  /**
   * Get full ticker data for a symbol in O(1)
   */
  async getTicker(symbol: string): Promise<Ticker | null> {
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
