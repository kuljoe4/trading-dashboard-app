import { test } from 'node:test';
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';

// Simulate frontend/src/views/HistoryView.jsx modeTrades hook behavior
const mockTradeHistory = [];
const now = Date.now();
for (let i = 0; i < 5000; i++) {
  mockTradeHistory.push({
    id: `trade_${i}`,
    paperMode: i % 2 === 0,
    trading_mode: 'live',
    exit_ts_ms: now - (i * 10000) // Some within 24h, some older
  });
}

function originalApproach(tradeHistory, lifetimeMode, timeRange, tradeLimit) {
    let cutoff = 0;
    if (timeRange === '24H') cutoff = now - 24 * 60 * 60 * 1000;
    else if (timeRange === '7D') cutoff = now - 7 * 24 * 60 * 60 * 1000;
    else if (timeRange === '30D') cutoff = now - 30 * 24 * 60 * 60 * 1000;

    let filtered = (tradeHistory || []).filter(Boolean).filter(t => {
      const mode = t.paperMode || t.paper_mode ? 'paper' : (t.trading_mode || 'live');
      if (mode !== lifetimeMode) return false;

      if (cutoff > 0) {
        const exitTs = t.exit_ts_ms || (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
        if (exitTs < cutoff) return false;
      }
      return true;
    });

    if (tradeLimit && tradeLimit !== 'ALL') {
      filtered = filtered.slice(0, Number(tradeLimit));
    }
    return filtered;
}

function optimizedApproach(tradeHistory, lifetimeMode, timeRange, tradeLimit) {
    let cutoff = 0;
    if (timeRange === '24H') cutoff = now - 24 * 60 * 60 * 1000;
    else if (timeRange === '7D') cutoff = now - 7 * 24 * 60 * 60 * 1000;
    else if (timeRange === '30D') cutoff = now - 30 * 24 * 60 * 60 * 1000;

    const arr = tradeHistory || [];
    const limit = tradeLimit && tradeLimit !== 'ALL' ? Number(tradeLimit) : Infinity;
    const filtered = [];

    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (!t) continue;

      const mode = t.paperMode || t.paper_mode ? 'paper' : (t.trading_mode || 'live');
      if (mode !== lifetimeMode) continue;

      if (cutoff > 0) {
        const exitTs = t.exit_ts_ms || (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
        if (exitTs < cutoff) continue;
      }

      filtered.push(t);
      if (filtered.length >= limit) break;
    }

    return filtered;
}

test('HistoryView modeTrades filtering bottleneck optimization', (t) => {
  // Correctness
  const resOriginal = originalApproach(mockTradeHistory, 'paper', '7D', '50');
  const resOptimized = optimizedApproach(mockTradeHistory, 'paper', '7D', '50');
  assert.deepStrictEqual(resOptimized, resOriginal, 'Optimized output must match original output');

  // Performance Benchmark
  const ITERS = 2000;

  let start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    originalApproach(mockTradeHistory, 'paper', '7D', '50');
  }
  const originalDuration = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    optimizedApproach(mockTradeHistory, 'paper', '7D', '50');
  }
  const optimizedDuration = performance.now() - start;

  console.log(`\n⚡ Bolt Performance Benchmark (HistoryView modeTrades filtering, List size: ${mockTradeHistory.length}, ${ITERS} iterations):`);
  console.log(`  - Original Multi-pass (.filter(Boolean).filter().slice()): ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Single-pass (for loop with early break):         ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                                         ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});
