import { EventEmitter2 } from '@nestjs/event-emitter';
import { KlineStoreService } from './kline_store.service';
import { MarketFeedService } from './market_feed.service';
import { ENGINE_CONSTANTS } from '../models/constants';

const mockCreatedManagers: Array<{ wsUrl: string; stop: jest.Mock; connect: jest.Mock; subscribe: jest.Mock; unsubscribe: jest.Mock; activeSubscriptions: Set<string> }> = [];

jest.mock('../lib/binanceSubscriptionManager', () => ({
  BinanceSubscriptionManager: jest.fn().mockImplementation((wsUrl: string) => {
    const mgr = {
      wsUrl,
      activeSubscriptions: new Set<string>(),
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockImplementation((streams: string[]) => {
        for (const s of streams) mgr.activeSubscriptions.add(s);
        return Promise.resolve();
      }),
      unsubscribe: jest.fn().mockImplementation((streams: string[]) => {
        for (const s of streams) mgr.activeSubscriptions.delete(s);
        return Promise.resolve();
      }),
      stop: jest.fn().mockResolvedValue(undefined),
    };
    mockCreatedManagers.push(mgr);
    return mgr;
  }),
}));

describe('Resource Footprint, Strategy Scoping, & Live WS Stream Specs', () => {
  beforeEach(() => {
    mockCreatedManagers.length = 0;
  });

  it('KlineStoreService.pruneExcept removes stale symbol/interval keys and hlStableCache entries', async () => {
    const store = new KlineStoreService({ upsert: jest.fn(), find: jest.fn().mockResolvedValue([]) } as any);
    await store.upsertCandle('BTCUSDT', '1m', { t: 1000, o: 10, h: 11, l: 9, c: 10, q: 100 });
    await store.upsertCandle('ETHUSDT', '5m', { t: 1000, o: 10, h: 11, l: 9, c: 10, q: 100 });
    (store as any).hlStableCache.set('ETHUSDT:5m:5', { time: 1000, minLow: 9, maxHigh: 11, count: 5 });
    (store as any).hlStableCache.set('BTCUSDT:1m:5', { time: 1000, minLow: 9, maxHigh: 11, count: 5 });

    const pruned = store.pruneExcept(new Set(['BTCUSDT_1m']));
    expect(pruned).toBe(1);
    expect(store.getRawCandles('BTCUSDT', '1m').length).toBe(1);
    expect(store.getRawCandles('ETHUSDT', '5m').length).toBe(0);
    expect((store as any).hlStableCache.has('ETHUSDT:5m:5')).toBe(false);
    expect((store as any).hlStableCache.has('BTCUSDT:1m:5')).toBe(true);
  });

  it('MarketFeedService.updateWatchlist scopes MTF intervals per strategy, skips paused strategies, and keeps open trades', async () => {
    const klineStore = new KlineStoreService({ upsert: jest.fn(), find: jest.fn().mockResolvedValue([]) } as any);
    await klineStore.upsertCandle('OLDUSDT', '1m', { t: 1000, o: 10, h: 11, l: 9, c: 10, q: 100 });

    const sessionState: any = {
      isBanned: jest.fn().mockReturnValue(false),
      isGated: jest.fn().mockReturnValue(false),
      paused: false,
      pausedStrategies: new Set(['Paused Variant']),
      isStrategyPaused: (lbl: string) => lbl === 'Paused Variant',
      config: { trading_mode: 'live' },
      activeTrades: [{ symbol: 'SOLUSDT', strategy_label: 'Paused Variant', strategy_config: { scan_interval: '3m' } }],
    };

    const feed = new MarketFeedService(
      { topByVolume: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT' }]), getCacheSize: jest.fn().mockReturnValue(1) } as any,
      klineStore,
      sessionState,
      {
        getRequiredWarmup: jest.fn().mockReturnValue(1),
        resolveSignalParam: jest.fn().mockImplementation((_p, _s, _b, _k, def) => def),
      } as any,
      { incrementApiRequests: jest.fn() } as any,
      new EventEmitter2(),
      { genericRequest: jest.fn(), proxyFetch: jest.fn() } as any,
      { findOne: jest.fn(), update: jest.fn() } as any,
    );
    (feed as any).running = true;
    (feed as any).exchangeInfo = new Map([
      ['BTCUSDT', { symbol: 'BTCUSDT' }],
      ['ETHUSDT', { symbol: 'ETHUSDT' }],
      ['SOLUSDT', { symbol: 'SOLUSDT' }],
    ]);
    jest.spyOn(feed as any, 'processBackfillQueue').mockResolvedValue(undefined);

    const cfg: any = {
      trading_mode: 'live',
      global_scanner_enabled: true,
      strategy_label: 'Base',
      symbols: ['BTCUSDT'],
      scan_interval: '5m',
      enabled_signals: ['ema_dual_cross'],
      signal_timeframes: { ema_dual_cross: '15m' },
      strategy_variants: [
        {
          strategy_label: 'Paused Variant',
          symbols: ['ETHUSDT'],
          scan_interval: '1h',
          enabled_signals: ['htf_breakout'],
          signal_timeframes: { htf_breakout: '4h' },
        },
      ],
    };

    await (feed as any).updateWatchlist(cfg);
    const activeWatchlist: Map<string, Set<string>> = (feed as any).activeWatchlist;

    // Base symbol gets base scan + base MTF (5m, 15m) without Paused Variant's 1h/4h
    expect(Array.from(activeWatchlist.get('BTCUSDT') || []).sort()).toEqual(['15m', '5m']);
    // Paused variant's discovery symbol is skipped
    expect(activeWatchlist.has('ETHUSDT')).toBe(false);
    // Open trade belonging to Paused Variant remains monitored for capital safety
    expect(activeWatchlist.has('SOLUSDT')).toBe(true);
    // Stale kline buffer is pruned
    expect(klineStore.getRawCandles('OLDUSDT', '1m').length).toBe(0);
    // Live mode WS URL carries ?streams= per AGENTS.md §9
    expect(mockCreatedManagers.length).toBe(1);
    expect(mockCreatedManagers[0].wsUrl).toContain(`${ENGINE_CONSTANTS.BINANCE_WS_MARKET}?streams=`);
    expect(mockCreatedManagers[0].wsUrl).toContain('btcusdt@kline_15m');
    expect(mockCreatedManagers[0].wsUrl).toContain('solusdt@markPrice@1s');
  });
});
