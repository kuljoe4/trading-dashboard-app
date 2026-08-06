import { Test, TestingModule } from '@nestjs/testing';
import { OrderManagerService } from './orderManager';
import { SessionStateService } from './session_state.service';
import { TickerCacheService } from './ticker_cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderFilterService } from './order-filter.service';
import { MarketFeedService } from './market_feed.service';
import { AuditLogService } from '../trading/audit-log.service';
import { SignalEngineService } from './signalEngine';
import { MonitoringService } from './monitoring.service';
import { PositionTrackerService } from './positionTracker';
import { BroadcastService } from './broadcast.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { Trade } from '../models/Trade';
import { EXIT_REASONS } from '../models/constants';
import { ENGINE_EVENTS } from './events';

describe('closeTrade illiquid_blocked close attempts increment regression test', () => {
  let orderManager: OrderManagerService;
  let mockBinanceClient: any;
  let mockSessionState: any;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn(),
      },
    };

    mockSessionState = {
      realTimePositions: new Map(),
      setActiveTrades: jest.fn(),
      realTimeOrders: new Map(),
      isRateLimited: jest.fn().mockReturnValue(false),
      isBanned: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        {
          provide: SignalEngineService,
          useValue: {},
        },
        {
          provide: MonitoringService,
          useValue: {
            incrementApiRequests: jest.fn(),
          },
        },
        {
          provide: PositionTrackerService,
          useValue: {},
        },
        {
          provide: BroadcastService,
          useValue: {},
        },
        {
          provide: getRepositoryToken(SettingsEntity),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: SessionStateService,
          useValue: mockSessionState,
        },
        {
          provide: TickerCacheService,
          useValue: {
            getPrice: jest.fn().mockReturnValue(100),
            getTicker: jest.fn().mockReturnValue({ mark_price: 100, price: 100 }),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: OrderFilterService,
          useValue: {
            applyFilters: jest.fn().mockReturnValue({ price: 100, qty: 1 }),
          },
        },
        {
          provide: MarketFeedService,
          useValue: {
            getSymbolFilters: jest.fn().mockReturnValue({ qtyPrecision: 2, pricePrecision: 2 }),
          },
        },
        {
          provide: AuditLogService,
          useValue: {},
        },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    await orderManager.setBinanceClient(mockBinanceClient, false);
  });

  it('should increment close_attempts and update last_close_attempt_ts when entering via illiquid_blocked shortcut', async () => {
    const trade = {
      id: 'trade-uuid-456',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entry_price: 100,
      current_sl: 95,
      binance_order_id: '12345',
      illiquid_blocked: true,
      close_attempts: 1,
      last_close_attempt_ts: 0,
    } as any as Trade;

    mockBinanceClient.restAPI.newOrder.mockResolvedValue({
      data: () => ({ orderId: 'limit-close-id', executedQty: '0' }),
    });

    const result = await orderManager.closeTrade('BTCUSDT', trade, 100, EXIT_REASONS.SL_HIT, false, false);

    expect(result.exitOccurred).toBe(false);
    expect(trade.close_attempts).toBe(2);
    expect(trade.last_close_attempt_ts).toBeGreaterThan(0);
    expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(ENGINE_EVENTS.TRADE_UPDATED, { trade });
  });
});
