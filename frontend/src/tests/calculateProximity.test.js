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
    // Spread = 0.2 (0.2% relSpread). Progress = 99 / (1 + 118.75 * 0.002) = 80%
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
    // Spread = 0.2 (0.2% relSpread) -> ~80%
    const res = calculateProximity(signal, 105, 90, true, true);
    assert.strictEqual(Math.round(res), 80);
  });

  await t.test('ensures dual params read > 0% no matter how far apart and increase monotonically as they converge', () => {
    const makeSignal = (val) => ({
      key: 'ema_dual_cross',
      value: val,
      threshold: 100.0,
      fired: false,
      threshold_is_price: true
    });

    // Test wide spreads: 50% spread (val=150), 20% spread (val=120), 10% spread (val=110), 5% spread (val=105), 1% spread (val=101), 0.2% spread (val=100.2)
    const p50 = calculateProximity(makeSignal(150), 150, 0, true, false);
    const p20 = calculateProximity(makeSignal(120), 120, 0, true, false);
    const p10 = calculateProximity(makeSignal(110), 110, 0, true, false);
    const p5  = calculateProximity(makeSignal(105), 105, 0, true, false);
    const p1  = calculateProximity(makeSignal(101), 101, 0, true, false);
    const p02 = calculateProximity(makeSignal(100.2), 100.2, 0, true, false);

    assert.ok(p50 > 0, `p50 (${p50}) should be > 0%`);
    assert.ok(p20 > p50, `p20 (${p20}) should be > p50 (${p50})`);
    assert.ok(p10 > p20, `p10 (${p10}) should be > p20 (${p20})`);
    assert.ok(p5 > p10, `p5 (${p5}) should be > p10 (${p10})`);
    assert.ok(p1 > p5, `p1 (${p1}) should be > p5 (${p5})`);
    assert.ok(p02 > p1, `p02 (${p02}) should be > p1 (${p1})`);
  });
});
