import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../../models/session_config';
import { KlineStoreService, Candle } from './kline_store.service';
import { TickerCacheService } from './ticker_cache.service';

export interface Opportunity {
  symbol: string;
  price: number;
  momentum: number; // Price momentum percentage
  volume_24h: number;
  score: number; // 0-100 opportunity score
  direction: 'LONG' | 'SHORT';
}

@Injectable()
export class MomentumScannerService {
  private readonly logger = new Logger(MomentumScannerService.name);

  constructor(
    private readonly klineStore: KlineStoreService,
    private readonly tickerCache: TickerCacheService,
  ) {}

  async start(config: SessionConfig) {
    this.logger.log(
      `MomentumScanner started with watchlist_size=${config.watchlist_size}`,
    );
  }

  async stop() {
    this.logger.log('MomentumScanner stopped');
  }

  /**
   * Scan for momentum opportunities based on recent price action
   * Returns top opportunities sorted by score (highest first)
   */
  async scan(config: SessionConfig): Promise<Opportunity[]> {
    try {
      // Get watchlist symbols
      let symbols: string[];
      if (config.symbols && config.symbols.length > 0) {
        symbols = config.symbols;
      } else {
        const topByVolume = await this.tickerCache.topByVolume(
          config.watchlist_size || 10,
          config.excluded_symbols || [],
        );
        symbols = topByVolume.map((t: any) => t.symbol);
      }

      const opportunities: Opportunity[] = [];
      const interval = config.scan_interval || '1m';

      for (const symbol of symbols) {
        try {
          const opportunity = await this.scanSymbol(
            symbol,
            interval,
            config,
          );
          if (opportunity) {
            opportunities.push(opportunity);
          }
        } catch (error) {
          this.logger.debug(`Scan error for ${symbol}: ${error.message}`);
        }
      }

      // Sort by score descending
      opportunities.sort((a, b) => b.score - a.score);

      return opportunities;
    } catch (error) {
      this.logger.warn(`Scan error: ${error.message}`);
      return [];
    }
  }

  private async scanSymbol(
    symbol: string,
    interval: string,
    config: SessionConfig,
  ): Promise<Opportunity | null> {
    // Get recent candles for momentum calculation
    const candles = await this.klineStore.getRecentCandles(symbol, interval, 20);
    if (candles.length < 2) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;
    const previousPrice = candles[candles.length - 2].close;

    // Calculate simple momentum
    const momentumPct =
      ((currentPrice - previousPrice) / previousPrice) * 100;

    // Determine direction based on momentum
    const direction = momentumPct > 0 ? 'LONG' : 'SHORT';

    // Calculate opportunity score (0-100)
    // Based on: momentum magnitude, volume, volatility
    const score = this.calculateScore(
      candles,
      momentumPct,
      config,
    );

    // Get current price and volume
    const ticker = await this.tickerCache.getPrice(symbol);
    const tickers = await this.tickerCache.getLatestTickers();
    const tickerData = tickers.find((t: any) => t.symbol === symbol);

    return {
      symbol,
      price: ticker || currentPrice,
      momentum: momentumPct,
      volume_24h: tickerData?.volume_24h || 0,
      score,
      direction,
    };
  }

  private calculateScore(
    candles: Candle[],
    momentumPct: number,
    config: SessionConfig,
  ): number {
    // Simple scoring: combination of momentum and volatility
    let score = 0;

    // Momentum component (0-50 points)
    const momentumScore = Math.min(
      50,
      Math.abs(momentumPct) * 10,
    );
    score += momentumScore;

    // Volatility component (0-30 points)
    const volatility = this.calculateVolatility(candles);
    const volatilityScore = Math.min(30, volatility * 10);
    score += volatilityScore;

    // Trend confirmation component (0-20 points)
    // Simple: count candles in same direction
    const trendScore = this.calculateTrendScore(candles);
    score += trendScore;

    return Math.min(100, Math.max(0, score));
  }

  private calculateVolatility(candles: Candle[]): number {
    if (candles.length < 2) return 0;

    const ranges = candles.slice(-10).map((c) => c.high - c.low);
    const avgRange =
      ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const basePrice = candles[candles.length - 1].close;

    return (avgRange / basePrice) * 100;
  }

  private calculateTrendScore(candles: Candle[]): number {
    if (candles.length < 5) return 0;

    // Count consecutive candles in same direction (last 5)
    const recentCandles = candles.slice(-5);
    let upCount = 0;
    let downCount = 0;

    for (let i = 1; i < recentCandles.length; i++) {
      if (recentCandles[i].close > recentCandles[i - 1].close) {
        upCount++;
      } else {
        downCount++;
      }
    }

    // Return score based on trend strength
    return Math.max(upCount, downCount) * 4;
  }
}
