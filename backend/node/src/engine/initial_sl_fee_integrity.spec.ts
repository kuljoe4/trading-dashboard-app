import { OrderFilterService } from './order-filter.service';
import { BroadcastService } from './broadcast.service';
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
import { EXIT_REASONS } from '../models/constants';

describe('Chronos: Initial Stop Loss Fee Integrity Spec', () => {
  let orderManager: OrderManagerService;
  let sessionState: SessionStateService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => ({ price: val, qty: 1.0 })), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
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

  it('should emit feesAlreadyAccounted: true for INITIAL_SL hits and prevent fee double-counting', async () => {
    // Construct an open trade where current_sl === initial_sl (Initial SL state)
    const trade = {
      id: 'test-initial-sl-trade',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.0,
      initial_sl: 49000,
      current_sl: 49000, // <--- current_sl === initial_sl (INITIAL_SL)
      status: 'OPEN',
      realized_fee: 20, // Entry fee (0.04% of 50,000)
      pnl: -20,
      binance_stop_order_id: 'sl-initial-999'
    } as any;

    sessionState.activeTrades = [trade];

    // UDS ORDER_TRADE_UPDATE payload for initial SL fill
    const udsPayload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'sl-initial-999',
        c: 'sl-initial-client-id',
        q: '1.0',
        z: '1.0',
        L: '49000',
        n: '19.6', // SL exit fee from Binance (0.04% of 49,000)
        rp: '-1000', // Realized profit/loss on Binance
        x: 'TRADE',
        S: 'SELL',
        ot: 'STOP_MARKET',
        ap: '49000',
        t: 'trade-exec-101'
      }
    };

    let capturedExchangeClosePayload: any = null;
    eventEmitter.on('trade.exchange_close', (p) => {
      capturedExchangeClosePayload = p;
    });

    await orderManager.handleBinanceOrderUpdate(udsPayload as any);

    // 1. Verify that handleBinanceOrderUpdate accumulated the UDS fee once
    expect(trade.realized_fee).toBe(20 + 19.6);

    // 2. Verify that feesAlreadyAccounted is TRUE even for INITIAL_SL
    expect(capturedExchangeClosePayload).not.toBeNull();
    expect(capturedExchangeClosePayload.feesAlreadyAccounted).toBe(true);
    expect(capturedExchangeClosePayload.alreadyRealized).toBe(true);

    // 3. Process closeTrade with the event payload options
    const result = await orderManager.closeTrade(
      'BTCUSDT',
      trade,
      49000,
      EXIT_REASONS.SL_HIT,
      false, // paperMode = false
      true,  // localOnly = true
      {
        feesAlreadyAccounted: capturedExchangeClosePayload.feesAlreadyAccounted,
        alreadyRealized: capturedExchangeClosePayload.alreadyRealized
      }
    );

    // 4. Verify that realized_fee is NOT double-counted with estimated exit fee
    expect(result.trade.realized_fee).toBe(39.6);
    // Net PnL = gross (-1000) - realized_fee (39.6) = -1039.6
    expect(result.trade.pnl).toBe(-1039.6);
  });
});
