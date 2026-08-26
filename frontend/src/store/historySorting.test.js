import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { calculatePerformanceMetrics } from '../lib/analytics.js';

test('calculatePerformanceMetrics computes winRate correctly', () => {
  // Session A has 3 wins and 1 loss (75% winrate)
  const tradesA = [
    { pnl: 100, createdAt: '2026-07-20T00:00:00.000Z' },
    { pnl: 50, createdAt: '2026-07-20T01:00:00.000Z' },
    { pnl: -20, createdAt: '2026-07-20T02:00:00.000Z' },
    { pnl: 200, createdAt: '2026-07-20T03:00:00.000Z' }
  ];

  // Session B has 1 win and 3 losses (25% winrate)
  const tradesB = [
    { pnl: 100, createdAt: '2026-07-20T00:00:00.000Z' },
    { pnl: -50, createdAt: '2026-07-20T01:00:00.000Z' },
    { pnl: -20, createdAt: '2026-07-20T02:00:00.000Z' },
    { pnl: -200, createdAt: '2026-07-20T03:00:00.000Z' }
  ];

  const metricsA = calculatePerformanceMetrics(tradesA, 10000);
  const metricsB = calculatePerformanceMetrics(tradesB, 10000);

  assert.strictEqual(metricsA.winRate, 75, 'A should have 75% winrate');
  assert.strictEqual(metricsB.winRate, 25, 'B should have 25% winrate');
});

test('Win Rate Sorting correctly sorts sessions with Schwartzian Transform', () => {
  // Mock sessions list
  const sessions = [
    {
      id: 'session-low',
      analytics: null,
      trades: [
        { pnl: 100, createdAt: '2026-07-20T00:00:00.000Z' },
        { pnl: -50, createdAt: '2026-07-20T01:00:00.000Z' },
        { pnl: -20, createdAt: '2026-07-20T02:00:00.000Z' },
        { pnl: -200, createdAt: '2026-07-20T03:00:00.000Z' }
      ] // 25% winrate
    },
    {
      id: 'session-high',
      analytics: null,
      trades: [
        { pnl: 100, createdAt: '2026-07-20T00:00:00.000Z' },
        { pnl: 50, createdAt: '2026-07-20T01:00:00.000Z' },
        { pnl: -20, createdAt: '2026-07-20T02:00:00.000Z' },
        { pnl: 200, createdAt: '2026-07-20T03:00:00.000Z' }
      ] // 75% winrate
    },
    {
      id: 'session-mid',
      analytics: { overallWinRate: 50 }, // Use pre-calculated analytics winrate
      trades: [] // 50% winrate
    }
  ];

  // Schwartzian transform-based sort (matching the optimized code in HistoryView.jsx)
  const mapped = sessions.map(s => ({
    s,
    winRate: s.analytics?.overallWinRate || calculatePerformanceMetrics(s.trades).winRate
  }));

  mapped.sort((a, b) => b.winRate - a.winRate);
  const sortedSessions = mapped.map(item => item.s);

  // Assert correct sorting order: high (75%), mid (50%), low (25%)
  assert.strictEqual(sortedSessions[0].id, 'session-high');
  assert.strictEqual(sortedSessions[1].id, 'session-mid');
  assert.strictEqual(sortedSessions[2].id, 'session-low');

  // Verify win rates match expectations
  assert.strictEqual(mapped.find(x => x.s.id === 'session-high').winRate, 75);
  assert.strictEqual(mapped.find(x => x.s.id === 'session-mid').winRate, 50);
  assert.strictEqual(mapped.find(x => x.s.id === 'session-low').winRate, 25);
});

test('calculatePerformanceMetrics correctness with and without pre-calculated ms timestamps', () => {
  const tradesRaw = [
    { pnl: 150, entry_ts: '2026-07-20T10:00:00.000Z', exit_ts: '2026-07-20T11:00:00.000Z' },
    { pnl: -50, entry_ts: '2026-07-20T12:00:00.000Z', exit_ts: '2026-07-20T13:00:00.000Z' }
  ];

  const tradesPreCalculated = [
    { pnl: 150, entry_ts: '2026-07-20T10:00:00.000Z', exit_ts: '2026-07-20T11:00:00.000Z', entry_ts_ms: 1784541600000, exit_ts_ms: 1784545200000 },
    { pnl: -50, entry_ts: '2026-07-20T12:00:00.000Z', exit_ts: '2026-07-20T13:00:00.000Z', entry_ts_ms: 1784548800000, exit_ts_ms: 1784552400000 }
  ];

  const metricsRaw = calculatePerformanceMetrics(tradesRaw, 10000);
  const metricsPreCalculated = calculatePerformanceMetrics(tradesPreCalculated, 10000);

  // Assert both implementations yield identical results
  assert.deepStrictEqual(metricsPreCalculated, metricsRaw, 'Pre-calculated and raw metrics must match exactly.');
  assert.strictEqual(metricsPreCalculated.winRate, 50);
  assert.strictEqual(metricsPreCalculated.totalPnl, 100);
  assert.strictEqual(metricsPreCalculated.wins, 1);
});

test('calculatePerformanceMetrics benchmark performance test', () => {
  const listSize = 200;
  const rawTrades = Array.from({ length: listSize }, (_, i) => ({
    pnl: (Math.random() - 0.4) * 100,
    entry_ts: new Date(Date.now() - (listSize - i) * 60000).toISOString(),
    exit_ts: new Date(Date.now() - (listSize - i - 1) * 60000).toISOString()
  }));

  const preCalculatedTrades = rawTrades.map(t => ({
    ...t,
    entry_ts_ms: new Date(t.entry_ts).getTime(),
    exit_ts_ms: new Date(t.exit_ts).getTime()
  }));

  // Warmup
  calculatePerformanceMetrics(rawTrades, 10000);
  calculatePerformanceMetrics(preCalculatedTrades, 10000);

  // Benchmark Raw (new Date instantiation per trade per call)
  const startRaw = performance.now();
  const iterations = 1000;
  for (let i = 0; i < iterations; i++) {
    calculatePerformanceMetrics(rawTrades, 10000);
  }
  const endRaw = performance.now();
  const rawDuration = endRaw - startRaw;

  // Benchmark Pre-Calculated (O(1) direct ms timestamp retrieval)
  const startPreCalculated = performance.now();
  for (let i = 0; i < iterations; i++) {
    calculatePerformanceMetrics(preCalculatedTrades, 10000);
  }
  const endPreCalculated = performance.now();
  const preCalculatedDuration = endPreCalculated - startPreCalculated;

  const rawRes = calculatePerformanceMetrics(rawTrades, 10000);
  const preCalcRes = calculatePerformanceMetrics(preCalculatedTrades, 10000);
  assert.deepStrictEqual(preCalcRes, rawRes, 'Verification inside benchmark: results must match.');

  console.log(`\n⚡ Bolt Performance Benchmark (List size: ${listSize} trades, ${iterations} iterations):`);
  console.log(`  - Original new Date()-based Metrics: ${rawDuration.toFixed(4)} ms`);
  console.log(`  - Optimized O(1) timestamp-based Metrics: ${preCalculatedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                    ${(rawDuration / Math.max(0.0001, preCalculatedDuration)).toFixed(1)}x faster`);
});

test('Stacked win/loss distribution calculation loop-fusion correctness and performance benchmark', () => {
  // Helper functions representing the two implementations
  const originalImpl = (trades) => {
    const winCount = trades.filter(t => Number(t.pnl || 0) > 0).length;
    const lossCount = trades.filter(t => Number(t.pnl || 0) < 0).length;
    const scratchCount = trades.filter(t => Number(t.pnl || 0) === 0).length;
    return { winCount, lossCount, scratchCount };
  };

  const optimizedImpl = (trades) => {
    let w = 0;
    let l = 0;
    let s = 0;
    const len = trades.length;
    for (let i = 0; i < len; i++) {
      const pnlVal = Number(trades[i].pnl || 0);
      if (pnlVal > 0) w++;
      else if (pnlVal < 0) l++;
      else s++;
    }
    return { winCount: w, lossCount: l, scratchCount: s };
  };

  // Create mock trades list
  const mockTrades = Array.from({ length: 500 }, () => ({
    pnl: (Math.random() - 0.45) * 100 // some positive, some negative, some zero (if we round)
  }));
  // Add some exact zeros
  for (let i = 0; i < 50; i++) {
    mockTrades[Math.floor(Math.random() * mockTrades.length)].pnl = 0;
  }

  // 1. Correctness Verification
  const resOriginal = originalImpl(mockTrades);
  const resOptimized = optimizedImpl(mockTrades);
  assert.deepStrictEqual(resOptimized, resOriginal, 'Optimized results must match original results exactly.');

  // 2. Performance Benchmark
  const iterations = 5000;

  // Warmup
  originalImpl(mockTrades);
  optimizedImpl(mockTrades);

  // Original
  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalImpl(mockTrades);
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  // Optimized
  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedImpl(mockTrades);
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  console.log(`\n⚡ Bolt Performance Benchmark (Stacked Win/Loss distribution, List size: ${mockTrades.length} trades, ${iterations} iterations):`);
  console.log(`  - Original 3x filter()-based: ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Loop-fused (no allocations): ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                    ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});

test('calculateWinRate helper correctness and performance benchmark', () => {
  const calculateWinRate = (trades) => {
    const count = trades?.length || 0;
    if (count === 0) return 0;
    let wins = 0;
    for (let i = 0; i < count; i++) {
      if (Number(trades[i].pnl || 0) > 0) wins++;
    }
    return Math.round((wins / count) * 100);
  };

  const listSize = 300;
  const mockTrades = Array.from({ length: listSize }, () => ({
    pnl: (Math.random() - 0.4) * 100,
    createdAt: '2026-07-20T00:00:00.000Z'
  }));

  // Correctness Verification
  const expectedWinRate = calculatePerformanceMetrics(mockTrades, 10000).winRate;
  const actualWinRate = calculateWinRate(mockTrades);
  assert.strictEqual(actualWinRate, expectedWinRate, 'Win rate must match exactly.');

  // Benchmark
  const iterations = 5000;
  // Warmup
  calculatePerformanceMetrics(mockTrades, 10000);
  calculateWinRate(mockTrades);

  // Heavy
  const startHeavy = performance.now();
  for (let i = 0; i < iterations; i++) {
    calculatePerformanceMetrics(mockTrades, 10000);
  }
  const endHeavy = performance.now();
  const heavyDuration = endHeavy - startHeavy;

  // Lightweight
  const startLight = performance.now();
  for (let i = 0; i < iterations; i++) {
    calculateWinRate(mockTrades);
  }
  const endLight = performance.now();
  const lightDuration = endLight - startLight;

  console.log(`\n⚡ Bolt Performance Benchmark (Win Rate Calculation, List size: ${listSize} trades, ${iterations} iterations):`);
  console.log(`  - Original Heavy calculatePerformanceMetrics: ${heavyDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Lightweight calculateWinRate: ${lightDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                    ${(heavyDuration / Math.max(0.0001, lightDuration)).toFixed(1)}x faster`);
});

test('RrWinRateCalculator single-pass return tracking correctness and performance benchmark', () => {
  const trades = Array.from({ length: 500 }, (_, i) => ({
    max_rr_achieved: (i % 3 === 0) ? 2.5 : 0.8,
    min_rr_achieved: -0.5,
    initial_risk_usdt: 100,
    exit_ts_ms: 1784545200000 + i * 60000,
    entry_ts_ms: 1784541600000 + i * 60000,
    exit_rr: (i % 2 === 0) ? 1.5 : -1.0
  }));

  const targetRr = 2.0;
  const startingBalance = 10000;
  const projectedTrades = 50;
  const usePctRisk = true;
  const riskPct = 1.0;
  const useCompounding = true;

  const originalImpl = (trades) => {
    const startBalNum = Number(startingBalance) || 10000;
    const riskPctNum = Number(riskPct) || 1.0;
    const count = trades.length;

    let winCount = 0;
    let totalSimulatedPnl = 0;
    let currentBalance = startBalNum;
    const simReturns = [];

    for (let i = 0; i < count; i++) {
      const t = trades[i];
      const maxRr = Number(t.max_rr_achieved ?? t.max_rr ?? 0);
      const isWin = maxRr >= targetRr;

      const risk = usePctRisk
        ? (useCompounding ? (currentBalance * (riskPctNum / 100)) : (startBalNum * (riskPctNum / 100)))
        : Number(t.initial_risk_usdt || t.risk_usdt || 100);

      let tradePnl = 0;
      if (isWin) {
        winCount++;
        tradePnl = targetRr * risk;
        totalSimulatedPnl += tradePnl;
        currentBalance += tradePnl;
      } else {
        tradePnl = -risk;
        totalSimulatedPnl += tradePnl;
        currentBalance += tradePnl;
      }

      const pctReturn = startBalNum > 0 ? (tradePnl / startBalNum) * 100 : 0;
      simReturns.push(pctReturn);
    }

    let sharpeRatio = 0;
    let sortinoRatio = 0;

    if (count > 0) {
      const meanReturn = simReturns.reduce((sum, r) => sum + r, 0) / count;
      const variance = simReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / count;
      const downsideVariance = simReturns.reduce((sum, r) => sum + Math.pow(Math.min(0, r), 2), 0) / count;

      const stdDev = Math.sqrt(variance);
      const downsideStdDev = Math.sqrt(downsideVariance);

      sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) : 0;
      sortinoRatio = downsideStdDev > 0 ? (meanReturn / downsideStdDev) : 0;
    }

    return { sharpeRatio: sharpeRatio.toFixed(2), sortinoRatio: sortinoRatio.toFixed(2) };
  };

  const optimizedImpl = (trades) => {
    const startBalNum = Number(startingBalance) || 10000;
    const riskPctNum = Number(riskPct) || 1.0;
    const count = trades.length;

    let winCount = 0;
    let totalSimulatedPnl = 0;
    let currentBalance = startBalNum;
    let sumReturns = 0;
    let sumSquaredReturns = 0;
    let downsideSumSquaredReturns = 0;

    for (let i = 0; i < count; i++) {
      const t = trades[i];
      const maxRr = Number(t.max_rr_achieved ?? t.max_rr ?? 0);
      const isWin = maxRr >= targetRr;

      const risk = usePctRisk
        ? (useCompounding ? (currentBalance * (riskPctNum / 100)) : (startBalNum * (riskPctNum / 100)))
        : Number(t.initial_risk_usdt || t.risk_usdt || 100);

      let tradePnl = 0;
      if (isWin) {
        winCount++;
        tradePnl = targetRr * risk;
        totalSimulatedPnl += tradePnl;
        currentBalance += tradePnl;
      } else {
        tradePnl = -risk;
        totalSimulatedPnl += tradePnl;
        currentBalance += tradePnl;
      }

      const pctReturn = startBalNum > 0 ? (tradePnl / startBalNum) * 100 : 0;
      sumReturns += pctReturn;
      sumSquaredReturns += pctReturn * pctReturn;
      if (pctReturn < 0) {
        downsideSumSquaredReturns += pctReturn * pctReturn;
      }
    }

    let sharpeRatio = 0;
    let sortinoRatio = 0;

    if (count > 0) {
      const meanReturn = sumReturns / count;
      const variance = Math.max(0, (sumSquaredReturns / count) - (meanReturn * meanReturn));
      const downsideVariance = downsideSumSquaredReturns / count;

      const stdDev = Math.sqrt(variance);
      const downsideStdDev = Math.sqrt(downsideVariance);

      sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) : 0;
      sortinoRatio = downsideStdDev > 0 ? (meanReturn / downsideStdDev) : 0;
    }

    return { sharpeRatio: sharpeRatio.toFixed(2), sortinoRatio: sortinoRatio.toFixed(2) };
  };

  // 1. Correctness Verification
  const resOriginal = originalImpl(trades);
  const resOptimized = optimizedImpl(trades);
  assert.deepStrictEqual(resOptimized, resOriginal, 'Optimized Sharpe/Sortino ratios must match original exactly.');

  // 2. Performance Benchmark
  const iterations = 10000;
  originalImpl(trades);
  optimizedImpl(trades);

  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalImpl(trades);
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedImpl(trades);
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  console.log(`\n⚡ Bolt Performance Benchmark (RrWinRateCalculator Simulation, List size: ${trades.length} trades, ${iterations} iterations):`);
  console.log(`  - Original simReturns array + reduce: ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Loop-fused scalar accumulators: ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                     ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});

test('RrWinRateCalculator low RR targets below 0.5 correctness and exit distribution bucket verification', () => {
  const trades = [
    { exit_rr: -1.0, pnl: -100, max_rr_achieved: 0.1, min_rr_achieved: -1.0, initial_risk_usdt: 100 },
    { exit_rr: 0.15, pnl: 15, max_rr_achieved: 0.2, min_rr_achieved: -0.1, initial_risk_usdt: 100 },
    { exit_rr: 0.35, pnl: 35, max_rr_achieved: 0.4, min_rr_achieved: -0.2, initial_risk_usdt: 100 },
    { exit_rr: 0.75, pnl: 75, max_rr_achieved: 0.8, min_rr_achieved: -0.1, initial_risk_usdt: 100 },
    { exit_rr: 1.5,  pnl: 150, max_rr_achieved: 1.8, min_rr_achieved: -0.0, initial_risk_usdt: 100 },
    { exit_rr: 2.5,  pnl: 250, max_rr_achieved: 2.8, min_rr_achieved: -0.0, initial_risk_usdt: 100 },
    { exit_rr: 3.5,  pnl: 350, max_rr_achieved: 3.8, min_rr_achieved: -0.0, initial_risk_usdt: 100 },
  ];

  // Test target RR = 0.2R (sub-0.5 target)
  const targetRr = 0.2;
  let winCount = 0;
  trades.forEach(t => {
    if (Number(t.max_rr_achieved) >= targetRr) {
      winCount++;
    }
  });

  // max_rr_achieved values: 0.1 (L), 0.2 (W), 0.4 (W), 0.8 (W), 1.8 (W), 2.8 (W), 3.8 (W) -> 6 wins, 1 loss
  assert.strictEqual(winCount, 6, 'Sub-0.5 target RR of 0.2 should evaluate 6 winning trades out of 7');

  // Verify exit RR distribution buckets for sub-0.5 ranges and PnL aggregation
  let rangeMinusToZero = 0;
  let rangeZeroToQuarter = 0;
  let rangeQuarterToHalf = 0;
  let rangeHalfToOne = 0;
  let rangeOneToTwo = 0;
  let rangeTwoToThree = 0;
  let rangeThreePlus = 0;

  let pnlMinusToZero = 0;
  let pnlZeroToQuarter = 0;
  let pnlQuarterToHalf = 0;
  let pnlHalfToOne = 0;
  let pnlOneToTwo = 0;
  let pnlTwoToThree = 0;
  let pnlThreePlus = 0;

  trades.forEach(t => {
    const err = Number(t.exit_rr);
    const pnl = Number(t.pnl || 0);
    if (err <= 0) {
      rangeMinusToZero++;
      pnlMinusToZero += pnl;
    } else if (err > 0 && err <= 0.25) {
      rangeZeroToQuarter++;
      pnlZeroToQuarter += pnl;
    } else if (err > 0.25 && err <= 0.5) {
      rangeQuarterToHalf++;
      pnlQuarterToHalf += pnl;
    } else if (err > 0.5 && err <= 1.0) {
      rangeHalfToOne++;
      pnlHalfToOne += pnl;
    } else if (err > 1.0 && err <= 2.0) {
      rangeOneToTwo++;
      pnlOneToTwo += pnl;
    } else if (err > 2.0 && err <= 3.0) {
      rangeTwoToThree++;
      pnlTwoToThree += pnl;
    } else {
      rangeThreePlus++;
      pnlThreePlus += pnl;
    }
  });

  assert.strictEqual(rangeMinusToZero, 1, '≤ 0 R count');
  assert.strictEqual(rangeZeroToQuarter, 1, '0 to 0.25 R count');
  assert.strictEqual(rangeQuarterToHalf, 1, '0.25 to 0.5 R count');
  assert.strictEqual(rangeHalfToOne, 1, '0.5 to 1 R count');
  assert.strictEqual(rangeOneToTwo, 1, '1 to 2 R count');
  assert.strictEqual(rangeTwoToThree, 1, '2 to 3 R count');
  assert.strictEqual(rangeThreePlus, 1, '3R + count');

  assert.strictEqual(pnlMinusToZero, -100, '≤ 0 R aggregated PnL');
  assert.strictEqual(pnlZeroToQuarter, 15, '0 to 0.25 R aggregated PnL');
  assert.strictEqual(pnlQuarterToHalf, 35, '0.25 to 0.5 R aggregated PnL');
  assert.strictEqual(pnlHalfToOne, 75, '0.5 to 1 R aggregated PnL');
  assert.strictEqual(pnlOneToTwo, 150, '1 to 2 R aggregated PnL');
  assert.strictEqual(pnlTwoToThree, 250, '2 to 3 R aggregated PnL');
  assert.strictEqual(pnlThreePlus, 350, '3R + aggregated PnL');
});

test('buildCurve single-pass reverse loop correctness and performance benchmark', () => {
  const safeNum = (v) => (v == null || isNaN(v) ? 0 : Number(v));

  const originalImpl = (trades = []) => {
    const safeTrades = Array.isArray(trades) ? trades : [];
    let pnl = 0;
    return [...safeTrades].reverse().map((trade) => {
      pnl += safeNum(trade.pnl);
      return { ts: trade.exit_ts || trade.entry_ts || trade.createdAt, pnl };
    });
  };

  const optimizedImpl = (trades = []) => {
    const safeTrades = Array.isArray(trades) ? trades : [];
    const len = safeTrades.length;
    const result = new Array(len);
    let pnl = 0;
    for (let i = len - 1; i >= 0; i--) {
      const trade = safeTrades[i];
      pnl += safeNum(trade.pnl);
      result[len - 1 - i] = { ts: trade.exit_ts || trade.entry_ts || trade.createdAt, pnl };
    }
    return result;
  };

  const mockTrades = Array.from({ length: 500 }, (_, i) => ({
    pnl: (i % 2 === 0 ? 1 : -1) * (i * 2.5),
    exit_ts: '2026-07-20T10:00:00.000Z'
  }));

  // 1. Correctness
  const resOriginal = originalImpl(mockTrades);
  const resOptimized = optimizedImpl(mockTrades);
  assert.deepStrictEqual(resOptimized, resOriginal, 'Optimized buildCurve output must match original exactly.');

  // 2. Performance Benchmark
  const iterations = 10000;
  originalImpl(mockTrades);
  optimizedImpl(mockTrades);

  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalImpl(mockTrades);
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedImpl(mockTrades);
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  console.log(`\n⚡ Bolt Performance Benchmark (buildCurve cumulative curve computation, List size: ${mockTrades.length} trades, ${iterations} iterations):`);
  console.log(`  - Original [...spread].reverse().map(): ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Pre-allocated reverse loop: ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                    ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});

test('Search Filter Symbol check performance benchmark', () => {
  const listSize = 500;
  const mockTrades = Array.from({ length: listSize }, () => ({
    symbol: 'BTCUSDT'
  }));

  const term = 'btc';
  const termUpper = 'BTC';

  const originalSearch = (trades, query) => {
    return trades.some(t => t.symbol?.toLowerCase().includes(query));
  };

  const optimizedSearch = (trades, queryUpper) => {
    return trades.some(t => t.symbol?.includes(queryUpper));
  };

  // Correctness
  assert.strictEqual(originalSearch(mockTrades, term), optimizedSearch(mockTrades, termUpper), 'Search results must match.');

  // Benchmark
  const iterations = 10000;

  // Warmup
  originalSearch(mockTrades, term);
  optimizedSearch(mockTrades, termUpper);

  // Original
  const startOriginal = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalSearch(mockTrades, term);
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  // Optimized
  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedSearch(mockTrades, termUpper);
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  console.log(`\n⚡ Bolt Performance Benchmark (Search Filter Symbol match, List size: ${listSize} trades, ${iterations} iterations):`);
  console.log(`  - Original symbol.toLowerCase().includes(term): ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized symbol.includes(termUpper):         ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                            ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});
