import { EventEmitter2 } from '@nestjs/event-emitter';
/**
 * Regression guard for the market-data blackout fallback (Citadel Protocol 2026).
 *
 * `forceRawDiscovery` used to be set to `true` in three places (startup self-test timeout,
 * `checkStreamHealth` circuit breaker) but was NEVER read by `startGlobalDiscovery()`, so it
 * was dead code: the same starved aggregate stream was reopened and the scanner silently
 * relied on the REST seed. This test proves that when `forceRawDiscovery` is active,
 * `startGlobalDiscovery()` actually switches to a DISTINCT transport — individual
 * symbol-scoped `<symbol>@miniTicker` / `<symbol>@markPrice@1s` streams — instead of the
 * starved `!miniTicker@arr` / `!markPrice@arr` broadcast.
 */
let captured = {};
jest.mock('../lib/binanceSubscriptionManager', () => ({
    BinanceSubscriptionManager: jest.fn().mockImplementation((wsUrl, opts) => {
        captured.wsUrl = wsUrl;
        return {
            connect: jest.fn().mockResolvedValue(undefined),
            subscribe: jest.fn().mockImplementation((topics) => {
                captured.topics = topics;
                return Promise.resolve();
            }),
            stop: jest.fn().mockResolvedValue(undefined),
        };
    }),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MarketFeedService } = require('./market_feed.service');
describe('MarketFeedService - forceRawDiscovery drives a real fallback transport', () => {
    let service;
    beforeEach(() => {
        captured = {};
        service = new MarketFeedService({ topByVolume: jest.fn(() => [{ symbol: 'ETHUSDT' }, { symbol: 'BNBUSDT' }]), getCacheSize: jest.fn(() => 0), bulkUpdate: jest.fn(), updateTicker: jest.fn(), getLatestTickers: jest.fn(() => []) }, { upsertCandle: jest.fn() }, { isBanned: jest.fn(() => false), config: { trading_mode: 'live' }, activeTrades: [] }, {}, { incrementApiRequests: jest.fn(), recordUdsPing: jest.fn(), getMetrics: jest.fn(() => ({ application: { last_uds_ping_sec: 0, exchange_uds_status: 'OK' } })) }, new EventEmitter2(), { genericRequest: jest.fn() }, { findOne: jest.fn() });
    });
    it('uses the aggregate stream by default (forceRawDiscovery = false)', async () => {
        service.forceRawDiscovery = false;
        service.currentConfig = { symbols: ['BTCUSDT'], excluded_symbols: [] };
        await service.startGlobalDiscovery();
        expect(captured.wsUrl).toContain('!miniTicker@arr');
        expect(captured.wsUrl).toContain('!markPrice@arr@1s');
        expect(captured.wsUrl).not.toContain('@miniTicker');
    });
    it('switches to symbol-scoped streams when forceRawDiscovery is active', async () => {
        service.forceRawDiscovery = true;
        service.currentConfig = { symbols: ['BTCUSDT'], excluded_symbols: [] };
        await service.startGlobalDiscovery();
        // Must NOT use the starved aggregate broadcast...
        expect(captured.wsUrl).not.toContain('!miniTicker@arr');
        expect(captured.wsUrl).not.toContain('!markPrice@arr@1s');
        // ...and MUST subscribe to symbol-scoped miniTicker/markPrice streams built from the
        // known candidate set (config.symbols + active trades + REST-seeded top volume).
        expect(captured.wsUrl).toContain('btcusdt@miniTicker');
        expect(captured.wsUrl).toContain('btcusdt@markPrice@1s');
        expect(captured.wsUrl).toContain('ethusdt@miniTicker');
        expect(captured.wsUrl).toContain('bnbusdt@miniTicker');
        expect(Array.isArray(captured.topics)).toBe(true);
        expect(captured.topics.every((t) => t.endsWith('@miniTicker') || t.endsWith('@markPrice@1s'))).toBe(true);
    });
    it('falls back to the aggregate stream when no candidates are known', async () => {
        service.forceRawDiscovery = true;
        service.currentConfig = { excluded_symbols: [] };
        // No config.symbols, no active trades, empty TickerCache -> nothing known.
        service.tickerCache.topByVolume = jest.fn(() => []);
        await service.startGlobalDiscovery();
        expect(captured.wsUrl).toContain('!miniTicker@arr');
        expect(captured.wsUrl).toContain('!markPrice@arr@1s');
    });
});
