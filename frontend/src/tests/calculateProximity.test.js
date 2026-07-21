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
});
