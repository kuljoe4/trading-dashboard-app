import { EventEmitter2 } from '@nestjs/event-emitter';
import { KlineStoreService } from './kline_store.service';
import { MarketFeedService } from './market_feed.service';
import { TradingSessionService } from './trading_session.service';
import { MaintenanceService } from './maintenance.service';
import { PositionTrackerService } from './positionTracker';
jest.mock('../lib/binanceSubscriptionManager', () => ({
    BinanceSubscriptionManager: jest.fn().mockImplementation((wsUrl) => ({
        wsUrl,
        activeSubscriptions: new Set(),
        connect: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn().mockResolvedValue(undefined),
        unsubscribe: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
    })),
}));
describe('IP Ban & Warmup Resilience', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });
    function createMarketFeed(overrides) {
        const klineStore = overrides?.klineStore || new KlineStoreService({ upsert: jest.fn().mockResolvedValue({}), find: jest.fn().mockResolvedValue([]) });
        const sessionState = overrides?.sessionState || {
            isBanned: jest.fn().mockReturnValue(false),
            isGated: jest.fn().mockReturnValue(false),
            isStrategyPaused: jest.fn().mockReturnValue(false),
            updateRateLimit: jest.fn(),
            paused: false,
            pausedStrategies: new Set(),
            strategyGateStates: new Map(),
            gateState: null,
            hibernating: false,
            config: { trading_mode: 'live' },
            activeTrades: [],
            binanceRateLimit: { used_1m: 0, limit: 2400 },
            getBinanceRateLimit: jest.fn(() => ({ used_weight_1m: 0, limit: 2400 })),
        };
        const signalEngine = overrides?.signalEngine || {
            getRequiredWarmup: jest.fn().mockReturnValue(60),
            resolveSignalParam: jest.fn((_p, _s, _b, _k, def) => def),
        };
        const feed = new MarketFeedService({ topByVolume: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }]), getCacheSize: jest.fn().mockReturnValue(2) }, klineStore, sessionState, signalEngine, { incrementApiRequests: jest.fn(), recordUdsPing: jest.fn() }, new EventEmitter2(), { genericRequest: jest.fn(), proxyFetch: jest.fn() }, { findOne: jest.fn(), update: jest.fn().mockResolvedValue({}) });
        feed.running = true;
        feed.exchangeInfo = new Map([
            ['BTCUSDT', { symbol: 'BTCUSDT' }],
            ['ETHUSDT', { symbol: 'ETHUSDT' }],
            ['DOGEUSDT', { symbol: 'DOGEUSDT' }],
            ['AGTUSDT', { symbol: 'AGTUSDT' }],
        ]);
        return { feed, klineStore, sessionState, signalEngine };
    }
    it('keeps active-trade exit_signals intervals monitored when max_trades gated and suppresses 50-symbol discovery', async () => {
        const { feed, sessionState } = createMarketFeed();
        sessionState.isGated.mockReturnValue(true);
        sessionState.gateState = 'max_trades';
        sessionState.strategyGateStates.set('1D hl 2 5 ema', { gateState: 'max_trades', gateReason: 'Max trades reached' });
        sessionState.activeTrades = [
            {
                symbol: 'DOGEUSDT',
                strategy_label: '1D hl 2 5 ema',
                strategy_config: {
                    scan_interval: '5m',
                    exit_signals: ['ema_dual_cross'],
                    signal_timeframes: { ema_dual_cross: '1h' },
                },
            },
        ];
        jest.spyOn(feed, 'processBackfillQueue').mockResolvedValue(undefined);
        const cfg = {
            trading_mode: 'live',
            global_scanner_enabled: true,
            hibernation_mode: 'adaptive',
            strategy_label: '1D hl 2 5 ema',
            symbols: ['BTCUSDT', 'ETHUSDT'],
            scan_interval: '5m',
            exit_signals: ['ema_dual_cross'],
            signal_timeframes: { ema_dual_cross: '1h' },
        };
        await feed.executeWatchlistUpdate(cfg);
        const wl = feed.activeWatchlist;
        // Active position keeps both 5m, 1m, and 1h exit interval
        expect(Array.from(wl.get('DOGEUSDT') || []).sort()).toEqual(['1h', '1m', '5m']);
        // Uninvolved discovery symbols suppressed when all enabled strategies are gated
        expect(wl.has('BTCUSDT')).toBe(false);
        expect(wl.has('ETHUSDT')).toBe(false);
    });
    it('collects exit_signals timeframes for active trades even when global_scanner_enabled is false', async () => {
        const { feed, sessionState } = createMarketFeed();
        sessionState.activeTrades = [
            {
                symbol: 'AGTUSDT',
                strategy_label: 'Base',
                strategy_config: {
                    scan_interval: '5m',
                    exit_signals: ['ema_dual_cross'],
                    signal_timeframes: { ema_dual_cross: '1h' },
                },
            },
        ];
        jest.spyOn(feed, 'processBackfillQueue').mockResolvedValue(undefined);
        await feed.executeWatchlistUpdate({
            trading_mode: 'live',
            global_scanner_enabled: false,
            strategy_label: 'Base',
            scan_interval: '5m',
        });
        const wl = feed.activeWatchlist;
        expect(Array.from(wl.get('AGTUSDT') || []).sort()).toEqual(['1h', '1m', '5m']);
    });
    it('uses limit=99 (1 weight) for warmup <= 89 and does not poison 5m cooldown on load-shed/error', async () => {
        const { feed, sessionState, klineStore } = createMarketFeed();
        sessionState.activeTrades = [{ symbol: 'DOGEUSDT' }];
        const restMock = jest.fn()
            .mockRejectedValueOnce(new Error('Load shedding active: klineCandlestickData rejected'))
            .mockResolvedValueOnce({
            headers: { get: () => '10' },
            data: () => Promise.resolve(Array.from({ length: 70 }, (_, i) => [1700000000000 + i * 3600000, '1', '2', '0.5', '1.5', '10', '0', '100'])),
        });
        feed.binanceClient = { restAPI: { klineCandlestickData: restMock } };
        // 1st attempt fails due to load shedding -> must NOT set 5m lastBackfillAttemptMap
        await feed.backfillKlines('DOGEUSDT', '1h');
        expect(feed.lastBackfillAttemptMap.has('DOGEUSDT:1h')).toBe(false);
        expect(feed.failureBackoffMap.has('DOGEUSDT:1h')).toBe(true);
        // Expire short failure backoff -> 2nd attempt succeeds with limit=99 and active_warmup priority
        feed.failureBackoffMap.set('DOGEUSDT:1h', Date.now() - 1000);
        await feed.backfillKlines('DOGEUSDT', '1h');
        expect(restMock).toHaveBeenCalledTimes(2);
        expect(restMock.mock.calls[1][0]).toEqual(expect.objectContaining({
            symbol: 'DOGEUSDT',
            interval: '1h',
            limit: 99,
            __queuePriority: 'active_warmup',
        }));
        expect(feed.lastBackfillAttemptMap.has('DOGEUSDT:1h')).toBe(true);
        // 70 < 99 -> recorded in shortHistoryMap to prevent infinite re-backfill loops
        expect(feed.isBackfillShortHistory('DOGEUSDT', '1h')).toBe(true);
        expect(klineStore.getRawCandles('DOGEUSDT', '1h').length).toBe(70);
    });
    it('TradingSessionService initializes reconciliation/watchdog timestamps and skips periodic reconcile when UDS is connected', async () => {
        const sessionState = {
            paused: false,
            hibernating: false,
            agreementRequired: false,
            activeTrades: [],
            isBanned: jest.fn().mockReturnValue(false),
            getBalance: jest.fn().mockReturnValue(1000),
            isGated: jest.fn().mockReturnValue(false),
            isStrategyPaused: jest.fn().mockReturnValue(false),
            config: { paper_mode: false, trading_mode: 'live', paused: false },
            last_scan_ts: 0,
            next_scan_ts: 0,
        };
        const maintenanceService = {
            reconcileLiveState: jest.fn().mockResolvedValue(undefined),
            protectionWatchdog: jest.fn().mockResolvedValue(undefined),
            manageHibernation: jest.fn().mockResolvedValue(false),
        };
        const sessionLifecycle = {
            start: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined),
            isUdsConnected: true,
        };
        const sessionStateMock = { ...sessionState, setActiveTrades: jest.fn(), minimize: jest.fn() };
        const tradingSession = new TradingSessionService({ getAllTickers: jest.fn().mockReturnValue([]), topByVolume: jest.fn().mockReturnValue([]), getTicker: jest.fn(), clear: jest.fn() }, // tickerCache
        { clear: jest.fn() }, // klineStore
        {}, // signalEngine
        { checkSessionGating: jest.fn().mockReturnValue({ gated: false }), canEnter: jest.fn().mockReturnValue({ canEnter: true, reason: 'OK' }) }, // riskEngine
        {
            reset: jest.fn(),
            clear: jest.fn(),
            activeList: jest.fn().mockReturnValue([]),
            activeCount: jest.fn().mockReturnValue(0),
            totalRisk: jest.fn().mockReturnValue(0),
            recalculateTotalRisk: jest.fn(),
            getPositionSymbols: jest.fn().mockReturnValue([]),
            getInFlightSymbols: jest.fn().mockReturnValue([]),
        }, // positionTracker
        {}, // orderManager
        { setCandleCloseCallback: jest.fn(), start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) }, // marketFeed
        { scan: jest.fn().mockReturnValue([]) }, // momentumScanner
        { setLoopStage: jest.fn(), updateMetrics: jest.fn(), recordMainLoop: jest.fn(), clearAppMetrics: jest.fn(), start: jest.fn(), stop: jest.fn() }, // monitoringService
        {}, // analyticsService
        { runPrerequisiteChecklist: jest.fn(), processEntries: jest.fn().mockResolvedValue(undefined), checkExits: jest.fn().mockResolvedValue(undefined) }, // executionService
        sessionLifecycle, { broadcast: jest.fn() }, // broadcastService
        sessionStateMock, {}, // variantAnalytics
        { serializeSessionSnapshot: jest.fn(), getLastRiskResult: jest.fn().mockReturnValue({}), broadcastScanner: jest.fn(), minimize: jest.fn() }, // engineBroadcaster
        { syncGatingStates: jest.fn(), isInsideTradingWindow: jest.fn().mockReturnValue({ inside: true }) }, // gatingService
        maintenanceService, {}, // auditLog
        new EventEmitter2());
        jest.spyOn(tradingSession, 'broadcastSnapshot').mockImplementation(() => { });
        jest.spyOn(tradingSession, 'refreshRiskGating').mockResolvedValue({ reason: 'OK' });
        const beforeStart = Date.now();
        await tradingSession.start({ paper_mode: false, trading_mode: 'live' }, 'sess-1');
        expect(tradingSession.lastFullReconciliationTs).toBeGreaterThanOrEqual(beforeStart);
        expect(tradingSession.lastWatchdogTs).toBeGreaterThanOrEqual(beforeStart);
        // Force 6 minutes elapsed since lastFullReconciliationTs while UDS is connected -> periodic reconcile skipped per AGENTS.md §8
        tradingSession.lastFullReconciliationTs = Date.now() - 6 * 60 * 1000;
        tradingSession.lastCleanupTs = Date.now();
        await tradingSession.mainLoop();
        expect(maintenanceService.reconcileLiveState).not.toHaveBeenCalled();
        // UDS disconnected -> fallback reconciliation runs
        sessionLifecycle.isUdsConnected = false;
        await tradingSession.mainLoop();
        expect(maintenanceService.reconcileLiveState).toHaveBeenCalledTimes(1);
        await tradingSession.stop();
    });
    it('MaintenanceService skips watchdog and reconcile above 60% weight and throttles per-symbol forceFresh REST queries', async () => {
        const positionTracker = {
            activeList: jest.fn().mockReturnValue([
                {
                    id: 't-1',
                    symbol: 'BTCUSDT',
                    status: 'OPEN',
                    qty: 1,
                    direction: 'LONG',
                    binance_order_id: 'ord-1',
                    binance_stop_order_id: 'sl-1',
                    updated_at: new Date(Date.now() - 60000),
                },
            ]),
            isEntering: jest.fn().mockReturnValue(false),
            isClosing: jest.fn().mockReturnValue(false),
        };
        const orderManager = {
            isBanned: jest.fn().mockReturnValue(false),
            isRatcheting: jest.fn().mockReturnValue(false),
            fetchAllPositions: jest.fn().mockResolvedValue([]),
            fetchAllOpenOrders: jest.fn().mockResolvedValue([]),
            fetchPosition: jest.fn().mockResolvedValue({ symbol: 'BTCUSDT', positionAmt: '1' }),
            fetchOpenOrders: jest.fn().mockResolvedValue([]),
            seedRealTimePosition: jest.fn(),
            placeStopLoss: jest.fn().mockResolvedValue({ success: false }),
            cancelBinanceOrder: jest.fn().mockResolvedValue(undefined),
            getBinanceRateLimit: jest.fn().mockReturnValue({ used_weight_1m: 1500, limit: 2400 }), // 62.5%
        };
        const sessionState = {
            realTimePositions: new Map([['BTCUSDT', { amount: 1, entryPrice: 50000 }]]),
            realTimeOrders: new Map([['BTCUSDT', [{ orderId: 'sl-1', symbol: 'BTCUSDT', type: 'STOP_MARKET', stopPrice: '49000', reduceOnly: true }]]]),
            isRateLimited: jest.fn((t = 0.8) => (1500 / 2400) > t),
        };
        const maintenance = new MaintenanceService(positionTracker, orderManager, { getTicker: jest.fn().mockReturnValue({ price: 50000 }) }, sessionState, { emit: jest.fn() }, { recordCacheHit: jest.fn(), recordCacheMiss: jest.fn() });
        // At 62.5% weight (>60%), both watchdog and reconcileLiveState skip REST calls
        await maintenance.protectionWatchdog(true, { paper_mode: false });
        await maintenance.reconcileLiveState(true, { paper_mode: false });
        expect(orderManager.fetchAllPositions).not.toHaveBeenCalled();
        expect(orderManager.fetchAllOpenOrders).not.toHaveBeenCalled();
        expect(orderManager.fetchPosition).not.toHaveBeenCalled();
        // Lower weight to 10% and simulate missing SL order in cache -> forceFresh runs once, then respects 2m cooldown
        orderManager.getBinanceRateLimit.mockReturnValue({ used_weight_1m: 240, limit: 2400 });
        sessionState.isRateLimited.mockImplementation((t = 0.8) => (240 / 2400) > t);
        sessionState.realTimeOrders.set('BTCUSDT', []);
        await maintenance.protectionWatchdog(true, { paper_mode: false });
        const callsAfterFirst = orderManager.fetchOpenOrders.mock.calls.filter((c) => c[1]?.forceFresh === true).length;
        expect(callsAfterFirst).toBe(1);
        await maintenance.protectionWatchdog(true, { paper_mode: false });
        const callsAfterSecond = orderManager.fetchOpenOrders.mock.calls.filter((c) => c[1]?.forceFresh === true).length;
        expect(callsAfterSecond).toBe(1);
    });
    it('PositionTrackerService suppresses SL ratchets when banned and applies exponential backoff + log deduplication on CANCEL_FAILED', async () => {
        const logEvents = [];
        const tradeUpdatedEvents = [];
        const emitter = new EventEmitter2();
        emitter.on('engine.log', (e) => logEvents.push(e));
        emitter.on('trade.updated', (e) => tradeUpdatedEvents.push(e));
        const sessionState = {
            config: { paper_mode: false, trading_mode: 'live', live_rr_sequence: [1.0], exit_rr_sequence: [0.5] },
            apiStatus: { isBanned: false, isRateLimited: false, banUntil: null },
            isBanned: jest.fn().mockReturnValue(false),
            isGeoBlocked: jest.fn().mockReturnValue(false),
            setActiveTrades: jest.fn(),
        };
        const orderManager = {
            isRatcheting: jest.fn().mockReturnValue(false),
            applyFilters: jest.fn((_sym, price, qty) => ({ price: Math.round(price), qty })),
            updateStopLoss: jest.fn().mockResolvedValue({
                success: false,
                errorCode: 'CANCEL_FAILED',
                error: 'Failed to cancel old SL 3000002374769411 for ZECUSDT. Aborting ratchet to prevent duplicate orders.',
            }),
        };
        const tracker = new PositionTrackerService({}, {}, orderManager, { getPrice: jest.fn().mockReturnValue(850) }, {}, sessionState, emitter);
        const zecTrade = {
            id: 'zec-1',
            symbol: 'ZECUSDT',
            direction: 'SHORT',
            status: 'OPEN',
            entry_price: 927.395,
            initial_sl: 960,
            current_sl: 918.58,
            qty: 1,
            max_rr_achieved: 2.0,
            rr_sequence_index: 0,
            live_rr_sequence: [1.0],
            exit_rr_sequence: [1.2],
            binance_stop_order_id: '3000002374769411',
            binance_stop_order_type: 'standard',
            active_trade_events: [],
        };
        tracker.addTrade(zecTrade);
        logEvents.length = 0;
        tradeUpdatedEvents.length = 0;
        // 1. When banned, onTickerUpdate must NOT call updateStopLoss or emit failure logs
        sessionState.isBanned.mockReturnValue(true);
        await tracker.onTickerUpdate('ZECUSDT', 850);
        expect(orderManager.updateStopLoss).not.toHaveBeenCalled();
        expect(logEvents.length).toBe(0);
        // 2. When unbanned, first failed ratchet calls updateStopLoss once and sets 15s backoff;
        // subsequent ticks within backoff window do NOT hammer updateStopLoss or spam DB/logs
        sessionState.isBanned.mockReturnValue(false);
        await tracker.onTickerUpdate('ZECUSDT', 850);
        expect(orderManager.updateStopLoss).toHaveBeenCalledTimes(1);
        expect(logEvents.length).toBe(1);
        expect(logEvents[0].msg).toContain('Retry backoff: 15s');
        // Simulate 5-second ticks during the 15s backoff window -> suppressed!
        await tracker.onTickerUpdate('ZECUSDT', 849);
        await tracker.onTickerUpdate('ZECUSDT', 848);
        expect(orderManager.updateStopLoss).toHaveBeenCalledTimes(1);
        expect(logEvents.length).toBe(1);
    });
});
