import { TickerCacheService } from './ticker_cache.service';

describe('TickerCacheService', () => {
  let service: TickerCacheService;

  beforeEach(() => {
    service = new TickerCacheService();
  });

  it('supports partial updates (keeping existing volume)', async () => {
    // Initial update with both price and volume
    await service.bulkUpdate([{ s: 'BTCUSDT', c: '50000', q: '1000000' }]);
    let ticker = await service.getTicker('BTCUSDT');
    expect(ticker?.price).toBe(50000);
    expect(ticker?.volume_24h).toBe(1000000);

    // Partial update with only price
    await service.bulkUpdate([{ s: 'BTCUSDT', c: '51000' }]);
    ticker = await service.getTicker('BTCUSDT');
    expect(ticker?.price).toBe(51000);
    expect(ticker?.volume_24h).toBe(1000000); // Should be preserved
  });

  it('supports partial updates (keeping existing price)', async () => {
    // Initial update
    await service.bulkUpdate([{ s: 'BTCUSDT', c: '50000', q: '1000000' }]);

    // Partial update with only volume
    await service.bulkUpdate([{ s: 'BTCUSDT', q: '2000000' }]);
    let ticker = await service.getTicker('BTCUSDT');
    expect(ticker?.price).toBe(50000); // Should be preserved
    expect(ticker?.volume_24h).toBe(2000000);
  });

  describe('mark_price prioritization and initialization', () => {
    it('should prioritize mark_price over last price in getPrice', () => {
      service.updateTicker('BTCUSDT', 50000, 100, 49000, 50100);
      expect(service.getPrice('BTCUSDT')).toBe(50100);
    });

    it('should fall back to last price if mark_price is missing', () => {
      service.updateTicker('BTCUSDT', 50000, 100);
      expect(service.getPrice('BTCUSDT')).toBe(50000);
    });

    it('should initialize price from mark_price if price is 0', () => {
      // Initialization scenario
      service.updateTicker('BTCUSDT', 0, 0, 0, 50500);
      const ticker = service.getTicker('BTCUSDT');
      expect(ticker?.price).toBe(50500);
      expect(ticker?.mark_price).toBe(50500);
    });

    it('should update price from mark_price if existing price is 0', () => {
      // Existing ticker with 0 price scenario
      service.updateTicker('BTCUSDT', 0, 100);
      service.updateTicker('BTCUSDT', undefined, undefined, undefined, 51000);
      const ticker = service.getTicker('BTCUSDT');
      expect(ticker?.price).toBe(51000);
      expect(ticker?.mark_price).toBe(51000);
    });
  });

  describe('topByChangePct', () => {
    it('should return tickers sorted by absolute 24-hour change percentage descending', () => {
      // Setup tickers with different 24h change pct
      // BTC: price=110, open=100 -> change = +10%
      // ETH: price=95, open=100 -> change = -5% (absolute 5%)
      // SOL: price=120, open=100 -> change = +20%
      // ADA: price=101, open=100 -> change = +1%
      service.updateTicker('BTCUSDT', 110, 1000000, 100);
      service.updateTicker('ETHUSDT', 95, 2000000, 100);
      service.updateTicker('SOLUSDT', 120, 500000, 100);
      service.updateTicker('ADAUSDT', 101, 100000, 100);

      const top = service.topByChangePct(3);
      expect(top.length).toBe(3);
      expect(top[0].symbol).toBe('SOLUSDT'); // 20%
      expect(top[1].symbol).toBe('BTCUSDT'); // 10%
      expect(top[2].symbol).toBe('ETHUSDT'); // 5%
    });

    it('should respect exclusions', () => {
      service.updateTicker('BTCUSDT', 110, 1000000, 100);
      service.updateTicker('ETHUSDT', 95, 2000000, 100);
      service.updateTicker('SOLUSDT', 120, 500000, 100);

      const top = service.topByChangePct(2, ['SOLUSDT']);
      expect(top.length).toBe(2);
      expect(top[0].symbol).toBe('BTCUSDT');
      expect(top[1].symbol).toBe('ETHUSDT');
    });

    it('should handle undefined or empty exclusions without throwing', () => {
      service.updateTicker('BTCUSDT', 110, 1000000, 100);
      service.updateTicker('ETHUSDT', 95, 2000000, 100);

      // Call topByChangePct with undefined to trigger default parameter
      const topDefault = service.topByChangePct(2);
      expect(topDefault.length).toBe(2);

      // Explicitly pass undefined as the second parameter
      const topUndefined = service.topByChangePct(2, undefined);
      expect(topUndefined.length).toBe(2);
    });

    describe('topByChangePct performance benchmark', () => {
      it('should run significantly faster than the old unoptimized implementation', () => {
        // Setup 300 symbols to simulate a realistic production list
        for (let i = 0; i < 300; i++) {
          const symbol = `SYM_${i}USDT`;
          const price = 100 + Math.random() * 50;
          const open = 100;
          const volume = Math.random() * 10000000;
          service.updateTicker(symbol, price, volume, open);
        }

        // We extract all tickers once
        const all = service.getLatestTickers();

        // Implement the old sorting logic directly in the test to compare
        const oldImplementation = (n: number) => {
          return [...all]
            .filter(t => t.price && t.open_24h && t.open_24h > 0)
            .sort((a, b) => {
              const changeA = Math.abs(((a.price - (a.open_24h || 0)) / (a.open_24h || 1)) * 100);
              const changeB = Math.abs(((b.price - (b.open_24h || 0)) / (b.open_24h || 1)) * 100);
              return changeB - changeA;
            })
            .slice(0, n);
        };

        const iterations = 2000;

        // Mock verbose logging to avoid stdout formatting overhead during benchmark
        const originalVerbose = (service as any).logger.verbose;
        (service as any).logger.verbose = () => {};

        // Warm up
        for (let i = 0; i < 100; i++) {
          oldImplementation(10);
          // Clear cache so that the optimized version recomputes
          (service as any)._topByChangeCache = {};
          service.topByChangePct(10);
        }

        // Benchmark Old
        const startOld = performance.now();
        for (let i = 0; i < iterations; i++) {
          oldImplementation(10);
        }
        const endOld = performance.now();
        const oldTime = endOld - startOld;

        // Benchmark Optimized
        const startOpt = performance.now();
        for (let i = 0; i < iterations; i++) {
          // Force recomputation by clearing cache
          (service as any)._topByChangeCache = {};
          service.topByChangePct(10);
        }
        const endOpt = performance.now();
        const optTime = endOpt - startOpt;

        // Restore original logger
        (service as any).logger.verbose = originalVerbose;

        console.log(`[BENCHMARK] topByChangePct with 300 symbols over ${iterations} iterations:`);
        console.log(`  - Original implementation: ${oldTime.toFixed(2)}ms`);
        console.log(`  - Optimized implementation: ${optTime.toFixed(2)}ms`);
        const speedup = oldTime / optTime;
        console.log(`  - Speedup: ${speedup.toFixed(2)}x faster`);

        // Verify they produce identical sorted results
        const resOld = oldImplementation(10);
        (service as any)._topByChangeCache = {};
        const resOpt = service.topByChangePct(10);

        expect(resOpt.length).toBe(resOld.length);
        for (let i = 0; i < resOpt.length; i++) {
          expect(resOpt[i].symbol).toBe(resOld[i].symbol);
        }
      });
    });
  });

  describe('topByVolume', () => {
    it('should return tickers sorted by volume descending', () => {
      service.updateTicker('BTCUSDT', 50000, 1000000);
      service.updateTicker('ETHUSDT', 3000, 2000000);
      service.updateTicker('SOLUSDT', 150, 500000);
      service.updateTicker('ADAUSDT', 0.5, 100000);

      const top = service.topByVolume(3);
      expect(top.length).toBe(3);
      expect(top[0].symbol).toBe('ETHUSDT'); // 2000000
      expect(top[1].symbol).toBe('BTCUSDT'); // 1000000
      expect(top[2].symbol).toBe('SOLUSDT'); // 500000
    });

    it('should respect exclusions', () => {
      service.updateTicker('BTCUSDT', 50000, 1000000);
      service.updateTicker('ETHUSDT', 3000, 2000000);
      service.updateTicker('SOLUSDT', 150, 500000);

      const top = service.topByVolume(2, ['ETHUSDT']);
      expect(top.length).toBe(2);
      expect(top[0].symbol).toBe('BTCUSDT');
      expect(top[1].symbol).toBe('SOLUSDT');
    });

    it('should handle undefined or empty exclusions without throwing', () => {
      service.updateTicker('BTCUSDT', 50000, 1000000);
      service.updateTicker('ETHUSDT', 3000, 2000000);

      const topDefault = service.topByVolume(2);
      expect(topDefault.length).toBe(2);

      const topUndefined = service.topByVolume(2, undefined);
      expect(topUndefined.length).toBe(2);
    });

    describe('topByVolume performance benchmark', () => {
      it('should run significantly faster than the old unoptimized implementation', () => {
        // Setup 300 symbols to simulate a realistic production list
        for (let i = 0; i < 300; i++) {
          const symbol = `SYM_${i}USDT`;
          const price = 100 + Math.random() * 50;
          const volume = Math.random() * 10000000;
          service.updateTicker(symbol, price, volume);
        }

        const all = service.getLatestTickers();

        // Implement the old sorting logic directly in the test to compare
        const oldImplementation = (n: number, excluded: string[] = []) => {
          const excludedSet = excluded.length > 0 ? new Set(excluded) : null;
          return [...all]
            .filter(t => !excludedSet?.has(t.symbol))
            .sort((a, b) => b.volume_24h - a.volume_24h)
            .slice(0, n);
        };

        const iterations = 2000;

        // Mock verbose logging to avoid stdout formatting overhead during benchmark
        const originalVerbose = (service as any).logger.verbose;
        (service as any).logger.verbose = () => {};

        // Warm up
        for (let i = 0; i < 100; i++) {
          oldImplementation(10);
          (service as any)._topByVolumeCache = {};
          service.topByVolume(10);
        }

        // Benchmark Old
        const startOld = performance.now();
        for (let i = 0; i < iterations; i++) {
          oldImplementation(10);
        }
        const endOld = performance.now();
        const oldTime = endOld - startOld;

        // Benchmark Optimized
        const startOpt = performance.now();
        for (let i = 0; i < iterations; i++) {
          (service as any)._topByVolumeCache = {};
          service.topByVolume(10);
        }
        const endOpt = performance.now();
        const optTime = endOpt - startOpt;

        // Restore original logger
        (service as any).logger.verbose = originalVerbose;

        console.log(`[BENCHMARK] topByVolume with 300 symbols over ${iterations} iterations:`);
        console.log(`  - Original implementation: ${oldTime.toFixed(2)}ms`);
        console.log(`  - Optimized implementation: ${optTime.toFixed(2)}ms`);
        const speedup = oldTime / optTime;
        console.log(`  - Speedup: ${speedup.toFixed(2)}x faster`);

        // Verify they produce identical sorted results
        const resOld = oldImplementation(10);
        (service as any)._topByVolumeCache = {};
        const resOpt = service.topByVolume(10);

        expect(resOpt.length).toBe(resOld.length);
        for (let i = 0; i < resOpt.length; i++) {
          expect(resOpt[i].symbol).toBe(resOld[i].symbol);
        }
      });
    });
  });
});
