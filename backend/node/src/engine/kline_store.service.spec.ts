import { KlineStoreService } from './kline_store.service';

describe('KlineStoreService', () => {
  let service: KlineStoreService;
  let mockRepository: any;

  beforeEach(() => {
    mockRepository = {
      find: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    };
    service = new KlineStoreService(mockRepository);
  });

  it('standardizes candle data from WebSocket format', async () => {
    const wsKline = {
      t: 1000,
      o: '10',
      h: '12',
      l: '8',
      c: '11',
      q: '1000',
    };

    await service.upsertCandle('BTCUSDT', '1m', wsKline);
    const candles = await service.getRecentCandles('BTCUSDT', '1m', 1);

    expect(candles[0]).toEqual({
      time: 1000,
      open: 10,
      high: 12,
      low: 8,
      close: 11,
      volume: 1000,
    });
  });

  it('standardizes candle data from REST format', async () => {
    const restKline = [
      1000, // Open time
      '10', // Open
      '12', // High
      '8',  // Low
      '11', // Close
      '100', // Volume
      2000, // Close time
      '1000', // Quote asset volume
    ];

    await service.upsertCandle('BTCUSDT', '1m', restKline);
    const candles = await service.getRecentCandles('BTCUSDT', '1m', 1);

    expect(candles[0]).toEqual({
      time: 1000,
      open: 10,
      high: 12,
      low: 8,
      close: 11,
      volume: 1000,
    });
  });

  it('clear should clear both klines and hlStableCache', async () => {
    const wsKline = {
      t: 1000,
      o: '10',
      h: '12',
      l: '8',
      c: '11',
      q: '1000',
    };

    const wsKline2 = {
      t: 2000,
      o: '11',
      h: '13',
      l: '9',
      c: '12',
      q: '1000',
    };

    await service.upsertCandle('BTCUSDT', '1m', wsKline);
    await service.upsertCandle('BTCUSDT', '1m', wsKline2);

    // Warm up/fill hlStableCache (aggregates completed wsKline [8..12] + forming wsKline2 [9..13])
    const extremesBefore = service.getLookbackExtremes('BTCUSDT', '1m', 1);
    expect(extremesBefore).toEqual({ minLow: 8, maxHigh: 13 });

    // Verify it is cached
    const stableCacheBefore = (service as any).hlStableCache.get('BTCUSDT:1m:1');
    expect(stableCacheBefore).toBeDefined();

    service.clear();

    const candlesAfter = await service.getRecentCandles('BTCUSDT', '1m', 1);
    expect(candlesAfter).toEqual([]);

    const stableCacheAfter = (service as any).hlStableCache.get('BTCUSDT:1m:1');
    expect(stableCacheAfter).toBeUndefined();
  });

  it('should hit the hlStableCache and bypass deep calculations in getLookbackExtremes', async () => {
    const wsKline1 = { t: 1000, o: '10', h: '12', l: '8', c: '11', q: '1000' };
    const wsKline2 = { t: 2000, o: '11', h: '13', l: '9', c: '12', q: '1000' };
    const wsKline3 = { t: 3000, o: '12', h: '14', l: '10', c: '13', q: '1000' };

    await service.upsertCandle('BTCUSDT', '1m', wsKline1);
    await service.upsertCandle('BTCUSDT', '1m', wsKline2);
    await service.upsertCandle('BTCUSDT', '1m', wsKline3);

    // Initial query to populate cache. Completed candles are wsKline1..2 ([8..13]), forming is wsKline3 ([10..14])
    const extremes1 = service.getLookbackExtremes('BTCUSDT', '1m', 2);
    expect(extremes1).toEqual({ minLow: 8, maxHigh: 14 });
    expect(service.getLookbackExtremes('BTCUSDT', '1m', 2, false)).toEqual({ minLow: 8, maxHigh: 13 });

    // Spy on parseIntervalToMs or other logic inside the un-cached block to prove they are bypassed.
    // parseIntervalToMs is private, but we can verify that if we manually change the hlStableCache,
    // the method immediately returns the cached value without re-calculating or looking at candles.
    const cacheKey = 'BTCUSDT:1m:2';
    const stableCacheEntry = (service as any).hlStableCache.get(cacheKey);
    expect(stableCacheEntry).toBeDefined();

    // Mutate the cache entry directly
    stableCacheEntry.minLow = 1;
    stableCacheEntry.maxHigh = 8888;

    // Call again - it should return the mutated cached values directly, confirming bypass of O(N) calculation
    const extremes2 = service.getLookbackExtremes('BTCUSDT', '1m', 2);
    expect(extremes2).toEqual({ minLow: 1, maxHigh: 8888 });
  });

  describe('parseIntervalToMs robust validation', () => {
    it('defaults gracefully when handling null, undefined, empty, or invalid interval inputs', () => {
      expect((service as any).parseIntervalToMs(null)).toBe(60000);
      expect((service as any).parseIntervalToMs(undefined)).toBe(60000);
      expect((service as any).parseIntervalToMs('')).toBe(60000);
      expect((service as any).parseIntervalToMs('invalid')).toBe(60000);
      expect((service as any).parseIntervalToMs('abc')).toBe(60000);
      expect((service as any).parseIntervalToMs('123')).toBe(60000);
      expect((service as any).parseIntervalToMs('0m')).toBe(60000);
      expect((service as any).parseIntervalToMs('-5m')).toBe(60000);

      // Standard intervals should parse correctly
      expect((service as any).parseIntervalToMs('1m')).toBe(60000);
      expect((service as any).parseIntervalToMs('5m')).toBe(300000);
      expect((service as any).parseIntervalToMs('1h')).toBe(3600000);
      expect((service as any).parseIntervalToMs('1d')).toBe(86400000);
    });

    it('should use intervalMsCache for O(1) interval milliseconds retrieval', () => {
      // Check initial state of the cache
      const cacheMap = (service as any).intervalMsCache;
      expect(cacheMap.size).toBe(0);

      // Call parseIntervalToMs
      const ms1 = (service as any).parseIntervalToMs('5m');
      expect(ms1).toBe(300000);
      expect(cacheMap.size).toBe(1);
      expect(cacheMap.get('5m')).toBe(300000);

      // Manually mutate the cache value to verify it bypasses parsing
      cacheMap.set('5m', 999999);
      const ms2 = (service as any).parseIntervalToMs('5m');
      expect(ms2).toBe(999999); // Returned the cached value!
    });
  });

  describe('getRawCandles native HTF preservation', () => {
    it('preserves native 5m candles (e.g. 100 candles) instead of clobbering with downsampled 1m buffer', async () => {
      // Seed 100 5m candles
      const startTime = 1700000000000;
      const htf5mCandles: any[] = [];
      for (let i = 0; i < 100; i++) {
        htf5mCandles.push([
          startTime + i * 300000,
          '10',
          '12',
          '8',
          '11',
          '1000',
        ]);
      }
      await service.seedFromRest('LITUSDT', '5m', htf5mCandles);

      // Seed 200 1m candles (spans ~40 5m candles)
      const m1Candles: any[] = [];
      for (let i = 0; i < 200; i++) {
        m1Candles.push([
          startTime + i * 60000,
          '10',
          '12',
          '8',
          '11',
          '200',
        ]);
      }
      await service.seedFromRest('LITUSDT', '1m', m1Candles);

      // Get 5m candles
      const raw5m = service.getRawCandles('LITUSDT', '5m');

      // Native 100 candles MUST be preserved, NOT clobbered down to 40!
      expect(raw5m.length).toBeGreaterThanOrEqual(100);
      expect(raw5m[0].time).toBe(startTime);
    });

    it('synthesizeHigherInterval preserves richer native 1h buffer (25 candles) when 200 1m candles only cover 4 buckets', async () => {
      const baseTime = 1700000000000;
      const h1Candles: any[] = [];
      for (let i = 0; i < 25; i++) {
        h1Candles.push([baseTime + i * 3600000, '10', '12', '8', '11', '5000']);
      }
      await service.seedFromRest('WLDUSDT', '1h', h1Candles);

      const m1Start = baseTime + 21 * 3600000;
      const m1Candles: any[] = [];
      for (let i = 0; i < 200; i++) {
        m1Candles.push([m1Start + i * 60000, '10', '12', '8', '11', '100']);
      }
      await service.seedFromRest('WLDUSDT', '1m', m1Candles);

      const result = service.synthesizeHigherInterval('WLDUSDT', '1h', '1m');
      expect(result.length).toBeGreaterThanOrEqual(25);
      expect(service.getRawCandles('WLDUSDT', '1h').length).toBeGreaterThanOrEqual(25);
    });
  });

  describe('1m soft-TTL retention & stale/gap trimming', () => {
    it('pruneExcept retains fresh off-watchlist 1m buffers while pruning stale 1m and off-watchlist 5m buffers', async () => {
      const now = Date.now();
      // Fresh 1m off-watchlist buffer (within 20m retention window)
      await service.upsertCandle('SOLUSDT', '1m', { t: now - 30_000, o: '100', h: '102', l: '99', c: '101', q: '1000' });
      // Stale 1m off-watchlist buffer (> 20m old)
      await service.upsertCandle('OLDUSDT', '1m', { t: now - 25 * 60_000, o: '10', h: '11', l: '9', c: '10', q: '100' });
      // Fresh 5m off-watchlist buffer (should prune because HTF recovers from DB)
      await service.upsertCandle('ETHUSDT', '5m', { t: now - 60_000, o: '2000', h: '2010', l: '1990', c: '2005', q: '5000' });

      const pruned = service.pruneExcept(new Set(['BTCUSDT_1h']));
      expect(pruned).toBe(2); // OLDUSDT_1m + ETHUSDT_5m pruned
      expect(service.getRawCandles('SOLUSDT', '1m').length).toBe(1);
      expect(service.getRawCandles('OLDUSDT', '1m').length).toBe(0);
      expect(service.getRawCandles('ETHUSDT', '5m').length).toBe(0);
    });

    it('trimGapsAndStaleTail trims pre-gap segment on interior holes and clears stale tails', async () => {
      const now = Date.now();
      // Case A: Buffer with a 5-minute interior hole followed by 2 contiguous fresh candles
      await service.upsertCandle('GAPUSDT', '1m', { t: now - 8 * 60_000, o: '1', h: '1', l: '1', c: '1', q: '10' });
      await service.upsertCandle('GAPUSDT', '1m', { t: now - 90_000, o: '2', h: '2', l: '2', c: '2', q: '10' });
      await service.upsertCandle('GAPUSDT', '1m', { t: now - 30_000, o: '3', h: '3', l: '3', c: '3', q: '10' });

      expect(service.trimGapsAndStaleTail('GAPUSDT', '1m')).toBe(true);
      const trimmed = service.getRawCandles('GAPUSDT', '1m');
      expect(trimmed.length).toBe(2);
      expect(trimmed[0].open).toBe(2);

      // Case B: Tail older than 1.5x interval (>90s for 1m) clears entire buffer
      await service.upsertCandle('STALEUSDT', '1m', { t: now - 5 * 60_000, o: '5', h: '5', l: '5', c: '5', q: '10' });
      expect(service.trimGapsAndStaleTail('STALEUSDT', '1m')).toBe(true);
      expect(service.getRawCandles('STALEUSDT', '1m').length).toBe(0);
    });
  });
});
