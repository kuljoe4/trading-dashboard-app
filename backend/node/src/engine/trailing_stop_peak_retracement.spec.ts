import { PositionTrackerService } from './positionTracker';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('Trailing Stop Peak Retracement & Latching Tests', () => {
  let service: PositionTrackerService;
  let mockRiskEngine: any;
  let mockSignalEngine: any;
  let mockOrderManager: any;
  let mockTickerCache: any;
  let mockKlineStore: any;
  let mockSessionState: any;
  let mockEventEmitter: any;

  beforeEach(() => {
    mockRiskEngine = { computeSl: jest.fn() };
    mockSignalEngine = { checkEntry: jest.fn() };
    mockOrderManager = {
      updateStopLoss: jest.fn().mockImplementation((trade, newSl) => Promise.resolve({ success: true, price: newSl })),
      cancelBinanceOrder: jest.fn().mockResolvedValue(true),
      checkExitSignals: jest.fn().mockReturnValue({ exitTriggered: false }),
      applyFilters: jest.fn().mockImplementation((symbol, price) => ({ price, qty: 1 })),
      isRatcheting: jest.fn().mockReturnValue(false),
    };
    mockTickerCache = { getPrice: jest.fn() };
    mockKlineStore = {};
    mockSessionState = {
      setActiveTrades: jest.fn(),
      isBanned: jest.fn().mockReturnValue(false),
      isRateLimited: jest.fn().mockReturnValue(false),
      hasOrderCapacity: jest.fn().mockReturnValue(true),
    };
    mockEventEmitter = { emit: jest.fn() };

    service = new PositionTrackerService(
      mockRiskEngine,
      mockSignalEngine,
      mockOrderManager,
      mockTickerCache,
      mockKlineStore,
      mockSessionState,
      mockEventEmitter,
    );
  });

  it('triggers immediate exit when a trade peaking at 13R with 0.2R trail drops to 9R', async () => {
    const trade = new Trade();
    trade.symbol = 'BTCUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.initial_sl = 90; // Risk = 10 USDT (1R)
    trade.current_sl = 90;
    trade.qty = 1;
    trade.status = 'OPEN';
    trade.max_rr_achieved = 0;

    service.addTrade(trade);

    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_type: 'rr',
      trailing_stop_rr: 0.2, // Trail by 0.2R ($2.00)
      paper_mode: true,
    } as any;

    // 1. Price surges to 13R ($230.00: 100 + 13*10)
    mockTickerCache.getPrice.mockReturnValue(230);
    await service.checkTrailingStop('BTCUSDT', 230, config);

    expect(trade.max_rr_achieved).toBeCloseTo(13.0, 2);
    // Trailing SL set to 230 - 0.2*10 = 228.00 (12.8R)
    expect(trade.current_sl).toBeCloseTo(228.00, 2);

    // 2. Price drops to 9R ($190.00)
    mockTickerCache.getPrice.mockReturnValue(190);
    await service.checkTrailingStop('BTCUSDT', 190, config);

    // SL should remain at 228.00 (peak level breached)
    expect(trade.current_sl).toBeGreaterThanOrEqual(228.00);

    // 3. checkExitConditions should evaluate SL hit at 190 <= 228.00
    const exitRes = service.checkExitConditions('BTCUSDT', 190, config);
    expect(exitRes).not.toBeNull();
    expect(exitRes?.exitOccurred).toBe(true);
    expect(exitRes?.exitType).toBe('CLOSED_SL');
  });

  it('enables trailing stop when sl_type is trailing even if trailing_stop_enabled is omitted', async () => {
    const trade = new Trade();
    trade.symbol = 'ETHUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 1000;
    trade.initial_sl = 900; // Risk = 100
    trade.current_sl = 900;
    trade.qty = 1;
    trade.status = 'OPEN';

    service.addTrade(trade);

    const config: SessionConfig = {
      sl_type: 'trailing', // Selected as SL strategy
      trailing_stop_type: 'rr',
      trailing_stop_rr: 0.5, // 0.5R = 50
      paper_mode: true,
    } as any;

    mockTickerCache.getPrice.mockReturnValue(1200); // 2R profit
    await service.checkTrailingStop('ETHUSDT', 1200, config);

    // Peak = 1200, trail 50 -> SL should ratchet to 1150
    expect(trade.current_sl).toBeCloseTo(1150, 2);
  });

  it('maintains trailing activation latched when price retraces below activation_rr', async () => {
    const trade = new Trade();
    trade.symbol = 'SOLUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.initial_sl = 90; // Risk = 10
    trade.current_sl = 90;
    trade.qty = 1;
    trade.status = 'OPEN';
    trade.max_rr_achieved = 2.0; // Peak price was 120 (2.0R profit)

    service.addTrade(trade);

    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_type: 'rr',
      trailing_stop_rr: 1.0, // 1.0R trail
      trailing_activation_rr: 3.0, // Requires 3.0R before activating
      paper_mode: true,
    } as any;

    // Price reaches 2R (120, below activation threshold 3R)
    mockTickerCache.getPrice.mockReturnValue(120);
    await service.checkTrailingStop('SOLUSDT', 120, config);
    expect(trade.current_sl).toBe(90); // Not activated yet

    // Price reaches 5R (150, above activation threshold 3R)
    mockTickerCache.getPrice.mockReturnValue(150);
    await service.checkTrailingStop('SOLUSDT', 150, config);
    expect(trade.current_sl).toBeCloseTo(140, 2); // Activated! Peak 150 - 10 = 140

    // Price drops to 2.5R (125), below activation threshold 3.0R
    mockTickerCache.getPrice.mockReturnValue(125);
    await service.checkTrailingStop('SOLUSDT', 125, config);

    // Activation remains latched; SL at 140 is breached so exit conditions trigger
    const exitRes = service.checkExitConditions('SOLUSDT', 125, config);
    expect(exitRes?.exitOccurred).toBe(true);
  });

  it('correctly ratchets and exits short positions on peak retracement', async () => {
    const trade = new Trade();
    trade.symbol = 'BNBUSDT';
    trade.direction = 'SHORT';
    trade.entry_price = 1000;
    trade.initial_sl = 1050; // Risk = 50
    trade.current_sl = 1050;
    trade.qty = 1;
    trade.status = 'OPEN';

    service.addTrade(trade);

    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_type: 'rr',
      trailing_stop_rr: 0.2, // 0.2R = 10
      paper_mode: true,
    } as any;

    // Price drops to 1000 - 13*50 = 350 (13R)
    mockTickerCache.getPrice.mockReturnValue(350);
    await service.checkTrailingStop('BNBUSDT', 350, config);

    // Trailing SL = 350 + 0.2*50 = 360
    expect(trade.current_sl).toBeCloseTo(360, 2);

    // Price retraces up to 550 (9R profit)
    mockTickerCache.getPrice.mockReturnValue(550);
    await service.checkTrailingStop('BNBUSDT', 550, config);

    const exitRes = service.checkExitConditions('BNBUSDT', 550, config);
    expect(exitRes?.exitOccurred).toBe(true);
    expect(exitRes?.exitType).toBe('CLOSED_SL');
  });

  it('does not mutate current_sl in live mode when trailing SL is breached', async () => {
    const trade = new Trade();
    trade.symbol = 'LIVEUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.initial_sl = 90;
    trade.current_sl = 90;
    trade.qty = 1;
    trade.status = 'OPEN';
    trade.max_rr_achieved = 2.0; // Peak price was 120 (2.0R profit)

    service.addTrade(trade);
    trade.max_rr_achieved = 2.0; // Ensure peak R:R is latched at 2.0R

    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_type: 'rr',
      trailing_stop_rr: 1.0, // Trail by 1.0R ($10.00)
      paper_mode: false, // Live mode
    } as any;

    // Peak = 120, prospective SL = 110. Price drops to 105 (breaches prospective SL 110)
    mockTickerCache.getPrice.mockReturnValue(105);
    await service.checkTrailingStop('LIVEUSDT', 105, config);

    // In live mode, current_sl must remain unchanged (90) to avoid phantom state corruption
    expect(trade.current_sl).toBe(90);
  });

  it('does not mutate current_sl in live mode when knife trailing SL is breached', async () => {
    const trade = new Trade();
    trade.symbol = 'KNIFELIVEUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.initial_sl = 90;
    trade.current_sl = 90;
    trade.qty = 1;
    trade.status = 'OPEN';
    trade.is_knife = true;

    service.addTrade(trade);

    const config: SessionConfig = {
      knife_trailing_enabled: true,
      knife_trailing_distance_pct: 1.0, // 1% distance
      paper_mode: false, // Live mode
    } as any;

    // Price drops below prospective trailing SL
    mockTickerCache.getPrice.mockReturnValue(95);
    await service.checkKnifeTrailingStop('KNIFELIVEUSDT', 95, config);

    // In live mode, current_sl must remain unchanged (90)
    expect(trade.current_sl).toBe(90);
  });
});
