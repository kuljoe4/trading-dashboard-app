import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderManagerService } from './orderManager';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { ENGINE_EVENTS } from './events';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';

describe('SL Partial Fill Synchronization', () => {
  let orderManager: OrderManagerService;
  let sessionState: SessionStateService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        SessionStateService,
        EventEmitter2,
        {
          provide: SignalEngineService,
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
          provide: MonitoringService,
          useValue: { recordUdsPing: () => {}, setUdsStatus: () => {}, incrementApiRequests: () => {} },
        },
        {
          provide: AuditLogService,
          useValue: { log: () => {} },
        },
        {
          provide: getRepositoryToken(SettingsEntity),
          useValue: { findOne: () => Promise.resolve({}) },
        },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Mock active trade
    (sessionState as any).activeTrades = [{
      id: 'test-trade-uuid',
      symbol: 'BTCUSDT',
      qty: 1.0,
      entry_price: 50000,
      current_sl: 49000,
      binance_stop_order_id: 'sl-12345',
      direction: 'LONG',
      status: 'OPEN',
      sl_adjustments: []
    }];

    sessionState.realTimePositions = new Map();
  });

  it('should synchronize trade.qty from UDS PARTIALLY_FILLED SL order', async () => {
    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: 'sl-12345',
        c: 'sl-test-tra',
        z: '0.4', // Cumulative filled quantity
        q: '1.0', // Original quantity
        x: 'TRADE',
        ap: '49000',
        S: 'SELL',
        ot: 'STOP_MARKET'
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    await orderManager.handleBinanceOrderUpdate(payload);

    const trade = sessionState.activeTrades[0];
    // FAIL EXPECTATION: Currently the code doesn't handle PARTIALLY_FILLED for SL
    expect(trade.qty).toBe(0.6);
    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, { symbol: 'BTCUSDT', qty: 0.6 });

    const pos = sessionState.realTimePositions.get('BTCUSDT');
    expect(pos?.amount).toBe(0.6);
  });

  it('should restore trade.qty to total order size on FILLED SL to ensure correct PnL', async () => {
    const trade = sessionState.activeTrades[0];
    trade.qty = 0.6; // Simulate previous partial fill

    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'sl-12345',
        c: 'sl-test-tra',
        z: '1.0', // Total filled quantity
        q: '1.0', // Original quantity
        x: 'TRADE',
        ap: '49000',
        S: 'SELL',
        ot: 'STOP_MARKET'
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    await orderManager.handleBinanceOrderUpdate(payload);

    // The 'trade.exchange_close' event should be emitted
    expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT',
      exitPrice: 49000
    }));

    // Verify trade.qty was restored to 1.0 before the event (or at least it is 1.0 now)
    expect(trade.qty).toBe(1.0);
  });
});
