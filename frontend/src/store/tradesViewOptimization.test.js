import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';

// Mock safeNum to match the application's helper logic
const safeNum = (v) => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

// Original separate loops / render-time calculations
function originalTradesViewCalculation(activeTrades, totalPnl) {
  const peakRr = (activeTrades || []).reduce((max, trade) => Math.max(max, trade.max_rr || 0), 0);
  const activePnl = (activeTrades || []).reduce((acc, t) => acc + safeNum(t.pnl), 0);
  const activeEstPnl = (activeTrades || []).reduce((acc, t) => acc + safeNum(t.est_pnl_to_realize), 0);
  const trueProjectedPnl = (totalPnl - activePnl) + activeEstPnl;

  return { activePnl, activeEstPnl, trueProjectedPnl, peakRr };
}

// Optimized single-pass loop-fused implementation
function optimizedTradesViewCalculation(activeTrades, totalPnl) {
  const trades = activeTrades || [];
  let pnl = 0;
  let estPnl = 0;
  let maxRr = 0;
  const len = trades.length;
  for (let i = 0; i < len; i++) {
    const t = trades[i];
    pnl += safeNum(t.pnl);
    estPnl += safeNum(t.est_pnl_to_realize);
    maxRr = Math.max(maxRr, t.max_rr || 0);
  }
  const projected = (totalPnl - pnl) + estPnl;
  return {
    activePnl: pnl,
    activeEstPnl: estPnl,
    trueProjectedPnl: projected,
    peakRr: maxRr
  };
}

test('TradesView metrics: correctness of loop-fused implementation', () => {
  const activeTrades = [
    { symbol: 'BTCUSDT', pnl: 25.50, est_pnl_to_realize: 30.00, max_rr: 1.5 },
    { symbol: 'ETHUSDT', pnl: -10.20, est_pnl_to_realize: -5.00, max_rr: 0.8 },
    { symbol: 'SOLUSDT', pnl: 45.00, est_pnl_to_realize: 50.00, max_rr: 3.2 },
    { symbol: 'ADAUSDT', pnl: 5.00, est_pnl_to_realize: 5.00, max_rr: 2.1 }
  ];
  const totalPnl = 150.00;

  const originalResult = originalTradesViewCalculation(activeTrades, totalPnl);
  const optimizedResult = optimizedTradesViewCalculation(activeTrades, totalPnl);

  assert.deepStrictEqual(optimizedResult, originalResult, 'Both implementations must return identical values.');
  assert.strictEqual(optimizedResult.activePnl, 65.30);
  assert.strictEqual(optimizedResult.activeEstPnl, 80.00);
  assert.strictEqual(optimizedResult.trueProjectedPnl, 164.70); // (150 - 65.30) + 80 = 164.70
  assert.strictEqual(optimizedResult.peakRr, 3.2);
});

test('TradesView metrics: performance benchmark comparison', () => {
  const listSize = 100;
  const activeTrades = Array.from({ length: listSize }, (_, i) => ({
    symbol: `COIN-${i}USDT`,
    pnl: (Math.random() - 0.4) * 100,
    est_pnl_to_realize: (Math.random() - 0.3) * 100,
    max_rr: Math.random() * 5
  }));
  const totalPnl = 500.00;

  // Warm up
  originalTradesViewCalculation(activeTrades, totalPnl);
  optimizedTradesViewCalculation(activeTrades, totalPnl);

  const iterations = 10000;

  // Benchmark original approach
  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalTradesViewCalculation(activeTrades, totalPnl);
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  // Benchmark optimized approach
  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedTradesViewCalculation(activeTrades, totalPnl);
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  const resOriginal = originalTradesViewCalculation(activeTrades, totalPnl);
  const resOptimized = optimizedTradesViewCalculation(activeTrades, totalPnl);
  assert.deepStrictEqual(resOptimized, resOriginal, 'Correctness validation inside benchmark check');

  console.log(`\n⚡ Bolt Performance Benchmark (TradesView metrics, List size: ${listSize} trades, ${iterations} iterations):`);
  console.log(`  - Original multiple-pass reduce loops: ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Loop-fused single-pass loop:  ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                      ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});
