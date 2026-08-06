import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { useTradingStore } from './trading.js';

test('alerts store subsystem validation', async (t) => {
  // Clear any existing alerts
  useTradingStore.setState({ alerts: [] });

  await t.test('addAlert adds a new alert successfully', () => {
    useTradingStore.getState().addAlert({
      level: 'success',
      title: 'Alert Added',
      message: 'Initial validation message.'
    });

    const state = useTradingStore.getState();
    assert.strictEqual(state.alerts.length, 1);
    assert.strictEqual(state.alerts[0].level, 'success');
    assert.strictEqual(state.alerts[0].title, 'Alert Added');
    assert.strictEqual(state.alerts[0].message, 'Initial validation message.');
    assert.strictEqual(state.alerts[0].count || 1, 1);
  });

  await t.test('addAlert debounces duplicate alerts added within 5s', () => {
    useTradingStore.setState({ alerts: [] });

    // Add first alert
    useTradingStore.getState().addAlert({
      level: 'error',
      title: 'Action Failed',
      message: 'Network timeout.'
    });

    // Add identical alert immediately
    useTradingStore.getState().addAlert({
      level: 'error',
      title: 'Action Failed',
      message: 'Network timeout.'
    });

    const state = useTradingStore.getState();
    assert.strictEqual(state.alerts.length, 1, 'Should debounce duplicates and keep array length 1');
    assert.strictEqual(state.alerts[0].count, 2, 'Should increment debounce count to 2');
  });

  await t.test('removeAlert deletes an alert by its unique id', () => {
    useTradingStore.setState({ alerts: [] });

    useTradingStore.getState().addAlert({
      level: 'info',
      title: 'Notification',
      message: 'Checking for updates.'
    });

    let state = useTradingStore.getState();
    assert.strictEqual(state.alerts.length, 1);
    const alertId = state.alerts[0].id;

    useTradingStore.getState().removeAlert(alertId);

    state = useTradingStore.getState();
    assert.strictEqual(state.alerts.length, 0, 'Alert should be deleted from the store');
  });
});
