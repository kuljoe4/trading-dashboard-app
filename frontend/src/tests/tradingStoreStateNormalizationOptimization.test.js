import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

class StorageMock {
  constructor() {
    this.store = {};
  }
  clear() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new StorageMock();
}
if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = new StorageMock();
}

const { normalizeOpportunity, normalizeTrade } = await import('../store/trading.js');

describe('Trading Store State Normalization Optimization', () => {
  it('preserves object reference when opportunity fingerprint matches', () => {
    const rawOpp = {
      symbol: 'BTCUSDT',
      pct: 2.5,
      dir: 'long',
      vol: 1000000,
      score: 85,
      price: 50000
    };

    const first = normalizeOpportunity(rawOpp);
    assert.ok(first !== null);

    const rawOpp2 = {
      symbol: 'BTCUSDT',
      pct: 2.5,
      dir: 'long',
      vol: 1000000,
      score: 85,
      price: 50000
    };

    const second = normalizeOpportunity(rawOpp2, first);
    assert.strictEqual(second, first, 'Should reuse identical reference when fingerprint matches');
  });

  it('correctly maps active trades and scanner results using Map lookup', () => {
    const currentActiveTrades = [
      { id: 't1', symbol: 'BTCUSDT', pnl: 10, current_price: 50000, entry_price: 49000, direction: 'LONG' },
      { id: 't2', symbol: 'ETHUSDT', pnl: -5, current_price: 3000, entry_price: 3050, direction: 'SHORT' }
    ].map(t => normalizeTrade(t));

    const currentScannerResults = [
      { symbol: 'BTCUSDT', pct: 2.5, score: 80, price: 50000 },
      { symbol: 'ETHUSDT', pct: -1.2, score: 60, price: 3000 }
    ].map(o => normalizeOpportunity(o));

    const activeTradesMap = new Map(currentActiveTrades.map(t => [t.symbol, t]));
    const scannerMap = new Map(currentScannerResults.map(o => [o.symbol, o]));

    const updateTradeRaw = { symbol: 'BTCUSDT', pnl: 15, current_price: 50500 };
    const normalizedTrade = normalizeTrade(updateTradeRaw, activeTradesMap.get('BTCUSDT'), false);

    assert.strictEqual(normalizedTrade.symbol, 'BTCUSDT');
    assert.strictEqual(normalizedTrade.pnl, 15);
    assert.strictEqual(normalizedTrade.entry_price, 49000);

    const updateOppRaw = { symbol: 'BTCUSDT', pct: 2.5, score: 80, price: 50000 };
    const normalizedOpp = normalizeOpportunity(updateOppRaw, scannerMap.get('BTCUSDT'));

    assert.strictEqual(normalizedOpp, currentScannerResults[0], 'Should return identical reference for unchanged opportunity');
  });

  it('benchmark: verifies O(N+M) Map lookup execution speedup over O(N*M) linear .find()', () => {
    const tradesCount = 50;
    const scannerCount = 200;
    const iterations = 5000;

    const mockTrades = Array.from({ length: tradesCount }, (_, i) => ({
      id: `t_${i}`,
      symbol: `SYM_${i}`,
      pnl: i * 5,
      current_price: 100 + i,
      entry_price: 95 + i,
      direction: 'LONG'
    })).map(t => normalizeTrade(t));

    const mockOpportunities = Array.from({ length: scannerCount }, (_, i) => ({
      symbol: `SYM_${i}`,
      pct: (i % 10) * 0.5,
      score: 50 + (i % 50),
      price: 100 + i
    })).map(o => normalizeOpportunity(o));

    const incomingTrades = mockTrades.map(t => ({ symbol: t.symbol, pnl: t.pnl + 0.1 }));
    const incomingOpps = mockOpportunities.map(o => ({ symbol: o.symbol, pct: o.pct, score: o.score, price: o.price }));

    // Measure Unoptimized (.find())
    const startUnopt = performance.now();
    for (let iter = 0; iter < iterations; iter++) {
      const activeTrades = incomingTrades.map(t => normalizeTrade(t, mockTrades.find(x => x.symbol === t.symbol), false));
      const scannerResults = incomingOpps.map(o => normalizeOpportunity(o, mockOpportunities.find(x => x.symbol === o.symbol)));
    }
    const durationUnopt = performance.now() - startUnopt;

    // Measure Optimized (Map lookup)
    const startOpt = performance.now();
    for (let iter = 0; iter < iterations; iter++) {
      const activeTradesMap = new Map(mockTrades.map(t => [t.symbol, t]));
      const scannerMap = new Map(mockOpportunities.map(o => [o.symbol, o]));
      const activeTrades = incomingTrades.map(t => normalizeTrade(t, activeTradesMap.get(t.symbol), false));
      const scannerResults = incomingOpps.map(o => normalizeOpportunity(o, scannerMap.get(o.symbol)));
    }
    const durationOpt = performance.now() - startOpt;

    console.log(`\n⚡ Bolt Performance Benchmark (state normalization with Map lookup vs .find(), ${iterations} iterations):`);
    console.log(`  - Unoptimized (.find() linear scans): ${durationUnopt.toFixed(2)} ms`);
    console.log(`  - Optimized (Map O(1) lookups):       ${durationOpt.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                  ${(durationUnopt / durationOpt).toFixed(2)}x faster\n`);

    assert.ok(durationOpt < durationUnopt, 'Map lookup must be strictly faster than linear .find()');
  });
});
