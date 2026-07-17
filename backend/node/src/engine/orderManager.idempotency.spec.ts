import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';
import { ENGINE_EVENTS } from './events';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('OrderManagerService - Idempotency & Partial SL Sync', () => {
  let service: OrderManagerService;
  let eventEmitter: EventEmitter2;
  let sessionState: any;

  beforeEach(() => {
    eventEmitter = new EventEmitter2();
    sessionState = {
      activeTrades: [],
      realTimeOrders: new Map(),
      realTimePositions: new Map(),
      isRateLimited: jest.fn().mockReturnValue(false),
      updateRateLimit: jest.fn(),
      updateOrderRateLimits: jest.fn(),
      getBinanceRateLimit: jest.fn().mockReturnValue({ used_1m: 0, limit: 2400 }),
    };

    service = new OrderManagerService(
      {} as any, // signalEngine
      { getSymbolFilters: jest.fn() } as any, // marketFeed
      { getPrice: jest.fn() } as any, // tickerCache
      { incrementApiRequests: jest.fn() } as any, // monitoringService
      { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn() } as any, // positionTracker
      sessionState,
      { broadcast: jest.fn() } as any, // broadcastService
      { log: jest.fn() } as any, // auditLog
      eventEmitter,
      { findOne: jest.fn(), update: jest.fn() } as any // settingsRepository
    , new OrderFilterService(// signalEngine
      { getSymbolFilters: jest.fn() } as any, // marketFeed
      { getPrice: jest.fn() } as any, { broadcast: jest.fn() } as any));
  });

  it('should sync trade.qty on PARTIALLY_FILLED SL order and restore it on final FILLED', async () => {
    const trade = {
      id: 'test-trade-id',
      symbol: 'BTCUSDT',
      qty: 1.0,
      direction: 'LONG',
      binance_stop_order_id: 'sl-123',
      status: 'OPEN',
      entry_price: 50000,
    } as Trade;
    sessionState.activeTrades = [trade];

    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    // 1. Partial fill of SL (50% filled)
    // In Binance UDS: 'z' is cumulative filled qty, 'q' is total order qty
    const partialPayload = {
      e: 'ORDER_TRADE_UPDATE',
      E: Date.now(),
      T: Date.now(),
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: 'sl-123',
        z: '0.4', // Cumulative filled
        q: '1.0',
        x: 'TRADE',
        S: 'SELL',
        ot: 'STOP_MARKET',
        ap: '49000'
      }
    };

    await service.handleBinanceOrderUpdate(partialPayload as any);

    // Current behavior check (Expected to FAIL before fix):
    // It should update trade.qty to 0.6 (1.0 - 0.4) and emit QUANTITY_SYNC
    expect(trade.qty).toBe(0.6);
    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, { symbol: 'BTCUSDT', qty: 0.6 });

    // 2. Final fill of SL
    const finalPayload = {
      e: 'ORDER_TRADE_UPDATE',
      E: Date.now(),
      T: Date.now(),
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'sl-123',
        z: '1.0',
        q: '1.0',
        x: 'TRADE',
        S: 'SELL',
        ot: 'STOP_MARKET',
        ap: '48900'
      }
    };

    eventEmitter.on('trade.exchange_close', () => {
      trade.qty = 1.0;
    });
    await service.handleBinanceOrderUpdate(finalPayload as any);

    // After final fill, trade.qty should be restored to 1.0 for PnL calculation in closeTrade
    expect(trade.qty).toBe(1.0);
    expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT',
      exitPrice: 48900
    }));
  });

  it('should deduplicate commissions between consecutive UDS updates', async () => {
    const trade = {
      id: 'test-trade-comm',
      symbol: 'BTCUSDT',
      qty: 1.0,
      direction: 'LONG',
      realized_fee: 0,
      binance_order_id: 'entry-123',
      status: 'OPEN',
    } as Trade;
    sessionState.activeTrades = [trade];

    const udsPayload = {
      e: 'ORDER_TRADE_UPDATE',
      E: Date.now(),
      T: Date.now(),
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'entry-123',
        t: 'trade-999', // Unique Binance Trade ID
        n: '2.5', // Commission
        N: 'USDT',
        z: '1.0',
        q: '1.0',
        x: 'TRADE',
        S: 'BUY',
        ap: '50000'
      }
    };

    // First update: should add commission
    await service.handleBinanceOrderUpdate(udsPayload as any);
    expect(trade.realized_fee).toBe(2.5);

    // Second update (duplicate UDS event): should NOT add commission again
    await service.handleBinanceOrderUpdate(udsPayload as any);
    expect(trade.realized_fee).toBe(2.5);
  });
});
