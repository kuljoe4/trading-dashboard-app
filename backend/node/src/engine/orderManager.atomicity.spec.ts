import { OrderManagerService } from './orderManager';
import { ExchangeExecutionException } from '../lib/exceptions';

describe('OrderManagerService Atomicity', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockBinanceClient: any;
  let mockMarketFeed: any;
  let mockTradingSession: any;

  beforeEach(() => {
    mockSignalEngine = {
      checkEntry: jest.fn(),
    };
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue(null),
    };
    mockTradingSession = {
      isRateLimited: jest.fn().mockReturnValue(false),
    };
    service = new OrderManagerService(mockSignalEngine, mockMarketFeed, mockTradingSession, { log: jest.fn() } as any);

    mockBinanceClient = {
      restAPI: {
        tradeApi: {
          newOrder: jest.fn(),
          cancelOrder: jest.fn(),
          placeMultipleOrders: jest.fn(),
        },
      },
    };
  });

  describe('enter atomicity', () => {
    it('performs emergency unwind if SL placement fails after market entry', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'entry_id' } });
      // Second call (SL via placeMultipleOrders) fails
      mockBinanceClient.restAPI.tradeApi.placeMultipleOrders.mockRejectedValueOnce(new Error('Binance SL failure'));
      // Third call (Unwind via newOrder) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'unwind_id' } });

      const trade = await service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      );

      // Should return null because it was aborted
      expect(trade).toBeNull();

      // Check order calls
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledTimes(2);
      expect(mockBinanceClient.restAPI.tradeApi.placeMultipleOrders).toHaveBeenCalledTimes(1);

      // 1. Entry
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenNthCalledWith(
        1, expect.objectContaining({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET' })
      );
      // 2. SL via placeMultipleOrders
      expect(mockBinanceClient.restAPI.tradeApi.placeMultipleOrders).toHaveBeenCalledWith(
        expect.objectContaining({ batchOrders: expect.stringContaining('"type":"STOP_MARKET"') })
      );
      // 3. Unwind via newOrder
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenNthCalledWith(
        2, expect.objectContaining({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', reduceOnly: 'true' })
      );
    });

    it('throws ExchangeExecutionException if emergency unwind also fails', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'entry_id' } });
      // Second call (SL via placeMultipleOrders) fails
      mockBinanceClient.restAPI.tradeApi.placeMultipleOrders.mockRejectedValueOnce(new Error('Binance SL failure'));
      // Third call (Unwind via newOrder) fails
      mockBinanceClient.restAPI.tradeApi.newOrder.mockRejectedValueOnce(new Error('Unwind failure'));

      await expect(service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      )).rejects.toThrow(ExchangeExecutionException);

      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledTimes(2);
      expect(mockBinanceClient.restAPI.tradeApi.placeMultipleOrders).toHaveBeenCalledTimes(1);
    });

    it('handles successful entry and SL placement', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'entry_id' } });
      // Second call (SL via placeMultipleOrders) succeeds
      mockBinanceClient.restAPI.tradeApi.placeMultipleOrders.mockResolvedValueOnce({ data: [{ orderId: 'sl_id' }] });

      const trade = await service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      );

      expect(trade).not.toBeNull();
      expect(trade?.binance_order_id).toBe('entry_id');
      expect(trade?.binance_stop_order_id).toBe('sl_id');
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledTimes(1);
      expect(mockBinanceClient.restAPI.tradeApi.placeMultipleOrders).toHaveBeenCalledTimes(1);
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
