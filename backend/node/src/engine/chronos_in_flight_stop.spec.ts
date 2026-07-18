import { OrderFilterService } from './order-filter.service';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderManagerService } from './orderManager';
import { PositionTrackerService } from './positionTracker';
import { SessionStateService } from './session_state.service';
import { TickerCacheService } from './ticker_cache.service';
import { MarketFeedService } from './market_feed.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
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
import { KlineStoreService } from './kline_store.service';
import { Trade } from '../models/Trade';

describe('Chronos: In-Flight Stop Abandonment Protection', () => {
  let tradingSession: TradingSessionService;
  let sessionState: SessionStateService;
  let positionTracker: PositionTrackerService;
  let binanceClientMock: any;

  beforeEach(async () => {
    binanceClientMock = {
      restAPI: {
        queryOrder: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        { provide: OrderManagerService, useValue: { setBinanceClient: jest.fn(), getTakerFeeRate: jest.fn().mockReturnValue(0.0004), isRatcheting: jest.fn() } },
        TradingSessionService,
        SessionStateService,
        EventEmitter2,
        {
          provide: PositionTrackerService,
          useValue: {
            activeList: jest.fn(),
            getInFlightSymbols: jest.fn(),
            getInFlightEntry: jest.fn(),
            addTrade: jest.fn(),
            closeTrade: jest.fn(),
            clear: jest.fn(),
          },
        },
        { provide: SignalEngineService, useValue: {} },
        { provide: RiskEngineService, useValue: {} },
        { provide: MarketFeedService, useValue: { getSymbolFilters: jest.fn(), setCandleCloseCallback: jest.fn() } },
        { provide: TickerCacheService, useValue: { getPrice: jest.fn().mockReturnValue(50000), clear: jest.fn() } },
        { provide: KlineStoreService, useValue: { clear: jest.fn() } },
        { provide: MonitoringService, useValue: { recordHotLoop: jest.fn(), incrementApiRequests: jest.fn(), recordUdsPing: jest.fn(), setUdsStatus: jest.fn(), clearAppMetrics: jest.fn(), setLoopStage: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn() } },
        { provide: MomentumScannerService, useValue: { scan: jest.fn(), start: jest.fn(), stop: jest.fn() } },
        { provide: AnalyticsService, useValue: {} },
        { provide: ExecutionService, useValue: {} },
        { provide: SessionLifecycleService, useValue: { stop: jest.fn() } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        { provide: VariantAnalyticsService, useValue: {} },
        { provide: EngineBroadcasterService, useValue: { broadcastTick: jest.fn(), serializeTrade: (t: any) => t, minimize: jest.fn() } },
        { provide: GatingService, useValue: {} },
        { provide: MaintenanceService, useValue: {} },
      ],
    }).compile();

    tradingSession = module.get<TradingSessionService>(TradingSessionService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);

    // Mock live mode for stop check
    (tradingSession as any).config = {
      paper_mode: false,
      trading_mode: 'live',
    };
    (tradingSession as any).binanceClient = binanceClientMock;
    (tradingSession as any).running = true;
  });

  it('should query the exchange for in-flight entries and promote filled ones to active list before stopping to prevent ghost positions', async () => {
    const symbol = 'BTCUSDT';
    const trade = {
      id: 'trade-inflight-stop',
      symbol,
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.5,
      status: 'OPEN',
    } as any as Trade;

    // 1. Configure position tracker to simulate an in-flight entry
    (positionTracker.getInFlightSymbols as jest.Mock).mockReturnValue([symbol]);
    (positionTracker.getInFlightEntry as jest.Mock).mockReturnValue(trade);

    // 2. Configure activeList:
    // First call during stop() (before promotion): returns empty array.
    // Second call during stop() (after promotion): returns the promoted trade.
    let activeTradesList: Trade[] = [];
    (positionTracker.activeList as jest.Mock).mockImplementation(() => activeTradesList);

    (positionTracker.addTrade as jest.Mock).mockImplementation((t: Trade) => {
      activeTradesList = [t];
    });

    // 3. Mock queryOrder to return a successfully FILLED entry receipt
    binanceClientMock.restAPI.queryOrder.mockResolvedValue({
      headers: {},
      data: () => Promise.resolve({
        orderId: 123456,
        status: 'FILLED',
        executedQty: '1.5',
        avgPrice: '50000',
      }),
    });

    // 4. Mock closeTrade to return successful closure
    (positionTracker.closeTrade as jest.Mock).mockResolvedValue({
      exitOccurred: true,
      trade: {
        ...trade,
        status: 'CLOSED_SL',
        exit_price: 50000,
        pnl: 0,
      },
    });

    // 5. Call stop()
    await tradingSession.stop();

    // 6. Verify:
    // - queryOrder was called with deterministic clientOrderId
    expect(binanceClientMock.restAPI.queryOrder).toHaveBeenCalledWith({
      symbol,
      origClientOrderId: 'ent-tradeinflightstop',
    });

    // - The filled in-flight trade was promoted to active list
    expect(positionTracker.addTrade).toHaveBeenCalledWith(expect.objectContaining({
      id: 'trade-inflight-stop',
      binance_order_id: '123456',
      qty: 1.5,
    }));

    // - The promoted trade was closed during shutdown
    expect(positionTracker.closeTrade).toHaveBeenCalledWith(
      symbol,
      50000,
      'SESSION_TERMINATED',
      expect.any(Object),
      false,
    );
  });

  it('should NOT promote in-flight entry if the query returns zero executed quantity (order never filled)', async () => {
    const symbol = 'ETHUSDT';
    const trade = {
      id: 'trade-inflight-empty',
      symbol,
      direction: 'LONG',
      entry_price: 3000,
      qty: 2.0,
      status: 'OPEN',
    } as any as Trade;

    (positionTracker.getInFlightSymbols as jest.Mock).mockReturnValue([symbol]);
    (positionTracker.getInFlightEntry as jest.Mock).mockReturnValue(trade);
    (positionTracker.activeList as jest.Mock).mockReturnValue([]);

    // Mock queryOrder returning 0 executed qty (order didn't execute yet / was rejected)
    binanceClientMock.restAPI.queryOrder.mockResolvedValue({
      headers: {},
      data: () => Promise.resolve({
        orderId: 999888,
        status: 'NEW',
        executedQty: '0.0',
      }),
    });

    await tradingSession.stop();

    expect(binanceClientMock.restAPI.queryOrder).toHaveBeenCalled();
    expect(positionTracker.addTrade).not.toHaveBeenCalled();
    expect(positionTracker.closeTrade).not.toHaveBeenCalled();
  });
});
