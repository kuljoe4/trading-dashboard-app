import { PositionTrackerService } from './positionTracker';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Trailing Activation R:R Threshold Tests', () => {
  let positionTracker: PositionTrackerService;
  let mockOrderManager: any;
  let mockEventEmitter: any;
  let mockSessionState: any;

  beforeEach(() => {
    mockOrderManager = {
      applyFilters: jest.fn().mockImplementation((sym, price, qty) => ({ price, qty })),
      isRatcheting: jest.fn().mockReturnValue(false),
      updateStopLoss: jest.fn().mockResolvedValue({ success: true, price: 99.5 }),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    mockSessionState = {
      config: {
        trailing_stop_enabled: true,
        trailing_stop_distance_pct: 1.0,
        trailing_activation_rr: 1.0, // Requires 1.0 R:R before trailing activates
      },
      updateRateLimit: jest.fn(),
    };

    positionTracker = new PositionTrackerService(
      {} as any, // riskEngine
      {} as any, // signalEngine
      mockOrderManager,
      {} as any, // tickerCache
      {} as any, // klineStore
      mockSessionState,
      mockEventEmitter,
    );
  });

  it('does not trigger trailing stop update if live R:R is below trailing_activation_rr', async () => {
    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_distance_pct: 1.0,
      trailing_activation_rr: 1.0,
      paper_mode: false,
    } as any;

    const trade: Trade = {
      id: 't1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 100,
      initial_sl: 90, // Risk = 10 USDT
      current_sl: 90,
      status: 'OPEN',
      qty: 1,
      risk_usdt: 10,
    } as any;

    (positionTracker as any).trades.set('BTCUSDT', trade);

    // Current price 105 -> Reward = 5, Risk = 10 -> liveRR = 0.5 < 1.0 activation RR
    await positionTracker.checkTrailingStop('BTCUSDT', 105, config);

    expect(mockOrderManager.updateStopLoss).not.toHaveBeenCalled();
  });

  it('triggers trailing stop update once live R:R reaches or exceeds trailing_activation_rr', async () => {
    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_distance_pct: 1.0,
      trailing_activation_rr: 1.0,
      paper_mode: false,
    } as any;

    const trade: Trade = {
      id: 't2',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 100,
      initial_sl: 90, // Risk = 10 USDT
      current_sl: 90,
      status: 'OPEN',
      qty: 1,
      risk_usdt: 10,
    } as any;

    (positionTracker as any).trades.set('BTCUSDT', trade);

    // Current price 112 -> Reward = 12, Risk = 10 -> liveRR = 1.2 >= 1.0 activation RR
    // Trailing distance 1% of entry (100) = 1.0
    // Prospective SL = 112 - 1.0 = 111
    await positionTracker.checkTrailingStop('BTCUSDT', 112, config);

    expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTCUSDT' }),
      expect.any(Number),
      90
    );
  });

  it('does not trigger premature TRAILING_STOP loss tighter than initial_sl when trailing_activation_rr is 0 and trade has zero profit', async () => {
    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_type: 'pct',
      trailing_stop_distance_pct: 0.5, // tighter than 0.79% initial_sl
      trailing_activation_rr: 0,
      paper_mode: true,
    } as any;

    const trade: Trade = {
      id: 't-bulla',
      symbol: 'BULLAUSDT',
      direction: 'SHORT',
      entry_price: 0.03289,
      initial_sl: 0.03315, // 0.79% stop loss
      current_sl: 0.03315,
      status: 'OPEN',
      qty: 759734,
      risk_usdt: 197.53,
      max_rr_achieved: 0,
    } as any;

    (positionTracker as any).trades.set('BULLAUSDT', trade);
    mockOrderManager.applyFilters = jest.fn().mockImplementation((_sym, price, qty) => ({
      price: Math.ceil(price * 100000) / 100000,
      qty,
    }));

    // Price immediately moves against SHORT to 0.03306 (-0.65R, peakRr === 0)
    await positionTracker.checkTrailingStop('BULLAUSDT', 0.03306, config);

    expect(trade.current_sl).toBe(0.03315);
    const closeEmits = mockEventEmitter.emit.mock.calls.filter((c: any[]) => c[0] === 'exchange.close');
    expect(closeEmits.length).toBe(0);
  });

  it('does not cut inside initial_sl loss zone on tiny favorable noise when trailing_activation_rr is 0, and activates once prospective SL reaches breakeven', async () => {
    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_type: 'pct',
      trailing_stop_distance_pct: 0.5,
      trailing_activation_rr: 0,
      trailing_guard_buffer_pct: 0.05,
      paper_mode: true,
    } as any;

    const trade: Trade = {
      id: 't-be-guard',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      entry_price: 100,
      initial_sl: 98, // 2% initial SL
      current_sl: 98,
      status: 'OPEN',
      qty: 1,
      risk_usdt: 2,
      max_rr_achieved: 0,
    } as any;

    (positionTracker as any).trades.set('ETHUSDT', trade);

    // Tiny favorable blip (+0.2% -> peak 100.2, prospective SL 100.2 * 0.995 = 99.699 < entry 100)
    await positionTracker.checkTrailingStop('ETHUSDT', 100.2, config);
    expect(trade.current_sl).toBe(98);

    // Price reverses to 99.5: must NOT close prematurely at -0.25R
    await positionTracker.checkTrailingStop('ETHUSDT', 99.5, config);
    expect(trade.current_sl).toBe(98);
    expect(mockEventEmitter.emit.mock.calls.filter((c: any[]) => c[0] === 'exchange.close').length).toBe(0);

    // Price rallies to 101 (+0.5R, prospective SL 101 * 0.995 = 100.495 >= entry 100) -> engages cleanly at profit
    await positionTracker.checkTrailingStop('ETHUSDT', 101, config);
    expect(trade.current_sl).toBeGreaterThanOrEqual(100);
  });
});
