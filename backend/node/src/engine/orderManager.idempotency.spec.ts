import { Test, TestingModule } from '@nestjs/testing';
import { OrderManagerService } from './orderManager';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { MonitoringService } from './monitoring.service';
import { SessionStateService } from './session_state.service';
import { AuditLogService } from '../trading/audit-log.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { Trade } from '../models/Trade';
import { EXIT_REASONS } from '../models/constants';

describe('OrderManagerService Idempotency', () => {
  let service: OrderManagerService;
  let binanceClient: any;
  let sessionState: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        { provide: SignalEngineService, useValue: {} },
        {
          provide: MarketFeedService,
          useValue: { getSymbolFilters: () => ({ stepSize: 0.01, tickSize: 0.01, qtyPrecision: 2 }) },
        },
        { provide: TickerCacheService, useValue: { getTicker: () => ({ price: 100 }), getPrice: () => 100 } },
        { provide: MonitoringService, useValue: { incrementApiRequests: () => {} } },
        {
          provide: SessionStateService,
          useValue: {
            getBalance: () => 1000,
            updateRateLimit: () => {},
            updateOrderRateLimits: () => {},
            getBinanceRateLimit: () => ({ used_weight_1m: 0, limit: 1200 }),
            isRateLimited: () => false,
            realTimePositions: new Map(),
            activeTrades: [],
          },
        },
        { provide: AuditLogService, useValue: { log: () => {} } },
        { provide: EventEmitter2, useValue: { emit: () => {} } },
        {
          provide: getRepositoryToken(SettingsEntity),
          useValue: { findOne: () => Promise.resolve({}), update: () => Promise.resolve({}) },
        },
      ],
    }).compile();

    service = module.get<OrderManagerService>(OrderManagerService);
    sessionState = module.get<SessionStateService>(SessionStateService);

    binanceClient = {
      restAPI: {
        newOrder: jest.fn(),
        queryOrder: jest.fn(),
        cancelAllOpenOrders: jest.fn(),
      },
    };
  });

  it('recovers from network timeout during closeTrade using queryOrder', async () => {
    service.setBinanceClient(binanceClient, false); // Live mode

    const trade: Trade = {
      id: 'test-uuid-1234567890',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1.0,
      entry_price: 50000,
      binance_order_id: 'original_entry_id',
      status: 'OPEN',
    } as any;

    // 1. First attempt fails with network timeout
    binanceClient.restAPI.newOrder.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    // 2. Second attempt (retry) fails with Duplicate clientOrderId -2011
    binanceClient.restAPI.newOrder.mockResolvedValueOnce({
      data: () => Promise.resolve({ code: -2011, msg: 'Duplicate clientOrderId' }),
      headers: { get: () => '10' }
    });

    // 3. queryOrder succeeds and returns the filled order details
    binanceClient.restAPI.queryOrder.mockResolvedValueOnce({
      data: () => Promise.resolve({
        orderId: 'exchange_close_id',
        status: 'FILLED',
        avgPrice: '51000',
        executedQty: '1.0',
        cumQuote: '51000'
      }),
      headers: { get: () => '11' }
    });

    const result = await service.closeTrade('BTCUSDT', trade, 51000, EXIT_REASONS.TP_HIT, false);

    expect(result.exitOccurred).toBe(true);
    expect(result.trade.exit_price).toBe(51000);
    expect(result.trade.binance_close_order_id).toBe('exchange_close_id');
    expect(binanceClient.restAPI.newOrder).toHaveBeenCalledTimes(2);
    expect(binanceClient.restAPI.queryOrder).toHaveBeenCalled();
  });
});
