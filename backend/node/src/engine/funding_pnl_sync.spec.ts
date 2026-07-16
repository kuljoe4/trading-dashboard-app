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
import { BroadcastService } from './broadcast.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { GatingService } from './gating.service';
import { MaintenanceService } from './maintenance.service';
import { AuditLogService } from '../trading/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { Trade } from '../models/Trade';
import { OrderFilterService } from './order-filter.service';

describe('Funding PnL Sync Investigation', () => {
  let tradingSessionService: TradingSessionService;
  let sessionLifecycleService: SessionLifecycleService;
  let sessionState: SessionStateService;
  let positionTracker: PositionTrackerService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        TradingSessionService,
        SessionLifecycleService,
        SessionStateService,
        { provide: PositionTrackerService, useValue: { activeList: jest.fn(), activeCount: jest.fn(), recalculateTotalRisk: jest.fn(), totalRisk: jest.fn(), addTrade: jest.fn(), removeTrade: jest.fn(), getInFlightEntry: jest.fn(), isClosing: jest.fn() } },
        { provide: OrderManagerService, useValue: { setBinanceClient: jest.fn(), getTakerFeeRate: jest.fn().mockReturnValue(0.0004), isRatcheting: jest.fn(), fetchAllPositions: jest.fn(), fetchOpenOrders: jest.fn(), fetchPosition: jest.fn(), checkExitSignals: jest.fn() } },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn(), clear: jest.fn() } },
        { provide: KlineStoreService, useValue: { clear: jest.fn() } },
        { provide: SignalEngineService, useValue: { checkEntry: jest.fn() } },
        { provide: RiskEngineService, useValue: { canEnter: jest.fn() } },
        { provide: MarketFeedService, useValue: { setCandleCloseCallback: jest.fn(), start: jest.fn(), stop: jest.fn(), fetchExchangeInfo: jest.fn(), getSymbolFilters: jest.fn() } },
        { provide: MomentumScannerService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: MonitoringService, useValue: { recordHotLoop: jest.fn(), recordMainLoop: jest.fn(), incrementApiRequests: jest.fn(), setLoopStage: jest.fn(), clearAppMetrics: jest.fn(), getMetrics: jest.fn().mockReturnValue({ application: {} }), recordUdsPing: jest.fn(), setUdsStatus: jest.fn(), setUdsStatusLagging: jest.fn() } },
        { provide: AnalyticsService, useValue: { calculateAnalytics: jest.fn() } },
        { provide: ExecutionService, useValue: { checkExits: jest.fn(), processEntries: jest.fn(), setCooldown: jest.fn() } },
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
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Initial state
    sessionState.balanceLive = 1100;
    (tradingSessionService as any).config = { paper_mode: false, trading_mode: 'live', strategy_label: 'Test Strategy' };
    (tradingSessionService as any).running = true;
  });

  it('should synchronize trade.pnl and session stats when a FUNDING_FEE event occurs', async () => {
    const trade = {
      id: 'trade-funding-1',
      symbol: 'BTCUSDT',
      pnl: 100,
      funding_fee: 0,
      qty: 1.0,
      entry_price: 50000,
      strategy_label: 'Test Strategy',
      status: 'OPEN',
      sessionId: 'session-123'
    } as Trade;

    // Set up initial tracking state via reset to ensure all idempotency maps are synced
    sessionState.reset((tradingSessionService as any).config, [], 1100, 'session-123', [trade]);

    positionTracker.activeList = jest.fn().mockReturnValue([trade]);
    (tradingSessionService as any).appliedPnL.set(trade.id, 100);

    // Verify initial state
    expect(sessionState.stats.totalPnl).toBe(100);
    expect(sessionState.balanceLive).toBe(1100);

    // Simulate FUNDING_FEE event: USDT balance decreases by 5
    const fundingEvent = {
      e: 'ACCOUNT_UPDATE' as const,
      E: Date.now(),
      T: Date.now(),
      a: {
        m: 'FUNDING_FEE',
        B: [{ a: 'USDT', wb: '1095', cw: '1095', bc: '-5' }],
        P: [{ s: 'BTCUSDT', pa: '1.0', ep: '50000', cr: '0', up: '0', mt: 'cross', iw: '0', ps: 'BOTH', ma: 'USDT' }]
      }
    };

    // Use handleAccountUpdate to process the event
    sessionLifecycleService.handleAccountUpdate(fundingEvent);

    // 1. Verify SessionState balance is updated
    expect(sessionState.balanceLive).toBe(1095);

    // 2. Verify Trade funding_fee and pnl are updated
    expect(trade.funding_fee).toBe(5);
    expect(trade.pnl).toBe(95);

    // 3. Verify TradingSessionService appliedPnL is updated (to prevent double counting if handleTradeUpdate is called)
    // In the test module, we might need to call handleTradeUpdate manually if events are not automatically wired.
    // But let's check if it double counts if we call it twice.

    await tradingSessionService.handleTradeUpdate({ trade, pnlDelta: -5 });
    expect((tradingSessionService as any).appliedPnL.get(trade.id)).toBe(95);
    expect(sessionState.stats.totalPnl).toBe(95);

    // Second call with same trade state - should NOT change anything further
    await tradingSessionService.handleTradeUpdate({ trade });
    expect((tradingSessionService as any).appliedPnL.get(trade.id)).toBe(95);
    expect(sessionState.stats.totalPnl).toBe(95);

    // If we call it with pnlDelta again, it should NOT double count because appliedPnL was already updated!
    await tradingSessionService.handleTradeUpdate({ trade, pnlDelta: -5 });
    expect(sessionState.stats.totalPnl).toBe(95);
  });
});
