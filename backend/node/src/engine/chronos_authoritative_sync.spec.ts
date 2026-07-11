import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderManagerService } from './orderManager';
import { PositionTrackerService } from './positionTracker';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { AnalyticsService } from './analytics.service';
import { ENGINE_EVENTS } from './events';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { EXIT_REASONS } from '../models/constants';
import { ExecutionStatus } from '../models/ExecutionResult';

describe('Chronos Authoritative Synchronization', () => {
  let orderManager: OrderManagerService;
  let sessionLifecycle: SessionLifecycleService;
  let sessionState: SessionStateService;
  let positionTracker: PositionTrackerService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        SessionLifecycleService,
        {
          provide: PositionTrackerService,
          useValue: {
            addTrade: jest.fn(),
            activeList: jest.fn().mockReturnValue([]),
            getInFlightEntry: jest.fn(),
            setEntering: jest.fn(),
            isEntering: jest.fn().mockReturnValue(false),
            isClosing: jest.fn().mockReturnValue(false),
            clearInFlight: jest.fn(),
            recalculateTotalRisk: jest.fn(),
            refreshTradeRisk: jest.fn(),
            setInFlight: jest.fn(), // Added missing function
          }
        },
        SessionStateService,
        EventEmitter2,
        { provide: SignalEngineService, useValue: { checkEntry: jest.fn() } },
        { provide: RiskEngineService, useValue: { canEnter: jest.fn(), computeSl: jest.fn(), computePositionSize: jest.fn(), computeTp: jest.fn() } },
        { provide: MarketFeedService, useValue: { getSymbolFilters: () => ({ tickSize: 0.01, stepSize: 0.01, qtyPrecision: 2, pricePrecision: 2 }) } },
        { provide: TickerCacheService, useValue: { getPrice: () => 100, getTicker: () => ({ price: 100 }) } },
        { provide: KlineStoreService, useValue: { getRawCandles: () => [] } },
        { provide: MonitoringService, useValue: { recordUdsPing: () => {}, setUdsStatus: () => {}, incrementApiRequests: () => {}, setLoopStage: () => {} } },
        { provide: AuditLogService, useValue: { log: () => {} } },
        { provide: MomentumScannerService, useValue: {} },
        { provide: AnalyticsService, useValue: { calculateAnalytics: () => ({}) } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: () => Promise.resolve({}), update: () => Promise.resolve({}) } },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    sessionLifecycle = module.get<SessionLifecycleService>(SessionLifecycleService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    (sessionState as any).config = { trading_mode: 'live', paper_mode: false };
    sessionState.balanceLive = 10000;
  });

  it('GAP 1: should synchronize manual position reductions from UDS ACCOUNT_UPDATE even if not in closing state', async () => {
    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      qty: 1.0,
      entry_price: 50000,
      current_sl: 49000,
      status: 'OPEN',
      direction: 'LONG'
    } as any;

    sessionState.activeTrades = [trade];
    jest.spyOn(positionTracker, 'activeList').mockReturnValue([trade]);

    const payload = {
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        P: [{ s: 'BTCUSDT', pa: '0.4', ep: '50000' }]
      }
    };

    sessionLifecycle.handleAccountUpdate(payload as any);

    // EXPECTED BEHAVIOR (Chronos Fix): Syncs to 0.4.
    expect(trade.qty).toBe(0.4);
  });

  it('GAP 2: should preserve accumulated UDS PnL slices upon trade closure instead of overwriting with local estimation', async () => {
    const trade = {
      id: 'trade-2',
      symbol: 'ETHUSDT',
      qty: 10.0,
      entry_price: 2000,
      current_sl: 1900,
      status: 'OPEN',
      direction: 'LONG',
      pnl: -5.0, // Initial fee already applied
      realized_fee: 5.0
    } as any;

    sessionState.activeTrades = [trade];

    // Simulate an execution slice from UDS that adds realized profit
    const udsTradeUpdate = {
      e: 'ORDER_TRADE_UPDATE',
      o: {
        s: 'ETHUSDT',
        X: 'PARTIALLY_FILLED',
        i: '9999',
        S: 'SELL',
        ot: 'MARKET',
        x: 'TRADE',
        z: '5.0',
        ap: '2100',
        rp: '500.0', // Authoritative realized profit for this slice
        n: '2.0', // Authoritative commission for this slice
        t: '12345' // Trade ID
      }
    };

    await orderManager.handleBinanceOrderUpdate(udsTradeUpdate as any);

    // PnL should now be: -5 (initial) + 500 (rp) - 2 (n) = 493
    expect(trade.pnl).toBe(493);

    // Mock exchange close event by calling orderManager.closeTrade directly
    // This simulates what handleExchangeClose would do
    await orderManager.closeTrade('ETHUSDT', trade, 2100, EXIT_REASONS.SL_HIT, false, true, { feesAlreadyAccounted: true });

    // Expected PnL: 493 (already has all slices).
    // If closeTrade re-calculates, it might get (2100-2000)*10 - fees = 1000 - fees.
    expect(trade.pnl).toBe(493);
  });

  it('GAP 3: should add trade to tracking if entry succeeds even if subsequent SL or unwind fails', async () => {
    const mockClient = {
      restAPI: {
        newOrder: jest.fn().mockResolvedValue({
          data: () => Promise.resolve({ orderId: 123, status: 'FILLED', executedQty: '1', avgPrice: '100', cumQuote: '100' }),
          headers: {}
        }),
        newAlgoOrder: jest.fn().mockResolvedValue({
          data: () => Promise.resolve({ code: -4120, msg: 'Algo Order API not supported' }),
          headers: {}
        }),
        cancelOrder: jest.fn().mockResolvedValue({
           data: () => Promise.resolve({ code: -2011, msg: 'Unknown order' }),
           headers: {}
        }),
        positionInformationV3: jest.fn().mockResolvedValue({ data: () => Promise.resolve([]), headers: {} })
      }
    };

    // Mock closeTrade to simulate unwind failure
    jest.spyOn(orderManager, 'closeTrade').mockResolvedValue({
        trade: { symbol: 'BNBUSDT', status: 'OPEN' } as any,
        exitOccurred: false,
        error: 'Unwind failed'
    });

    await orderManager.setBinanceClient(mockClient as any, false);

    const result = await orderManager.enter(
      'session-1',
      'BNBUSDT',
      'LONG',
      100,
      1,
      90,
      110
    );

    expect(result.status).toBe(ExecutionStatus.SL_FAILED);
    // EXPECTED BEHAVIOR: Trade IS added because it exists on the exchange.
    expect(positionTracker.addTrade).toHaveBeenCalled();
  });
});
