import { OrderManagerService } from './orderManager';
import { ExchangeExecutionException } from '../lib/exceptions';
import { ExecutionStatus } from '../models/ExecutionResult';

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
      getSymbolFilters: jest.fn().mockReturnValue({
        filters: [
          { filterType: 'LOT_SIZE', stepSize: '0.001' },
          { filterType: 'PRICE_FILTER', tickSize: '0.01' }
        ]
      }),
    };
    mockTradingSession = {
      isRateLimited: jest.fn().mockReturnValue(false),
    };
    service = new OrderManagerService(mockSignalEngine, mockMarketFeed, mockTradingSession, { log: jest.fn() } as any);

    mockBinanceClient = {
      restAPI: {
        tradeApi: {
          newOrder: jest.fn(),
          newAlgoOrder: jest.fn(),
          cancelOrder: jest.fn(),
          cancelAlgoOrder: jest.fn(),
        }
      },
    };
  });

  describe('enter atomicity', () => {
    it('performs emergency unwind if SL placement fails after market entry', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'entry_id' } });
      // Second call (SL via tradeApi.newAlgoOrder) fails
      mockBinanceClient.restAPI.tradeApi.newAlgoOrder.mockRejectedValueOnce(new Error('Binance SL failure'));
      // Third call (Unwind via tradeApi.newOrder) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'unwind_id' } });

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
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledTimes(2);
      expect(mockBinanceClient.restAPI.tradeApi.newAlgoOrder).toHaveBeenCalledTimes(1);

      // 1. Entry
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenNthCalledWith(
        1, expect.objectContaining({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET' })
      );
      // 2. SL via tradeApi.newAlgoOrder
      expect(mockBinanceClient.restAPI.tradeApi.newAlgoOrder).toHaveBeenCalledWith(
        expect.objectContaining({ algoType: 'CONDITIONAL', symbol: 'BTCUSDT', type: 'STOP_MARKET' })
      );
      // 3. Unwind via tradeApi.newOrder
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenNthCalledWith(
        2, expect.objectContaining({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', reduceOnly: 'true' })
      );
    });

    it('throws ExchangeExecutionException if emergency unwind also fails', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'entry_id' } });
      // Second call (SL via tradeApi.newAlgoOrder) fails
      mockBinanceClient.restAPI.tradeApi.newAlgoOrder.mockRejectedValueOnce(new Error('Binance SL failure'));
      // Third call (Unwind via tradeApi.newOrder) fails
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
      expect(mockBinanceClient.restAPI.tradeApi.newAlgoOrder).toHaveBeenCalledTimes(1);
    });

    it('handles successful entry and SL placement', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      // First call (Entry) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'entry_id' } });
      // Second call (SL via tradeApi.newAlgoOrder) succeeds
      mockBinanceClient.restAPI.tradeApi.newAlgoOrder.mockResolvedValueOnce({ data: { algoId: 'sl_id' } });

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
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledTimes(1);
      expect(mockBinanceClient.restAPI.tradeApi.newAlgoOrder).toHaveBeenCalledTimes(1);
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
