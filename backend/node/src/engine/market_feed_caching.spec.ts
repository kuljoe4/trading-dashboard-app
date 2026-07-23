import { EventEmitter2 } from '@nestjs/event-emitter';

let captured: { wsUrl?: string; topics?: string[]; stopCount: number } = { stopCount: 0 };

jest.mock('../lib/binanceSubscriptionManager', () => ({
  BinanceSubscriptionManager: jest.fn().mockImplementation((wsUrl: string, opts: any) => {
    captured.wsUrl = wsUrl;
    return {
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockImplementation((topics: string[]) => {
        captured.topics = topics;
        return Promise.resolve();
      }),
      stop: jest.fn().mockImplementation(() => {
        captured.stopCount++;
        return Promise.resolve();
      }),
    };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MarketFeedService } = require('./market_feed.service');

describe('MarketFeedService - Watchlist Caching and Stabilization', () => {
  let service: any;
  let tickerCacheMock: any;

  beforeEach(() => {
    captured = { stopCount: 0 };
    tickerCacheMock = {
      getLatestTickers: jest.fn(() => [
        { symbol: 'BTCUSDT', price: 50000, open_24h: 48000, volume_24h: 1000000 },
        { symbol: 'ETHUSDT', price: 3000, open_24h: 2900, volume_24h: 500000 },
        { symbol: 'BNBUSDT', price: 400, open_24h: 390, volume_24h: 300000 },
        { symbol: 'SOLUSDT', price: 150, open_24h: 140, volume_24h: 200000 },
      ]),
      getCacheSize: jest.fn(() => 4),
      topByVolume: jest.fn((n) => [
        { symbol: 'BTCUSDT', price: 50000, volume_24h: 1000000 },
        { symbol: 'ETHUSDT', price: 3000, volume_24h: 500000 },
        { symbol: 'BNBUSDT', price: 400, volume_24h: 300000 },
        { symbol: 'SOLUSDT', price: 150, volume_24h: 200000 },
      ].slice(0, n)),
      topByChangePct: jest.fn((n) => [
        { symbol: 'BTCUSDT', price: 50000, open_24h: 48000 },
        { symbol: 'ETHUSDT', price: 3000, open_24h: 2900 },
      ].slice(0, n)),
    };

    service = new MarketFeedService(
      tickerCacheMock,
      { upsertCandle: jest.fn(), getRecentCandles: jest.fn(() => []), loadFromDb: jest.fn(() => 0), getRawCandles: jest.fn(() => []), getMaxCandles: jest.fn(() => 1000) },
      {
        isBanned: jest.fn(() => false),
        isGated: jest.fn(() => false),
        config: { trading_mode: 'live' },
        activeTrades: [],
        binanceRateLimit: { used_1m: 0, limit: 2400 },
        getBinanceRateLimit: jest.fn(() => ({ used_weight_1m: 0, limit: 2400 })),
        setActiveTrades: jest.fn()
      },
      { getRequiredWarmup: jest.fn(() => 10) },
      { incrementApiRequests: jest.fn(), recordUdsPing: jest.fn(), getMetrics: jest.fn(() => ({ application: { last_uds_ping_sec: 0, exchange_uds_status: 'OK' } })) },
      new EventEmitter2(),
      { genericRequest: jest.fn() },
      { findOne: jest.fn() },
    );
    service.running = true;
    service.getSymbolFilters = jest.fn(() => ({ tickSize: 0.01, stepSize: 0.01 }));
  });

  it('stabilizes watchlist using the cache for identical configurations', async () => {
    const config = { global_scanner_enabled: true, watchlist_size: 2, discovery_mode: 'volume' };

    // First call: populates cache and initializes streams
    await service.executeWatchlistUpdate(config);
    const firstStopCount = captured.stopCount;
    const firstTopics = [...(captured.topics || [])];

    // Reset captured details to monitor next execution
    captured.topics = undefined;

    // Second call with same configuration: should hit cache and NOT trigger re-subscription (stop / connect)
    await service.executeWatchlistUpdate(config);

    expect(captured.stopCount).toBe(firstStopCount); // No stop() was called on existing kline managers
    expect(captured.topics).toBeUndefined(); // No re-subscription occurred
  });

  it('invalidates cache and rebuilds streams when config signature changes', async () => {
    const config1 = { global_scanner_enabled: true, watchlist_size: 2, discovery_mode: 'volume' };
    const config2 = { global_scanner_enabled: true, watchlist_size: 3, discovery_mode: 'volume' };

    // First call with config1
    await service.executeWatchlistUpdate(config1);
    const stopCountAfterFirst = captured.stopCount;

    // Second call with config2: should invalidate cache and trigger rebuild
    await service.executeWatchlistUpdate(config2);

    expect(captured.stopCount).toBeGreaterThan(stopCountAfterFirst); // stop() was called to teardown and rebuild
  });

  it('bypasses cache dynamically for manual monitors and active trades', async () => {
    const config = { global_scanner_enabled: true, watchlist_size: 2, discovery_mode: 'volume' };

    // First call: populates cache (e.g. BTC, ETH)
    await service.executeWatchlistUpdate(config);
    const stopCountAfterFirst = captured.stopCount;

    // Add an active trade (e.g. ADAUSDT) directly to sessionState
    service.sessionState.activeTrades = [{ symbol: 'ADAUSDT' }];

    // Second call: the active trade symbol should bypass cache and trigger an immediate stream rebuild
    await service.executeWatchlistUpdate(config);

    expect(captured.stopCount).toBeGreaterThan(stopCountAfterFirst); // Stream rebuilt immediately
    expect(captured.topics).toContain('adausdt@ticker'); // ADA stream is monitored
  });
});
