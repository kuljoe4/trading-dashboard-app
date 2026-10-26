import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../store/mock-env.js';
import { useTradingStore } from '../store/trading.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('WebSocket Reconnection Grace Period & UX Validation', async (t) => {
  const alertBannerPath = path.join(__dirname, '../components/PersistentAlertBanner.jsx');
  const systemMetricsPath = path.join(__dirname, '../components/SystemMetrics.jsx');
  const mainAppPath = path.join(__dirname, '../main.jsx');
  const tradingStorePath = path.join(__dirname, '../store/trading.js');

  const alertBannerSrc = fs.readFileSync(alertBannerPath, 'utf-8');
  const systemMetricsSrc = fs.readFileSync(systemMetricsPath, 'utf-8');
  const mainAppSrc = fs.readFileSync(mainAppPath, 'utf-8');
  const tradingStoreSrc = fs.readFileSync(tradingStorePath, 'utf-8');

  await t.test('PersistentAlertBanner requires confirmed error status and wsError before displaying red alert', () => {
    assert.ok(
      alertBannerSrc.includes("hasWsFailure = wsStatus === 'error' && !!wsError"),
      'PersistentAlertBanner must not show red failure banner for transient reconnecting status'
    );
  });

  await t.test('PersistentAlertBanner includes non-intrusive ambient reconnection status pill', () => {
    assert.ok(
      alertBannerSrc.includes('showReconnectingPill') && alertBannerSrc.includes('role="status"'),
      'PersistentAlertBanner must include an ambient reconnecting pill with role="status"'
    );
    assert.ok(
      alertBannerSrc.includes('aria-live="polite"'),
      'Ambient pill must be polite, not assertive'
    );
    assert.ok(
      alertBannerSrc.includes('Re-establishing live WebSocket'),
      'Ambient pill must explain connection recovery clearly'
    );
  });

  await t.test('SystemMetrics supports reconnecting state with amber pulse dot and Reconnecting label', () => {
    assert.ok(
      systemMetricsSrc.includes("wsStatus === 'reconnecting'"),
      'SystemMetrics must explicitly support reconnecting state'
    );
    assert.ok(
      systemMetricsSrc.includes("'Reconnecting'"),
      'SystemMetrics must display Reconnecting label during recovery'
    );
  });

  await t.test('main.jsx delegates tab visibility handling to setThrottled without double REST sync', () => {
    // Check that we removed the duplicate sync() before setThrottled in main.jsx
    assert.ok(
      !mainAppSrc.includes('Tab became visible. Triggering sync.'),
      'main.jsx should not trigger redundant REST sync immediately on visibility change'
    );
  });

  await t.test('trading.js implements grace period debounce and fast wakeup reconnection in ws.onclose', () => {
    assert.ok(
      tradingStoreSrc.includes("wsStatus: att >= 3 ? 'error' : 'reconnecting'"),
      'Initial drop must enter reconnecting state instead of immediate error'
    );
    assert.ok(
      tradingStoreSrc.includes('wsErrorDebounceTimeout'),
      'Must manage wsErrorDebounceTimeout for grace period'
    );
    assert.ok(
      tradingStoreSrc.includes('3000'),
      'Grace period must provide 3000ms window before escalating to error'
    );
  });
});
