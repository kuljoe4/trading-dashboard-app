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
import { TradingSessionService } from './trading_session.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { AnalyticsService } from './analytics.service';
import { ExecutionService } from './execution.service';
import { SessionLifecycleService } from './session-lifecycle.service';
import { BroadcastService } from './broadcast.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { GatingService } from './gating.service';
import { MaintenanceService } from './maintenance.service';

describe('Chronos: Data Integrity and PnL Synchronization', () => {
  let orderManager: OrderManagerService;
  let tradingSession: TradingSessionService;
  let sessionState: SessionStateService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        TradingSessionService,
        SessionStateService,
        EventEmitter2,
        { provide: PositionTrackerService, useValue: { activeList: () => sessionState.activeTrades, activeCount: () => sessionState.activeTrades.length, getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn(), isRatcheting: () => false, isEntering: () => false, isClosing: () => false, addTrade: jest.fn(), isClosingSymbol: () => false } },
        { provide: SignalEngineService, useValue: { checkEntry: jest.fn() } },
        { provide: RiskEngineService, useValue: { canEnter: jest.fn() } },
        { provide: MarketFeedService, useValue: { getSymbolFilters: jest.fn().mockReturnValue({ tickSize: 0.01, stepSize: 0.001, pricePrecision: 2, qtyPrecision: 3 }), setCandleCloseCallback: jest.fn() } },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn().mockReturnValue(50000), getTicker: jest.fn(), clear: jest.fn() } },
        { provide: KlineStoreService, useValue: { cleanupOldKlines: jest.fn(), clear: jest.fn() } },
        { provide: MonitoringService, useValue: { recordHotLoop: jest.fn(), incrementApiRequests: jest.fn(), recordUdsPing: jest.fn(), setUdsStatus: jest.fn(), clearAppMetrics: jest.fn(), setLoopStage: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn() } },
        { provide: MomentumScannerService, useValue: { scan: jest.fn(), start: jest.fn(), stop: jest.fn() } },
        { provide: AnalyticsService, useValue: { calculateAnalytics: jest.fn() } },
        { provide: ExecutionService, useValue: { checkExits: jest.fn(), processEntries: jest.fn() } },
        { provide: SessionLifecycleService, useValue: { start: jest.fn(), stop: jest.fn(), isUdsConnected: true } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        { provide: VariantAnalyticsService, useValue: { calculateVariantStats: jest.fn() } },
        { provide: EngineBroadcasterService, useValue: { broadcastTick: jest.fn(), serializeTrade: (t: any) => t, minimize: jest.fn() } },
        { provide: GatingService, useValue: { isInsideTradingWindow: () => true, canEnter: () => ({ canEnter: true }), mapGateState: () => null } },
        { provide: MaintenanceService, useValue: { protectionWatchdog: jest.fn(), reconcileLiveState: jest.fn() } },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    tradingSession = module.get<TradingSessionService>(TradingSessionService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    (orderManager as any).paperMode = false;
    (orderManager as any).takerFeeRate = 0.0004;

    sessionState.balanceLive = 10000;
    sessionState.stats.totalPnl = 0;
  });

  it('should accumulate realized profit (rp) from UDS and sync to session balance', async () => {
    const trade = {
      id: 'trade-pnl-sync',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.0,
      status: 'OPEN',
      pnl: -20, // entry fee
      realized_fee: 20,
    } as any;

    sessionState.activeTrades = [trade];
    // Manually register it in sessionState idempotency maps to match live behavior
    (sessionState as any).appliedGlobalPnL.set(trade.id, -20);

    // Simulate partial SL hit with 100 USDT realized profit (e.g. trailing SL well in profit)
    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: 'sl-123',
        c: 'sl-trade',
        l: '0.5',
        z: '0.5',
        q: '1.0',
        L: '50200',
        n: '10', // commission for this slice
        rp: '100', // authoritative realized profit for this slice
        t: 'fill-1',
        x: 'TRADE',
        S: 'SELL',
        ot: 'STOP_MARKET',
        ap: '50200'
      }
    };

    // Before: Balance = 10000, Session totalPnl = -20 (entry fee)
    sessionState.stats.totalPnl = -20;
    // Initialize TradingSession appliedPnL map
    (tradingSession as any).appliedPnL.set(trade.id, -20);

    // Manually link the event handler for this test since NestJS decorators aren't active
    jest.spyOn(eventEmitter, 'emit').mockImplementation((event, payload: any) => {
      if (event === ENGINE_EVENTS.TRADE_UPDATED) {
        tradingSession.handleTradeUpdate(payload);
      }
      return true;
    });

    await orderManager.handleBinanceOrderUpdate(payload as any);

    // EXPECTATION 1: Trade PnL should be updated
    // New PnL = Old PnL (-20) + Realized Profit (+100) - Slice Fee (10) = 70
    expect(trade.pnl).toBe(70);
    expect(trade.realized_fee).toBe(30); // 20 + 10

    // EXPECTATION 2: Session balance and totalPnl should be synced via event
    // Delta was +90.
    // Total PnL should be 70.
    // Balance should be 10090.
    expect(sessionState.stats.totalPnl).toBe(70);
    expect(sessionState.balanceLive).toBe(10090);
  });

  it('should NOT close trade locally on partial external fills (Ghost Position Protection)', async () => {
    const trade = {
      id: 'trade-ghost-protection',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.0,
      status: 'OPEN',
      binance_stop_order_id: 'engine-sl-id'
    } as any;

    sessionState.activeTrades = [trade];

    // Simulate an external fill (e.g. user manually sold half on Binance UI)
    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'external-order-id', // NOT engine-sl-id
        c: 'web_random_id',
        l: '0.5',
        z: '0.5',
        q: '0.5',
        L: '50500',
        n: '10',
        t: 'fill-ext',
        x: 'TRADE',
        S: 'SELL',
        ot: 'MARKET',
        ap: '50500'
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    await orderManager.handleBinanceOrderUpdate(payload as any);

    // EXPECTATION: Trade should NOT be closed.
    expect(trade.status).toBe('OPEN');
    expect(emitSpy).not.toHaveBeenCalledWith('trade.exchange_close', expect.anything());

    // If it was the FULL position but still an external order, it still shouldn't close via ORDER_TRADE_UPDATE
    const fullExternalPayload = {
      ...payload,
      o: { ...payload.o, l: '1.0', z: '1.0', q: '1.0', i: 'external-full-id' }
    };
    await orderManager.handleBinanceOrderUpdate(fullExternalPayload as any);
    expect(trade.status).toBe('OPEN');
    expect(emitSpy).not.toHaveBeenCalledWith('trade.exchange_close', expect.anything());
  });

  it('should close trade locally if order has closePosition: true (cp) flag', async () => {
    const trade = {
      id: 'trade-cp-close',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.0,
      status: 'OPEN',
    } as any;

    sessionState.activeTrades = [trade];

    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'some-sl-id',
        c: 'some-client-id',
        l: '1.0',
        z: '1.0',
        q: '1.0',
        L: '49000',
        cp: true, // CLOSE_POSITION flag
        x: 'TRADE',
        S: 'SELL',
        ot: 'STOP_MARKET',
      }
    };

    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    await orderManager.handleBinanceOrderUpdate(payload as any);

    // EXPECTATION: Trade SHOULD be closed because cp: true is an authoritative close signal
    expect(emitSpy).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT'
    }));
  });
});
