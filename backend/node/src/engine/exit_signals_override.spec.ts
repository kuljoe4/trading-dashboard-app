import { PositionTrackerService } from './positionTracker';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Exit Signals Override & Total Estimated PnL', () => {
  let positionTracker: PositionTrackerService;
  let mockRiskEngine: any;
  let mockSignalEngine: any;
  let mockOrderManager: any;
  let mockTickerCache: any;
  let mockKlineStore: any;
  let mockEventEmitter: any;

  beforeEach(() => {
    mockRiskEngine = {};
    mockSignalEngine = {};
    mockOrderManager = {
      checkExitSignals: jest.fn().mockReturnValue({ exitTriggered: false }),
      cancelBinanceOrder: jest.fn().mockResolvedValue(true),
      applyFilters: jest.fn((sym, val, qty) => ({ price: val, qty })),
      isRatcheting: jest.fn().mockReturnValue(false),
    };
    mockTickerCache = {
      getPrice: jest.fn().mockReturnValue(110),
      getTicker: jest.fn().mockReturnValue({ lastPrice: 110 }),
    };
    mockKlineStore = {};
    mockEventEmitter = {
      emit: jest.fn(),
    };

    positionTracker = new PositionTrackerService(
      mockRiskEngine,
      mockSignalEngine,
      mockOrderManager,
      mockTickerCache,
      mockKlineStore,
      {
        setActiveTrades: jest.fn(),
      } as any,
      mockEventEmitter
    );
  });

  it('should correctly identify when exit signal override is active', () => {
    const config = new SessionConfig();
    config.exit_signals_override_ratchet = true;

    const trade = new Trade();
    trade.symbol = 'BTCUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.initial_sl = 90;
    trade.current_sl = 95;
    trade.qty = 1;
    trade.exit_signals_status = {
      ema_close: {
        fired: false,
        active: true,
        remaining_delay: 300,
        label: 'EMA Close',
        value: 110,
        threshold: 105, // target price at 105 (positive target P&L of +5)
        unit: 'price',
        threshold_is_price: true,
      } as any
    };

    // Current price is 110, current P&L is +10.
    // Exit target is 105, signal target P&L is +5.
    // 10 > 5, so override should be active!
    const active = positionTracker.isExitSignalOverrideActive(trade, config);
    expect(active).toBe(true);
  });

  it('should return false if current P&L is less than exit signal target P&L', () => {
    const config = new SessionConfig();
    config.exit_signals_override_ratchet = true;

    const trade = new Trade();
    trade.symbol = 'BTCUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.initial_sl = 90;
    trade.qty = 1;
    trade.exit_signals_status = {
      ema_close: {
        fired: false,
        active: true,
        remaining_delay: 300,
        label: 'EMA Close',
        value: 102,
        threshold: 108, // target price at 108 (positive target P&L of +8)
        unit: 'price',
        threshold_is_price: true,
      } as any
    };

    // Current price is 105 (current P&L is +5)
    // 5 is less than 8, so override should be false!
    jest.spyOn(mockTickerCache, 'getPrice').mockReturnValue(105);

    const active = positionTracker.isExitSignalOverrideActive(trade, config);
    expect(active).toBe(false);
  });

  it('should remove stop loss and bypass ratcheting when override is active', async () => {
    const config = new SessionConfig();
    config.exit_signals_override_ratchet = true;
    config.paper_mode = false;

    const trade = new Trade();
    trade.symbol = 'BTCUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.initial_sl = 90;
    trade.current_sl = 95;
    trade.qty = 1;
    trade.binance_stop_order_id = 'order-123';
    trade.exit_signals_status = {
      ema_close: {
        fired: false,
        active: true,
        remaining_delay: 300,
        label: 'EMA Close',
        value: 110,
        threshold: 105,
        unit: 'price',
        threshold_is_price: true,
      } as any
    };

    positionTracker['trades'].set(trade.symbol, trade);

    await positionTracker.checkRrSequenceAdjustments(trade.symbol, 110, config);

    // Stop loss should have been removed locally and orderManager.cancelBinanceOrder called
    expect(trade.current_sl).toBe(0);
    expect(trade.binance_stop_order_id).toBeUndefined();
    expect(mockOrderManager.cancelBinanceOrder).toHaveBeenCalledWith('BTCUSDT', 'order-123', 'standard');
  });
});
