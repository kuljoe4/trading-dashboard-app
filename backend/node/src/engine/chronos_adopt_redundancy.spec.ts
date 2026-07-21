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

describe('Chronos: Position Adoption Redundancy', () => {
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

  it('should call tradingSessionService.addTrade EXACTLY once per adopted position during handleAdoptPositions', async () => {
    // 1. Arrange mock session & config
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

    // 2. Act: handleAdoptPositions event handler is invoked
    await sessionService.handleAdoptPositions({
      positions: positionsPayload,
      orders: [],
    });

    // 3. Assert
    // - Check that the trade is saved to the DB repository
    expect(tradeRepository.save).toHaveBeenCalledTimes(1);

    // - Check that addTrade was called exactly once in total for this single position adoption
    expect(tradingSessionService.addTrade).toHaveBeenCalledTimes(1);
    expect(tradingSessionService.addTrade).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT',
      qty: 1.5,
      entry_price: 50000,
    }));
  });
});
