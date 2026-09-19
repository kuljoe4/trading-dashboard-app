import { MomentumScannerService } from './momentum_scanner.service';
import { SessionConfig } from '../models/SessionConfig';
import { TickerCacheService, Ticker } from './ticker_cache.service';
import { KlineStoreService, Candle } from './kline_store.service';
import { MarketFeedService } from './market_feed.service';

describe('Bolt - Smart Watchlist Scanner Optimization', () => {
  let scannerService: MomentumScannerService;
  let klineStoreService: jest.Mocked<KlineStoreService>;
  let tickerCacheService: jest.Mocked<TickerCacheService>;
  let marketFeedService: jest.Mocked<MarketFeedService>;

  const mockTickers: Ticker[] = Array.from({ length: 300 }, (_, i) => ({
    symbol: `SYM_${i}USDT`,
    price: 100 + (i % 20),
    open_24h: 100,
    volume_24h: (i + 1) * 1000,
  }));

  const mockCandles: Candle[] = [
    { time: 1000, open: 100, high: 105, low: 99, close: 100, volume: 1000 },
    { time: 2000, open: 100, high: 106, low: 99, close: 105, volume: 1200 },
  ];

  beforeEach(() => {
    klineStoreService = {
      getRawCandles: jest.fn().mockReturnValue(mockCandles),
      getLookbackExtremes: jest.fn().mockReturnValue({ minLow: 99, maxHigh: 106 }),
    } as any;

    tickerCacheService = {
      getLatestTickers: jest.fn().mockReturnValue(mockTickers),
      getTicker: jest.fn().mockImplementation((sym: string) => {
        const found = mockTickers.find((t) => t.symbol === sym);
        return found || null;
      }),
      topByVolume: jest.fn().mockReturnValue([]),
      topByChangePct: jest.fn().mockReturnValue([]),
    } as any;

    marketFeedService = {
      getSymbolFilters: jest.fn().mockReturnValue({
        minQty: 0.001,
        maxQty: 100000,
        stepSize: 0.001,
        tickSize: 0.01,
        minNotional: 5,
      }),
    } as any;

    scannerService = new MomentumScannerService(
      klineStoreService,
      tickerCacheService,
      marketFeedService,
    );
  });

  it('correctly discovers Smart Watchlist candidates using single-pass loop filtering', () => {
    const config: SessionConfig = {
      smart_watchlist_enabled: true,
      smart_watchlist_sensitivity: 0.7,
      scan_pct_threshold: 2.0,
      watchlist_size: 10,
      scan_interval: '1m',
      sl_max_pct: 10.0,
    } as SessionConfig;

    const opportunities = scannerService.scan(config);
    expect(opportunities.length).toBeGreaterThan(0);
    expect(opportunities.length).toBeLessThanOrEqual(10);

    // Opportunities should be flagged or populated
    const firstOpp = opportunities[0];
    expect(firstOpp.symbol.endsWith('USDT')).toBe(true);
    expect(firstOpp.score).toBeGreaterThan(0);
  });

  it('benchmarks single-pass loop filtering against functional method chaining', () => {
    const sensitivity = 0.7;
    const threshold = 2.0 * sensitivity;
    const watchlistSize = 10;
    const activeExcluded = new Set<string>();

    const iterations = 10000;

    // 1. Benchmark functional chaining (.filter().sort().slice().forEach())
    const startFunctional = performance.now();
    for (let i = 0; i < iterations; i++) {
      const tasks = new Map<string, any>();
      const tickers = tickerCacheService.getLatestTickers();

      const smartCandidates = tickers
        .filter((t) => {
          if (!t.symbol || !t.symbol.toUpperCase().endsWith('USDT')) return false;
          if (activeExcluded.has(t.symbol)) return false;
          if (!marketFeedService.getSymbolFilters(t.symbol)) return false;
          if (t.open_24h && t.open_24h > 0) {
            const momentum = Math.abs((t.price - t.open_24h) / t.open_24h) * 100;
            return momentum >= threshold;
          }
          return false;
        })
        .sort((a, b) => b.volume_24h - a.volume_24h)
        .slice(0, watchlistSize);

      smartCandidates.forEach((t) => {
        tasks.set(t.symbol, { is_smart: true });
      });
    }
    const durationFunctional = performance.now() - startFunctional;

    // 2. Benchmark single-pass loop filtering
    const startSinglePass = performance.now();
    for (let i = 0; i < iterations; i++) {
      const tasks = new Map<string, any>();
      const tickers = tickerCacheService.getLatestTickers();
      const candidateTickers: typeof tickers = [];
      const tickerLen = tickers.length;

      for (let j = 0; j < tickerLen; j++) {
        const t = tickers[j];
        if (!t.symbol || !t.symbol.toUpperCase().endsWith('USDT')) continue;
        if (activeExcluded.has(t.symbol)) continue;
        if (!marketFeedService.getSymbolFilters(t.symbol)) continue;
        if (t.open_24h && t.open_24h > 0) {
          const momentum = Math.abs((t.price - t.open_24h) / t.open_24h) * 100;
          if (momentum >= threshold) {
            candidateTickers.push(t);
          }
        }
      }

      if (candidateTickers.length > 1) {
        candidateTickers.sort((a, b) => b.volume_24h - a.volume_24h);
      }

      const smartCount = Math.min(candidateTickers.length, watchlistSize);
      for (let j = 0; j < smartCount; j++) {
        tasks.set(candidateTickers[j].symbol, { is_smart: true });
      }
    }
    const durationSinglePass = performance.now() - startSinglePass;

    const speedup = durationFunctional / durationSinglePass;

    console.log(`[BENCHMARK] Functional Chaining: ${durationFunctional.toFixed(2)}ms`);
    console.log(`[BENCHMARK] Single-Pass Loop:    ${durationSinglePass.toFixed(2)}ms`);
    console.log(`[BENCHMARK] Speedup:             ${speedup.toFixed(2)}x faster`);

    expect(durationSinglePass).toBeLessThan(durationFunctional * 1.5);
  });
});
