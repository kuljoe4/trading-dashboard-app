import { Test, TestingModule } from '@nestjs/testing';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { MonitoringService } from './monitoring.service';
import { ENGINE_CONSTANTS } from '../models/constants';
import WebSocket from 'ws';

// Jest mock for WebSocket
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    terminate: jest.fn(),
    close: jest.fn(),
    readyState: 1, // OPEN
  }));
});

describe('MarketFeedService Leak Fixes', () => {
  let service: MarketFeedService;
  let tickerCache: TickerCacheService;
  let klineStore: KlineStoreService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketFeedService,
        { provide: TickerCacheService, useValue: { bulkUpdate: jest.fn(), updateTicker: jest.fn(), getCacheSize: jest.fn().mockReturnValue(1), topByVolume: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT' }]), prune: jest.fn() } },
        { provide: KlineStoreService, useValue: { upsertCandle: jest.fn(), getRecentCandles: jest.fn().mockReturnValue([]), getMaxCandles: jest.fn().mockReturnValue(100), seedFromRest: jest.fn(), prune: jest.fn() } },
        { provide: SessionStateService, useValue: { updateRateLimit: jest.fn(), binanceRateLimit: { used_1m: 0 }, isEcoMode: jest.fn().mockReturnValue(false), activeTrades: [], isGated: jest.fn().mockReturnValue(false), config: {}, getBinanceRateLimit: jest.fn().mockReturnValue({ used_weight_1m: 0, limit: 2400 }) } },
        { provide: SignalEngineService, useValue: { getRequiredWarmup: jest.fn().mockReturnValue(100) } },
        { provide: MonitoringService, useValue: { incrementApiRequests: jest.fn() } },
      ],
    }).compile();

    service = module.get<MarketFeedService>(MarketFeedService);
    tickerCache = module.get<TickerCacheService>(TickerCacheService);
    klineStore = module.get<KlineStoreService>(KlineStoreService);

    // Mock ENGINE_CONSTANTS.BACKFILL_MAX_JITTER_MS to 0 to avoid test timeouts
    (ENGINE_CONSTANTS as any).BACKFILL_MAX_JITTER_MS = 0;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should set _isExplicitClose on WebSockets during rebuild', async () => {
    // Start service to allow connection
    (service as any).running = true;
    (service as any).activeWatchlist.set('BTCUSDT', new Set(['1m']));

    await (service as any).rebuildCombinedKlineStream();

    const wsList = (service as any).combinedKlineWsList as Set<WebSocket>;
    expect(wsList.size).toBe(1);

    const ws = Array.from(wsList)[0];

    // Trigger another rebuild
    await (service as any).rebuildCombinedKlineStream();

    expect((ws as any)._isExplicitClose).toBe(true);
  });

  it('should remove timeout from subscriptionTasks after execution', async () => {
    jest.useFakeTimers();
    (service as any).running = true;

    // Trigger a mini-ticker reconnect
    (service as any).startMiniTickerStream();
    const ws = (service as any).miniTickerWs;

    // Simulate close
    const closeHandler = (ws.on as any).mock.calls.find((call: any) => call[0] === 'close')[1];
    closeHandler();

    expect((service as any).subscriptionTasks.length).toBe(1);

    // Fast-forward time
    jest.runAllTimers();

    // Task should be removed after execution
    expect((service as any).subscriptionTasks.length).toBe(0);
    jest.useRealTimers();
  });

  it('should correctly check freshness using the last candle in backfillKlines', async () => {
    const now = Date.now();
    const interval = '1m';
    const intervalMs = 60000;

    // Mock existing candles where the MOST RECENT (at index 0) is fresh
    // The check is: lastCandle.time + intervalMs >= Date.now() - (intervalMs * 2)
    (klineStore.getRecentCandles as any).mockReturnValue([
      { time: now },
      { time: now - intervalMs * 100 }
    ]);

    (service as any).running = true;
    (service as any).sessionState.config = { watchlist_size: 10 };
    // Set requiredWarmup to 2
    (service as any).signalEngine.getRequiredWarmup.mockReturnValue(2);

    await (service as any).backfillKlines('BTCUSDT', interval);

    // Should NOT call fetch (monitoring incrementApiRequests)
    const monitoring = (service as any).monitoringService;
    expect(monitoring.incrementApiRequests).not.toHaveBeenCalled();
  });

  it('should trigger backfill if the last candle is stale', async () => {
    const now = Date.now();
    const interval = '1m';
    const intervalMs = 60000;

    // Mock existing candles where the MOST RECENT (at index 0) is stale
    (klineStore.getRecentCandles as any).mockReturnValue([
      { time: now - intervalMs * 10 }, // Stale: (now - 10m) + 1m = now - 9m, which is < now - 2m
      { time: now - intervalMs * 100 }
    ]);

    // Mock fetch for backfill
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([])
    });

    (service as any).running = true;
    (service as any).sessionState.config = { watchlist_size: 10 };

    await (service as any).backfillKlines('BTCUSDT', interval);

    expect(global.fetch).toHaveBeenCalled();
  });
});
