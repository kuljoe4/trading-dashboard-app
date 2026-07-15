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

describe('Chronos: PnL and Balance Integrity', () => {
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
    // We need the real LifecycleService but with mocked dependencies
    sessionLifecycleService = module.get<SessionLifecycleService>(SessionLifecycleService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);

    // Initial state
    sessionState.balanceLive = 1000;
    (tradingSessionService as any).config = { paper_mode: false, trading_mode: 'live' };
    (tradingSessionService as any).running = true;
  });

  describe('Balance Race (Double-Counting Delta)', () => {
    it('should NOT double-count PnL delta if ACCOUNT_UPDATE arrives before handleTradeUpdate', async () => {
      const trade = {
        id: 'trade-race',
        symbol: 'BTCUSDT',
        pnl: 0,
      } as Trade;

      // 1. Initial state: Balance = 1000, trade.pnl = 0
      sessionState.balanceLive = 1000;
      (tradingSessionService as any).appliedPnL.set(trade.id, 0);

      // 2. Simulating a trade update that realized +10 PnL (e.g. from ORDER_TRADE_UPDATE)
      // On Binance, ACCOUNT_UPDATE usually arrives very quickly after ORDER_TRADE_UPDATE.

      // 3. ACCOUNT_UPDATE arrives FIRST: Balance is now 1010 on exchange
      const accountUpdate = {
        e: 'ACCOUNT_UPDATE',
        a: {
          m: 'ORDER',
          B: [{ a: 'USDT', wb: '1010' }],
          P: []
        }
      };

      // Manually trigger handleAccountUpdate (using real one from LifecycleService)
      const realLifecycle = new (LifecycleService as any)(
        sessionState,
        { setBinanceClient: jest.fn() },
        { fetchExchangeInfo: jest.fn() },
        {},
        positionTracker,
        {},
        {},
        { emit: jest.fn() },
        { findOne: jest.fn(), update: jest.fn() }
      );
      realLifecycle.handleAccountUpdate(accountUpdate);

      expect(sessionState.balanceLive).toBe(1010);

      // 4. handleTradeUpdate arrives SECOND (local event propagation delay)
      // It sees trade.pnl has moved from 0 to 10.
      trade.pnl = 10;
      await tradingSessionService.handleTradeUpdate({ trade });

      // BUG: If it applies the delta (+10) to balanceLive (1010), it becomes 1020.
      // RED-TEST: We expect it to be 1010.
      expect(sessionState.balanceLive).toBe(1010);
    });
  });

  describe('Funding Blindness (Session PnL Drift)', () => {
    it('should capture funding fees from ACCOUNT_UPDATE and attribute them to trades', async () => {
      const trade = {
        id: 'trade-funding',
        symbol: 'BTCUSDT',
        pnl: 100,
        funding_fee: 0,
        qty: 1.0,
        entry_price: 50000,
      } as Trade;

      sessionState.activeTrades = [trade];
      positionTracker.activeList = jest.fn().mockReturnValue([trade]);
      (tradingSessionService as any).appliedPnL.set(trade.id, 100);
      sessionState.balanceLive = 1100;
      sessionState.stats.totalPnl = 100;

      // Simulate FUNDING_FEE event: USDT balance decreases by 5
      const fundingEvent = {
        e: 'ACCOUNT_UPDATE',
        a: {
          m: 'FUNDING_FEE',
          B: [{ a: 'USDT', wb: '1095', bc: '-5' }],
          P: [{ s: 'BTCUSDT', pa: '1.0', ep: '50000' }]
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
        { findOne: jest.fn(), update: jest.fn() }
      );

      // We need to mock eventEmitter.emit because handleAccountUpdate will emit TRADE_UPDATED
      const mockEventEmitter = { emit: jest.fn() };
      (realLifecycle as any).eventEmitter = mockEventEmitter;

      realLifecycle.handleAccountUpdate(fundingEvent);

      // 1. Balance should be updated
      expect(sessionState.balanceLive).toBe(1095);

      // 2. Trade funding_fee should be updated (Real-time attribution)
      // RED-TEST: Currently it doesn't do this.
      expect(trade.funding_fee).toBe(5);
      expect(trade.pnl).toBe(95); // 100 - 5

      // 3. It should have emitted TRADE_UPDATED to sync stats
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(ENGINE_EVENTS.TRADE_UPDATED, expect.objectContaining({
        trade,
        pnlDelta: -5
      }));
    });
  });
});
