import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';
import { ExecutionStatus } from '../models/ExecutionResult';

describe('OrderManagerService', () => {
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
        isRateLimited: () => false,
        isOrderRateLimited: () => false,
        binanceRateLimit: { used_1m: 0, limit: 2400 },
        updateRateLimit: jest.fn(),
        updateOrderRateLimits: jest.fn(),
        realTimePositions: new Map()
      } as any, // sessionState
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any, // eventEmitter
    );
    
    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: '99999' }), headers: {} }),
        placeMultipleOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve([{ orderId: '99999' }, { orderId: '88888' }]), headers: {} }),
        cancelOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        changeInitialLeverage: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
        queryOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: '99999' }), headers: {} }),
        modifyOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        positionInformationV3: jest.fn().mockResolvedValue({ data: () => Promise.resolve([]), headers: {} }),
        accountTradeList: jest.fn().mockResolvedValue({ data: () => Promise.resolve([]), headers: {} }),
        currentAllOpenOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve([]), headers: {} }),
      },
    };
  });

  describe('enter', () => {
    it('places entry and stop loss in live mode separately', async () => {
      await service.setBinanceClient(mockBinanceClient, false); // Live mode

      const result = await service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      );

      expect(result.status).toBe('SUCCESS');
      const trade = result.data;
      expect(trade).toBeDefined();
      // 1 for entry, 1 for SL
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledTimes(2);
      
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: '0.10000000'
        })
      );

      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'SELL',
          type: 'STOP_MARKET',
          stopPrice: 49500,
          workingType: 'MARK_PRICE',
          reduceOnly: true,
          quantity: '0.10000000'
        })
      );

      expect(trade?.binance_stop_order_id).toBe('99999');
    });

    it('is idempotent for setBinanceClient (only fetches and logs once)', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'log');
      await service.setBinanceClient(mockBinanceClient, false); // First call
      const firstCallCount = mockBinanceClient.restAPI.userCommissionRate.mock.calls.length;

      await service.setBinanceClient(mockBinanceClient, false); // Second call with same client
      expect(mockBinanceClient.restAPI.userCommissionRate).toHaveBeenCalledTimes(firstCallCount);

      logSpy.mockRestore();
    });

    it('does not place binance orders in paper mode', async () => {
      service.setBinanceClient(mockBinanceClient, true); // Paper mode

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
      expect(trade).toBeDefined();
      expect(mockBinanceClient.restAPI.newOrder).not.toHaveBeenCalled();
      expect(trade?.binance_order_id).toBeUndefined();
      expect(trade?.binance_stop_order_id).toBeUndefined();
    });
  });

  describe('updateStopLoss', () => {
    it('cancels old SL and places new one in live mode', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-id-12345678',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111',
        binance_stop_order_id: '22222',
      } as Trade;

      mockBinanceClient.restAPI.newOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ orderId: '33333' }), headers: {} });

      await service.updateStopLoss(trade, 50500);

      expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          orderId: BigInt('22222')
        })
      );
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'STOP_MARKET',
          stopPrice: 50500,
          workingType: 'MARK_PRICE',
          reduceOnly: true,
          quantity: '0.10000000'
        })
      );
      expect(trade.binance_stop_order_id).toBe('33333');
    });
  });

  describe('closeTrade', () => {
    it('cancels active SL order before closing trade', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-id-12345678',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
        binance_order_id: '11111',
        binance_stop_order_id: '44444',
      } as Trade;

      await service.closeTrade('BTCUSDT', trade, 51000, 'TP_HIT');

      expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          orderId: BigInt('44444')
        })
      );
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'SELL',
          type: 'MARKET',
          quantity: 0.1,
          reduceOnly: true,
        })
      );
    });

    it('assigns CLOSED status for manual and termination reasons', async () => {
      const trade = {
        id: 'test-id-12345678',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
      } as Trade;

      // Manual close
      const resultManual = await service.closeTrade('BTCUSDT', { ...trade }, 51000, 'MANUAL_CLOSE');
      expect(resultManual.trade.status).toBe('CLOSED');

      // Session termination
      const resultTerm = await service.closeTrade('BTCUSDT', { ...trade }, 51000, 'SESSION_TERMINATED');
      expect(resultTerm.trade.status).toBe('CLOSED');
    });
  });

  describe('Sync Recovery', () => {
    it('handles duplicate clientOrderId on entry retry', async () => {
      await service.setBinanceClient(mockBinanceClient, false);

      // First call returns duplicate error
      mockBinanceClient.restAPI.newOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ code: -2011, msg: 'Duplicate clientOrderId' }),
        headers: {}
      });
      // Query succeeds
      mockBinanceClient.restAPI.queryOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ orderId: '77777', avgPrice: '50100', executedQty: '0.1', status: 'FILLED' }),
        headers: {}
      });

      const result = await service.enter('session_1', 'BTCUSDT', 'LONG', 50000, 0.1, 49500, null);

      expect(result.status).toBe('SUCCESS');
      expect(result.data?.binance_order_id).toBe('77777');
      expect(result.data?.entry_price).toBe(50100);
    });
  });

  describe('Fix A: Authoritative Guard', () => {
    it('uses authoritative fillPrice even if ticker cache is breached', async () => {
      const trade = {
        id: 'test-id-authoritative',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111'
      } as Trade;

      // Mock breached price in ticker cache (49400 < SL 49500)
      (service as any).tickerCache.getTicker.mockReturnValue({ mark_price: 49400 });

      // Mock marketFeed to return filters for the symbol so it doesn't fail early
      (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });
      await service.setBinanceClient(mockBinanceClient, false); // Live mode

      // authoritative fillPrice is safe (50000 > SL 49500)
      const result = await service.placeStopLoss(trade, 49500, 50000);

      expect(result).toBe('99999');
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalled();
    });

    it('triggers locally if authoritative fillPrice is breached even if ticker is safe', async () => {
      const trade = {
        id: 'test-id-breached',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111'
      } as Trade;

      // Mock safe price in ticker cache (50000 > SL 49500)
      (service as any).tickerCache.getTicker.mockReturnValue({ mark_price: 50000 });

      // authoritative fillPrice is breached (49400 < SL 49500)
      const result = await service.placeStopLoss(trade, 49500, 49400);

      expect(result).toBe('TRIGGERED_LOCALLY');
      expect(mockBinanceClient.restAPI.newOrder).not.toHaveBeenCalled();
    });
  });

  describe('checkExitSignals', () => {
    it('returns exitTriggered false when no exit signals are configured', () => {
      const trade = { symbol: 'BTCUSDT' } as any;
      const config = { exit_signals: [] } as any;
      
      const result = service.checkExitSignals('BTCUSDT', trade, config);
      expect(result.exitTriggered).toBe(false);
    });

    it('correctly identifies triggered exit signals', () => {
      const trade = { 
        symbol: 'BTCUSDT', 
        direction: 'LONG',
        entry_ts: new Date(Date.now() - 10000).toISOString() // 10s ago
      } as any;
      
      const config = { 
        exit_signals: ['ema_close'],
        exit_signal_logic: 'any'
      } as any;

      mockSignalEngine.checkEntry.mockReturnValue({
        allFired: true,
        firedSignals: ['ema_close'],
        reason: 'EMA close fired'
      });

      const result = service.checkExitSignals('BTCUSDT', trade, config);
      
      expect(result.exitTriggered).toBe(true);
      expect(result.exitSignalType).toBe('ema_close');
      expect(trade.exit_signals_status?.ema_close.fired).toBe(true);
    });
  });
});
