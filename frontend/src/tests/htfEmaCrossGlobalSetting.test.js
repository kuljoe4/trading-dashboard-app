import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('SettingsView includes HTF EMA Cross global resource control with WCAG accessibility', () => {
  const settingsViewPath = path.join(__dirname, '../views/SettingsView.jsx');
  const code = fs.readFileSync(settingsViewPath, 'utf-8');

  // Verify htf_ema_cross_boost_enabled toggle control exists
  assert.ok(
    code.includes('id="htf_ema_cross_boost_enabled"'),
    'SettingsView must include htf_ema_cross_boost_enabled switch control'
  );

  // Verify patchConfig wiring
  assert.ok(
    code.includes('patchConfig({ htf_ema_cross_boost_enabled: cfg.htf_ema_cross_boost_enabled === false ? true : false })'),
    'SettingsView must wire htf_ema_cross_boost_enabled toggle to patchConfig'
  );

  // Verify WCAG 2.1 accessibility attributes
  assert.ok(
    code.includes('role="switch"') && code.includes('aria-checked={cfg.htf_ema_cross_boost_enabled !== false}'),
    'HTF EMA Cross switch button must enforce role="switch" and aria-checked'
  );

  assert.ok(
    code.includes('aria-label="Toggle HTF EMA Cross Calculations"'),
    'HTF EMA Cross switch button must specify a descriptive aria-label'
  );
});

test('PositionTrackerService coerces rehydrated trade fields to primitive numbers', () => {
  const trackerPath = path.join(__dirname, '../../../backend/node/src/engine/positionTracker.ts');
  const code = fs.readFileSync(trackerPath, 'utf-8');

  assert.ok(
    code.includes('if (trade.current_sl != null) trade.current_sl = Number(trade.current_sl);'),
    'PositionTrackerService must coerce current_sl to Number in addTrade'
  );

  assert.ok(
    code.includes('if (trade.entry_price != null) trade.entry_price = Number(trade.entry_price);'),
    'PositionTrackerService must coerce entry_price to Number in addTrade'
  );

  assert.ok(
    code.includes('if (trade.qty != null) trade.qty = Number(trade.qty);'),
    'PositionTrackerService must coerce qty to Number in addTrade'
  );
});
