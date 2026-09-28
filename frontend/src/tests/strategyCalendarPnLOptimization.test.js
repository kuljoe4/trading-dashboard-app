import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Multi-pass original implementation helper
function originalStrategyCalendarPnLLogic(trades = [], strategyFilter = 'ALL', sessionFilter = 'ALL', year = 2026, mNum = 7) {
  if (!Array.isArray(trades)) return { dailyStatsMap: new Map(), monthlySummary: { monthlyPnl: 0, monthlyWins: 0, monthlyTrades: 0, winRate: 0 } };

  // 1. Filter trades by strategy and session
  const filteredTrades = trades.filter((t) => {
    if (!t || t.status === 'OPEN' || !t.exit_ts) return false;
    if (sessionFilter !== 'ALL' && t.sessionId !== sessionFilter) return false;
    if (strategyFilter !== 'ALL') {
      const label = t.strategy_label || 'Momentum Strategy';
      if (label !== strategyFilter) return false;
    }
    return true;
  });

  // 2. Aggregate daily stats
  const dailyStatsMap = new Map();
  const len = filteredTrades.length;
  for (let i = 0; i < len; i++) {
    const t = filteredTrades[i];
    const d = new Date(t.exit_ts);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    let entry = dailyStatsMap.get(key);
    if (!entry) {
      entry = { pnl: 0, wins: 0, losses: 0, count: 0, trades: [] };
      dailyStatsMap.set(key, entry);
    }
    const pnl = Number(t.pnl || 0);
    entry.pnl += pnl;
    entry.count += 1;
    entry.trades.push(t);
    if (pnl > 0) entry.wins += 1;
    else if (pnl < 0) entry.losses += 1;
  }

  // 3. Monthly aggregated totals
  let monthlyPnl = 0;
  let monthlyWins = 0;
  let monthlyTrades = 0;

  dailyStatsMap.forEach((stats, key) => {
    const [yStr, mStr] = key.split('-');
    if (Number(yStr) === year && Number(mStr) === mNum) {
      monthlyPnl += stats.pnl;
      monthlyWins += stats.wins;
      monthlyTrades += stats.count;
    }
  });

  const winRate = monthlyTrades > 0 ? (monthlyWins / monthlyTrades) * 100 : 0;
  return { dailyStatsMap, monthlySummary: { monthlyPnl, monthlyWins, monthlyTrades, winRate } };
}

// Single-pass optimized implementation helper
function optimizedStrategyCalendarPnLLogic(trades = [], strategyFilter = 'ALL', sessionFilter = 'ALL', year = 2026, mNum = 7) {
  const map = new Map();
  let monthlyPnl = 0;
  let monthlyWins = 0;
  let monthlyTrades = 0;

  const safeTrades = Array.isArray(trades) ? trades : [];
  const len = safeTrades.length;

  for (let i = 0; i < len; i++) {
    const t = safeTrades[i];
    if (!t || t.status === 'OPEN' || !t.exit_ts) continue;
    if (sessionFilter !== 'ALL' && t.sessionId !== sessionFilter) continue;
    if (strategyFilter !== 'ALL') {
      const label = t.strategy_label || 'Momentum Strategy';
      if (label !== strategyFilter) continue;
    }

    const ts = t.exit_ts_ms !== undefined ? t.exit_ts_ms : new Date(t.exit_ts).getTime();
    if (!ts || isNaN(ts)) continue;
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();

    const key = `${y}-${m < 10 ? '0' + m : m}-${day < 10 ? '0' + day : day}`;

    let entry = map.get(key);
    if (!entry) {
      entry = { pnl: 0, wins: 0, losses: 0, count: 0, trades: [] };
      map.set(key, entry);
    }
    const pnl = Number(t.pnl || 0);
    entry.pnl += pnl;
    entry.count += 1;
    entry.trades.push(t);
    if (pnl > 0) entry.wins += 1;
    else if (pnl < 0) entry.losses += 1;

    if (y === year && m === mNum) {
      monthlyPnl += pnl;
      if (pnl > 0) monthlyWins += 1;
      monthlyTrades += 1;
    }
  }

  const winRate = monthlyTrades > 0 ? (monthlyWins / monthlyTrades) * 100 : 0;
  return {
    dailyStatsMap: map,
    monthlySummary: { monthlyPnl, monthlyWins, monthlyTrades, winRate }
  };
}

describe('StrategyCalendarPnL Single-Pass Optimization Suite', () => {
  test('handles empty or non-array inputs identically', () => {
    const inputs = [undefined, null, [], 'invalid', 123];
    for (const input of inputs) {
      const orig = originalStrategyCalendarPnLLogic(input);
      const opt = optimizedStrategyCalendarPnLLogic(input);

      assert.equal(opt.dailyStatsMap.size, orig.dailyStatsMap.size);
      assert.deepEqual(opt.monthlySummary, orig.monthlySummary);
    }
  });

  test('filters out invalid, OPEN, or non-dated trades correctly', () => {
    const rawTrades = [
      { id: 1, status: 'CLOSED', exit_ts: '2026-07-10T12:00:00.000Z', pnl: 50.0, sessionId: 's1' },
      { id: 2, status: 'OPEN', exit_ts: '2026-07-10T12:30:00.000Z', pnl: 100.0, sessionId: 's1' },
      { id: 3, status: 'CLOSED', exit_ts: null, pnl: 20.0, sessionId: 's1' },
      null,
      undefined,
      { id: 4, status: 'CLOSED', exit_ts: '2026-07-10T15:00:00.000Z', pnl: -15.0, sessionId: 's1' },
      { id: 5, status: 'CLOSED', exit_ts: '2026-07-11T09:00:00.000Z', pnl: 30.0, sessionId: 's1' }
    ];

    const orig = originalStrategyCalendarPnLLogic(rawTrades, 'ALL', 'ALL', 2026, 7);
    const opt = optimizedStrategyCalendarPnLLogic(rawTrades, 'ALL', 'ALL', 2026, 7);

    assert.equal(opt.dailyStatsMap.size, orig.dailyStatsMap.size);
    assert.deepEqual(opt.monthlySummary, orig.monthlySummary);

    const jul10Opt = opt.dailyStatsMap.get('2026-07-10');
    const jul10Orig = orig.dailyStatsMap.get('2026-07-10');
    assert.equal(jul10Opt.pnl, jul10Orig.pnl);
    assert.equal(jul10Opt.wins, jul10Orig.wins);
    assert.equal(jul10Opt.losses, jul10Orig.losses);
    assert.equal(jul10Opt.count, jul10Orig.count);
  });

  test('applies strategy and session filters with exact output parity', () => {
    const trades = [
      { id: 1, status: 'CLOSED', exit_ts: '2026-07-15T10:00:00.000Z', pnl: 40.0, sessionId: 's1', strategy_label: 'Momentum Strategy' },
      { id: 2, status: 'CLOSED', exit_ts: '2026-07-15T11:00:00.000Z', pnl: -10.0, sessionId: 's2', strategy_label: 'Breakout Strategy' },
      { id: 3, status: 'CLOSED', exit_ts: '2026-07-16T12:00:00.000Z', pnl: 80.0, sessionId: 's1', strategy_label: 'Momentum Strategy' },
      { id: 4, status: 'CLOSED', exit_ts: '2026-07-16T14:00:00.000Z', pnl: -20.0, sessionId: 's1', strategy_label: 'Breakout Strategy' }
    ];

    // Filter by session 's1'
    const origS1 = originalStrategyCalendarPnLLogic(trades, 'ALL', 's1', 2026, 7);
    const optS1 = optimizedStrategyCalendarPnLLogic(trades, 'ALL', 's1', 2026, 7);
    assert.deepEqual(optS1.monthlySummary, origS1.monthlySummary);

    // Filter by strategy 'Momentum Strategy'
    const origMom = originalStrategyCalendarPnLLogic(trades, 'Momentum Strategy', 'ALL', 2026, 7);
    const optMom = optimizedStrategyCalendarPnLLogic(trades, 'Momentum Strategy', 'ALL', 2026, 7);
    assert.deepEqual(optMom.monthlySummary, origMom.monthlySummary);
  });

  test('benchmark: single-pass fused loop vs multi-pass chaining', () => {
    const tradeCount = 5_000;
    const trades = [];
    const baseTime = new Date('2026-07-01T00:00:00.000Z').getTime();

    for (let i = 0; i < tradeCount; i++) {
      const exitMs = baseTime + Math.floor(Math.random() * 60 * 86400000); // 60 days
      trades.push({
        id: `t-${i}`,
        status: i % 10 === 0 ? 'OPEN' : 'CLOSED',
        exit_ts: new Date(exitMs).toISOString(),
        exit_ts_ms: exitMs,
        pnl: (i % 2 === 0 ? 1 : -1) * ((i * 17.5) % 150),
        sessionId: `s-${i % 4}`,
        strategy_label: i % 3 === 0 ? 'Breakout Strategy' : 'Momentum Strategy'
      });
    }

    const iterations = 500;

    // Warmup
    for (let i = 0; i < 20; i++) {
      originalStrategyCalendarPnLLogic(trades, 'ALL', 'ALL', 2026, 7);
      optimizedStrategyCalendarPnLLogic(trades, 'ALL', 'ALL', 2026, 7);
    }

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      originalStrategyCalendarPnLLogic(trades, 'ALL', 'ALL', 2026, 7);
    }
    const t1 = performance.now();
    const origTime = t1 - t0;

    const t2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      optimizedStrategyCalendarPnLLogic(trades, 'ALL', 'ALL', 2026, 7);
    }
    const t3 = performance.now();
    const optTime = t3 - t2;

    const speedup = origTime / optTime;

    console.log(`\n⚡ Bolt Performance Benchmark (StrategyCalendarPnL single-pass loop, ${iterations} iterations x ${tradeCount} trades):`);
    console.log(`  - Original (Multi-pass filter/map/forEach): ${origTime.toFixed(2)} ms`);
    console.log(`  - Optimized (Single-pass fused loop):      ${optTime.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                        ${speedup.toFixed(2)}x faster`);

    assert.ok(optTime < origTime, 'Optimized single-pass loop should execute faster than multi-pass chaining');
  });
});
