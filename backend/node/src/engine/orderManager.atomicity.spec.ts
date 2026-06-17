import { OrderManagerService } from './orderManager';
import { ExchangeExecutionException } from '../lib/exceptions';
import { ExecutionStatus } from '../models/ExecutionResult';

describe('OrderManagerService Atomicity', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockBinanceClient: any;
  let mockMarketFeed: any;
  let mockSessionState: any;
  let mockAuditLog: any;

  beforeEach(() => {
    mockSignalEngine = {
      checkEntry: jest.fn(),
    };
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockImplementation((symbol) => {
        if (symbol === 'BTCUSDT' || symbol === 'TRADABLE') {
          return {
            filters: [
              { filterType: 'LOT_SIZE', stepSize: '0.001' },
              { filterType: 'PRICE_FILTER', tickSize: '0.01' }
            ]
          };
        }
        return null;
      }),
    };
    mockSessionState = {
      isRateLimited: jest.fn().mockReturnValue(false),
      isOrderRateLimited: jest.fn().mockReturnValue(false),
      binanceRateLimit: { used_1m: 0, limit: 2400 },
      updateRateLimit: jest.fn(),
      updateOrderRateLimits: jest.fn(),
      realTimePositions: new Map()
    };
    mockAuditLog = {
      log: jest.fn(),
    };
    service = new OrderManagerService(
      mockSignalEngine,
      mockMarketFeed,
      { getTicker: jest.fn(), getPrice: jest.fn() } as any, // tickerCache
      { incrementApiRequests: jest.fn() } as any, // monitoringService
      mockSessionState,
      mockAuditLog,
      { emit: jest.fn() } as any,
    );

    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn(),
        cancelOrder: jest.fn(),
        userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
        queryOrder: jest.fn(),
        modifyOrder: jest.fn(),
        currentAllOpenOrders: jest.fn(),
        positionInformationV3: jest.fn(),
        accountTradeList: jest.fn(),
      },
    };
  });

  describe('enter atomicity', () => {
    it('performs emergency unwind if SL placement fails after market entry', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.newOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ orderId: 'entry_id', avgPrice: '50000', executedQty: '0.1' }), headers: {} });
      // Second call (SL via newOrder) fails
      mockBinanceClient.restAPI.newOrder.mockRejectedValueOnce(new Error('Binance SL failure'));
      // Third call (Unwind via newOrder) succeeds
      mockBinanceClient.restAPI.newOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ orderId: 'unwind_id', executedQty: '0.1' }), headers: {} });

      const result = await service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      );

      // Should return SL_FAILED because SL failed and unwind was performed
      expect(result.status).toBe(ExecutionStatus.SL_FAILED);
      expect(result.unwindPerformed).toBe(true);

      // Check order calls
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledTimes(3);

      // 1. Entry
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenNthCalledWith(
        1, expect.objectContaining({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET' })
      );
      // 2. SL via newOrder
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenNthCalledWith(
        2, expect.objectContaining({ symbol: 'BTCUSDT', type: 'STOP_MARKET', closePosition: true })
      );
      // 3. Unwind via newOrder
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenNthCalledWith(
        3, expect.objectContaining({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', reduceOnly: true })
      );
    });

    it('throws ExchangeExecutionException if emergency unwind also fails', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.newOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ orderId: 'entry_id', avgPrice: '50000', executedQty: '0.1' }), headers: {} });
      // Second call (SL via newOrder) fails
      mockBinanceClient.restAPI.newOrder.mockRejectedValueOnce(new Error('Binance SL failure'));
      // Third call (Unwind via newOrder) fails
      mockBinanceClient.restAPI.newOrder.mockRejectedValueOnce(new Error('Unwind failure'));

      await expect(service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      )).rejects.toThrow(ExchangeExecutionException);

      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledTimes(3);
    });

    it('handles successful entry and SL placement', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.newOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ orderId: 'entry_id', avgPrice: '50000', executedQty: '0.1' }), headers: {} });
      // Second call (SL via newOrder) succeeds
      mockBinanceClient.restAPI.newOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ orderId: 'sl_id' }), headers: {} });

      const result = await service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      );

      expect(result.status).toBe(ExecutionStatus.SUCCESS);
      const trade = result.data;
      expect(trade).not.toBeUndefined();
      expect(trade?.binance_order_id).toBe('entry_id');
      expect(trade?.binance_stop_order_id).toBe('sl_id');
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledTimes(2);
    });
  });

  describe('PnL NaN protection', () => {
    it('handles zero or invalid values in closeTrade without producing NaN', async () => {
      const trade = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0, // Zero qty
        entry_price: 50000,
        realized_fee: NaN, // Trigger NaN check
      } as any;

      const result = await service.closeTrade('BTCUSDT', trade, 51000, 'TP_HIT', true);

      expect(result.trade.pnl).toBe(0);
      expect(Number.isNaN(result.trade.pnl)).toBe(false);
      expect(result.trade.pnl_pct).toBe(0);
      expect(Number.isNaN(result.trade.pnl_pct)).toBe(false);
    });

    it('handles infinity/NaN in prices gracefully', async () => {
        const trade = {
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 0.1,
          entry_price: 0, // Could cause division by zero
        } as any;

        const result = await service.closeTrade('BTCUSDT', trade, 51000, 'TP_HIT', true);

        expect(Number.isFinite(result.trade.pnl)).toBe(true);
        expect(Number.isFinite(result.trade.pnl_pct)).toBe(true);
      });
  });
});
