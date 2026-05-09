import { Injectable, Logger } from '@nestjs/common';

interface Ticker {
  symbol: string;
  price: number;
  volume_24h: number;
}

@Injectable()
export class TickerCacheService {
  private readonly logger = new Logger(TickerCacheService.name);
  private tickers: Map<string, Ticker> = new Map();

  async bulkUpdate(tickers: any[]) {
    for (const t of tickers) {
      const symbol = t.s || t.symbol;
      if (symbol) {
        this.tickers.set(symbol, {
          symbol,
          price: parseFloat(t.c || t.price || 0),
          volume_24h: parseFloat(t.v || t.volume_24h || 0),
        });
      }
    }
  }

  async getPrice(symbol: string): Promise<number | null> {
    const ticker = this.tickers.get(symbol);
    return ticker ? ticker.price : null;
  }

  async getLatestTickers(): Promise<Ticker[]> {
    return Array.from(this.tickers.values());
  }

  async topByVolume(n: number, excluded: string[] = []): Promise<Ticker[]> {
    return Array.from(this.tickers.values())
      .filter(t => !excluded.includes(t.symbol))
      .sort((a, b) => b.volume_24h - a.volume_24h)
      .slice(0, n);
  }
}
