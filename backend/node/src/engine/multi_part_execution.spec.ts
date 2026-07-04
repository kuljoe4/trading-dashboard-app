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

describe('Multi-part Execution Handling', () => {
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
      initial_sl: 49000,
      binance_stop_order_id: 'sl-12345',
      direction: 'LONG',
      status: 'OPEN',
      sl_adjustments: []
    }];
  });

  it('should handle multi-part SL execution by syncing remaining qty and restoring on final fill', async () => {
    const trade = sessionState.activeTrades[0];
    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    // 1. First Partial Fill (40% filled)
    const partialPayload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: 'sl-12345',
        c: 'sl-test-tra',
        z: '0.4', // Cumulative filled
        q: '1.0', // Original qty
        x: 'TRADE',
        ap: '49000',
        S: 'SELL',
        ot: 'STOP_MARKET'
      }
    };

    await orderManager.handleBinanceOrderUpdate(partialPayload);

    // Verify quantity synced to remaining (0.6)
    expect(trade.qty).toBe(0.6);
    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, { symbol: 'BTCUSDT', qty: 0.6 });

    // 2. Final Fill (100% filled)
    const finalPayload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'sl-12345',
        c: 'sl-test-tra',
        z: '1.0', // Cumulative filled
        q: '1.0', // Original qty
        x: 'TRADE',
        ap: '49000',
        S: 'SELL',
        ot: 'STOP_MARKET'
      }
    };

    await orderManager.handleBinanceOrderUpdate(finalPayload);

    // Verify quantity restored to original (1.0) before closure for correct PnL
    expect(trade.qty).toBe(1.0);
    expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT',
      exitPrice: 49000
    }));
  });

  it('should handle multi-part manual/TP execution by syncing remaining qty and restoring on final fill', async () => {
    const trade = sessionState.activeTrades[0];
    const emitSpy = jest.spyOn(eventEmitter, 'emit');

    // 1. First Partial Fill (50% filled)
    const partialPayload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: 'cls-12345',
        c: 'cls-test-tra',
        z: '0.5', // Cumulative filled
        q: '1.0', // Original qty
        x: 'TRADE',
        ap: '51000',
        S: 'SELL',
        ot: 'MARKET'
      }
    };

    await orderManager.handleBinanceOrderUpdate(partialPayload);

    // Verify quantity synced to remaining (0.5)
    expect(trade.qty).toBe(0.5);
    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, { symbol: 'BTCUSDT', qty: 0.5 });

    // 2. Final Fill (100% filled)
    const finalPayload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'cls-12345',
        c: 'cls-test-tra',
        z: '1.0', // Cumulative filled
        q: '1.0', // Original qty
        x: 'TRADE',
        ap: '51000',
        S: 'SELL',
        ot: 'MARKET'
      }
    };

    await orderManager.handleBinanceOrderUpdate(finalPayload);

    // Verify quantity restored to original (1.0) before closure
    expect(trade.qty).toBe(1.0);
    expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT',
      exitPrice: 51000
    }));
  });
});
