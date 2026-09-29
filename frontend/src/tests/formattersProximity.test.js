import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProximity } from '../lib/formatters.js';

test('calculateProximity contract tests', async (t) => {
  await t.test('stale event based signals should return 0', () => {
    const signal = {
      value: 100,
      threshold: 90,
      status: 'approaching',
      threshold_is_price: true,
      key: 'ema_cross',
      fired: false,
    };
    const prox = calculateProximity(signal, 100, 80, true, false);
    assert.equal(prox, 0); // Not 99 anymore
  });
});
