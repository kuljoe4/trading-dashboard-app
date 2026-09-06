import { PositionTrackerService } from './positionTracker';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { ENGINE_EVENTS } from './events';
describe('SL Ratchet Dirty Symbol Retry & Deferral Audit Standard', () => {
  it('marks symbol dirty when mutex is locked and retries on ratchet complete', async () => {
    let updateStopLossCalls = 0;
    let isRatchetingActive = true;

    const mockOrderManager: any = {
      isRatcheting: (sym: string) => isRatchetingActive,
      checkExitSignals: () => ({ exitTriggered: false }),
      applyFilters: (sym: string, price: number, qty: number) => ({ price, qty }),
      updateStopLoss: async (trade: Trade, newSl: number) => {
        updateStopLossCalls++;
        return { success: true, price: newSl };
      },
    };

    const mockTickerCache: any = {
      getPrice: (sym: string) => 110,
    };

    const mockSessionState: any = {
      config: {
        trailing_stop_enabled: true,
        trailing_stop_distance_pct: 2.0,
      },
      setActiveTrades: () => {},
    };

    const mockEventEmitter: any = {
      emit: () => {},
    };

    const service = new PositionTrackerService(
      {} as any, // riskEngine
      {} as any, // signalEngine
      mockOrderManager,
      mockTickerCache,
      {} as any, // klineStore
      mockSessionState,
      mockEventEmitter,
    );

    const trade: Trade = {
      id: 'test-trade-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 100,
      qty: 1,
      initial_sl: 90,
      current_sl: 90,
      status: 'OPEN',
      max_rr_achieved: 1.0,
      sl_adjustments: [],
      risk_usdt: 10,
    } as any;

    service.addTrade(trade);

    const config: SessionConfig = {
      trailing_stop_enabled: true,
      trailing_stop_distance_pct: 2.0,
    } as any;

    // 1. Evaluate trailing stop while isRatcheting is true
    await service.checkTrailingStop('BTCUSDT', 110, config);

    // Assert symbol was marked dirty and deferral recorded
    expect(updateStopLossCalls).toBe(0);
    expect(trade.sl_adjustments && trade.sl_adjustments.length > 0).toBe(true);
    expect(trade.sl_adjustments![0].reason).toBe('DEFERRED_MUTEX_LOCKED');

    // 2. Lock is released
    isRatchetingActive = false;

    // 3. Signal onRatchetComplete
    await service.onRatchetComplete('BTCUSDT');

    // Assert updateStopLoss was called on retry once lock was released
    expect(updateStopLossCalls).toBe(1);
    expect(trade.current_sl).toBe(107.8);
  });

  it('handleTickerPriceUpdated triggers onTickerUpdate for active symbols', async () => {
    let updatedPrice = 0;

    const mockOrderManager: any = {
      isRatcheting: () => false,
      checkExitSignals: () => ({ exitTriggered: false }),
      applyFilters: (sym: string, price: number, qty: number) => ({ price, qty }),
      updateStopLoss: async (trade: Trade, newSl: number) => {
        updatedPrice = newSl;
        return { success: true, price: newSl };
      },
    };

    const mockTickerCache: any = {
      getPrice: (sym: string) => 120,
    };

    const mockSessionState: any = {
      config: {
        trailing_stop_enabled: true,
        trailing_stop_distance_pct: 2.0,
      },
      setActiveTrades: () => {},
    };

    const service = new PositionTrackerService(
      {} as any,
      {} as any,
      mockOrderManager,
      mockTickerCache,
      {} as any,
      mockSessionState,
      { emit: () => {} } as any,
    );

    const trade: Trade = {
      id: 'test-trade-2',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      entry_price: 100,
      qty: 1,
      initial_sl: 90,
      current_sl: 90,
      status: 'OPEN',
      max_rr_achieved: 0,
      sl_adjustments: [],
      risk_usdt: 10,
    } as any;

    service.addTrade(trade);

    // Simulate incoming WS ticker price event
    await service.handleTickerPriceUpdated({ symbol: 'ETHUSDT', price: 120 });

    expect(updatedPrice).toBe(117.6);
  });

  it('deduplicates consecutive deferral entries in sl_adjustments', () => {
    const service = new PositionTrackerService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { config: {}, setActiveTrades: () => {} } as any,
      { emit: () => {} } as any,
    );

    const trade: Trade = {
      id: 'test-trade-3',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      entry_price: 100,
      qty: 1,
      current_sl: 90,
      sl_adjustments: [],
    } as any;

    // Call recordRatchetDeferral multiple times consecutively
    service.recordRatchetDeferral(trade, 'MUTEX_LOCKED');
    service.recordRatchetDeferral(trade, 'MUTEX_LOCKED');
    service.recordRatchetDeferral(trade, 'MUTEX_LOCKED');

    // Should only have 1 adjustment record instead of 3
    expect(trade.sl_adjustments!.length).toBe(1);
    expect(trade.sl_adjustments![0].reason).toBe('DEFERRED_MUTEX_LOCKED');
  });
});
