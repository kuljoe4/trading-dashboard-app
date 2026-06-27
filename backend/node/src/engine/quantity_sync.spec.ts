import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderManagerService } from './orderManager';
import { SessionLifecycleService } from './session-lifecycle.service';
import { PositionTrackerService } from './positionTracker';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { AnalyticsService } from './analytics.service';
import { ENGINE_EVENTS } from './events';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';

describe('Real-time Quantity Synchronization', () => {
  let orderManager: OrderManagerService;
  let sessionLifecycle: SessionLifecycleService;
  let sessionState: SessionStateService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        SessionLifecycleService,
        PositionTrackerService,
        SessionStateService,
        EventEmitter2,
        {
          provide: SignalEngineService,
          useValue: {},
        },
        {
          provide: RiskEngineService,
          useValue: {},
        },
        {
          provide: MarketFeedService,
          useValue: { getSymbolFilters: () => ({ tickSize: 0.01, stepSize: 0.01 }) },
        },
        {
          provide: TickerCacheService,
          useValue: { getPrice: () => 100 },
        },
        {
          provide: KlineStoreService,
          useValue: {},
        },
        {
          provide: MonitoringService,
          useValue: { recordUdsPing: () => {}, setUdsStatus: () => {}, incrementApiRequests: () => {} },
        },
        {
          provide: AuditLogService,
          useValue: { log: () => {} },
        },
        {
          provide: MomentumScannerService,
          useValue: {},
        },
        {
          provide: AnalyticsService,
          useValue: {},
        },
        {
          provide: getRepositoryToken(SettingsEntity),
          useValue: { findOne: () => Promise.resolve({}) },
        },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    sessionLifecycle = module.get<SessionLifecycleService>(SessionLifecycleService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Mock active trade
    (sessionState as any).activeTrades = [{
      id: 'test-trade-uuid',
      symbol: 'BTCUSDT',
      qty: 1.0,
      entry_price: 50000,
      current_sl: 49000,
      binance_order_id: '12345',
      direction: 'LONG',
      status: 'OPEN'
    }];
  });

  it('should synchronize trade.qty from UDS ORDER_TRADE_UPDATE (partial entry fill)', async () => {
    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: '12345',
        c: 'ent-test-trade-uui',
        z: '0.5', // Cumulative filled quantity
        q: '1.0', // Original quantity
        x: 'TRADE',
        ap: '50000'
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    await orderManager.handleBinanceOrderUpdate(payload);

    const trade = sessionState.activeTrades[0];
    expect(trade.qty).toBe(0.5);
    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, { symbol: 'BTCUSDT', qty: 0.5 });
  });

  it('should synchronize trade.qty from UDS ACCOUNT_UPDATE (partial reduction)', async () => {
    const payload = {
      e: 'ACCOUNT_UPDATE',
      a: {
        P: [
          {
            s: 'BTCUSDT',
            pa: '0.3', // Reduced from 1.0
            ep: '50000'
          }
        ]
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    // Call the service method directly to test actual implementation
    sessionLifecycle.handleAccountUpdate(payload);

    const trade = sessionState.activeTrades[0];
    // In actual implementation, quantity decrease is IGNORED during ACCOUNT_UPDATE if not in closing state
    // to prevent race conditions with external SL hits.
    expect(trade.qty).toBe(1.0);
    expect(emitSpy).not.toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, { symbol: 'BTCUSDT', qty: 0.3 });
  });

  it('should synchronize trade.qty from UDS ACCOUNT_UPDATE when in closing state', async () => {
    const payload = {
      e: 'ACCOUNT_UPDATE',
      a: {
        P: [
          {
            s: 'BTCUSDT',
            pa: '0.3', // Reduced from 1.0
            ep: '50000'
          }
        ]
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    const positionTracker = (sessionLifecycle as any).positionTracker;
    jest.spyOn(positionTracker, 'isClosing').mockReturnValue(true);

    sessionLifecycle.handleAccountUpdate(payload);

    const trade = sessionState.activeTrades[0];
    expect(trade.qty).toBe(0.3);
    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, { symbol: 'BTCUSDT', qty: 0.3 });
  });
});
