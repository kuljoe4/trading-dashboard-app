import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';

describe('Chronos: Close-Rearm Rollback and Stop-Loss Protection', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockBinanceClient: any;

  beforeEach(() => {
    mockSignalEngine = {
      checkEntry: jest.fn(),
    };
    service = new OrderManagerService(
      mockSignalEngine,
      { getSymbolFilters: (symbol: string) => ({ filters: [] }) } as any,
      { getTicker: jest.fn(), getPrice: jest.fn() } as any, // tickerCache
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
        { getTicker: jest.fn(), getPrice: jest.fn() } as any, // sessionState
        { broadcast: jest.fn() } as any
      )
    );

    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: '99999', status: 'NEW' }), headers: {} }),
        cancelOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
        newAlgoOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ algoId: '77777', algoStatus: 'NEW' }), headers: {} }),
      },
    };
  });

  it('proactively cancels old stop loss and places a fresh stop loss during re-arm rollback when close fails', async () => {
    await service.setBinanceClient(mockBinanceClient, false); // Live mode

    const trade = {
      id: 'test-rearm-id',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.1,
      entry_price: 50000,
      current_sl: 49000,
      binance_order_id: '11111',
      binance_stop_order_id: '22222', // Must have an existing SL to trigger cancellation before re-placement
      status: 'OPEN'
    } as Trade;

    (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });

    // Mock close/market order to fail
    mockBinanceClient.restAPI.newOrder.mockRejectedValueOnce(new Error('PERCENT_PRICE rejection'));

    try {
      await service.closeTrade('BTCUSDT', trade, 45000, 'SIGNAL');
    } catch (e) {}

    // Verify cancellation of old SL was called
    expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT',
      orderId: 22222n
    }));

    // Verify placement of fresh SL was called with correct stop price
    expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT',
      triggerPrice: '49000.00000000'
    }));

    // Verify that the stop order ID was updated to the new placed SL order ID ('77777' from newAlgoOrder mock)
    expect(trade.binance_stop_order_id).toBe('77777');
  });
});
