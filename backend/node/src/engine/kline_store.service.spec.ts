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

  it('getLookbackExtremes leverages stable cache correctly', async () => {
    // Seed lookback data using timestamps below 1000000000000 to bypass freshness check
    const klines = [
      [1000000, '10', '12', '8', '11', '100', 2000000, '1000'],
      [1060000, '11', '13', '9', '12', '100', 2060000, '1000'],
      [1120000, '12', '14', '10', '13', '100', 2120000, '1000'],
    ];

    await service.seedFromRest('BTCUSDT', '1m', klines);

    const spyParse = jest.spyOn(service as any, 'parseIntervalToMs');

    // First call: Cache Miss
    const extremes1 = service.getLookbackExtremes('BTCUSDT', '1m', 2);
    expect(extremes1).toEqual({ minLow: 8, maxHigh: 13 });
    expect(spyParse).toHaveBeenCalledTimes(1); // parseIntervalToMs is called once at the start of getLookbackExtremes

    spyParse.mockClear();

    // Second call: Cache Hit
    const extremes2 = service.getLookbackExtremes('BTCUSDT', '1m', 2);
    expect(extremes2).toEqual({ minLow: 8, maxHigh: 13 });
    expect(spyParse).toHaveBeenCalledTimes(1); // parseIntervalToMs is called once at the start of getLookbackExtremes

    spyParse.mockRestore();
  });
});
