import { ExecutionService } from './execution.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Anti-Whipsaw Protection Unit Tests', () => {
  let executionService: ExecutionService;
  let tickerCache: any;
  let klineStore: any;
  let signalEngine: any;
  let riskEngine: any;
  let positionTracker: any;
  let orderManager: any;
  let sessionState: any;
  let gatingService: any;
  let broadcastService: any;
  let monitoringService: any;
  let engineBroadcaster: any;
  let eventEmitter: any;
  let analyticsService: any;

  beforeEach(() => {
    tickerCache = {
      getPrice: jest.fn().mockReturnValue(100),
      getTicker: jest.fn().mockReturnValue({ open_24h: 100 }),
    };

    klineStore = {
      getRawCandles: jest.fn().mockReturnValue([
        { time: 1000, close: 100, open: 100, high: 100, low: 100, volume: 1000, isCompleted: true },
        { time: 2000, close: 101, open: 100, high: 102, low: 99, volume: 1500, isCompleted: true },
      ]),
      getLookbackExtremes: jest.fn().mockReturnValue({ minLow: 98, maxHigh: 105 }),
    };

    signalEngine = {
      checkEntry: jest.fn().mockReturnValue({ allFired: true, reason: 'Fired', details: {} }),
    };

    riskEngine = {
      computeSl: jest.fn().mockReturnValue({ slPrice: 95, rejected: false }),
      computePositionSize: jest.fn().mockReturnValue({ qty: 1, rejected: false }),
      computeTp: jest.fn().mockReturnValue(110),
      canEnter: jest.fn().mockReturnValue({ canEnter: true }),
    };

    positionTracker = {
      activeCount: jest.fn().mockReturnValue(0),
      activeList: jest.fn().mockReturnValue([]),
      enteringCount: jest.fn().mockReturnValue(0),
      hasSymbol: jest.fn().mockReturnValue(false),
      totalRisk: jest.fn().mockReturnValue(0),
      setEntering: jest.fn(),
      addTrade: jest.fn(),
    };

    orderManager = {
      applyFilters: jest.fn((sym, price) => ({ price, qty: 1 })),
      enter: jest.fn().mockResolvedValue({ status: 'SUCCESS', data: {} }),
    };

    sessionState = {
      isBanned: jest.fn().mockReturnValue(false),
      getBalance: jest.fn().mockReturnValue(1000),
      realTimePositions: new Map(),
      closedTrades: [],
      entryInProgress: false,
      updateStatsOnEntry: jest.fn(),
      setActiveTrades: jest.fn(),
    };

    gatingService = {};
    broadcastService = {
      broadcast: jest.fn(),
    };
    monitoringService = {
      setLoopStage: jest.fn(),
    };
    engineBroadcaster = {
      serializeTrade: jest.fn(),
    };
    eventEmitter = {
      emit: jest.fn(),
    };
    analyticsService = {};

    executionService = new ExecutionService(
      tickerCache,
      klineStore,
      signalEngine,
      riskEngine,
      positionTracker,
      orderManager,
      sessionState,
      gatingService,
      broadcastService,
      monitoringService,
      engineBroadcaster,
      eventEmitter,
      analyticsService,
    );
  });

  it('should allow entry when there are no closed trades for the symbol', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    const opportunities = [{ symbol: 'BTCUSDT', direction: 'LONG', score: 1 }];

    await executionService.processEntries(opportunities, config, 'MyStrategy');

    expect(orderManager.enter).toHaveBeenCalled();
  });

  it('should allow entry when there is a closed trade but it was entered in a prior candle period', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    // Current candle starts at 2000. Closed trade was entered at 1500 (prior candle start is 1000)
    const closedTrade = new Trade();
    closedTrade.symbol = 'BTCUSDT';
    closedTrade.entry_ts = new Date(1500);
    closedTrade.exit_ts = new Date(1800);
    sessionState.closedTrades = [closedTrade];

    const opportunities = [{ symbol: 'BTCUSDT', direction: 'LONG', score: 1 }];

    await executionService.processEntries(opportunities, config, 'MyStrategy');

    expect(orderManager.enter).toHaveBeenCalled();
  });

  it('should block entry when there is a closed trade entered in the current candle period (prevent whipsawing)', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    // Current candle starts at 2000. Closed trade was entered at 2100 (same candle)
    const closedTrade = new Trade();
    closedTrade.symbol = 'BTCUSDT';
    closedTrade.entry_ts = new Date(2100);
    closedTrade.exit_ts = new Date(2200);
    sessionState.closedTrades = [closedTrade];

    const opportunities = [{ symbol: 'BTCUSDT', direction: 'LONG', score: 1 }];

    await executionService.processEntries(opportunities, config, 'MyStrategy');

    // Should NOT have called enter due to same-candle gating
    expect(orderManager.enter).not.toHaveBeenCalled();
  });

  it('should block entry when a trade was EXITED during the current candle period or within timeframe delay', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    // Current candle starts at 2000. Closed trade was entered earlier (1500) but exited at 2050 (during current candle)
    const closedTrade = new Trade();
    closedTrade.symbol = 'ARIAUSDT';
    closedTrade.entry_ts = new Date(1500);
    closedTrade.exit_ts = new Date(2050);
    sessionState.closedTrades = [closedTrade];

    const opportunities = [{ symbol: 'ARIAUSDT', direction: 'LONG', score: 1 }];

    await executionService.processEntries(opportunities, config, 'MyStrategy');

    expect(orderManager.enter).not.toHaveBeenCalled();
  });

  it('should apply anti-whipsaw protection strictly per-symbol', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    // Closed trade on ARIAUSDT in current candle period
    const closedTrade = new Trade();
    closedTrade.symbol = 'ARIAUSDT';
    closedTrade.entry_ts = new Date(2100);
    closedTrade.exit_ts = new Date(2200);
    sessionState.closedTrades = [closedTrade];

    // Evaluate BTCUSDT (different symbol)
    const opportunities = [{ symbol: 'BTCUSDT', direction: 'LONG', score: 1 }];

    await executionService.processEntries(opportunities, config, 'MyStrategy');

    // BTCUSDT should be allowed to enter
    expect(orderManager.enter).toHaveBeenCalledWith(
      expect.anything(),
      'BTCUSDT',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('should deduplicate anti-whipsaw log and alert emissions across consecutive scanner passes', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    const closedTrade = new Trade();
    closedTrade.symbol = 'ONTUSDT';
    closedTrade.entry_ts = new Date(1500);
    closedTrade.exit_ts = new Date(2050);
    sessionState.closedTrades = [closedTrade];

    const opportunities = [{ symbol: 'ONTUSDT', direction: 'LONG', score: 1 }];

    // Pass 1
    await executionService.processEntries(opportunities, config, 'MyStrategy');
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(broadcastService.broadcast).toHaveBeenCalledTimes(1);

    // Pass 2 immediately after (same gating window)
    await executionService.processEntries(opportunities, config, 'MyStrategy');
    // Call counts should remain 1 because emissions were deduplicated for this window
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(broadcastService.broadcast).toHaveBeenCalledTimes(1);
  });
});
