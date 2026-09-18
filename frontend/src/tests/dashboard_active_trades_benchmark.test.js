import test from 'node:test';
import assert from 'node:assert';

test('Dashboard active trades loop fusion benchmark', () => {
  const currentStrategy = { strategy_label: 'Momentum Strategy' };
  const config = {
    strategy_variants: [
      { strategy_label: 'Variant A' },
      { strategy_label: 'Variant B' },
      { strategy_label: 'Variant C' },
    ]
  };

  const activeTrades = Array.from({ length: 50 }, (_, i) => ({
    symbol: `SYM_${i}`,
    strategy_label: i % 4 === 0 ? 'Momentum Strategy' : i % 4 === 1 ? 'Variant A' : i % 4 === 2 ? 'Variant B' : 'Variant C',
    pnl: (i % 2 === 0 ? 1 : -1) * i * 5,
    est_pnl_to_realize: i * 2,
    max_rr: i * 0.1,
    max_rr_achieved: i * 0.08,
  }));

  const safeNum = (val) => typeof val === 'number' && !isNaN(val) ? val : 0;

  const ITERATIONS = 100_000;

  const runOriginal = (iterations) => {
    let lastRes;
    for (let iter = 0; iter < iterations; iter++) {
      const strategyLabel = currentStrategy.strategy_label;
      const pnlMap = { [strategyLabel]: 0 };
      const estPnlMap = { [strategyLabel]: 0 };
      const countMap = { [strategyLabel]: 0 };

      const variants = config.strategy_variants || [];
      for (let i = 0; i < variants.length; i++) {
        const label = variants[i].strategy_label || 'Variant';
        pnlMap[label] = 0;
        estPnlMap[label] = 0;
        countMap[label] = 0;
      }

      const trades = activeTrades || [];
      for (let i = 0; i < trades.length; i++) {
        const t = trades[i];
        if (t) {
          const label = pnlMap[t.strategy_label] !== undefined ? t.strategy_label : strategyLabel;
          const pnlVal = safeNum(t.pnl);
          pnlMap[label] += pnlVal;
          estPnlMap[label] += safeNum(t.est_pnl_to_realize);
          countMap[label]++;
        }
      }

      const pnlValues = Object.values(pnlMap);
      let totPnl = 0;
      for (let i = 0; i < pnlValues.length; i++) {
        totPnl += pnlValues[i];
      }

      const maxRR = (activeTrades || []).reduce((max, trade) => Math.max(max, Number(trade.max_rr ?? trade.max_rr_achieved ?? 0)), 0);
      lastRes = { pnlMap, estPnlMap, countMap, totPnl, maxRR };
    }
    return lastRes;
  };

  const runOptimized = (iterations) => {
    let lastRes;
    for (let iter = 0; iter < iterations; iter++) {
      const strategyLabel = currentStrategy.strategy_label;
      const pnlMap = { [strategyLabel]: 0 };
      const estPnlMap = { [strategyLabel]: 0 };
      const countMap = { [strategyLabel]: 0 };

      const variants = config.strategy_variants || [];
      for (let i = 0; i < variants.length; i++) {
        const label = variants[i].strategy_label || 'Variant';
        pnlMap[label] = 0;
        estPnlMap[label] = 0;
        countMap[label] = 0;
      }

      let maxRR = 0;
      let totPnl = 0;
      const trades = activeTrades || [];
      for (let i = 0; i < trades.length; i++) {
        const t = trades[i];
        if (t) {
          const label = pnlMap[t.strategy_label] !== undefined ? t.strategy_label : strategyLabel;
          const pnlVal = safeNum(t.pnl);
          pnlMap[label] += pnlVal;
          totPnl += pnlVal;
          estPnlMap[label] += safeNum(t.est_pnl_to_realize);
          countMap[label]++;

          const rrVal = Number(t.max_rr ?? t.max_rr_achieved ?? 0);
          if (rrVal > maxRR) maxRR = rrVal;
        }
      }
      lastRes = { pnlMap, estPnlMap, countMap, totPnl, maxRR };
    }
    return lastRes;
  };

  // Warmup JIT for both paths
  runOriginal(10_000);
  runOptimized(10_000);

  // Pattern 1: Separate useMemos (current approach)
  const startOriginal = performance.now();
  runOriginal(ITERATIONS);
  const endOriginal = performance.now();
  const durationOriginal = endOriginal - startOriginal;

  // Pattern 2: Fused single useMemo loop
  const startOptimized = performance.now();
  runOptimized(ITERATIONS);
  const endOptimized = performance.now();
  const durationOptimized = endOptimized - startOptimized;

  console.log(`[BENCHMARK] Separate useMemos: ${durationOriginal.toFixed(2)}ms`);
  console.log(`[BENCHMARK] Fused single useMemo: ${durationOptimized.toFixed(2)}ms`);
  console.log(`[BENCHMARK] Speedup: ${(durationOriginal / durationOptimized).toFixed(2)}x faster`);

  assert(durationOptimized < durationOriginal);
});
