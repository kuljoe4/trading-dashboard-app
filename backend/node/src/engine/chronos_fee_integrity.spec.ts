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

describe('Chronos: Fee Integrity and Double-Counting Prevention', () => {
  let orderManager: OrderManagerService;
  let sessionState: SessionStateService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        { provide: PositionTrackerService, useValue: { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn(), isEntering: jest.fn(), isClosing: jest.fn() } },
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
    sessionState = module.get<SessionStateService>(SessionStateService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Mock live mode
    (orderManager as any).paperMode = false;
    (orderManager as any).takerFeeRate = 0.0004; // 0.04%
  });

  it('should not double-count fees when a trade is closed via UDS-confirmed fill', async () => {
    const trade = {
      id: 'test-trade-fee-integrity',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.0,
      initial_sl: 49000,
      current_sl: 49000,
      status: 'OPEN',
      realized_fee: 20, // entry fee (0.04% of 50000)
      binance_stop_order_id: 'sl-123'
    } as any;

    sessionState.activeTrades = [trade];

    // 1. Simulate UDS SL Hit event with authoritative commission
    const udsPayload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'sl-123',
        c: 'sl-test',
        q: '1.0',
        z: '1.0',
        L: '49000',
        n: '19.6', // SL exit fee (0.04% of 49000)
        x: 'TRADE',
        S: 'SELL',
        ot: 'STOP_MARKET',
        ap: '49000',
        t: 'trade-id-456' // Unique Binance trade ID
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    await orderManager.handleBinanceOrderUpdate(udsPayload as any);

    // Verify UDS commission was accumulated correctly
    expect(trade.realized_fee).toBe(20 + 19.6);

    // Verify the exit event signals that fees are already accounted for
    expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT',
      feesAlreadyAccounted: true
    }));

    // 2. Directly call closeTrade (simulating downstream flow) with feesAlreadyAccounted: true
    const result = await orderManager.closeTrade(
      'BTCUSDT',
      trade,
      49000,
      EXIT_REASONS.SL_HIT,
      false, // paperMode = false
      true,  // localOnly = true (exchange already flat)
      { feesAlreadyAccounted: true }
    );

    // VERIFICATION: realized_fee should remain 39.6, NOT increase by an estimated 19.6
    expect(result.trade.realized_fee).toBe(39.6);
  });

  it('should still estimate fees for local-only closures if feesAlreadyAccounted is false', async () => {
    const trade = {
      id: 'test-trade-estimate',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.0,
      status: 'OPEN',
      realized_fee: 20,
      binance_order_id: 'ent-123'
    } as any;

    const result = await orderManager.closeTrade(
      'BTCUSDT',
      trade,
      49000,
      EXIT_REASONS.EXCHANGE_SYNC,
      false, // paperMode = false
      true,  // localOnly = true
      { feesAlreadyAccounted: false }
    );

    // VERIFICATION: realized_fee should include estimated exit fee (39.6)
    expect(result.trade.realized_fee).toBe(39.6);
  });
});
