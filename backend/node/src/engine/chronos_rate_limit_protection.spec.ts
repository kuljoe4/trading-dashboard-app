import { OrderFilterService } from './order-filter.service';
import { BroadcastService } from './broadcast.service';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { PositionTrackerService } from './positionTracker';

describe('Chronos: Rate Limit Protection Gap Regression', () => {
  let orderManager: OrderManagerService;
  let sessionState: SessionStateService;
  let mockBinanceClient: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        OrderManagerService,
        {
          provide: SessionStateService,
          useValue: {
            binanceOrderLimit: { used_10s: 299, limit_10s: 300, used_1m: 500, limit_1m: 1200 },
            isRateLimited: jest.fn().mockReturnValue(false),
            isBanned: jest.fn().mockReturnValue(false),
            isOrderRateLimited: jest.fn().mockReturnValue(false), // Current implementation might return false even at 299
            binanceRateLimit: { used_1m: 100, limit: 2400 },
            realTimeOrders: new Map(),
            realTimePositions: new Map(),
          },
        },
        { provide: SignalEngineService, useValue: {} },
        {
          provide: MarketFeedService,
          useValue: {
            getSymbolFilters: jest.fn().mockReturnValue({
              tickSize: 0.01,
              stepSize: 0.001,
              pricePrecision: 2,
              qtyPrecision: 3,
            }),
          },
        },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn().mockReturnValue(50000), getTicker: jest.fn() } },
        { provide: MonitoringService, useValue: { incrementApiRequests: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn() } },
        { provide: PositionTrackerService, useValue: { isRatcheting: jest.fn() } },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    sessionState = module.get<SessionStateService>(SessionStateService);

    mockBinanceClient = {
      restAPI: {
        cancelOrder: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ status: 'CANCELED' }), headers: {} }),
        newAlgoOrder: jest.fn(),
        queryOrder: jest.fn().mockRejectedValue(new Error('Not found')),
      },
    };
    orderManager.setBinanceClient(mockBinanceClient, false);
  });

  it('should DEFER ratchet if order capacity is low (Protection hardening)', async () => {
    const trade = {
      id: 'test-trade-hardened',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1.0,
      entry_price: 50000,
      current_sl: 49000,
      binance_stop_order_id: '12345678',
      binance_stop_order_type: 'standard',
      binance_order_id: 'ent-123',
      status: 'OPEN',
    } as any as Trade;

    // Mock hasOrderCapacity to return false
    (sessionState.hasOrderCapacity as jest.Mock) = jest.fn().mockReturnValue(false);

    // ACT: Attempt to update Stop Loss
    const result = await orderManager.updateStopLoss(trade, 49500);

    // ASSERT:
    expect(result.success).toBe(false);

    // THE FIX: The trade.binance_stop_order_id is still preserved because we deferred the ratchet
    expect(trade.binance_stop_order_id).toBe('12345678');

    // Verify that no exchange mutation was attempted
    expect(mockBinanceClient.restAPI.cancelOrder).not.toHaveBeenCalled();
    expect(mockBinanceClient.restAPI.newAlgoOrder).not.toHaveBeenCalled();
  });
});
