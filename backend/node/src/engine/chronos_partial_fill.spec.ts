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
import { ENGINE_EVENTS } from './events';
import { EXIT_REASONS } from '../models/constants';

describe('Chronos: Partial Fill and Quantity Integrity', () => {
  let orderManager: OrderManagerService;
  let positionTracker: PositionTrackerService;
  let sessionState: SessionStateService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        PositionTrackerService,
        SessionStateService,
        EventEmitter2,
        { provide: SignalEngineService, useValue: { checkEntry: jest.fn() } },
        { provide: RiskEngineService, useValue: { canEnter: jest.fn() } },
        { provide: MarketFeedService, useValue: { getSymbolFilters: jest.fn().mockReturnValue({ tickSize: 0.01, stepSize: 0.001, pricePrecision: 2, qtyPrecision: 3 }) } },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn().mockReturnValue(50000), getTicker: jest.fn() } },
        { provide: KlineStoreService, useValue: { cleanupOldKlines: jest.fn() } },
        { provide: MonitoringService, useValue: { recordHotLoop: jest.fn(), incrementApiRequests: jest.fn(), recordUdsPing: jest.fn(), setUdsStatus: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn() } },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Initial state: 1.0 BTC @ 50000
    const trade = {
      id: 'trade-12345678-1234-1234-1234-123456789012',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.0,
      initial_sl: 49000,
      current_sl: 49000,
      status: 'OPEN',
      pnl: -20, // entry fee
      realized_fee: 20,
      risk_usdt: 1000,
      binance_stop_order_id: 'sl-order-id'
    } as any;

    sessionState.activeTrades = [trade];
    positionTracker.addTrade(trade);
  });

  it('should synchronize trade.qty and realized_fee on partial SL hit from UDS', async () => {
    const trade = sessionState.activeTrades[0];

    // Simulate partial SL hit: 0.4 BTC @ 49000
    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: 'sl-order-id',
        c: 'sl-trade-12',
        l: '0.4', // last executed quantity
        z: '0.4', // cumulative filled
        q: '1.0', // original quantity
        L: '49000', // last price
        n: '8', // slice commission
        x: 'TRADE',
        S: 'SELL',
        ot: 'STOP_MARKET',
        ap: '49000'
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    await orderManager.handleBinanceOrderUpdate(payload);

    // EXPECTATION: trade.qty should be updated to reflects the remaining position (1.0 - 0.4 = 0.6)
    expect(trade.qty).toBe(0.6);
    expect(trade.realized_fee).toBe(28); // 20 (entry) + 8 (slice)
    expect(emitSpy).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, expect.objectContaining({ symbol: 'BTCUSDT', qty: 0.6 }));
  });

  it('should restore trade.qty and prioritize weighted average price on final SL hit', async () => {
    const trade = sessionState.activeTrades[0];
    trade.qty = 0.6; // Assuming partial fill already occurred
    trade.realized_fee = 28;

    // Simulate final slice: 0.6 BTC @ 48500
    // Weighted average price (ap) for total 1.0 becomes (0.4*49000 + 0.6*48500) / 1.0 = 48700
    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'sl-order-id',
        c: 'sl-trade-12',
        l: '0.6',
        z: '1.0', // total cumulative filled
        q: '1.0',
        L: '48500',
        n: '12', // final slice commission
        x: 'TRADE',
        S: 'SELL',
        ot: 'STOP_MARKET',
        ap: '48700' // AUTHORITATIVE AVERAGE PRICE
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    await orderManager.handleBinanceOrderUpdate(payload);

    // EXPECTATION: trade.qty should be restored to 1.0 for closeTrade to calculate final PnL correctly
    expect(trade.qty).toBe(1.0);
    expect(trade.realized_fee).toBe(40); // 28 + 12

    // Final exit event should use avgPrice (ap)
    expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT',
      exitPrice: 48700,
      reason: expect.stringMatching(/SL_HIT/)
    }));
  });
});
