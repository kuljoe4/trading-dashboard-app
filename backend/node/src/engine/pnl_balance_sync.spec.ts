import { OrderFilterService } from './order-filter.service';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TradingSessionService } from './trading_session.service';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionStateService } from './session_state.service';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { MonitoringService } from './monitoring.service';
import { AnalyticsService } from './analytics.service';
import { ExecutionService } from './execution.service';
import { SessionLifecycleService as LifecycleService } from './session-lifecycle.service';
import { BroadcastService } from './broadcast.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { GatingService } from './gating.service';
import { MaintenanceService } from './maintenance.service';
import { AuditLogService } from '../trading/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { ENGINE_EVENTS } from './events';
import { Trade } from '../models/Trade';

describe('Option A - Local PnL Fallback and UDS Synchronization Integrity', () => {
  let tradingSessionService: TradingSessionService;
  let sessionLifecycleService: SessionLifecycleService;
  let sessionState: SessionStateService;
  let positionTracker: PositionTrackerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        TradingSessionService,
        SessionLifecycleService,
        SessionStateService,
        { provide: PositionTrackerService, useValue: { activeList: jest.fn(), activeCount: jest.fn(), recalculateTotalRisk: jest.fn(), totalRisk: jest.fn(), addTrade: jest.fn(), removeTrade: jest.fn(), getInFlightEntry: jest.fn(), isClosing: jest.fn() } },
        { provide: OrderManagerService, useValue: { setBinanceClient: jest.fn(), getTakerFeeRate: jest.fn().mockReturnValue(0.0004), isRatcheting: jest.fn(), fetchAllPositions: jest.fn(), fetchOpenOrders: jest.fn(), fetchPosition: jest.fn() } },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn(), clear: jest.fn() } },
        { provide: KlineStoreService, useValue: { clear: jest.fn() } },
        { provide: SignalEngineService, useValue: {} },
        { provide: RiskEngineService, useValue: { canEnter: jest.fn() } },
        { provide: MarketFeedService, useValue: { setCandleCloseCallback: jest.fn(), start: jest.fn(), stop: jest.fn(), fetchExchangeInfo: jest.fn() } },
        { provide: MomentumScannerService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: MonitoringService, useValue: { recordHotLoop: jest.fn(), recordMainLoop: jest.fn(), incrementApiRequests: jest.fn(), setLoopStage: jest.fn(), clearAppMetrics: jest.fn(), getMetrics: jest.fn().mockReturnValue({ application: {} }), recordUdsPing: jest.fn(), setUdsStatus: jest.fn() } },
        { provide: AnalyticsService, useValue: { calculateAnalytics: jest.fn() } },
        { provide: ExecutionService, useValue: { checkExits: jest.fn(), processEntries: jest.fn() } },
        { provide: SessionLifecycleService, useValue: { start: jest.fn(), stop: jest.fn(), startUserDataStream: jest.fn() } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        { provide: VariantAnalyticsService, useValue: { calculateVariantStats: jest.fn() } },
        { provide: EngineBroadcasterService, useValue: { broadcastTick: jest.fn(), serializeTrade: jest.fn(), getLastAnalyticsResult: jest.fn(), minimize: jest.fn() } },
        { provide: GatingService, useValue: { isInsideTradingWindow: jest.fn(), mapGateState: jest.fn(), enterHibernation: jest.fn(), exitHibernation: jest.fn() } },
        { provide: MaintenanceService, useValue: { protectionWatchdog: jest.fn(), reconcileLiveState: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn() } },
        EventEmitter2,
      ],
    }).compile();

    tradingSessionService = module.get<TradingSessionService>(TradingSessionService);
    sessionLifecycleService = module.get<SessionLifecycleService>(SessionLifecycleService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);

    // Initial state setup
    sessionState.balanceLive = 1000;
    (tradingSessionService as any).config = { paper_mode: false, trading_mode: 'live' };
    (tradingSessionService as any).running = true;
    (tradingSessionService as any).binanceClient = { restAPI: {} }; // Mock live mode binanceClient
  });

  it('should apply local fallback balance adjustment when handleTradeUpdate is called and no UDS ACCOUNT_UPDATE event has arrived yet', async () => {
    const trade = {
      id: 'trade-race-fallback',
      symbol: 'BTCUSDT',
      pnl: 15,
      status: 'CLOSED_SIGNAL'
    } as Trade;

    sessionState.balanceLive = 1000;
    (tradingSessionService as any).appliedPnL.set(trade.id, 0);

    // Act: Trigger trade update before UDS ACCOUNT_UPDATE arrives
    await tradingSessionService.handleTradeUpdate({ trade });

    // Assert: Balance should immediately be adjusted by the fallback (+15)
    expect(sessionState.balanceLive).toBe(1015);
    expect(sessionState.localTradePnLAdjustments.get(trade.id)).toBe(15);
  });

  it('should NOT double-count the delta if UDS ACCOUNT_UPDATE arrives first, and then handleTradeUpdate is called', async () => {
    const trade = {
      id: 'trade-race-uds-first',
      symbol: 'BTCUSDT',
      pnl: 0,
      status: 'CLOSED_SIGNAL'
    } as Trade;

    sessionState.balanceLive = 1000;
    (tradingSessionService as any).appliedPnL.set(trade.id, 0);

    // 1. ACCOUNT_UPDATE arrives first. Real absolute balance goes to 1015.
    const accountUpdate = {
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        B: [{ a: 'USDT', wb: '1015' }],
        P: []
      }
    };

    const realLifecycle = new (LifecycleService as any)(
      sessionState,
      { setBinanceClient: jest.fn() },
      { fetchExchangeInfo: jest.fn() },
      {},
      positionTracker,
      {},
      {},
      { emit: jest.fn() },
      { broadcast: jest.fn() },
      { findOne: jest.fn(), update: jest.fn() }
    );

    // Mock activeTrades to contain this trade so handleAccountUpdate adds it to udsConfirmedClosedTrades
    sessionState.activeTrades = [trade];
    realLifecycle.handleAccountUpdate(accountUpdate as any);

    // Assert absolute balance is set
    expect(sessionState.balanceLive).toBe(1015);
    expect(sessionState.udsConfirmedClosedTrades.has(trade.id)).toBe(true);

    // 2. Local handleTradeUpdate arrives second with the realized PnL (+15)
    trade.pnl = 15;
    await tradingSessionService.handleTradeUpdate({ trade });

    // Assert: PnL delta should NOT be double-counted! Balance should remain exactly 1015.
    expect(sessionState.balanceLive).toBe(1015);
  });

  it('should handle state recovery if UDS ACCOUNT_UPDATE arrives second, overwriting the fallback accurately', async () => {
    const trade = {
      id: 'trade-race-uds-second',
      symbol: 'BTCUSDT',
      pnl: 20,
      status: 'CLOSED_SIGNAL'
    } as Trade;

    sessionState.balanceLive = 1000;
    (tradingSessionService as any).appliedPnL.set(trade.id, 0);

    // 1. handleTradeUpdate runs first, applying local fallback +20
    await tradingSessionService.handleTradeUpdate({ trade });
    expect(sessionState.balanceLive).toBe(1020);

    // 2. ACCOUNT_UPDATE arrives second, setting the authoritative balance to 1020
    const accountUpdate = {
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        B: [{ a: 'USDT', wb: '1020' }],
        P: []
      }
    };

    const realLifecycle = new (LifecycleService as any)(
      sessionState,
      { setBinanceClient: jest.fn() },
      { fetchExchangeInfo: jest.fn() },
      {},
      positionTracker,
      {},
      {},
      { emit: jest.fn() },
      { broadcast: jest.fn() },
      { findOne: jest.fn(), update: jest.fn() }
    );

    realLifecycle.handleAccountUpdate(accountUpdate as any);

    // Assert: Authoritative exchange balance is set and trade is added to confirmed list
    expect(sessionState.balanceLive).toBe(1020);
  });
});
