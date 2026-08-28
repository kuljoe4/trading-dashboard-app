import '../store/mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeOpportunity } from '../store/trading.js';

test('normalizeOpportunity benchmark: Object.entries.reduce vs single-pass loop', () => {
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

  // Original implementation simulation
  const toNumber = (v, f = 0) => { const p = Number(v); return Number.isFinite(p) ? p : f; };
  function originalSignals(source) {
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

  // Optimized for...in loop implementation
  function optimizedSignals(source) {
    const rawSignals = (source.signalResult.signals || source.signalResult.details);
    const signalsObj = {};
    if (rawSignals && typeof rawSignals === 'object') {
      for (const key in rawSignals) {
        if (Object.prototype.hasOwnProperty.call(rawSignals, key)) {
          const s = rawSignals[key];
          if (!s || typeof s !== 'object') continue;
          signalsObj[key] = {
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
        }
      }
    }
    return signalsObj;
  }

  // Correctness check
  const origRes = originalSignals(samplePayload);
  const optRes = optimizedSignals(samplePayload);
  assert.deepStrictEqual(optRes, origRes);

  const iterations = 100000;

  // Measure original
  const startOrig = performance.now();
  for (let i = 0; i < iterations; i++) {
    originalSignals(samplePayload);
  }
  const durOrig = performance.now() - startOrig;

  // Measure optimized
  const startOpt = performance.now();
  for (let i = 0; i < iterations; i++) {
    optimizedSignals(samplePayload);
  }
  const durOpt = performance.now() - startOpt;

  const speedup = (durOrig / durOpt).toFixed(2);

  console.log(`\n⚡ Bolt Performance Benchmark (normalizeOpportunity signals mapping, ${iterations} iterations):`);
  console.log(`  - Original Object.entries.reduce: ${durOrig.toFixed(2)} ms`);
  console.log(`  - Optimized for...in loop:          ${durOpt.toFixed(2)} ms`);
  console.log(`  - Execution Speedup:                ${speedup}x faster`);
});
