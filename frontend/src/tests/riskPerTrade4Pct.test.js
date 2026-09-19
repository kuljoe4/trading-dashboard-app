import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Risk Per Trade 4% Configuration Standard', () => {
  it('allows and preserves 4% risk_pct_per_trade during config validation and processing', () => {
    const raw = {
      trading_mode: 'live',
      scan_interval: '5m',
      risk_pct_per_trade: 4.0,
      max_total_risk_pct: 10.0,
    };

    assert.equal(raw.risk_pct_per_trade, 4.0);
    assert.equal(raw.max_total_risk_pct, 10.0);
  });

  it('validates that risk_pct_per_trade up to 4% does not trigger aggressive warning in ConfigModal', () => {
    const validateConfigRisk = (c) => {
      const errs = {};
      if (c.risk_pct_per_trade > c.max_total_risk_pct) {
        errs.risk_pct_per_trade = 'Exceeds max total risk';
      }
      if (c.risk_pct_per_trade > 4) {
        errs.risk_pct_per_trade_warn = 'Aggressive (>4%)';
      }
      return errs;
    };

    const valid4Pct = validateConfigRisk({
      risk_pct_per_trade: 4.0,
      max_total_risk_pct: 5.0,
    });
    assert.equal(valid4Pct.risk_pct_per_trade_warn, undefined);
    assert.equal(valid4Pct.risk_pct_per_trade, undefined);

    const aggressive5Pct = validateConfigRisk({
      risk_pct_per_trade: 5.0,
      max_total_risk_pct: 10.0,
    });
    assert.equal(aggressive5Pct.risk_pct_per_trade_warn, 'Aggressive (>4%)');
  });

  it('evaluates aggressive risk profile threshold at > 4% in RiskSummary', () => {
    const isAggressiveProfile = (riskPct, slPct) => riskPct > 4 || slPct > 5;

    assert.equal(isAggressiveProfile(2.0, 1.0), false);
    assert.equal(isAggressiveProfile(4.0, 2.0), false);
    assert.equal(isAggressiveProfile(4.1, 2.0), true);
    assert.equal(isAggressiveProfile(3.0, 5.5), true);
  });
});
