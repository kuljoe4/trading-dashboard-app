import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper simulating original unmemoized implementation inside RrOptimizationChart
function originalRrOptimizationChartLogic(data = [], recommendedRr = 0) {
  const safeData = Array.isArray(data) ? data : [];
  if (safeData.length < 5) return null;

  const maxPF = Math.max(1, ...safeData.map(d => d.profitFactor));
  const minPF = 0;
  const rangePF = maxPF - minPF;

  const pointsPF = safeData.map((d, i) => {
    const x = (i / (safeData.length - 1)) * 100;
    const y = 100 - ((d.profitFactor - minPF) / (rangePF || 1)) * 100;
    return { x, y, ...d };
  });

  const defaultStats = safeData.find(d => d.threshold === recommendedRr) || safeData[Math.floor(safeData.length / 2)];

  return { pointsPF, defaultStats, maxPF, rangePF };
}

// Helper simulating optimized single-pass useMemo implementation inside RrOptimizationChart
function optimizedRrOptimizationChartLogic(data = [], recommendedRr = 0) {
  const safeData = Array.isArray(data) ? data : [];
  if (safeData.length < 5) return null;

  const len = safeData.length;
  let maxPF = 1;
  let recStats = null;

  for (let i = 0; i < len; i++) {
    const d = safeData[i];
    if (d.profitFactor > maxPF) maxPF = d.profitFactor;
    if (!recStats && d.threshold === recommendedRr) recStats = d;
  }
  if (!recStats) recStats = safeData[Math.floor(len / 2)];

  const rangePF = maxPF;
  const pts = new Array(len);
  for (let i = 0; i < len; i++) {
    const d = safeData[i];
    const x = (i / (len - 1)) * 100;
    const y = 100 - (d.profitFactor / (rangePF || 1)) * 100;
    pts[i] = { x, y, ...d };
  }

  return { pointsPF: pts, defaultStats: recStats, maxPF, rangePF };
}

describe('RrOptimizationChart Single-Pass useMemo Optimization Tests', () => {
  test('returns null for inputs with fewer than 5 items', () => {
    const shortInputs = [undefined, null, [], [1, 2, 3]];

    for (const input of shortInputs) {
      assert.equal(originalRrOptimizationChartLogic(input, 2.0), null);
      assert.equal(optimizedRrOptimizationChartLogic(input, 2.0), null);
    }
  });

  test('calculates identical pointsPF and defaultStats when recommendedRr matches', () => {
    const data = [
      { threshold: 1.0, profitFactor: 1.2, winRate: 40 },
      { threshold: 1.5, profitFactor: 1.8, winRate: 45 },
      { threshold: 2.0, profitFactor: 2.5, winRate: 50 },
      { threshold: 2.5, profitFactor: 2.1, winRate: 48 },
      { threshold: 3.0, profitFactor: 1.5, winRate: 42 }
    ];

    const orig = originalRrOptimizationChartLogic(data, 2.0);
    const opt = optimizedRrOptimizationChartLogic(data, 2.0);

    assert.equal(opt.maxPF, orig.maxPF);
    assert.equal(opt.rangePF, orig.rangePF);
    assert.deepEqual(opt.defaultStats, orig.defaultStats);
    assert.deepEqual(opt.pointsPF, orig.pointsPF);
  });

  test('falls back to middle element when recommendedRr is not found', () => {
    const data = [
      { threshold: 1.0, profitFactor: 0.8, winRate: 35 },
      { threshold: 1.5, profitFactor: 0.9, winRate: 38 },
      { threshold: 2.0, profitFactor: 1.1, winRate: 42 },
      { threshold: 2.5, profitFactor: 1.4, winRate: 45 },
      { threshold: 3.0, profitFactor: 1.2, winRate: 40 }
    ];

    const orig = originalRrOptimizationChartLogic(data, 99.0);
    const opt = optimizedRrOptimizationChartLogic(data, 99.0);

    assert.deepEqual(opt.defaultStats, orig.defaultStats);
    assert.equal(opt.defaultStats.threshold, 2.0); // Middle element at index 2
    assert.deepEqual(opt.pointsPF, orig.pointsPF);
  });

  test('ensures maxPF starts at minimum 1 even when all profitFactors are < 1', () => {
    const data = [
      { threshold: 1.0, profitFactor: 0.2, winRate: 20 },
      { threshold: 1.5, profitFactor: 0.4, winRate: 25 },
      { threshold: 2.0, profitFactor: 0.5, winRate: 30 },
      { threshold: 2.5, profitFactor: 0.3, winRate: 28 },
      { threshold: 3.0, profitFactor: 0.1, winRate: 15 }
    ];

    const orig = originalRrOptimizationChartLogic(data, 1.5);
    const opt = optimizedRrOptimizationChartLogic(data, 1.5);

    assert.equal(opt.maxPF, 1);
    assert.equal(orig.maxPF, 1);
    assert.deepEqual(opt.pointsPF, orig.pointsPF);
  });

  test('benchmark: single-pass loop vs unmemoized multi-pass map & spread', () => {
    const dataset = Array.from({ length: 50 }, (_, i) => ({
      threshold: 1.0 + i * 0.1,
      profitFactor: 0.5 + Math.sin(i * 0.3) * 2.0,
      winRate: 30 + (i % 40)
    }));

    const iterations = 100_000;

    // Warmup
    for (let i = 0; i < 1_000; i++) {
      originalRrOptimizationChartLogic(dataset, 2.5);
      optimizedRrOptimizationChartLogic(dataset, 2.5);
    }

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      originalRrOptimizationChartLogic(dataset, 2.5);
    }
    const t1 = performance.now();
    const origTime = t1 - t0;

    const t2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      optimizedRrOptimizationChartLogic(dataset, 2.5);
    }
    const t3 = performance.now();
    const optTime = t3 - t2;

    const speedup = origTime / optTime;

    console.log(`\n⚡ Bolt Performance Benchmark (RrOptimizationChart single-pass useMemo fusion, ${iterations} iterations):`);
    console.log(`  - Original (Multi-pass map / Math.max spread / find): ${origTime.toFixed(2)} ms`);
    console.log(`  - Optimized (Single-pass loop fusion & preallocation): ${optTime.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                                   ${speedup.toFixed(2)}x faster`);

    assert.ok(optTime < origTime, 'Optimized single-pass logic should execute faster than original multi-pass map/spread');
  });
});
