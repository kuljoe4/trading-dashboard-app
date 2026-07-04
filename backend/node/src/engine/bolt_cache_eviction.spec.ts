import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';

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
    const candles = [];
    for (let i = 0; i < 20; i++) {
      candles.push({ time: i * 1000, open: 100, high: 105, low: 95, close: 100, volume: 1000 });
    }
    const interval = '1m';

    // Fill the cache
    for (let i = 0; i < 1100; i++) {
      const symbol = `SYM${i}`;
      // @ts-ignore
      signalEngine.calculateEMAAt(candles, candles.length - 1, period, interval, symbol);
    }

    // Access internal cache for verification
    // @ts-ignore
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
      // @ts-ignore
      signalEngine.calculateEMALastTwoAt(candles, 1, period, interval, symbol);
    }

    // @ts-ignore
    const cacheSize = signalEngine.emaDualCache.size;

    expect(cacheSize).toBeLessThanOrEqual(1000);
    expect(cacheSize).toBeGreaterThan(900);
  });
});
