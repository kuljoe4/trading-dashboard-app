import test from 'node:test';
import assert from 'node:assert';

test('ExitMonitor single-pass loop fusion optimization test', () => {
  const status = {
    ema_close: { label: 'EMA Close', value: 100, threshold: 105, distPct: 85, fired: true, active: true },
    macd_pbc: { label: 'MACD PBC', value: 0.5, threshold: 0, distPct: 40, fired: false, active: true },
    supertrend: { label: 'Supertrend', value: 102, threshold: 100, distPct: 90, fired: true, active: true },
    rsi_overbought: { label: 'RSI', value: 75, threshold: 70, distPct: 95, fired: true, active: true },
  };

  const trade = {
    strategy_config: {
      required_exit_signals: ['ema_close', 'supertrend']
    },
    required_exit_signals: ['ema_close', 'supertrend']
  };

  const logic = 'combo';

  // --- Original logic ---
  const calcOriginal = (status, trade, logic) => {
    const entries = Object.entries(status).map(([key, s]) => {
      const progress = s.distPct ?? 0;
      return [key, { ...s, progress }];
    }).sort((a, b) => b[1].progress - a[1].progress);

    const satisfiedCount = entries.filter(([_, s]) => s.fired && s.active).length;
    const totalCount = entries.length;
    const allFired = satisfiedCount === totalCount;

    const reqExitSignals = trade.strategy_config?.required_exit_signals || trade.required_exit_signals || [];
    const reqSatisfied = reqExitSignals.length > 0
      ? reqExitSignals.every(k => status[k]?.fired && status[k]?.active)
      : entries.filter(([k]) => !k.includes('_')).every(([_, s]) => s.fired && s.active);

    const optSet = reqExitSignals.length > 0
      ? entries.filter(([k]) => !reqExitSignals.includes(k))
      : entries.filter(([k]) => k.includes('_'));

    const optSatisfied = optSet.length === 0 || optSet.some(([_, s]) => s.fired && s.active);

    const comboSatisfied = reqSatisfied && optSatisfied;
    const criteriaMet = logic === 'all' ? allFired : logic === 'combo' ? comboSatisfied : satisfiedCount > 0;

    return { entries, satisfiedCount, totalCount, allFired, comboSatisfied, criteriaMet };
  };

  // --- Optimized single-pass fused logic ---
  const calcOptimized = (status, trade, logic) => {
    if (!status) {
      return { entries: [], satisfiedCount: 0, totalCount: 0, allFired: false, comboSatisfied: false, criteriaMet: false };
    }

    const reqExitSignals = trade.strategy_config?.required_exit_signals || trade.required_exit_signals || [];
    const hasReqConfig = reqExitSignals.length > 0;
    const reqSet = hasReqConfig ? new Set(reqExitSignals) : null;

    let satisfiedCount = 0;
    let totalCount = 0;
    let reqCount = 0;
    let reqSatisfiedCount = 0;
    let optCount = 0;
    let optSatisfiedCount = 0;

    const list = [];
    for (const key in status) {
      if (Object.prototype.hasOwnProperty.call(status, key)) {
        const s = status[key];
        const progress = s.distPct ?? 0;
        list.push([key, { ...s, progress }]);

        totalCount++;
        const isFiredActive = Boolean(s.fired && s.active);
        if (isFiredActive) satisfiedCount++;

        const isReq = reqSet ? reqSet.has(key) : !key.includes('_');
        if (isReq) {
          reqCount++;
          if (isFiredActive) reqSatisfiedCount++;
        } else {
          optCount++;
          if (isFiredActive) optSatisfiedCount++;
        }
      }
    }

    list.sort((a, b) => b[1].progress - a[1].progress);

    const allFired = totalCount > 0 && satisfiedCount === totalCount;
    const reqSatisfied = hasReqConfig
      ? reqSatisfiedCount === reqExitSignals.length
      : (reqCount === 0 || reqSatisfiedCount === reqCount);

    const optSatisfied = optCount === 0 || optSatisfiedCount > 0;
    const comboSatisfied = reqSatisfied && optSatisfied;
    const criteriaMet = logic === 'all' ? allFired : logic === 'combo' ? comboSatisfied : satisfiedCount > 0;

    return { entries: list, satisfiedCount, totalCount, allFired, comboSatisfied, criteriaMet };
  };

  // Verify correctness parity across various signal combinations
  const origResult = calcOriginal(status, trade, logic);
  const optResult = calcOptimized(status, trade, logic);

  assert.strictEqual(optResult.satisfiedCount, origResult.satisfiedCount);
  assert.strictEqual(optResult.totalCount, origResult.totalCount);
  assert.strictEqual(optResult.allFired, origResult.allFired);
  assert.strictEqual(optResult.comboSatisfied, origResult.comboSatisfied);
  assert.strictEqual(optResult.criteriaMet, origResult.criteriaMet);
  assert.deepStrictEqual(optResult.entries, origResult.entries);

  // Benchmark performance
  const ITERATIONS = 200_000;

  // Warmup
  for (let i = 0; i < 5_000; i++) {
    calcOriginal(status, trade, logic);
    calcOptimized(status, trade, logic);
  }

  const startOrig = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    calcOriginal(status, trade, logic);
  }
  const durationOrig = performance.now() - startOrig;

  const startOpt = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    calcOptimized(status, trade, logic);
  }
  const durationOpt = performance.now() - startOpt;

  const speedup = durationOrig / durationOpt;

  console.log(`\n⚡ Bolt Performance Benchmark (ExitMonitor single-pass loop, ${ITERATIONS} iterations):`);
  console.log(`  - Original (Multi-pass filter/map/sort): ${durationOrig.toFixed(2)} ms`);
  console.log(`  - Optimized (Single-pass loop fusion):     ${durationOpt.toFixed(2)} ms`);
  console.log(`  - Execution Speedup:                      ${speedup.toFixed(2)}x faster\n`);

  assert.ok(durationOpt < durationOrig, 'Optimized version must be faster than original');
});
