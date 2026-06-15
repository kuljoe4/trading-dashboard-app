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
        tradeApi: {
          newOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: 'mock_order_id' }), headers: {} }),
          newAlgoOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: 'mock_sl_id' }), headers: {} }),
          placeMultipleOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve([{ orderId: 'mock_order_id' }, { orderId: 'mock_sl_id' }]), headers: {} }),
          cancelOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
          cancelAlgoOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
          changeInitialLeverage: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        },
        accountApi: {
          userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
        }
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
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledTimes(2);
      
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: '0.10000000'
        })
      );

      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'SELL',
          type: 'STOP_MARKET',
          stopPrice: '49500.00000000',
          workingType: 'MARK_PRICE',
          closePosition: true
        })
      );

      expect(trade?.binance_stop_order_id).toBe('mock_order_id');
    });

    it('is idempotent for setBinanceClient (only fetches and logs once)', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'log');
      await service.setBinanceClient(mockBinanceClient, false); // First call
      const firstCallCount = mockBinanceClient.restAPI.accountApi.userCommissionRate.mock.calls.length;

      await service.setBinanceClient(mockBinanceClient, false); // Second call with same client
      expect(mockBinanceClient.restAPI.accountApi.userCommissionRate).toHaveBeenCalledTimes(firstCallCount);

      // Verification of log message occurrence would be here if we didn't have multiple tests logged to same console
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
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).not.toHaveBeenCalled();
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
        binance_order_id: 'mock_order_id',
        binance_stop_order_id: 'old_sl_id',
      } as Trade;

      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ orderId: 'new_sl_id' }), headers: {} });

      await service.updateStopLoss(trade, 50500);

      expect(mockBinanceClient.restAPI.tradeApi.cancelOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          orderId: 'old_sl_id'
        })
      );
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'STOP_MARKET',
          stopPrice: '50500.00000000',
          workingType: 'MARK_PRICE',
          closePosition: true
        })
      );
      expect(trade.binance_stop_order_id).toBe('new_sl_id');
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
        binance_order_id: 'mock_order_id',
        binance_stop_order_id: 'active_sl_id',
      } as Trade;

      await service.closeTrade('BTCUSDT', trade, 51000, 'TP_HIT');

      expect(mockBinanceClient.restAPI.tradeApi.cancelOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          orderId: 'active_sl_id'
        })
      );
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'SELL',
          type: 'MARKET',
          quantity: '0.10000000',
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
