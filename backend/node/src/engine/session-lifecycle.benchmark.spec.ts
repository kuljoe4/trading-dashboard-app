import { SessionLifecycleService } from './session-lifecycle.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { Trade } from '../models/Trade';

describe('SessionLifecycleService Benchmark', () => {
  it('benchmark zero-weight reconciliation', () => {
     const dataAP: any[] = [];
     const SYMBOL_COUNT = 500;
     for (let i = 0; i < SYMBOL_COUNT; i++) {
        dataAP.push({ s: 'SYM' + i, pa: "0", ep: "10" });
     }

     // Mock service implementation
     const sessionState = {
         activeTrades: [] as Trade[],
         closedTrades: [] as Trade[],
         udsConfirmedClosedTrades: new Set(),
         realTimePositions: new Map()
     };
     for (let i = 0; i < SYMBOL_COUNT; i++) {
        const symbol = 'SYM' + i;
        if (i < 250) {
            sessionState.activeTrades.push({ symbol, id: 'id' + i, status: 'OPEN', qty: 10, entry_price: 10 } as unknown as Trade);
        } else {
            sessionState.closedTrades.push({ symbol, id: 'id' + i, status: 'CLOSED', qty: 10, entry_price: 10 } as unknown as Trade);
        }
     }

     const positionTracker = {
         getInFlightEntry: (sym: string) => null,
         addTrade: (t: any) => {},
         isEntering: (sym: string) => false,
         isClosing: (sym: string) => false,
     };
     const orderManager = {
         isRatcheting: (sym: string) => false,
     };

     const service = new SessionLifecycleService(
         sessionState as any,
         orderManager as any,
         {} as any,
         {} as any,
         positionTracker as any,
         {} as any,
         {} as any,
         new EventEmitter2(),
         { broadcast: () => {} } as any,
         {} as any,
     );
     (service as any)['logger'] = new Logger();

     const ITERATIONS = 100;
     const start = process.hrtime.bigint();
     for (let i=0; i<ITERATIONS; i++) {
         service.handleAccountUpdate({
            e: "ACCOUNT_UPDATE",
            E: Date.now(),
            T: Date.now(),
            a: {
                m: "ORDER",
                P: dataAP
            }
         } as any);
     }
     const end = process.hrtime.bigint();
     console.log(`Execution time: ${Number(end - start) / 1000000} ms`);
  });
});
