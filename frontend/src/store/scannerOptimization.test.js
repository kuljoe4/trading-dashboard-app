import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';

// Original quadratic approach
function originalFilterResults(results) {
  const sortedByVolume = [...results].sort((a, b) => (b.vol || 0) - (a.vol || 0));
  const sortedByChange = [...results].sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));

  return results.map(r => {
    const volIdx = sortedByVolume.findIndex(o => o.symbol === r.symbol);
    const chgIdx = sortedByChange.findIndex(o => o.symbol === r.symbol);
    return {
      ...r,
      volume_rank: volIdx !== -1 ? volIdx + 1 : r.volume_rank,
      change_rank: chgIdx !== -1 ? chgIdx + 1 : undefined
    };
  });
}

// Optimized linear Map-based approach
function optimizedFilterResults(results) {
  const sortedByVolume = [...results].sort((a, b) => (b.vol || 0) - (a.vol || 0));
  const sortedByChange = [...results].sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));

  const volRankMap = new Map();
  for (let i = 0; i < sortedByVolume.length; i++) {
    volRankMap.set(sortedByVolume[i].symbol, i + 1);
  }

  const chgRankMap = new Map();
  for (let i = 0; i < sortedByChange.length; i++) {
    chgRankMap.set(sortedByChange[i].symbol, i + 1);
  }

  return results.map(r => {
    const volRank = volRankMap.get(r.symbol);
    const chgRank = chgRankMap.get(r.symbol);
    return {
      ...r,
      volume_rank: volRank !== undefined ? volRank : r.volume_rank,
      change_rank: chgRank
    };
  });
}

test('optimizedFilterResults correctness test', () => {
  const results = [
    { symbol: 'BTCUSDT', vol: 5000, pct: 2.5 },
    { symbol: 'ETHUSDT', vol: 10000, pct: -1.2 },
    { symbol: 'SOLUSDT', vol: 2000, pct: 5.0 },
    { symbol: 'ADAUSDT', vol: 1000, pct: -0.5 },
  ];

  const original = originalFilterResults(results);
  const optimized = optimizedFilterResults(results);

  assert.deepStrictEqual(optimized, original, 'Optimized results must match original results exactly.');
});

test('optimizedFilterResults benchmark performance test', () => {
  const listSize = 300;
  const results = Array.from({ length: listSize }, (_, i) => ({
    symbol: `SYM-${i}USDT`,
    vol: Math.random() * 10000,
    pct: (Math.random() - 0.5) * 10
  }));

  // Warmup
  originalFilterResults(results);
  optimizedFilterResults(results);

  // Benchmark Original
  const startOriginal = performance.now();
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    originalFilterResults(results);
  }
  const endOriginal = performance.now();
  const originalDuration = endOriginal - startOriginal;

  // Benchmark Optimized
  const startOptimized = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedFilterResults(results);
  }
  const endOptimized = performance.now();
  const optimizedDuration = endOptimized - startOptimized;

  const originalResult = originalFilterResults(results);
  const optimizedResult = optimizedFilterResults(results);
  assert.deepStrictEqual(optimizedResult, originalResult, 'Verification inside benchmark: results must match.');

  console.log(`\n⚡ Bolt Performance Benchmark (List size: ${listSize} symbols, ${iterations} iterations):`);
  console.log(`  - Original findIndex-based Lookup: ${originalDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Map-based Lookup:       ${optimizedDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:                ${(originalDuration / Math.max(0.0001, optimizedDuration)).toFixed(1)}x faster`);
});
