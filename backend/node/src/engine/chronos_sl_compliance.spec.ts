import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderManagerService } from './orderManager';
import { PositionTrackerService } from './positionTracker';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';

describe('Chronos: SL Compliance (Binance FAPI Error -1106)', () => {
  let orderManager: OrderManagerService;
  let binanceClientMock: any;

  beforeEach(async () => {
    binanceClientMock = {
      restAPI: {
        newAlgoOrder: jest.fn(),
        newOrder: jest.fn(),
        queryOrder: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        { provide: PositionTrackerService, useValue: { isRatcheting: jest.fn().mockReturnValue(false) } },
        { provide: SessionStateService, useValue: { realTimeOrders: new Map(), config: { trailing_guard_buffer_pct: 0.5 } } },
        EventEmitter2,
        { provide: SignalEngineService, useValue: {} },
        { provide: RiskEngineService, useValue: {} },
        { provide: MarketFeedService, useValue: { getSymbolFilters: jest.fn().mockReturnValue({ tickSize: 0.01, stepSize: 0.001, pricePrecision: 2, qtyPrecision: 3 }) } },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn().mockReturnValue(50000), getTicker: jest.fn() } },
        { provide: KlineStoreService, useValue: {} },
        { provide: MonitoringService, useValue: { recordHotLoop: jest.fn(), incrementApiRequests: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn(), update: jest.fn() } },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    (orderManager as any).binanceClient = binanceClientMock;
    (orderManager as any).paperMode = false;
  });

  it('should satisfy compliance by omitting quantity when closePosition: true in fallback path', async () => {
    const trade = {
      id: 'test-trade-compliance',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.0,
      initial_sl: 49000,
      current_sl: 49000,
      status: 'OPEN',
      binance_order_id: 'ent-123'
    } as any;

    // 1. Mock newAlgoOrder to fail with "Order type not supported" to trigger fallback
    binanceClientMock.restAPI.newAlgoOrder.mockRejectedValue(new Error('Order type not supported (-4120)'));

    // 2. Mock newOrder (fallback) to return success
    binanceClientMock.restAPI.newOrder.mockResolvedValue({
      headers: {},
      data: jest.fn().mockResolvedValue({ orderId: 'fallback-sl-123', status: 'NEW' })
    });

    await orderManager.placeStopLoss(trade, 49000);

    // 3. Verify standard newOrder was called
    expect(binanceClientMock.restAPI.newOrder).toHaveBeenCalled();

    const callArgs = binanceClientMock.restAPI.newOrder.mock.calls[0][0];

    // VERIFICATION: 'quantity' MUST be omitted if 'closePosition' is true (Error -1106)
    expect(callArgs.closePosition).toBe(true);
    expect(callArgs.quantity).toBeUndefined();
  });
});
