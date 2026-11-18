import { SignalEngineService } from './signalEngine';
import { KlineStoreService, Candle } from './kline_store.service';

describe('SignalEngineService Cache Eviction', () => {
  let signalEngine: SignalEngineService;
  let klineStore: KlineStoreService;
  let mockKlineRepo: any;

  beforeEach(() => {
    mockKlineRepo = { find: jest.fn(), upsert: jest.fn() };
    klineStore = new KlineStoreService(mockKlineRepo);
    signalEngine = new SignalEngineService(klineStore);
  });

  it('should evict items from emaCache when it exceeds 1000 entries', () => {
    // Use enough candles to bypass early SMA fallback (period + 1)
    const period = 10;
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push({ time: i * 1000, open: 100, high: 105, low: 95, close: 100, volume: 1000 });
    }
    const interval = '1m';

    // Fill the cache
    for (let i = 0; i < 1100; i++) {
      const symbol = `SYM${i}`;
      // @ts-expect-error accessing private property for tests
      signalEngine.calculateEMAAt(candles, candles.length - 1, period, interval, symbol);
    }

    // Access internal cache for verification
    // @ts-expect-error accessing private property for tests
    const cacheSize = signalEngine.emaCache.size;

    // It should have hit 1001, then evicted 100, so 901.
    // Loop 1001: size becomes 1001 -> eviction -> 901.
    // Then 99 more loops: 901 + 99 = 1000.

    expect(cacheSize).toBeLessThanOrEqual(1000);
    expect(cacheSize).toBeGreaterThan(900);
  });

  it('should evict items from emaDualCache when it exceeds 1000 entries', () => {
    const candles = [
      { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { time: 2000, open: 100, high: 105, low: 95, close: 101, volume: 1000 }
    ];
    const period = 1;
    const interval = '1m';

    // Fill the cache
    for (let i = 0; i < 1100; i++) {
      const symbol = `SYM${i}`;
      // @ts-expect-error accessing private property for tests
      signalEngine.calculateEMALastTwoAt(candles, 1, period, interval, symbol);
    }

    // @ts-expect-error accessing private property for tests
    const cacheSize = signalEngine.emaDualCache.size;

    expect(cacheSize).toBeLessThanOrEqual(1000);
    expect(cacheSize).toBeGreaterThan(900);
  });

  it('should prune indicator caches for symbols not in activeSymbols', () => {
    const candles = [
      { time: 1000, open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { time: 2000, open: 100, high: 105, low: 95, close: 101, volume: 1000 },
      { time: 3000, open: 101, high: 106, low: 96, close: 102, volume: 1000 },
    ];
    // @ts-expect-error accessing private property for tests
    signalEngine.calculateEMAAt(candles, 2, 2, '1m', 'BTCUSDT');
    // @ts-expect-error accessing private property for tests
    signalEngine.calculateEMAAt(candles, 2, 2, '1m', 'STALEUSDT');

    signalEngine.pruneCaches(new Set(['BTCUSDT']));

    // @ts-expect-error accessing private property for tests
    const keys = Array.from(signalEngine.emaCache.keys());
    expect(keys.some((k) => k.startsWith('BTCUSDT:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('STALEUSDT:'))).toBe(false);
  });

  it('should evict stale unmonitored candle buffers via KlineStoreService.pruneStale while preserving protected keys', async () => {
    await klineStore.upsertCandle('ACTIVEUSDT', '1m', { t: Date.now() - 60000, o: 10, h: 11, l: 9, c: 10.5, q: 100 });
    await klineStore.upsertCandle('STALEUSDT', '1m', { t: Date.now() - 60000, o: 20, h: 21, l: 19, c: 20.5, q: 100 });

    // Backdate STALEUSDT_1m lastUpdated timestamp beyond TTL
    (klineStore as any).lastUpdatedMap.set('STALEUSDT_1m', Date.now() - 60 * 60 * 1000);
    (klineStore as any).lastUpdatedMap.set('ACTIVEUSDT_1m', Date.now() - 60 * 60 * 1000);

    const pruned = klineStore.pruneStale(30 * 60 * 1000, new Set(['ACTIVEUSDT_1m']));
    expect(pruned).toBe(1);
    expect(klineStore.getStats().keys).toContain('ACTIVEUSDT_1m');
    expect(klineStore.getStats().keys).not.toContain('STALEUSDT_1m');
  });
});

