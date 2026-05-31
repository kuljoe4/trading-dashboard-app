import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';

describe('OrderManagerService', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockBinanceClient: any;

  beforeEach(() => {
    mockSignalEngine = {
      checkEntry: jest.fn(),
    };
    service = new OrderManagerService(mockSignalEngine, { getSymbolFilters: () => null } as any, { isRateLimited: () => false } as any);
    
    mockBinanceClient = {
      restAPI: {
        tradeApi: {
          newOrder: jest.fn().mockResolvedValue({ data: { orderId: 'mock_order_id' } }),
          cancelOrder: jest.fn().mockResolvedValue({ data: {} }),
        },
      },
    };
  });

  describe('enter', () => {
    it('places initial stop loss in live mode', async () => {
      service.setBinanceClient(mockBinanceClient, false); // Live mode

      const trade = await service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      );

      expect(trade).toBeDefined();
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledTimes(2);
      
      // First call: Entry MARKET order
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenNthCalledWith(
        1,
        'BTCUSDT',
        'BUY',
        'MARKET',
        expect.objectContaining({ quantity: 0.1 })
      );

      // Second call: Initial STOP_MARKET order
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenNthCalledWith(
        2,
        'BTCUSDT',
        'SELL',
        'STOP_MARKET',
        expect.objectContaining({
          stopPrice: 49500,
          closePosition: 'true',
          reduceOnly: 'true',
        })
      );
      
      expect(trade?.binance_stop_order_id).toBe('mock_order_id');
    });

    it('does not place binance orders in paper mode', async () => {
      service.setBinanceClient(mockBinanceClient, true); // Paper mode

      const trade = await service.enter(
        'session_1',
        'BTCUSDT',
        'LONG',
        50000,
        0.1,
        49500,
        51000
      );

      expect(trade).toBeDefined();
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).not.toHaveBeenCalled();
      expect(trade?.binance_order_id).toBeUndefined();
      expect(trade?.binance_stop_order_id).toBeUndefined();
    });
  });

  describe('updateStopLoss', () => {
    it('cancels old SL and places new one in live mode', async () => {
      service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        binance_stop_order_id: 'old_sl_id',
      } as Trade;

      mockBinanceClient.restAPI.tradeApi.newOrder.mockResolvedValueOnce({ data: { orderId: 'new_sl_id' } });

      await service.updateStopLoss(trade, 50500);

      expect(mockBinanceClient.restAPI.tradeApi.cancelOrder).toHaveBeenCalledWith(
        'BTCUSDT',
        { orderId: 'old_sl_id' }
      );
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledWith(
        'BTCUSDT',
        'SELL',
        'STOP_MARKET',
        expect.objectContaining({ stopPrice: 50500 })
      );
      expect(trade.binance_stop_order_id).toBe('new_sl_id');
    });
  });

  describe('closeTrade', () => {
    it('cancels active SL order before closing trade', async () => {
      service.setBinanceClient(mockBinanceClient, false);
      const trade = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 0.1,
        entry_price: 50000,
        binance_stop_order_id: 'active_sl_id',
      } as Trade;

      await service.closeTrade('BTCUSDT', trade, 51000, 'TP_HIT');

      expect(mockBinanceClient.restAPI.tradeApi.cancelOrder).toHaveBeenCalledWith(
        'BTCUSDT',
        { orderId: 'active_sl_id' }
      );
      expect(mockBinanceClient.restAPI.tradeApi.newOrder).toHaveBeenCalledWith(
        'BTCUSDT',
        'SELL',
        'MARKET',
        expect.objectContaining({
          quantity: 0.1,
          reduceOnly: true,
        })
      );
    });

    it('assigns CLOSED status for manual and termination reasons', async () => {
      const trade = {
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
