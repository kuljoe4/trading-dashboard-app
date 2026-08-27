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
  const maxRR = (activeTrades || []).reduce((max, trade) => Math.max(max, Number(trade.max_rr ?? trade.max_rr_achieved ?? 0)), 0);

  return { activePnlMap, activeEstPnlToRealizeMap, activeTradeCountsMap, totalActivePnl, maxRR };
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

  let maxRrAchieved = 0;
  const trades = activeTrades || [];
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (t) {
      const label = pnlMap[t.strategy_label] !== undefined ? t.strategy_label : currentStrategyLabel;
      const pnlVal = Number(t.pnl || 0);
      pnlMap[label] += pnlVal;
      estPnlMap[label] += Number(t.est_pnl_to_realize || 0);
      countMap[label]++;

      const rrVal = Number(t.max_rr ?? t.max_rr_achieved ?? 0);
      if (rrVal > maxRrAchieved) {
        maxRrAchieved = rrVal;
      }
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
    totalActivePnl: totPnl,
    maxRR: maxRrAchieved
  };
}

test('Active maps calculation: correctness of original and loop-fused optimized implementations', () => {
  const currentStrategyLabel = 'Momentum Strategy';
  const strategyVariants = [
    { strategy_label: 'EMA Cross 1h' },
    { strategy_label: 'Breakout 5m' }
  ];
  const activeTrades = [
    { symbol: 'BTCUSDT', strategy_label: 'Momentum Strategy', pnl: 25.50, est_pnl_to_realize: 30.00, max_rr_achieved: 1.5 },
    { symbol: 'ETHUSDT', strategy_label: 'EMA Cross 1h', pnl: -10.20, est_pnl_to_realize: -5.00, max_rr: 2.8 },
    { symbol: 'SOLUSDT', strategy_label: 'Breakout 5m', pnl: 45.00, est_pnl_to_realize: 50.00, max_rr_achieved: 0.5 },
    { symbol: 'ADAUSDT', strategy_label: 'Momentum Strategy', pnl: 5.00, est_pnl_to_realize: 5.00, max_rr: 0.2 },
    { symbol: 'XRPUSDT', strategy_label: 'Unknown Strategy Override', pnl: 12.00, est_pnl_to_realize: 15.00, max_rr_achieved: 1.1 } // Should fall back to Momentum Strategy
  ];

  const originalResult = originalActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);
  const optimizedResult = optimizedActiveMaps(activeTrades, currentStrategyLabel, strategyVariants);

  assert.deepStrictEqual(optimizedResult, originalResult, 'Both active map implementations must return identical values.');
  assert.strictEqual(optimizedResult.totalActivePnl, 77.30);
  assert.strictEqual(optimizedResult.activeTradeCountsMap['Momentum Strategy'], 3); // BTC + ADA + XRP fallback
  assert.strictEqual(optimizedResult.activePnlMap['EMA Cross 1h'], -10.20);
  assert.strictEqual(optimizedResult.maxRR, 2.8);
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

// Original correlationData calculation in DashboardView.jsx
function originalCorrelationData(tradeHistory) {
  const list = tradeHistory || [];
  const buckets = [
    { label: '< 5m', min: 0, max: 5 * 60 * 1000, grossWin: 0, grossLoss: 0, count: 0 },
    { label: '5m - 30m', min: 5 * 60 * 1000, max: 30 * 60 * 1000, grossWin: 0, grossLoss: 0, count: 0 },
    { label: '> 30m', min: 30 * 60 * 1000, max: Infinity, grossWin: 0, grossLoss: 0, count: 0 }
  ];

  list.forEach(t => {
    if (!t.entry_ts || !t.exit_ts) return;
    const entry = new Date(t.entry_ts).getTime();
    const exit = new Date(t.exit_ts).getTime();
    const duration = exit - entry;
    if (duration < 0) return;

    const bucket = buckets.find(b => duration >= b.min && duration < b.max);
    if (bucket) {
      const pnl = Number(t.pnl || 0);
      if (pnl > 0) bucket.grossWin += pnl;
      else if (pnl < 0) bucket.grossLoss += Math.abs(pnl);
      bucket.count++;
    }
  });

  return buckets.map(b => {
    const pfVal = b.grossLoss > 0 ? (b.grossWin / b.grossLoss) : (b.grossWin > 0 ? b.grossWin : 0);
    return {
      label: b.label,
      profitFactor: Number(Number(pfVal).toFixed(2)),
      count: b.count,
      avgDurationText: b.label
    };
  });
}

// Optimized correlationData calculation in DashboardView.jsx
function optimizedCorrelationData(tradeHistory) {
  const list = tradeHistory || [];
  const buckets = [
    { label: '< 5m', min: 0, max: 5 * 60 * 1000, grossWin: 0, grossLoss: 0, count: 0 },
    { label: '5m - 30m', min: 5 * 60 * 1000, max: 30 * 60 * 1000, grossWin: 0, grossLoss: 0, count: 0 },
    { label: '> 30m', min: 30 * 60 * 1000, max: Infinity, grossWin: 0, grossLoss: 0, count: 0 }
  ];

  const len = list.length;
  for (let i = 0; i < len; i++) {
    const t = list[i];
    if (!t) continue;

    const entry = t.entry_ts_ms ?? (t.entry_ts ? new Date(t.entry_ts).getTime() : 0);
    const exit = t.exit_ts_ms ?? (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
    if (!entry || !exit) continue;

    const duration = exit - entry;
    if (duration < 0) continue;

    let bucket = null;
    if (duration < 5 * 60 * 1000) {
      bucket = buckets[0];
    } else if (duration < 30 * 60 * 1000) {
      bucket = buckets[1];
    } else {
      bucket = buckets[2];
    }

    if (bucket) {
      const pnl = Number(t.pnl || 0);
      if (pnl > 0) bucket.grossWin += pnl;
      else if (pnl < 0) bucket.grossLoss += Math.abs(pnl);
      bucket.count++;
    }
  }

  const bLen = buckets.length;
  const result = new Array(bLen);
  for (let i = 0; i < bLen; i++) {
    const b = buckets[i];
    const pfVal = b.grossLoss > 0 ? (b.grossWin / b.grossLoss) : (b.grossWin > 0 ? b.grossWin : 0);
    result[i] = {
      label: b.label,
      profitFactor: Number(Number(pfVal).toFixed(2)),
      count: b.count,
      avgDurationText: b.label
    };
  }

  return result;
}

test('correlationData: correctness of original and optimized implementations', () => {
  const tradeHistory = [
    { entry_ts: '2026-07-20T10:00:00.000Z', exit_ts: '2026-07-20T10:04:00.000Z', entry_ts_ms: 1784541600000, exit_ts_ms: 1784541840000, pnl: 50.00 }, // 4m - bucket 0 (wins)
    { entry_ts: '2026-07-20T11:00:00.000Z', exit_ts: '2026-07-20T11:20:00.000Z', entry_ts_ms: 1784545200000, exit_ts_ms: 1784546400000, pnl: -20.00 }, // 20m - bucket 1 (losses)
    { entry_ts: '2026-07-20T12:00:00.000Z', exit_ts: '2026-07-20T13:00:00.000Z', entry_ts_ms: 1784548800000, exit_ts_ms: 1784552400000, pnl: 100.00 }, // 60m - bucket 2 (wins)
    { entry_ts: '2026-07-20T14:00:00.000Z', exit_ts: '2026-07-20T14:15:00.000Z', entry_ts_ms: 1784556000000, exit_ts_ms: 1784556900000, pnl: 30.00 }   // 15m - bucket 1 (wins)
  ];

  const originalResult = originalCorrelationData(tradeHistory);
  const optimizedResult = optimizedCorrelationData(tradeHistory);

  assert.deepStrictEqual(optimizedResult, originalResult, 'Both implementations must return identical values.');
  assert.strictEqual(optimizedResult[0].count, 1);
  assert.strictEqual(optimizedResult[1].count, 2);
  assert.strictEqual(optimizedResult[2].count, 1);
  assert.strictEqual(optimizedResult[1].profitFactor, 1.5); // 30 / 20 = 1.5
});

test('correlationData: performance benchmark', () => {
  const listSize = 1000;
  const tradeHistory = Array.from({ length: listSize }, (_, i) => {
    const entryTime = Date.now() - i * 60000;
    const duration = Math.random() * 45 * 60000; // up to 45 mins
    const exitTime = entryTime + duration;
    return {
      entry_ts: new Date(entryTime).toISOString(),
      exit_ts: new Date(exitTime).toISOString(),
      entry_ts_ms: entryTime,
      exit_ts_ms: exitTime,
      pnl: (Math.random() - 0.4) * 100
    };
  });

  // Warmup
  originalCorrelationData(tradeHistory);
  optimizedCorrelationData(tradeHistory);

  const iterations = 1000;

  // Benchmark original approach
  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalCorrelationData(tradeHistory);
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  // Benchmark optimized approach
  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedCorrelationData(tradeHistory);
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  const resOriginal = originalCorrelationData(tradeHistory);
  const resOptimized = optimizedCorrelationData(tradeHistory);
  assert.deepStrictEqual(resOptimized, resOriginal, 'Optimized results must match original results exactly.');

  console.log(`\n⚡ Bolt Performance Benchmark (Correlation Data Calculation, List size: ${listSize} trades, ${iterations} iterations):`);
  console.log(`  - Original new Date() / buckets.find:  ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized O(1) timestamps / branch: ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                  ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});
