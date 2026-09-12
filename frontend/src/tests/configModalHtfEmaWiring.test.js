import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('ConfigModal HTF EMA Cross Ranking & SL Exceeds Max Form Wiring Verification', () => {
  const configModalPath = path.resolve(process.cwd(), 'frontend/src/components/ConfigModal.jsx');
  const modalCode = fs.readFileSync(configModalPath, 'utf8');

  // Verify HTF EMA Cross fields are wired in ConfigModal
  assert.ok(modalCode.includes('htf_ema_cross_boost_enabled'), 'ConfigModal must include htf_ema_cross_boost_enabled field');
  assert.ok(modalCode.includes('htf_ema_cross_interval'), 'ConfigModal must include htf_ema_cross_interval field');
  assert.ok(modalCode.includes('htf_ema_cross_count'), 'ConfigModal must include htf_ema_cross_count field');
  assert.ok(modalCode.includes('htf_ema_fast_period'), 'ConfigModal must include htf_ema_fast_period field');
  assert.ok(modalCode.includes('htf_ema_slow_period'), 'ConfigModal must include htf_ema_slow_period field');
  assert.ok(modalCode.includes('htf_ema_cross_max_boost'), 'ConfigModal must include htf_ema_cross_max_boost field');
  assert.ok(modalCode.includes('htf_ema_cross_rr_weight'), 'ConfigModal must include htf_ema_cross_rr_weight field');

  // Verify SL max rejection field is wired in ConfigModal
  assert.ok(modalCode.includes('reject_entry_if_sl_exceeds_max'), 'ConfigModal must include reject_entry_if_sl_exceeds_max field');
});
