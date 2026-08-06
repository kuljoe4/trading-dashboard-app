import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionService } from '../trading/session.service';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';
import { Log as LogEntity } from '../models/entities/Log.entity';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { BalanceHistory as BalanceHistoryEntity } from '../models/entities/BalanceHistory.entity';
import { TradingSessionService } from './trading_session.service';
import { OrderManagerService } from './orderManager';
import { MarketFeedService } from './market_feed.service';
import { AnalyticsService } from './analytics.service';
import { RrOptimizationService } from './rr-optimization.service';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { AuditLogService } from '../trading/audit-log.service';
import { ConfigService } from '@nestjs/config';
import { Trade } from '../models/Trade';

describe('Chronos: Position Adoption Concurrency Lock', () => {
  let sessionService: SessionService;
  let tradingSessionService: TradingSessionService;
  let tradeRepository: any;

  const mockSessionRepository = {
    findOne: jest.fn(),
  };

  const mockTradeRepository = {
    create: jest.fn((dto) => ({ ...dto })),
    save: jest.fn((entity) => Promise.resolve(entity)),
  };

  const mockLogRepository = {
    count: jest.fn().mockResolvedValue(0),
    insert: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue({}),
  };

  const mockSettingsRepository = {};
  const mockBalanceHistoryRepository = {};

  const mockTradingSessionService = {
    addTrade: jest.fn(),
    reconcileMilestoneFromSl: jest.fn().mockReturnValue(-1),
    getActiveTradesRaw: jest.fn().mockReturnValue([]),
    seedActiveTrades: jest.fn(),
  };

  const mockOrderManagerService = {
    fetchOpenAlgoOrders: jest.fn().mockResolvedValue([]),
    fetchOpenOrders: jest.fn().mockResolvedValue([]),
    placeStopLoss: jest.fn().mockResolvedValue({ orderId: 'mock-sl-id', price: 49000 }),
    tickerCache: {
      getPrice: jest.fn().mockReturnValue(100),
    },
  };

  const mockMarketFeedService = {
    getSymbolFilters: jest.fn().mockReturnValue({ stepSize: 0.001, pricePrecision: 2, qtyPrecision: 3 }),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockAnalyticsService = {};
  const mockRrOptimizationService = {};
  const mockBinanceClientFactory = {};
  const mockAuditLogService = {
    log: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn().mockReturnValue('postgres://user:pass@localhost:5432/db'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: getRepositoryToken(SessionEntity), useValue: mockSessionRepository },
        { provide: getRepositoryToken(TradeEntity), useValue: mockTradeRepository },
        { provide: getRepositoryToken(LogEntity), useValue: mockLogRepository },
        { provide: getRepositoryToken(SettingsEntity), useValue: mockSettingsRepository },
        { provide: getRepositoryToken(BalanceHistoryEntity), useValue: mockBalanceHistoryRepository },
        { provide: TradingSessionService, useValue: mockTradingSessionService },
        { provide: OrderManagerService, useValue: mockOrderManagerService },
        { provide: MarketFeedService, useValue: mockMarketFeedService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        { provide: RrOptimizationService, useValue: mockRrOptimizationService },
        { provide: BinanceClientFactory, useValue: mockBinanceClientFactory },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    sessionService = module.get<SessionService>(SessionService);
    tradingSessionService = module.get<TradingSessionService>(TradingSessionService);
    tradeRepository = module.get(getRepositoryToken(TradeEntity));

    // Force session to be running in the service state
    (sessionService as any).sessionRunning = true;
    (sessionService as any).currentSessionId = 'session-test-id';
  });

  it('should prevent double-adoption of the same symbol during concurrent handleAdoptPositions calls', async () => {
    mockSessionRepository.findOne.mockResolvedValue({
      id: 'session-test-id',
      tradingMode: 'live',
      paperMode: false,
      config: {
        sl_distance_pct: 2.0,
        strategy_label: 'Mock Strategy',
      },
    });

    const positionsPayload = [
      {
        symbol: 'BTCUSDT',
        positionAmt: '1.5',
        entryPrice: '50000',
        markPrice: '50100',
        positionSide: 'BOTH',
      },
    ];

    const syntheticTrade = {
      id: 'recon-trade-id',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 1.5,
      status: 'OPEN',
    };

    // Spy on adoptExchangePositions and inject an artificial async delay
    const adoptSpy = jest.spyOn(sessionService as any, 'adoptExchangePositions')
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [syntheticTrade];
      });

    // Invoke both handleAdoptPositions concurrently
    const p1 = sessionService.handleAdoptPositions({
      positions: positionsPayload,
      orders: [],
    });

    const p2 = sessionService.handleAdoptPositions({
      positions: positionsPayload,
      orders: [],
    });

    await Promise.all([p1, p2]);

    // Assertions
    // - Check that adoptExchangePositions was only called once because the second concurrent call was locked out
    expect(adoptSpy).toHaveBeenCalledTimes(1);

    // - Check that tradingSessionService.addTrade was only called once (no duplicate registrations)
    expect(mockTradingSessionService.addTrade).toHaveBeenCalledTimes(1);
    expect(mockTradingSessionService.addTrade).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT',
      qty: 1.5,
    }));
  });
});
