import { test } from 'node:test';
import assert from 'node:assert';

// Simulated equity curve single-pass calculation helper (matching ConfigModal.jsx)
function computeEquityCurveBoundsOptimized(equityCurve) {
  let minBal = Infinity;
  let maxBal = -Infinity;
  for (let i = 0; i < equityCurve.length; i++) {
    const eq = equityCurve[i].equity;
    if (eq < minBal) minBal = eq;
    if (eq > maxBal) maxBal = eq;
  }
  if (!isFinite(minBal)) minBal = 0;
  if (!isFinite(maxBal)) maxBal = 1;
  const range = Math.max(1, maxBal - minBal);

  const heights = new Array(equityCurve.length);
  for (let i = 0; i < equityCurve.length; i++) {
    heights[i] = Math.max(8, ((equityCurve[i].equity - minBal) / range) * 100);
  }

  return { minBal, maxBal, range, heights };
}

// Unoptimized baseline implementation (original ConfigModal.jsx pattern inside .map)
function computeEquityCurveBoundsBaseline(equityCurve) {
  const heights = equityCurve.map((pt) => {
    const minBal = Math.min(...equityCurve.map(p => p.equity));
    const maxBal = Math.max(...equityCurve.map(p => p.equity));
    const range = Math.max(1, maxBal - minBal);
    return Math.max(8, ((pt.equity - minBal) / range) * 100);
  });

  const minBal = Math.min(...equityCurve.map(p => p.equity));
  const maxBal = Math.max(...equityCurve.map(p => p.equity));
  const range = Math.max(1, maxBal - minBal);

  return { minBal, maxBal, range, heights };
}

test('Simulated Equity Curve Single-Pass Optimization Tests', async (t) => {
  await t.test('calculates mathematically equivalent min, max, range, and heights', () => {
    const sampleData = Array.from({ length: 150 }, (_, i) => ({
      equity: 10000 + Math.sin(i / 10) * 1500 + i * 20,
      drawdownPct: (i % 5).toFixed(1)
    }));

    const baseline = computeEquityCurveBoundsBaseline(sampleData);
    const optimized = computeEquityCurveBoundsOptimized(sampleData);

    assert.strictEqual(optimized.minBal, baseline.minBal, 'minBal should match baseline');
    assert.strictEqual(optimized.maxBal, baseline.maxBal, 'maxBal should match baseline');
    assert.strictEqual(optimized.range, baseline.range, 'range should match baseline');
    assert.deepStrictEqual(optimized.heights, baseline.heights, 'calculated bar heights should be identical');
  });

  await t.test('handles edge cases gracefully (single point or flat balance)', () => {
    const flatData = [
      { equity: 10000, drawdownPct: 0 },
      { equity: 10000, drawdownPct: 0 }
    ];

    const res = computeEquityCurveBoundsOptimized(flatData);
    assert.strictEqual(res.minBal, 10000);
    assert.strictEqual(res.maxBal, 10000);
    assert.strictEqual(res.range, 1, 'range should default to 1 when min equals max');
    assert.deepStrictEqual(res.heights, [8, 8], 'heights should clamp to minimum 8%');
  });

  await t.test('benchmark: verify single-pass loop execution speedup', () => {
    const testData = Array.from({ length: 200 }, (_, i) => ({
      equity: 10000 + Math.cos(i / 5) * 800 + i * 15,
      drawdownPct: 2.5
    }));

    const ITERATIONS = 1000;

    // Benchmark original baseline
    const startBaseline = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      computeEquityCurveBoundsBaseline(testData);
    }
    const endBaseline = performance.now();
    const baselineTime = endBaseline - startBaseline;

    // Benchmark optimized
    const startOptimized = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      computeEquityCurveBoundsOptimized(testData);
    }
    const endOptimized = performance.now();
    const optimizedTime = endOptimized - startOptimized;

    const speedup = (baselineTime / Math.max(0.001, optimizedTime)).toFixed(2);

    console.log(`\n⚡ Bolt Performance Benchmark (Simulated Equity Curve Bounds, ${ITERATIONS} renders x 200 points):`);
    console.log(`  - Original O(N²) mapped spread: ${baselineTime.toFixed(2)} ms`);
    console.log(`  - Single-Pass O(N) loop:       ${optimizedTime.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:          ${speedup}x faster\n`);

    assert.ok(optimizedTime < baselineTime, 'Optimized single-pass execution should be faster than O(N²) baseline');
  });
});
