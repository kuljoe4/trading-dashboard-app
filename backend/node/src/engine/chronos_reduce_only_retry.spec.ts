import { OrderFilterService } from './order-filter.service';
import { BroadcastService } from './broadcast.service';
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
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { EXIT_REASONS } from '../models/constants';

describe('Chronos ReduceOnly Retry Failure Propagates To Sync Recovery', () => {
  let orderManager: OrderManagerService;
  let sessionState: SessionStateService;
  let mockBinanceClient: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: OrderFilterService,
          useValue: {
            applyFilters: jest.fn((sym, val, qty) => ({ price: val, qty })),
            checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })),
          },
        },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
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
            setInFlight: jest.fn(),
          },
        },
        SessionStateService,
        EventEmitter2,
        { provide: SignalEngineService, useValue: { checkEntry: jest.fn() } },
        {
          provide: RiskEngineService,
          useValue: {
            canEnter: jest.fn(),
            computeSl: jest.fn(),
            computePositionSize: jest.fn().mockReturnValue({ qty: 1 }),
            computeTp: jest.fn(),
          },
        },
        {
          provide: MarketFeedService,
          useValue: {
            getSymbolFilters: () => ({ tickSize: 0.01, stepSize: 0.01, qtyPrecision: 2, pricePrecision: 2 }),
          },
        },
        { provide: TickerCacheService, useValue: { getPrice: () => 100, getTicker: () => ({ price: 100 }) } },
        { provide: KlineStoreService, useValue: { getRawCandles: () => [] } },
        {
          provide: MonitoringService,
          useValue: {
            recordUdsPing: () => {},
            setUdsStatus: () => {},
            incrementApiRequests: () => {},
            setLoopStage: () => {},
          },
        },
        { provide: AuditLogService, useValue: { log: () => {} } },
        { provide: MomentumScannerService, useValue: {} },
        { provide: AnalyticsService, useValue: { calculateAnalytics: () => ({}) } },
        {
          provide: getRepositoryToken(SettingsEntity),
          useValue: { findOne: () => Promise.resolve({}), update: () => Promise.resolve({}) },
        },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    sessionState = module.get<SessionStateService>(SessionStateService);

    (sessionState as any).config = { trading_mode: 'live', paper_mode: false };
    sessionState.balanceLive = 10000;

    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn(),
        cancelAllOpenOrders: jest.fn().mockResolvedValue({ headers: {} }),
        cancelAllAlgoOpenOrders: jest.fn().mockResolvedValue({ headers: {} }),
        positionInformationV3: jest.fn(),
        accountTradeList: jest.fn(),
        queryOrder: jest.fn(),
        cancelOrder: jest.fn().mockResolvedValue({ headers: {} }),
      },
    };
  });

  it('should propagate a persistent ReduceOnly error to the outer sync recovery flow and successfully close the trade', async () => {
    await orderManager.setBinanceClient(mockBinanceClient, false); // live mode

    const trade = {
      id: 'trade-reduce-only-id',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1.0,
      entry_price: 50000,
      initial_sl: 49000,
      current_sl: 49000,
      initial_risk_usdt: 100,
      status: 'OPEN',
      binance_order_id: '123456',
    } as any;

    // 1. Mock newOrder to throw ReduceOnly on all 3 attempts
    const reduceOnlyError = new Error('Order would trigger immediately or ReduceOnly rejection (-2022)');
    (reduceOnlyError as any).code = -2022;
    mockBinanceClient.restAPI.newOrder.mockRejectedValue(reduceOnlyError);

    // 2. Mock positionInformationV3 to confirm the position is 0 (i.e. closed)
    mockBinanceClient.restAPI.positionInformationV3.mockResolvedValue({
      data: () => Promise.resolve([
        {
          symbol: 'BTCUSDT',
          positionAmt: '0',
          entryPrice: '50000',
        },
      ]),
      headers: {},
    });

    // 3. Mock accountTradeList to return a trade fill that executed recenty
    mockBinanceClient.restAPI.accountTradeList.mockResolvedValue({
      data: () => Promise.resolve([
        {
          symbol: 'BTCUSDT',
          orderId: '987654',
          side: 'SELL',
          price: '48900.50',
          qty: '1.0',
          time: Date.now() - 1000, // 1 second ago (well within 5 minutes)
        },
      ]),
      headers: {},
    });

    // 4. Mock queryOrder to return details of that fill order
    mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
      data: () => Promise.resolve({
        orderId: 987654,
        avgPrice: '48900.50',
        type: 'STOP_MARKET',
        clientOrderId: 'sl-order',
        status: 'FILLED',
        stopPrice: '49000.00',
      }),
      headers: {},
    });

    // Invoke closeTrade
    const result = await orderManager.closeTrade('BTCUSDT', trade, 49000, 'MANUAL_CLOSE', false, false);

    // Assertions
    expect(mockBinanceClient.restAPI.newOrder).toHaveBeenCalledTimes(3); // Should retry exactly 3 times before propagating
    expect(result.exitOccurred).toBe(true);
    expect(result.trade.status).toBe('CLOSED_SL');
    expect(result.trade.exit_price).toBe(48900.5); // Authoritative exit price from queryOrder
    expect(result.trade.exit_reason).toBe('SL_HIT_INITIAL_SL'); // Converted STOP_MARKET stopPrice matching initial_sl
  });
});
