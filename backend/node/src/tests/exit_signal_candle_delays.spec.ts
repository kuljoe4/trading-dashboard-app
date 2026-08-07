import { OrderFilterService } from '../engine/order-filter.service';
import { OrderManagerService } from '../engine/orderManager';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('Exit Signal Candle Delays', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockTickerCache: any;

  beforeEach(() => {
    mockSignalEngine = {
      checkEntry: jest.fn(),
    };
    mockTickerCache = {
      getPrice: jest.fn().mockReturnValue(100),
      getTicker: jest.fn().mockReturnValue({ lastPrice: 100 }),
    };

    service = new OrderManagerService(
      mockSignalEngine,
      { getSymbolFilters: (symbol: string) => ({ filters: [] }) } as any,
      mockTickerCache,
      { incrementApiRequests: jest.fn() } as any, // monitoringService
      {
        getInFlightEntry: jest.fn(),
        setInFlight: jest.fn(),
        clearInFlight: jest.fn()
      } as any, // positionTracker
      {
        isRateLimited: () => false,
        isOrderRateLimited: () => false,
        isBanned: () => false,
        apiStatus: { isBanned: false, banUntil: null },
        binanceRateLimit: { used_1m: 0, limit: 2400 },
        updateRateLimit: jest.fn(),
        updateOrderRateLimits: jest.fn(),
        realTimePositions: new Map(),
        realTimeOrders: new Map(),
        config: {},
        hasOrderCapacity: () => true
      } as any, // sessionState
      { broadcast: jest.fn() } as any, // broadcastService
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as any,
      new OrderFilterService(
        { getSymbolFilters: (symbol: string) => ({ filters: [] }) } as any,
        mockTickerCache,
        { broadcast: jest.fn() } as any
      )
    );
  });

  it('should correctly process numeric exit signal delay in seconds', () => {
    const config = new SessionConfig();
    config.exit_signals = ['ema_cross'];
    config.exit_signal_delays = { ema_cross: 120 }; // 120 seconds delay

    const trade = new Trade();
    trade.symbol = 'BTCUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.qty = 1;
    // Set entry_ts to 50 seconds ago (delay not satisfied yet)
    trade.entry_ts = new Date(Date.now() - 50 * 1000);

    mockSignalEngine.checkEntry.mockReturnValue({
      firedSignals: ['ema_cross'],
      details: {
        ema_cross: { fired: true, metric: 'ema_cross', value: 1, threshold: 1, unit: '%' }
      }
    });

    // 1. Check with trade age = 50s (delay = 120s) -> should NOT be active
    let result = service.checkExitSignals('BTCUSDT', trade, config, '5m');
    expect(result.exitTriggered).toBe(false);
    expect(trade.exit_signals_status?.['ema_cross'].active).toBe(false);
    expect(trade.exit_signals_status?.['ema_cross'].remaining_delay).toBeGreaterThan(50);

    // 2. Advance trade age to 150 seconds ago -> should BE active
    trade.entry_ts = new Date(Date.now() - 150 * 1000);
    result = service.checkExitSignals('BTCUSDT', trade, config, '5m');
    expect(result.exitTriggered).toBe(true);
    expect(trade.exit_signals_status?.['ema_cross'].active).toBe(true);
    expect(trade.exit_signals_status?.['ema_cross'].remaining_delay).toBe(0);
  });

  it('should correctly process candle-based exit signal delay in minutes', () => {
    const config = new SessionConfig();
    config.exit_signals = ['ema_cross'];
    config.exit_signal_delays = { ema_cross: '2c' }; // 2 candles delay

    const trade = new Trade();
    trade.symbol = 'BTCUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.qty = 1;

    mockSignalEngine.checkEntry.mockReturnValue({
      firedSignals: ['ema_cross'],
      details: {
        ema_cross: { fired: true, metric: 'ema_cross', value: 1, threshold: 1, unit: '%' }
      }
    });

    // Case A: 5m timeframe. 2 candles = 10 minutes = 600s
    // age = 5 minutes ago (300s) -> should NOT be active
    trade.entry_ts = new Date(Date.now() - 5 * 60 * 1000);
    let result = service.checkExitSignals('BTCUSDT', trade, config, '5m');
    expect(result.exitTriggered).toBe(false);
    expect(trade.exit_signals_status?.['ema_cross'].active).toBe(false);

    // age = 12 minutes ago (720s) -> should BE active
    trade.entry_ts = new Date(Date.now() - 12 * 60 * 1000);
    result = service.checkExitSignals('BTCUSDT', trade, config, '5m');
    expect(result.exitTriggered).toBe(true);
    expect(trade.exit_signals_status?.['ema_cross'].active).toBe(true);
  });

  it('should correctly process candle-based exit signal delay in higher timeframes (days, weeks, months)', () => {
    const config = new SessionConfig();
    config.exit_signals = ['ema_cross'];
    config.exit_signal_delays = { ema_cross: '1c' }; // 1 candle delay
    config.signal_timeframes = { ema_cross: '1d' }; // 1-day timeframe

    const trade = new Trade();
    trade.symbol = 'BTCUSDT';
    trade.direction = 'LONG';
    trade.entry_price = 100;
    trade.qty = 1;

    mockSignalEngine.checkEntry.mockReturnValue({
      firedSignals: ['ema_cross'],
      details: {
        ema_cross: { fired: true, metric: 'ema_cross', value: 1, threshold: 1, unit: '%' }
      }
    });

    // Case A: 1d timeframe. 1 candle = 24 hours = 86400s
    // age = 12 hours ago -> should NOT be active
    trade.entry_ts = new Date(Date.now() - 12 * 60 * 60 * 1000);
    let result = service.checkExitSignals('BTCUSDT', trade, config, '5m');
    expect(result.exitTriggered).toBe(false);
    expect(trade.exit_signals_status?.['ema_cross'].active).toBe(false);

    // age = 26 hours ago -> should BE active
    trade.entry_ts = new Date(Date.now() - 26 * 60 * 60 * 1000);
    result = service.checkExitSignals('BTCUSDT', trade, config, '5m');
    expect(result.exitTriggered).toBe(true);
    expect(trade.exit_signals_status?.['ema_cross'].active).toBe(true);

    // Case B: 1w timeframe. 1 candle = 7 days = 604800s
    config.exit_signal_delays = { ema_cross: '1c' };
    config.signal_timeframes = { ema_cross: '1w' };
    // age = 5 days ago -> should NOT be active
    trade.entry_ts = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    result = service.checkExitSignals('BTCUSDT', trade, config, '5m');
    expect(result.exitTriggered).toBe(false);

    // age = 8 days ago -> should BE active
    trade.entry_ts = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    result = service.checkExitSignals('BTCUSDT', trade, config, '5m');
    expect(result.exitTriggered).toBe(true);
  });
});
