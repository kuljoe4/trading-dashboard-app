import { RiskEngineService } from './riskEngine';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('RiskEngineService - Spacing Inconsistency Audit', () => {
  let service: RiskEngineService;
  let mockConfig: SessionConfig;

  beforeEach(() => {
    service = new RiskEngineService();
    mockConfig = new SessionConfig();
    mockConfig.max_open_trades = 5;
    mockConfig.max_trades_per_period = 10;
    mockConfig.trades_period_min = 60;
    mockConfig.min_trade_interval_min = 10;
    mockConfig.frequency_shaping_enabled = true;
    mockConfig.trades_jitter_pct = 0;
  });

  it('should block entry if a reconciliation trade occurred recently (Inconsistency Check)', () => {
    const now = Date.now();
    // A reconciliation trade that occurred 2 minutes ago
    const recentReconciliationTrade = {
      symbol: 'BTCUSDT',
      entry_ts: new Date(now - 2 * 60 * 1000),
      is_reconciliation: true
    } as Trade;

    const active: Trade[] = [];
    const closed: Trade[] = [recentReconciliationTrade];

    const result = service.canEnter(active, closed, 10000, 'ETHUSDT', mockConfig, 0);

    // EVIDENCE: If this passes with canEnter: true, it proves the inconsistency
    // because the trade is within the 10m spacing window.
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('Trade spacing active');
  });

  it('should count reconciliation trades towards period limits', () => {
    const now = Date.now();
    mockConfig.max_trades_per_period = 1;
    mockConfig.min_trade_interval_min = 0; // Disable spacing to isolate period limit check

    const recentReconciliationTrade = {
      symbol: 'BTCUSDT',
      entry_ts: new Date(now - 2 * 60 * 1000),
      is_reconciliation: true
    } as Trade;

    const active: Trade[] = [];
    const closed: Trade[] = [recentReconciliationTrade];

    const result = service.canEnter(active, closed, 10000, 'ETHUSDT', mockConfig, 0);

    // This is expected to be blocked by period limit, confirming they ARE counted there.
    expect(result.canEnter).toBe(false);
    expect(result.reason).toContain('Max trades per period reached');
  });
});
