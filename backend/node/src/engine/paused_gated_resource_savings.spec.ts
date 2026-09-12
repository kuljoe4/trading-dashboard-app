import { ExecutionService } from './execution.service';
import { PositionTrackerService } from './positionTracker';
import { SessionStateService } from './session_state.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Paused & Gated Strategy Resource Savings Spec', () => {
  let executionService: ExecutionService;
  let mockSessionState: any;
  let mockPositionTracker: any;
  let mockSignalEngine: any;
  let mockTickerCache: any;
  let mockKlineStore: any;
  let mockRiskEngine: any;
  let mockOrderManager: any;
  let mockGatingService: any;
  let mockBroadcastService: any;
  let mockMonitoringService: any;
  let mockEngineBroadcaster: any;
  let mockEventEmitter: any;
  let mockAnalyticsService: any;

  beforeEach(() => {
    mockSessionState = {
      isBanned: jest.fn().mockReturnValue(false),
      isGated: jest.fn().mockReturnValue(false),
      isStrategyPaused: jest.fn(),
      getBalance: jest.fn().mockReturnValue(10000),
      closedTrades: [],
      entryInProgress: false,
      realTimePositions: new Map(),
      apiStatus: { isBanned: false },
    };

    mockPositionTracker = {
      activeCount: jest.fn().mockReturnValue(1),
      activeList: jest.fn().mockReturnValue([]),
      hasSymbol: jest.fn().mockReturnValue(false),
      enteringCount: jest.fn().mockReturnValue(0),
      totalRisk: jest.fn().mockReturnValue(0),
      setEntering: jest.fn(),
      checkKnifeTrailingStop: jest.fn(),
      checkRrSequenceAdjustments: jest.fn(),
      checkTrailingStop: jest.fn(),
      checkExitConditions: jest.fn().mockReturnValue({ exitOccurred: false }),
    };

    mockSignalEngine = {
      checkEntry: jest.fn(),
      knifeCatchSignal: jest.fn().mockReturnValue({ fired: false }),
      getRequiredWarmup: jest.fn().mockReturnValue(10),
    };

    mockTickerCache = {
      getPrice: jest.fn().mockReturnValue(100),
      getTicker: jest.fn().mockReturnValue({ open_24h: 100 }),
    };

    mockKlineStore = {
      getRawCandles: jest.fn().mockReturnValue([{ time: 1000, close: 100 }]),
      getLookbackExtremes: jest.fn().mockReturnValue({ minLow: 95, maxHigh: 105 }),
    };

    mockRiskEngine = {
      computeSl: jest.fn().mockReturnValue({ slPrice: 95, rejected: false }),
      computePositionSize: jest.fn().mockReturnValue({ qty: 10, rejected: false }),
      computeTp: jest.fn().mockReturnValue(110),
      canEnter: jest.fn().mockReturnValue({ canEnter: true }),
    };

    mockOrderManager = {
      applyFilters: jest.fn((sym, price, qty) => ({ price, qty })),
      enter: jest.fn(),
    };

    mockGatingService = {};
    mockBroadcastService = { broadcast: jest.fn() };
    mockMonitoringService = { setLoopStage: jest.fn() };
    mockEngineBroadcaster = {};
    mockEventEmitter = { emit: jest.fn() };
    mockAnalyticsService = {};

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
      mockEventEmitter,
      mockAnalyticsService,
    );
  });

  it('1. should skip signal evaluation for paused strategies during entry processing', async () => {
    const config = Object.assign(new SessionConfig(), {
      paper_mode: true,
      strategy_label: 'Momentum Strategy',
      scan_interval: '5m',
    });

    const opportunities = [
      { symbol: 'BTCUSDT', direction: 'long', score: 90 },
    ];

    // Mark strategy as paused
    mockSessionState.isStrategyPaused.mockReturnValue(true);

    await executionService.processEntries(opportunities, config, 'Momentum Strategy');

    // Signal engine checkEntry should NOT be called for paused strategy
    expect(mockSignalEngine.checkEntry).not.toHaveBeenCalled();
    expect(mockOrderManager.enter).not.toHaveBeenCalled();
  });

  it('2. should execute signal evaluation when strategy is active (not paused)', async () => {
    const config = Object.assign(new SessionConfig(), {
      paper_mode: true,
      strategy_label: 'Momentum Strategy',
      scan_interval: '5m',
    });

    const opportunities = [
      { symbol: 'BTCUSDT', direction: 'long', score: 90 },
    ];

    // Strategy is active
    mockSessionState.isStrategyPaused.mockReturnValue(false);
    mockSignalEngine.checkEntry.mockReturnValue({
      allFired: true,
      firedSignals: ['momentum_pct'],
      reason: 'All fired',
    });

    await executionService.processEntries(opportunities, config, 'Momentum Strategy');

    // Signal engine checkEntry SHOULD be called
    expect(mockSignalEngine.checkEntry).toHaveBeenCalledWith(
      'BTCUSDT',
      expect.anything(),
      '5m',
      'LONG',
      'entry',
      true,
    );
  });

  it('3. should continue exit monitoring & SL ratcheting for active trade even if strategy is paused', async () => {
    const config = Object.assign(new SessionConfig(), {
      paper_mode: true,
      strategy_label: 'Momentum Strategy',
      scan_interval: '5m',
    });

    const mockTrade: Partial<Trade> = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 100,
      current_sl: 95,
      strategy_label: 'Momentum Strategy',
    };

    mockPositionTracker.activeCount.mockReturnValue(1);
    mockPositionTracker.activeList.mockReturnValue([mockTrade]);
    mockSessionState.isStrategyPaused.mockReturnValue(true); // Strategy is paused

    await executionService.checkExits(config);

    // Active trade checks MUST still execute for capital safety
    expect(mockPositionTracker.checkKnifeTrailingStop).toHaveBeenCalledWith('BTCUSDT', 100, expect.anything());
    expect(mockPositionTracker.checkRrSequenceAdjustments).toHaveBeenCalledWith('BTCUSDT', 100, expect.anything());
    expect(mockPositionTracker.checkTrailingStop).toHaveBeenCalledWith('BTCUSDT', 100, expect.anything());
    expect(mockPositionTracker.checkExitConditions).toHaveBeenCalledWith('BTCUSDT', 100, expect.anything(), '5m');
  });
});
