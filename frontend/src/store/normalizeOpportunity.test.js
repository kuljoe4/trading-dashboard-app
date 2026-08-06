import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeOpportunity } from './trading.js';

const base = {
  symbol: 'BTCUSDT',
  pct: 2.5,
  momentum: 2.5,
  dir: 'long',
  vol: 1000,
  score: 80,
  price: 50000,
  volume_rank: 3,
};

test('normalizeOpportunity preserves reference when display fields unchanged (memo win)', () => {
  const first = normalizeOpportunity(base);
  const second = normalizeOpportunity(base, first);
  assert.strictEqual(second, first, 'unchanged opportunity should reuse the previous reference');
  assert.strictEqual(typeof second._fingerprint, 'string');
});

test('normalizeOpportunity returns a new object when a display field changes', () => {
  const first = normalizeOpportunity(base);
  const changed = normalizeOpportunity({ ...base, price: 51000 }, first);
  assert.notStrictEqual(changed, first, 'changed opportunity should be a new object');
  assert.strictEqual(changed.price, 51000);
});

test('normalizeOpportunity returns a new object when signalResult changes', () => {
  const first = normalizeOpportunity({ ...base, signalResult: { allFired: false, firedSignals: [], reason: '' } });
  const changed = normalizeOpportunity(
    { ...base, signalResult: { allFired: true, firedSignals: ['macd'], reason: 'ok' } },
    first,
  );
  assert.notStrictEqual(changed, first, 'opportunity with a fired signal should be a new object');
  assert.strictEqual(changed.signalResult.allFired, true);
});

test('normalizeOpportunity retains slow-changing telemetry from prev when omitted', () => {
  const sb = { momentum: 1, volatility: 2, trend: 3 };
  const prev = normalizeOpportunity({
    ...base,
    score_breakdown: sb,
    history: [1, 2, 3],
    ohlc_history: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
  });
  // New broadcast keeps score_breakdown identical but omits history/ohlc -> reuse prev
  const next = normalizeOpportunity({ ...base, score_breakdown: sb }, prev);
  assert.strictEqual(next, prev, 'should reuse prev reference');
  assert.deepStrictEqual(next.history, [1, 2, 3]);
  assert.deepStrictEqual(next.ohlc_history, [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
});

test('normalizeOpportunity applies new telemetry when a display field changes', () => {
  const prev = normalizeOpportunity({ ...base, history: [1, 2, 3] });
  // price changes -> new object, and the new payload's history is incorporated
  const next = normalizeOpportunity({ ...base, price: 51000, history: [4, 5, 6] }, prev);
  assert.notStrictEqual(next, prev);
  assert.strictEqual(next.price, 51000);
  assert.deepStrictEqual(next.history, [4, 5, 6]);
});
