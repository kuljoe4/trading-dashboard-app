import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';

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

  beforeEach(() => {
    service = new SessionService(
      mockRepository,
      mockRepository,
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
});
