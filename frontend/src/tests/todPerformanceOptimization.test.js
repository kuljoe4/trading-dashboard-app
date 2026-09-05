import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper simulating original multi-pass implementation
function originalTODPerformanceLogic(data = []) {
  const safeData = Array.isArray(data) ? data : [];
  const validData = safeData.filter(d => d && typeof d.pnl === 'number' && !isNaN(d.pnl));
  const maxPnl = Math.max(1, ...validData.map(d => Math.abs(d.pnl)));

  const pos = validData.filter(d => d.pnl > 0).map(d => d.pnl);
  const neg = validData.filter(d => d.pnl < 0).map(d => Math.abs(d.pnl));

  const avgPos = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0;
  const avgNeg = neg.length ? neg.reduce((a, b) => a + b, 0) / neg.length : 0;

  return { validData, maxPnl, avgPos, avgNeg };
}

// Helper simulating optimized single-pass implementation
function optimizedTODPerformanceLogic(data = []) {
  const safeData = Array.isArray(data) ? data : [];
  const valid = [];
  let max = 1;
  let posSum = 0;
  let posCount = 0;
  let negSum = 0;
  let negCount = 0;

  const len = safeData.length;
  for (let i = 0; i < len; i++) {
    const d = safeData[i];
    if (d && typeof d.pnl === 'number' && !isNaN(d.pnl)) {
      valid.push(d);
      const absPnl = Math.abs(d.pnl);
      if (absPnl > max) {
        max = absPnl;
      }
      if (d.pnl > 0) {
        posSum += d.pnl;
        posCount++;
      } else if (d.pnl < 0) {
        negSum += absPnl;
        negCount++;
      }
    }
  }

  return {
    validData: valid,
    maxPnl: max,
    avgPos: posCount > 0 ? posSum / posCount : 0,
    avgNeg: negCount > 0 ? negSum / negCount : 0
  };
}

describe('TODPerformance Single-Pass Aggregation Optimization Tests', () => {
  test('handles empty or non-array inputs identically', () => {
    const testInputs = [undefined, null, [], 'invalid'];

    for (const input of testInputs) {
      const orig = originalTODPerformanceLogic(input);
      const opt = optimizedTODPerformanceLogic(input);

      assert.deepEqual(opt.validData, orig.validData);
      assert.equal(opt.maxPnl, orig.maxPnl);
      assert.equal(opt.avgPos, orig.avgPos);
      assert.equal(opt.avgNeg, orig.avgNeg);
    }
  });

  test('filters out invalid or non-numeric items and calculates accurate averages & max', () => {
    const rawData = [
      { hour: 0, pnl: 15.5 },
      null,
      { hour: 1, pnl: 'not a number' },
      { hour: 2, pnl: -25.0 },
      { hour: 3, pnl: 0 },
      { hour: 4, pnl: 45.0 },
      { hour: 5, pnl: -15.0 },
      undefined,
      { hour: 6, pnl: NaN }
    ];

    const orig = originalTODPerformanceLogic(rawData);
    const opt = optimizedTODPerformanceLogic(rawData);

    assert.equal(opt.validData.length, 5);
    assert.deepEqual(opt.validData, orig.validData);
    assert.equal(opt.maxPnl, 45.0);
    assert.equal(opt.maxPnl, orig.maxPnl);

    // avgPos = (15.5 + 45.0) / 2 = 30.25
    assert.equal(opt.avgPos, 30.25);
    assert.equal(opt.avgPos, orig.avgPos);

    // avgNeg = (25.0 + 15.0) / 2 = 20.0
    assert.equal(opt.avgNeg, 20.0);
    assert.equal(opt.avgNeg, orig.avgNeg);
  });

  test('handles datasets with only positive or only negative numbers', () => {
    const posOnly = [{ hour: 0, pnl: 10 }, { hour: 1, pnl: 20 }];
    const origPos = originalTODPerformanceLogic(posOnly);
    const optPos = optimizedTODPerformanceLogic(posOnly);

    assert.equal(optPos.avgPos, 15);
    assert.equal(optPos.avgNeg, 0);
    assert.equal(optPos.avgPos, origPos.avgPos);
    assert.equal(optPos.avgNeg, origPos.avgNeg);

    const negOnly = [{ hour: 0, pnl: -10 }, { hour: 1, pnl: -30 }];
    const origNeg = originalTODPerformanceLogic(negOnly);
    const optNeg = optimizedTODPerformanceLogic(negOnly);

    assert.equal(optNeg.avgPos, 0);
    assert.equal(optNeg.avgNeg, 20);
    assert.equal(optNeg.avgPos, origNeg.avgPos);
    assert.equal(optNeg.avgNeg, origNeg.avgNeg);
  });

  test('benchmark: single-pass loop vs multi-pass functional chaining', () => {
    // Generate 24 hourly data entries
    const dataset = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      pnl: (i % 2 === 0 ? 1 : -1) * ((i * 13.37) % 50),
      winRate: (i * 7) % 100,
      wins: i % 5,
      total: 5 + (i % 5)
    }));

    const iterations = 100_000;

    // Warmup
    for (let i = 0; i < 1_000; i++) {
      originalTODPerformanceLogic(dataset);
      optimizedTODPerformanceLogic(dataset);
    }

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      originalTODPerformanceLogic(dataset);
    }
    const t1 = performance.now();
    const origTime = t1 - t0;

    const t2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      optimizedTODPerformanceLogic(dataset);
    }
    const t3 = performance.now();
    const optTime = t3 - t2;

    const speedup = origTime / optTime;

    console.log(`\n⚡ Bolt Performance Benchmark (TODPerformance single-pass loop, ${iterations} iterations):`);
    console.log(`  - Original (Multi-pass filter/map/reduce): ${origTime.toFixed(2)} ms`);
    console.log(`  - Optimized (Single-pass loop fusion):     ${optTime.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                      ${speedup.toFixed(2)}x faster`);

    // Verify optimized version executes faster than original multi-pass approach
    assert.ok(optTime < origTime, 'Optimized single-pass loop should execute faster than multi-pass chaining');
  });
});
