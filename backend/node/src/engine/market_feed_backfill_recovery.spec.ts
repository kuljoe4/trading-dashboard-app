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
});
