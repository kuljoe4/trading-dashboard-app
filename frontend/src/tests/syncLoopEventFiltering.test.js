import test from 'node:test';
import assert from 'node:assert/strict';
import '../store/mock-env.js';
import { useTradingStore } from '../store/trading.js';
import { sessionAPI } from '../api/client.js';

test('sync() loop event filtering test suite', async (t) => {
  // Mock connectWS and disconnectWS so Node test runner does not attempt browser socket connections
  useTradingStore.setState({
    connectWS: () => {},
    disconnectWS: () => {},
  });

  await t.test('routine sync() heartbeat updates live prices without triggering full history or analytics refresh', async () => {
    let historyCallCount = 0;
    let analyticsCallCount = 0;

    const originalHistory = sessionAPI.history;
    const originalAnalytics = sessionAPI.analytics;
    const originalStatus = sessionAPI.status;

    sessionAPI.history = async () => {
      historyCallCount++;
      return { data: { trades: [] } };
    };
    sessionAPI.analytics = async () => {
      analyticsCallCount++;
      return { data: { winRate: 65 } };
    };

    // Preset store state as running
    useTradingStore.setState({
      wsStatus: 'live',
      isThrottled: false,
      isSyncingOnResume: false,
      sessionActive: true,
      strategyId: 'strat-1',
      activeTrades: [{ id: 'trade-1', symbol: 'BTCUSDT', status: 'OPEN', pnl: 10.0 }],
      balance: 10000,
    });

    // Mock sessionAPI.status returning routine price update without session change or trade closure
    sessionAPI.status = async () => ({
      data: {
        running: true,
        strategyId: 'strat-1',
        balance: 10015,
        totalPnl: 15.0,
        activeTrades: [{ id: 'trade-1', symbol: 'BTCUSDT', status: 'OPEN', pnl: 15.0 }],
        history: [],
      }
    });

    // Execute routine heartbeat sync
    await useTradingStore.getState().sync();

    // Verify state updated with latency-sensitive price update
    assert.equal(useTradingStore.getState().balance, 10015);
    assert.equal(useTradingStore.getState().totalPnl, 15.0);

    // Verify NO heavy full history or analytics calls were issued
    assert.equal(historyCallCount, 0, 'Routine heartbeat sync must NOT fetch full history');
    assert.equal(analyticsCallCount, 0, 'Routine heartbeat sync must NOT fetch analytics');

    // Restore API mocks
    sessionAPI.history = originalHistory;
    sessionAPI.analytics = originalAnalytics;
    sessionAPI.status = originalStatus;
  });

  await t.test('sync() triggers full history and analytics refreshes on trade closure event', async () => {
    let historyCallCount = 0;
    let analyticsCallCount = 0;

    const originalHistory = sessionAPI.history;
    const originalAnalytics = sessionAPI.analytics;
    const originalStatus = sessionAPI.status;

    sessionAPI.history = async () => {
      historyCallCount++;
      return { data: { trades: [{ id: 'trade-1', status: 'CLOSED', pnl: 20 }] } };
    };
    sessionAPI.analytics = async () => {
      analyticsCallCount++;
      return { data: { winRate: 70 } };
    };

    // Store has 1 active trade
    useTradingStore.setState({
      wsStatus: 'live',
      isThrottled: false,
      isSyncingOnResume: false,
      sessionActive: true,
      strategyId: 'strat-1',
      activeTrades: [{ id: 'trade-1', symbol: 'BTCUSDT', status: 'OPEN', pnl: 10.0 }],
    });

    // Status returns 0 active trades (trade closed!)
    sessionAPI.status = async () => ({
      data: {
        running: true,
        strategyId: 'strat-1',
        balance: 10020,
        activeTrades: [], // trade closure detected!
        history: [{ id: 'trade-1', status: 'CLOSED', pnl: 20 }],
      }
    });

    await useTradingStore.getState().sync();

    // Wait for microtask resolution
    await new Promise(r => setTimeout(r, 50));

    assert.equal(historyCallCount, 1, 'Trade closure MUST trigger history refresh');
    assert.equal(analyticsCallCount, 1, 'Trade closure MUST trigger analytics refresh');

    sessionAPI.history = originalHistory;
    sessionAPI.analytics = originalAnalytics;
    sessionAPI.status = originalStatus;
  });

  await t.test('sync() triggers full history and analytics refreshes on session state change', async () => {
    let historyCallCount = 0;
    let analyticsCallCount = 0;

    const originalHistory = sessionAPI.history;
    const originalAnalytics = sessionAPI.analytics;
    const originalStatus = sessionAPI.status;

    sessionAPI.history = async () => {
      historyCallCount++;
      return { data: { trades: [] } };
    };
    sessionAPI.analytics = async () => {
      analyticsCallCount++;
      return { data: { winRate: 50 } };
    };

    // Initially stopped
    useTradingStore.setState({
      wsStatus: 'live',
      isThrottled: false,
      isSyncingOnResume: false,
      sessionActive: false,
      strategyId: null,
      activeTrades: [],
    });

    // Status returns session started
    sessionAPI.status = async () => ({
      data: {
        running: true,
        strategyId: 'strat-new',
        balance: 10000,
        activeTrades: [],
        history: [],
      }
    });

    await useTradingStore.getState().sync();

    await new Promise(r => setTimeout(r, 50));

    assert.equal(historyCallCount, 1, 'Session transition MUST trigger history refresh');
    assert.equal(analyticsCallCount, 1, 'Session transition MUST trigger analytics refresh');

    sessionAPI.history = originalHistory;
    sessionAPI.analytics = originalAnalytics;
    sessionAPI.status = originalStatus;
  });
});
