import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';

// The original sorting algorithm
function findLastSessionSort(sessionList) {
  const ls = (!sessionList || sessionList.length === 0) ? null : [...sessionList].sort((a, b) => {
    const bTime = b.startTimeMs ?? (b.startTime ? new Date(b.startTime).getTime() : 0);
    const aTime = a.startTimeMs ?? (a.startTime ? new Date(a.startTime).getTime() : 0);
    return bTime - aTime;
  })[0];
  return ls;
}

// The optimized single-pass algorithm
function findLastSessionSinglePass(sessionList) {
  let ls = null;
  if (sessionList && sessionList.length > 0) {
    let maxTime = -Infinity;
    for (let i = 0; i < sessionList.length; i++) {
      const s = sessionList[i];
      if (!s) continue;
      const sTime = s.startTimeMs ?? (s.startTime ? new Date(s.startTime).getTime() : 0);
      if (sTime > maxTime) {
        maxTime = sTime;
        ls = s;
      }
    }
  }
  return ls;
}

test('findLastSession returns null for empty or null sessionList', () => {
  assert.strictEqual(findLastSessionSinglePass(null), null);
  assert.strictEqual(findLastSessionSinglePass([]), null);
});

test('findLastSession correctly identifies the most recent session (mixed dates and milliseconds)', () => {
  const sessions = [
    { id: 'session-1', startTime: '2026-07-20T10:00:00.000Z' }, // 10:00
    { id: 'session-2', startTimeMs: new Date('2026-07-20T12:00:00.000Z').getTime() }, // 12:00 (Latest)
    { id: 'session-3', startTime: '2026-07-20T11:00:00.000Z' }, // 11:00
    { id: 'session-4', startTimeMs: new Date('2026-07-20T09:00:00.000Z').getTime() }  // 09:00
  ];

  const sortedResult = findLastSessionSort(sessions);
  const singlePassResult = findLastSessionSinglePass(sessions);

  assert.strictEqual(sortedResult.id, 'session-2');
  assert.strictEqual(singlePassResult.id, 'session-2');
  assert.deepStrictEqual(singlePassResult, sortedResult, 'Both implementations must return the exact same session object.');
});

test('findLastSession performance comparison benchmark', () => {
  // Generate 1000 mockup sessions
  const listSize = 1000;
  const sessions = Array.from({ length: listSize }, (_, i) => ({
    id: `session-${i}`,
    startTime: new Date(Date.now() - i * 60000).toISOString()
  }));

  // Benchmark sorting approach
  const startSort = performance.now();
  const resSort = findLastSessionSort(sessions);
  const endSort = performance.now();
  const sortDuration = endSort - startSort;

  // Benchmark single-pass approach
  const startSingle = performance.now();
  const resSingle = findLastSessionSinglePass(sessions);
  const endSingle = performance.now();
  const singleDuration = endSingle - startSingle;

  assert.strictEqual(resSingle.id, resSort.id, 'Optimized results must match sort results exactly');

  console.log(`\n⚡ Bolt Performance Benchmark (List size: ${listSize} sessions):`);
  console.log(`  - Original Sorting-based Lookup: ${sortDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Single-pass Lookup:   ${singleDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:             ${(sortDuration / Math.max(0.0001, singleDuration)).toFixed(1)}x faster`);
});

// Original Active Maps calculation inside DashboardView.jsx
function originalActiveMaps(activeTrades, currentStrategyLabel, strategyVariants) {
  const activePnlMap = (() => {
    const map = { [currentStrategyLabel]: 0 };
    (strategyVariants || []).forEach(v => {
      const label = v.strategy_label || 'Variant';
      map[label] = 0;
    });
    (activeTrades || []).forEach(t => {
      if (t) {
        const label = map[t.strategy_label] !== undefined ? t.strategy_label : currentStrategyLabel;
        map[label] += Number(t.pnl || 0);
      }
    });
    return map;
  })();

  const activeEstPnlToRealizeMap = (() => {
    const map = { [currentStrategyLabel]: 0 };
    (strategyVariants || []).forEach(v => {
      const label = v.strategy_label || 'Variant';
      map[label] = 0;
    });
    (activeTrades || []).forEach(t => {
      if (t) {
        const label = map[t.strategy_label] !== undefined ? t.strategy_label : currentStrategyLabel;
        map[label] += Number(t.est_pnl_to_realize || 0);
      }
    });
    return map;
  })();

  const activeTradeCountsMap = (() => {
    const map = { [currentStrategyLabel]: 0 };
    (strategyVariants || []).forEach(v => {
      const label = v.strategy_label || 'Variant';
      map[label] = 0;
    });
    (activeTrades || []).forEach(t => {
      if (t) {
        const label = map[t.strategy_label] !== undefined ? t.strategy_label : currentStrategyLabel;
        map[label]++;
      }
    });
    return map;
  })();

  const totalActivePnl = Object.values(activePnlMap || {}).reduce((acc, val) => acc + val, 0);

  return { activePnlMap, activeEstPnlToRealizeMap, activeTradeCountsMap, totalActivePnl };
}

// Optimized Active Maps calculation using Loop Fusion & Single-Pass traversal
function optimizedActiveMaps(activeTrades, currentStrategyLabel, strategyVariants) {
  const pnlMap = { [currentStrategyLabel]: 0 };
  const estPnlMap = { [currentStrategyLabel]: 0 };
  const countMap = { [currentStrategyLabel]: 0 };

  const variants = strategyVariants || [];
  for (let i = 0; i < variants.length; i++) {
    const label = variants[i].strategy_label || 'Variant';
    pnlMap[label] = 0;
    estPnlMap[label] = 0;
    countMap[label] = 0;
  }

  const trades = activeTrades || [];
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (t) {
      const label = pnlMap[t.strategy_label] !== undefined ? t.strategy_label : currentStrategyLabel;
      const pnlVal = Number(t.pnl || 0);
      pnlMap[label] += pnlVal;
      estPnlMap[label] += Number(t.est_pnl_to_realize || 0);
      countMap[label]++;
    }
  }

  const pnlValues = Object.values(pnlMap);
  let totPnl = 0;
  for (let i = 0; i < pnlValues.length; i++) {
    totPnl += pnlValues[i];
  }

  return {
    activePnlMap: pnlMap,
    activeEstPnlToRealizeMap: estPnlMap,
    activeTradeCountsMap: countMap,
    totalActivePnl: totPnl
  };
}

test('Active maps calculation: correctness of original and loop-fused optimized implementations', () => {
  const currentStrategyLabel = 'Momentum Strategy';
  const strategyVariants = [
    { strategy_label: 'EMA Cross 1h' },
    { strategy_label: 'Breakout 5m' }
  ];
  const activeTrades = [
    { symbol: 'BTCUSDT', strategy_label: 'Momentum Strategy', pnl: 25.50, est_pnl_to_realize: 30.00 },
    { symbol: 'ETHUSDT', strategy_label: 'EMA Cross 1h', pnl: -10.20, est_pnl_to_realize: -5.00 },
    { symbol: 'SOLUSDT', strategy_label: 'Breakout 5m', pnl: 45.00, est_pnl_to_realize: 50.00 },
    { symbol: 'ADAUSDT', strategy_label: 'Momentum Strategy', pnl: 5.00, est_pnl_to_realize: 5.00 },
    { symbol: 'XRPUSDT', strategy_label: 'Unknown Strategy Override', pnl: 12.00, est_pnl_to_realize: 15.00 } // Should fall back to Momentum Strategy
  ];

  const originalResult = originalActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);
  const optimizedResult = optimizedActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);

  assert.deepStrictEqual(optimizedResult, originalResult, 'Both active map implementations must return identical values.');
  assert.strictEqual(optimizedResult.totalActivePnl, 77.30);
  assert.strictEqual(optimizedResult.activeTradeCountsMap['Momentum Strategy'], 3); // BTC + ADA + XRP fallback
  assert.strictEqual(optimizedResult.activePnlMap['EMA Cross 1h'], -10.20);
});

test('Active maps calculation: performance benchmark', () => {
  const currentStrategyLabel = 'Momentum Strategy';
  const strategyVariants = Array.from({ length: 15 }, (_, i) => ({
    strategy_label: `Variant-${i}`
  }));

  const activeTrades = Array.from({ length: 50 }, (_, i) => {
    const r = Math.random();
    const strategy_label = r < 0.2 ? 'Momentum Strategy' : `Variant-${Math.floor(Math.random() * 15)}`;
    return {
      symbol: `COIN-${i}USDT`,
      strategy_label,
      pnl: (Math.random() - 0.4) * 100,
      est_pnl_to_realize: (Math.random() - 0.3) * 100
    };
  });

  // Warmup
  originalActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);
  optimizedActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);

  const iterations = 5000;

  // Benchmark original approach
  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  // Benchmark optimized approach
  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  const resOriginal = originalActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);
  const resOptimized = optimizedActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);
  assert.deepStrictEqual(resOptimized, resOriginal, 'Correctness validation inside benchmark check');

  console.log(`\n⚡ Bolt Performance Benchmark (Active Trade Strategy Mapping, List size: ${activeTrades.length} trades, 15 variants, ${iterations} iterations):`);
  console.log(`  - Original multiple-pass forEach maps: ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Loop-fused single-pass maps:  ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                      ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});
