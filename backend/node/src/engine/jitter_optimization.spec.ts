import { RiskEngineService } from './riskEngine';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('RiskEngineService - Market-Aware Jitter', () => {
  let service: RiskEngineService;
  let mockConfig: SessionConfig;

  // Replicate the hash logic from RiskEngineService
  const getHash = (n: number) => {
    let h = n >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
    h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
    h = h ^ (h >>> 15);
    return (h >>> 0) / 4294967296;
  };

  const getSymbolHash = (symbol: string) => {
    let symbolHash = 0x811c9dc5;
    for (let i = 0; i < symbol.length; i++) {
      symbolHash ^= symbol.charCodeAt(i);
      symbolHash = Math.imul(symbolHash, 0x01000193);
    }
    return symbolHash >>> 0;
  };

  beforeEach(() => {
    service = new RiskEngineService();
    mockConfig = new SessionConfig();
    mockConfig.frequency_shaping_enabled = true;
    mockConfig.trades_jitter_pct = 100; // 100% jitter for maximum visibility in tests
    mockConfig.max_trades_per_period = 1;
    mockConfig.trades_period_min = 60;
  });

  it('should apply zero jitter when score is 100 and market_aware is enabled', () => {
    mockConfig.trades_jitter_market_aware = true;
    const now = Date.now();
    // Use exactly 61 minutes ago. Without jitter, this is OUTSIDE the 60m period.
    const lastTradeTs = now - 61 * 60 * 1000;
    const closed: Trade[] = [{ entry_ts: new Date(lastTradeTs) } as Trade];

    const result = service.canEnter([], closed, 10000, 'BTCUSDT', mockConfig, 0, 0, 100);

    // With 100 score, jitter should be 0%. Effective period = 60m.
    // 61m > 60m, so it should allow entry.
    expect(result.canEnter).toBe(true);
  });

  it('should apply deterministic jitter when score is 0 and market_aware is enabled', () => {
    mockConfig.trades_jitter_market_aware = true;
    const now = Date.now();
    // 61 minutes ago.
    const lastTradeTs = now - 61 * 60 * 1000;
    const closed: Trade[] = [{ entry_ts: new Date(lastTradeTs) } as Trade];

    const result = service.canEnter([], closed, 10000, 'BTCUSDT', mockConfig, 0, 0, 0);

    // Check if jitter made the period longer than 61m
    const symbolHash = getSymbolHash('BTCUSDT');
    const jitterSeed = (Math.floor(lastTradeTs / 10000) * 10000) + (symbolHash % 10000);
    const jitterFactor = 1 + getHash(jitterSeed); // jitterPct is 100
    const effectivePeriodMs = 60 * 60 * 1000 * jitterFactor;

    if ((now - lastTradeTs) < effectivePeriodMs) {
        expect(result.canEnter).toBe(false);
        expect(result.reason).toContain('Max trades per period reached');
    }
  });

  it('should use symbol-specific seeds to prevent stampeding', () => {
    mockConfig.trades_jitter_market_aware = false; // Use standard jitter
    const now = Date.now();
    const lastTradeTs = now - 70 * 60 * 1000;
    const closed: Trade[] = [{ entry_ts: new Date(lastTradeTs) } as Trade];

    // Same config, same timestamp, DIFFERENT symbols
    const resultBTC = service.canEnter([], closed, 10000, 'BTCUSDT', mockConfig, 0, 0);
    const resultETH = service.canEnter([], closed, 10000, 'ETHUSDT', mockConfig, 0, 0);

    // One might be blocked, one might be allowed because their jitter factors differ
    // based on the symbol hash.
    const hashBTC = getSymbolHash('BTCUSDT');
    const hashETH = getSymbolHash('ETHUSDT');

    const seedBTC = (Math.floor(lastTradeTs / 10000) * 10000) + (hashBTC % 10000);
    const seedETH = (Math.floor(lastTradeTs / 10000) * 10000) + (hashETH % 10000);

    const factorBTC = 1 + getHash(seedBTC);
    const factorETH = 1 + getHash(seedETH);

    expect(factorBTC).not.toBe(factorETH);

    const periodBTC = 60 * 60 * 1000 * factorBTC;
    const periodETH = 60 * 60 * 1000 * factorETH;

    const elapsed = now - lastTradeTs;
    const canEnterBTC = elapsed >= periodBTC;
    const canEnterETH = elapsed >= periodETH;

    expect(resultBTC.canEnter).toBe(canEnterBTC);
    expect(resultETH.canEnter).toBe(canEnterETH);
  });

  it('should maintain backward compatibility when score is missing', () => {
    mockConfig.trades_jitter_market_aware = true;
    const now = Date.now();
    const lastTradeTs = now - 61 * 60 * 1000;
    const closed: Trade[] = [{ entry_ts: new Date(lastTradeTs) } as Trade];

    // marketScore is undefined
    const result = service.canEnter([], closed, 10000, 'BTCUSDT', mockConfig, 0);

    const symbolHash = getSymbolHash('BTCUSDT');
    const jitterSeed = (Math.floor(lastTradeTs / 10000) * 10000) + (symbolHash % 10000);
    const jitterFactor = 1 + getHash(jitterSeed);
    const effectivePeriodMs = 60 * 60 * 1000 * jitterFactor;

    expect(result.canEnter).toBe((now - lastTradeTs) >= effectivePeriodMs);
  });
});
