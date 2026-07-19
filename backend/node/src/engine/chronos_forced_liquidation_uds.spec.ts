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

describe('Forced Liquidation & UDS Stop-Loss Recovery', () => {
  let orderManager: OrderManagerService;
  let mockBinanceClient: any;
  let mockSessionState: any;

  beforeEach(async () => {
    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn(),
        cancelBinanceOrder: jest.fn(),
        positionInformationV3: jest.fn(),
        queryOrder: jest.fn(),
        accountTradeList: jest.fn(),
      },
    };

    mockSessionState = {
      realTimePositions: new Map(),
      setActiveTrades: jest.fn(),
      realTimeOrders: new Map(),
      isRateLimited: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        {
          provide: SignalEngineService,
          useValue: {
            checkEntry: jest.fn(),
            calculateIndicators: jest.fn(),
          },
        },
        {
          provide: MonitoringService,
          useValue: {
            incrementApiRequests: jest.fn(),
            setUdsStatus: jest.fn(),
          },
        },
        {
          provide: PositionTrackerService,
          useValue: {
            activeList: jest.fn(),
            getInFlightEntry: jest.fn(),
            closeTrade: jest.fn(),
            isClosing: jest.fn().mockReturnValue(false),
            recalculateTotalRisk: jest.fn(),
          },
        },
        {
          provide: BroadcastService,
          useValue: {
            broadcast: jest.fn(),
          },
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
            applyFilters: jest.fn((sym, price, qty) => ({ price, qty })),
            checkLeverageBracket: jest.fn().mockReturnValue({ isAllowed: true }),
          },
        },
        {
          provide: MarketFeedService,
          useValue: {
            getSymbolFilters: jest.fn().mockReturnValue({ stepSize: 0.001, pricePrecision: 2, qtyPrecision: 3 }),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    (orderManager as any).binanceClient = mockBinanceClient;
    (orderManager as any).paperMode = false;
  });

  it('should set closeSuccess = true and skip re-arming SL when forced close fails with REDUCE_ONLY and positionAmt is 0', async () => {
    const trade: Trade = {
      id: 'trade-uuid-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entry_price: 50000,
      initial_sl: 49000,
      current_sl: 49000,
      status: 'OPEN',
      binance_order_id: 'entry-order-1',
      binance_stop_order_id: '123456789',
      close_attempts: 0,
    } as any;

    // Simulate cancelBinanceOrder being called proactively and then newOrder fails with REDUCE_ONLY
    mockBinanceClient.restAPI.newOrder.mockRejectedValue(new Error('ReduceOnly Order would immediately trigger or conflict'));

    // Mock position query to confirm position is already closed (positionAmt = 0)
    mockBinanceClient.restAPI.positionInformationV3.mockResolvedValue({
      data: () => Promise.resolve([{ positionAmt: '0' }]),
    });

    // Mock queryOrder for recovery
    mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
      data: () => Promise.resolve({
        orderId: '123456789',
        status: 'FILLED',
        avgPrice: '49000',
        type: 'STOP_MARKET',
      }),
    });

    const placeStopLossSpy = jest.spyOn(orderManager, 'placeStopLoss').mockResolvedValue(null);

    const result = await orderManager.closeTrade('BTCUSDT', trade, 49000, EXIT_REASONS.MANUAL_CLOSE, false, false);

    expect(result.exitOccurred).toBe(true);
    expect(trade.status).toBe('CLOSED');
    // Ensure we did NOT re-place any stop loss since closeSuccess was set to true on zero position!
    expect(placeStopLossSpy).not.toHaveBeenCalled();
  });

  it('should query tracked stop-loss order ID in recoverClosingContext when targetOrderId is not supplied', async () => {
    const trade: Trade = {
      id: 'trade-uuid-2',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entry_price: 50000,
      initial_sl: 49000,
      current_sl: 49000,
      status: 'OPEN',
      binance_stop_order_id: '1234567890',
    } as any;

    mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
      data: () => Promise.resolve({
        orderId: '1234567890',
        status: 'FILLED',
        avgPrice: '48950',
        type: 'STOP_MARKET',
        stopPrice: '49000',
      }),
    });

    const recovery = await orderManager.recoverClosingContext('BTCUSDT', trade, 49000);

    // Should have queried the tracked stop-loss and retrieved its exact fill price and mapped reason
    expect(mockBinanceClient.restAPI.queryOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      orderId: BigInt('1234567890'),
    });
    expect(recovery.price).toBe(48950);
    expect(recovery.reason).toBe(`${EXIT_REASONS.SL_HIT}_INITIAL_SL`);
  });
});
