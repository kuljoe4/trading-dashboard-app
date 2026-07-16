import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';
import { TradeEntity } from '../models/entities/Trade.entity';
import { TERMINAL_STATUSES } from '../models/entities/constants';

describe('SessionService Data Consistency Fixes', () => {
  let service: SessionService;

  const mockSessionRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    manager: {
        connection: {
            createQueryRunner: jest.fn().mockReturnValue({
                connect: jest.fn(),
                startTransaction: jest.fn(),
                commitTransaction: jest.fn(),
                rollbackTransaction: jest.fn(),
                release: jest.fn(),
                manager: {
                    findOne: jest.fn(),
                    save: jest.fn(),
                    update: jest.fn(),
                    createQueryBuilder: jest.fn(),
                }
            })
        }
    }
  } as any;

  const mockTradeRepository = {
    find: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  } as any;

  const mockSettingsRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  } as any;

  const mockLogRepository = {
    count: jest.fn(),
    insert: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  } as any;

  const mockBalanceHistoryRepository = {
    save: jest.fn(),
    create: jest.fn(),
  } as any;

  const mockTradingSessionService = {
    start: jest.fn(),
    stop: jest.fn(),
    setBalanceUpdateCallback: jest.fn(),
    setTradeUpdateCallback: jest.fn(),
    updateConfig: jest.fn(),
    setBinanceClient: jest.fn(),
    fetchPosition: jest.fn(),
    getStatus: jest.fn().mockReturnValue({ running: false, activeTrades: [] }),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionService(
      mockSessionRepository,
      mockTradeRepository,
      mockLogRepository,
      mockSettingsRepository,
      mockBalanceHistoryRepository,
      mockTradingSessionService,
      {} as any, // orderManager
      {} as any, // marketFeed
      { emit: jest.fn() } as any,
      {} as any, // analytics
      {} as any, // rrOptimization
      {} as any, // binanceClientFactory
      { log: jest.fn() } as any, // auditLog
      { get: jest.fn().mockReturnValue('postgres://user:pass@localhost:5432/db') } as any // configService
    );
  });

  it('should recalculate totalPnl if trades are orphaned during startSession', async () => {
    const config = new SessionConfig();
    config.trading_mode = 'paper';
    config.paper_starting_balance = 10000;

    const session = { id: 'session-123', running: false, paperMode: true, balance: 10000, totalPnl: 0, config };

    // Mock sequential calls to findOne for SessionRepository
    mockSessionRepository.findOne.mockImplementation((criteria: any) => {
        if (criteria?.where?.id === 'session-123') return Promise.resolve(session);
        if (criteria?.where?.id === 'other-session') return Promise.resolve(null); // Orphaned
        return Promise.resolve(null);
    });

    mockSessionRepository.save.mockResolvedValue(session);
    mockSettingsRepository.findOne.mockResolvedValue({ paper_balance: 10000 });

    // Mock trades
    const orphanedTrade = { id: 'trade-1', symbol: 'BTCUSDT', status: 'OPEN', sessionId: 'other-session' };
    mockTradeRepository.find.mockImplementation((criteria: any) => {
        if (criteria?.where?.status === 'OPEN') return Promise.resolve([orphanedTrade]);
        return Promise.resolve([]); // for rawHistory
    });

    // Mock aggregation query
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ sum: '-50' }),
    };
    mockTradeRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    await service.startSession(config, true);

    expect(mockTradeRepository.update).toHaveBeenCalledWith('trade-1', expect.objectContaining({
      status: 'CLOSED_ORPHANED',
      exit_ts: expect.any(Date),
      is_reconciliation: true,
      exit_price: expect.any(Number),
      pnl: expect.any(Number),
      pnl_pct: expect.any(Number),
      qty: expect.any(Number),
      exit_reason: expect.any(String),
    }));
    expect(mockSessionRepository.update).toHaveBeenCalledWith('session-123', { totalPnl: -50 });
  });

  it('should preserve positive PnL (funding) for OPEN trades in executeSaveTradeAtomic', async () => {
    const trade = {
        id: 'trade-open',
        symbol: 'BTCUSDT',
        status: 'OPEN',
        entry_price: 50000,
        qty: 1,
        pnl: 15.5, // Positive funding/realized
        sessionId: 'session-123'
    };

    const queryRunner = mockSessionRepository.manager.connection.createQueryRunner();
    const manager = queryRunner.manager;

    manager.findOne.mockResolvedValue({
        id: 'session-123',
        tradingMode: 'live',
        config: { live_starting_balance: 1000 }
    });

    const andWhereSpy = jest.fn().mockReturnThis();
    manager.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: andWhereSpy,
        getRawOne: jest.fn().mockResolvedValue({ sum: '100' }),
    });

    mockTradeRepository.create.mockImplementation((t: any) => t);

    // We need to use the private executeSaveTradeAtomic to test it directly or use saveTradeAtomic
    await (service as any).executeSaveTradeAtomic(trade, 1100);

    // Verify that the saved trade has pnl: 15.5, not 0
    expect(manager.save).toHaveBeenCalledWith(TradeEntity, expect.objectContaining({
        id: 'trade-open',
        pnl: 15.5
    }));

    // Verify that the summation includes OPEN trades
    expect(andWhereSpy).toHaveBeenCalledWith(
        'trade.status IN (:...statuses)',
        expect.objectContaining({
            statuses: expect.arrayContaining(['OPEN'])
        })
    );
  });
});
