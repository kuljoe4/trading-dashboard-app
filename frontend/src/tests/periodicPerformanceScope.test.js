import '../store/mock-env.js';
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERIODIC_TIMEFRAME_LIMITS,
  getPeriodicFetchLimit,
  resolveAdaptivePeriodicLimit,
  resolveAdaptiveHistoryTradeLimit,
  resolveAdaptiveSessionLimit,
  isClosedValidTrade,
  computePeriodicBuckets,
  computePeriodBadges
} from '../utils/periodicPerformance.js';
import { useTradingStore } from '../store/trading.js';
import { sessionAPI } from '../api/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Periodic Performance Consistency, Adaptive Limits & Scope Isolation', () => {
  test('Fallback horizon limits scale monotonically when server closedCounts are unavailable', () => {
    assert.strictEqual(getPeriodicFetchLimit('7D'), 250);
    assert.strictEqual(getPeriodicFetchLimit('14D'), 500);
    assert.strictEqual(getPeriodicFetchLimit('4W'), 1000);
    assert.strictEqual(getPeriodicFetchLimit('6M'), 3000);
    assert.strictEqual(getPeriodicFetchLimit('1Y'), 5000);
    assert.ok(PERIODIC_TIMEFRAME_LIMITS['1Y'] > PERIODIC_TIMEFRAME_LIMITS['6M']);
    assert.ok(PERIODIC_TIMEFRAME_LIMITS['6M'] > PERIODIC_TIMEFRAME_LIMITS['4W']);
    assert.ok(PERIODIC_TIMEFRAME_LIMITS['4W'] > PERIODIC_TIMEFRAME_LIMITS['14D']);
    assert.ok(PERIODIC_TIMEFRAME_LIMITS['14D'] > PERIODIC_TIMEFRAME_LIMITS['7D']);

    const fallback = resolveAdaptivePeriodicLimit('6M', null);
    assert.deepStrictEqual(fallback, { limit: 3000, actualCount: null, isKnown: false });
  });

  test('resolveAdaptivePeriodicLimit uses actual closed trade counts instead of fixed guesses', () => {
    const busyCounts = {
      total: 9500,
      '7D': 420,
      '14D': 810,
      '4W': 1250,
      '30D': 1250,
      '6M': 4200,
      '1Y': 8400,
    };

    // Short horizon covers both bucket count and 30D quick badge
    assert.deepStrictEqual(resolveAdaptivePeriodicLimit('7D', busyCounts), {
      limit: 1250,
      actualCount: 1250,
      isKnown: true,
    });
    // Long horizons expand cleanly above legacy 3000/5000 caps using actual closed count
    assert.deepStrictEqual(resolveAdaptivePeriodicLimit('6M', busyCounts), {
      limit: 4200,
      actualCount: 4200,
      isKnown: true,
    });
    assert.deepStrictEqual(resolveAdaptivePeriodicLimit('1Y', busyCounts), {
      limit: 8400,
      actualCount: 8400,
      isKnown: true,
    });

    // Low-volume history shrinks to exact closed trade count (minimum query limit 1)
    const lowVol = { total: 18, '7D': 4, '14D': 9, '4W': 12, '30D': 12, '6M': 18, '1Y': 18 };
    assert.deepStrictEqual(resolveAdaptivePeriodicLimit('6M', lowVol), {
      limit: 18,
      actualCount: 18,
      isKnown: true,
    });

    const zeroTrades = { total: 0, '7D': 0, '30D': 0, '1Y': 0 };
    assert.deepStrictEqual(resolveAdaptivePeriodicLimit('7D', zeroTrades), {
      limit: 1,
      actualCount: 0,
      isKnown: true,
    });
  });

  test('resolveAdaptiveHistoryTradeLimit and resolveAdaptiveSessionLimit adapt dynamically to server counts', () => {
    const counts = { total: 340, '7D': 22, '30D': 95 };
    assert.deepStrictEqual(resolveAdaptiveHistoryTradeLimit('AUTO', '7D', counts), {
      limit: 22,
      actualCount: 22,
      totalCount: 340,
      isKnown: true,
      isAdaptive: true,
    });
    assert.deepStrictEqual(resolveAdaptiveHistoryTradeLimit('AUTO', '30D', counts), {
      limit: 95,
      actualCount: 95,
      totalCount: 340,
      isKnown: true,
      isAdaptive: true,
    });
    assert.deepStrictEqual(resolveAdaptiveHistoryTradeLimit('AUTO', 'ALL', counts), {
      limit: 340,
      actualCount: 340,
      totalCount: 340,
      isKnown: true,
      isAdaptive: true,
    });
    // Manual numeric limit caps cleanly at known total to avoid over-fetching
    assert.strictEqual(resolveAdaptiveHistoryTradeLimit(1000, 'ALL', { total: 42, '7D': 12, '30D': 42 }).limit, 42);
    assert.strictEqual(resolveAdaptiveHistoryTradeLimit('AUTO', '24H', null).limit, 250);

    // Adaptive session limits: <= 200 total fetches all cleanly so non-dominant modes (e.g. live) are never hidden
    const mixedSess = { total: 145, paper: 120, testnet: 10, live: 15 };
    assert.deepStrictEqual(resolveAdaptiveSessionLimit('AUTO', mixedSess, 'live', 10), {
      limit: 145,
      modeCount: 15,
      totalCount: 145,
      isKnown: true,
      isAdaptive: true,
    });

    // Multi-hundred session DB pages incrementally by visibleCount * 3 (min 40, capped at 500)
    const largeSess = { total: 420, paper: 380, testnet: 15, live: 25 };
    assert.strictEqual(resolveAdaptiveSessionLimit('AUTO', largeSess, 'live', 10).limit, 40);
    assert.strictEqual(resolveAdaptiveSessionLimit('AUTO', largeSess, 'live', 20).limit, 60);
    assert.strictEqual(resolveAdaptiveSessionLimit('AUTO', largeSess, 'live', 30).limit, 90);
    assert.strictEqual(resolveAdaptiveSessionLimit('ALL', largeSess, 'live', 10).limit, 420);
    assert.strictEqual(resolveAdaptiveSessionLimit(50, mixedSess, 'paper', 10).limit, 50);
  });

  test('isClosedValidTrade excludes OPEN, ENTRY_FAILED, reconciliations, and mismatched modes', () => {
    assert.strictEqual(isClosedValidTrade({ status: 'OPEN', pnl: 10, trading_mode: 'paper' }, 'paper'), false);
    assert.strictEqual(isClosedValidTrade({ status: 'ENTRY_FAILED', pnl: -5, trading_mode: 'paper' }, 'paper'), false);
    assert.strictEqual(isClosedValidTrade({ status: 'CLOSED', pnl: 15, is_reconciliation: true, trading_mode: 'paper' }, 'paper'), false);
    assert.strictEqual(isClosedValidTrade({ status: 'CLOSED', pnl: 15, trading_mode: 'live' }, 'paper'), false);
    assert.strictEqual(isClosedValidTrade({ status: 'CLOSED_TP', pnl: 25, trading_mode: 'paper' }, 'paper'), true);
    assert.strictEqual(isClosedValidTrade({ status: 'CLOSED_SL', pnl: -12, paper_mode: false, trading_mode: 'testnet' }, 'testnet'), true);
  });

  test('7D period badge mathematically matches 7D periodic buckets Net total across midnight boundaries', () => {
    const fixedNow = new Date(2026, 6, 15, 14, 30, 0).getTime();
    const trades = [
      { id: 't1', status: 'CLOSED_TP', pnl: 40, exit_ts_ms: new Date(2026, 6, 15, 9, 0, 0).getTime() }, // today
      { id: 't2', status: 'CLOSED_SL', pnl: -15, exit_ts_ms: new Date(2026, 6, 9, 1, 0, 0).getTime() }, // 6 days ago (earliest in 7D)
      { id: 't3', status: 'CLOSED_TP', pnl: 99, exit_ts_ms: new Date(2026, 6, 8, 22, 0, 0).getTime() }, // 7 days ago -> outside 7D calendar window, inside 30D
    ];

    const { buckets } = computePeriodicBuckets({ trades, timeframe: '7D', nowTs: fixedNow });
    const badges = computePeriodBadges({ trades, nowTs: fixedNow });

    const barSum = buckets.reduce((acc, b) => acc + b.pnl, 0);
    assert.strictEqual(badges.today, 40);
    assert.strictEqual(badges.d7, 25);
    assert.strictEqual(barSum, badges.d7);
    assert.strictEqual(badges.d30, 124);
  });

  test('DashboardView renders mobile-first All Sessions / Session scope toggle and wires sessionTradeHistory', () => {
    const src = fs.readFileSync(path.join(__dirname, '../views/DashboardView.jsx'), 'utf-8');
    assert.ok(src.includes('aria-label="Periodic performance scope"'));
    assert.ok(src.includes('All Sessions'));
    assert.ok(src.includes('This Session'));
    assert.ok(src.includes('Last Session'));
    assert.ok(src.includes('sessionTradeHistory'));
    assert.ok(src.includes('resolveAdaptivePeriodicLimit(periodicTimeframe'));
  });

  test('HistoryView enforces adaptive session/trade limits, lazy collapsed computation, and mobile-first clean cards', () => {
    const src = fs.readFileSync(path.join(__dirname, '../views/HistoryView.jsx'), 'utf-8');
    assert.ok(src.includes('resolveAdaptiveHistoryTradeLimit'));
    assert.ok(src.includes('resolveAdaptiveSessionLimit'));
    assert.ok(src.includes('use adaptive session history limit'.toLowerCase()) || src.includes('Use adaptive session history limit'));
    assert.ok(src.includes('use adaptive trade history limit'.toLowerCase()) || src.includes('Use adaptive trade history limit'));
    assert.ok(src.includes('if (!expanded)'));
    assert.ok(src.includes('allSessionsLoaded'));
    assert.ok(src.includes('grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/15 tabular-nums'));
    assert.ok(src.includes('min-h-[38px]') || src.includes('min-h-[40px]'));
    assert.ok(!src.includes('border-l-[5px]'), 'Session cards should avoid heavy left accent stripe noise');
  });

  test('Trading store hydrates server sessionCounts and trade closedCounts while preserving legacy array responses', async () => {
    const origHistoryApi = sessionAPI.history;
    const origListApi = sessionAPI.list;
    const historyCalls = [];
    const listCalls = [];
    sessionAPI.history = async (sid, limit) => {
      historyCalls.push({ sid, limit });
      if (sid === 'all') {
        return {
          data: {
            totalCount: 6420,
            closedCounts: { total: 6420, '7D': 140, '14D': 280, '4W': 610, '30D': 610, '6M': 3900, '1Y': 6420 },
            trades: [
              { id: 'all-1', sessionId: 'sess-old', symbol: 'BTCUSDT', status: 'CLOSED_TP', pnl: 50, exit_ts: '2026-07-10T10:00:00Z', trading_mode: 'paper' },
              { id: 'all-2', sessionId: 'sess-cur', symbol: 'ETHUSDT', status: 'CLOSED_TP', pnl: 20, exit_ts: '2026-07-15T10:00:00Z', trading_mode: 'paper' },
            ]
          }
        };
      }
      return {
        data: {
          totalCount: 15,
          closedCounts: { total: 15, '7D': 15, '14D': 15, '4W': 15, '30D': 15, '6M': 15, '1Y': 15 },
          trades: [
            { id: 'all-2', sessionId: 'sess-cur', symbol: 'ETHUSDT', status: 'CLOSED_TP', pnl: 20, exit_ts: '2026-07-15T10:00:00Z', trading_mode: 'paper' },
          ]
        }
      };
    };

    sessionAPI.list = async (limit, withCounts) => {
      listCalls.push({ limit, withCounts });
      return {
        data: {
          totalCount: 85,
          sessionCounts: { total: 85, paper: 60, testnet: 5, live: 20 },
          sessions: [
            { id: 's1', startTime: '2026-07-15T09:00:00Z', paperMode: true, totalPnl: 120 },
            { id: 's2', startTime: '2026-07-14T09:00:00Z', paperMode: false, totalPnl: -30, config: { trading_mode: 'live' } },
          ]
        }
      };
    };

    try {
      await useTradingStore.getState().fetchTradeHistory('all', 610);
      assert.strictEqual(useTradingStore.getState().historyLimit, 610);
      assert.strictEqual(useTradingStore.getState().tradeHistory.length, 2);
      assert.strictEqual(useTradingStore.getState().tradeHistoryCounts['1Y'], 6420);

      // Subsequent call without explicit limit uses actual known total (6420)
      await useTradingStore.getState().fetchTradeHistory('all');
      assert.strictEqual(historyCalls[1].limit, 6420);

      // Session-scoped fetch stores into sessionTradeHistory & sessionTradeHistoryCounts without clobbering global tradeHistory
      await useTradingStore.getState().fetchTradeHistory('sess-cur', 15);
      assert.strictEqual(useTradingStore.getState().historyLimit, 15);
      assert.strictEqual(useTradingStore.getState().tradeHistory.length, 2);
      assert.strictEqual(useTradingStore.getState().sessionTradeHistoryId, 'sess-cur');
      assert.strictEqual(useTradingStore.getState().sessionTradeHistory.length, 1);
      assert.strictEqual(useTradingStore.getState().sessionTradeHistoryCounts.total, 15);

      // fetchSessions hydrates sessionListCounts and respects explicit adaptive limits
      await useTradingStore.getState().fetchSessions(85);
      assert.strictEqual(listCalls[0].limit, 85);
      assert.strictEqual(listCalls[0].withCounts, true);
      assert.strictEqual(useTradingStore.getState().sessionList.length, 2);
      assert.strictEqual(useTradingStore.getState().sessionListLimit, 85);
      assert.deepStrictEqual(useTradingStore.getState().sessionListCounts, { total: 85, paper: 60, testnet: 5, live: 20 });

      // Legacy array payload remains backwards compatible
      sessionAPI.list = async () => ({
        data: [{ id: 's-legacy', startTime: '2026-07-15T09:00:00Z', paperMode: true, totalPnl: 10 }]
      });
      await useTradingStore.getState().fetchSessions();
      assert.strictEqual(useTradingStore.getState().sessionList.length, 1);
      assert.strictEqual(useTradingStore.getState().sessionList[0].id, 's-legacy');
    } finally {
      sessionAPI.history = origHistoryApi;
      sessionAPI.list = origListApi;
    }
  });
});
