import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';

describe('OrderManagerService Resilience', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockBinanceClient: any;
  let mockMarketFeed: any;
  let mockSessionState: any;
  let mockAuditLog: any;

  beforeEach(() => {
    mockSignalEngine = {};
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({
        filters: [
          { filterType: 'LOT_SIZE', stepSize: '0.001' },
          { filterType: 'PRICE_FILTER', tickSize: '0.01' }
        ]
      })
    };
    mockSessionState = {
      isRateLimited: jest.fn().mockReturnValue(false),
      binanceRateLimit: { used_1m: 0, limit: 2400 },
      updateRateLimit: jest.fn(),
      realTimePositions: new Map()
    };
    mockAuditLog = {
      log: jest.fn()
    };

    service = new OrderManagerService(
      mockSignalEngine as any,
      mockMarketFeed as any,
      null as any, // tickerCache
      mockSessionState as any,
      mockAuditLog as any,
      { emit: jest.fn() } as any,
    );

    mockBinanceClient = {
      restAPI: {
        tradeApi: {
          newOrder: jest.fn(),
          newAlgoOrder: jest.fn(),
          cancelOrder: jest.fn(),
          cancelAlgoOrder: jest.fn(),
          positionInformationV2: jest.fn(),
          currentAllOpenOrders: jest.fn(),
          currentOpenAlgoOrders: jest.fn()
        }
      }
    };
  });

  describe('cancelBinanceAlgoOrder resilience', () => {
    it('should recognize "Unknown order sent." as a successful cancellation', async () => {
      service.setBinanceClient(mockBinanceClient, false);
      mockBinanceClient.restAPI.tradeApi.cancelAlgoOrder.mockRejectedValue(new Error('Unknown order sent.'));

      const result = await service.cancelBinanceAlgoOrder('ETHUSDT', '1000000098924300');

      expect(result).toBe(true);
      expect(mockBinanceClient.restAPI.tradeApi.cancelAlgoOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'ETHUSDT'
        })
      );
    });
  });

  describe('closeTrade resilience', () => {
    it('should recognize "ReduceOnly Order is rejected." as a potential SL race and verify position', async () => {
      service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'trade-1',
        symbol: 'ETHUSDT',
        direction: 'LONG',
        qty: 1,
        entry_price: 2000,
        binance_order_id: 'existing-order-id',
        binance_stop_order_id: 'existing-algo-id'
      } as Trade;

      // Mock cancelAlgoOrder to succeed
      mockBinanceClient.restAPI.tradeApi.cancelAlgoOrder.mockResolvedValue({ data: {} });

      // Mock newOrder (close order) to fail with ReduceOnly error
      mockBinanceClient.restAPI.tradeApi.newOrder.mockRejectedValue(new Error('ReduceOnly Order is rejected.'));

      // Mock position check to show zero position
      mockBinanceClient.restAPI.tradeApi.positionInformationV2.mockResolvedValue({ data: [{ symbol: 'ETHUSDT', positionAmt: '0', positionSide: 'BOTH' }] });

      const result = await service.closeTrade('ETHUSDT', trade, 2100, 'SIGNAL');

      expect(result.exitOccurred).toBe(true);
      expect(trade.status).toBe('CLOSED_SIGNAL');
      expect(trade.exit_reason).toBe('EXCHANGE_SL_OR_MANUAL');
    });
  });

  describe('placeStopLoss resilience', () => {
    it('should cleanup conflicting orphan orders and retry SL placement', async () => {
      service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'trade-12345678',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: 'entry-id'
      } as Trade;

      // 1. First attempt fails with existing order error
      mockBinanceClient.restAPI.tradeApi.newOrder.mockRejectedValueOnce(new Error('An open stop or take profit order with GTE and closePosition in the direction is existing.'));

      // 2. Cleanup fetch returns one conflicting order
      mockBinanceClient.restAPI.tradeApi.currentAllOpenOrders.mockResolvedValueOnce({
        data: [{
          orderId: 'orphan-1',
          type: 'STOP_MARKET',
          closePosition: true,
          side: 'SELL'
        }]
      });

      // 3. Cancel of orphan succeeds
      mockBinanceClient.restAPI.tradeApi.cancelOrder.mockResolvedValueOnce({ data: {} });

      // 4. Second attempt (retry) succeeds
      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ orderId: 'sl-new-id' }),
        headers: { get: () => '100' }
      });

      const result = await service.placeStopLoss(trade, 50000);

      expect(result).toBe('sl-new-id');
      expect(mockBinanceClient.restAPI.tradeApi.cancelOrder).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'orphan-1' }));
    });
  });
});
