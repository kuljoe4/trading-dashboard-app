import '../store/mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';

function computeOriginalBars(safeData, signals, decisionMarkers, width, chartHeight) {
  const validData = safeData.filter(d =>
     d && Number.isFinite(d.low) && Number.isFinite(d.high) &&
     Number.isFinite(d.open) && Number.isFinite(d.close)
  );
  if (validData.length < 2) return [];

  let dMin = Infinity;
  let dMax = -Infinity;
  for (let i = 0; i < validData.length; i++) {
    if (validData[i].low < dMin) dMin = validData[i].low;
    if (validData[i].high > dMax) dMax = validData[i].high;
  }
  const dRange = (dMax - dMin) || 1;
  const bWidth = (width / safeData.length) * 0.7;
  const bGap = (width / safeData.length) * 0.3;

  const bars = validData.map((d, i) => {
    const x = i * (width / safeData.length) + bGap / 2;
    const yHigh = chartHeight - ((d.high - dMin) / dRange) * chartHeight;
    const yLow = chartHeight - ((d.low - dMin) / dRange) * chartHeight;
    const yOpen = chartHeight - ((d.open - dMin) / dRange) * chartHeight;
    const yClose = chartHeight - ((d.close - dMin) / dRange) * chartHeight;
    const prevPrice = validData[Math.max(0, i - 3)]?.close || d.open;
    const momentum = ((d.close - prevPrice) / prevPrice) * 100;
    return {
      x,
      wickX: x + bWidth / 2,
      yHigh,
      yLow,
      yBodyTop: Math.min(yOpen, yClose),
      bodyHeight: Math.max(Math.abs(yOpen - yClose), 1),
      isUp: d.close >= d.open,
      timestamp: d.time || d.t,
      momentum
    };
  });

  const renderBars = bars.map((bar, i) => {
    const hasSignal = signals.some(s => s.time === bar.timestamp);
    const marker = decisionMarkers.find(m => m.index === i || m.time === bar.timestamp);
    return { ...bar, hasSignal, marker };
  });

  return renderBars;
}

function computeOptimizedBars(safeData, signals, decisionMarkers, width, chartHeight) {
  const validData = [];
  let dMin = Infinity;
  let dMax = -Infinity;

  for (let i = 0; i < safeData.length; i++) {
    const d = safeData[i];
    if (d && Number.isFinite(d.low) && Number.isFinite(d.high) && Number.isFinite(d.open) && Number.isFinite(d.close)) {
      validData.push(d);
      if (d.low < dMin) dMin = d.low;
      if (d.high > dMax) dMax = d.high;
    }
  }

  const validLen = validData.length;
  if (validLen < 2) return [];

  const dRange = (dMax - dMin) || 1;
  const bWidth = (width / safeData.length) * 0.7;
  const bGap = (width / safeData.length) * 0.3;

  const signalSet = new Set();
  if (Array.isArray(signals)) {
    for (let i = 0; i < signals.length; i++) {
      const st = signals[i]?.time;
      if (st) signalSet.add(st);
    }
  }

  const markerIndexMap = new Map();
  const markerTimeMap = new Map();
  if (Array.isArray(decisionMarkers)) {
    for (let i = 0; i < decisionMarkers.length; i++) {
      const m = decisionMarkers[i];
      if (!m) continue;
      if (typeof m.index === 'number') markerIndexMap.set(m.index, m);
      if (m.time) markerTimeMap.set(m.time, m);
    }
  }

  const bars = new Array(validLen);
  for (let i = 0; i < validLen; i++) {
    const d = validData[i];
    const x = i * (width / validLen) + bGap / 2;
    const yHigh = chartHeight - ((d.high - dMin) / dRange) * chartHeight;
    const yLow = chartHeight - ((d.low - dMin) / dRange) * chartHeight;
    const yOpen = chartHeight - ((d.open - dMin) / dRange) * chartHeight;
    const yClose = chartHeight - ((d.close - dMin) / dRange) * chartHeight;

    const prevPrice = validData[Math.max(0, i - 3)]?.close || d.open;
    const momentum = ((d.close - prevPrice) / prevPrice) * 100;

    const timestamp = d.time || d.t;
    const hasSignal = signalSet.has(timestamp);
    const marker = markerIndexMap.get(i) || markerTimeMap.get(timestamp);

    bars[i] = {
      x,
      wickX: x + bWidth / 2,
      yHigh,
      yLow,
      yBodyTop: Math.min(yOpen, yClose),
      bodyHeight: Math.max(Math.abs(yOpen - yClose), 1),
      isUp: d.close >= d.open,
      timestamp,
      momentum,
      hasSignal,
      marker
    };
  }

  return bars;
}

test('CandlestickChart optimization: correctness of bar computation, hasSignal, and decisionMarker', () => {
  const baseTime = 1718000000000;
  const safeData = Array.from({ length: 60 }, (_, i) => ({
    time: baseTime + i * 60000,
    open: 100 + i,
    high: 105 + i,
    low: 95 + i,
    close: 102 + i,
  }));

  const signals = [
    { time: baseTime + 10 * 60000, type: 'EMA_CROSS' },
    { time: baseTime + 25 * 60000, type: 'BREAKOUT' },
  ];

  const decisionMarkers = [
    { index: 5, label: 'ENTRY', color: '#00e5a0' },
    { time: baseTime + 30 * 60000, label: 'EXIT', color: '#ff4466' },
  ];

  const width = 400;
  const chartHeight = 200;

  const originalBars = computeOriginalBars(safeData, signals, decisionMarkers, width, chartHeight);
  const optimizedBars = computeOptimizedBars(safeData, signals, decisionMarkers, width, chartHeight);

  assert.strictEqual(optimizedBars.length, originalBars.length);
  assert.deepStrictEqual(optimizedBars, originalBars);
});

test('CandlestickChart optimization: performance benchmark', () => {
  const baseTime = 1718000000000;
  const candleCount = 100;
  const safeData = Array.from({ length: candleCount }, (_, i) => ({
    time: baseTime + i * 60000,
    open: 100 + Math.sin(i) * 10,
    high: 110 + Math.sin(i) * 10,
    low: 90 + Math.sin(i) * 10,
    close: 105 + Math.sin(i) * 10,
  }));

  const signals = Array.from({ length: 15 }, (_, i) => ({
    time: baseTime + (i * 6) * 60000,
    type: `SIGNAL_${i}`
  }));

  const decisionMarkers = Array.from({ length: 10 }, (_, i) => ({
    time: baseTime + (i * 9) * 60000,
    label: `MARKER_${i}`
  }));

  const width = 800;
  const chartHeight = 300;

  // Warmup
  computeOriginalBars(safeData, signals, decisionMarkers, width, chartHeight);
  computeOptimizedBars(safeData, signals, decisionMarkers, width, chartHeight);

  const iterations = 5000;

  const startOrig = performance.now();
  for (let i = 0; i < iterations; i++) {
    computeOriginalBars(safeData, signals, decisionMarkers, width, chartHeight);
  }
  const endOrig = performance.now();
  const origDuration = endOrig - startOrig;

  const startOpt = performance.now();
  for (let i = 0; i < iterations; i++) {
    computeOptimizedBars(safeData, signals, decisionMarkers, width, chartHeight);
  }
  const endOpt = performance.now();
  const optDuration = endOpt - startOpt;

  const speedup = origDuration / optDuration;

  console.log(`\n⚡ Bolt Performance Benchmark (CandlestickChart Bar Rendering, ${candleCount} candles, ${signals.length} signals, ${decisionMarkers.length} markers, ${iterations} iterations):`);
  console.log(`  - Original Multi-pass & Render-loop Scans: ${origDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Single-pass & Map/Set Lookup:  ${optDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                       ${speedup.toFixed(1)}x faster\n`);

  assert.ok(optDuration < origDuration);
});
