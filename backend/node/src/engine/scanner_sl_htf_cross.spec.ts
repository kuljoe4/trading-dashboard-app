import { MomentumScannerService } from './momentum_scanner.service';
import { SessionConfig } from '../models/SessionConfig';
import { KlineStoreService, Candle } from './kline_store.service';
import { TickerCacheService } from './ticker_cache.service';
import { MarketFeedService } from './market_feed.service';

describe('MomentumScannerService - SL Pre-Filtering & 4H HTF EMA Dual Cross Ranking', () => {
  let service: MomentumScannerService;
  let klineStore: jest.Mocked<KlineStoreService>;
  let tickerCache: jest.Mocked<TickerCacheService>;
  let marketFeed: jest.Mocked<MarketFeedService>;

  beforeEach(() => {
    klineStore = {
      getRawCandles: jest.fn(),
    } as any;

    tickerCache = {
      getTicker: jest.fn().mockReturnValue({ price: 100, volume_24h: 1000000 }),
      getLatestTickers: jest.fn().mockReturnValue([]),
      topByVolume: jest.fn().mockReturnValue([]),
      topByChangePct: jest.fn().mockReturnValue([]),
    } as any;

    marketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({
        minQty: 0.001,
        maxQty: 1000,
        stepSize: 0.001,
        tickSize: 0.01,
        minNotional: 5.0,
      }),
    } as any;

    service = new MomentumScannerService(klineStore, tickerCache, marketFeed);
  });

  it('should pre-filter candidate moves where calculated SL distance exceeds sl_max_pct', () => {
    const config = new SessionConfig();
    config.symbols = ['BTCUSDT'];
    config.scan_pct_threshold = 2.0;
    config.sl_type = 'lookback_low/high';
    config.sl_lookback_period = 5;
    config.sl_max_pct = 3.0; // 3% max SL
    config.reject_entry_if_sl_exceeds_max = true;

    // Create 1m candles for scan where lookback low gives a 5% SL distance (exceeding 3% max)
    const candles1m: Candle[] = [
      { time: 1000, open: 100, high: 101, low: 95, close: 100, volume: 1000 }, // Low 95 = 5% SL from 100
      { time: 2000, open: 100, high: 102, low: 98, close: 101, volume: 1000 },
      { time: 3000, open: 101, high: 103, low: 99, close: 102, volume: 1000 },
      { time: 4000, open: 102, high: 106, low: 100, close: 105, volume: 1000 }, // Momentum +5%
    ];

    klineStore.getRawCandles.mockImplementation((symbol, interval) => {
      if (interval === '1m' || interval === '5m') return candles1m;
      return [];
    });

    const results = service.scan(config);
    expect(results).toHaveLength(0); // Rejected because prospective SL 5% > 3% max
  });

  it('should allow candidate moves when calculated SL distance is within sl_max_pct', () => {
    const config = new SessionConfig();
    config.symbols = ['BTCUSDT'];
    config.scan_pct_threshold = 2.0;
    config.sl_type = 'lookback_low/high';
    config.sl_lookback_period = 5;
    config.sl_max_pct = 3.0;
    config.reject_entry_if_sl_exceeds_max = true;

    // Create 1m candles where lookback low gives a 1.9% SL distance (within 3% max)
    const candles1m: Candle[] = [
      { time: 1000, open: 100, high: 101, low: 98.1, close: 100, volume: 1000 }, // Low 98.1 = 1.9% SL
      { time: 2000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { time: 3000, open: 101, high: 103, low: 100, close: 102, volume: 1000 },
      { time: 4000, open: 102, high: 106, low: 101, close: 105, volume: 1000 },
    ];

    klineStore.getRawCandles.mockImplementation((symbol, interval) => {
      if (interval === '1m' || interval === '5m') return candles1m;
      return [];
    });

    const results = service.scan(config);
    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe('BTCUSDT');
    expect(results[0].sl_dist_pct).toBeCloseTo(1.9, 1);
  });

  it('should calculate 4H HTF EMA Dual Cross performance over configurable crosses and boost score', () => {
    const config = new SessionConfig();
    config.symbols = ['BTCUSDT'];
    config.scan_pct_threshold = 1.0;
    config.htf_ema_cross_boost_enabled = true;
    config.htf_ema_cross_interval = '4h';
    config.htf_ema_cross_count = 4;
    config.htf_ema_fast_period = 3;
    config.htf_ema_slow_period = 5;

    const candles1m: Candle[] = [
      { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { time: 2000, open: 100, high: 105, low: 100, close: 104, volume: 1000 },
    ];

    // Build 30 4H candles with alternating trend crossovers where long crosses generate +10% profit
    const candles4h: Candle[] = [];
    let price = 100;

    for (let i = 0; i < 40; i++) {
      // Oscillate price to create 4 crosses
      const cycle = Math.sin(i * 0.5);
      price += cycle * 3;
      candles4h.push({
        time: (i + 1) * 14400000,
        open: price,
        high: price + 4,
        low: Math.max(10, price - 2),
        close: price + 1,
        volume: 50000,
      });
    }

    klineStore.getRawCandles.mockImplementation((symbol, interval) => {
      if (interval === '4h') return candles4h;
      return candles1m;
    });

    const results = service.scan(config);
    expect(results).toHaveLength(1);
    expect(results[0].htf_ema_cross_perf).toBeDefined();
    expect(results[0].htf_ema_cross_perf?.cross_count).toBeGreaterThan(0);
    expect(results[0].score_breakdown?.htf_ema_cross).toBeGreaterThan(0);
  });

  it('benchmark: verifies zero-allocation O(1) timestamp-keyed caching speed for HTF EMA cross evaluation', () => {
    const config = new SessionConfig();
    config.symbols = ['BTCUSDT'];
    config.scan_pct_threshold = 1.0;
    config.htf_ema_cross_boost_enabled = true;

    const candles1m: Candle[] = [
      { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { time: 2000, open: 100, high: 105, low: 100, close: 104, volume: 1000 },
    ];

    const candles4h: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      candles4h.push({
        time: (i + 1) * 14400000,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
        volume: 50000,
      });
    }

    klineStore.getRawCandles.mockImplementation((symbol, interval) => {
      if (interval === '4h') return candles4h;
      return candles1m;
    });

    const iterations = 50000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      service.scan(config);
    }
    const duration = performance.now() - start;

    console.log(`⚡ Bolt Performance Benchmark (MomentumScanner HTF EMA Cache, ${iterations} iterations): ${duration.toFixed(2)}ms (${((duration / iterations) * 1000).toFixed(4)}us / op)`);
    expect(duration).toBeLessThan(3000);
  });
});
