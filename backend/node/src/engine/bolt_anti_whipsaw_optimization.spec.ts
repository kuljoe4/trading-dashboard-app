import { ExecutionService } from './execution.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Bolt Optimization: Anti-Whipsaw Performance & Correctness', () => {
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
        { time: 5000, close: 101, open: 100, high: 102, low: 99, volume: 1500, isCompleted: true },
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
    broadcastService = { broadcast: jest.fn() };
    monitoringService = { setLoopStage: jest.fn() };
    engineBroadcaster = { serializeTrade: jest.fn() };
    eventEmitter = { emit: jest.fn() };
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

  it('should correctly block entries using numeric timestamps and Date objects', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    // Current candle starts at 5000 ms
    const trade1 = new Trade();
    trade1.symbol = 'BTCUSDT';
    trade1.entry_ts = new Date(5200); // Date object in current candle
    sessionState.closedTrades = [trade1];

    const opportunities = [{ symbol: 'BTCUSDT', direction: 'LONG', score: 1 }];

    await executionService.processEntries(opportunities, config, 'TestStrategy');
    expect(orderManager.enter).not.toHaveBeenCalled();

    // Reset and test numeric timestamp
    orderManager.enter.mockClear();
    trade1.entry_ts = 5200 as any; // Numeric timestamp
    await executionService.processEntries(opportunities, config, 'TestStrategy');
    expect(orderManager.enter).not.toHaveBeenCalled();
  });

  it('benchmark: anti-whipsaw loop execution time across scanner opportunities', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    // Generate 500 closed trades
    const closedTrades: Trade[] = [];
    for (let i = 0; i < 500; i++) {
      const t = new Trade();
      t.symbol = `SYM_${i % 50}`;
      t.entry_ts = new Date(1000 + i); // All prior to current candle (5000)
      closedTrades.push(t);
    }
    sessionState.closedTrades = closedTrades;

    // Create 100 opportunities
    const opportunities = [];
    for (let i = 0; i < 100; i++) {
      opportunities.push({ symbol: `SYM_${i % 50}`, direction: 'LONG', score: 1 });
    }

    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await executionService.processEntries(opportunities, config, 'BenchmarkStrategy');
    }
    const end = performance.now();
    const duration = end - start;

    console.log(`[BENCHMARK] processEntries anti-whipsaw check (${iterations} scanner passes, 100 opps x 500 trades): ${duration.toFixed(2)}ms`);
    console.log(`[BENCHMARK] Average time per scanner pass: ${(duration / iterations).toFixed(4)}ms`);
  });
});
