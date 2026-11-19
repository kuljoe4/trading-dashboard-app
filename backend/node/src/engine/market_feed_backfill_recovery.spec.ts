import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceRequestQueue } from '../lib/binanceClientFactory';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MarketFeedService } = require('./market_feed.service');

describe('MarketFeedService - Backfill Queue Recovery and Ban Parser', () => {
  let service: any;
  let sessionStateMock: any;

  beforeEach(() => {
    sessionStateMock = {
      isBanned: jest.fn(() => false),
      isGated: jest.fn(() => false),
      config: { trading_mode: 'live' },
      activeTrades: [],
      binanceRateLimit: { used_1m: 0, limit: 2400 },
      getBinanceRateLimit: jest.fn(() => ({ used_weight_1m: 0, limit: 2400 })),
    };

    service = new MarketFeedService(
      { topByVolume: jest.fn(() => []), getCacheSize: jest.fn(() => 0) },
      { upsertCandle: jest.fn() },
      sessionStateMock,
      { getRequiredWarmup: jest.fn(() => 10) },
      { incrementApiRequests: jest.fn(), recordUdsPing: jest.fn() },
      new EventEmitter2(),
      { genericRequest: jest.fn() },
      { findOne: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    );

    service.running = true;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should not purge backfillQueue when a ban/429 error occurs, and instead unshift the task back and pause', async () => {
    // 1. Arrange: populate queue and set mock behavior
    service.backfillQueue = [
      { symbol: 'BTCUSDT', interval: '1m' },
      { symbol: 'ETHUSDT', interval: '1m' },
    ];

    service.backfillKlines = jest.fn().mockRejectedValue(new Error('IP banned: Too many requests. Resuming in 24h.'));

    // Intercept setTimeout to break the loop cleanly on the first paused retry
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb: any, ms: any) => {
      service.running = false; // break the loop
      cb();
      return {} as any;
    });

    // 2. Act
    await service.processBackfillQueue();

    // 3. Assert
    // BTCUSDT task should have been unshifted back to the front
    expect(service.backfillQueue).toEqual([
      { symbol: 'BTCUSDT', interval: '1m' },
      { symbol: 'ETHUSDT', interval: '1m' },
    ]);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(service.backfillProcessing).toBe(false);
  });

  it('should correctly parse server-provided ban timestamps and normalize seconds to milliseconds', () => {
    const parseBan = (msg: string): number => {
      const banMatch = msg.match(/banned until (\d+)/i);
      let until = banMatch ? parseInt(banMatch[1], 10) : Date.now() + (24 * 60 * 60 * 1000);
      if (banMatch && until < 9999999999) {
        until *= 1000;
      }
      return until;
    };

    // Case 1: Milliseconds epoch
    const msEpoch = 1718000000000;
    expect(parseBan(`IP banned until ${msEpoch}`)).toBe(msEpoch);

    // Case 2: Seconds epoch (should be normalized by multiplying by 1000)
    const secEpoch = 1718000000;
    expect(parseBan(`IP banned until ${secEpoch}`)).toBe(secEpoch * 1000);

    // Case 3: Fallback 24h
    const now = Date.now();
    const parsedFallback = parseBan('Generic error message without timestamp');
    expect(parsedFallback).toBeGreaterThanOrEqual(now + 23 * 60 * 60 * 1000);
  });

  it('prunes dropped candidates from backfillQueue when watchlist changes and detects interior candle gaps', async () => {
    service.activeWatchlist = new Map([
      ['DROPPEDUSDT', new Set(['1h', '1m'])],
      ['BTCUSDT', new Set(['1h'])],
    ]);
    service.hasSuccessfullyBuiltWatchlist = true;
    service.backfillQueue = [
      { symbol: 'DROPPEDUSDT', interval: '1h' },
      { symbol: 'DROPPEDUSDT', interval: '1m' },
      { symbol: 'BTCUSDT', interval: '1h' },
    ];
    service.tickerCache = {
      topByVolume: jest.fn().mockResolvedValue([{ symbol: 'BTCUSDT', price: 65000, volume_24h: 1e9 }]),
      getLatestTickers: jest.fn(() => []),
      getCacheSize: jest.fn(() => 1),
    };
    service.getSymbolFilters = jest.fn(() => ({ tickSize: 0.1 }));
    service.klineStore = {
      getRawCandles: jest.fn(() => Array.from({ length: 80 }, (_, idx) => ({
        time: 1_700_000_000_000 + idx * 3_600_000,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      }))),
      pruneExcept: jest.fn(),
    };
    service.rebuildCombinedKlineStream = jest.fn().mockResolvedValue(undefined);
    service.processBackfillQueue = jest.fn().mockResolvedValue(undefined);

    await service.executeWatchlistUpdate({
      trading_mode: 'live',
      global_scanner_enabled: true,
      scan_interval: '1h',
      symbols: ['BTCUSDT'],
      enabled_signals: ['ema_dual'],
    });

    // Only BTCUSDT_1h remains in backfillQueue; dropped candidate tasks are removed before dispatching REST calls
    expect(service.backfillQueue.some((t: any) => t.symbol === 'DROPPEDUSDT')).toBe(false);

    // Verify interior time-gap detection catches gaps masked by fresh tail candle
    const hour = 3_600_000;
    const base = Date.now() - 10 * hour;
    const gappedCandles = [
      { time: base, close: 1 },
      { time: base + hour, close: 1 },
      { time: base + 5 * hour, close: 1 }, // 4h gap
      { time: Date.now() - 10_000, close: 1 }, // fresh tail
    ];
    expect(service.hasBufferTimeGap(gappedCandles, '1h', 4)).toBe(true);
  });
});

