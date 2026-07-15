import { OrderFilterService } from './order-filter.service';
import { BroadcastService } from './broadcast.service';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderManagerService } from './orderManager';
import { PositionTrackerService } from './positionTracker';
import { SessionStateService } from './session_state.service';
import { TickerCacheService } from './ticker_cache.service';
import { MarketFeedService } from './market_feed.service';
import { SignalEngineService } from './signalEngine';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { Trade } from '../models/Trade';
import { ENGINE_EVENTS } from './events';

describe('Chronos: In-Flight Entry Promotion', () => {
  let orderManager: OrderManagerService;
  let positionTracker: PositionTrackerService;
  let sessionState: SessionStateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        OrderManagerService,
        {
          provide: PositionTrackerService,
          useValue: {
            getInFlightEntry: jest.fn(),
            addTrade: jest.fn(),
            clearInFlight: jest.fn(),
            activeList: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: SessionStateService,
          useValue: {
            activeTrades: [],
            realTimeOrders: new Map(),
            realTimePositions: new Map(),
            updateStatsOnEntry: jest.fn(),
          },
        },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn() } },
        { provide: MarketFeedService, useValue: { getSymbolFilters: jest.fn() } },
        { provide: SignalEngineService, useValue: {} },
        { provide: MonitoringService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
        { provide: getRepositoryToken(SettingsEntity), useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    sessionState = module.get<SessionStateService>(SessionStateService);
  });

  it('should promote an in-flight entry to active list upon UDS fill', async () => {
    const symbol = 'BTCUSDT';
    const tradeId = 'trade-123';
    const trade = { id: tradeId, symbol, status: 'OPEN', qty: 1.0 } as Trade;

    // Simulate trade is in-flight
    (positionTracker.getInFlightEntry as jest.Mock).mockReturnValue(trade);

    // Mock UDS Order Update Event
    const udsEvent = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: symbol,
        X: 'FILLED', // Status
        x: 'TRADE',  // Execution Type
        z: '1.0',    // Cumulative filled qty
        q: '1.0',    // Original qty
        ap: '50000', // Avg Price
        i: '12345',  // Order ID
        c: 'ent-trade123' // Client Order ID
      }
    };

    // Trigger UDS handler
    await orderManager.handleBinanceOrderUpdate(udsEvent as any);

    // EXPECTATION: The trade should be promoted via positionTracker.addTrade()
    // Current implementation does NOT do this, it only matches if already in activeTrades.
    expect(positionTracker.addTrade).toHaveBeenCalledWith(expect.objectContaining({
      id: tradeId,
      symbol
    }));
  });
});
