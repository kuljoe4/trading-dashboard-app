import { SessionLifecycleService } from './session-lifecycle.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { BinanceAccountUpdateEvent } from '../models/binance.types';

describe('SessionLifecycleService Benchmark', () => {
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
      closedTrades: [],
      balanceLive: 0,
      balancePaper: 0,
      lastExchangeBalance: 0,
      lastUdsBalanceUpdate: 0,
      udsConfirmedClosedTrades: new Set(),
      config: { paper_mode: false },
      assetBalances: new Map()
    };

    orderManager = {
      isRatcheting: jest.fn().mockReturnValue(false),
      setBinanceClient: jest.fn(),
    };
    positionTracker = {
      getInFlightEntry: jest.fn().mockReturnValue(null),
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
      { log: jest.fn(), debug: jest.fn(), warn: jest.fn() } as any,
      eventEmitter,
      { broadcast: jest.fn() } as any,
      { findOne: jest.fn() } as any
    );
  });

  it('measures handleAccountUpdate performance', () => {
    // Setup 100 active trades
    const numTrades = 100;
    const trades: Trade[] = [];
    const positions: any[] = [];

    for (let i = 0; i < numTrades; i++) {
      const symbol = `SYM${i}USDT`;
      trades.push({
        id: `trade-${i}`,
        symbol,
        qty: 1.0,
        entry_price: 100,
        status: 'OPEN'
      } as any);

      positions.push({
        s: symbol,
        pa: '1.0',
        ep: '100'
      });
    }

    sessionState.activeTrades = trades;

    const event: BinanceAccountUpdateEvent = {
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        B: [],
        P: positions
      }
    } as any;

    const iterations = 1000;

    // Warmup
    for (let i = 0; i < 100; i++) {
      service.handleAccountUpdate(event);
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      service.handleAccountUpdate(event);
    }
    const end = performance.now();

    const durationMs = end - start;
    console.log(`handleAccountUpdate benchmark: ${durationMs.toFixed(2)} ms for ${iterations} iterations with ${numTrades} positions`);

    // Test should just pass
    expect(true).toBe(true);
  });
});
