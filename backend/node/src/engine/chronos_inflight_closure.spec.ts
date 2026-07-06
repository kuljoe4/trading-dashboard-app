import { Test, TestingModule } from '@nestjs/testing';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { RiskEngineService } from './riskEngine';
import { SignalEngineService } from './signalEngine';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { EXIT_REASONS } from '../models/constants';

describe('Chronos: In-Flight Closure Race Regression', () => {
  let service: PositionTrackerService;
  let orderManager: OrderManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionTrackerService,
        { provide: OrderManagerService, useValue: { closeTrade: jest.fn() } },
        { provide: RiskEngineService, useValue: {} },
        { provide: SignalEngineService, useValue: {} },
        { provide: TickerCacheService, useValue: {} },
        { provide: KlineStoreService, useValue: {} },
        { provide: SessionStateService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<PositionTrackerService>(PositionTrackerService);
    orderManager = module.get<OrderManagerService>(OrderManagerService);
  });

  it('should close a trade that is in-flight but not yet in the trades map', async () => {
    const symbol = 'BTCUSDT';
    const trade = {
      id: 't1',
      symbol,
      status: 'OPEN',
      qty: 1.0,
      entry_price: 50000,
    } as Trade;

    // Simulate trade in-flight (OrderManager.enter just finished newOrder but not yet returned to ExecutionService)
    service.setInFlight(symbol, trade);

    expect(service.activeCount()).toBe(0);
    expect(service.getInFlightEntry(symbol)).toBe(trade);

    // Mock successful exchange close
    (orderManager.closeTrade as jest.Mock).mockResolvedValue({
      exitOccurred: true,
      trade: { ...trade, status: 'CLOSED_SL', exit_price: 49000, pnl: -1000 }
    });

    // ACT: Trigger closure (e.g. from handleExchangeClose)
    const result = await service.closeTrade(symbol, 49000, EXIT_REASONS.SL_HIT, {} as any, false, true);

    // ASSERT: Should have succeeded by finding the trade in in-flight registry
    expect(result.exitOccurred).toBe(true);
    expect(result.trade?.status).toBe('CLOSED_SL');

    // Should be removed from in-flight
    expect(service.getInFlightEntry(symbol)).toBeUndefined();
  });

  it('addTrade should skip adding a trade that was already closed while in-flight', async () => {
     const symbol = 'ETHUSDT';
     const trade = {
       id: 't2',
       symbol,
       status: 'CLOSED_SL', // Already closed by in-flight handler
       qty: 1.0,
       entry_price: 2500,
       exit_price: 2400,
     } as Trade;

     // ACT: ExecutionService calls addTrade with the entry result
     // (which we've updated to terminal status in the background)
     service.addTrade(trade);

     // ASSERT: Should NOT be in active list
     expect(service.activeCount()).toBe(0);
     expect(service.hasSymbol(symbol)).toBe(false);
  });
});
