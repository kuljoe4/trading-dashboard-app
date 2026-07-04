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
    mockConfig.frequency_shaping_enabled = true;
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

    const symbolHash = 'BTCUSDT'.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const jitterSeed = (Math.floor(lastTradeTs / 10000) * 10000) + symbolHash;
    const jitterFactor = 1 + ((Math.abs(Math.sin(jitterSeed)) * 50) / 100);
    const effectivePeriodMs = 60 * 60 * 1000 * jitterFactor;
    const isInside = (now - lastTradeTs) < effectivePeriodMs;

    expect(result.canEnter).toBe(!isInside);
    if (!result.canEnter) {
      expect(result.reason).toContain('Max trades per period reached');
      expect(result.reason).toContain(`${Math.round(effectivePeriodMs / 60000)}m`);
    }
  });

  describe('EnteringCount Safety', () => {
    it('should include enteringCount in global max open trades check', () => {
      const activeTrades = new Array(4).fill({ symbol: 'BTCUSDT' }) as any;
      const closedTrades: any[] = [];
      const balance = 10000;
      const config = { max_open_trades: 5 } as any;
      const totalSlUsed = 0;
      const enteringCount = 1;

      // With 4 active and 1 entering, total is 5 (max). Next entry should be blocked.
      const result = service.canEnter(activeTrades, closedTrades, balance, 'ETHUSDT', config, totalSlUsed, enteringCount);
      expect(result.canEnter).toBe(false);
      expect(result.reason).toContain('Global max open trades (5) reached (incl. 1 pending)');
    });

    it('should include enteringCount in trades_per_period limit', () => {
      const activeTrades: any[] = [];
      const closedTrades: any[] = [];
      const balance = 10000;
      const config = { max_trades_per_period: 2, trades_period_min: 60 } as any;
      const totalSlUsed = 0;
      const enteringCount = 2;

      const result = service.canEnter(activeTrades, closedTrades, balance, 'BTCUSDT', config, totalSlUsed, enteringCount);
      expect(result.canEnter).toBe(false);
      expect(result.reason).toContain('Max trades per period reached');
    });

    it('should enforce spacing if enteringCount > 0', () => {
      const activeTrades: any[] = [];
      const closedTrades: any[] = [];
      const balance = 10000;
      const config = {
        frequency_shaping_enabled: true,
        min_trade_interval_min: 5
      } as any;
      const totalSlUsed = 0;
      const enteringCount = 1;

      const result = service.canEnter(activeTrades, closedTrades, balance, 'BTCUSDT', config, totalSlUsed, enteringCount);
      expect(result.canEnter).toBe(false);
      expect(result.reason).toContain('Trade spacing active');
    });
  });

  describe('Performance Benchmark', () => {
    it('should be significantly faster on subsequent calls due to caching', () => {
      const now = Date.now();
      const largeClosedTrades: Trade[] = Array(500).fill(0).map((_, i) => ({
        id: `trade-${i}`,
        entry_ts: new Date(now - (i + 1) * 60 * 1000),
        exit_ts: new Date(now - i * 60 * 1000),
        pnl: i % 2 === 0 ? 10 : -5
      } as Trade));

      const active: Trade[] = [];
      const balance = 10000;
      const totalSlUsed = 0;

      // 1. Warm up / Initial scan (Cache Miss)
      const startInitial = performance.now();
      service.canEnter(active, largeClosedTrades, balance, 'BTCUSDT', mockConfig, totalSlUsed);
      const endInitial = performance.now();
      const initialDuration = endInitial - startInitial;

      // 2. Subsequent calls (Cache Hit)
      const ITERATIONS = 1000;
      const startCached = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        service.canEnter(active, largeClosedTrades, balance, 'BTCUSDT', mockConfig, totalSlUsed);
      }
      const endCached = performance.now();
      const totalCachedDuration = endCached - startCached;
      const averageCachedDuration = totalCachedDuration / ITERATIONS;

      console.log(`[Performance Benchmark] Initial O(N) scan: ${initialDuration.toFixed(4)}ms`);
      console.log(`[Performance Benchmark] Average cached O(1) scan: ${averageCachedDuration.toFixed(4)}ms`);
      console.log(`[Performance Benchmark] Total for ${ITERATIONS} iterations: ${totalCachedDuration.toFixed(4)}ms`);

      // Expectations: Average cached should be much faster than initial
      // On some environments, initialDuration might be very small if Node optimizes the loop,
      // but cached should be effectively near zero.
      expect(averageCachedDuration).toBeLessThan(initialDuration);

      // Verification of correctness: Ensure cached results match initial scan logic
      const result = service.canEnter(active, largeClosedTrades, balance, 'BTCUSDT', mockConfig, totalSlUsed);
      expect(result.tradesInPeriod).toBeGreaterThan(0);
    });
  });
});
