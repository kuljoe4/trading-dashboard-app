import { test } from 'node:test';
import assert from 'node:assert';
import { calculateSupertrend } from '../lib/formatters.js';

test('calculateSupertrend frontend optimization tests', async (t) => {
  const candles = Array.from({ length: 50 }, (_, i) => ({
    time: 1718000000000 + i * 60000,
    open: 100 + Math.sin(i) * 5,
    high: 102 + Math.sin(i) * 5,
    low: 98 + Math.sin(i) * 5,
    close: 101 + Math.sin(i) * 5,
    volume: 1000,
  }));

  await t.test('returns correct structure', () => {
    const res = calculateSupertrend(candles, 10, 3.0);
    assert.ok(Array.isArray(res.supertrend));
    assert.ok(Array.isArray(res.direction));
    assert.strictEqual(res.insufficientData, false);
    assert.strictEqual(res.supertrend.length, candles.length);
  });

  await t.test('caches results and returns identical reference on subsequent calls with same array reference', () => {
    const res1 = calculateSupertrend(candles, 10, 3.0);
    const res2 = calculateSupertrend(candles, 10, 3.0);

    // Should return same object reference (O(1) WeakMap cache hit)
    assert.strictEqual(res1, res2);
  });

  await t.test('bypasses cache when parameter changes on same array reference', () => {
    const res1 = calculateSupertrend(candles, 10, 3.0);
    const res2 = calculateSupertrend(candles, 10, 4.0); // Different multiplier

    assert.notStrictEqual(res1, res2);
  });

  await t.test('bypasses cache when a different array reference is provided', () => {
    const otherCandles = Array.from({ length: 50 }, (_, i) => ({
      time: 1718000000000 + i * 60000,
      open: 100 + Math.sin(i) * 5,
      high: 102 + Math.sin(i) * 5,
      low: 98 + Math.sin(i) * 5,
      close: 101 + Math.sin(i) * 5,
      volume: 1000,
    }));

    const res1 = calculateSupertrend(candles, 10, 3.0);
    const res2 = calculateSupertrend(otherCandles, 10, 3.0);

    assert.notStrictEqual(res1, res2);
  });

  await t.test('benchmark: verify caching performance speedup', () => {
    // Warm up the cache
    calculateSupertrend(candles, 10, 3.0);

    const iterations = 10000;

    // 1. Measure cache hit path (same array reference)
    const cacheStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateSupertrend(candles, 10, 3.0);
    }
    const cacheEnd = performance.now();
    const cacheDuration = cacheEnd - cacheStart;

    // 2. Measure uncached / raw loop path by bypassing cache (new array reference on each call)
    const rawStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const uniqueCandles = [
        { time: i, open: 10, high: 12, low: 8, close: 11, volume: 100 },
        ...candles
      ];
      calculateSupertrend(uniqueCandles, 10, 3.0);
    }
    const rawEnd = performance.now();
    const rawDuration = rawEnd - rawStart;

    const speedup = rawDuration / cacheDuration;

    console.log(`\n⚡ Bolt Performance Benchmark (calculateSupertrend caching with WeakMap, ${iterations} iterations):`);
    console.log(`  - Raw Calculation (No Cache):   ${rawDuration.toFixed(4)} ms`);
    console.log(`  - Optimized Retrieval (Cached): ${cacheDuration.toFixed(4)} ms`);
    console.log(`  - Execution Speedup:           ${speedup.toFixed(1)}x faster\n`);

    assert.ok(cacheDuration < rawDuration);
  });
});
