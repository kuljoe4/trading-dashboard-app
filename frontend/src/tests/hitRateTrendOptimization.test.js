import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper simulating original multi-pass implementation
function originalHitRateTrendLogic(trades = []) {
  const rawTrades = Array.isArray(trades) ? trades : [];
  if (rawTrades.length < 2) return { points: [], viewMin: 0, viewMax: 100, viewRange: 100 };

  const count = rawTrades.length;
  const safeTrades = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = rawTrades[i];
    const exitTs = t?.exit_ts_ms !== undefined ? t.exit_ts_ms : (t?.exit_ts || t?.createdAt ? new Date(t.exit_ts || t.createdAt).getTime() : 0);
    safeTrades[i] = { trade: t, exitTs };
  }

  let isSortedAsc = true;
  let isSortedDesc = true;
  for (let i = 1; i < count; i++) {
    const current = safeTrades[i].exitTs;
    const prev = safeTrades[i - 1].exitTs;
    if (current < prev) isSortedAsc = false;
    if (current > prev) isSortedDesc = false;
  }

  if (isSortedDesc) {
    safeTrades.reverse();
  } else if (!isSortedAsc) {
    safeTrades.sort((a, b) => a.exitTs - b.exitTs);
  }

  let totalWins = 0;
  const rollingData = safeTrades.map(({ trade: t }, idx) => {
    const isWin = Number(t?.pnl || 0) > 0;
    if (isWin) totalWins++;
    const currentHitRate = (totalWins / (idx + 1)) * 100;
    return {
      tradeIndex: idx + 1,
      hitRate: currentHitRate,
      pnl: Number(t?.pnl || 0),
      symbol: t?.symbol,
      ts: t?.exit_ts_ms || (t?.exit_ts ? new Date(t.exit_ts).getTime() : 0)
    };
  });

  const values = rollingData.map(d => d.hitRate);
  const min = Math.max(0, Math.min(...values) - 5);
  const max = Math.min(100, Math.max(...values) + 5);
  const range = Math.max(10, max - min);

  const pts = rollingData.map((d, i) => {
    const x = (i / (rollingData.length - 1)) * 100;
    const y = 100 - ((d.hitRate - min) / range) * 100;
    return { x, y, hitRate: d.hitRate, tradeIndex: d.tradeIndex, symbol: d.symbol, pnl: d.pnl, ts: d.ts };
  });

  return { points: pts, viewMin: min, viewMax: max, viewRange: range };
}

// Helper simulating optimized single-pass implementation
function optimizedHitRateTrendLogic(trades = []) {
  const rawTrades = Array.isArray(trades) ? trades : [];
  const count = rawTrades.length;
  if (count < 2) return { points: [], viewMin: 0, viewMax: 100, viewRange: 100 };

  const getTs = (t) => (t?.exit_ts_ms !== undefined ? t.exit_ts_ms : (t?.exit_ts || t?.createdAt ? new Date(t.exit_ts || t.createdAt).getTime() : 0));

  let safeTrades = rawTrades;
  let isSortedAsc = true;
  let isSortedDesc = true;

  let prevTs = getTs(rawTrades[0]);
  for (let i = 1; i < count; i++) {
    const curTs = getTs(rawTrades[i]);
    if (curTs < prevTs) isSortedAsc = false;
    if (curTs > prevTs) isSortedDesc = false;
    prevTs = curTs;
  }

  if (!isSortedAsc) {
    safeTrades = rawTrades.slice();
    if (isSortedDesc) {
      safeTrades.reverse();
    } else {
      safeTrades.sort((a, b) => getTs(a) - getTs(b));
    }
  }

  let totalWins = 0;
  let minHitRate = Infinity;
  let maxHitRate = -Infinity;
  const pts = new Array(count);

  for (let i = 0; i < count; i++) {
    const t = safeTrades[i];
    const pnl = Number(t?.pnl || 0);
    if (pnl > 0) totalWins++;
    const hitRate = (totalWins / (i + 1)) * 100;
    if (hitRate < minHitRate) minHitRate = hitRate;
    if (hitRate > maxHitRate) maxHitRate = hitRate;

    pts[i] = {
      x: 0,
      y: 0,
      hitRate,
      tradeIndex: i + 1,
      symbol: t?.symbol,
      pnl,
      ts: t?.exit_ts_ms || (t?.exit_ts ? new Date(t.exit_ts).getTime() : 0)
    };
  }

  const min = Math.max(0, minHitRate - 5);
  const max = Math.min(100, maxHitRate + 5);
  const range = Math.max(10, max - min);
  const denom = count - 1;

  for (let i = 0; i < count; i++) {
    const pt = pts[i];
    pt.x = (i / denom) * 100;
    pt.y = 100 - ((pt.hitRate - min) / range) * 100;
  }

  return { points: pts, viewMin: min, viewMax: max, viewRange: range };
}

describe('HitRateTrend Single-Pass Loop Fusion & Bounds Tracking Optimization Tests', () => {
  test('handles empty, single-item, or non-array inputs identically', () => {
    const testInputs = [undefined, null, [], [ { id: 't1', pnl: 10 } ], 'invalid'];

    for (const input of testInputs) {
      const orig = originalHitRateTrendLogic(input);
      const opt = optimizedHitRateTrendLogic(input);

      assert.deepEqual(opt, orig);
    }
  });

  test('verifies exact calculation parity for sorted, reverse-sorted, and unordered trade arrays', () => {
    const baseTs = 1700000000000;
    const sortedTrades = [
      { id: 't1', pnl: 100, symbol: 'BTCUSDT', exit_ts_ms: baseTs },
      { id: 't2', pnl: -50, symbol: 'ETHUSDT', exit_ts_ms: baseTs + 1000 },
      { id: 't3', pnl: 200, symbol: 'SOLUSDT', exit_ts_ms: baseTs + 2000 },
      { id: 't4', pnl: -20, symbol: 'BNBUSDT', exit_ts_ms: baseTs + 3000 },
      { id: 't5', pnl: 150, symbol: 'ADAUSDT', exit_ts_ms: baseTs + 4000 }
    ];

    const reverseTrades = [...sortedTrades].reverse();
    const unorderedTrades = [sortedTrades[2], sortedTrades[0], sortedTrades[4], sortedTrades[1], sortedTrades[3]];

    for (const input of [sortedTrades, reverseTrades, unorderedTrades]) {
      const orig = originalHitRateTrendLogic(input);
      const opt = optimizedHitRateTrendLogic(input);

      assert.equal(opt.viewMin, orig.viewMin);
      assert.equal(opt.viewMax, orig.viewMax);
      assert.equal(opt.viewRange, orig.viewRange);
      assert.equal(opt.points.length, orig.points.length);

      for (let i = 0; i < orig.points.length; i++) {
        assert.equal(opt.points[i].x, orig.points[i].x);
        assert.equal(opt.points[i].y, orig.points[i].y);
        assert.equal(opt.points[i].hitRate, orig.points[i].hitRate);
        assert.equal(opt.points[i].tradeIndex, orig.points[i].tradeIndex);
        assert.equal(opt.points[i].pnl, orig.points[i].pnl);
        assert.equal(opt.points[i].symbol, orig.points[i].symbol);
        assert.equal(opt.points[i].ts, orig.points[i].ts);
      }
    }
  });

  test('benchmark: single-pass loop vs multi-pass functional chaining', () => {
    const dataset = Array.from({ length: 500 }, (_, i) => ({
      id: `trade-${i}`,
      pnl: (i % 3 === 0) ? -50 : 100,
      symbol: i % 2 === 0 ? 'BTCUSDT' : 'ETHUSDT',
      exit_ts_ms: 1700000000000 + i * 60000
    }));

    const iterations = 20_000;

    // Warmup
    for (let i = 0; i < 500; i++) {
      originalHitRateTrendLogic(dataset);
      optimizedHitRateTrendLogic(dataset);
    }

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      originalHitRateTrendLogic(dataset);
    }
    const t1 = performance.now();
    const origTime = t1 - t0;

    const t2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      optimizedHitRateTrendLogic(dataset);
    }
    const t3 = performance.now();
    const optTime = t3 - t2;

    const speedup = origTime / optTime;

    console.log(`\n⚡ Bolt Performance Benchmark (HitRateTrend single-pass loop, ${iterations} iterations):`);
    console.log(`  - Original (Multi-pass map/sort/spread): ${origTime.toFixed(2)} ms`);
    console.log(`  - Optimized (Single-pass loop fusion):   ${optTime.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                    ${speedup.toFixed(2)}x faster`);

    assert.ok(optTime < origTime, 'Optimized single-pass loop should execute faster than multi-pass chaining');
  });
});
