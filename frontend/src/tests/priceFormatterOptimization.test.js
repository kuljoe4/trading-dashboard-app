import test from 'node:test';
import assert from 'node:assert/strict';
import { price } from '../lib/formatters.js';

test('price formatter correctness & parity tests', async (t) => {
  await t.test('handles null, undefined, and NaN gracefully', () => {
    assert.equal(price(null), '---');
    assert.equal(price(undefined), '---');
    assert.equal(price(NaN), '---');
    assert.equal(price('invalid'), '---');
  });

  await t.test('handles zero correctly', () => {
    assert.equal(price(0), '$0.00');
    assert.equal(price('0'), '$0.00');
  });

  await t.test('formats prices >= 100 with 2 decimal places and thousands separators', () => {
    assert.equal(price(100), '$100.00');
    assert.equal(price(1234.567), '$1,234.57');
    assert.equal(price(99999.9), '$99,999.90');
  });

  await t.test('formats prices between 1 and 100 with up to 4 decimal places', () => {
    assert.equal(price(1), '$1.00');
    assert.equal(price(12.34), '$12.34');
    assert.equal(price(12.34567), '$12.3457');
    assert.equal(price(99.99), '$99.99');
  });

  await t.test('formats small prices (< 1) dynamically with significant digits', () => {
    assert.equal(price(0.5), '$0.5');
    assert.equal(price(0.00001234), '$0.00001234');
  });
});

test('price formatter performance benchmark', () => {
  const testPrices = [0, 0.00001234, 0.5, 12.3456, 150.25, 9999.99, null, NaN];
  const iterations = 100000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    price(testPrices[i % testPrices.length]);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    price(testPrices[i % testPrices.length]);
  }
  const duration = performance.now() - start;

  console.log(`\n⚡ Bolt Performance Benchmark (price formatter with pre-instantiated Intl.NumberFormat, ${iterations} iterations):`);
  console.log(`  - Total Time: ${duration.toFixed(2)} ms`);
  console.log(`  - Time per call: ${((duration / iterations) * 1000).toFixed(2)} ns`);

  // Ensure execution time for 100k calls is fast (under 200ms)
  assert.ok(duration < 200, `Expected duration < 200ms, got ${duration.toFixed(2)}ms`);
});
