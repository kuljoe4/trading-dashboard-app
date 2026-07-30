import { SignalEngineService } from './signalEngine';
import { Candle } from './kline_store.service';

describe('Bolt Supertrend Optimization & Correctness', () => {
  let signalEngine: SignalEngineService;
  let candles: Candle[];

  beforeEach(() => {
    // We mock the KlineStoreService
    const mockKlineStore = {
      getRawCandles: jest.fn(),
      getLookbackExtremes: jest.fn(),
    } as any;

    signalEngine = new SignalEngineService(mockKlineStore);

    // Generate 100 mock candles for testing
    candles = Array.from({ length: 100 }, (_, i) => ({
      time: 1718000000000 + i * 60000,
      open: 100 + Math.sin(i) * 5,
      high: 102 + Math.sin(i) * 5,
      low: 98 + Math.sin(i) * 5,
      close: 101 + Math.sin(i) * 5,
      volume: 1000,
    }));
  });

  describe('calculateSupertrend Caching Correctness', () => {
    it('should return the exact same output array values and references on cache hits', () => {
      const period = 10;
      const multiplier = 3.0;
      const symbol = 'BTCUSDT';
      const interval = '1m';

      // 1st run: Populates cache
      const run1 = signalEngine.calculateSupertrend(candles, period, multiplier, symbol, interval);

      // 2nd run: Cache hit (same symbol and interval)
      const run2 = signalEngine.calculateSupertrend(candles, period, multiplier, symbol, interval);

      expect(run1).toBe(run2); // Strict reference equality check
      expect(run1.supertrend).toEqual(run2.supertrend);
      expect(run1.direction).toEqual(run2.direction);
      expect(run1.insufficientData).toBe(run2.insufficientData);
    });

    it('should calculate independently when parameters or data changes', () => {
      const period = 10;
      const multiplier = 3.0;
      const symbol = 'BTCUSDT';
      const interval = '1m';

      const run1 = signalEngine.calculateSupertrend(candles, period, multiplier, symbol, interval);

      // Change multiplier -> should bypass cache
      const run2 = signalEngine.calculateSupertrend(candles, period, 4.5, symbol, interval);

      expect(run1).not.toBe(run2);
      expect(run1.supertrend).not.toEqual(run2.supertrend);

      // Change candles length -> should bypass cache
      const shortenedCandles = candles.slice(0, 80);
      const run3 = signalEngine.calculateSupertrend(shortenedCandles, period, multiplier, symbol, interval);

      expect(run1).not.toBe(run3);
    });

    it('should limit cache size and perform O(1) eviction when exceeding 1000 entries', () => {
      const period = 10;
      const multiplier = 3.0;

      // Seed the cache with 1000 distinct entries
      for (let i = 0; i < 1000; i++) {
        const customCandles = [
          { time: 1000 + i, open: 10, high: 12, low: 8, close: 11, volume: 100 },
          ...candles,
        ];
        signalEngine.calculateSupertrend(customCandles, period, multiplier, `SYM${i}`, '1m');
      }

      // Cache size should be 1000
      const initialCacheSize = (signalEngine as any).supertrendCache.size;
      expect(initialCacheSize).toBe(1000);

      // Trigger 1001st entry -> should evict 100 entries and keep size <= 901
      const lastCandles = [
        { time: 9999, open: 10, high: 12, low: 8, close: 11, volume: 100 },
        ...candles,
      ];
      signalEngine.calculateSupertrend(lastCandles, period, multiplier, 'NEW_SYM', '1m');

      const afterEvictionSize = (signalEngine as any).supertrendCache.size;
      expect(afterEvictionSize).toBeLessThanOrEqual(901);

      // Verify that the new item exists in the cache by checking that there is a key starting with 'NEW_SYM'
      const cacheKeys = Array.from((signalEngine as any).supertrendCache.keys()) as string[];
      const hasNewSymKey = cacheKeys.some(key => key.startsWith('NEW_SYM'));
      expect(hasNewSymKey).toBe(true);
    });
  });

  describe('calculateSupertrend Performance Benchmark', () => {
    it('benchmark: verify Supertrend cache speedup', () => {
      const period = 10;
      const multiplier = 3.0;
      const symbol = 'BTCUSDT';
      const interval = '1m';
      const iterations = 50000;

      // Warm up and populate cache
      signalEngine.calculateSupertrend(candles, period, multiplier, symbol, interval);

      // 1. Measure cache hit performance
      const cacheStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        signalEngine.calculateSupertrend(candles, period, multiplier, symbol, interval);
      }
      const cacheEnd = performance.now();
      const cacheDuration = cacheEnd - cacheStart;

      // 2. Measure uncached / raw loop performance (using anonymous/no-symbol call to bypass cache)
      const rawStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        // Change key on each call to prevent cache hitting
        const uniqueCandles = [
          { time: i, open: 10, high: 12, low: 8, close: 11, volume: 100 },
          ...candles,
        ];
        signalEngine.calculateSupertrend(uniqueCandles, period, multiplier);
      }
      const rawEnd = performance.now();
      const rawDuration = rawEnd - rawStart;

      const speedup = rawDuration / cacheDuration;

      console.log(`[BENCHMARK] calculateSupertrend ${iterations} calls:`);
      console.log(`  - Cache Hit Duration:   ${cacheDuration.toFixed(2)}ms (${(cacheDuration * 1000 / iterations).toFixed(4)}ns/call)`);
      console.log(`  - Raw Calculation Duration: ${rawDuration.toFixed(2)}ms (${(rawDuration * 1000 / iterations).toFixed(4)}ns/call)`);
      console.log(`  - Speedup:                  ${speedup.toFixed(2)}x faster`);

      expect(cacheDuration).toBeLessThan(rawDuration);
    });
  });
});
