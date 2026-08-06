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

    // Warm up/fill hlStableCache
    const extremesBefore = service.getLookbackExtremes('BTCUSDT', '1m', 1);
    expect(extremesBefore).toEqual({ minLow: 8, maxHigh: 12 });

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

    // Initial query to populate cache. The last completed candle is wsKline2 (t: 2000)
    const extremes1 = service.getLookbackExtremes('BTCUSDT', '1m', 2);
    expect(extremes1).toEqual({ minLow: 8, maxHigh: 13 });

    // Spy on parseIntervalToMs or other logic inside the un-cached block to prove they are bypassed.
    // parseIntervalToMs is private, but we can verify that if we manually change the hlStableCache,
    // the method immediately returns the cached value without re-calculating or looking at candles.
    const cacheKey = 'BTCUSDT:1m:2';
    const stableCacheEntry = (service as any).hlStableCache.get(cacheKey);
    expect(stableCacheEntry).toBeDefined();

    // Mutate the cache entry directly
    stableCacheEntry.minLow = 999;
    stableCacheEntry.maxHigh = 8888;

    // Call again - it should return the mutated cached values directly, confirming bypass of O(N) calculation
    const extremes2 = service.getLookbackExtremes('BTCUSDT', '1m', 2);
    expect(extremes2).toEqual({ minLow: 999, maxHigh: 8888 });
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
});
