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
          positionInformationV2: jest.fn()
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
});
