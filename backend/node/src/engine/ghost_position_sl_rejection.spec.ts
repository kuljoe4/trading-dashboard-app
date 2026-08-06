import { OrderFilterService } from './order-filter.service';
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
import { TradingSessionService } from './trading_session.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { GatingService } from './gating.service';
import { MaintenanceService } from './maintenance.service';
import { BroadcastService } from './broadcast.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { ExecutionService } from './execution.service';
import { SessionLifecycleService } from './session-lifecycle.service';
import { AnalyticsService } from './analytics.service';

describe('Ghost Position SL Rejection Fix', () => {
  let tradingSession: TradingSessionService;
  let orderManager: OrderManagerService;
  let positionTracker: PositionTrackerService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        TradingSessionService,
        OrderManagerService,
        { provide: PositionTrackerService, useValue: { activeList: jest.fn(), getInFlightEntry: jest.fn(), closeTrade: jest.fn(), isClosing: jest.fn() } },
        { provide: SessionStateService, useValue: { getBalance: jest.fn(), updateStatsOnClose: jest.fn(), addClosedTrade: jest.fn(), setActiveTrades: jest.fn(), balanceLive: 10000, stats: {} } },
        EventEmitter2,
        { provide: SignalEngineService, useValue: {} },
        { provide: RiskEngineService, useValue: {} },
        { provide: MarketFeedService, useValue: { setCandleCloseCallback: jest.fn() } },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn() } },
        { provide: KlineStoreService, useValue: {} },
        { provide: MonitoringService, useValue: { recordHotLoop: jest.fn(), incrementApiRequests: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn(), update: jest.fn() } },
        { provide: GatingService, useValue: {} },
        { provide: MaintenanceService, useValue: {} },
        { provide: BroadcastService, useValue: { broadcast: jest.fn() } },
        { provide: VariantAnalyticsService, useValue: {} },
        { provide: EngineBroadcasterService, useValue: { serializeTrade: jest.fn(), getLastAnalyticsResult: jest.fn() } },
        { provide: ExecutionService, useValue: { setCooldown: jest.fn() } },
        { provide: SessionLifecycleService, useValue: { isUdsConnected: true } },
        { provide: AnalyticsService, useValue: { calculateAnalytics: jest.fn().mockReturnValue({ maxDrawdown: 0, maxDrawdownPct: 0, overallWinRate: 0, cumulativePnL: [] }) } },
        { provide: MomentumScannerService, useValue: {} },
      ],
    }).compile();

    tradingSession = module.get<TradingSessionService>(TradingSessionService);
    orderManager = module.get<OrderManagerService>(OrderManagerService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Mock session running
    (tradingSession as any).running = true;
    (tradingSession as any).config = { paper_mode: false };
  });

  it('should force a MARKET close order when needsMarketClose is true (SL Rejection)', async () => {
    const trade = { symbol: 'BTCUSDT', id: 't1' };
    (positionTracker.activeList as jest.Mock).mockReturnValue([trade]);
    (positionTracker.isClosing as jest.Mock).mockReturnValue(false);
    (positionTracker.closeTrade as jest.Mock).mockResolvedValue({ exitOccurred: true, trade: { ...trade, pnl: 10, exit_price: 50000 } });

    const payload = {
      symbol: 'BTCUSDT',
      exitPrice: 50000,
      reason: EXIT_REASONS.SL_HIT,
      needsMarketClose: true // THE FIX: This should force localOnly = false
    };

    await tradingSession.handleExchangeClose(payload);

    // Verify closeTrade was called with localOnly = false (6th argument)
    expect(positionTracker.closeTrade).toHaveBeenCalledWith(
      'BTCUSDT',
      50000,
      EXIT_REASONS.SL_HIT,
      expect.any(Object), // config
      false, // paperMode
      false, // localOnly - MUST BE FALSE TO SEND ORDER
      expect.objectContaining({ ignoreBlocked: true })
    );
  });

  it('should match in-flight entries if not in activeList during closure', async () => {
    const trade = { symbol: 'BTCUSDT', id: 'in-flight-1' };
    (positionTracker.activeList as jest.Mock).mockReturnValue([]); // Not in active list yet
    (positionTracker.getInFlightEntry as jest.Mock).mockReturnValue(trade); // But is in-flight
    (positionTracker.isClosing as jest.Mock).mockReturnValue(false);
    (positionTracker.closeTrade as jest.Mock).mockResolvedValue({ exitOccurred: true, trade: { ...trade, pnl: 0, exit_price: 50000 } });

    const payload = {
      symbol: 'BTCUSDT',
      exitPrice: 50000,
      reason: EXIT_REASONS.SL_HIT,
      needsMarketClose: false
    };

    await tradingSession.handleExchangeClose(payload);

    // Verify closure proceeded for the in-flight trade
    expect(positionTracker.closeTrade).toHaveBeenCalled();
  });
});
