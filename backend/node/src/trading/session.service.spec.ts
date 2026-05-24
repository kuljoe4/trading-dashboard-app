import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';
import { Session as SessionEntity } from '../models/entities/Session.entity';

describe('SessionService Validation', () => {
  let service: SessionService;

  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    increment: jest.fn(),
  } as any;

  const mockTradingSessionService = {
    start: jest.fn(),
    stop: jest.fn(),
    setBalanceUpdateCallback: jest.fn(),
    setTradeUpdateCallback: jest.fn(),
    updateConfig: jest.fn(),
  } as any;

  const mockAnalyticsService = {
    calculateAnalytics: jest.fn(),
  } as any;

  const mockTradeRepository = {
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionService(
      mockRepository,
      mockTradeRepository,
      mockRepository,
      mockRepository,
      mockTradingSessionService,
      mockAnalyticsService
    );
  });

  describe('validateConfig', () => {
    it('throws error if config is missing', () => {
      expect(() => (service as any).validateConfig(null)).toThrow('Configuration is required');
    });

    it('throws error for invalid scan mode dependencies', () => {
      const config = new SessionConfig();
      config.scan_mode = 'active_window';
      config.scan_window_duration_sec = undefined;
      expect(() => (service as any).validateConfig(config)).toThrow('Window duration is required');
    });

    it('throws error for invalid SL lookback dependencies', () => {
      const config = new SessionConfig();
      config.sl_type = 'lookback_low/high';
      config.sl_lookback_period = 0;
      expect(() => (service as any).validateConfig(config)).toThrow('Valid lookback period is required');
    });

    it('throws error for invalid TP sequence dependencies', () => {
      const config = new SessionConfig();
      config.tp_mode = 'exp_rr_seq';
      config.live_rr_sequence = [1, 2];
      config.exit_rr_sequence = [0];
      expect(() => (service as any).validateConfig(config)).toThrow('Exit RR sequence must match Live RR sequence length');
    });

    it('throws error for invalid EMA Dual Cross parameters', () => {
      const config = new SessionConfig();
      config.enabled_signals = ['ema_dual_cross'];
      config.signal_params = JSON.stringify({ entry_ema_fast: 21, entry_ema_slow: 9 });
      expect(() => (service as any).validateConfig(config)).toThrow('EMA Dual Cross: Fast period must be less than slow period');
    });

    it('throws error if risk per trade exceeds max total risk', () => {
      const config = new SessionConfig();
      config.risk_pct_per_trade = 5;
      config.max_total_risk_pct = 2;
      expect(() => (service as any).validateConfig(config)).toThrow('Risk per trade cannot exceed maximum total risk');
    });

    it('passes for a valid config', () => {
      const config = new SessionConfig();
      config.scan_mode = 'interval';
      config.sl_type = 'pct';
      config.tp_mode = 'fixed';
      config.risk_pct_per_trade = 1;
      config.max_total_risk_pct = 5;
      expect(() => (service as any).validateConfig(config)).not.toThrow();
    });
  });

  describe('getStatus', () => {
    it('filters out invalid active trades from database', async () => {
      const mockTradeRepository = {
        find: jest.fn().mockResolvedValue([
          { symbol: 'BTCUSDT', status: 'OPEN', entry_price: 50000, qty: 1 },
          { symbol: 'ETHUSDT', status: 'OPEN', entry_price: NaN, qty: 1 },
          { symbol: 'SOLUSDT', status: 'OPEN', entry_price: 100, qty: undefined },
        ]),
      } as any;
      
      const mockTradingSessionService = {
        getStatus: jest.fn().mockReturnValue({ running: false, activeTrades: [] }),
      } as any;
      
      const mockLogRepository = {
        find: jest.fn().mockResolvedValue([]),
      } as any;
      
      const service = new SessionService(
        mockRepository, // Session
        mockTradeRepository, // Trade
        mockLogRepository, // Log
        mockRepository, // Settings
        mockTradingSessionService,
        mockAnalyticsService
      );
      
      (service as any).currentSessionId = 'test-id';
      // Mock sessionRepository.findOne to return a valid session
      mockRepository.findOne.mockResolvedValue({ id: 'test-id', running: true });
      
      const result = await (service as any).getStatus();
      
      expect(result.activeTrades).toHaveLength(1);
      expect(result.activeTrades[0].symbol).toBe('BTCUSDT');
    });
  });

  describe('startSession PnL continuity', () => {
    it('correctly recovers starting balance from totalPnl on restart if missing in config', async () => {
      const existingSession = {
        id: 'test-uuid',
        balance: 11000,
        totalPnl: 1000,
        paperMode: true,
        config: {},
        running: false
      };
      mockRepository.findOne.mockResolvedValue(existingSession);
      mockRepository.save.mockResolvedValue({ ...existingSession, id: 'test-uuid', running: true });

      await service.startSession(new SessionConfig(), true, 'test-uuid');

      const restartCall = mockTradingSessionService.start.mock.calls[0];
      expect(restartCall[0].paper_starting_balance).toBe(10000);
    });

    it('initializes starting balance in config for new sessions', async () => {
      mockRepository.save.mockResolvedValue({ id: 'new-uuid', balance: 10000, running: true });

      const config = new SessionConfig();
      config.paper_starting_balance = undefined;

      await service.startSession(config, true);

      const startCall = mockTradingSessionService.start.mock.calls[mockTradingSessionService.start.mock.calls.length - 1];
      expect(startCall[0].paper_starting_balance).toBe(10000);
    });
  });

  describe('saveTradeAtomic', () => {
    let mockQueryRunner: any;

    beforeEach(() => {
      mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        manager: {
          save: jest.fn(),
          increment: jest.fn(),
          update: jest.fn(),
        },
      };
      mockRepository.manager = {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
        },
      };
    });

    it('should rollback transaction if trade save fails', async () => {
      const trade = { symbol: 'BTCUSDT', status: 'CLOSED', entry_price: 50000, qty: 1, pnl: 100 } as any;
      mockQueryRunner.manager.save.mockRejectedValue(new Error('DB SAVE FAILED'));
      (service as any).currentSessionId = 'session-123';

      await service.saveTradeAtomic(trade, 10100);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.manager.increment).not.toHaveBeenCalled();
    });

    it('should commit transaction if all steps succeed', async () => {
      const trade = { symbol: 'BTCUSDT', status: 'CLOSED', entry_price: 50000, qty: 1, pnl: 100 } as any;
      (service as any).currentSessionId = 'session-123';

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '100' }),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);

      await service.saveTradeAtomic(trade, 10100);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(SessionEntity, 'session-123', {
        balance: 10100,
        totalPnl: 100
      });
    });

    it('should be idempotent and not double count PnL if called twice', async () => {
      const trade = { symbol: 'BTCUSDT', status: 'CLOSED', entry_price: 50000, qty: 1, pnl: 100 } as any;
      (service as any).currentSessionId = 'session-123';

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '100' }),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);

      // Call twice
      await service.saveTradeAtomic(trade, 10100);
      await service.saveTradeAtomic(trade, 10100);

      // totalPnl should still be 100 because it's recomputed from the database SUM
      expect(mockQueryRunner.manager.update).toHaveBeenLastCalledWith(SessionEntity, 'session-123', {
        balance: 10100,
        totalPnl: 100
      });
    });
  });
});
