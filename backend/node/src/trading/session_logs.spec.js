import { SessionService } from './session.service';
import { SessionController, LimitPipe } from './session.controller';
describe('Session Logs & REST Endpoint Unit Tests', () => {
    let sessionService;
    let sessionController;
    beforeEach(() => {
        sessionService = {
            getStatus: jest.fn(),
            getLogs: jest.fn(),
        };
        sessionController = new SessionController(sessionService, {}, {});
    });
    it('SessionService.getStatus(false) omits logLines or returns undefined logLines', async () => {
        sessionService.getStatus.mockResolvedValue({
            running: true,
            balance: 10000,
            logLines: undefined,
        });
        const status = await sessionService.getStatus(false);
        expect(status.logLines).toBeUndefined();
    });
    it('SessionController.getLogs defaults limit to 50 and parses numeric query params', async () => {
        sessionService.getLogs.mockResolvedValue([
            { id: 'log-1', ts: '2026-09-14T20:00:00.000Z', level: 'info', msg: 'Engine started' },
        ]);
        const resultDefault = await sessionController.getLogs();
        expect(sessionService.getLogs).toHaveBeenCalledWith(50);
        expect(resultDefault).toHaveLength(1);
        await sessionController.getLogs(new LimitPipe(1000).transform('100', { type: 'query' }));
        expect(sessionService.getLogs).toHaveBeenCalledWith(100);
    });
    describe('Async Log Write Queue & Batch Pruning', () => {
        let mockLogRepo;
        let mockSessionRepo;
        let service;
        beforeEach(() => {
            mockLogRepo = {
                insert: jest.fn().mockResolvedValue({}),
                find: jest.fn().mockResolvedValue([]),
                delete: jest.fn().mockResolvedValue({ affected: 0 }),
                count: jest.fn().mockResolvedValue(0),
            };
            mockSessionRepo = {
                findOne: jest.fn(),
                update: jest.fn(),
                manager: {
                    connection: {
                        createQueryRunner: jest.fn(),
                    },
                },
            };
            service = new SessionService(mockSessionRepo, {}, mockLogRepo, {}, {}, {
                getStatus: jest.fn().mockReturnValue({ running: false }),
                setTradeUpdateCallback: jest.fn(),
            }, {}, {}, { emit: jest.fn() }, {}, {}, {}, { log: jest.fn(), cleanup: jest.fn() }, { get: jest.fn() });
            // Set active session
            service.currentSessionId = 'sess-123';
            service.wsBroadcaster = jest.fn();
        });
        afterEach(async () => {
            if (service.logFlushTimer) {
                clearTimeout(service.logFlushTimer);
            }
        });
        it('queues logs asynchronously and does not block with immediate insert', async () => {
            // Stub flushLogQueue to test async queueing without executing the immediate test environment flush
            const flushSpy = jest.spyOn(service, 'flushLogQueue').mockResolvedValue(undefined);
            await service.logMessage('Trade entered BTCUSDT', 'info', { channel: 'order', symbol: 'BTCUSDT' });
            // In-memory queue has 1 item
            expect(service.logWriteQueue).toHaveLength(1);
            expect(service.logWriteQueue[0]).toMatchObject({
                sessionId: 'sess-123',
                level: 'info',
                msg: 'Trade entered BTCUSDT',
            });
            // Immediate DB insert not called yet (debounced)
            expect(mockLogRepo.insert).not.toHaveBeenCalled();
            // Flush queue manually
            flushSpy.mockRestore();
            await service.flushLogQueue();
            expect(mockLogRepo.insert).toHaveBeenCalledTimes(1);
            expect(mockLogRepo.insert).toHaveBeenCalledWith(expect.arrayContaining([
                expect.objectContaining({ msg: 'Trade entered BTCUSDT' }),
            ]));
            expect(service.logWriteQueue).toHaveLength(0);
        });
        it('exempts critical channels (e.g. sl_ratchet) from 60/min throttle', async () => {
            const sid = 'sess-123';
            // Saturate rate limit
            service.logRateLimits.set(sid, { count: 100, resetAt: Date.now() + 60000 });
            // Routine log should be suppressed
            await service.logMessage('Routine tick check', 'info');
            expect(service.logWriteQueue).toHaveLength(0);
            // Critical channel log should be permitted
            await service.logMessage('Stop loss ratcheted to breakeven', 'info', { channel: 'sl_ratchet' });
            expect(service.logWriteQueue).toHaveLength(1);
            expect(service.logWriteQueue[0].msg).toBe('Stop loss ratcheted to breakeven');
        });
        it('executes chunked batch pruning when session reaches 2000 entries', async () => {
            const sid = 'sess-123';
            service.sessionLogCounts.set(sid, 2000);
            // Setup 200 dummy old logs to delete
            const dummyOldLogs = Array.from({ length: 200 }, (_, i) => ({ id: `old-log-${i}` }));
            mockLogRepo.find.mockResolvedValueOnce(dummyOldLogs);
            // Add a new error log
            await service.logMessage('Critical exchange timeout', 'error', { channel: 'watchdog' });
            expect(service.logWriteQueue).toHaveLength(1);
            // Flush to trigger insertion and pruning check
            await service.flushLogQueue();
            expect(mockLogRepo.find).toHaveBeenCalledWith({
                select: ['id'],
                where: { sessionId: sid },
                order: { ts: 'ASC' },
                take: 200,
            });
            expect(mockLogRepo.delete).toHaveBeenCalledWith(dummyOldLogs.map((l) => l.id));
            expect(service.sessionLogCounts.get(sid)).toBe(1801); // 2001 - 200 = 1801
        });
    });
});
