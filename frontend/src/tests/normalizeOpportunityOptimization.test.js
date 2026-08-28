import '../store/mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeOpportunity } from '../store/trading.js';

test('normalizeOpportunity optimization: correctness of signal mapping', () => {
  const samplePayload = {
    symbol: 'BTCUSDT',
    pct: 2.5,
    momentum: 2.5,
    dir: 'long',
    vol: 1000000,
    score: 85,
    price: 50000,
    signalResult: {
      allFired: true,
      firedSignals: ['ema_cross', 'rsi_oversold'],
      signals: {
        ema_cross: { label: 'EMA Cross', value: 1.2, threshold: 1.0, unit: '%', fired: true, active: true },
        rsi_oversold: { label: 'RSI Oversold', value: 28, threshold: 30, unit: '', fired: true, active: true },
        macd_surge: { label: 'MACD Surge', value: 0.5, threshold: 0.8, unit: '', fired: false, active: true }
      },
      reason: 'Signals triggered'
    }
  };

  const res = normalizeOpportunity(samplePayload);

  assert.strictEqual(res.symbol, 'BTCUSDT');
  assert.strictEqual(res.signalResult.allFired, true);
  assert.deepStrictEqual(res.signalResult.firedSignals, ['ema_cross', 'rsi_oversold']);
  assert.strictEqual(Object.keys(res.signalResult.signals).length, 3);
  assert.strictEqual(res.signalResult.signals.ema_cross.fired, true);
  assert.strictEqual(res.signalResult.signals.ema_cross.value, 1.2);
  assert.strictEqual(res.signalResult.signals.macd_surge.fired, false);
});

test('normalizeOpportunity optimization: performance benchmark comparison', () => {
  const samplePayload = {
    symbol: 'ETHUSDT',
    pct: 3.2,
    momentum: 3.2,
    dir: 'long',
    vol: 500000,
    score: 90,
    price: 3000,
    signalResult: {
      allFired: true,
      firedSignals: ['signal1', 'signal2'],
      signals: {
        signal1: { label: 'Sig 1', value: 10, threshold: 5, unit: '', fired: true, active: true },
        signal2: { label: 'Sig 2', value: 20, threshold: 15, unit: '', fired: true, active: true },
        signal3: { label: 'Sig 3', value: 30, threshold: 35, unit: '', fired: false, active: true },
        signal4: { label: 'Sig 4', value: 40, threshold: 45, unit: '', fired: false, active: true },
        signal5: { label: 'Sig 5', value: 50, threshold: 55, unit: '', fired: false, active: true }
      },
      reason: 'Multiple signals'
    }
  };

  const toNumber = (v, f = 0) => { const p = Number(v); return Number.isFinite(p) ? p : f; };

  // Baseline implementation with Object.entries.reduce
  function originalSignalMapping(source) {
    return (source.signalResult.signals || source.signalResult.details) && typeof (source.signalResult.signals || source.signalResult.details) === 'object' ? Object.entries(source.signalResult.signals || source.signalResult.details).reduce((acc, [key, s]) => {
      acc[key] = {
        ...s,
        label: String(s.label || key),
        value: toNumber(s.value),
        threshold: toNumber(s.threshold),
        unit: String(s.unit || ''),
        fired: !!s.fired,
        active: s.active !== false,
        remaining_delay: toNumber(s.remaining_delay),
        config_delay: toNumber(s.config_delay),
        insufficientData: !!s.insufficientData,
        streak_start_ts: s.streak_start_ts ? toNumber(s.streak_start_ts) : undefined,
        streak_end_ts: s.streak_end_ts ? toNumber(s.streak_end_ts) : undefined,
        slPrice: s.slPrice ? toNumber(s.slPrice) : undefined,
        pattern_low: s.pattern_low ? toNumber(s.pattern_low) : undefined,
        pattern_high: s.pattern_high ? toNumber(s.pattern_high) : undefined,
        body_low: s.body_low ? toNumber(s.body_low) : undefined,
        body_high: s.body_high ? toNumber(s.body_high) : undefined
      };
      return acc;
    }, {}) : {};
  }

  const iterations = 50000;

  // Measure original
  const startOrig = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalSignalMapping(samplePayload);
  }
  const durOrig = performance.now() - startOrig;

  // Measure optimized
  const startOpt = performance.now();
  for (let i = 0; i < iterations; i++) {
    normalizeOpportunity(samplePayload);
  }
  const durOpt = performance.now() - startOpt;

  console.log(`\n⚡ Bolt Performance Benchmark (normalizeOpportunity signals mapping, ${iterations} iterations):`);
  console.log(`  - Original Object.entries.reduce: ${durOrig.toFixed(2)} ms`);
  console.log(`  - Optimized for...in loop:          ${durOpt.toFixed(2)} ms`);
});
