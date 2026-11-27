import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeVariantConfigForSave } from '../utils/mergeStrategyVariantSave.js';

test('variant save persists edited values and preserves the base and sibling variants', () => {
  const current = {
    strategy_label: 'Base',
    risk_pct_per_trade: 0.5,
    strategy_variants: [
      { strategy_label: 'Variant A', risk_pct_per_trade: 0.2, scan_interval: '5m' },
      { strategy_label: 'Variant B', risk_pct_per_trade: 0.3, scan_interval: '15m' },
    ],
  };
  const submitted = {
    strategy_label: 'Base',
    risk_pct_per_trade: 0.5,
    strategy_variants: [
      { strategy_label: 'Variant A', risk_pct_per_trade: 0.8, scan_interval: '1m' },
      { strategy_label: 'Variant B', risk_pct_per_trade: 0.3, scan_interval: '15m' },
    ],
    _isMergedRootConfig: true,
  };

  const result = mergeVariantConfigForSave(current, submitted, 0);
  assert.equal(result.risk_pct_per_trade, 0.5);
  assert.equal(result.strategy_variants[0].risk_pct_per_trade, 0.8);
  assert.equal(result.strategy_variants[0].scan_interval, '1m');
  assert.equal(result.strategy_variants[1].risk_pct_per_trade, 0.3);
  assert.equal(current.strategy_variants[0].risk_pct_per_trade, 0.2);
  assert.deepEqual(result.strategy_variants[0].strategy_variants, []);
});

test('variant save does not erase variants when the submitted payload omits the array', () => {
  const current = {
    strategy_label: 'Base',
    strategy_variants: [
      { strategy_label: 'Variant A', risk_pct_per_trade: 0.2 },
      { strategy_label: 'Variant B', risk_pct_per_trade: 0.3 },
    ],
  };
  const submitted = { strategy_label: 'Variant A', risk_pct_per_trade: 0.9 };

  const result = mergeVariantConfigForSave(current, submitted, 0);
  assert.equal(result.strategy_label, 'Base');
  assert.equal(result.strategy_variants.length, 2);
  assert.equal(result.strategy_variants[0].risk_pct_per_trade, 0.9);
  assert.equal(result.strategy_variants[1].risk_pct_per_trade, 0.3);
});
