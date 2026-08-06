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

describe('Chronos: Position Adoption Multi-Tenant Safety Check', () => {
  let sessionService: SessionService;
  let tradeRepository: any;

  const mockSessionRepository = {
    findOne: jest.fn(),
  };

  const mockTradeRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
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
    tradeRepository = module.get(getRepositoryToken(TradeEntity));
  });

  it('should authorize adoption if there is an active OPEN trade in the local database', async () => {
    mockTradeRepository.findOne.mockResolvedValue({
      id: 'local-open-trade-id',
      symbol: 'BTCUSDT',
      status: 'OPEN',
    });

    const isStarted = await (sessionService as any).isPositionStartedByUs('BTCUSDT', []);
    expect(isStarted).toBe(true);
    expect(mockTradeRepository.findOne).toHaveBeenCalledWith({
      where: { symbol: 'BTCUSDT', status: 'OPEN' },
    });
  });

  it('should authorize adoption if an open SL order clientOrderId matches a local trade prefix', async () => {
    mockTradeRepository.findOne.mockResolvedValue(null);
    mockTradeRepository.find.mockResolvedValue([
      { id: '12345678-abcd-ef01-2345-6789abcdef01' },
    ]);

    const openOrders = [
      { clientOrderId: 'sl-12345678' },
    ];

    const isStarted = await (sessionService as any).isPositionStartedByUs('BTCUSDT', openOrders);
    expect(isStarted).toBe(true);
  });

  it('should authorize adoption if an open entry order clientOrderId matches a local trade prefix', async () => {
    mockTradeRepository.findOne.mockResolvedValue(null);
    mockTradeRepository.find.mockResolvedValue([
      { id: '12345678-abcd-ef01-2345-6789abcdef01' },
    ]);

    const openOrders = [
      { clientOrderId: 'ent-12345678abcdef012345' },
    ];

    const isStarted = await (sessionService as any).isPositionStartedByUs('BTCUSDT', openOrders);
    expect(isStarted).toBe(true);
  });

  it('should reject adoption if there are open orders but none match a local trade ID prefix', async () => {
    mockTradeRepository.findOne.mockResolvedValue(null);
    mockTradeRepository.find.mockResolvedValue([
      { id: '12345678-abcd-ef01-2345-6789abcdef01' },
    ]);

    const openOrders = [
      { clientOrderId: 'sl-99999999' },
    ];

    const isStarted = await (sessionService as any).isPositionStartedByUs('BTCUSDT', openOrders);
    expect(isStarted).toBe(false);
  });

  it('should reject adoption if there are no open orders and no local open trades', async () => {
    mockTradeRepository.findOne.mockResolvedValue(null);
    mockTradeRepository.find.mockResolvedValue([
      { id: '12345678-abcd-ef01-2345-6789abcdef01' },
    ]);

    const isStarted = await (sessionService as any).isPositionStartedByUs('BTCUSDT', []);
    expect(isStarted).toBe(false);
  });

  it('should reject adoption if we have no trade records at all for this symbol', async () => {
    mockTradeRepository.findOne.mockResolvedValue(null);
    mockTradeRepository.find.mockResolvedValue([]);

    const openOrders = [
      { clientOrderId: 'sl-12345678' },
    ];

    const isStarted = await (sessionService as any).isPositionStartedByUs('BTCUSDT', openOrders);
    expect(isStarted).toBe(false);
  });
});
