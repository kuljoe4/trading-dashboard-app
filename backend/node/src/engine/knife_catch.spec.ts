import { SignalEngineService } from './signalEngine';
import { PositionTrackerService } from './positionTracker';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('Knife Catch Signal & Dynamic Auto-Ratchet Engine Tests', () => {
  let signalEngine: SignalEngineService;
  let positionTracker: PositionTrackerService;
  let klineStore: any;
  let orderManager: any;
  let tickerCache: any;
  let sessionState: any;
  let eventEmitter: any;

  beforeEach(() => {
    klineStore = {
      getRawCandles: jest.fn().mockReturnValue([
        { open: 100, high: 102, low: 95, close: 101, volume: 1000 },
        { open: 101, high: 103, low: 96, close: 102, volume: 1100 },
        { open: 102, high: 108, low: 94, close: 107, volume: 1500 }, // 4.9% ROC, lower wick = 8% of 14 range = 57% wick
      ]),
      getMaxCandles: jest.fn().mockReturnValue(200),
    };

    tickerCache = {
      getPrice: jest.fn().mockReturnValue(107),
    };

    orderManager = {
      applyFilters: jest.fn((sym, price) => ({ price, qty: 1 })),
      isRatcheting: jest.fn().mockReturnValue(false),
      updateStopLoss: jest.fn().mockResolvedValue({ success: true, price: 102 }),
    };

    sessionState = {
      setActiveTrades: jest.fn(),
      config: new SessionConfig(),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    signalEngine = new SignalEngineService(klineStore as any);
    positionTracker = new PositionTrackerService(
      { canEnter: jest.fn() } as any,
      signalEngine,
      orderManager as any,
      tickerCache as any,
      klineStore as any,
      sessionState as any,
      eventEmitter as any,
    );
  });

  it('should detect knife catch velocity burst and wick rejection', () => {
    const config = new SessionConfig();
    config.signal_params = {
      knife_roc_threshold: 2.0,
      knife_wick_pct: 30.0,
      knife_lookback: 2,
    };

    const result = signalEngine.knifeCatchSignal('BTCUSDT', config, '1m', 'LONG', 'entry');
    const fired = typeof result === 'boolean' ? result : result.fired;

    expect(fired).toBe(true);
  });

  it('should auto-ratchet stop loss to breakeven or locked profit on knife trades crossing RR thresholds', async () => {
    const config = new SessionConfig();
    config.knife_trailing_enabled = true;
    config.knife_auto_ratchet_be_rr = 0.5;
    config.knife_auto_ratchet_lock_rr = 1.0;
    config.knife_trailing_distance_pct = 1.0;

    const trade = new Trade();
    trade.symbol = 'BTCUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.initial_sl = 95; // Risk = 5
    trade.current_sl = 95;
    trade.qty = 1;
    trade.status = 'OPEN';
    trade.is_knife = true;

    positionTracker.addTrade(trade);

    // Current price = 107 -> reward = 7 -> live RR = 1.4R (crosses lock_rr = 1.0R -> locks 0.5R = 102.5 SL)
    await positionTracker.checkKnifeTrailingStop('BTCUSDT', 107, config);

    expect(orderManager.updateStopLoss).toHaveBeenCalled();
  });
});
