import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderManagerService } from './orderManager';
import { SessionStateService } from './session_state.service';
import { PositionTrackerService } from './positionTracker';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { Trade } from '../models/Trade';
import { ENGINE_EVENTS } from './events';
import { EXIT_REASONS } from '../models/constants';

describe('Chronos: External Close PnL Integrity', () => {
  let orderManager: OrderManagerService;
  let sessionState: SessionStateService;
  let positionTracker: PositionTrackerService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        SessionStateService,
        { provide: PositionTrackerService, useValue: { getInFlightEntry: jest.fn(), addTrade: jest.fn(), closeTrade: jest.fn() } },
        { provide: SignalEngineService, useValue: {} },
        { provide: MarketFeedService, useValue: { getSymbolFilters: jest.fn().mockReturnValue({ tickSize: 0.01, stepSize: 0.01 }) } },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn().mockReturnValue(110) } },
        { provide: MonitoringService, useValue: { incrementApiRequests: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn(), update: jest.fn() } },
        EventEmitter2,
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    (orderManager as any).paperMode = false;
  });

  it('should preserve incremental PnL from unrecognized UDS slices when finalized via reconciliation', async () => {
    const trade = {
      id: 'trade-external',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 100,
      qty: 1.0,
      pnl: 0,
      realized_fee: 0,
      status: 'OPEN',
    } as Trade;

    sessionState.activeTrades = [trade];

    // 1. Simulate Unrecognized External Exit Slice (PARTIALLY_FILLED)
    const slice1 = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        x: 'TRADE',
        X: 'PARTIALLY_FILLED',
        i: 12345, // External Order ID
        S: 'SELL',
        ot: 'LIMIT',
        q: '1.0',
        z: '0.4',
        l: '0.4',
        ap: '110',
        n: '0.04', // commission
        rp: '4.0', // realized profit: (110-100)*0.4
        t: 1001, // Trade ID
        T: Date.now(),
      }
    };

    await orderManager.handleBinanceOrderUpdate(slice1 as any);

    // Verify slice 1 application
    expect(trade.qty).toBe(0.6);
    expect(trade.pnl).toBe(3.96); // 4.0 - 0.04
    expect(trade.realized_fee).toBe(0.04);

    // 2. Simulate final slice (FILLED)
    const slice2 = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        x: 'TRADE',
        X: 'FILLED',
        i: 12345,
        S: 'SELL',
        ot: 'LIMIT',
        q: '1.0',
        z: '1.0',
        l: '0.6',
        ap: '110',
        n: '0.06',
        rp: '6.0', // (110-100)*0.6
        t: 1002,
        T: Date.now(),
      }
    };

    await orderManager.handleBinanceOrderUpdate(slice2 as any);

    // Verify slice 2 application
    expect(trade.qty).toBe(0);
    expect(trade.pnl).toBe(9.9); // 3.96 + 6.0 - 0.06
    expect(trade.realized_fee).toBe(0.1);
    expect(trade.status).toBe('OPEN'); // Should still be open locally, waiting for ACCOUNT_UPDATE

    // 3. Simulate ACCOUNT_UPDATE emitting EXCHANGE_CLOSE (Reconciliation)
    // In TradingSessionService.handleExchangeClose:
    // const res = await this.positionTracker.closeTrade(symbol, exitPrice, reason, ..., localOnly, { feesAlreadyAccounted: false });

    // We'll call closeTrade directly as it's the terminal logic
    const closeRes = await orderManager.closeTrade(
      'BTCUSDT',
      trade,
      110, // exitPrice
      EXIT_REASONS.EXCHANGE_SYNC,
      false, // paperMode
      true, // localOnly
      { feesAlreadyAccounted: false } // Crucially false for reconciliation
    );

    // BUG: If it overwrites pnl with (110-100)*0 - realized_fee, it will be -0.1
    // EXPECTATION: It should preserve the 9.9 accumulated from authoritative slices.
    expect(trade.status).toBe('CLOSED_ORPHANED');
    expect(trade.pnl).toBe(9.9);
  });
});
