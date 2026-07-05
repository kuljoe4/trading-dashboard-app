import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';
import { ExecutionStatus } from '../models/ExecutionResult';

describe('SL Ratchet Race Conditions & Protection Gaps', () => {
  let orderManager: OrderManagerService;
  let mockSignalEngine: any;
  let mockMarketFeed: any;
  let mockTickerCache: any;
  let mockSessionState: any;
  let mockAuditLog: any;
  let mockEventEmitter: any;
  let mockBinanceClient: any;

  beforeEach(() => {
    mockSignalEngine = {};
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({
        filters: [
          { filterType: 'PRICE_FILTER', tickSize: '0.01' },
          { filterType: 'LOT_SIZE', stepSize: '0.001' }
        ]
      })
    };
    mockTickerCache = {
      getTicker: jest.fn(),
      getPrice: jest.fn().mockReturnValue(100)
    };
    mockSessionState = {
      isRateLimited: jest.fn().mockReturnValue(false),
      isOrderRateLimited: jest.fn().mockReturnValue(false),
      config: { trailing_guard_buffer_pct: 0.1 }
    };
    mockAuditLog = { log: jest.fn() };
    mockEventEmitter = { emit: jest.fn() };

    orderManager = new OrderManagerService(
      mockSignalEngine,
      mockMarketFeed,
      mockTickerCache,
      { incrementApiRequests: jest.fn() } as any,
      { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn(), isRatcheting: jest.fn() } as any,
      mockSessionState,
      mockAuditLog,
      mockEventEmitter, { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as any
    );

    mockBinanceClient = {
      restAPI: {
        cancelOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ status: 'CANCELED' }) }),
        newAlgoOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ algoId: 'new-sl-123', status: 'NEW' }) }),
        queryOrder: jest.fn().mockRejectedValue(new Error('Not found')),
        cancelAllOpenOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}) })
      }
    };
    orderManager.setBinanceClient(mockBinanceClient, false);
  });

  it('should restore previous SL if replacement fails (Rollback Protection)', async () => {
    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entry_price: 100,
      current_sl: 90,
      binance_stop_order_id: '12345',
      binance_order_id: 'entry-id'
    } as any as Trade;

    // 1. Mock cancellation of the old SL
    mockBinanceClient.restAPI.cancelOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ status: 'CANCELED' }) });

    // 2. Simulate failure on new SL placement
    mockBinanceClient.restAPI.newAlgoOrder.mockRejectedValueOnce(new Error('PERCENT_PRICE rejection'));

    // 3. Mock the rollback placement of the OLD SL
    mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ algoId: 'rollback-sl-id', status: 'NEW' }) });

    const result = await orderManager.updateStopLoss(trade, 95);

    expect(result.success).toBe(false);
    // Should have rolled back to the old SL ID
    expect(trade.binance_stop_order_id).toBe('rollback-sl-id');
    // Ensure placement was called for both 95 (fail) and 90 (rollback)
    expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledTimes(2);
  });

  it('should block concurrent ratchets for the same symbol (Mutex Guard)', async () => {
    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entry_price: 100,
      current_sl: 90,
      binance_stop_order_id: '12345',
      binance_order_id: 'entry-id'
    } as any as Trade;

    // Simulate slow cancellation
    let cancelCalls = 0;
    mockBinanceClient.restAPI.cancelOrder.mockImplementation(async () => {
      cancelCalls++;
      await new Promise(resolve => setTimeout(resolve, 100));
      return { data: () => Promise.resolve({ status: 'CANCELED' }) };
    });

    // Fire two updates rapidly
    const p1 = orderManager.updateStopLoss(trade, 91);
    const p2 = orderManager.updateStopLoss(trade, 92);

    const results = await Promise.all([p1, p2]);

    // One should succeed (or proceed), one should be blocked by mutex
    expect(cancelCalls).toBe(1);
    expect(results.some(r => r.success === false)).toBe(true);
  });
});
