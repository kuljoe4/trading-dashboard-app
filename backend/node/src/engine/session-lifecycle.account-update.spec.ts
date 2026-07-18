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
});
