import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { ENGINE_CONSTANTS } from '../models/constants';
import { KlineStoreService, Candle } from './kline_store.service';
import { TickerCacheService } from './ticker_cache.service';
import { MarketFeedService } from './market_feed.service';

export interface Opportunity {
  symbol: string;
  price: number;
  momentum: number; // Price momentum percentage
  volume_24h: number;
  volume_rank?: number;
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
    private readonly marketFeed: MarketFeedService,
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
    this.logger.verbose(
      `MomentumScanner started with watchlist_size=${config.watchlist_size}`,
    );
  }

  async stop() {
    this.logger.verbose('MomentumScanner stopped');
  }

  /**
   * Scan for momentum opportunities based on recent price action
   * Returns top opportunities sorted by score (highest first)
   */
  scan(config: SessionConfig): Opportunity[] {
    try {
      // BOLT OPTIMIZATION: Use a single Map to collect and deduplicate results directly.
      // This eliminates the overhead of intermediate results/singleResults arrays and re-processing.
      const resultMap = new Map<string, { opp: Opportunity; candles: Candle[] }>();

      // 1. Global Scan (if enabled)
      if (config.global_scanner_enabled !== false) {
        let symbols: string[];
        if (config.symbols && config.symbols.length > 0) {
          symbols = config.symbols;
        } else {
          const topByVolume = this.tickerCache.topByVolume(
            (config.watchlist_size || 10) + (config.watchlist_offset || 0),
            config.excluded_symbols || [],
          );
          const slicedTop = topByVolume.slice(config.watchlist_offset || 0);
          symbols = slicedTop.map((t: any) => t.symbol);
        }

        const interval = config.scan_interval || '1m';
        for (let i = 0; i < symbols.length; i++) {
          const symbol = symbols[i];
          try {
            const res = this.scanSymbol(symbol, interval, config);
            if (res) {
              // Populate volume_rank based on absolute position in the volume-sorted list
              res.opp.volume_rank = (config.watchlist_offset || 0) + i + 1;
              resultMap.set(symbol, res);
            }
          } catch (error) {
            this.logger.verbose(`Global scan error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      // 2. Single Symbol Monitors
      if (config.single_symbol_configs && config.single_symbol_configs.length > 0) {
        for (const sc of config.single_symbol_configs) {
          if (!sc.enabled) continue;
          try {
            const symbolConfig = sc.use_custom_config && sc.custom_config
              ? { ...config, ...sc.custom_config }
              : config;
            const interval = symbolConfig.scan_interval || '1m';
            const res = this.scanSymbol(sc.symbol, interval, symbolConfig);
            if (res) {
              resultMap.set(sc.symbol, res);
            }
          } catch (error) {
            this.logger.verbose(`Single symbol scan error for ${sc.symbol}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      // BOLT OPTIMIZATION: Use direct iteration to convert Map to array for sorting.
      const tempResults: { opp: Opportunity; candles: Candle[] }[] = [];
      for (const r of resultMap.values()) {
        tempResults.push(r);
      }

      // Sort by score descending and take top results
      tempResults.sort((a, b) => b.opp.score - a.opp.score);

      const topResults = tempResults.slice(0, ENGINE_CONSTANTS.SCANNER_MAX_RESULTS);

      // BOLT OPTIMIZATION: Only map history for the final top results
      return topResults.map(({ opp, candles }) => {
        const historyLen = Math.min(ENGINE_CONSTANTS.SPARKLINE_HISTORY_LEN, candles.length);
        const history: number[] = new Array(historyLen);
        const startIdx = candles.length - historyLen;
        for (let i = 0; i < historyLen; i++) {
          history[i] = candles[startIdx + i].close;
        }
        return {
          ...opp,
          history,
        };
      });
    } catch (error) {
      this.logger.warn(`Scan error: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private scanSymbol(
    symbol: string,
    interval: string,
    config: SessionConfig,
  ): { opp: Opportunity, candles: Candle[] } | null {
    // BOLT OPTIMIZATION: Filter out symbols that are not in the current exchange info (e.g. not on Testnet)
    // before performing any calculations.
    const filters = this.marketFeed.getSymbolFilters(symbol);
    if (!filters) {
      return null;
    }

    // Get recent candles for momentum calculation
    const lookback = Math.max(config.scan_lookback || 1, 1);
    const candles = this.klineStore.getRawCandles(symbol, interval);
    if (candles.length < lookback + 1) {
      return null;
    }

    const currentPrice = candles[candles.length - 1].close;
    const previousPrice = candles[candles.length - 1 - lookback].close;

    if (!this.isValidPrice(currentPrice) || !this.isValidPrice(previousPrice)) {
      this.logger.verbose(
        `Skipping scan for ${symbol} due invalid candle prices current=${currentPrice} previous=${previousPrice}`,
      );
      return null;
    }

    // Calculate simple momentum
    const momentumPct = this.calculateMomentum(currentPrice, previousPrice);
    if (!Number.isFinite(momentumPct)) {
      this.logger.verbose(
        `Skipping scan for ${symbol} due invalid momentum current=${currentPrice} previous=${previousPrice}`,
      );
      return null;
    }

    // BOLT OPTIMIZATION: Early return if momentum is below threshold to avoid expensive volatility/trend calculations
    const threshold = config.scan_pct_threshold ?? 0;
    if (Math.abs(momentumPct) < threshold) {
      return null;
    }

    // Determine direction based on momentum
    const direction = momentumPct > 0 ? 'LONG' : 'SHORT';

    // Get current price and volume
    // BOLT OPTIMIZATION: Use O(1) ticker lookup instead of O(N) array search
    const tickerData = this.tickerCache.getTicker(symbol);

    // BOLT OPTIMIZATION: Early return if symbol does not meet session criteria
    // before performing expensive volatility/trend calculations in calculateScore.
    const side = config.entry_side || 'both';
    if (side === 'long' && direction !== 'LONG') return null;
    if (side === 'short' && direction !== 'SHORT') return null;

    const volume = Number(tickerData?.volume_24h || 0);
    const minVolume = config.scan_min_volume_usdt ?? 0;
    if (volume < minVolume) return null;

    // Calculate opportunity score (0-100)
    // Based on: momentum magnitude, volume, volatility
    const score = this.calculateScore(
      candles,
      momentumPct,
      config,
    );

    const displayPrice = this.isValidPrice(tickerData?.price ?? 0)
      ? tickerData!.price
      : currentPrice;

    return {
      opp: {
        symbol,
        price: displayPrice,
        momentum: momentumPct,
        volume_24h: volume,
        score,
        direction,
      },
      candles,
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
