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
      {
        resolveInterval: jest.fn().mockImplementation((val) => val || "1m"),
        getSymbolFilters: jest.fn().mockReturnValue({ filters: [] })
      } as any,
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

  it('should NOT block entry when a trade record for the symbol has ENTRY_FAILED or CANCELLED status (false positive fix)', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.paper_mode = true;

    // A failed entry attempt for DOODUSDT recorded during the active candle
    const failedTrade = new Trade();
    failedTrade.symbol = 'DOODUSDT';
    failedTrade.status = 'ENTRY_FAILED';
    failedTrade.entry_ts = new Date(2100);

    const cancelledTrade = new Trade();
    cancelledTrade.symbol = 'DOODUSDT';
    cancelledTrade.status = 'CANCELLED';
    cancelledTrade.entry_ts = new Date(2150);

    sessionState.closedTrades = [failedTrade, cancelledTrade];

    const opportunities = [{ symbol: 'DOODUSDT', direction: 'LONG', score: 1 }];

    await executionService.processEntries(opportunities, config, 'MyStrategy');

    // Should allow entry because neither failed nor cancelled attempts are valid traded positions
    expect(orderManager.enter).toHaveBeenCalledWith(
      expect.anything(),
      'DOODUSDT',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('should exclude macro confirming timeframes (e.g. 1d) from anti-whipsaw gating by default', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1h';
    config.enabled_signals = ['ema_dual'];
    config.signal_timeframes = { ema_dual: '1d' };
    config.paper_mode = true;

    // Closed trade entered earlier today on ERAUSDT
    const closedTrade = new Trade();
    closedTrade.symbol = 'ERAUSDT';
    closedTrade.entry_ts = new Date(Date.now() - 3600 * 1000 * 3); // 3 hours ago (same 1d candle)
    closedTrade.exit_ts = new Date(Date.now() - 3600 * 1000 * 2);
    sessionState.closedTrades = [closedTrade];

    const opportunities = [{ symbol: 'ERAUSDT', direction: 'LONG', score: 1 }];

    // Keep the fixture timestamps in the same range as the Date-based trade
    // timestamps so the 1h scan candle does not appear to be from epoch 1970.
    const now = Date.now();
    klineStore.getRawCandles.mockReturnValue([
      { time: now - 2 * 60 * 60 * 1000, close: 100, open: 100, high: 100, low: 100, volume: 1000, isCompleted: true },
      { time: now - 60 * 60 * 1000, close: 101, open: 100, high: 102, low: 99, volume: 1500, isCompleted: true },
    ]);

    await executionService.processEntries(opportunities, config, 'MacroConfirmStrategy');

    // Should ALLOW entry because 1d confirming timeframe is capped out by anti_whipsaw_max_tf ('4h')
    expect(orderManager.enter).toHaveBeenCalledWith(
      expect.anything(),
      'ERAUSDT',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('should respect explicit anti_whipsaw_timeframes setting when specified', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1m';
    config.enabled_signals = ['ema_dual'];
    config.signal_timeframes = { ema_dual: '1h' };
    config.anti_whipsaw_timeframes = ['1h'];
    config.paper_mode = true;

    // Trade closed 10 minutes ago (same 1h candle)
    const closedTrade = new Trade();
    closedTrade.symbol = 'ERAUSDT';
    closedTrade.entry_ts = new Date(Date.now() - 600 * 1000);
    sessionState.closedTrades = [closedTrade];

    const opportunities = [{ symbol: 'ERAUSDT', direction: 'LONG', score: 1 }];

    await executionService.processEntries(opportunities, config, 'ExplicitTfStrategy');

    // Should BLOCK entry because 1h is explicitly specified in anti_whipsaw_timeframes
    expect(orderManager.enter).not.toHaveBeenCalled();
  });

  it('should honor variant-level anti-whipsaw timeframes & delays when evaluating variant opportunities', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1h';
    config.anti_whipsaw_candle_delay = 1;
    config.anti_whipsaw_tf_delay_min = 60; // Base has strict 60m delay
    config.anti_whipsaw_timeframes = ['1h'];
    config.paper_mode = true;
    config.strategy_variants = [
      {
        strategy_label: 'Fast Variant',
        scan_interval: '5m',
        anti_whipsaw_candle_delay: 0,
        anti_whipsaw_tf_delay_min: 5, // Variant allows entry after 5m
        anti_whipsaw_timeframes: ['5m'],
      } as any,
    ];

    const now = Date.now();
    // Closed trade 10 minutes ago under Fast Variant
    const closedTrade = new Trade();
    closedTrade.symbol = 'LINKUSDT';
    closedTrade.strategy_label = 'Fast Variant';
    closedTrade.entry_ts = new Date(now - 12 * 60 * 1000);
    closedTrade.exit_ts = new Date(now - 10 * 60 * 1000);
    sessionState.closedTrades = [closedTrade];

    klineStore.getRawCandles.mockReturnValue([
      { time: now - 10 * 60 * 1000, close: 100, open: 100, high: 100, low: 100, volume: 1000, isCompleted: true },
      { time: Math.floor(now / (5 * 60 * 1000)) * (5 * 60 * 1000), close: 101, open: 100, high: 102, low: 99, volume: 1500, isCompleted: true },
    ]);

    const opportunities = [{ symbol: 'LINKUSDT', direction: 'LONG', score: 1, strategy_label: 'Fast Variant' }];
    await executionService.processEntries(opportunities, config, 'Base Strategy');

    // 10m > variant's 5m tfDelayMin & candleDelay=0 -> allowed even though base had 60m/1h
    expect(orderManager.enter).toHaveBeenCalled();
  });

  it('should not lock a 1h strategy for 60m after candle close when candle_delay=1 and tf_delay_min=0', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1h';
    config.anti_whipsaw_candle_delay = 1;
    config.anti_whipsaw_tf_delay_min = 0;
    config.anti_whipsaw_timeframes = ['1h'];
    config.paper_mode = true;

    const hourMs = 60 * 60 * 1000;
    const currentHourStart = Math.floor(Date.now() / hourMs) * hourMs;

    // Trade entered and exited in the PREVIOUS 1h candle (2 minutes before candle rollover)
    const closedTrade = new Trade();
    closedTrade.symbol = 'LINKUSDT';
    closedTrade.entry_ts = new Date(currentHourStart - 10 * 60 * 1000);
    closedTrade.exit_ts = new Date(currentHourStart - 2 * 60 * 1000);
    sessionState.closedTrades = [closedTrade];

    klineStore.getRawCandles.mockReturnValue([
      { time: currentHourStart - hourMs, close: 100, open: 100, high: 100, low: 100, volume: 1000, isCompleted: true },
      { time: currentHourStart, close: 101, open: 100, high: 102, low: 99, volume: 1500, isCompleted: true },
    ]);

    const opportunities = [{ symbol: 'LINKUSDT', direction: 'LONG', score: 1 }];
    await executionService.processEntries(opportunities, config, 'HourlyStrat');

    // New 1h candle has opened and tf_delay_min is 0, so entry is allowed immediately
    expect(orderManager.enter).toHaveBeenCalled();
  });

  it('should bypass anti-whipsaw when both candle_delay=0 and tf_delay_min=0', async () => {
    const config = new SessionConfig();
    config.scan_interval = '15m';
    config.anti_whipsaw_candle_delay = 0;
    config.anti_whipsaw_tf_delay_min = 0;
    config.paper_mode = true;

    const now = Date.now();
    const closedTrade = new Trade();
    closedTrade.symbol = 'SUIUSDT';
    closedTrade.entry_ts = new Date(now - 60 * 1000);
    closedTrade.exit_ts = new Date(now - 10 * 1000);
    sessionState.closedTrades = [closedTrade];

    const opportunities = [{ symbol: 'SUIUSDT', direction: 'LONG', score: 1 }];
    await executionService.processEntries(opportunities, config, 'NoCooldownStrat');

    expect(orderManager.enter).toHaveBeenCalled();
  });

  it('should isolate closed trades by strategy when anti_whipsaw_per_strategy is enabled', async () => {
    const config = new SessionConfig();
    config.scan_interval = '1h';
    config.anti_whipsaw_candle_delay = 1;
    config.anti_whipsaw_per_strategy = true;
    config.paper_mode = true;
    config.strategy_variants = [
      {
        strategy_label: 'Variant B',
        scan_interval: '5m',
        anti_whipsaw_candle_delay: 1,
        anti_whipsaw_per_strategy: true,
      } as any,
    ];

    const now = Date.now();
    const closedTrade = new Trade();
    closedTrade.symbol = 'ADAUSDT';
    closedTrade.strategy_label = 'Base Strategy';
    closedTrade.entry_ts = new Date(now - 30 * 1000);
    closedTrade.exit_ts = new Date(now - 10 * 1000);
    sessionState.closedTrades = [closedTrade];

    const opportunities = [{ symbol: 'ADAUSDT', direction: 'LONG', score: 1, strategy_label: 'Variant B' }];
    await executionService.processEntries(opportunities, config, 'Base Strategy');

    expect(orderManager.enter).toHaveBeenCalled();
  });
});

