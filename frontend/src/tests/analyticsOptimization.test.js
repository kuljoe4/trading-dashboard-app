import '../store/mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';

function originalGrouping(rawItems, count) {
  const bucketCount = Math.min(30, Math.max(12, Math.floor(count / 3)));
  const groupSize = count / bucketCount;
  const grouped = [];

  for (let g = 0; g < bucketCount; g++) {
    const startIdx = Math.floor(g * groupSize);
    const endIdx = g === bucketCount - 1 ? count : Math.floor((g + 1) * groupSize);
    const chunk = rawItems.slice(startIdx, endIdx);
    if (chunk.length === 0) continue;

    const lastItem = chunk[chunk.length - 1];
    let chunkPnl = 0;
    let chunkWins = 0;
    let chunkLosses = 0;
    const symbolSet = new Set();

    chunk.forEach(ci => {
      const p = Number(ci.trade?.pnl || 0);
      chunkPnl += p;
      if (p > 0) chunkWins++;
      else if (p < 0) chunkLosses++;
      if (ci.trade?.symbol) symbolSet.add(ci.trade.symbol);
    });

    grouped.push({
      trade: {
        ...lastItem.trade,
        pnl: chunkPnl,
        symbol: symbolSet.size === 1 ? Array.from(symbolSet)[0] : `${symbolSet.size} Pairs`,
        strategy: `${chunk.length} Trades Group`
      },
      exitTs: lastItem.exitTs,
      entryTs: chunk[0].entryTs,
      isBucket: true,
      bucketTradeCount: chunk.length,
      bucketWins: chunkWins,
      bucketLosses: chunkLosses,
      bucketPnl: chunkPnl
    });
  }
  return grouped;
}

function optimizedGrouping(rawItems, count) {
  const bucketCount = Math.min(30, Math.max(12, Math.floor(count / 3)));
  const groupSize = count / bucketCount;
  const grouped = [];

  for (let g = 0; g < bucketCount; g++) {
    const startIdx = Math.floor(g * groupSize);
    const endIdx = g === bucketCount - 1 ? count : Math.floor((g + 1) * groupSize);
    const chunkLength = endIdx - startIdx;
    if (chunkLength === 0) continue;

    const lastItem = rawItems[endIdx - 1];
    let chunkPnl = 0;
    let chunkWins = 0;
    let chunkLosses = 0;
    const symbolSet = new Set();

    for (let i = startIdx; i < endIdx; i++) {
      const ci = rawItems[i];
      const p = Number(ci.trade?.pnl || 0);
      chunkPnl += p;
      if (p > 0) chunkWins++;
      else if (p < 0) chunkLosses++;
      if (ci.trade?.symbol) symbolSet.add(ci.trade.symbol);
    }

    grouped.push({
      trade: {
        ...lastItem.trade,
        pnl: chunkPnl,
        symbol: symbolSet.size === 1 ? Array.from(symbolSet)[0] : `${symbolSet.size} Pairs`,
        strategy: `${chunkLength} Trades Group`
      },
      exitTs: lastItem.exitTs,
      entryTs: rawItems[startIdx].entryTs,
      isBucket: true,
      bucketTradeCount: chunkLength,
      bucketWins: chunkWins,
      bucketLosses: chunkLosses,
      bucketPnl: chunkPnl
    });
  }
  return grouped;
}

test('Analytics Grouping Optimization: Correctness and Performance', () => {
  const size = 1500;
  const rawItems = Array.from({ length: size }, (_, i) => ({
    trade: {
      pnl: (Math.random() - 0.4) * 100,
      symbol: i % 2 === 0 ? 'BTCUSDT' : 'ETHUSDT'
    },
    exitTs: Date.now() - (size - i) * 60000,
    entryTs: Date.now() - (size - i + 1) * 60000
  }));

  const resOriginal = originalGrouping(rawItems, size);
  const resOptimized = optimizedGrouping(rawItems, size);

  assert.deepStrictEqual(resOptimized, resOriginal, 'Both implementations must return identical values');

  const iterations = 5000;

  const startOrig = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalGrouping(rawItems, size);
  }
  const endOrig = performance.now();

  const startOpt = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedGrouping(rawItems, size);
  }
  const endOpt = performance.now();

  const origDuration = endOrig - startOrig;
  const optDuration = endOpt - startOpt;

  console.log(`\n⚡ Bolt Performance Benchmark (Analytics Grouping, List size: ${size}, ${iterations} iterations):`);
  console.log(`  - Original (slice + forEach):  ${origDuration.toFixed(4)} ms`);
  console.log(`  - Optimized (for loop):        ${optDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:           ${(origDuration / Math.max(0.0001, optDuration)).toFixed(1)}x faster`);
});
