import { test, describe } from 'node:test';
import assert from 'node:assert';

// Pure implementation of generatedPresetName matching ConfigModal.jsx
function generatePresetName(cfg, loadedPresetName = null) {
  if (loadedPresetName && typeof loadedPresetName === 'string' && loadedPresetName.trim()) {
    return loadedPresetName.trim();
  }

  const sigs = cfg.enabled_signals || [];
  let sigAbbr = '';
  if (sigs.length === 0) {
    sigAbbr = 'Scl';
  } else if (sigs.length === 1) {
    const s = sigs[0];
    if (s.startsWith('ema_dual')) sigAbbr = 'Dul';
    else if (s.startsWith('ema')) sigAbbr = 'EMA';
    else if (s.startsWith('macd')) sigAbbr = 'MCD';
    else if (s === 'supertrend') sigAbbr = 'ST';
    else if (s === 'breakout_hl') sigAbbr = 'Brk';
    else if (s === 'momentum_pct') sigAbbr = 'Mom';
    else if (s === 'engulfing') sigAbbr = 'Eng';
    else if (s === 'knife_catch') sigAbbr = 'Knf';
    else sigAbbr = 'Sig';
  } else {
    sigAbbr = 'Mlt';
  }

  let modifier = '';
  if (cfg.trailing_stop_enabled) {
    modifier = 'Trail';
  } else if (cfg.sl_distance_pct !== undefined && cfg.sl_distance_pct !== null && cfg.sl_distance_pct !== '') {
    modifier = `${cfg.sl_distance_pct}SL`;
  } else if (cfg.tp_ratio !== undefined && cfg.tp_ratio !== null && cfg.tp_ratio !== '') {
    modifier = `${cfg.tp_ratio}R`;
  } else if (cfg.risk_pct_per_trade !== undefined && cfg.risk_pct_per_trade !== null && cfg.risk_pct_per_trade !== '') {
    modifier = `${cfg.risk_pct_per_trade}%`;
  }

  const parts = [sigAbbr, modifier].filter(Boolean);
  const name = parts.join(' ');

  return name.length > 10 ? name.slice(0, 10).trim() : name;
}

describe('Preset Auto-Naming & 10-Character Mobile Budget Standard', () => {
  test('generates ultra-compact name without timeframe within 10 chars', () => {
    const name = generatePresetName({
      scan_interval: '5m',
      risk_pct_per_trade: 1.5,
      enabled_signals: ['ema_dual_cross'],
      sl_distance_pct: 0.8
    });
    assert.strictEqual(name, 'Dul 0.8SL');
    assert.ok(name.length <= 10, `Length ${name.length} must be <= 10`);
  });

  test('differentiates presets with slight SL distance variations under 10 chars', () => {
    const name1 = generatePresetName({ enabled_signals: ['supertrend'], sl_distance_pct: 0.8 });
    const name2 = generatePresetName({ enabled_signals: ['supertrend'], sl_distance_pct: 1.5 });

    assert.strictEqual(name1, 'ST 0.8SL');
    assert.strictEqual(name2, 'ST 1.5SL');
    assert.notStrictEqual(name1, name2);
    assert.ok(name1.length <= 10 && name2.length <= 10);
  });

  test('differentiates presets with trailing stop enabled vs disabled under 10 chars', () => {
    const nameNormal = generatePresetName({ enabled_signals: ['supertrend'], sl_distance_pct: 1 });
    const nameTrailing = generatePresetName({ enabled_signals: ['supertrend'], sl_distance_pct: 1, trailing_stop_enabled: true });

    assert.strictEqual(nameNormal, 'ST 1SL');
    assert.strictEqual(nameTrailing, 'ST Trail');
    assert.notStrictEqual(nameNormal, nameTrailing);
    assert.ok(nameNormal.length <= 10 && nameTrailing.length <= 10);
  });

  test('preserves existing loaded preset name during updates', () => {
    const updated = generatePresetName({ enabled_signals: ['ema_dual_cross'], sl_distance_pct: 1.2 }, 'Dul 0.8SL');
    assert.strictEqual(updated, 'Dul 0.8SL');
  });

  test('generates fallback Scl label with risk % when no signals enabled', () => {
    const name = generatePresetName({
      risk_pct_per_trade: 2,
      enabled_signals: []
    });
    assert.strictEqual(name, 'Scl 2%');
    assert.ok(name.length <= 10);
  });

  test('generates Mlt label when multiple signals enabled', () => {
    const name = generatePresetName({
      enabled_signals: ['momentum_pct', 'supertrend'],
      sl_distance_pct: 2
    });
    assert.strictEqual(name, 'Mlt 2SL');
    assert.ok(name.length <= 10);
  });

  test('maps individual signal types to clean 10-char abbreviations with SL modifier', () => {
    assert.strictEqual(generatePresetName({ enabled_signals: ['supertrend'], sl_distance_pct: 1 }), 'ST 1SL');
    assert.strictEqual(generatePresetName({ enabled_signals: ['macd_impulse'], tp_ratio: 3 }), 'MCD 3R');
    assert.strictEqual(generatePresetName({ enabled_signals: ['breakout_hl'], sl_distance_pct: 1 }), 'Brk 1SL');
    assert.strictEqual(generatePresetName({ enabled_signals: ['engulfing'], sl_distance_pct: 1 }), 'Eng 1SL');
    assert.strictEqual(generatePresetName({ enabled_signals: ['momentum_pct'], sl_distance_pct: 1 }), 'Mom 1SL');
    assert.strictEqual(generatePresetName({ enabled_signals: ['knife_catch'], sl_distance_pct: 1 }), 'Knf 1SL');
  });

  test('enforces strict hard-cap at 10 characters on long inputs', () => {
    const name = generatePresetName({
      enabled_signals: ['breakout_hl'],
      sl_distance_pct: 15.5
    });
    assert.ok(name.length <= 10, `Name "${name}" length ${name.length} exceeds 10 characters`);
  });
});
