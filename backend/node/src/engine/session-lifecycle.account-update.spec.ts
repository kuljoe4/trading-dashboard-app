import { SessionLifecycleService } from './session-lifecycle.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_EVENTS } from './events';

/**
 * Regression guard for the batched ACCOUNT_UPDATE capital-safety fix (2026-07-17).
 *
 * A batched `ACCOUNT_UPDATE` can carry multiple positions. The reconciliation guard
 * inside the `for (const pos of data.a.P)` loop must `continue` to the next symbol
 * when one position is mid-transition (ratcheting/entering/closing) — NOT `return`,
 * which would silently drop every other symbol in the same event (e.g. a missed SL
 * closure or quantity sync for an unrelated trade).
 */
describe('SessionLifecycleService - batched ACCOUNT_UPDATE (continue, not return)', () => {
  let service: SessionLifecycleService;
  let eventEmitter: EventEmitter2;
  let sessionState: any;
  let orderManager: any;
  let positionTracker: any;

  beforeEach(() => {
    eventEmitter = new EventEmitter2();
    sessionState = {
      realTimePositions: new Map(),
      activeTrades: [],
      balanceLive: 0,
      balancePaper: 0,
      lastExchangeBalance: 0,
      lastUdsBalanceUpdate: 0,
      udsConfirmedClosedTrades: new Set(),
    };
    // BTCUSDT is mid-transition -> must trigger the `continue` guard.
    orderManager = {
      isRatcheting: jest.fn((s: string) => s === 'BTCUSDT'),
      setBinanceClient: jest.fn(),
    };
    positionTracker = {
      getInFlightEntry: jest.fn(),
      addTrade: jest.fn(),
      isEntering: jest.fn().mockReturnValue(false),
      isClosing: jest.fn().mockReturnValue(false),
    };

    service = new SessionLifecycleService(
      sessionState as any,
      orderManager as any,
      {} as any,
      {} as any,
      positionTracker as any,
      { incrementApiRequests: jest.fn() } as any,
      { log: jest.fn() } as any,
      eventEmitter,
      { broadcast: jest.fn() } as any,
      { findOne: jest.fn() } as any
    );
  });

  it('continues processing remaining positions after one symbol is mid-transition', () => {
    const ethTrade = {
      id: 'eth-trade',
      symbol: 'ETHUSDT',
      qty: 1.0,
      entry_price: 2000,
    } as any;
    sessionState.activeTrades = [ethTrade];

    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    service.handleAccountUpdate({
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        P: [
          { s: 'BTCUSDT', pa: '0', ep: '0' }, // isRatcheting -> continue
          { s: 'ETHUSDT', pa: '1.5', ep: '2100' }, // MUST still be processed
        ],
      },
    } as any);

    // pos1 hit the `continue` guard; the loop must still have processed pos2.
    expect(ethTrade.qty).toBe(1.5); // quantity synced from ACCOUNT_UPDATE
    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, {
      symbol: 'ETHUSDT',
      qty: 1.5,
    });
    expect(sessionState.realTimePositions.get('BTCUSDT')).toEqual({ amount: 0, entryPrice: 0 });
    expect(sessionState.realTimePositions.get('ETHUSDT')).toEqual({ amount: 1.5, entryPrice: 2100 });
  });

  it('reconciles zero position even if prevPos.amount is already 0 when hasActiveTrade is true', () => {
    jest.useFakeTimers();
    (service as any).running = true;

    const ethTrade = {
      id: 'eth-trade',
      symbol: 'ETHUSDT',
      qty: 1.0,
      entry_price: 2000,
    } as any;
    sessionState.activeTrades = [ethTrade];

    // Seed prevPos as 0
    sessionState.realTimePositions.set('ETHUSDT', { amount: 0, entryPrice: 2000 });

    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    service.handleAccountUpdate({
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        P: [
          { s: 'ETHUSDT', pa: '0', ep: '2000' },
        ],
      },
    } as any);

    // Should schedule reconciliation because ETHUSDT is still in activeTrades
    jest.advanceTimersByTime(300);

    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.EXCHANGE_CLOSE, expect.objectContaining({
      symbol: 'ETHUSDT',
      exitPrice: 0,
      isReconciliation: true,
    }));

    jest.useRealTimers();
  });

  it('correctly normalizes TRADE_LITE and ALGO_UPDATE events to ORDER_TRADE_UPDATE', () => {
    const tradeLiteEvent = {
      e: 'TRADE_LITE',
      E: 1785677885069,
      T: 1785677885069,
      s: 'UAIUSDT',
      q: '15',
      p: '0.0000000',
      m: false,
      c: 'sl-735fc0af',
      S: 'SELL',
      L: '0.5292000',
      l: '15',
      t: 121593162,
      i: 710560780
    };

    const normalizedTradeLite = (service as any).normalizeTradeLite(tradeLiteEvent);
    expect(normalizedTradeLite.e).toBe('ORDER_TRADE_UPDATE');
    expect(normalizedTradeLite.o.s).toBe('UAIUSDT');
    expect(normalizedTradeLite.o.c).toBe('sl-735fc0af');
    expect(normalizedTradeLite.o.S).toBe('SELL');
    expect(normalizedTradeLite.o.q).toBe('15');
    expect(normalizedTradeLite.o.L).toBe('0.5292000');
    expect(normalizedTradeLite.o.ap).toBe('0.5292000');
    expect(normalizedTradeLite.o.i).toBe(710560780);
    expect(normalizedTradeLite.o.t).toBe(121593162);
    expect(normalizedTradeLite.o.X).toBe('FILLED');

    const algoUpdateEvent = {
      e: 'ALGO_UPDATE',
      T: 1785677885069,
      E: 1785677885069,
      o: {
        caid: 'sl-735fc0af',
        aid: 3000002115486814,
        at: 'CONDITIONAL',
        o: 'STOP_MARKET',
        s: 'UAIUSDT',
        S: 'SELL',
        ps: 'BOTH',
        f: 'GTC',
        q: '15',
        X: 'NEW'
      }
    };

    const normalizedAlgoUpdate = (service as any).normalizeAlgoUpdate(algoUpdateEvent);
    expect(normalizedAlgoUpdate.e).toBe('ORDER_TRADE_UPDATE');
    expect(normalizedAlgoUpdate.o.s).toBe('UAIUSDT');
    expect(normalizedAlgoUpdate.o.c).toBe('sl-735fc0af');
    expect(normalizedAlgoUpdate.o.S).toBe('SELL');
    expect(normalizedAlgoUpdate.o.q).toBe('15');
    expect(normalizedAlgoUpdate.o.X).toBe('NEW');
    expect(normalizedAlgoUpdate.o.i).toBe(3000002115486814);
  });
});
