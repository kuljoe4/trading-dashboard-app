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
        realTimePositions: new Map(),
        realTimeOrders: new Map(),
        config: {}
      } as any, // sessionState
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any, { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as any
    );
    
    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: '99999', status: 'NEW' }), headers: {} }),
        placeMultipleOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve([{ orderId: '99999' }, { orderId: '88888' }]), headers: {} }),
        cancelOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        changeInitialLeverage: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
        queryOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ orderId: '99999' }), headers: {} }),
        modifyOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        positionInformationV3: jest.fn().mockResolvedValue({ data: () => Promise.resolve([]), headers: {} }),
        accountTradeList: jest.fn().mockResolvedValue({ data: () => Promise.resolve([]), headers: {} }),
        currentAllOpenOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve([]), headers: {} }),
        cancelAllOpenOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
        newAlgoOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ algoId: '77777', algoStatus: 'NEW' }), headers: {} }),
        cancelAlgoOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({}), headers: {} }),
      },
    };
  });

  describe('SL Placement Strategy', () => {
    it('uses newAlgoOrder (conditional) as the primary path in live mode', async () => {
      await service.setBinanceClient(mockBinanceClient, false); // Live mode

      const trade = {
        id: 'test-primary-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111'
      } as Trade;

      (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });

      const result = await service.placeStopLoss(trade, 49500);

      expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          algoType: 'CONDITIONAL',
          type: 'STOP_MARKET',
          triggerPrice: '49500.00000000',
          reduceOnly: true
        })
      );
      expect(result?.orderId).toBe('77777');
      expect(trade.binance_stop_order_type).toBe('algo');
    });

    it('falls back to standard STOP_MARKET with closePosition if Algo API fails with -4120', async () => {
      await service.setBinanceClient(mockBinanceClient, false);

      mockBinanceClient.restAPI.newAlgoOrder.mockRejectedValueOnce(new Error('Order type not supported (-4120)'));

      const trade = {
        id: 'test-fallback-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111'
      } as Trade;

      (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });

      const result = await service.placeStopLoss(trade, 49500);

      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'STOP_MARKET',
          stopPrice: '49500.00000000',
          closePosition: true
        })
      );
      expect(result?.orderId).toBe('99999');
      expect(trade.binance_stop_order_type).toBe('standard');
    });

    it('validates order responses correctly via validateStopLossPlacement', async () => {
      const symbol = 'BTCUSDT';
      expect(service.validateStopLossPlacement(symbol, { algoId: 123, algoStatus: 'NEW' }).isValid).toBe(true);
      expect(service.validateStopLossPlacement(symbol, { orderId: 456, status: 'FILLED' }).isValid).toBe(true);
      expect(service.validateStopLossPlacement(symbol, { status: 'CANCELED' }).isValid).toBe(false);
    });
  });

  describe('enter', () => {
    it('places entry via newOrder and stop loss via newAlgoOrder in live mode separately', async () => {
      await service.setBinanceClient(mockBinanceClient, false); // Live mode

      const result = await service.enter('session_1', 'BTCUSDT', 'LONG', 50000, 0.1, 49500, null);

      expect(result.status).toBe('SUCCESS');
      const trade = result.data;
      expect(trade).toBeDefined();

      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledWith(expect.objectContaining({ side: 'BUY', type: 'MARKET' }));
      expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledWith(expect.objectContaining({ type: 'STOP_MARKET', algoType: 'CONDITIONAL' }));
      expect(trade?.binance_stop_order_id).toBe('77777');
    });

    it('does not place binance orders in paper mode', async () => {
      service.setBinanceClient(mockBinanceClient, true);
      const result = await service.enter('session_1', 'BTCUSDT', 'LONG', 50000, 0.1, 49500, null);
      expect(mockBinanceClient.restAPI.newOrder).not.toHaveBeenCalled();
    });
  });

  describe('updateStopLoss', () => {
    it('cancels old SL and places new one via primary (algo) path', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-id-12345678',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111',
        binance_stop_order_id: '22222',
        binance_stop_order_type: 'standard'
      } as Trade;

      mockBinanceClient.restAPI.queryOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ orderId: '99999', status: 'NEW' }), headers: {} });

      await service.updateStopLoss(trade, 50500);

      expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalled();
      expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledWith(expect.objectContaining({ triggerPrice: '50500.00000000' }));
    });
  });

  describe('closeTrade', () => {
    it('attempts market close before flushing orders and re-arms on failure', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-id-close',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
        current_sl: 49000,
        binance_order_id: '11111'
      } as Trade;

      (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });

      // Market close fails
      mockBinanceClient.restAPI.newOrder.mockRejectedValueOnce(new Error('PERCENT_PRICE rejection'));

      try {
        await service.closeTrade('BTCUSDT', trade, 45000, 'SIGNAL');
      } catch (e) {}

      // Check re-arm attempt
      expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledWith(expect.objectContaining({ triggerPrice: '49000.00000000' }));
    });
  });

  describe('Binance Rejection Handlers', () => {
    it('handles -2021 (Order would immediately trigger) by triggering local close', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = { id: 'test-imm', symbol: 'BTCUSDT', direction: 'LONG', qty: 0.1, binance_order_id: '11111' } as Trade;

      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ code: -2021, msg: 'Order would immediately trigger.' }),
        headers: {}
      });

      (service as any).tickerCache.getPrice.mockReturnValue(49000);
      const emitSpy = jest.spyOn((service as any).eventEmitter, 'emit');

      const result = await service.placeStopLoss(trade, 49500);
      expect(result?.orderId).toBe('TRIGGERED_LOCALLY');
      expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({ reason: expect.stringMatching(/SL_HIT/) }));
    });

    it('implements Adaptive Buffer Strategy on -2021 (Immediate Trigger)', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = { id: 'test-ada', symbol: 'BTCUSDT', direction: 'LONG', qty: 0.1, entry_price: 40000, current_sl: 40500, binance_order_id: '11111' } as Trade;

      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ code: -2021, msg: 'Order would immediately trigger.' }), headers: {} });
      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({ data: () => Promise.resolve({ algoId: '88888', algoStatus: 'NEW' }), headers: {} });

      (service as any).tickerCache.getTicker.mockReturnValue({ mark_price: 49000 });
      (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });

      const result = await service.placeStopLoss(trade, 49500);
      expect(result?.orderId).toBe('88888');
      expect(trade.current_sl).toBeCloseTo(48941.2, 1);
    });
  });
});
