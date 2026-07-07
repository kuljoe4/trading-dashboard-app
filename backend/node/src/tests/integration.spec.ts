import { TradingSessionService } from '../engine/trading_session.service';
import { ExecutionService } from '../engine/execution.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('Trade Lifecycle Integration', () => {
  let tradingSession: TradingSessionService;
  let executionService: ExecutionService;
  let mockBinanceClient: any;
  let mockTickerCache: any;
  let mockKlineStore: any;
  let mockSignalEngine: any;
  let mockRiskEngine: any;
  let mockPositionTracker: any;
  let mockOrderManager: any;
  let mockSessionState: any;
  let mockAuditLog: any;
  let mockSessionLifecycle: any;

  beforeEach(() => {
    mockBinanceClient = {
      restAPI: {
        tradeApi: {
          newOrder: jest.fn(),
          cancelOrder: jest.fn(),
        },
        userDataStreamsApi: {
            startUserDataStream: jest.fn().mockResolvedValue({ data: { listenKey: 'key' } }),
            closeUserDataStream: jest.fn()
        }
      },
      websocketStreams: {
          connect: jest.fn().mockResolvedValue({ on: jest.fn(), userData: jest.fn() })
      }
    };

    mockTickerCache = {
      getPrice: jest.fn().mockReturnValue(50000),
      getTicker: jest.fn().mockReturnValue({ symbol: 'BTCUSDT', price: 50000, volume_24h: 1000000 }),
      bulkUpdate: jest.fn(),
      getCacheSize: jest.fn().mockReturnValue(1),
      clear: jest.fn(),
    };

    mockKlineStore = {
      getRecentCandles: jest.fn().mockReturnValue([]),
      getLookbackExtremes: jest.fn().mockReturnValue({ minLow: 49000, maxHigh: 51000 }),
      seedFromRest: jest.fn(),
      getMaxCandles: jest.fn().mockReturnValue(100),
      clear: jest.fn(),
    };

    mockSignalEngine = {
      checkEntry: jest.fn().mockReturnValue({ allFired: true }),
    };

    mockRiskEngine = {
      canEnter: jest.fn().mockReturnValue({ canEnter: true }),
      computeSl: jest.fn().mockReturnValue({ slPrice: 49000, rejected: false }),
      computeTp: jest.fn().mockReturnValue(52000),
      computePositionSize: jest.fn().mockReturnValue(0.1),
    };

    mockPositionTracker = {
      activeList: jest.fn().mockReturnValue([]),
      activeCount: jest.fn().mockReturnValue(0),
      enteringCount: jest.fn().mockReturnValue(0),
      totalRisk: jest.fn().mockReturnValue(0),
      hasSymbol: jest.fn().mockReturnValue(false),
      addTrade: jest.fn(),
      removeTrade: jest.fn(),
      closeTrade: jest.fn(),
      setEntering: jest.fn(),
      checkRrSequenceAdjustments: jest.fn(),
      checkExitConditions: jest.fn(),
      setTradeUpdateCallback: jest.fn(),
      clear: jest.fn(),
    };

    mockOrderManager = {
      enter: jest.fn(),
      setBinanceClient: jest.fn(),
      applyFilters: jest.fn().mockImplementation((s, p, q) => ({ price: p, qty: q })),
    };

    mockSessionState = {
      reset: jest.fn(),
      getBalance: jest.fn().mockReturnValue(10000),
      updateStatsOnEntry: jest.fn(),
      updateStatsOnClose: jest.fn(),
      setActiveTrades: jest.fn(),
      addClosedTrade: jest.fn(),
      isEcoMode: jest.fn().mockReturnValue(false),
      isGated: jest.fn().mockReturnValue(false),
      minimize: jest.fn(),
      stats: {},
      closedTrades: [],
      realTimePositions: new Map(),
    };

    mockAuditLog = {
      log: jest.fn(),
    };

    mockSessionLifecycle = {
        start: jest.fn().mockResolvedValue({ status: 'started' }),
        stop: jest.fn().mockResolvedValue({ status: 'stopped' }),
    };

    const mockMonitoringService = {
      recordHotLoop: jest.fn(),
      recordMainLoop: jest.fn(),
      clearAppMetrics: jest.fn(),
      setLoopStage: jest.fn(),
      incrementApiRequests: jest.fn()
    } as any;

    const mockEngineBroadcaster = {
      broadcastTick: jest.fn(),
      serializeTrade: jest.fn(),
      minimize: jest.fn(),
      getLastTickData: jest.fn(),
      getLastRiskResult: jest.fn(),
      getLastAnalyticsResult: jest.fn(),
      getLastScannerResults: jest.fn()
    } as any;

    const mockGatingService = {
      isInsideTradingWindow: jest.fn().mockReturnValue(true),
      mapGateState: jest.fn().mockReturnValue('active'),
      enterHibernation: jest.fn(),
      exitHibernation: jest.fn()
    } as any;

    const mockAnalyticsService = {
      calculateAnalytics: jest.fn().mockReturnValue({
        maxDrawdown: 0,
        maxDrawdownPct: 0,
        overallWinRate: 0,
        cumulativePnL: [],
        timeOfDay: [],
        roiTrends: { sevenDay: 0, fourWeek: 0 }
      })
    } as any;

    const mockBroadcastService = {
      setWsBroadcaster: jest.fn(),
      broadcast: jest.fn()
    } as any;

    executionService = new ExecutionService(
      mockTickerCache,
      mockKlineStore,
      mockSignalEngine,
      mockRiskEngine,
      mockPositionTracker,
      mockOrderManager,
      mockSessionState,
      mockGatingService,
      mockBroadcastService,
      mockMonitoringService,
      mockEngineBroadcaster,
      new EventEmitter2(),
      mockAnalyticsService
    );

    tradingSession = new TradingSessionService(
      mockTickerCache,
      mockKlineStore,
      mockSignalEngine,
      mockRiskEngine,
      ({ ...mockPositionTracker, recalculateTotalRisk: jest.fn() } as any),
      mockOrderManager,
      { start: jest.fn(), stop: jest.fn(), setCandleCloseCallback: jest.fn() } as any, // marketFeed
      { start: jest.fn(), stop: jest.fn(), scan: jest.fn().mockReturnValue([{ symbol: 'BTCUSDT', direction: 'long', momentum: 5, volume_24h: 1000000, score: 80 }]) } as any, // momentumScanner
      mockMonitoringService,
      mockAnalyticsService,
      executionService,
      mockSessionLifecycle,
      mockBroadcastService,
      mockSessionState,
      { calculateVariantStats: jest.fn() } as any, // variantAnalytics
      mockEngineBroadcaster,
      mockGatingService,
      {} as any, // maintenanceService
      mockAuditLog,
      new EventEmitter2()
    );
  });

  it('completes a full trade lifecycle from entry to exit', async () => {
    const config: SessionConfig = {
      strategy_label: 'Test Strategy',
      paper_mode: true,
    } as any;

    const mockTrade: Trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 0.1,
      status: 'OPEN',
      pnl: 0,
    } as any;

    mockOrderManager.enter.mockResolvedValue(mockTrade);

    // 1. Start Session
    await tradingSession.start(config, mockBinanceClient);
    expect(mockSessionLifecycle.start).toHaveBeenCalled();

    // 2. Trigger Entry via Main Loop
    // The main loop now uses executionService directly via tradingSession
    // In our mock setup, we need to ensure the mainLoop correctly calls executionService
    await (tradingSession as any).mainLoop();

    // 3. Trigger Exit via Hot Loop
    mockPositionTracker.activeList.mockReturnValue([mockTrade]);
    mockPositionTracker.activeCount.mockReturnValue(1);
    mockPositionTracker.checkExitConditions.mockReturnValue({ exitOccurred: true, exitReason: 'TP_HIT' });

    const closedTrade = { ...mockTrade, status: 'CLOSED', pnl: 100, exit_price: 51000 };
    mockPositionTracker.closeTrade.mockResolvedValue({ exitOccurred: true, trade: closedTrade });

    await (tradingSession as any).hotLoop();

    // 4. Stop Session
    mockPositionTracker.activeList.mockReturnValue([]);
    await tradingSession.stop();
    expect(mockSessionLifecycle.stop).toHaveBeenCalled();
  });
});
