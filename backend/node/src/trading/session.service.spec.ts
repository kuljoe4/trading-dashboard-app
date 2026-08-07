import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';

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
    setBinanceClient: jest.fn(),
    fetchPosition: jest.fn(),
    getTrade: jest.fn(),
    reconcileMilestoneFromSl: jest.fn().mockReturnValue(0),
    getStatus: jest.fn().mockReturnValue({ running: false, activeTrades: [] }),
  } as any;

  const mockAnalyticsService = {
    calculateAnalytics: jest.fn(),
  } as any;

  const mockBinanceClientFactory = {
    createClient: jest.fn(),
  } as any;

  const mockAuditLogService = {
    log: jest.fn(),
  } as any;

  const mockOrderManagerService = {
    cancelBinanceOrder: jest.fn(),
  } as any;

  const mockTradeRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as any;

  const mockLogRepository = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    insert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    findOne: jest.fn().mockResolvedValue(null),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionService(
      mockRepository, // Session
      mockTradeRepository, // Trade
      mockLogRepository, // Log
      mockRepository, // Settings
      mockRepository, // BalanceHistory
      mockTradingSessionService,
      mockOrderManagerService,
      { fetchExchangeInfo: jest.fn().mockResolvedValue({}) } as any, // marketFeed
      { emit: jest.fn() } as any, // EventEmitter2
      mockAnalyticsService,
      { calculateRrOptimization: jest.fn() } as any,
      mockBinanceClientFactory,
      mockAuditLogService,
      { get: jest.fn().mockReturnValue('postgres://user:pass@localhost:5432/db') } as any // ConfigService
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
      config.signal_params = { entry_ema_fast: 21, entry_ema_slow: 9 };
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

    it('throws error for invalid slippage_abort_threshold (FIX VERIFICATION)', () => {
      const config = new SessionConfig();
      config.slippage_abort_threshold = 0.5; // Max is 0.15
      expect(() => (service as any).validateConfig(config)).toThrow('Slippage abort threshold cannot exceed 15%');
    });

    it('throws error if dynamic records contain too many keys', () => {
      const config = new SessionConfig();
      config.exit_signal_delays = {};
      for (let i = 0; i < 51; i++) {
        config.exit_signal_delays[`sig_${i}`] = 10;
      }
      expect(() => (service as any).validateConfig(config)).toThrow('exit_signal_delays cannot exceed 50 entries');
    });

    it('throws error for invalid key names or HTML tags in records', () => {
      const config = new SessionConfig();
      config.exit_signal_delays = { 'invalid<tag>': 10 };
      expect(() => (service as any).validateConfig(config)).toThrow('Invalid key format in exit_signal_delays');

      const config2 = new SessionConfig();
      config2.signal_timeframes = { ['too_long_key_'.repeat(10)]: '1m' };
      expect(() => (service as any).validateConfig(config2)).toThrow('Invalid key format in signal_timeframes');
    });

    it('throws error for invalid types or values in exit_signal_delays', () => {
      const config = new SessionConfig();
      config.exit_signal_delays = { ema_cross: -10 };
      expect(() => (service as any).validateConfig(config)).toThrow('exit_signal_delays values must be numbers between 0 and 86400');

      const config2 = new SessionConfig();
      config2.exit_signal_delays = { ema_cross: '10' as any };
      expect(() => (service as any).validateConfig(config2)).toThrow('exit_signal_delays values must be numbers between 0 and 86400');
    });

    it('throws error for invalid exit_signal_actions values', () => {
      const config = new SessionConfig();
      config.exit_signal_actions = { ema_cross: 'invalid_action' as any };
      expect(() => (service as any).validateConfig(config)).toThrow("exit_signal_actions values must be 'close' or 'lock_sl'");
    });

    it('throws error for invalid signal_timeframes values', () => {
      const config = new SessionConfig();
      config.signal_timeframes = { ema_cross: '10m' }; // '10m' is not a valid Binance interval
      expect(() => (service as any).validateConfig(config)).toThrow('signal_timeframes values must be valid Binance kline intervals');
    });

    it('throws error for nested objects or arrays of non-primitives in signal_params', () => {
      const config = new SessionConfig();
      config.signal_params = { nested: { some: 'object' } };
      expect(() => (service as any).validateConfig(config)).toThrow('Nested objects in signal_params are not allowed for key "nested"');
    });

    it('throws error for HTML strings or too long strings in signal_params values', () => {
      const config = new SessionConfig();
      config.signal_params = { custom_string: '<script>alert(1)</script>' };
      expect(() => (service as any).validateConfig(config)).toThrow('Invalid value in signal_params for key "custom_string"');

      const config2 = new SessionConfig();
      config2.signal_params = { custom_string: 'a'.repeat(101) };
      expect(() => (service as any).validateConfig(config2)).toThrow('Invalid value in signal_params for key "custom_string"');
    });

    it('allows valid dynamic configurations', () => {
      const config = new SessionConfig();
      config.exit_signal_delays = { ema_cross: 30 };
      config.exit_signal_actions = { ema_cross: 'close' };
      config.signal_timeframes = { ema_cross: 'default' };
      config.scanner_weights = { momentum: 0.5, volatility: 0.3, trend: 0.2 };
      config.signal_params = { my_param: 'valid_string', my_num: 123, my_bool: true, arr: [1, 'ok'] };
      expect(() => (service as any).validateConfig(config)).not.toThrow();
    });
  });

  describe('startSession Security Enforcement', () => {
    it('throws ConfigValidationException if starting a live session without ENCRYPTION_KEY', async () => {
      const config = new SessionConfig();
      config.trading_mode = 'live';

      const originalEnv = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = ''; // Empty string simulates missing env

      try {
        await service.startSession(config, false);
        throw new Error('Should have thrown ConfigValidationException');
      } catch (e: any) {
        expect(e.message).toContain('ENCRYPTION_KEY must be set to start a session in live or testnet mode');
      } finally {
        process.env.ENCRYPTION_KEY = originalEnv;
      }
    });

    it('throws ConfigValidationException if starting a testnet session without ENCRYPTION_KEY', async () => {
      const config = new SessionConfig();
      config.trading_mode = 'testnet';

      const originalEnv = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = ''; // Empty string simulates missing env

      try {
        await service.startSession(config, false);
        throw new Error('Should have thrown ConfigValidationException');
      } catch (e: any) {
        expect(e.message).toContain('ENCRYPTION_KEY must be set to start a session in live or testnet mode');
      } finally {
        process.env.ENCRYPTION_KEY = originalEnv;
      }
    });

    it('allows starting a paper session without ENCRYPTION_KEY', async () => {
      const config = new SessionConfig();
      config.trading_mode = 'paper';

      mockRepository.save.mockResolvedValue({ id: 'paper-uuid', balance: 10000, running: true });
      mockRepository.findOne.mockResolvedValue({ paper_balance: 10000.0 });

      const originalEnv = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      try {
        await service.startSession(config, true);
        expect(mockTradingSessionService.start).toHaveBeenCalled();
      } finally {
        process.env.ENCRYPTION_KEY = originalEnv;
      }
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
        mockRepository, // BalanceHistory
        mockTradingSessionService,
        mockOrderManagerService,
        {} as any, // marketFeed
        { emit: jest.fn() } as any, // EventEmitter2
        mockAnalyticsService,
        { calculateRrOptimization: jest.fn() } as any,
        mockBinanceClientFactory,
        mockAuditLogService,
        { get: jest.fn().mockReturnValue('postgres://user:pass@localhost:5432/db') } as any // ConfigService
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
      mockRepository.findOne.mockResolvedValue({ paper_balance: 10000.0 }); // Settings mock

      const config = new SessionConfig();
      config.paper_starting_balance = undefined;

      await service.startSession(config, true);

      const startCall = mockTradingSessionService.start.mock.calls[mockTradingSessionService.start.mock.calls.length - 1];
      expect(startCall[0].paper_starting_balance).toBe(10000);
    });

    it('retains the paused and paused_strategies config settings on resume', async () => {
      const config = new SessionConfig();
      config.paused = true;
      config.paused_strategies = ['Base Strategy', 'Variant Strategy'];

      const existingSession = {
        id: 'test-resume-pause',
        balance: 10000,
        totalPnl: 0,
        paperMode: true,
        config,
        running: false
      };
      mockRepository.findOne.mockResolvedValue(existingSession);
      mockRepository.save.mockResolvedValue({ ...existingSession, running: true });

      await service.startSession(config, true, 'test-resume-pause');

      const restartCall = mockTradingSessionService.start.mock.calls[mockTradingSessionService.start.mock.calls.length - 1];
      expect(restartCall[0].paused).toBe(true);
      expect(restartCall[0].paused_strategies).toContain('Base Strategy');
      expect(restartCall[0].paused_strategies).toContain('Variant Strategy');
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
          findOne: jest.fn(),
          createQueryBuilder: jest.fn(),
        },
      };
      mockRepository.manager = {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
        },
      };
    });

    it('should rollback transaction and throw error if trade save fails', async () => {
      const trade = { symbol: 'BTCUSDT', status: 'CLOSED', entry_price: 50000, qty: 1, pnl: 100 } as any;
      mockQueryRunner.manager.findOne.mockResolvedValue({ id: 'session-123', paperMode: true });
      mockQueryRunner.manager.save.mockRejectedValue(new Error('DB SAVE FAILED'));
      (service as any).currentSessionId = 'session-123';

      await expect(service.saveTradeAtomic(trade, 10100)).rejects.toThrow('DB SAVE FAILED');

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
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '100' }),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
      mockQueryRunner.manager.findOne.mockResolvedValue({ id: 'session-123', paperMode: true });

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
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '100' }),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
      mockQueryRunner.manager.findOne.mockResolvedValue({ id: 'session-123', paperMode: true });

      // Call twice
      await service.saveTradeAtomic(trade, 10100);
      await service.saveTradeAtomic(trade, 10100);

      // totalPnl should still be 100 because it's recomputed from the database SUM
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(SessionEntity, 'session-123', {
        balance: 10100,
        totalPnl: 100
      });
    });

    it('should persist exit_signal_type and exit_signal_reason', async () => {
      const trade = {
        symbol: 'BTCUSDT',
        status: 'CLOSED_SIGNAL',
        entry_price: 50000,
        qty: 1,
        pnl: 100,
        exit_signal_type: 'EMA_CROSS',
        exit_signal_reason: 'Fast EMA crossed below slow EMA'
      } as any;
      (service as any).currentSessionId = 'session-123';

      mockTradeRepository.create.mockImplementation((d: any) => d);

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '100' }),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
      mockQueryRunner.manager.findOne.mockResolvedValue({ id: 'session-123', paperMode: true });

      await service.saveTradeAtomic(trade, 10100);

      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(TradeEntity, expect.objectContaining({
        exit_signal_type: 'EMA_CROSS',
        exit_signal_reason: 'Fast EMA crossed below slow EMA'
      }));
    });

    it('should persist new debugging fields (signal confidence, prices, status)', async () => {
      const trade = {
        symbol: 'BTCUSDT',
        status: 'OPEN',
        entry_price: 50000,
        qty: 1,
        entry_signal_type: 'breakout',
        entry_signal_confidence: 0.85,
        mark_price: 50100,
        last_price: 50050,
        exit_signals_status: { 'EMA_CROSS': { fired: false, active: true } },
        last_close_attempt_ts: 1624250300000,
        _sig_json: '{"EMA_CROSS":{"fired":false,"active":true}}'
      } as any;
      (service as any).currentSessionId = 'session-123';

      mockTradeRepository.create.mockImplementation((d: any) => d);

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '0' }),
      };
      mockQueryRunner.manager.createQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder);
      mockQueryRunner.manager.findOne.mockResolvedValue({ id: 'session-123', paperMode: true });

      await service.saveTradeAtomic(trade, 10000);

      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(TradeEntity, expect.objectContaining({
        entry_signal_type: 'breakout',
        entry_signal_confidence: 0.85,
        mark_price: 50100,
        last_price: 50050,
        exit_signals_status: { 'EMA_CROSS': { fired: false, active: true } },
        last_close_attempt_ts: 1624250300000,
        _sig_json: '{"EMA_CROSS":{"fired":false,"active":true}}'
      }));
    });
  });

  describe('logMessage rate limiting', () => {
    it('should rate limit logs per minute', async () => {
      (service as any).currentSessionId = 'session-123';
      const insertSpy = mockLogRepository.insert;

      // Send 60 logs
      for (let i = 0; i < 60; i++) {
        await (service as any).logMessage(`log ${i}`);
      }
      expect(insertSpy).toHaveBeenCalledTimes(60);

      // Send 61st log - should be rate limited
      await (service as any).logMessage('log 61');
      expect(insertSpy).toHaveBeenCalledTimes(60);
    });

    it('should use in-memory counter for 2000 log cap', async () => {
      (service as any).currentSessionId = 'session-cap';

      // Mock initial count
      mockLogRepository.count.mockResolvedValue(1999);

      // 1st log - should pass and increment to 2000
      await (service as any).logMessage('log 1');
      expect(mockLogRepository.insert).toHaveBeenCalled();
      expect(mockLogRepository.count).toHaveBeenCalledTimes(1);

      // 2nd log (info) - should be blocked by cap
      jest.clearAllMocks();
      await (service as any).logMessage('log 2', 'info');
      expect(mockLogRepository.insert).not.toHaveBeenCalled();
      // Should NOT call count() again
      expect(mockLogRepository.count).not.toHaveBeenCalled();

      // 3rd log (error) - should trigger deletion and insertion
      jest.clearAllMocks();
      mockLogRepository.findOne.mockResolvedValue({ id: 'old-log' });
      await (service as any).logMessage('log 3', 'error');
      expect(mockLogRepository.delete).toHaveBeenCalledWith('old-log');
      expect(mockLogRepository.insert).toHaveBeenCalled();
      expect(mockLogRepository.count).not.toHaveBeenCalled();
    });
  });

  describe('updateSession merging and protection', () => {
    let mockQueryRunner: any;

    beforeEach(() => {
      mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        manager: {
          update: jest.fn(),
          findOne: jest.fn(),
        },
      };
      mockRepository.manager = {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
        },
      };
    });

    it('should perform a shallow merge and preserve trading mode', async () => {
      const sessionId = 'session-id';
      const existingSession = {
        id: sessionId,
        tradingMode: 'live',
        paperMode: false,
        config: {
          strategy_label: 'Original',
          max_trades_24h: 50,
          trading_mode: 'live',
          paper_mode: false
        }
      };

      mockQueryRunner.manager.findOne.mockResolvedValue(existingSession);

      const partialConfig = { max_trades_24h: 100, trading_mode: 'paper' } as any;
      await (service as any).updateSession(sessionId, partialConfig);

      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(SessionEntity, sessionId, {
        config: expect.objectContaining({
          strategy_label: 'Original',
          max_trades_24h: 100,
          trading_mode: 'live',
          paper_mode: false
        })
      });
    });

    it('should block modification of immutable fields while session is running', async () => {
      const sessionId = 'active-session-id';
      const existingSession = {
        id: sessionId,
        tradingMode: 'paper',
        paperMode: true,
        config: {
          trading_mode: 'paper',
          paper_mode: true,
          paper_starting_balance: 10000
        }
      };

      mockQueryRunner.manager.findOne.mockResolvedValue(existingSession);
      (service as any).sessionRunning = true;
      (service as any).currentSessionId = sessionId;

      const partialConfig = { paper_starting_balance: 20000 } as any;
      await expect(service.updateSession(sessionId, partialConfig)).rejects.toThrow('Cannot modify paper_starting_balance while session is running');
    });

    it('should reject updates with extraneous, un-decorated keys inside config', async () => {
      const sessionId = 'session-id';
      const existingSession = {
        id: sessionId,
        tradingMode: 'live',
        paperMode: false,
        config: {
          strategy_label: 'Original',
          max_trades_24h: 50,
          trading_mode: 'live',
          paper_mode: false
        }
      };

      mockQueryRunner.manager.findOne.mockResolvedValue(existingSession);

      const partialConfig = {
        max_trades_24h: 100,
        malicious_extraneous_key: 'hacked_payload_or_sql_injection'
      } as any;

      await expect(service.updateSession(sessionId, partialConfig)).rejects.toThrow();
    });
  });

  describe('updateTradeConfig Validation', () => {
    const mockTrade = {
      id: 'trade-id-123',
      symbol: 'BTCUSDT',
      status: 'OPEN',
      current_sl: 50000,
      sessionId: 'session-id-123',
      strategy_config: {
        strategy_label: 'Original Label',
        max_trades_24h: 10,
      },
    } as any;

    const mockSession = {
      id: 'session-id-123',
      tradingMode: 'paper',
      paperMode: true,
      config: {
        strategy_label: 'Original Label',
        max_trades_24h: 10,
      },
    };

    beforeEach(() => {
      mockTradeRepository.findOne.mockResolvedValue(mockTrade);
      mockRepository.findOne.mockResolvedValue(mockSession);
    });

    it('should successfully update strategy_config with valid overrides', async () => {
      const dto = {
        strategy_config: {
          strategy_label: 'New Valid Label',
          max_trades_24h: 20,
        },
      };

      const result = await service.updateTradeConfig('trade-id-123', dto);
      expect(result.status).toBe('updated');
      expect(result.trade.strategy_config).toEqual(expect.objectContaining({
        strategy_label: 'New Valid Label',
        max_trades_24h: 20,
      }));
    });

    it('should reject updates if strategy_config contains extraneous/un-decorated keys', async () => {
      const dto = {
        strategy_config: {
          strategy_label: 'New Label',
          malicious_key: 'malicious_content',
        },
      };

      await expect(service.updateTradeConfig('trade-id-123', dto as any)).rejects.toThrow();
    });

    it('should reject updates if strategy_config contains invalid parameter formats/constraints', async () => {
      const dto = {
        strategy_config: {
          strategy_label: '<script>alert("xss")</script>', // XSS payload rejected by regex
        },
      };

      await expect(service.updateTradeConfig('trade-id-123', dto as any)).rejects.toThrow();
    });

    it('should reject updates if sequences exceed 10 elements', async () => {
      const dto = {
        live_rr_sequence: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      };
      await expect(service.updateTradeConfig('trade-id-123', dto)).rejects.toThrow();
    });

    it('should reject updates if sequences have mismatching lengths', async () => {
      const dto = {
        live_rr_sequence: [1, 2],
        exit_rr_sequence: [1],
      };
      await expect(service.updateTradeConfig('trade-id-123', dto)).rejects.toThrow();
    });
  });

  describe('Manual Position Reconciliation & Adoption', () => {
    it('getUntrackedPositions should return untracked positions with suggested strategy labels', async () => {
      // Set up in-service states
      (service as any).sessionRunning = true;
      (service as any).currentSessionId = 'session-123';

      mockRepository.findOne.mockResolvedValue({
        id: 'session-123',
        tradingMode: 'live',
        paperMode: false,
        config: new SessionConfig()
      });

      // Mock discoverPositionStrategy to simulate finding a historical strategy match
      (service as any).discoverPositionStrategy = jest.fn().mockResolvedValue({
        startedByUs: true,
        strategyLabel: 'Macd 1hr'
      });

      mockTradingSessionService.fetchAllPositions = jest.fn().mockResolvedValue([
        { symbol: 'BTCUSDT', positionAmt: '1.5', entryPrice: '50000', markPrice: '50100' }
      ]);
      mockTradingSessionService.getActiveTradesRaw = jest.fn().mockReturnValue([]);

      mockOrderManagerService.fetchAllOpenOrders = jest.fn().mockResolvedValue([]);

      const res = await service.getUntrackedPositions();
      expect(res.positions).toHaveLength(1);
      expect(res.positions[0].symbol).toBe('BTCUSDT');
      expect(res.positions[0].notional).toBe(75000);
      expect(res.positions[0].startedByUs).toBe(true);
      expect(res.positions[0].suggestedStrategyLabel).toBe('Macd 1hr');
    });

    it('adoptPositionManually should successfully adopt untracked positions with selected strategy config override', async () => {
      (service as any).sessionRunning = true;
      (service as any).currentSessionId = 'session-123';

      const mockConfig = new SessionConfig();
      mockConfig.strategy_label = 'Momentum Strategy';
      mockConfig.strategy_variants = [
        { strategy_label: 'Macd 1hr', enabled: true, scan_interval: '1h' } as any
      ];

      mockRepository.findOne.mockResolvedValue({
        id: 'session-123',
        tradingMode: 'live',
        paperMode: false,
        config: mockConfig
      });

      mockTradingSessionService.getActiveTradesRaw = jest.fn().mockReturnValue([]);
      mockOrderManagerService.fetchPosition = jest.fn().mockResolvedValue({
        symbol: 'BTCUSDT',
        positionAmt: '1.5',
        entryPrice: '50000',
        markPrice: '50100'
      });
      mockOrderManagerService.fetchOpenOrders = jest.fn().mockResolvedValue([]);
      mockOrderManagerService.placeStopLoss = jest.fn().mockImplementation((trade: any, slPrice: number) => ({
        orderId: 'sl-order-123',
        price: slPrice
      }));

      // Mock save to return a TradeEntity
      mockTradeRepository.create.mockImplementation((dto: any) => dto);
      mockTradeRepository.save.mockResolvedValue({});

      mockTradingSessionService.addTrade = jest.fn();
      mockTradingSessionService.seedActiveTrades = jest.fn();

      const res = await service.adoptPositionManually('BTCUSDT', 'Macd 1hr');
      expect(res.status).toBe('adopted');
      expect(res.trade.symbol).toBe('BTCUSDT');
      expect(res.trade.strategy_label).toBe('Macd 1hr');
      expect(res.trade.strategy_config.scan_interval).toBe('1h'); // Successfully rehydrated target variant config!
    });

    it('adoptPositionManually should successfully adopt untracked positions with manual initial and current SL price overrides', async () => {
      (service as any).sessionRunning = true;
      (service as any).currentSessionId = 'session-123';

      const mockConfig = new SessionConfig();
      mockConfig.strategy_label = 'Momentum Strategy';

      mockRepository.findOne.mockResolvedValue({
        id: 'session-123',
        tradingMode: 'live',
        paperMode: false,
        config: mockConfig
      });

      mockTradingSessionService.getActiveTradesRaw = jest.fn().mockReturnValue([]);
      mockOrderManagerService.fetchPosition = jest.fn().mockResolvedValue({
        symbol: 'BTCUSDT',
        positionAmt: '1.5',
        entryPrice: '50000',
        markPrice: '50100'
      });
      mockOrderManagerService.fetchOpenOrders = jest.fn().mockResolvedValue([]);
      mockOrderManagerService.placeStopLoss = jest.fn().mockImplementation((trade: any, slPrice: number) => ({
        orderId: 'sl-order-123',
        price: slPrice
      }));

      // Mock save to return a TradeEntity
      mockTradeRepository.create.mockImplementation((dto: any) => dto);
      mockTradeRepository.save.mockResolvedValue({});

      mockTradingSessionService.addTrade = jest.fn();
      mockTradingSessionService.seedActiveTrades = jest.fn();

      const manualInitialSl = 48500;
      const manualCurrentSl = 49500;

      const res = await service.adoptPositionManually('BTCUSDT', 'Momentum Strategy', manualInitialSl, manualCurrentSl);
      expect(res.status).toBe('adopted');
      expect(res.trade.symbol).toBe('BTCUSDT');
      expect(res.trade.initial_sl).toBe(manualInitialSl); // Manual initial SL is respected!
      expect(res.trade.current_sl).toBe(manualCurrentSl); // Manual current SL is respected!
    });
  });
});
