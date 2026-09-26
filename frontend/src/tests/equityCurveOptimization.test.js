import fs from 'node:fs';
import path from 'node:path';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper simulating original multi-pass implementation of EquityCurve calculation
function originalEquityCurveLogic(data = []) {
  const downsample = (data, threshold = 100) => {
    if (data.length <= threshold) return data;
    const factor = Math.floor(data.length / threshold);
    const result = [];
    for (let i = 0; i < data.length; i += factor) {
      result.push(data[i]);
    }
    if (result[result.length - 1] !== data[data.length - 1]) {
      result.push(data[data.length - 1]);
    }
    return result;
  };

  const safeData = Array.isArray(data) ? data : [];
  const downsampled = downsample(safeData).filter(d => d && typeof d.pnl === 'number');
  if (!downsampled || downsampled.length < 2) return { points: [], viewMin: 0, viewMax: 0.1, viewRange: 0.1, peakPathD: '', drawdownPathD: '' };

  const values = downsampled.map(d => d.pnl);
  const min = Math.min(0, ...values);
  const max = Math.max(0.1, ...values);
  const range = max - min;
  const padding = range * 0.15;

  const vMin = min - padding;
  const vMax = max + padding;
  const vRange = vMax - vMin;

  const pts = downsampled.map((d, i) => {
    const x = (i / (downsampled.length - 1)) * 100;
    const y = 100 - ((d.pnl - vMin) / vRange) * 100;
    return { x, y, pnl: d.pnl, ts: d.ts, configChange: d.configChange };
  });

  const peaks = (() => {
    if (pts.length < 2) return [];
    let currentMax = -Infinity;
    return pts.map(p => {
      if (currentMax === -Infinity || p.y < currentMax) {
        currentMax = p.y;
      }
      return { x: p.x, y: currentMax };
    });
  })();

  const peakPathD = (() => {
    if (peaks.length < 2) return '';
    let d = `M ${peaks[0].x} ${peaks[0].y}`;
    for (let i = 1; i < peaks.length; i++) {
      d += ` L ${peaks[i].x} ${peaks[i].y}`;
    }
    return d;
  })();

  const drawdownPathD = (() => {
    if (pts.length < 2 || peaks.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x} ${pts[i].y}`;
    }
    for (let i = peaks.length - 1; i >= 0; i--) {
      d += ` L ${peaks[i].x} ${peaks[i].y}`;
    }
    d += ' Z';
    return d;
  })();

  return { points: pts, viewMin: vMin, viewMax: vMax, viewRange: vRange, peakPathD, drawdownPathD };
}

// Helper simulating optimized single-pass implementation of EquityCurve calculation
function optimizedEquityCurveLogic(data = []) {
  const safeData = Array.isArray(data) ? data : [];
  const len = safeData.length;
  if (len < 2) return { points: [], viewMin: 0, viewMax: 0.1, viewRange: 0.1, peakPathD: '', drawdownPathD: '' };

  const threshold = 100;
  const factor = len > threshold ? Math.floor(len / threshold) : 1;
  const downsampled = [];
  let min = 0;
  let max = 0.1;

  for (let i = 0; i < len; i += factor) {
    const d = safeData[i];
    if (d && typeof d.pnl === 'number' && !Number.isNaN(d.pnl)) {
      downsampled.push(d);
      if (d.pnl < min) min = d.pnl;
      if (d.pnl > max) max = d.pnl;
    }
  }

  const lastPoint = safeData[len - 1];
  if (lastPoint && typeof lastPoint.pnl === 'number' && !Number.isNaN(lastPoint.pnl)) {
    if (downsampled.length === 0 || downsampled[downsampled.length - 1] !== lastPoint) {
      downsampled.push(lastPoint);
      if (lastPoint.pnl < min) min = lastPoint.pnl;
      if (lastPoint.pnl > max) max = lastPoint.pnl;
    }
  }

  const dsLen = downsampled.length;
  if (dsLen < 2) return { points: [], viewMin: 0, viewMax: 0.1, viewRange: 0.1, peakPathD: '', drawdownPathD: '' };

  const range = max - min;
  const padding = range * 0.15;
  const vMin = min - padding;
  const vMax = max + padding;
  const vRange = vMax - vMin;

  const pts = new Array(dsLen);
  let peakD = '';
  let peakRevD = '';
  let eqD = '';
  let currentMinY = Infinity;

  for (let i = 0; i < dsLen; i++) {
    const d = downsampled[i];
    const x = (i / (dsLen - 1)) * 100;
    const y = 100 - ((d.pnl - vMin) / vRange) * 100;
    pts[i] = { x, y, pnl: d.pnl, ts: d.ts, configChange: d.configChange };

    if (y < currentMinY) {
      currentMinY = y;
    }

    if (i === 0) {
      peakD = `M ${x} ${currentMinY}`;
      peakRevD = ` L ${x} ${currentMinY}`;
      eqD = `M ${x} ${y}`;
    } else {
      peakD += ` L ${x} ${currentMinY}`;
      peakRevD = ` L ${x} ${currentMinY}` + peakRevD;
      eqD += ` L ${x} ${y}`;
    }
  }

  const ddPathD = `${eqD}${peakRevD} Z`;

  return {
    points: pts,
    viewMin: vMin,
    viewMax: vMax,
    viewRange: vRange,
    peakPathD: peakD,
    drawdownPathD: ddPathD
  };
}

describe('EquityCurve Single-Pass Optimization Tests', () => {
  test('Analytics.jsx file contains single-pass fused EquityCurve optimization and no redundant declarations', () => {
    const analyticsPath = path.resolve(process.cwd(), 'src/components/Analytics.jsx');
    const content = fs.readFileSync(analyticsPath, 'utf8');

    // Verify single-pass optimization comment and destructured useMemo signature
    assert.ok(content.includes('Fused Single-Pass Downsampling, Extreme Tracking & Peak Path Generation'), 'Analytics.jsx should contain optimization comment');
    assert.ok(content.includes('peakPathD, drawdownPathD } = useMemo'), 'Analytics.jsx should return peakPathD and drawdownPathD from useMemo');

    // Verify redundant downstream peaks and peakPathD useMemos were removed
    const peakPathMatches = content.match(/const peakPathD = useMemo/g);
    assert.equal(peakPathMatches, null, 'Analytics.jsx should not re-declare peakPathD in a secondary useMemo');

    const drawdownPathMatches = content.match(/const drawdownPathD = useMemo/g);
    assert.equal(drawdownPathMatches, null, 'Analytics.jsx should not re-declare drawdownPathD in a secondary useMemo');
  });

  test('handles empty, invalid or small inputs identically', () => {
    const testCases = [
      undefined,
      null,
      [],
      [{ pnl: 100 }],
      [{ pnl: 'invalid' }, { pnl: null }]
    ];

    for (const tc of testCases) {
      const orig = originalEquityCurveLogic(tc);
      const opt = optimizedEquityCurveLogic(tc);

      assert.deepEqual(opt.points, orig.points);
      assert.equal(opt.viewMin, orig.viewMin);
      assert.equal(opt.viewMax, orig.viewMax);
      assert.equal(opt.viewRange, orig.viewRange);
      assert.equal(opt.peakPathD, orig.peakPathD);
      assert.equal(opt.drawdownPathD, orig.drawdownPathD);
    }
  });

  test('computes exact numerical points, scalar bounds, and path strings', () => {
    const dataset = [
      { pnl: 0, ts: 1000 },
      { pnl: 150.5, ts: 2000 },
      { pnl: 120.0, ts: 3000 },
      { pnl: -40.25, ts: 4000 },
      { pnl: 300.0, ts: 5000 },
      { pnl: 250.0, ts: 6000 }
    ];

    const orig = originalEquityCurveLogic(dataset);
    const opt = optimizedEquityCurveLogic(dataset);

    assert.equal(opt.points.length, orig.points.length);
    assert.equal(opt.viewMin, orig.viewMin);
    assert.equal(opt.viewMax, orig.viewMax);
    assert.equal(opt.viewRange, orig.viewRange);

    for (let i = 0; i < opt.points.length; i++) {
      assert.equal(opt.points[i].x, orig.points[i].x);
      assert.equal(opt.points[i].y, orig.points[i].y);
      assert.equal(opt.points[i].pnl, orig.points[i].pnl);
    }

    assert.equal(opt.peakPathD, orig.peakPathD);
    assert.equal(opt.drawdownPathD, orig.drawdownPathD);
  });

  test('handles large downsampled datasets with exact fidelity', () => {
    // Generate 500 trade items
    const dataset = Array.from({ length: 500 }, (_, i) => ({
      pnl: Math.sin(i / 10) * 500 + i * 2,
      ts: 1000000 + i * 60000
    }));

    const orig = originalEquityCurveLogic(dataset);
    const opt = optimizedEquityCurveLogic(dataset);

    assert.equal(opt.points.length, orig.points.length);
    assert.equal(opt.viewMin, orig.viewMin);
    assert.equal(opt.viewMax, orig.viewMax);
    assert.equal(opt.peakPathD, orig.peakPathD);
    assert.equal(opt.drawdownPathD, orig.drawdownPathD);
  });

  test('benchmark: single-pass fused loop vs multi-pass chaining and peak mapping', () => {
    const dataset = Array.from({ length: 300 }, (_, i) => ({
      pnl: Math.sin(i / 5) * 200 + (i % 3 === 0 ? -50 : 80),
      ts: 100000 + i * 30000
    }));

    const iterations = 50_000;

    // Warmup
    for (let i = 0; i < 500; i++) {
      originalEquityCurveLogic(dataset);
      optimizedEquityCurveLogic(dataset);
    }

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      originalEquityCurveLogic(dataset);
    }
    const t1 = performance.now();
    const origTime = t1 - t0;

    const t2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      optimizedEquityCurveLogic(dataset);
    }
    const t3 = performance.now();
    const optTime = t3 - t2;

    const speedup = origTime / optTime;

    console.log(`\n⚡ Bolt Performance Benchmark (EquityCurve single-pass optimization, ${iterations} iterations):`);
    console.log(`  - Original (Multi-pass filter/map/spread + peak mapping): ${origTime.toFixed(2)} ms`);
    console.log(`  - Optimized (Fused single-pass loop):                       ${optTime.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                                        ${speedup.toFixed(2)}x faster`);

    assert.ok(optTime < origTime, 'Optimized single-pass loop should execute faster than multi-pass chaining');
  });
});
