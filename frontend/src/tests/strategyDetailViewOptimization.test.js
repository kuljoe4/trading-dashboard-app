import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const SIGNAL_LABELS = {
  momentum_pct: 'Momentum',
  breakout_hl: 'Breakout H/L',
  ema_price_cross: 'EMA Cross',
  ema_dual_cross: 'Dual EMA Cross',
  ema_close: 'EMA Close',
  ema_dual_close: 'Dual EMA Close',
  ma: 'MA Cross',
  engulfing: 'Engulfing',
  macd_impulse: 'MACD Impulse',
  macd_fade: 'MACD Fade',
  macd_pbc: 'MACD PBC',
  supertrend: 'Supertrend'
};

describe('StrategyDetailView Signal Label Filtering Optimization', () => {
  const enabledSignals = [
    'momentum_pct', 'breakout_hl', 'ema_dual_cross', 'ema_close',
    'ma', 'engulfing', 'macd_impulse', 'supertrend'
  ];
  const requiredSignals = ['momentum_pct', 'breakout_hl'];

  const originalFn = (enabled, required) => {
    const req = enabled.filter(s => required.includes(s)).map(s => SIGNAL_LABELS[s] || s);
    const opt = enabled.filter(s => !required.includes(s)).map(s => SIGNAL_LABELS[s] || s);
    return { reqLabels: req, optLabels: opt };
  };

  const optimizedFn = (enabled, required) => {
    const req = [];
    const opt = [];
    const len = enabled.length;
    for (let i = 0; i < len; i++) {
      const sig = enabled[i];
      const lbl = SIGNAL_LABELS[sig] || sig;
      if (required.includes(sig)) req.push(lbl);
      else opt.push(lbl);
    }
    return { reqLabels: req, optLabels: opt };
  };

  test('correctness: optimized single-pass matches multi-pass output', () => {
    const res1 = originalFn(enabledSignals, requiredSignals);
    const res2 = optimizedFn(enabledSignals, requiredSignals);

    assert.deepEqual(res2.reqLabels, res1.reqLabels);
    assert.deepEqual(res2.optLabels, res1.optLabels);
  });

  test('performance: single-pass loop provides measurable speedup over dual filter.map passes', () => {
    const iterations = 100000;

    const start1 = performance.now();
    for (let i = 0; i < iterations; i++) {
      originalFn(enabledSignals, requiredSignals);
    }
    const end1 = performance.now();
    const dur1 = end1 - start1;

    const start2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      optimizedFn(enabledSignals, requiredSignals);
    }
    const end2 = performance.now();
    const dur2 = end2 - start2;

    const speedup = dur1 / Math.max(0.0001, dur2);

    console.log(`\n⚡ Bolt Performance Benchmark (Signal Label Classification, ${iterations} iterations):`);
    console.log(`  - Original (Dual .filter().map()): ${dur1.toFixed(2)} ms`);
    console.log(`  - Optimized (Single-pass loop):    ${dur2.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                ${speedup.toFixed(2)}x faster\n`);

    assert.ok(dur2 <= dur1, 'Optimized single-pass loop must be faster or equal');
  });
});
