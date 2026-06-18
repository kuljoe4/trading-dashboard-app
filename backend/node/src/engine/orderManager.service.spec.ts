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

  describe('Algo SL Order API', () => {
    it('uses newAlgoOrder with algoType: CONDITIONAL for SL placement in live mode', async () => {
      await service.setBinanceClient(mockBinanceClient, false); // Live mode

      const trade = {
        id: 'test-standard-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111'
      } as Trade;

      // Mock marketFeed to return filters
      (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });

      const result = await service.placeStopLoss(trade, 49500);

      expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          algoType: 'CONDITIONAL',
          type: 'STOP_MARKET',
          triggerPrice: '49500.00000000',
          reduceOnly: true,
          newClientOrderId: 'sl-test-sta'
        })
      );
      expect(result?.orderId).toBe('77777');
      expect(result?.price).toBe(49500);
      expect(trade.binance_stop_order_type).toBe('algo');
    });

    it('validates algorithmic order responses correctly via validateStopLossPlacement', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const symbol = 'BTCUSDT';
      const response = { algoId: 12345, algoStatus: 'NEW' };

      const validation = service.validateStopLossPlacement(symbol, response);
      expect(validation.isValid).toBe(true);
      expect(validation.orderId).toBe('12345');
    });

    it('validates standard order responses correctly via validateStopLossPlacement', async () => {
      const symbol = 'BTCUSDT';
      const response = { orderId: 67890, status: 'FILLED' };

      const validation = service.validateStopLossPlacement(symbol, response);
      expect(validation.isValid).toBe(true);
      expect(validation.orderId).toBe('67890');
    });

    it('rejects invalid status in validateStopLossPlacement', async () => {
      const symbol = 'BTCUSDT';
      const response = { orderId: 67890, status: 'CANCELED' };

      const validation = service.validateStopLossPlacement(symbol, response);
      expect(validation.isValid).toBe(false);
    });

    it('falls back to standard STOP_MARKET if Algo API is not supported (-4120)', async () => {
      await service.setBinanceClient(mockBinanceClient, false);

      mockBinanceClient.restAPI.newAlgoOrder.mockRejectedValueOnce(new Error('Order type not supported for this endpoint. (-4120)'));

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
          stopPrice: '49500.00000000'
        })
      );
      expect((mockBinanceClient.restAPI.newOrder.mock.calls[0][0] as any).triggerPrice).toBeUndefined();
      expect(result?.orderId).toBe('99999');
      expect(result?.price).toBe(49500);
      expect(trade.binance_stop_order_type).toBe('standard');
    });
  });

  describe('enter', () => {
    it('places entry via newOrder and stop loss via newAlgoOrder in live mode separately', async () => {
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
      
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'MARKET',
          quantity: '0.10000000'
        })
      );

      expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          side: 'SELL',
          algoType: 'CONDITIONAL',
          type: 'STOP_MARKET',
          triggerPrice: '49500.00000000',
          workingType: 'MARK_PRICE',
          reduceOnly: true
        })
      );

      expect(trade?.binance_stop_order_id).toBe('77777');
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
        binance_stop_order_type: 'standard'
      } as Trade;

      // Audit-first: queryOrder will return existing order 99999
      mockBinanceClient.restAPI.queryOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ orderId: '99999', status: 'NEW', stopPrice: '50000' }),
        headers: {}
      });

      await service.updateStopLoss(trade, 50500);

      expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          orderId: BigInt('99999')
        })
      );
      expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          algoType: 'CONDITIONAL',
          type: 'STOP_MARKET',
          triggerPrice: '50500.00000000',
          workingType: 'MARK_PRICE',
          reduceOnly: true
        })
      );
      expect(trade.binance_stop_order_id).toBe('77777');
    });
  });

  describe('closeTrade', () => {
    it('cancels active SL order explicitly before global flush', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-id-12345678',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
        binance_order_id: '11111',
        binance_stop_order_id: 'algo-sl-999',
        binance_stop_order_type: 'algo'
      } as Trade;

      const logSpy = jest.spyOn((service as any).logger, 'log');

      await service.closeTrade('BTCUSDT', trade, 51000, 'TP_HIT');

      // Verify explicit cancellation of Algo SL
      expect(mockBinanceClient.restAPI.cancelAlgoOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT',
          algoId: 'algo-sl-999'
        })
      );

      // Verify subsequent global flush
      expect(mockBinanceClient.restAPI.cancelAllOpenOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTCUSDT'
        })
      );

      // Verify logs show the sequence
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Canceling known SL order algo-sl-999 (algo)'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SL order algo-sl-999 canceled successfully'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Flushing ALL remaining open orders'));

      logSpy.mockRestore();
    });

    it('aggressively clears order board during SL_PLACEMENT_FAILURE', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-unwind-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
        binance_order_id: '11111'
      } as Trade;

      await service.closeTrade('BTCUSDT', trade, 50000, 'SL_PLACEMENT_FAILURE');

      expect(mockBinanceClient.restAPI.cancelAllOpenOrders).toHaveBeenCalledWith({
        symbol: 'BTCUSDT'
      });
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

      expect(result?.orderId).toBe('77777');
      expect(mockBinanceClient.restAPI.newAlgoOrder).toHaveBeenCalled();
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

      expect(result?.orderId).toBe('TRIGGERED_LOCALLY');
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

  describe('PERCENT_PRICE Fallback', () => {
    it('attempts an aggressive LIMIT order if MARKET close fails due to PERCENT_PRICE', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-id-percent-price',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
        binance_order_id: '11111'
      } as Trade;

      // Mock MARKET order failure
      mockBinanceClient.restAPI.newOrder.mockRejectedValueOnce(new Error('PERCENT_PRICE filter limit.'));
      // Mock LIMIT fallback success
      mockBinanceClient.restAPI.newOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ orderId: 'limit-123' }),
        headers: {}
      });

      // We expect it to resolve to { exitOccurred: false } because the fallback order
      // is placed but not yet filled/authoritative in this sync loop.
      const result = await service.closeTrade('BTCUSDT', trade, 45000, 'SLIPPAGE_ABORT');
      expect(result.exitOccurred).toBe(false);

      // Check for LIMIT fallback
      expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LIMIT',
          timeInForce: 'IOC'
        })
      );
      expect(trade.binance_close_order_id).toBe('limit-123');
    });
  });

  describe('Binance Rejection Handlers', () => {
    it('handles -2021 (Order would immediately trigger) by triggering local close', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-immediate-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111'
      } as Trade;

      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ code: -2021, msg: 'Order would immediately trigger.' }),
        headers: {}
      });

      (service as any).tickerCache.getPrice.mockReturnValue(49000);
      const emitSpy = jest.spyOn((service as any).eventEmitter, 'emit');

      const result = await service.placeStopLoss(trade, 49500);

      expect(result?.orderId).toBe('TRIGGERED_LOCALLY');
      expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
        reason: 'SL_HIT',
        exitPrice: 49000
      }));
    });

    it('handles -1116 (ReduceOnly invalid) as a Sync Recovery', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-reduce-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111'
      } as Trade;

      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ code: -1116, msg: 'No position found for reduce-only order.' }),
        headers: {}
      });

      const emitSpy = jest.spyOn((service as any).eventEmitter, 'emit');

      const result = await service.placeStopLoss(trade, 49500);

      expect(result?.orderId).toBe('TRIGGERED_LOCALLY');
      expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
        reason: 'EXCHANGE_SYNC'
      }));
    });

    it('handles -4044 (Account position is empty) as a Sync Recovery', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-sync-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
        binance_order_id: '11111'
      } as Trade;

      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ code: -4044, msg: 'Account position is empty.' }),
        headers: {}
      });

      const emitSpy = jest.spyOn((service as any).eventEmitter, 'emit');

      const result = await service.placeStopLoss(trade, 49500);

      expect(result?.orderId).toBe('TRIGGERED_LOCALLY');
      expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
        reason: 'EXCHANGE_SYNC'
      }));
    });

    it('trips circuit breaker on systemic failures', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-circuit-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        binance_order_id: '11111'
      } as Trade;

      // systemic error -4001 (Margin insufficient)
      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValue({
        data: () => Promise.resolve({ code: -4001, msg: 'Margin is insufficient.' }),
        headers: {}
      });

      const recordFailureSpy = jest.spyOn(service as any, 'recordFailure');

      // Fail 3 times to trip circuit breaker
      await service.placeStopLoss(trade, 49500);
      await service.placeStopLoss(trade, 49500);
      await service.placeStopLoss(trade, 49500);

      expect(recordFailureSpy).toHaveBeenCalledTimes(3);
      expect((service as any).consecutiveFailures).toBe(3);

      // Verify enter is now blocked
      const result = await service.enter('session_1', 'BTCUSDT', 'LONG', 50000, 0.1, 49000, null);
      expect(result.status).toBe(ExecutionStatus.CIRCUIT_OPEN);
    });

    it('implements Adaptive Buffer Strategy on -2021 (Immediate Trigger)', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-adaptive-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 40000, // Profit is large
        current_sl: 40500,
        binance_order_id: '11111'
      } as Trade;

      // First call: rejected with -2021
      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ code: -2021, msg: 'Order would immediately trigger.' }),
        headers: {}
      });

      // Second call: success
      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValueOnce({
        data: () => Promise.resolve({ algoId: '88888', algoStatus: 'NEW' }),
        headers: {}
      });

      (service as any).tickerCache.getTicker.mockReturnValue({ mark_price: 49000 });
      (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });

      const logMsgSpy = jest.spyOn((service as any).eventEmitter, 'emit');

      const result = await service.placeStopLoss(trade, 49500);

      // Verify success on second attempt
      expect(result?.orderId).toBe('88888');
      expect(trade.binance_stop_order_id).toBe('88888');

      // Verify adaptive log was emitted
      expect(logMsgSpy).toHaveBeenCalledWith('engine.log', expect.objectContaining({
        msg: expect.stringContaining('[Adaptive SL] Binance rejected -2021'),
        level: 'warn'
      }));

      // Verify buffer widening:
      // 1. Initial breach detected (pre-emptive) -> multiplier 2 -> 0.06%
      // 2. Reject -2021 -> multiplier 4 -> 0.12%
      // 49000 * (1 - 0.0012) = 48941.2
      expect(trade.current_sl).toBeCloseTo(48941.2, 1);
    });

    it('stops adapting if SL reaches breakeven (Profitability Guard)', async () => {
      await service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        id: 'test-guard-id',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
        current_sl: 50050, // Barely in profit
        binance_order_id: '11111'
      } as Trade;

      // rejected with -2021
      mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValue({
        data: () => Promise.resolve({ code: -2021, msg: 'Order would immediately trigger.' }),
        headers: {}
      });

      (service as any).tickerCache.getTicker.mockReturnValue({ mark_price: 50010 });
      (service as any).marketFeed.getSymbolFilters = jest.fn().mockReturnValue({ filters: [] });

      const result = await service.placeStopLoss(trade, 50020);

      // Should not adapt because 50020 is too close to 50000 (breakeven floor)
      // Actually my guard logic: adjustedSl = Math.max(adjustedSl, trade.entry_price * (1 + feeBuffer));
      // Buffer 50010 * 0.0006 = 30.
      // 50010 - 30 = 49980.
      // 49980 < 50050 (1.001 * 50000).
      // Since it can't adapt profitably, it should trigger local close.
      expect(result?.orderId).toBe('TRIGGERED_LOCALLY');
    });
  });
});
