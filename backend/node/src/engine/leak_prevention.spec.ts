import { Test, TestingModule } from '@nestjs/testing';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { MonitoringService } from './monitoring.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { ENGINE_CONSTANTS } from '../models/constants';
import { BinanceSubscriptionManager } from '../lib/binanceSubscriptionManager';

// Jest mock for BinanceSubscriptionManager
jest.mock('../lib/binanceSubscriptionManager', () => {
  return {
    BinanceSubscriptionManager: jest.fn().mockImplementation((wsUrl, options) => {
      const mockWs = {
        terminate: jest.fn(),
        close: jest.fn(),
      };
      const manager = {
        ws: mockWs,
        connect: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockImplementation(async () => {
          (mockWs as any)._isExplicitClose = true;
        }),
      };
      return manager;
    })
  };
});

describe('MarketFeedService Leak Fixes', () => {
  let service: MarketFeedService;
  let tickerCache: TickerCacheService;
  let klineStore: KlineStoreService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Correctly spy on global fetch to prevent actual network requests during tests
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([])
    } as any));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketFeedService,
        { provide: TickerCacheService, useValue: { bulkUpdate: jest.fn(), updateTicker: jest.fn(), getCacheSize: jest.fn().mockReturnValue(1), topByVolume: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT' }]), prune: jest.fn() } }, { provide: "SettingsRepository", useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } },
        { provide: KlineStoreService, useValue: { upsertCandle: jest.fn(), getRecentCandles: jest.fn().mockReturnValue([]), getMaxCandles: jest.fn().mockReturnValue(100), seedFromRest: jest.fn(), prune: jest.fn(), loadFromDb: jest.fn().mockResolvedValue(0) } },
        { provide: SessionStateService, useValue: { isBanned: jest.fn().mockReturnValue(false), updateRateLimit: jest.fn(), binanceRateLimit: { used_1m: 0 }, isEcoMode: jest.fn().mockReturnValue(false), activeTrades: [], isGated: jest.fn().mockReturnValue(false), config: {}, getBinanceRateLimit: jest.fn().mockReturnValue({ used_weight_1m: 0, limit: 2400 }) } },
        { provide: SignalEngineService, useValue: { getRequiredWarmup: jest.fn().mockReturnValue(100) } },
        { provide: MonitoringService, useValue: { incrementApiRequests: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: BinanceClientFactory,
          useValue: {
            genericRequest: jest.fn().mockImplementation((fn) => fn())
          }
        },
      ],
    }).compile();

    service = module.get<MarketFeedService>(MarketFeedService);
    tickerCache = module.get<TickerCacheService>(TickerCacheService);
    klineStore = module.get<KlineStoreService>(KlineStoreService);

    // Mock ENGINE_CONSTANTS.BACKFILL_MAX_JITTER_MS to 0 to avoid test timeouts
    (ENGINE_CONSTANTS as any).BACKFILL_MAX_JITTER_MS = 0;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('should set _isExplicitClose on WebSockets during rebuild', async () => {
    // Start service to allow connection
    (service as any).running = true;
    (service as any).activeWatchlist.set('BTCUSDT', new Set(['1m']));

    await (service as any).rebuildCombinedKlineStream();

    expect((service as any).klineManagers.length).toBe(1);

    const manager = (service as any).klineManagers[0];
    const ws = (manager as any).ws;

    // Trigger another rebuild
    await (service as any).rebuildCombinedKlineStream();

    expect((ws as any)._isExplicitClose).toBe(true);
  });

  it('should remove timeout from subscriptionTasks on stop', async () => {
    (service as any).subscriptionTasks = [setTimeout(() => {}, 1000)];
    expect((service as any).subscriptionTasks.length).toBe(1);
    await service.stop();
    expect((service as any).subscriptionTasks.length).toBe(0);
  });

  it('should correctly check freshness using the last candle in backfillKlines', async () => {
    const now = Date.now();
    const interval = '1m';
    const intervalMs = 60000;

    // BOLT OPTIMIZATION: Mock existing candles where the MOST RECENT (at index length - 1) is fresh, matching chronological order
    (klineStore.getRecentCandles as any).mockReturnValue([
      { time: now - intervalMs * 100 },
      { time: now }
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

    // BOLT OPTIMIZATION: Mock existing candles where the MOST RECENT (at index length - 1) is stale, matching chronological order
    (klineStore.getRecentCandles as any).mockReturnValue([
      { time: now - intervalMs * 100 },
      { time: now - intervalMs * 10 } // Stale: (now - 10m) + 1m = now - 9m, which is < now - 2m
    ]);

    (service as any).running = true;
    (service as any).sessionState.config = { watchlist_size: 10 };

    await (service as any).backfillKlines('BTCUSDT', interval);

    expect(fetchSpy).toHaveBeenCalled();
  });
});
