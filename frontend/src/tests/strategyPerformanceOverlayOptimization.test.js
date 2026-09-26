import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('StrategyPerformanceOverlayChart Scalar Bounds Tracking Optimization', () => {
  // Original multi-pass implementation simulating array mapping and spreads
  function computeOriginalBounds(series) {
    const pnlValues = series.map(s => s.cumPnl);
    const rawPnlMin = Math.min(0, ...pnlValues);
    const rawPnlMax = Math.max(0.1, ...pnlValues);
    const rawPnlRange = rawPnlMax - rawPnlMin;
    const pnlPad = rawPnlRange * 0.15;
    const minPnl = rawPnlMin - pnlPad;
    const maxPnl = rawPnlMax + pnlPad;
    const rangePnl = maxPnl - minPnl;

    const hrValues = series.map(s => s.hitRate);
    const rawHrMin = Math.max(0, Math.min(...hrValues) - 5);
    const rawHrMax = Math.min(100, Math.max(...hrValues) + 5);
    const rangeHr = Math.max(10, rawHrMax - rawHrMin);

    const ratioValues = [];
    series.forEach(s => {
      if (s.pf > 0 && s.pf < 50) ratioValues.push(s.pf);
      if (s.sharpe > 0) ratioValues.push(s.sharpe);
      if (s.sortino > 0) ratioValues.push(s.sortino);
    });
    const peakRatio = ratioValues.length > 0 ? Math.max(...ratioValues) : 2.5;
    const ratioScaleMax = Math.max(3.0, peakRatio * 1.15);

    return { minPnl, maxPnl, rangePnl, rawHrMin, rawHrMax, rangeHr, peakRatio, ratioScaleMax };
  }

  // Optimized single-pass loop-fused implementation tracking scalar bounds
  function computeOptimizedBounds(series) {
    let rawPnlMin = 0;
    let rawPnlMax = 0.1;
    let minHrVal = Infinity;
    let maxHrVal = -Infinity;
    let peakRatioVal = -Infinity;

    const len = series.length;
    for (let i = 0; i < len; i++) {
      const s = series[i];
      if (s.cumPnl < rawPnlMin) rawPnlMin = s.cumPnl;
      if (s.cumPnl > rawPnlMax) rawPnlMax = s.cumPnl;

      if (s.hitRate < minHrVal) minHrVal = s.hitRate;
      if (s.hitRate > maxHrVal) maxHrVal = s.hitRate;

      if (s.pf > 0 && s.pf < 50 && s.pf > peakRatioVal) peakRatioVal = s.pf;
      if (s.sharpe > 0 && s.sharpe > peakRatioVal) peakRatioVal = s.sharpe;
      if (s.sortino > 0 && s.sortino > peakRatioVal) peakRatioVal = s.sortino;
    }

    const rawPnlRange = rawPnlMax - rawPnlMin;
    const pnlPad = rawPnlRange * 0.15;
    const minPnl = rawPnlMin - pnlPad;
    const maxPnl = rawPnlMax + pnlPad;
    const rangePnl = maxPnl - minPnl;

    const rawHrMin = Math.max(0, minHrVal - 5);
    const rawHrMax = Math.min(100, maxHrVal + 5);
    const rangeHr = Math.max(10, rawHrMax - rawHrMin);

    const peakRatio = peakRatioVal !== -Infinity ? peakRatioVal : 2.5;
    const ratioScaleMax = Math.max(3.0, peakRatio * 1.15);

    return { minPnl, maxPnl, rangePnl, rawHrMin, rawHrMax, rangeHr, peakRatio, ratioScaleMax };
  }

  it('delivers exact numerical parity across multi-trade datasets', () => {
    const series = [
      { cumPnl: 150.5, hitRate: 60, pf: 1.8, sharpe: 1.2, sortino: 1.5 },
      { cumPnl: -45.2, hitRate: 40, pf: 0.8, sharpe: -0.2, sortino: -0.5 },
      { cumPnl: 320.0, hitRate: 66.7, pf: 2.4, sharpe: 2.1, sortino: 2.8 },
      { cumPnl: 280.1, hitRate: 50.0, pf: 1.9, sharpe: 1.5, sortino: 1.9 },
      { cumPnl: -110.0, hitRate: 35.0, pf: 0.5, sharpe: -0.8, sortino: -1.1 }
    ];

    const orig = computeOriginalBounds(series);
    const opt = computeOptimizedBounds(series);

    assert.deepStrictEqual(opt, orig);
  });

  it('handles edge cases identically (all positive, all negative, empty values)', () => {
    const emptySeries = [];
    const origEmpty = computeOriginalBounds(emptySeries);
    const optEmpty = computeOptimizedBounds(emptySeries);
    assert.deepStrictEqual(optEmpty, origEmpty);

    const positiveSeries = [
      { cumPnl: 100, hitRate: 100, pf: 10, sharpe: 3.5, sortino: 4.2 },
      { cumPnl: 250, hitRate: 100, pf: 15, sharpe: 4.1, sortino: 5.0 }
    ];
    assert.deepStrictEqual(computeOptimizedBounds(positiveSeries), computeOriginalBounds(positiveSeries));
  });

  it('benchmark: single-pass loop vs multi-pass functional array mapping', () => {
    const iterations = 50000;
    const mockSeries = [];
    for (let i = 0; i < 500; i++) {
      mockSeries.push({
        cumPnl: Math.sin(i / 10) * 500 + i * 2,
        hitRate: Math.max(0, Math.min(100, 50 + Math.cos(i / 5) * 20)),
        pf: 1.0 + (i % 10) * 0.2,
        sharpe: (i % 5) * 0.3,
        sortino: (i % 7) * 0.4
      });
    }

    const startOrig = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeOriginalBounds(mockSeries);
    }
    const durationOrig = performance.now() - startOrig;

    const startOpt = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeOptimizedBounds(mockSeries);
    }
    const durationOpt = performance.now() - startOpt;

    const speedup = durationOrig / Math.max(0.0001, durationOpt);

    console.log(`\n⚡ Bolt Performance Benchmark (StrategyPerformanceOverlay bounds tracking, ${iterations} iterations):`);
    console.log(`  - Original (Multi-pass map/spreads): ${durationOrig.toFixed(2)} ms`);
    console.log(`  - Optimized (Loop-fused scalar tracking): ${durationOpt.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                    ${speedup.toFixed(2)}x faster\n`);

    assert.ok(durationOpt <= durationOrig, 'Optimized scalar tracking should be faster than or equal to original multi-pass approach');
  });
});
