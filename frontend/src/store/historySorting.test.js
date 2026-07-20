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
