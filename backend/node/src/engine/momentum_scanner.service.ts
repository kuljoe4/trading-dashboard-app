import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { KlineStoreService, Candle } from './kline_store.service';
import { TickerCacheService } from './ticker_cache.service';

export interface Opportunity {
  symbol: string;
  price: number;
  momentum: number; // Price momentum percentage
  volume_24h: number;
  score: number; // 0-100 opportunity score
  direction: 'LONG' | 'SHORT';
  history?: number[]; // Recent close prices for sparkline
}

@Injectable()
export class MomentumScannerService {
  private readonly logger = new Logger(MomentumScannerService.name);

  constructor(
    private readonly klineStore: KlineStoreService,
    private readonly tickerCache: TickerCacheService,
  ) {}

  private isValidPrice(value: number): boolean {
    return Number.isFinite(value) && value > 0;
  }

  private calculateMomentum(currentPrice: number, previousPrice: number): number {
    if (!this.isValidPrice(currentPrice) || !this.isValidPrice(previousPrice)) {
      return NaN;
    }
    return ((currentPrice - previousPrice) / previousPrice) * 100;
  }

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

      const interval = config.scan_interval || '1m';
      const scanPromises = symbols.map(async (symbol) => {
        try {
          return await this.scanSymbol(symbol, interval, config);
        } catch (error) {
          this.logger.debug(`Scan error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      });

      const results = await Promise.all(scanPromises);
      const tempResults = results.filter((r): r is { opp: Opportunity, candles: Candle[] } => r !== null);

      // Sort by score descending and take top 15
      tempResults.sort((a, b) => b.opp.score - a.opp.score);

      const topResults = tempResults.slice(0, 15);

      // BOLT OPTIMIZATION: Only map history for the final top 15 results
      return topResults.map(({ opp, candles }) => ({
        ...opp,
        history: candles.slice(-20).map(c => c.close),
      }));
    } catch (error) {
      this.logger.warn(`Scan error: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async scanSymbol(
    symbol: string,
    interval: string,
    config: SessionConfig,
  ): Promise<{ opp: Opportunity, candles: Candle[] } | null> {
    // Get recent candles for momentum calculation
    const lookback = Math.max(config.scan_lookback || 1, 1);
    const candles = await this.klineStore.getRecentCandles(symbol, interval, Math.max(20, lookback + 1));
    if (candles.length < lookback + 1) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;
    const previousPrice = candles[candles.length - 1 - lookback].close;

    if (!this.isValidPrice(currentPrice) || !this.isValidPrice(previousPrice)) {
      this.logger.debug(
        `Skipping scan for ${symbol} due invalid candle prices current=${currentPrice} previous=${previousPrice}`,
      );
      return null;
    }

    // Calculate simple momentum
    const momentumPct = this.calculateMomentum(currentPrice, previousPrice);
    if (!Number.isFinite(momentumPct)) {
      this.logger.debug(
        `Skipping scan for ${symbol} due invalid momentum current=${currentPrice} previous=${previousPrice}`,
      );
      return null;
    }

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
    // BOLT OPTIMIZATION: Use O(1) ticker lookup instead of O(N) array search
    const tickerData = await this.tickerCache.getTicker(symbol);

    const displayPrice = this.isValidPrice(tickerData?.price ?? 0)
      ? tickerData!.price
      : currentPrice;

    return {
      opp: {
        symbol,
        price: displayPrice,
        momentum: momentumPct,
        volume_24h: Number(tickerData?.volume_24h || 0),
        score,
        direction,
      },
      candles,
    };
  }

  private passesConfig(opportunity: Opportunity, config: SessionConfig): boolean {
    const threshold = config.scan_pct_threshold ?? 0;
    const minVolume = config.scan_min_volume_usdt ?? 0;
    const side = config.entry_side || 'both';

    if (Math.abs(opportunity.momentum) < threshold) return false;
    if (opportunity.volume_24h < minVolume) return false;
    if (side === 'long' && opportunity.direction !== 'LONG') return false;
    if (side === 'short' && opportunity.direction !== 'SHORT') return false;

    return true;
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

    // BOLT OPTIMIZATION: Use direct loop instead of slice().map() to avoid intermediate array allocations
    const windowSize = Math.min(10, candles.length);
    let totalRange = 0;
    for (let i = candles.length - windowSize; i < candles.length; i++) {
      totalRange += candles[i].high - candles[i].low;
    }
    const avgRange = totalRange / windowSize;
    const basePrice = candles[candles.length - 1].close;

    return (avgRange / basePrice) * 100;
  }

  private calculateTrendScore(candles: Candle[]): number {
    if (candles.length < 5) return 0;

    // BOLT OPTIMIZATION: Use direct loop instead of slice() to avoid intermediate array allocation
    // Count consecutive candles in same direction (last 5)
    let upCount = 0;
    let downCount = 0;

    for (let i = candles.length - 4; i < candles.length; i++) {
      if (candles[i].close > candles[i - 1].close) {
        upCount++;
      } else {
        downCount++;
      }
    }

    // Return score based on trend strength
    return Math.max(upCount, downCount) * 4;
  }
}
