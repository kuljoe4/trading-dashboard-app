import { EventEmitter2 } from '@nestjs/event-emitter';
import { KlineStoreService } from './kline_store.service';
import { MarketFeedService } from './market_feed.service';
import { TradingSessionService } from './trading_session.service';
import { MaintenanceService } from './maintenance.service';
import { PositionTrackerService } from './positionTracker';

jest.mock('../lib/binanceSubscriptionManager', () => ({
  BinanceSubscriptionManager: jest.fn().mockImplementation((wsUrl: string) => ({
    wsUrl,
    activeSubscriptions: new Set<string>(),
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

  function createMarketFeed(overrides?: { sessionState?: any; klineStore?: KlineStoreService; signalEngine?: any }) {
    const klineStore = overrides?.klineStore || new KlineStoreService({ upsert: jest.fn().mockResolvedValue({}), find: jest.fn().mockResolvedValue([]) } as any);
    const sessionState = overrides?.sessionState || {
      isBanned: jest.fn().mockReturnValue(false),
      isGated: jest.fn().mockReturnValue(false),
      isStrategyPaused: jest.fn().mockReturnValue(false),
      updateRateLimit: jest.fn(),
      paused: false,
      pausedStrategies: new Set<string>(),
      strategyGateStates: new Map<string, any>(),
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

    const feed = new MarketFeedService(
      { topByVolume: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }]), getCacheSize: jest.fn().mockReturnValue(2) } as any,
      klineStore,
      sessionState,
      signalEngine,
      { incrementApiRequests: jest.fn(), recordUdsPing: jest.fn() } as any,
      new EventEmitter2(),
      { genericRequest: jest.fn(), proxyFetch: jest.fn() } as any,
      { findOne: jest.fn(), update: jest.fn().mockResolvedValue({}) } as any,
    );

    (feed as any).running = true;
    (feed as any).exchangeInfo = new Map([
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
    jest.spyOn(feed as any, 'processBackfillQueue').mockResolvedValue(undefined);

    const cfg: any = {
      trading_mode: 'live',
      global_scanner_enabled: true,
      hibernation_mode: 'adaptive',
      strategy_label: '1D hl 2 5 ema',
      symbols: ['BTCUSDT', 'ETHUSDT'],
      scan_interval: '5m',
      exit_signals: ['ema_dual_cross'],
      signal_timeframes: { ema_dual_cross: '1h' },
    };

    await (feed as any).executeWatchlistUpdate(cfg);
    const wl: Map<string, Set<string>> = (feed as any).activeWatchlist;

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
    jest.spyOn(feed as any, 'processBackfillQueue').mockResolvedValue(undefined);

    await (feed as any).executeWatchlistUpdate({
      trading_mode: 'live',
      global_scanner_enabled: false,
      strategy_label: 'Base',
      scan_interval: '5m',
    } as any);

    const wl: Map<string, Set<string>> = (feed as any).activeWatchlist;
    expect(Array.from(wl.get('AGTUSDT') || []).sort()).toEqual(['1h', '1m', '5m']);
  });

  it('uses limit=99 (1 weight) for warmup <= 89 and does not poison 5m cooldown on load-shed/error', async () => {
    const { feed, sessionState, klineStore } = createMarketFeed();
    sessionState.activeTrades = [{ symbol: 'DOGEUSDT' }];

    const restMock = jest.fn()
      .mockRejectedValueOnce(new Error('Load shedding active: klineCandlestickData rejected'))
      .mockResolvedValueOnce({
        headers: { get: () => '10' },
        data: () => Promise.resolve(
          Array.from({ length: 70 }, (_, i) => [1700000000000 + i * 3600000, '1', '2', '0.5', '1.5', '10', '0', '100'])
        ),
      });

    (feed as any).binanceClient = { restAPI: { klineCandlestickData: restMock } };

    // 1st attempt fails due to load shedding -> must NOT set 5m lastBackfillAttemptMap
    await (feed as any).backfillKlines('DOGEUSDT', '1h');
    expect((feed as any).lastBackfillAttemptMap.has('DOGEUSDT:1h')).toBe(false);
    expect((feed as any).failureBackoffMap.has('DOGEUSDT:1h')).toBe(true);

    // Expire short failure backoff -> 2nd attempt succeeds with limit=99 and active_warmup priority
    (feed as any).failureBackoffMap.set('DOGEUSDT:1h', Date.now() - 1000);
    await (feed as any).backfillKlines('DOGEUSDT', '1h');

    expect(restMock).toHaveBeenCalledTimes(2);
    expect(restMock.mock.calls[1][0]).toEqual(expect.objectContaining({
      symbol: 'DOGEUSDT',
      interval: '1h',
      limit: 99,
      __queuePriority: 'active_warmup',
    }));
    expect((feed as any).lastBackfillAttemptMap.has('DOGEUSDT:1h')).toBe(true);
    // 70 < 99 -> recorded in shortHistoryMap to prevent infinite re-backfill loops
    expect(feed.isBackfillShortHistory('DOGEUSDT', '1h')).toBe(true);
    expect(klineStore.getRawCandles('DOGEUSDT', '1h').length).toBe(70);
  });

  it('TradingSessionService initializes reconciliation/watchdog timestamps and skips periodic reconcile when UDS is connected', async () => {
    const sessionState: any = {
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
    const maintenanceService: any = {
      reconcileLiveState: jest.fn().mockResolvedValue(undefined),
      protectionWatchdog: jest.fn().mockResolvedValue(undefined),
      manageHibernation: jest.fn().mockResolvedValue(false),
    };
    const sessionLifecycle: any = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      isUdsConnected: true,
    };

    const sessionStateMock = { ...sessionState, setActiveTrades: jest.fn(), minimize: jest.fn() };
    const tradingSession = new TradingSessionService(
      { getAllTickers: jest.fn().mockReturnValue([]), topByVolume: jest.fn().mockReturnValue([]), getTicker: jest.fn(), clear: jest.fn() } as any, // tickerCache
      { clear: jest.fn() } as any, // klineStore
      {} as any, // signalEngine
      { checkSessionGating: jest.fn().mockReturnValue({ gated: false }), canEnter: jest.fn().mockReturnValue({ canEnter: true, reason: 'OK' }) } as any, // riskEngine
      {
        reset: jest.fn(),
        clear: jest.fn(),
        activeList: jest.fn().mockReturnValue([]),
        activeCount: jest.fn().mockReturnValue(0),
        totalRisk: jest.fn().mockReturnValue(0),
        recalculateTotalRisk: jest.fn(),
        getPositionSymbols: jest.fn().mockReturnValue([]),
        getInFlightSymbols: jest.fn().mockReturnValue([]),
      } as any, // positionTracker
      {} as any, // orderManager
      { setCandleCloseCallback: jest.fn(), start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined) } as any, // marketFeed
      { scan: jest.fn().mockReturnValue([]) } as any, // momentumScanner
      { setLoopStage: jest.fn(), updateMetrics: jest.fn(), recordMainLoop: jest.fn(), clearAppMetrics: jest.fn(), start: jest.fn(), stop: jest.fn() } as any, // monitoringService
      {} as any, // analyticsService
      { runPrerequisiteChecklist: jest.fn(), processEntries: jest.fn().mockResolvedValue(undefined), checkExits: jest.fn().mockResolvedValue(undefined) } as any, // executionService
      sessionLifecycle,
      { broadcast: jest.fn() } as any, // broadcastService
      sessionStateMock as any,
      {} as any, // variantAnalytics
      { serializeSessionSnapshot: jest.fn(), getLastRiskResult: jest.fn().mockReturnValue({}), broadcastScanner: jest.fn(), minimize: jest.fn() } as any, // engineBroadcaster
      { syncGatingStates: jest.fn(), isInsideTradingWindow: jest.fn().mockReturnValue({ inside: true }) } as any, // gatingService
      maintenanceService,
      {} as any, // auditLog
      new EventEmitter2(),
    );
    jest.spyOn(tradingSession as any, 'broadcastSnapshot').mockImplementation(() => {});
    jest.spyOn(tradingSession as any, 'refreshRiskGating').mockResolvedValue({ reason: 'OK' });

    const beforeStart = Date.now();
    await tradingSession.start({ paper_mode: false, trading_mode: 'live' } as any, 'sess-1');
    expect((tradingSession as any).lastFullReconciliationTs).toBeGreaterThanOrEqual(beforeStart);
    expect((tradingSession as any).lastWatchdogTs).toBeGreaterThanOrEqual(beforeStart);

    // Force 6 minutes elapsed since lastFullReconciliationTs while UDS is connected -> periodic reconcile skipped per AGENTS.md §8
    (tradingSession as any).lastFullReconciliationTs = Date.now() - 6 * 60 * 1000;
    (tradingSession as any).lastCleanupTs = Date.now();
    await (tradingSession as any).mainLoop();
    expect(maintenanceService.reconcileLiveState).not.toHaveBeenCalled();

    // UDS disconnected -> fallback reconciliation runs
    sessionLifecycle.isUdsConnected = false;
    await (tradingSession as any).mainLoop();
    expect(maintenanceService.reconcileLiveState).toHaveBeenCalledTimes(1);

    await tradingSession.stop();
  });

  it('MaintenanceService skips watchdog and reconcile above 60% weight and throttles per-symbol forceFresh REST queries', async () => {
    const positionTracker: any = {
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
    const orderManager: any = {
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
    const sessionState: any = {
      realTimePositions: new Map([['BTCUSDT', { amount: 1, entryPrice: 50000 }]]),
      realTimeOrders: new Map([['BTCUSDT', [{ orderId: 'sl-1', symbol: 'BTCUSDT', type: 'STOP_MARKET', stopPrice: '49000', reduceOnly: true }]]]),
      isRateLimited: jest.fn((t = 0.8) => (1500 / 2400) > t),
    };

    const maintenance = new MaintenanceService(
      positionTracker,
      orderManager,
      { getTicker: jest.fn().mockReturnValue({ price: 50000 }) } as any,
      sessionState,
      { emit: jest.fn() } as any,
      { recordCacheHit: jest.fn(), recordCacheMiss: jest.fn() } as any,
    );

    // At 62.5% weight (>60%), both watchdog and reconcileLiveState skip REST calls
    await maintenance.protectionWatchdog(true, { paper_mode: false } as any);
    await maintenance.reconcileLiveState(true, { paper_mode: false } as any);
    expect(orderManager.fetchAllPositions).not.toHaveBeenCalled();
    expect(orderManager.fetchAllOpenOrders).not.toHaveBeenCalled();
    expect(orderManager.fetchPosition).not.toHaveBeenCalled();

    // Lower weight to 10% and simulate missing SL order in cache -> forceFresh runs once, then respects 2m cooldown
    orderManager.getBinanceRateLimit.mockReturnValue({ used_weight_1m: 240, limit: 2400 });
    sessionState.isRateLimited.mockImplementation((t = 0.8) => (240 / 2400) > t);
    sessionState.realTimeOrders.set('BTCUSDT', []);

    await maintenance.protectionWatchdog(true, { paper_mode: false } as any);
    const callsAfterFirst = orderManager.fetchOpenOrders.mock.calls.filter((c: any[]) => c[1]?.forceFresh === true).length;
    expect(callsAfterFirst).toBe(1);

    await maintenance.protectionWatchdog(true, { paper_mode: false } as any);
    const callsAfterSecond = orderManager.fetchOpenOrders.mock.calls.filter((c: any[]) => c[1]?.forceFresh === true).length;
    expect(callsAfterSecond).toBe(1);
  });
});
