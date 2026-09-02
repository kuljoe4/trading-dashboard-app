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

  let modifier = '';
  if (cfg.trailing_stop_enabled) {
    modifier = 'Trail';
  } else if (cfg.sl_distance_pct !== undefined && cfg.sl_distance_pct !== null && cfg.sl_distance_pct !== '') {
    modifier = `${cfg.sl_distance_pct}SL`;
  } else if (cfg.tp_ratio !== undefined && cfg.tp_ratio !== null && cfg.tp_ratio !== '') {
    modifier = `${cfg.tp_ratio}R`;
  }

  const parts = [tf, sigAbbr, risk, modifier].filter(Boolean);
  const name = parts.join(' ');
  return name.length > 22 ? name.slice(0, 22).trim() : name;
}

describe('Preset Auto-Naming & Mobile Character Limit Standard', () => {
  test('generates concise name for single signal configuration within 22 chars', () => {
    const name = generatePresetName({
      scan_interval: '5m',
      risk_pct_per_trade: 1.5,
      enabled_signals: ['ema_dual_cross'],
      sl_distance_pct: 0.8
    });
    assert.strictEqual(name, '5m DualEMA 1.5% 0.8SL');
    assert.ok(name.length <= 22, `Length ${name.length} must be <= 22`);
  });

  test('differentiates presets with slight SL distance variations', () => {
    const name1 = generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['ema_dual_cross'], sl_distance_pct: 0.8 });
    const name2 = generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['ema_dual_cross'], sl_distance_pct: 1.5 });

    assert.strictEqual(name1, '5m DualEMA 1% 0.8SL');
    assert.strictEqual(name2, '5m DualEMA 1% 1.5SL');
    assert.notStrictEqual(name1, name2, 'Presets with different SL distances must have unique names');
    assert.ok(name1.length <= 22 && name2.length <= 22);
  });

  test('differentiates presets with trailing stop enabled vs disabled', () => {
    const nameNormal = generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['supertrend'], sl_distance_pct: 1 });
    const nameTrailing = generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['supertrend'], sl_distance_pct: 1, trailing_stop_enabled: true });

    assert.strictEqual(nameNormal, '5m ST 1% 1SL');
    assert.strictEqual(nameTrailing, '5m ST 1% Trail');
    assert.notStrictEqual(nameNormal, nameTrailing);
    assert.ok(nameNormal.length <= 22 && nameTrailing.length <= 22);
  });

  test('generates fallback Scalp label when no signals enabled', () => {
    const name = generatePresetName({
      scan_interval: '15m',
      risk_pct_per_trade: 2,
      enabled_signals: [],
      tp_ratio: 2
    });
    assert.strictEqual(name, '15m Scalp 2% 2R');
    assert.ok(name.length <= 22);
  });

  test('generates Multi label when multiple signals enabled', () => {
    const name = generatePresetName({
      scan_interval: '1h',
      risk_pct_per_trade: 0.5,
      enabled_signals: ['momentum_pct', 'supertrend'],
      sl_distance_pct: 2
    });
    assert.strictEqual(name, '1h Multi 0.5% 2SL');
    assert.ok(name.length <= 22);
  });

  test('maps individual signal types to clean abbreviations', () => {
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['supertrend'], sl_distance_pct: 1 }), '5m ST 1% 1SL');
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['macd_impulse'], tp_ratio: 3 }), '5m MACD 1% 3R');
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['breakout_hl'], sl_distance_pct: 1 }), '5m Breakout 1% 1SL');
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['engulfing'], sl_distance_pct: 1 }), '5m Engulf 1% 1SL');
    assert.strictEqual(generatePresetName({ scan_interval: '5m', risk_pct_per_trade: 1, enabled_signals: ['momentum_pct'], sl_distance_pct: 1 }), '5m Mom 1% 1SL');
  });

  test('enforces strict max 22 character limit on ultra long inputs', () => {
    const name = generatePresetName({
      scan_interval: '1440m',
      risk_pct_per_trade: 100.5,
      enabled_signals: ['breakout_hl'],
      sl_distance_pct: 15.5
    });
    assert.ok(name.length <= 22, `Name "${name}" length ${name.length} exceeds 22 characters`);
  });
});
