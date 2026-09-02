import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../lib/formatters.js';

test('formatDuration correctness & parity tests', async (t) => {
  await t.test('handles null, undefined, and negative values gracefully', () => {
    assert.strictEqual(formatDuration(null), '0m');
    assert.strictEqual(formatDuration(undefined), '0m');
    assert.strictEqual(formatDuration(-1000), '0m');
  });

  await t.test('formats sub-minute and exact 0ms durations', () => {
    assert.strictEqual(formatDuration(0), '0m');
    assert.strictEqual(formatDuration(500), '0m');
    assert.strictEqual(formatDuration(59999), '0m');
  });

  await t.test('formats minute-only durations', () => {
    assert.strictEqual(formatDuration(60000), '1m');
    assert.strictEqual(formatDuration(300000), '5m');
    assert.strictEqual(formatDuration(3540000), '59m');
  });

  await t.test('formats hours and minutes durations', () => {
    assert.strictEqual(formatDuration(3600000), '1h 0m');
    assert.strictEqual(formatDuration(3660000), '1h 1m');
    assert.strictEqual(formatDuration(7320000), '2h 2m');
    assert.strictEqual(formatDuration(82800000), '23h 0m');
  });

  await t.test('formats days, hours, and minutes durations', () => {
    assert.strictEqual(formatDuration(86400000), '1d 0h 0m');
    assert.strictEqual(formatDuration(90000000), '1d 1h 0m');
    assert.strictEqual(formatDuration(90060000), '1d 1h 1m');
    assert.strictEqual(formatDuration(180000000), '2d 2h 0m');
  });
});

test('formatDuration performance benchmark', async () => {
  const testValues = [null, -100, 0, 500, 60000, 300000, 3600000, 3660000, 86400000, 90000000, 1000000000];
  const iterations = 500000;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    formatDuration(testValues[i % testValues.length]);
  }
  const totalMs = performance.now() - start;
  const nsPerCall = (totalMs * 1e6) / iterations;

  console.log(`\n⚡ Bolt Performance Benchmark (formatDuration direct string template, ${iterations} iterations):`);
  console.log(`  - Total Time: ${totalMs.toFixed(2)} ms`);
  console.log(`  - Time per call: ${nsPerCall.toFixed(2)} ns`);

  assert.ok(totalMs < 200, `Execution time (${totalMs.toFixed(2)} ms) exceeded 200 ms threshold`);
});
