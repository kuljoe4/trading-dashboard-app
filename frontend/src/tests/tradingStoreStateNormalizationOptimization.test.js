import '../store/mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeTrade, normalizeOpportunity } from '../store/trading.js';

test('trading store state normalization: Map-based lookup and reference reuse correctness', () => {
  const currentActiveTrades = [
    { symbol: 'BTCUSDT', id: 't1', entry_price: 60000, current_sl: 59000, qty: 0.1, status: 'OPEN' },
    { symbol: 'ETHUSDT', id: 't2', entry_price: 3000, current_sl: 2900, qty: 1.0, status: 'OPEN' },
    { symbol: 'SOLUSDT', id: 't3', entry_price: 150, current_sl: 145, qty: 10, status: 'OPEN' }
  ];

  const incomingActiveTrades = [
    { symbol: 'ETHUSDT', id: 't2', entry_price: 3000, current_sl: 2910, qty: 1.0, status: 'OPEN' },
    { symbol: 'SOLUSDT', id: 't3', entry_price: 150, current_sl: 146, qty: 10, status: 'OPEN' },
    { symbol: 'BTCUSDT', id: 't1', entry_price: 60000, current_sl: 59500, qty: 0.1, status: 'OPEN' }
  ];

  const activeTradesMap = new Map(currentActiveTrades.map(t => [t.symbol, t]));

  const normalized = incomingActiveTrades.map(t => normalizeTrade(t, activeTradesMap.get(t.symbol), false));

  assert.strictEqual(normalized.length, 3);
  assert.strictEqual(normalized[0].symbol, 'ETHUSDT');
  assert.strictEqual(normalized[0].current_sl, 2910);
  assert.strictEqual(normalized[2].symbol, 'BTCUSDT');
  assert.strictEqual(normalized[2].current_sl, 59500);

  // Scanner opportunity fingerprint reference reuse test
  const currentScanner = [
    normalizeOpportunity({
      symbol: 'BTCUSDT',
      pct: 2.0,
      dir: 'long',
      vol: 1000000,
      score: 80,
      price: 65000,
      signalResult: { allFired: false, firedSignals: [], reason: 'Monitoring' }
    }),
    normalizeOpportunity({
      symbol: 'ETHUSDT',
      pct: -1.5,
      dir: 'short',
      vol: 500000,
      score: 75,
      price: 3500,
      signalResult: { allFired: false, firedSignals: [], reason: 'Monitoring' }
    })
  ];

  const scannerMap = new Map(currentScanner.map(o => [o.symbol, o]));

  const incomingScannerPayload = [
    {
      symbol: 'BTCUSDT',
      pct: 2.0,
      dir: 'long',
      vol: 1000000,
      score: 80,
      price: 65000,
      signalResult: { allFired: false, firedSignals: [], reason: 'Monitoring' }
    },
    {
      symbol: 'ETHUSDT',
      pct: -1.5,
      dir: 'short',
      vol: 500000,
      score: 75,
      price: 3500,
      signalResult: { allFired: false, firedSignals: [], reason: 'Monitoring' }
    }
  ];

  const reNormalizedScanner = incomingScannerPayload.map(o => normalizeOpportunity(o, scannerMap.get(o.symbol)));

  // Assert exact object reference equality (fingerprint matched -> returns prev)
  assert.strictEqual(reNormalizedScanner[0], currentScanner[0], 'Unchanged BTCUSDT opportunity must reuse previous object reference');
  assert.strictEqual(reNormalizedScanner[1], currentScanner[1], 'Unchanged ETHUSDT opportunity must reuse previous object reference');
});

test('trading store state normalization: benchmark comparison Map lookup vs O(N) find', () => {
  const symbolCount = 50;
  const currentTrades = [];
  const incomingTrades = [];

  for (let i = 0; i < symbolCount; i++) {
    const sym = `SYM_${i}USDT`;
    currentTrades.push({ symbol: sym, id: `trade_${i}`, entry_price: 100 + i, current_sl: 95 + i, qty: 1.0, status: 'OPEN' });
    incomingTrades.push({ symbol: sym, id: `trade_${i}`, entry_price: 100 + i, current_sl: 96 + i, qty: 1.0, status: 'OPEN' });
  }

  const iterations = 20000;

  // Unoptimized: array.find inside map loop (O(N^2))
  const startUnopt = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    incomingTrades.map(t => normalizeTrade(t, currentTrades.find(x => x.symbol === t.symbol), false));
  }
  const durUnopt = performance.now() - startUnopt;

  // Optimized: Map pre-indexed lookup (O(N))
  const startOpt = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    const activeMap = new Map(currentTrades.map(x => [x.symbol, x]));
    incomingTrades.map(t => normalizeTrade(t, activeMap.get(t.symbol), false));
  }
  const durOpt = performance.now() - startOpt;

  console.log(`\n⚡ Bolt Performance Benchmark (Active Trades Normalization, ${iterations} iterations, ${symbolCount} trades):`);
  console.log(`  - Original (O(N^2) .find()):  ${durUnopt.toFixed(2)} ms`);
  console.log(`  - Optimized (O(N) Map lookup): ${durOpt.toFixed(2)} ms`);
  console.log(`  - Execution Speedup:           ${(durUnopt / durOpt).toFixed(2)}x faster`);

  assert.ok(durOpt < durUnopt, 'Map lookup implementation should be faster than linear array.find()');
});
