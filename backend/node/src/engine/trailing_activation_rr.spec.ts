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
});
