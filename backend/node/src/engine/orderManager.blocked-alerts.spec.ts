import { OrderManagerService } from './orderManager';
import { ENGINE_EVENTS } from './events';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Regression guard for capital-at-risk ALERT visibility (2026-07-17).
 *
 * When an automated close exhausts the attempt ceiling (PERCENT_PRICE / REDUCE_ONLY /
 * generic failure), the trade is marked `close_blocked` and must surface in the UI
 * alert banner via `ENGINE_EVENTS.ALERT` (not only `LOG_MESSAGE`). A `close_blocked`
 * trade can only be cleared by manual intervention, so silent failures are dangerous.
 */
describe('OrderManagerService - close_blocked / illiquid_blocked ALERT (regression guard)', () => {
  let service: OrderManagerService;
  let eventEmitter: EventEmitter2;
  let sessionState: any;
  let marketFeed: any;
  let tickerCache: any;

  beforeEach(() => {
    eventEmitter = new EventEmitter2();
    sessionState = {
      realTimeOrders: new Map(),
      realTimePositions: new Map(),
      activeTrades: [],
      isRateLimited: jest.fn().mockReturnValue(false),
      updateRateLimit: jest.fn(),
      updateOrderRateLimits: jest.fn(),
      getBinanceRateLimit: jest.fn().mockReturnValue({ used_1m: 0, limit: 2400 }),
      isBanned: jest.fn().mockReturnValue(false),
    };
    marketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({
        stepSize: 0.001,
        qtyPrecision: 8,
        tickSize: 0.01,
        minNotional: 5,
        notionalPrecision: 2,
        pricePrecision: 2,
      }),
    };
    tickerCache = {
      getPrice: jest.fn().mockReturnValue(100),
      getTicker: jest.fn().mockReturnValue({ mark_price: 100, price: 100 }),
    };

    service = new OrderManagerService(
      {} as any,
      marketFeed,
      tickerCache,
      { incrementApiRequests: jest.fn() } as any,
      { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn() } as any,
      sessionState,
      { broadcast: jest.fn() } as any,
      { log: jest.fn() } as any,
      eventEmitter,
      { findOne: jest.fn(), update: jest.fn() } as any,
      { applyFilters: jest.fn().mockReturnValue({ price: 100, qty: 1.0 }) } as any
    );

    // Fail every exchange close so the catch block is reached.
    (service as any).binanceClient = {
      restAPI: {
        newOrder: jest.fn().mockRejectedValue(new Error('SomeExchangeError')),
      },
    };
    jest.spyOn(service as any, 'checkCircuitBreaker').mockReturnValue(false);
    // closeTrade defaults to paper mode; force LIVE so the exchange-close path
    // (and the close_blocked ceiling) is exercised.
    (service as any).paperMode = false;
  });

  it('emits ENGINE_EVENTS.ALERT (Close Blocked) and sets close_blocked at the attempt ceiling', async () => {
    const trade: any = {
      id: 'trade-1',
      symbol: 'ETHUSDT',
      qty: 1.0,
      direction: 'LONG',
      entry_price: 100,
      current_sl: 90,
      status: 'OPEN',
      binance_order_id: 'entry-123',
      binance_stop_order_id: undefined,
      close_attempts: 5, // >= MAX_CLOSE_ATTEMPTS (5)
      last_close_attempt_ts: Date.now() - 90000, // satisfy backoff so we reach the catch
      illiquid_blocked: false,
      close_blocked: false,
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    const res = await service.closeTrade('ETHUSDT', trade, 100, 'SIGNAL_EXIT');

    expect(trade.close_blocked).toBe(true);
    expect(res.exitOccurred).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith(
      ENGINE_EVENTS.ALERT,
      expect.objectContaining({ level: 'error', title: 'Close Blocked' })
    );
  });

  it('illiquid_blocked shortcut actively attempts the aggressive LIMIT fallback (dead-code fix)', async () => {
    // Regression guard for the previously-dead reroute: an already-illiquid trade used to
    // `throw new Error('PERCENT_PRICE')` at the TOP of closeTrade (outside the MARKET-close
    // try/catch), so it propagated to the outer catch and silently returned exitOccurred:false
    // WITHOUT ever placing the LIMIT order. The LIMIT fallback must now actually run.
    const newOrder = jest.fn().mockResolvedValue({
      data: async () => ({ orderId: 99999, executedQty: '0', origQty: '1.0' }),
    });
    (service as any).binanceClient = { restAPI: { newOrder } };

    const trade: any = {
      id: 'trade-illiquid',
      symbol: 'SOLUSDT',
      qty: 1.0,
      direction: 'LONG',
      entry_price: 100,
      current_sl: 90,
      status: 'OPEN',
      binance_order_id: 'entry-illiquid',
      binance_stop_order_id: 'sl-illiquid',
      close_attempts: 2, // below ceiling so the LIMIT is attempted (not escalated to close_blocked)
      last_close_attempt_ts: Date.now() - 60000, // satisfy backoff so we reach the fallback
      illiquid_blocked: true,
      close_blocked: false,
    };

    const res = await service.closeTrade('SOLUSDT', trade, 100, 'SIGNAL_EXIT');

    // The LIMIT fallback MUST have been attempted for an already-illiquid trade.
    expect(newOrder).toHaveBeenCalledTimes(1);
    expect(newOrder).toHaveBeenCalledWith(expect.objectContaining({ type: 'LIMIT', reduceOnly: true }));
    // We do not synchronously finalize closure; the LIMIT fills via UDS (or the watchdog closes).
    expect(res.exitOccurred).toBe(false);
    // The shortcut intentionally does NOT cancel the existing SL, so protection stays in place.
    expect(trade.binance_stop_order_id).toBe('sl-illiquid');
  });
});
