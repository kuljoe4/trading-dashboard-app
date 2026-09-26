import { test } from 'node:test';
import assert from 'node:assert';

/**
 * ⚡ Bolt Performance Benchmark & Parity Verification for Simulated Equity Curve Bounds Calculation.
 *
 * Problem: In ConfigModal.jsx, rendering each point in `result.equityCurve` invoked:
 *   const minBal = Math.min(...result.equityCurve.map(p => p.equity));
 *   const maxBal = Math.max(...result.equityCurve.map(p => p.equity));
 * inside every single `.map()` callback iteration step.
 * For N points, this caused N array `.map()` allocations and N array spread `...` operations, leading to O(N^2) complexity.
 *
 * Solution: Single-pass pre-computation of scalar `minBal`, `maxBal`, and `range` prior to mapping over `result.equityCurve`.
 * Complexity is reduced from O(N^2) to O(N), eliminating transient array heap allocations.
 */

// Original O(N^2) implementation for comparison
function calculateEquityHeightsOriginal(equityCurve, startingBalance) {
  if (!equityCurve || equityCurve.length === 0) return [];
  return equityCurve.map((pt) => {
    const minBal = Math.min(...equityCurve.map(p => p.equity));
    const maxBal = Math.max(...equityCurve.map(p => p.equity));
    const range = Math.max(1, maxBal - minBal);
    const heightPct = Math.max(8, ((pt.equity - minBal) / range) * 100);
    const isUp = pt.equity >= startingBalance;
    return { heightPct, isUp, equity: pt.equity, drawdownPct: pt.drawdownPct };
  });
}

// Optimized O(N) single-pass pre-computed implementation
function calculateEquityHeightsOptimized(equityCurve, startingBalance) {
  if (!equityCurve || equityCurve.length === 0) return [];

  let minBal = Infinity;
  let maxBal = -Infinity;
  const len = equityCurve.length;

  for (let i = 0; i < len; i++) {
    const eq = equityCurve[i].equity;
    if (eq < minBal) minBal = eq;
    if (eq > maxBal) maxBal = eq;
  }

  if (minBal === Infinity) minBal = 0;
  if (maxBal === -Infinity) maxBal = 0;
  const range = Math.max(1, maxBal - minBal);

  return equityCurve.map((pt) => {
    const heightPct = Math.max(8, ((pt.equity - minBal) / range) * 100);
    const isUp = pt.equity >= startingBalance;
    return { heightPct, isUp, equity: pt.equity, drawdownPct: pt.drawdownPct };
  });
}

test('Simulated Equity Curve Single-Pass Optimization Tests', async (t) => {
  await t.test('handles empty or null equity curve gracefully', () => {
    assert.deepStrictEqual(calculateEquityHeightsOptimized([], 10000), []);
    assert.deepStrictEqual(calculateEquityHeightsOptimized(null, 10000), []);
  });

  await t.test('delivers exact numerical parity with original array spread calculation', () => {
    const startingBalance = 10000;
    const testCurve = [
      { equity: 10000, drawdownPct: 0 },
      { equity: 10200, drawdownPct: 0 },
      { equity: 9800, drawdownPct: 3.9 },
      { equity: 10500, drawdownPct: 0 },
      { equity: 10400, drawdownPct: 0.95 },
      { equity: 11000, drawdownPct: 0 },
      { equity: 9500, drawdownPct: 13.6 },
      { equity: 12000, drawdownPct: 0 },
    ];

    const originalHeights = calculateEquityHeightsOriginal(testCurve, startingBalance);
    const optimizedHeights = calculateEquityHeightsOptimized(testCurve, startingBalance);

    assert.strictEqual(originalHeights.length, optimizedHeights.length);

    for (let i = 0; i < originalHeights.length; i++) {
      assert.strictEqual(optimizedHeights[i].isUp, originalHeights[i].isUp);
      assert.strictEqual(
        Math.abs(optimizedHeights[i].heightPct - originalHeights[i].heightPct) < 1e-10,
        true,
        `Point ${i} heightPct mismatch: expected ${originalHeights[i].heightPct}, got ${optimizedHeights[i].heightPct}`
      );
    }
  });

  await t.test('handles edge cases (single point, all identical balances, negative equity)', () => {
    const startingBalance = 10000;

    // Single point
    const singlePoint = [{ equity: 10000, drawdownPct: 0 }];
    const resSingle = calculateEquityHeightsOptimized(singlePoint, startingBalance);
    assert.strictEqual(resSingle.length, 1);
    assert.strictEqual(resSingle[0].heightPct, 8); // (0 / 1) * 100 = 0 -> clamped to Math.max(8, 0) = 8

    // All identical balances
    const identical = [
      { equity: 10500, drawdownPct: 0 },
      { equity: 10500, drawdownPct: 0 },
      { equity: 10500, drawdownPct: 0 }
    ];
    const resIdentical = calculateEquityHeightsOptimized(identical, startingBalance);
    assert.strictEqual(resIdentical.length, 3);
    resIdentical.forEach(p => assert.strictEqual(p.heightPct, 8));

    // Negative balances / drawdown
    const negativeCurve = [
      { equity: -100, drawdownPct: 100 },
      { equity: -50, drawdownPct: 50 },
      { equity: 0, drawdownPct: 0 }
    ];
    const resNegative = calculateEquityHeightsOptimized(negativeCurve, 0);
    assert.strictEqual(resNegative[0].heightPct, 8);
    assert.strictEqual(resNegative[2].heightPct, 100);
  });

  await t.test('benchmark: verify single-pass O(N) speedup over O(N^2) array spread method', () => {
    // Generate a 100-point simulated backtest equity curve
    const testCurve = [];
    let currentBal = 10000;
    for (let i = 0; i < 100; i++) {
      const delta = (Math.sin(i) * 200) + (i % 2 === 0 ? 50 : -30);
      currentBal += delta;
      testCurve.push({ equity: currentBal, drawdownPct: Math.max(0, (12000 - currentBal) / 120) });
    }

    const iterations = 5000;

    // Benchmark Original O(N^2)
    const startOrig = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateEquityHeightsOriginal(testCurve, 10000);
    }
    const origDuration = performance.now() - startOrig;

    // Benchmark Optimized O(N)
    const startOpt = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateEquityHeightsOptimized(testCurve, 10000);
    }
    const optDuration = performance.now() - startOpt;

    const speedup = origDuration / Math.max(0.0001, optDuration);

    console.log(`\n⚡ Bolt Performance Benchmark (Simulated Equity Curve Bounds, 100 points, ${iterations} iterations):`);
    console.log(`  - Original (O(N^2) array spread per iteration): ${origDuration.toFixed(2)} ms`);
    console.log(`  - Optimized (O(N) single-pass pre-computation):  ${optDuration.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                            ${speedup.toFixed(1)}x faster\n`);

    assert.ok(speedup >= 2.0, `Optimized implementation (${optDuration.toFixed(2)}ms) should be significantly faster than original (${origDuration.toFixed(2)}ms)`);
  });
});
