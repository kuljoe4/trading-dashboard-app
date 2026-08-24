import { test } from 'node:test';
import assert from 'node:assert';
import { calculateProximity } from '../lib/formatters.js';

test('calculateProximity unit tests', async (t) => {
  await t.test('returns 0 for null/undefined/missing signals', () => {
    assert.strictEqual(calculateProximity(null, 100, 100), 0);
  });

  await t.test('returns 0 if insufficientData is true', () => {
    assert.strictEqual(calculateProximity({ insufficientData: true }, 100, 100), 0);
  });

  await t.test('returns 100 if fired and active are true', () => {
    assert.strictEqual(calculateProximity({ fired: true, active: true }, 100, 100), 100);
  });

  await t.test('clamps progress to 99% if not fired yet (price-based)', () => {
    const signal = {
      value: 100,
      threshold: 100,
      fired: false,
      threshold_is_price: true
    };
    const res = calculateProximity(signal, 100, 95);
    assert.strictEqual(res, 99);
  });

  await t.test('handles price-based LONG progress correctly', () => {
    const signal = {
      value: 98,
      threshold: 100,
      fired: false,
      threshold_is_price: true
    };
    // Entry = 90, Mark = 95, Threshold = 100
    // Total distance = 10, Current distance = 5 -> 50%
    const res = calculateProximity(signal, 95, 90);
    assert.strictEqual(res, 50);
  });

  await t.test('handles indicator-based signals with opposite sign guard', () => {
    const signal = {
      value: -1.5,
      threshold: 5.0,
      fired: false
    };
    const res = calculateProximity(signal, 100, 100);
    assert.strictEqual(res, 0); // Opposite signs -> 0
  });

  await t.test('handles indicator-based signals with correct sign', () => {
    const signal = {
      value: 2.5,
      threshold: 5.0,
      fired: false
    };
    const res = calculateProximity(signal, 100, 100);
    assert.strictEqual(res, 50); // 2.5/5.0 -> 50%
  });

  await t.test('handles direction-aware exit signals for LONG when profitable', () => {
    const signal = {
      value: 120,
      threshold: 105,
      fired: false,
      threshold_is_price: true
    };
    // Entry = 100, Threshold = 105, Mark = 120
    // Reference = 5, Distance = 15. Progress = (1 - (15 / 5)) * 100 = -200 -> clamped to 0
    const res = calculateProximity(signal, 120, 100, true, true);
    assert.strictEqual(res, 0);

    // Entry = 100, Threshold = 105, Mark = 106
    // Reference = 5, Distance = 1. Progress = (1 - (1 / 5)) * 100 = 80
    const resNear = calculateProximity(signal, 106, 100, true, true);
    assert.strictEqual(resNear, 80);
  });

  await t.test('handles direction-aware exit signals for SHORT when profitable', () => {
    const signal = {
      value: 95,
      threshold: 105,
      fired: false,
      threshold_is_price: true
    };
    // Entry = 110, Threshold = 105, Mark = 95
    // Reference = 5, Distance = 10. Progress = (1 - (10 / 5)) * 100 = -100 -> clamped to 0
    const res = calculateProximity(signal, 95, 110, false, true);
    assert.strictEqual(res, 0);

    // Entry = 110, Threshold = 105, Mark = 104
    // Reference = 5, Distance = 1. Progress = (1 - (1 / 5)) * 100 = 80
    const resNear = calculateProximity(signal, 104, 110, false, true);
    assert.strictEqual(resNear, 80);
  });

  await t.test('handles dual EMA cross/close when entry is zero or equal to threshold', () => {
    const signal = {
      value: 99.8,
      threshold: 100.0,
      fired: false,
      threshold_is_price: true
    };
    // Spread = 0.2, MaxSpread = 1.0 (1% of 100). Progress = (1 - 0.2/1.0)*100 = 80%
    const res = calculateProximity(signal, 99.8, 0, true, true);
    assert.strictEqual(Math.round(res), 80);
  });

  await t.test('handles dual EMA cross/close for live trades with non-zero entry price', () => {
    const signal = {
      key: 'ema_dual_cross',
      value: 99.8,
      threshold: 100.0,
      metric: 'Exit EMA Dual',
      fired: false,
      threshold_is_price: true
    };
    // Even when entry is 90 and mark is 105, for an EMA dual cross signal, proximity evaluates Fast EMA vs Slow EMA convergence
    // Spread = 0.2, MaxSpread = 1.0 -> 80%
    const res = calculateProximity(signal, 105, 90, true, true);
    assert.strictEqual(Math.round(res), 80);
  });
});
