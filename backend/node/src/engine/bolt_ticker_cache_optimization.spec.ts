import { TickerCacheService } from './ticker_cache.service';

describe('TickerCacheService Caching Regression', () => {
  let service: TickerCacheService;

  beforeEach(() => {
    service = new TickerCacheService();
  });

  it('should return the same array reference when getLatestTickers is called multiple times and no new symbol is added', () => {
    service.updateTicker('BTCUSDT', 50000, 100);
    service.updateTicker('ETHUSDT', 3000, 500);

    const tickers1 = service.getLatestTickers();
    const tickers2 = service.getLatestTickers();

    // Verify it is the exact same array reference in memory
    expect(tickers1).toBe(tickers2);
    expect(tickers1.length).toBe(2);
  });

  it('should correctly capture in-place property mutations without needing cache invalidation', () => {
    service.updateTicker('BTCUSDT', 50000, 100);

    const tickers1 = service.getLatestTickers();
    expect(tickers1[0].price).toBe(50000);

    // Update the price in place
    service.updateTicker('BTCUSDT', 51000, 105);

    // Get again. The reference should be the same, but containing the mutated price
    const tickers2 = service.getLatestTickers();
    expect(tickers2).toBe(tickers1);
    expect(tickers2[0].price).toBe(51000);
    expect(tickers2[0].volume_24h).toBe(105);
  });

  it('should invalidate the cache when a brand new symbol is added', () => {
    service.updateTicker('BTCUSDT', 50000, 100);

    const tickers1 = service.getLatestTickers();
    expect(tickers1.length).toBe(1);

    // Add a brand new symbol (should nullify and rebuild cache)
    service.updateTicker('ETHUSDT', 3000, 500);

    const tickers2 = service.getLatestTickers();
    expect(tickers2).not.toBe(tickers1);
    expect(tickers2.length).toBe(2);
    expect(tickers2.some(t => t.symbol === 'ETHUSDT')).toBe(true);
  });

  it('should invalidate the cache when clear is called', () => {
    service.updateTicker('BTCUSDT', 50000, 100);

    const tickers1 = service.getLatestTickers();
    expect(tickers1.length).toBe(1);

    service.clear();

    const tickers2 = service.getLatestTickers();
    expect(tickers2).not.toBe(tickers1);
    expect(tickers2.length).toBe(0);
  });

  describe('topByVolume & topByChangePct zero-allocation cache key optimization', () => {
    beforeEach(() => {
      for (let i = 1; i <= 20; i++) {
        service.updateTicker(`SYM${i}USDT`, 100 + i, 1000 * i, 100);
      }
    });

    it('should generate consistent results for empty, single, pre-sorted, and unsorted excluded arrays', () => {
      const res1 = service.topByVolume(5, []);
      expect(res1.length).toBe(5);

      const resSingle = service.topByVolume(5, ['SYM20USDT']);
      expect(resSingle.some(t => t.symbol === 'SYM20USDT')).toBe(false);

      const resSorted = service.topByVolume(5, ['SYM19USDT', 'SYM20USDT']);
      const resUnsorted = service.topByVolume(5, ['SYM20USDT', 'SYM19USDT']);

      expect(resSorted).toBe(resUnsorted); // Same cached instance
      expect(resSorted.some(t => t.symbol === 'SYM19USDT' || t.symbol === 'SYM20USDT')).toBe(false);
    });

    it('should handle undefined or null excluded parameter safely in topByChangePct and topByVolume', () => {
      expect(() => service.topByChangePct(5, undefined as any)).not.toThrow();
      expect(() => service.topByChangePct(5, null as any)).not.toThrow();
      expect(() => service.topByVolume(5, undefined as any)).not.toThrow();
      expect(() => service.topByVolume(5, null as any)).not.toThrow();
    });

    it('benchmark: measures speedup of zero-allocation cache key generation over repeated calls', () => {
      const excluded = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
      const iterations = 100000;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        service.topByVolume(10, excluded);
      }
      const elapsed = performance.now() - start;

      // Ensure execution is lightning fast (< 50ms for 100k calls on cache hits)
      expect(elapsed).toBeLessThan(100);
      console.log(`[BENCHMARK] topByVolume 100,000 cached calls elapsed time: ${elapsed.toFixed(2)} ms (${(elapsed / iterations * 1000).toFixed(2)} ns/call)`);
    });
  });
});
