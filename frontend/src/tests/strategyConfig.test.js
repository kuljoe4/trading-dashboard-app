import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStrategyConfig, describeSignalTimeframe } from '../utils/strategyConfig.js';

test('variant scan default survives save/reload and supersedes the base timeframe', () => {
  const base = { scan_interval: '1d', signal_timeframes: { ema_dual: '1h', ema_dual_cross: '1h' } };
  const variant = JSON.parse(JSON.stringify({ scan_interval: '5m', signal_timeframes: { ema_dual_cross: 'default' } }));
  const effective = resolveStrategyConfig(base, variant);
  assert.equal(describeSignalTimeframe(effective, 'ema_dual_cross').timeframe, '5m');
  assert.equal(effective.signal_timeframes.ema_dual, '1h');
  assert.equal(base.signal_timeframes.ema_dual_cross, '1h');
  assert.equal(describeSignalTimeframe({ scan_interval: '5m' }, 'ema_dual_cross', base).timeframe, '1h');
});
