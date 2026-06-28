import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';

describe('SessionService PnL Logic Consistency Fix', () => {
  let service: SessionService;
  let balanceUpdateCallback: (balance: number, pnl: number) => Promise<void>;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    },
  };

  const mockSessionRepository = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
    save: jest.fn(),
    create: jest.fn(),
    manager: {
      connection: {
        createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
      },
    },
  } as any;

  const mockTradeRepository = {
    createQueryBuilder: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    }),
  } as any;

  const mockLogRepository = {
    createQueryBuilder: jest.fn().mockReturnValue({
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    }),
  } as any;

  const mockTradingSessionService = {
    setBalanceUpdateCallback: jest.fn((cb) => { balanceUpdateCallback = cb; }),
    setTradeUpdateCallback: jest.fn(),
    getStatus: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionService(
      mockSessionRepository,
      {} as any, // klineStore
      mockTradeRepository,
      mockLogRepository,
      { findOne: jest.fn().mockResolvedValue({ id: 'default' }) } as any, // settingsRepository
      {} as any, // balanceHistoryRepository
      mockTradingSessionService,
      {} as any, // orderManager
      {} as any, // marketFeed
      { emit: jest.fn() } as any, // eventEmitter
      {} as any, // analytics
      {} as any, // binanceClientFactory
      { log: jest.fn() } as any, // auditLog
      { get: jest.fn().mockReturnValue('postgres://user:pass@localhost:5432/db') } as any // configService
    );
  });

  it('SHOULD use trade summation for PnL in Live mode during standalone balance updates', async () => {
    const originalSetInterval = global.setInterval;
    global.setInterval = jest.fn() as any;

    await service.onModuleInit();

    const sessionId = 'session-live';
    (service as any).currentSessionId = sessionId;

    const config = new SessionConfig();
    config.live_starting_balance = 1000;

    mockQueryRunner.manager.findOne.mockResolvedValue({
      id: sessionId,
      tradingMode: 'live',
      config: config
    });

    // Mock trade summation query returning 50
    mockQueryRunner.manager.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ sum: '50' }),
    });

    // Simulate balance update with pnl=0 (standalone update)
    // Balance is 1550 (includes 500 deposit), but PnL should stay 50
    await balanceUpdateCallback(1550, 0);

    // Verify the update call
    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
      SessionEntity,
      sessionId,
      expect.objectContaining({
        totalPnl: 50 // Fixed! Should not be 550.
      })
    );

    global.setInterval = originalSetInterval;
  });
});
