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
  strategyId?: string;
  priority?: number;
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
      const results: { opp: Opportunity; candles: Candle[] }[] = [];

      // Determine which strategy configurations to use
      // If multi-strategies are defined, we scan for EACH strategy
      const strategies = (config.strategies && config.strategies.length > 0)
        ? config.strategies.filter(s => s.enabled)
        : [{
            id: 'default',
            enabled_signals: config.enabled_signals,
            signal_logic: config.signal_logic,
            signal_params: config.signal_params,
            priority: 0
          }];

      for (const strat of strategies) {
        const stratResults: { opp: Opportunity; candles: Candle[] }[] = [];

        // 1. Global Scan (if enabled)
        if (config.global_scanner_enabled !== false) {
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
          const globalPromises = symbols.map(async (symbol) => {
            try {
              // Create a merged config for this strategy to pass into scan logic
              const mergedConfig = { ...config, ...strat } as any;
              const res = await this.scanSymbol(symbol, interval, mergedConfig);
              if (res) {
                res.opp.strategyId = strat.id;
                res.opp.priority = strat.priority;
              }
              return res;
            } catch (error) {
              this.logger.debug(`Global scan error for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
              return null;
            }
          });
          const globalResults = await Promise.all(globalPromises);
          stratResults.push(...globalResults.filter((r): r is { opp: Opportunity, candles: Candle[] } => r !== null));
        }

        // 2. Single Symbol Monitors
        if (config.single_symbol_configs && config.single_symbol_configs.length > 0) {
          const singlePromises = config.single_symbol_configs
            .filter(sc => sc.enabled)
            .map(async (sc) => {
              try {
                const symbolConfig = sc.use_custom_config && sc.custom_config
                  ? { ...config, ...sc.custom_config }
                  : config;
                const interval = symbolConfig.scan_interval || '1m';
                const res = await this.scanSymbol(sc.symbol, interval, symbolConfig);
                if (res) {
                  res.opp.strategyId = strat.id;
                  res.opp.priority = strat.priority;
                }
                return res;
              } catch (error) {
                this.logger.debug(`Single symbol scan error for ${sc.symbol}: ${error instanceof Error ? error.message : String(error)}`);
                return null;
              }
            });
          const singleResults = await Promise.all(singlePromises);

          // Use a map to prevent duplicate symbols for THIS strategy
          const resultMap = new Map(stratResults.map(r => [r.opp.symbol, r]));
          for (const r of singleResults) {
            if (r) resultMap.set(r.opp.symbol, r);
          }

          stratResults.length = 0;
          stratResults.push(...resultMap.values());
        }

        results.push(...stratResults);
      }

      const tempResults = results.filter((r): r is { opp: Opportunity, candles: Candle[] } => r !== null);

      // Sort by priority (desc) then by score (desc)
      tempResults.sort((a, b) => {
        if ((b.opp.priority || 0) !== (a.opp.priority || 0)) {
          return (b.opp.priority || 0) - (a.opp.priority || 0);
        }
        return b.opp.score - a.opp.score;
      });

      // To handle coordination (A): Only keep the highest priority strategy for each symbol
      const coordinatedResults: { opp: Opportunity; candles: Candle[] }[] = [];
      const seenSymbols = new Set<string>();
      for (const res of tempResults) {
        if (!seenSymbols.has(res.opp.symbol)) {
          coordinatedResults.push(res);
          seenSymbols.add(res.opp.symbol);
        }
      }

      const topResults = coordinatedResults.slice(0, 15);

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
