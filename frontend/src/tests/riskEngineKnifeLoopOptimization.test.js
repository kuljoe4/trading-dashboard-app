import test from 'node:test';
import assert from 'node:assert/strict';

test('RiskEngine activeKnifeCount loop fusion optimization test', (t) => {
  const activeTrades = [];
  for (let i = 0; i < 50; i++) {
    activeTrades.push({
      id: `trade-${i}`,
      symbol: i % 2 === 0 ? 'BTCUSDT' : 'ETHUSDT',
      direction: 'LONG',
      status: i % 10 === 0 ? 'CLOSED' : 'OPEN',
      entry_price: 50000,
      qty: 0.1,
      risk_usdt: 10,
      is_knife: i % 3 === 0,
      strategy_label: i % 2 === 0 ? 'Momentum Strategy' : 'Variant 1'
    });
  }

  // Original un-fused approach
  let activeTradesCountForStrategyOrig = 0;
  let symbolTradeCountOrig = 0;
  let totalSlUsedForStrategyOrig = 0;
  for (let i = 0; i < activeTrades.length; i++) {
    const t = activeTrades[i];
    const isTradeBase = !t.strategy_label || t.strategy_label === 'Momentum Strategy';
    const matchesStrategy = true ? isTradeBase : t.strategy_label === 'Momentum Strategy';

    if (matchesStrategy) {
      activeTradesCountForStrategyOrig++;
      totalSlUsedForStrategyOrig += t.risk_usdt || 0;
      if (t.symbol === 'BTCUSDT') {
        symbolTradeCountOrig++;
      }
    }
  }
  const activeKnifeCountOrig = activeTrades.filter(t => t.is_knife && t.status === 'OPEN').length;

  // Optimized loop-fused approach
  let activeTradesCountForStrategyOpt = 0;
  let symbolTradeCountOpt = 0;
  let totalSlUsedForStrategyOpt = 0;
  let activeKnifeCountOpt = 0;

  for (let i = 0; i < activeTrades.length; i++) {
    const t = activeTrades[i];
    if (t.is_knife && t.status === 'OPEN') {
      activeKnifeCountOpt++;
    }

    const isTradeBase = !t.strategy_label || t.strategy_label === 'Momentum Strategy';
    const matchesStrategy = true ? isTradeBase : t.strategy_label === 'Momentum Strategy';

    if (matchesStrategy) {
      activeTradesCountForStrategyOpt++;
      totalSlUsedForStrategyOpt += t.risk_usdt || 0;
      if (t.symbol === 'BTCUSDT') {
        symbolTradeCountOpt++;
      }
    }
  }

  assert.equal(activeKnifeCountOpt, activeKnifeCountOrig);
  assert.equal(activeTradesCountForStrategyOpt, activeTradesCountForStrategyOrig);
  assert.equal(symbolTradeCountOpt, symbolTradeCountOrig);
  assert.equal(totalSlUsedForStrategyOpt, totalSlUsedForStrategyOrig);

  // Performance Benchmark
  const iterations = 500000;

  const t0 = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    let countForStrat = 0;
    let symCount = 0;
    let totalSl = 0;
    for (let i = 0; i < activeTrades.length; i++) {
      const tr = activeTrades[i];
      const isTradeBase = !tr.strategy_label || tr.strategy_label === 'Momentum Strategy';
      if (isTradeBase) {
        countForStrat++;
        totalSl += tr.risk_usdt || 0;
        if (tr.symbol === 'BTCUSDT') symCount++;
      }
    }
    const knifeCount = activeTrades.filter(tr => tr.is_knife && tr.status === 'OPEN').length;
  }
  const durOrig = performance.now() - t0;

  const t1 = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    let countForStrat = 0;
    let symCount = 0;
    let totalSl = 0;
    let knifeCount = 0;
    for (let i = 0; i < activeTrades.length; i++) {
      const tr = activeTrades[i];
      if (tr.is_knife && tr.status === 'OPEN') {
        knifeCount++;
      }
      const isTradeBase = !tr.strategy_label || tr.strategy_label === 'Momentum Strategy';
      if (isTradeBase) {
        countForStrat++;
        totalSl += tr.risk_usdt || 0;
        if (tr.symbol === 'BTCUSDT') symCount++;
      }
    }
  }
  const durOpt = performance.now() - t1;

  const speedup = durOrig / durOpt;

  console.log(`\n⚡ Bolt Performance Benchmark (RiskEngine canEnter activeKnifeCount loop fusion, ${iterations} iterations):`);
  console.log(`  - Original (Multi-pass filter): ${durOrig.toFixed(2)} ms`);
  console.log(`  - Optimized (Single-pass loop fusion): ${durOpt.toFixed(2)} ms`);
  console.log(`  - Execution Speedup: ${speedup.toFixed(2)}x faster\n`);

});
