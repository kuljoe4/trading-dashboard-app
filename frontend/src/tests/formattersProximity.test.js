import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProximity } from '../lib/formatters.js';

test('calculateProximity contract tests', async (t) => {
  await t.test('returns 0 for missing or undefined signal', () => {
    assert.equal(calculateProximity(null, 100, 80), 0);
    assert.equal(calculateProximity(undefined, 100, 80), 0);
  });

  await t.test('returns 0 for insufficient data', () => {
    const signal = { insufficientData: true };
    assert.equal(calculateProximity(signal, 100, 80), 0);
  });

  await t.test('returns 100 when fired and active', () => {
    const signal = { fired: true, active: true, value: 50, threshold: 100 };
    assert.equal(calculateProximity(signal, 100, 80), 100);
  });

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

  await t.test('returns 0 when state is blocked, rejected or description includes rejected', () => {
    const s1 = { value: 100, threshold: 90, status: 'blocked', threshold_is_price: true, key: 'dual' };
    const s2 = { value: 100, threshold: 90, rejected: true, threshold_is_price: true, key: 'dual' };
    const s3 = { value: 100, threshold: 90, description: 'Rejected by MACD', threshold_is_price: true, key: 'dual' };

    assert.equal(calculateProximity(s1, 100, 80, true, false), 0);
    assert.equal(calculateProximity(s2, 100, 80, true, false), 0);
    assert.equal(calculateProximity(s3, 100, 80, true, false), 0);
  });

  await t.test('returns 0 for stale indicator-pair signals', () => {
    const s = { value: 100, threshold: 90, status: 'stale', threshold_is_price: true, key: 'dual' };
    assert.equal(calculateProximity(s, 100, 80, true, false), 0);
  });

  await t.test('price-based entry signal progress calculation', () => {
    const signal = { value: 95, threshold: 100, threshold_is_price: true };
    assert.equal(calculateProximity(signal, 95, 90, true, false), 50);
  });

  await t.test('price-based exit signal progress calculation', () => {
    const signal = { value: 95, threshold: 100, threshold_is_price: true };
    assert.equal(calculateProximity(signal, 95, 90, true, true), 99);
  });

  await t.test('indicator-based signals progress (threshold === 0)', () => {
    const signal = { value: 0.05, threshold: 0 };
    assert.equal(calculateProximity(signal, 100, 80, true, false), 66);
  });

  await t.test('indicator-based signals progress (positive threshold, long)', () => {
    const signal = { value: 50, threshold: 100 };
    assert.equal(calculateProximity(signal, 100, 80, true, false), 50);
  });

  await t.test('indicator-based signals progress (positive threshold, short magnitude calculation)', () => {
    const signal = { value: -50, threshold: 100 };
    assert.equal(calculateProximity(signal, 100, 80, false, false), 50);
  });

  await t.test('diverging is capped or zero depending on direction and indicator', () => {
    const wrongDirSignal = { value: 10, threshold: 100 };
    assert.equal(calculateProximity(wrongDirSignal, 100, 80, false, false), 0);
  });
});
