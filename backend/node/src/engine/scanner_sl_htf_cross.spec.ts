import { MomentumScannerService } from './momentum_scanner.service';
import { SessionConfig } from '../models/SessionConfig';
import { KlineStoreService, Candle } from './kline_store.service';
import { TickerCacheService } from './ticker_cache.service';
import { MarketFeedService } from './market_feed.service';

describe('MomentumScannerService - Configurable Boost Points & R:R Performance Scoring', () => {
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

  it('should scale score boost according to custom htf_ema_cross_max_boost and htf_ema_cross_rr_weight', () => {
    const config = new SessionConfig();
    config.symbols = ['BTCUSDT'];
    config.scan_pct_threshold = 1.0;
    config.htf_ema_cross_boost_enabled = true;
    config.htf_ema_cross_interval = '4h';
    config.htf_ema_cross_count = 4;
    config.htf_ema_fast_period = 3;
    config.htf_ema_slow_period = 5;
    config.htf_ema_cross_max_boost = 35.0; // Higher 35 point boost limit
    config.htf_ema_cross_rr_weight = 2.5; // Stronger R:R weight
    config.sl_distance_pct = 1.0;

    const candles1m: Candle[] = [
      { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { time: 2000, open: 100, high: 105, low: 100, close: 104, volume: 1000 },
    ];

    const candles4h: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 40; i++) {
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
    expect(results[0].score_breakdown?.htf_ema_cross).toBeGreaterThan(15.0); // Boost scales higher than default 15 cap
    expect(results[0].score_breakdown?.htf_ema_cross).toBeLessThanOrEqual(35.0);
  });
});
