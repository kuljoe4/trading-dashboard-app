import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('UI Eco Mode & Non-Redundant Performance Controls Unit Tests', async (t) => {
  const settingsPath = path.join(__dirname, '../views/SettingsView.jsx');
  const settingsCode = fs.readFileSync(settingsPath, 'utf-8');

  await t.test('SettingsView includes uiEcoMode store selector and toggle switch', () => {
    assert.ok(
      settingsCode.includes('uiEcoMode') && settingsCode.includes('setUiEcoMode'),
      'SettingsView must import uiEcoMode and setUiEcoMode from useTradingStore'
    );
    assert.ok(
      settingsCode.includes('id="ui_eco_mode"'),
      'SettingsView must include id="ui_eco_mode" toggle switch'
    );
  });

  await t.test('SettingsView organizes settings into non-overlapping accordion sections', () => {
    assert.ok(
      settingsCode.includes("toggleSection('scanner_bandwidth')"),
      'SettingsView must render dedicated Scanner & Market Feed Bandwidth section'
    );
    assert.ok(
      settingsCode.includes("toggleSection('streaming')"),
      'SettingsView must render dedicated Dashboard, Streaming & Eco-Graphics section'
    );
  });

  await t.test('SettingsView controls enforce WCAG 2.1 accessible attributes', () => {
    assert.ok(
      settingsCode.includes('role="switch"'),
      'Interactive toggles must specify role="switch"'
    );
    assert.ok(
      settingsCode.includes('aria-checked='),
      'Interactive switches must bind aria-checked'
    );
  });

  await t.test('getMarketRegimeInfo fast-fails on uiEcoMode', async () => {
    const { getMarketRegimeInfo } = await import('../utils/marketRegime.js');
    const ecoResult = getMarketRegimeInfo(
      [{ symbol: 'BTCUSDT', momentum: 5.0 }],
      { scan_pct_threshold: 2.0 },
      { uiEcoMode: true }
    );

    assert.strictEqual(ecoResult.regime, 'eco');
    assert.strictEqual(ecoResult.label, 'Eco Mode Active');
    assert.strictEqual(ecoResult.avgMomentum, 0);
  });
});
