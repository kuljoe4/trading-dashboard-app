import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';
import { Session as SessionEntity } from '../models/entities/Session.entity';
describe('SessionService PnL Logic Consistency Fix', () => {
    let service;
    let balanceUpdateCallback;
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
    };
    const mockTradeRepository = {
        createQueryBuilder: jest.fn().mockReturnValue({
            update: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
        }),
    };
    const mockLogRepository = {
        createQueryBuilder: jest.fn().mockReturnValue({
            delete: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 0 }),
        }),
    };
    const mockTradingSessionService = {
        setBalanceUpdateCallback: jest.fn((cb) => { balanceUpdateCallback = cb; }),
        setTradeUpdateCallback: jest.fn(),
        getStatus: jest.fn(),
    };
    beforeEach(() => {
        jest.clearAllMocks();
        service = new SessionService(mockSessionRepository, mockTradeRepository, mockLogRepository, { findOne: jest.fn().mockResolvedValue({ id: 'default' }) }, // settingsRepository
        {}, // balanceHistoryRepository
        mockTradingSessionService, {}, // orderManager
        {}, // marketFeed
        { emit: jest.fn() }, // eventEmitter
        {}, // analytics
        {}, // rrOptimization
        {}, // binanceClientFactory
        { log: jest.fn() }, // auditLog
        { get: jest.fn().mockReturnValue('postgres://user:pass@localhost:5432/db') } // configService
        );
    });
    it('SHOULD use trade summation for PnL in Live mode during standalone balance updates', async () => {
        const originalSetInterval = global.setInterval;
        global.setInterval = jest.fn();
        await service.onModuleInit();
        const sessionId = 'session-live';
        service.currentSessionId = sessionId;
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
        expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(SessionEntity, sessionId, expect.objectContaining({
            totalPnl: 50 // Fixed! Should not be 550.
        }));
        global.setInterval = originalSetInterval;
    });
});
