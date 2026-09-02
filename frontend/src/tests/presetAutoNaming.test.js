import { test, describe } from 'node:test';
import assert from 'node:assert';

// Pure implementation of generatedPresetName matching ConfigModal.jsx
function generatePresetName(cfg) {
  const tf = cfg.scan_interval || '5m';
  const risk = (cfg.risk_pct_per_trade !== undefined && cfg.risk_pct_per_trade !== null && cfg.risk_pct_per_trade !== '')
    ? `${cfg.risk_pct_per_trade}%`
    : '';

  const sigs = cfg.enabled_signals || [];
  let sigAbbr = '';
  if (sigs.length === 0) {
    sigAbbr = 'Scalp';
  } else if (sigs.length === 1) {
    const s = sigs[0];
    if (s.startsWith('ema_dual')) sigAbbr = 'DualEMA';
    else if (s.startsWith('ema')) sigAbbr = 'EMA';
    else if (s.startsWith('macd')) sigAbbr = 'MACD';
    else if (s === 'supertrend') sigAbbr = 'ST';
    else if (s === 'breakout_hl') sigAbbr = 'Breakout';
    else if (s === 'momentum_pct') sigAbbr = 'Mom';
    else if (s === 'engulfing') sigAbbr = 'Engulf';
    else sigAbbr = 'Signal';
  } else {
    sigAbbr = 'Multi';
  }

  const parts = [tf, sigAbbr, risk].filter(Boolean);
  const name = parts.join(' ');
  return name.length > 20 ? name.slice(0, 20).trim() : name;
}

describe('Preset Auto-Naming & Mobile Character Limit Standard', () => {
  test('generates concise name for single signal configuration within 20 chars', () => {
    const name = generatePresetName({
      scan_interval: '5m',
      risk_pct_per_trade: 1.5,
      enabled_signals: ['ema_dual_cross']
    });
    assert.strictEqual(name, '5m DualEMA 1.5%');
    assert.ok(name.length <= 20, `Length ${name.length} must be <= 20`);
  });

  test('generates fallback Scalp label when no signals enabled', () => {
    const name = generatePresetName({
      scan_interval: '15m',
      risk_pct_per_trade: 2,
      enabled_signals: []
    });
    assert.strictEqual(name, '15m Scalp 2%');
    assert.ok(name.length <= 20);
  });

  test('generates Multi label when multiple signals enabled', () => {
    const name = generatePresetName({
      scan_interval: '1h',
      risk_pct_per_trade: 0.5,
      enabled_signals: ['momentum_pct', 'supertrend']
    });
    assert.strictEqual(name, '1h Multi 0.5%');
    assert.ok(name.length <= 20);
  });

  test('maps individual signal types to clean abbreviations', () => {
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['supertrend'] }), '5m ST 1%');
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['macd_impulse'] }), '5m MACD 1%');
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['breakout_hl'] }), '5m Breakout 1%');
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['engulfing'] }), '5m Engulf 1%');
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['momentum_pct'] }), '5m Mom 1%');
  });

  test('enforces strict max 20 character limit on ultra long inputs', () => {
    const name = generatePresetName({
      scan_interval: '1440m',
      risk_pct_per_trade: 100.5,
      enabled_signals: ['breakout_hl']
    });
    assert.ok(name.length <= 20, `Name "${name}" length ${name.length} exceeds 20 characters`);
  });
});
