import { RiskEngineService } from './riskEngine';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('RiskEngineService - Frequency Limits', () => {
  let service: RiskEngineService;
  let mockConfig: SessionConfig;

  beforeEach(() => {
    service = new RiskEngineService();
    mockConfig = new SessionConfig();
    mockConfig.max_open_trades = 5;
    mockConfig.max_trades_per_period = 2;
    mockConfig.trades_period_min = 60;
    mockConfig.max_trades_24h = 5;
    mockConfig.min_trade_interval_min = 10;
    mockConfig.trades_jitter_pct = 0;
  });

  it('should allow entry if within all limits', () => {
    const active: Trade[] = [];
    const closed: Trade[] = [];
    const result = service.canEnter(active, closed, 10000, 'BTCUSDT', mockConfig, 0);
    expect(result.canEnter).toBe(true);
    expect(result.reason).toBe('OK');
  });

  it('should block entry if min_trade_interval_min is violated', () => {
    const now = Date.now();
    const active: Trade[] = [
      { symbol: 'ETHUSDT', entry_ts: new Date(now - 5 * 60 * 1000) } as Trade
    ];
    const result = service.canEnter(active, [], 10000, 'BTCUSDT', mockConfig, 0);
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('Trade spacing active');
  });

  it('should allow entry if min_trade_interval_min is respected', () => {
    const now = Date.now();
    const active: Trade[] = [
      { symbol: 'ETHUSDT', entry_ts: new Date(now - 15 * 60 * 1000) } as Trade
    ];
    const result = service.canEnter(active, [], 10000, 'BTCUSDT', mockConfig, 0);
    expect(result.canEnter).toBe(true);
  });

  it('should block entry if max_trades_per_period is reached', () => {
    const now = Date.now();
    const closed: Trade[] = [
      { entry_ts: new Date(now - 20 * 60 * 1000) } as Trade,
      { entry_ts: new Date(now - 40 * 60 * 1000) } as Trade
    ];
    const result = service.canEnter([], closed, 10000, 'BTCUSDT', mockConfig, 0);
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('Max trades per period reached');
  });

  it('should block entry if max_trades_24h is reached', () => {
    mockConfig.max_trades_per_period = 10; // Disable period limit
    const now = Date.now();
    const closed: Trade[] = Array(5).fill(0).map((_, i) => ({
      entry_ts: new Date(now - (i + 1) * 2 * 60 * 60 * 1000) // Every 2 hours
    } as Trade));

    const result = service.canEnter([], closed, 10000, 'BTCUSDT', mockConfig, 0);
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('Rolling 24h limit reached');
  });

  it('should apply jitter to the period window', () => {
    mockConfig.trades_jitter_pct = 50; // 50% jitter
    mockConfig.max_trades_per_period = 1;
    mockConfig.trades_period_min = 60;

    const now = Date.now();
    const lastTradeTs = now - 75 * 60 * 1000;
    const closed: Trade[] = [
      { entry_ts: new Date(lastTradeTs) } as Trade
    ];

    const result = service.canEnter([], closed, 10000, 'BTCUSDT', mockConfig, 0);

    const jitterFactor = 1 + ((Math.abs(Math.sin(lastTradeTs)) * 50) / 100);
    const effectivePeriodMs = 60 * 60 * 1000 * jitterFactor;
    const isInside = (now - lastTradeTs) < effectivePeriodMs;

    expect(result.canEnter).toBe(!isInside);
    if (!result.canEnter) {
      expect(result.reason).toContain('Max trades per period reached');
      expect(result.reason).toContain(`${Math.round(effectivePeriodMs / 60000)}m`);
    }
  });
});
