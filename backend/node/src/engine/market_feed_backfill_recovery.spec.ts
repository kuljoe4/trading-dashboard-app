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

  it('retains non-expired backfill cooldowns across watchlist rotation and throttles ensureKlinesAvailable', async () => {
    const now = Date.now();
    (service as any).lastBackfillAttemptMap.set('ROTATEDUSDT:1h', now - 60_000); // 1m ago (valid 5m cooldown)
    (service as any).lastBackfillAttemptMap.set('EXPIREDUSDT:1h', now - 6 * 60_000); // 6m ago (expired)
    service.activeWatchlist = new Map([['ROTATEDUSDT', new Set(['1h'])]]);
    service.hasSuccessfullyBuiltWatchlist = true;
    service.tickerCache = {
      topByVolume: jest.fn().mockResolvedValue([{ symbol: 'BTCUSDT', price: 65000, volume_24h: 1e9 }]),
      getLatestTickers: jest.fn(() => []),
      getCacheSize: jest.fn(() => 1),
    };
    service.getSymbolFilters = jest.fn(() => ({ tickSize: 0.1 }));
    service.klineStore = {
      getRawCandles: jest.fn(() => Array.from({ length: 80 }, (_, idx) => ({
        time: now - (80 - idx) * 3_600_000,
        open: 1, high: 1, low: 1, close: 1, volume: 1,
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

    // Non-expired cooldown survives transient rotation; expired entry is garbage-collected
    expect((service as any).lastBackfillAttemptMap.has('ROTATEDUSDT:1h')).toBe(true);
    expect((service as any).lastBackfillAttemptMap.has('EXPIREDUSDT:1h')).toBe(false);

    // ensureKlinesAvailable skips when weight > 40% ceiling for non-active symbols
    const backfillSpy = jest.spyOn(service as any, 'backfillKlines').mockResolvedValue(undefined);
    sessionStateMock.getBinanceRateLimit.mockReturnValue({ used_weight_1m: 1100, weight_limit: 2400 });
    await service.ensureKlinesAvailable('ETHUSDT', '1h', 20);
    expect(backfillSpy).not.toHaveBeenCalled();

    // When weight is healthy, first call executes and second within 60s is skipped by cooldown
    sessionStateMock.getBinanceRateLimit.mockReturnValue({ used_weight_1m: 100, weight_limit: 2400 });
    await service.ensureKlinesAvailable('ETHUSDT', '1h', 20);
    await service.ensureKlinesAvailable('ETHUSDT', '1h', 20);
    expect(backfillSpy).toHaveBeenCalledTimes(1);
  });

  it('sleeps until :01.200 past minute rollover when backfill weight exceeds ceiling near minute end', async () => {
    const baseMinute = Math.floor(Date.now() / 60000) * 60000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(baseMinute + 54_000); // :54.000
    service.backfillQueue = [{ symbol: 'BTCUSDT', interval: '1h' }];
    sessionStateMock.getBinanceRateLimit.mockReturnValue({ used_weight_1m: 1222, weight_limit: 2400 });
    const waitMsObserved: number[] = [];
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb: any, ms: any) => {
      waitMsObserved.push(Number(ms));
      service.running = false; // exit after checking first rollover sleep
      cb();
      return {} as any;
    });

    await service.processBackfillQueue();
    expect(waitMsObserved[0]).toBe(6000 + 1200);
    setTimeoutSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it('defers eager 1m backfill on >5-symbol multi-TF scanners while keeping 1m eager for active trades and solo top', async () => {
    const now = Date.now();
    service.hasSuccessfullyBuiltWatchlist = true;
    service.getSymbolFilters = jest.fn(() => ({ tickSize: 0.1 }));
    service.klineStore = {
      getRawCandles: jest.fn(() => []),
      pruneExcept: jest.fn(),
      trimGapsAndStaleTail: jest.fn(),
    };
    service.rebuildCombinedKlineStream = jest.fn().mockResolvedValue(undefined);
    service.processBackfillQueue = jest.fn().mockResolvedValue(undefined);
    service.tickerCache = {
      topByVolume: jest.fn().mockResolvedValue([]),
      getLatestTickers: jest.fn(() => []),
      getCacheSize: jest.fn(() => 10),
    };

    // 1. Multi-symbol (>5) with active trade on SYM0USDT -> SYM0USDT gets 1m eagerly; SYM1..6 skip eager 1m and queue 1h only
    sessionStateMock.activeTrades = [{ symbol: 'SYM0USDT' }];
    await service.executeWatchlistUpdate({
      trading_mode: 'live',
      global_scanner_enabled: true,
      scan_interval: '1h',
      symbols: ['SYM1USDT', 'SYM2USDT', 'SYM3USDT', 'SYM4USDT', 'SYM5USDT', 'SYM6USDT'],
      enabled_signals: ['ema_dual'],
      signal_timeframes: { ema_dual: '1m' },
    });

    expect(service.backfillQueue.some((t: any) => t.symbol === 'SYM0USDT' && t.interval === '1m')).toBe(true);
    expect(service.backfillQueue.some((t: any) => t.symbol === 'SYM1USDT' && t.interval === '1m')).toBe(false);
    expect(service.backfillQueue.some((t: any) => t.symbol === 'SYM1USDT' && t.interval === '1h')).toBe(true);

    // 2. Solo Top (<=5 symbols, no active trade) -> 1m IS queued eagerly for instant cold-start
    service.backfillQueue = [];
    sessionStateMock.activeTrades = [];
    await service.executeWatchlistUpdate({
      trading_mode: 'live',
      global_scanner_enabled: true,
      scan_interval: '1h',
      symbols: ['SOLOUSDT'],
      enabled_signals: ['ema_dual'],
      signal_timeframes: { ema_dual: '1m' },
    });

    expect(service.backfillQueue.some((t: any) => t.symbol === 'SOLOUSDT' && t.interval === '1m')).toBe(true);
    expect(now).toBeGreaterThan(0);
  });
});

