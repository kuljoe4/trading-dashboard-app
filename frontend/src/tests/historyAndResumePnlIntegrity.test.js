import '../store/mock-env.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTradingStore, resolveNonZeroMetric, resolveVariantStats, createEmptyLastKnownPnl } from '../store/trading.js';
import { sessionAPI } from '../api/client.js';
import { filterHistorySessions, getNextAdaptiveTradeStep } from '../utils/periodicPerformance.js';

describe('Trade History Adaptive Session Filtering & Resume PnL Integrity', () => {
  beforeEach(() => {
    useTradingStore.setState({
      isRunning: false,
      isResuming: false,
      strategyId: null,
      sessionList: [],
      tradeHistory: [],
      sessionTradeHistory: [],
      totalPnl: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      sessionReturnPct: 0,
      variantStats: {},
    });
  });

  test('filterHistorySessions hides sessions without loaded trades by default and reveals them when toggled', () => {
    const sessions = [
      { id: 'sess-1', tradingMode: 'paper', strategy_label: 'Session 1', trades: [{ id: 't1', pnl: 15 }] },
      { id: 'sess-2', tradingMode: 'paper', strategy_label: 'Session 2 (Empty)', trades: [] },
      { id: 'sess-3', tradingMode: 'paper', strategy_label: 'Session 3', trades: [{ id: 't2', pnl: -4 }] },
      { id: 'sess-4', tradingMode: 'paper', strategy_label: 'Session 4 (Empty)', trades: [] },
    ];

    const hiddenResult = filterHistorySessions({
      sessions,
      lifetimeMode: 'paper',
      hideEmptySessions: true,
    });
    assert.equal(hiddenResult.modeMatchedSessions.length, 4);
    assert.equal(hiddenResult.visibleSessions.length, 2);
    assert.equal(hiddenResult.hiddenEmptyCount, 2);
    assert.deepEqual(hiddenResult.visibleSessions.map((g) => g.id), ['sess-1', 'sess-3']);

    const shownResult = filterHistorySessions({
      sessions,
      lifetimeMode: 'paper',
      hideEmptySessions: false,
    });
    assert.equal(shownResult.visibleSessions.length, 4);
    assert.equal(shownResult.hiddenEmptyCount, 0);
  });

  test('getNextAdaptiveTradeStep proposes higher trade fetch limits until ALL', () => {
    const stepFrom250 = getNextAdaptiveTradeStep(250, 1200);
    assert.equal(stepFrom250.canIncrease, true);
    assert.equal(stepFrom250.nextLimit, 1000);
    assert.equal(stepFrom250.remainingTrades, 950);

    const stepFrom1000 = getNextAdaptiveTradeStep(1000, 1200);
    assert.equal(stepFrom1000.canIncrease, true);
    assert.equal(stepFrom1000.nextLimit, 1200);
    assert.equal(stepFrom1000.isAll, true);

    const stepWhenAllLoaded = getNextAdaptiveTradeStep(1200, 1200);
    assert.equal(stepWhenAllLoaded.canIncrease, false);
    assert.equal(stepWhenAllLoaded.isAll, true);
  });

  test('resolveNonZeroMetric and resolveVariantStats preserve last known PnL during resume/navigation', () => {
    assert.equal(resolveNonZeroMetric(0, 148.75, true), 148.75);
    assert.equal(resolveNonZeroMetric(null, -42.1, true), -42.1);
    assert.equal(resolveNonZeroMetric(165.2, 148.75, true), 165.2);
    assert.equal(resolveNonZeroMetric(0, 148.75, false), 0);

    const prevStats = {
      'Alpha 15m': {
        totalPnl: 220.5,
        realizedPnl: 180.0,
        unrealizedPnl: 40.5,
        returnPct: 22.05,
        totalTrades: 8,
      },
    };
    const zeroIncoming = {
      'Alpha 15m': {
        totalPnl: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        returnPct: 0,
        totalTrades: 8,
      },
    };

    const merged = resolveVariantStats(zeroIncoming, prevStats, true);
    assert.equal(merged['Alpha 15m'].totalPnl, 220.5);
    assert.equal(merged['Alpha 15m'].realizedPnl, 180.0);
    assert.equal(merged['Alpha 15m'].unrealizedPnl, 40.5);
    assert.equal(merged['Alpha 15m'].returnPct, 22.05);
  });

  test('updateConfig does not overwrite latest historical session metadata when strategyId does not match', () => {
    useTradingStore.setState({
      strategyId: null,
      sessionList: [
        {
          id: 'hist-sess-99',
          strategy_label: 'Breakout 1h Pro',
          scan_interval: '1h',
          config: { strategy_label: 'Breakout 1h Pro', scan_interval: '1h' },
        },
      ],
    });

    useTradingStore.getState().updateConfig({
      strategy_label: 'Momentum Strategy',
      scan_interval: '5m',
    });

    const latest = useTradingStore.getState().sessionList[0];
    assert.equal(latest.strategy_label, 'Breakout 1h Pro');
    assert.equal(latest.scan_interval, '1h');
  });

  test('fetchTradeHistory retains previously loaded older trades when a smaller dashboard limit is fetched', async () => {
    const olderTrades = Array.from({ length: 10 }, (_, idx) => ({
      id: `trade-${idx + 1}`,
      symbol: 'BTCUSDT',
      pnl: idx + 1,
      exit_time: 1700000000000 - idx * 60000,
    }));
    useTradingStore.setState({ tradeHistory: olderTrades });

    const origHistory = sessionAPI.history;
    sessionAPI.history = async () => ({
      data: {
        trades: olderTrades.slice(0, 3).map((t) => ({ ...t, pnl: t.pnl + 100 })),
      },
    });

    try {
      await useTradingStore.getState().fetchTradeHistory('all', 3);
      const currentTrades = useTradingStore.getState().tradeHistory;
      assert.equal(currentTrades.length, 10, 'Should preserve all 10 loaded trades while updating newest 3');
      assert.equal(currentTrades[0].pnl, 101);
      assert.equal(currentTrades[9].id, 'trade-10');
    } finally {
      sessionAPI.history = origHistory;
    }
  });

  test('Appearance range settings dim bright theme colors and persist across store and localStorage', async () => {
    const {
      DEFAULT_APPEARANCE,
      APPEARANCE_PRESETS,
      computeThemeVariables,
      loadAppearanceSettings,
    } = await import('../lib/theme.js');

    useTradingStore.getState().resetAppearance();
    assert.deepEqual(useTradingStore.getState().appearance, DEFAULT_APPEARANCE);

    useTradingStore.getState().setAppearance(APPEARANCE_PRESETS.deepFocus.values);
    const saved = loadAppearanceSettings();
    assert.equal(saved.screenBrightness, 82);
    assert.equal(saved.textBrightness, 72);
    assert.equal(saved.accentIntensity, 55);
    assert.equal(saved.borderContrast, 40);
    assert.equal(saved.glowIntensity, 0);

    const standardVars = computeThemeVariables('default', DEFAULT_APPEARANCE);
    const dimmedVars = computeThemeVariables('default', saved);
    assert.notEqual(dimmedVars.vars['--color-text-theme'], standardVars.vars['--color-text-theme']);
    assert.notEqual(dimmedVars.vars['--color-green-theme'], standardVars.vars['--color-green-theme']);
    assert.notEqual(dimmedVars.vars['--color-border-theme'], standardVars.vars['--color-border-theme']);
    assert.equal(dimmedVars.isLowGlare, true);
    assert.equal(dimmedVars.isTextDimmed, true);

    useTradingStore.getState().resetAppearance();
  });

  test('lastKnownPnl caches valid PnL across unpriced resume/focus snapshots and resets when trades close authoritatively', () => {
    useTradingStore.setState({
      sessionActive: true,
      strategyId: 'sess-pnl-cache',
      totalPnl: 0,
      realizedPnl: 0,
      activePnl: 0,
      lastKnownPnl: createEmptyLastKnownPnl('sess-pnl-cache'),
      activeTrades: [],
      variantStats: {},
      wsStatus: 'live',
      isThrottled: false,
      isSyncingOnResume: false,
      _lastFocusChangeTs: 0,
    });

    // 1. Live update records realized, active, trade, and variant PnL in lastKnownPnl
    useTradingStore.getState().updateStats({
      _authoritative: true,
      running: true,
      sessionActive: true,
      strategyId: 'sess-pnl-cache',
      totalPnl: 42.5,
      realizedPnl: 12.0,
      activePnl: 30.5,
      activeTrades: [
        {
          id: 'tr-1',
          symbol: 'ETHUSDT',
          strategy_label: 'Alpha 15m',
          direction: 'LONG',
          status: 'OPEN',
          entry_price: 3000,
          current_price: 3050,
          pnl: 30.5,
          rr: 1.4,
          max_rr: 1.6,
        },
      ],
      variantStats: {
        'Alpha 15m': { totalPnl: 42.5, realizedPnl: 12.0, activePnl: 30.5, returnPct: 4.25 },
      },
    });

    let st = useTradingStore.getState();
    assert.equal(st.totalPnl, 42.5);
    assert.equal(st.activePnl, 30.5);
    assert.equal(st.realizedPnl, 12.0);
    assert.equal(st.lastKnownPnl.activePnl, 30.5);
    assert.equal(st.lastKnownPnl.trades['tr-1'].pnl, 30.5);
    assert.equal(st.lastKnownPnl.variants['Alpha 15m'].totalPnl, 42.5);

    // 2. Simulate background resume / screen-switch with an unpriced snapshot (current_price === entry_price, pnl === 0)
    useTradingStore.setState({ isSyncingOnResume: true, _lastFocusChangeTs: Date.now() });
    useTradingStore.getState().updateStats({
      _authoritative: true,
      running: true,
      sessionActive: true,
      strategyId: 'sess-pnl-cache',
      totalPnl: 0,
      realizedPnl: 0,
      activePnl: 0,
      activeTrades: [
        {
          id: 'tr-1',
          symbol: 'ETHUSDT',
          strategy_label: 'Alpha 15m',
          direction: 'LONG',
          status: 'OPEN',
          entry_price: 3000,
          current_price: 3000,
          pnl: 0,
        },
      ],
      variantStats: {
        'Alpha 15m': { totalPnl: 0, realizedPnl: 0, activePnl: 0, returnPct: 0 },
      },
    });

    st = useTradingStore.getState();
    assert.equal(st.totalPnl, 42.5, 'totalPnl must hold cached value on unpriced resume snapshot');
    assert.equal(st.activePnl, 30.5, 'activePnl must hold cached value on unpriced resume snapshot');
    assert.equal(st.realizedPnl, 12.0, 'realizedPnl must hold cached value on unpriced resume snapshot');
    assert.equal(st.activeTrades[0].pnl, 30.5, 'open trade pnl must restore from lastKnownPnl cache');
    assert.equal(st.variantStats['Alpha 15m'].totalPnl, 42.5);
    assert.equal(st.isSyncingOnResume, true, 'remains syncing until priced ticks arrive');

    // 3. Authoritative closure clears activePnl and trade cache cleanly
    useTradingStore.setState({ isSyncingOnResume: false, _lastFocusChangeTs: 0 });
    useTradingStore.getState().updateStats({
      _authoritative: true,
      running: true,
      sessionActive: true,
      strategyId: 'sess-pnl-cache',
      totalPnl: 44.0,
      realizedPnl: 44.0,
      activePnl: 0,
      activeTrades: [],
      variantStats: {
        'Alpha 15m': { totalPnl: 44.0, realizedPnl: 44.0, activePnl: 0, returnPct: 4.4 },
      },
    });

    st = useTradingStore.getState();
    assert.equal(st.activePnl, 0);
    assert.equal(st.realizedPnl, 44.0);
    assert.equal(st.totalPnl, 44.0);
    assert.equal(st.lastKnownPnl.activePnl, 0);
    assert.deepEqual(st.lastKnownPnl.trades, {});
  });

  test('lastKnownPnl preserves entryCount, hitCount, totalRiskPct, totalEstPnlToRealize, and maxRr during unpriced resume', () => {
    useTradingStore.setState({
      sessionActive: true,
      strategyId: 'sess-extended-metrics',
      lastKnownPnl: createEmptyLastKnownPnl('sess-extended-metrics'),
      entryCount: 0,
      hitCount: 0,
      totalRiskPct: 0,
      totalSlUsed: 0,
      totalEstPnlToRealize: 0,
      wsStatus: 'live',
      isSyncingOnResume: false,
      _lastFocusChangeTs: 0,
    });

    useTradingStore.getState().updateStats({
      _authoritative: true,
      running: true,
      sessionActive: true,
      strategyId: 'sess-extended-metrics',
      totalPnl: 65,
      realizedPnl: 25,
      activePnl: 40,
      entryCount: 7,
      hitCount: 4,
      totalRiskPct: 3.5,
      totalSlUsed: 350,
      totalEstPnlToRealize: 18.25,
      activeTrades: [
        {
          id: 'tr-ext-1',
          symbol: 'BTCUSDT',
          strategy_label: 'Alpha 15m',
          direction: 'LONG',
          status: 'OPEN',
          entry_price: 60000,
          current_price: 61000,
          pnl: 40,
          rr: 1.5,
          max_rr: 2.35,
          est_pnl_to_realize: 18.25,
        },
      ],
    });

    let st = useTradingStore.getState();
    assert.equal(st.entryCount, 7);
    assert.equal(st.hitCount, 4);
    assert.equal(st.totalRiskPct, 3.5);
    assert.equal(st.totalEstPnlToRealize, 18.25);
    assert.equal(st.lastKnownPnl.maxRr, 2.35);

    // Unpriced resume snapshot drops metrics to 0 transiently
    useTradingStore.setState({ isSyncingOnResume: true, _lastFocusChangeTs: Date.now() });
    useTradingStore.getState().updateStats({
      _authoritative: true,
      running: true,
      sessionActive: true,
      strategyId: 'sess-extended-metrics',
      totalPnl: 0,
      realizedPnl: 0,
      activePnl: 0,
      entryCount: 0,
      hitCount: 0,
      totalRiskPct: 0,
      totalSlUsed: 0,
      totalEstPnlToRealize: 0,
      activeTrades: [
        {
          id: 'tr-ext-1',
          symbol: 'BTCUSDT',
          strategy_label: 'Alpha 15m',
          direction: 'LONG',
          status: 'OPEN',
          entry_price: 60000,
          current_price: 60000,
          pnl: 0,
        },
      ],
    });

    st = useTradingStore.getState();
    assert.equal(st.entryCount, 7);
    assert.equal(st.hitCount, 4);
    assert.equal(st.totalRiskPct, 3.5);
    assert.equal(st.totalEstPnlToRealize, 18.25);
    assert.equal(st.lastKnownPnl.maxRr, 2.35);
    assert.equal(st.activeTrades[0].max_rr, 2.35);
  });

  test('fetchSessions, fetchTradeHistory, and fetchLifetimeAnalytics use scoped loading flags without mutating isSyncing', async () => {
    const origList = sessionAPI.list;
    const origHistory = sessionAPI.history;
    const origAnalytics = sessionAPI.getLifetimeAnalytics;

    const observedSyncingFlags = [];
    const seenScopedFlags = { sessions: false, history: false, analytics: false };

    sessionAPI.list = async () => {
      const s = useTradingStore.getState();
      observedSyncingFlags.push(s.isSyncing);
      seenScopedFlags.sessions = s.sessionsLoading;
      return { data: [] };
    };
    sessionAPI.history = async () => {
      const s = useTradingStore.getState();
      observedSyncingFlags.push(s.isSyncing);
      seenScopedFlags.history = s.historyLoading;
      return { data: { trades: [], totalTrades: 0 } };
    };
    sessionAPI.getLifetimeAnalytics = async () => {
      const s = useTradingStore.getState();
      observedSyncingFlags.push(s.isSyncing);
      seenScopedFlags.analytics = s.analyticsLoading;
      return { data: { totalTrades: 0, totalPnl: 0 } };
    };

    useTradingStore.setState({ isSyncing: false });
    try {
      await useTradingStore.getState().fetchSessions();
      await useTradingStore.getState().fetchTradeHistory('all', 50);
      await useTradingStore.getState().fetchLifetimeAnalytics('paper');

      assert.deepEqual(observedSyncingFlags, [false, false, false]);
      assert.equal(seenScopedFlags.sessions, true);
      assert.equal(seenScopedFlags.history, true);
      assert.equal(seenScopedFlags.analytics, true);

      const finalState = useTradingStore.getState();
      assert.equal(finalState.isSyncing, false);
      assert.equal(finalState.sessionsLoading, false);
      assert.equal(finalState.historyLoading, false);
      assert.equal(finalState.analyticsLoading, false);
    } finally {
      sessionAPI.list = origList;
      sessionAPI.history = origHistory;
      sessionAPI.getLifetimeAnalytics = origAnalytics;
    }
  });
});
