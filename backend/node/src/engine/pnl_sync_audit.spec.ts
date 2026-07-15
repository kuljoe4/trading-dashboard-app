import { OrderFilterService } from './order-filter.service';
import { Test, TestingModule } from '@nestjs/testing';
import { TradingSessionService } from './trading_session.service';
import { SessionStateService } from './session_state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { ENGINE_EVENTS } from './events';
import { EXIT_REASONS } from '../models/constants';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { MonitoringService } from './monitoring.service';
import { AnalyticsService } from './analytics.service';
import { ExecutionService } from './execution.service';
import { SessionLifecycleService } from './session-lifecycle.service';
import { BroadcastService } from './broadcast.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { GatingService } from './gating.service';
import { MaintenanceService } from './maintenance.service';
import { AuditLogService } from '../trading/audit-log.service';

describe('PnL Synchronization Audit', () => {
  let tradingSession: TradingSessionService;
  let sessionState: SessionStateService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        TradingSessionService,
        SessionStateService,
        EventEmitter2,
        { provide: TickerCacheService, useValue: { getPrice: jest.fn(), clear: jest.fn() } },
        { provide: KlineStoreService, useValue: { clear: jest.fn() } },
        { provide: SignalEngineService, useValue: {} },
        { provide: RiskEngineService, useValue: { canEnter: () => ({ canEnter: true }) } },
        { provide: PositionTrackerService, useValue: {
            activeList: jest.fn().mockReturnValue([]),
            activeCount: jest.fn().mockReturnValue(0),
            totalRisk: jest.fn().mockReturnValue(0),
            recalculateTotalRisk: jest.fn(),
            isClosing: jest.fn().mockReturnValue(false),
            removeTrade: jest.fn(),
            clear: jest.fn(),
        } },
        { provide: OrderManagerService, useValue: { getTakerFeeRate: () => 0.0005, setBinanceClient: jest.fn() } },
        { provide: MarketFeedService, useValue: { setCandleCloseCallback: jest.fn(), fetchExchangeInfo: jest.fn() } },
        { provide: MomentumScannerService, useValue: {} },
        { provide: MonitoringService, useValue: { recordHotLoop: jest.fn(), recordMainLoop: jest.fn(), setLoopStage: jest.fn(), clearAppMetrics: jest.fn() } },
        { provide: AnalyticsService, useValue: { calculateAnalytics: jest.fn() } },
        { provide: ExecutionService, useValue: { setCooldown: jest.fn() } },
        { provide: SessionLifecycleService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: BroadcastService, useValue: { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } },
        { provide: VariantAnalyticsService, useValue: { calculateVariantStats: jest.fn() } },
        { provide: EngineBroadcasterService, useValue: { serializeTrade: (t: any) => t, minimize: jest.fn(), getLastAnalyticsResult: jest.fn(), getLastRiskResult: jest.fn() } },
        { provide: GatingService, useValue: { isInsideTradingWindow: () => true, mapGateState: () => null, enterHibernation: jest.fn(), exitHibernation: jest.fn() } },
        { provide: MaintenanceService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    tradingSession = module.get<TradingSessionService>(TradingSessionService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    const config = new SessionConfig();
    config.paper_mode = true;
    config.paper_starting_balance = 10000;
    sessionState.reset(config, [], 10000);

    // Explicitly set running to true and config in tradingSession for tests
    (tradingSession as any).running = true;
    (tradingSession as any).config = config;
  });

  it('should maintain PnL integrity during incremental updates and closure', async () => {
    const tradeId = 'test-trade';
    const trade = {
      id: tradeId,
      symbol: 'BTCUSDT',
      pnl: -2.0, // Initial entry fee
      status: 'OPEN',
    } as Trade;

    // 1. Initial Entry
    await (tradingSession as any).handleTradeUpdate({ trade });

    // In TradingSessionService, appliedPnL is private, but it affects sessionState.balancePaper
    expect(sessionState.balancePaper).toBe(9998);
    expect(sessionState.stats.totalPnl).toBe(-2.0);

    // 2. Incremental Update (e.g., funding fee)
    trade.pnl = -2.1;
    await (tradingSession as any).handleTradeUpdate({ trade });

    expect(sessionState.balancePaper).toBe(9997.9);
    expect(sessionState.stats.totalPnl).toBe(-2.1);

    // 3. Significant PnL move
    trade.pnl = 10.0;
    await (tradingSession as any).handleTradeUpdate({ trade });

    expect(sessionState.balancePaper).toBe(10010.0);
    expect(sessionState.stats.totalPnl).toBe(10.0);

    // 4. Final Closure
    trade.status = 'CLOSED';
    trade.pnl = 9.5; // Final adjustment (exit fee)

    // In the real system, finalizeTradeClosure is called after positionTracker.closeTrade
    // We can simulate this by calling handleTradeUpdate which is an event handler in TradingSessionService
    // But finalizeTradeClosure also calls updateStatsOnClose and addClosedTrade.

    // Let's use the event handler for the final update
    await (tradingSession as any).handleTradeUpdate({ trade });

    expect(sessionState.balancePaper).toBe(10009.5);
    expect(sessionState.stats.totalPnl).toBe(9.5);

    // Double closure check (idempotency)
    await (tradingSession as any).handleTradeUpdate({ trade });
    expect(sessionState.balancePaper).toBe(10009.5);
    expect(sessionState.stats.totalPnl).toBe(9.5);
  });

  it('should handle delta-based updates correctly in handleTradeUpdate', async () => {
    const trade = { id: 't1', pnl: -1 } as Trade;

    // First update
    await (tradingSession as any).handleTradeUpdate({ trade });
    expect(sessionState.stats.totalPnl).toBe(-1);
    expect(sessionState.balancePaper).toBe(9999);

    // Second update with explicit delta
    await (tradingSession as any).handleTradeUpdate({ trade: { ...trade, pnl: -1.5 }, pnlDelta: -0.5 });
    expect(sessionState.stats.totalPnl).toBe(-1.5);
    expect(sessionState.balancePaper).toBe(9998.5);

    // Third update without explicit delta (should use internal appliedPnL map)
    await (tradingSession as any).handleTradeUpdate({ trade: { ...trade, pnl: 5 } });
    expect(sessionState.stats.totalPnl).toBe(5);
    expect(sessionState.balancePaper).toBe(10005);
  });

  it('should correctly handle finalizeTradeClosure and prevent double-counting', async () => {
    const trade = { id: 't2', symbol: 'ETHUSDT', pnl: -1, status: 'OPEN' } as Trade;

    // 1. Trade Update during life (e.g. fee)
    await (tradingSession as any).handleTradeUpdate({ trade });
    expect(sessionState.stats.totalPnl).toBe(-1);
    expect(sessionState.balancePaper).toBe(9999);

    // 2. Finalize Closure
    trade.status = 'CLOSED';
    trade.pnl = 10; // 11 gross PnL - 1 previous fee

    await (tradingSession as any).finalizeTradeClosure(trade, 2000, EXIT_REASONS.MANUAL_CLOSE);

    // Total PnL should be 10
    expect(sessionState.stats.totalPnl).toBe(10);
    // Balance should be 10010 (10000 + 10)
    expect(sessionState.balancePaper).toBe(10010);

    // Check if added to closedTrades
    expect(sessionState.closedTrades).toContain(trade);
  });
});
