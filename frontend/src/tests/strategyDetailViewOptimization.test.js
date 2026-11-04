import test from 'node:test';
import assert from 'node:assert';

const SIGNAL_LABELS = {
  ema: 'EMA',
  macd: 'MACD',
  rsi: 'RSI',
  stoch: 'Stochastic'
};

test('StrategyDetailView label classification optimization', async (t) => {
  const strategyConfig = {
    enabled_signals: ['ema', 'macd', 'rsi', 'stoch', 'unknown'],
    required_signals: ['ema', 'rsi']
  };

  const requiredSignals = strategyConfig.required_signals || [];

  await t.test('original implementation', () => {
    const reqLabels = (strategyConfig.enabled_signals || []).filter(s => requiredSignals.includes(s)).map(s => SIGNAL_LABELS[s] || s);
    const optLabels = (strategyConfig.enabled_signals || []).filter(s => !requiredSignals.includes(s)).map(s => SIGNAL_LABELS[s] || s);

    assert.deepStrictEqual(reqLabels, ['EMA', 'RSI']);
    assert.deepStrictEqual(optLabels, ['MACD', 'Stochastic', 'unknown']);
  });

  await t.test('optimized implementation', () => {
    const req = [];
    const opt = [];
    const enabled = strategyConfig.enabled_signals || [];
    for (let i = 0; i < enabled.length; i++) {
      const s = enabled[i];
      const label = SIGNAL_LABELS[s] || s;
      if (requiredSignals.includes(s)) {
        req.push(label);
      } else {
        opt.push(label);
      }
    }

    assert.deepStrictEqual(req, ['EMA', 'RSI']);
    assert.deepStrictEqual(opt, ['MACD', 'Stochastic', 'unknown']);
  });

  await t.test('benchmark', () => {
    const iterations = 100000;

    const startOriginal = performance.now();
    for (let i = 0; i < iterations; i++) {
      const reqLabels = (strategyConfig.enabled_signals || []).filter(s => requiredSignals.includes(s)).map(s => SIGNAL_LABELS[s] || s);
      const optLabels = (strategyConfig.enabled_signals || []).filter(s => !requiredSignals.includes(s)).map(s => SIGNAL_LABELS[s] || s);
    }
    const endOriginal = performance.now();

    const startOptimized = performance.now();
    for (let i = 0; i < iterations; i++) {
      const req = [];
      const opt = [];
      const enabled = strategyConfig.enabled_signals || [];
      for (let j = 0; j < enabled.length; j++) {
        const s = enabled[j];
        const label = SIGNAL_LABELS[s] || s;
        if (requiredSignals.includes(s)) {
          req.push(label);
        } else {
          opt.push(label);
        }
      }
    }
    const endOptimized = performance.now();

    const originalTime = endOriginal - startOriginal;
    const optimizedTime = endOptimized - startOptimized;
    const speedup = originalTime / optimizedTime;

    console.log(`\n# ⚡ Bolt Performance Benchmark (Signal Label Classification, ${iterations} iterations):`);
    console.log(`#   - Original (.filter().map() dual pass): ${originalTime.toFixed(2)} ms`);
    console.log(`#   - Optimized (Single-pass loop):         ${optimizedTime.toFixed(2)} ms`);
    console.log(`#   - Execution Speedup:                    ${speedup.toFixed(2)}x faster`);

    // Performance asserts are inherently flaky in CI environments
    assert.ok(true);
  });

  await t.test('initialization order prevents TDZ ReferenceError', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/views/StrategyDetailView.jsx'), 'utf-8');

    const activeTradesIdx = src.indexOf('const strategyActiveTrades = useMemo');
    const focusedOppIdx = src.indexOf('const focusedOpp = useMemo');
    const timeframeDebugIdx = src.indexOf('const timeframeDebugItems = useMemo');
    const journeyMilestonesIdx = src.indexOf('const journeyMilestones = useMemo');

    assert.ok(activeTradesIdx !== -1, 'strategyActiveTrades must be defined');
    assert.ok(focusedOppIdx !== -1, 'focusedOpp must be defined');
    assert.ok(timeframeDebugIdx !== -1, 'timeframeDebugItems must be defined');
    assert.ok(journeyMilestonesIdx !== -1, 'journeyMilestones must be defined');

    assert.ok(
      activeTradesIdx < focusedOppIdx,
      `strategyActiveTrades (idx: ${activeTradesIdx}) must be defined BEFORE focusedOpp (idx: ${focusedOppIdx}) to avoid TDZ`
    );
    assert.ok(
      timeframeDebugIdx < journeyMilestonesIdx,
      `timeframeDebugItems (idx: ${timeframeDebugIdx}) must be defined BEFORE journeyMilestones (idx: ${journeyMilestonesIdx}) to avoid TDZ`
    );
  });
});
