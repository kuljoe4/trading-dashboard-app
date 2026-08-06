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

describe('updateStopLoss FILLED status audit check regression test', () => {
  let orderManager: OrderManagerService;
  let mockBinanceClient: any;
  let mockSessionState: any;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    mockBinanceClient = {
      restAPI: {
        queryOrder: jest.fn(),
        cancelOrder: jest.fn(),
      },
    };

    mockSessionState = {
      realTimePositions: new Map(),
      setActiveTrades: jest.fn(),
      realTimeOrders: new Map(),
      isRateLimited: jest.fn().mockReturnValue(false),
      isBanned: jest.fn().mockReturnValue(false),
      hasOrderCapacity: jest.fn().mockReturnValue(true),
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
          useValue: {},
        },
        {
          provide: MarketFeedService,
          useValue: {},
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

  it('should short-circuit and emit EXCHANGE_CLOSE when audit query finds existing SL order is FILLED', async () => {
    const trade = {
      id: 'trade-uuid-123',
      symbol: 'BTCUSDT',
      binance_order_id: '11111',
      binance_stop_order_id: '22222',
      binance_stop_order_type: 'standard',
      current_sl: 95000,
    } as any as Trade;

    // First cancel tracked order cancels successfully
    mockBinanceClient.restAPI.cancelOrder.mockResolvedValue({
      data: () => ({ status: 'CANCELED' }),
    });

    // Then audit query for duplicate SL by deterministic Client ID returns FILLED
    mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
      data: () => ({
        orderId: '33333',
        status: 'FILLED',
        avgPrice: '94990',
        price: '95000',
      }),
    });

    const result = await orderManager.updateStopLoss(trade, 96000);

    expect(result.success).toBe(false);
    expect(mockBinanceClient.restAPI.queryOrder).toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(ENGINE_EVENTS.EXCHANGE_CLOSE, expect.objectContaining({
      symbol: 'BTCUSDT',
      exitPrice: 94990,
      reason: EXIT_REASONS.EXCHANGE_SYNC,
      orderId: '33333',
    }));
  });
});
