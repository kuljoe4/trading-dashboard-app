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

// Original un-memoized inline filtering logic from TradesView render body
function originalTradesViewFiltering(activeTrades, strategyFilter, directionFilter, riskFilter) {
  const availableStrategies = Array.from(new Set((activeTrades || []).map(t => t.strategy_label || 'Momentum Strategy')));

  const filteredTrades = (activeTrades || []).filter(t => {
    if (strategyFilter !== 'ALL' && (t.strategy_label || 'Momentum Strategy') !== strategyFilter) {
      return false;
    }
    if (directionFilter !== 'ALL' && (t.direction || 'LONG').toUpperCase() !== directionFilter) {
      return false;
    }
    if (riskFilter !== 'ALL') {
      const entry = Number(t.entry_price || 0);
      const sl = Number(t.sl_price || 0);
      const isLong = (t.direction || 'LONG').toUpperCase() === 'LONG';
      const isSlAtBreakeven = sl > 0 && (isLong ? sl >= entry - 1e-6 : sl <= entry + 1e-6);
      const isRiskReleased = isSlAtBreakeven || (t.risk_usdt === 0 && Number(t.initial_risk_usdt) > 0);
      if (riskFilter === 'PROTECTED' && !isRiskReleased) return false;
      if (riskFilter === 'ACTIVE' && isRiskReleased) return false;
    }
    return true;
  });

  return { availableStrategies, filteredTrades };
}

// Optimized single-pass loop-fused implementation
function optimizedTradesViewFiltering(activeTrades, strategyFilter, directionFilter, riskFilter) {
  const trades = activeTrades || [];
  const stratSet = new Set();
  const filtered = [];
  const len = trades.length;

  for (let i = 0; i < len; i++) {
    const t = trades[i];
    const stratLabel = t.strategy_label || 'Momentum Strategy';
    stratSet.add(stratLabel);

    if (strategyFilter !== 'ALL' && stratLabel !== strategyFilter) {
      continue;
    }

    const dirRaw = t.direction || 'LONG';
    const isLong = dirRaw === 'LONG' || dirRaw === 'long' || (typeof dirRaw === 'string' && dirRaw.toUpperCase() === 'LONG');
    if (directionFilter !== 'ALL') {
      const dirUpper = isLong ? 'LONG' : 'SHORT';
      if (dirUpper !== directionFilter) {
        continue;
      }
    }

    if (riskFilter !== 'ALL') {
      const entry = Number(t.entry_price || 0);
      const sl = Number(t.sl_price || 0);
      const isSlAtBreakeven = sl > 0 && (isLong ? sl >= entry - 1e-6 : sl <= entry + 1e-6);
      const isRiskReleased = isSlAtBreakeven || (t.risk_usdt === 0 && Number(t.initial_risk_usdt) > 0);
      if (riskFilter === 'PROTECTED' && !isRiskReleased) continue;
      if (riskFilter === 'ACTIVE' && isRiskReleased) continue;
    }

    filtered.push(t);
  }

  return {
    availableStrategies: Array.from(stratSet),
    filteredTrades: filtered
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

test('TradesView tactical filtering: correctness of single-pass loop-fused implementation', () => {
  const activeTrades = [
    { symbol: 'BTCUSDT', strategy_label: 'Alpha Strategy', direction: 'LONG', entry_price: 50000, sl_price: 50500, risk_usdt: 0, initial_risk_usdt: 100 },
    { symbol: 'ETHUSDT', strategy_label: 'Alpha Strategy', direction: 'SHORT', entry_price: 3000, sl_price: 3100, risk_usdt: 50, initial_risk_usdt: 50 },
    { symbol: 'SOLUSDT', strategy_label: 'Beta Strategy', direction: 'LONG', entry_price: 100, sl_price: 90, risk_usdt: 20, initial_risk_usdt: 20 },
    { symbol: 'ADAUSDT', strategy_label: 'Beta Strategy', direction: 'SHORT', entry_price: 1.0, sl_price: 0.9, risk_usdt: 0, initial_risk_usdt: 15 }
  ];

  const origAll = originalTradesViewFiltering(activeTrades, 'ALL', 'ALL', 'ALL');
  const optAll = optimizedTradesViewFiltering(activeTrades, 'ALL', 'ALL', 'ALL');
  assert.deepStrictEqual(optAll, origAll, 'ALL filters must produce identical results');

  const origAlphaLong = originalTradesViewFiltering(activeTrades, 'Alpha Strategy', 'LONG', 'ALL');
  const optAlphaLong = optimizedTradesViewFiltering(activeTrades, 'Alpha Strategy', 'LONG', 'ALL');
  assert.deepStrictEqual(optAlphaLong, origAlphaLong, 'Alpha Strategy + LONG filters must produce identical results');

  const origProtected = originalTradesViewFiltering(activeTrades, 'ALL', 'ALL', 'PROTECTED');
  const optProtected = optimizedTradesViewFiltering(activeTrades, 'ALL', 'ALL', 'PROTECTED');
  assert.deepStrictEqual(optProtected, origProtected, 'PROTECTED risk filter must produce identical results');

  const origActiveRisk = originalTradesViewFiltering(activeTrades, 'ALL', 'ALL', 'ACTIVE');
  const optActiveRisk = optimizedTradesViewFiltering(activeTrades, 'ALL', 'ALL', 'ACTIVE');
  assert.deepStrictEqual(optActiveRisk, origActiveRisk, 'ACTIVE risk filter must produce identical results');
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

test('TradesView tactical filtering: performance benchmark comparison', () => {
  const listSize = 200;
  const strats = ['Momentum Strategy', 'Alpha Strategy', 'Beta Strategy', 'Gamma Strategy'];
  const dirs = ['LONG', 'SHORT'];

  const activeTrades = Array.from({ length: listSize }, (_, i) => ({
    symbol: `COIN-${i}USDT`,
    strategy_label: strats[i % strats.length],
    direction: dirs[i % dirs.length],
    entry_price: 100 + (i % 10),
    sl_price: i % 2 === 0 ? 101 : 90,
    risk_usdt: i % 3 === 0 ? 0 : 25,
    initial_risk_usdt: 25
  }));

  // Warm up
  originalTradesViewFiltering(activeTrades, 'Alpha Strategy', 'LONG', 'PROTECTED');
  optimizedTradesViewFiltering(activeTrades, 'Alpha Strategy', 'LONG', 'PROTECTED');

  const iterations = 10000;

  // Benchmark original approach
  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalTradesViewFiltering(activeTrades, 'Alpha Strategy', 'LONG', 'PROTECTED');
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  // Benchmark optimized approach
  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedTradesViewFiltering(activeTrades, 'Alpha Strategy', 'LONG', 'PROTECTED');
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  const resOriginal = originalTradesViewFiltering(activeTrades, 'Alpha Strategy', 'LONG', 'PROTECTED');
  const resOptimized = optimizedTradesViewFiltering(activeTrades, 'Alpha Strategy', 'LONG', 'PROTECTED');
  assert.deepStrictEqual(resOptimized, resOriginal, 'Correctness validation inside tactical filtering benchmark');

  console.log(`\n⚡ Bolt Performance Benchmark (TradesView tactical filtering, List size: ${listSize} trades, ${iterations} iterations):`);
  console.log(`  - Original un-memoized array mapping/filtering: ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized single-pass loop-fused filtering:    ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                            ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});
