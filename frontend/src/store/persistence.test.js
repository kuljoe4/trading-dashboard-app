import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { useTradingStore } from './trading.js';

test('Zustand store local storage persistence partialize whitelist validation', async (t) => {
  await t.test('partialize excludes heavy static API response fields', () => {
    const options = useTradingStore.persist.getOptions();
    assert.ok(options, 'Persist options must be configured');
    assert.strictEqual(options.name, 'momentum_trading_store', 'Store name must match momentum_trading_store');

    const partializeFn = options.partialize;
    assert.strictEqual(typeof partializeFn, 'function', 'partialize must be a function');

    const dummyState = {
      sessionActive: true,
      strategyId: 'test-strategy-uuid',
      balance: 15000,
      totalPnl: 350.5,
      activeTrades: [{ id: 'trade-1', symbol: 'BTCUSDT' }],
      totalRiskPct: 1.5,
      totalSlUsed: 150,
      config: { paper_mode: true },
      variantStats: { 'Momentum Strategy': {} },
      lastScanTs: 1680000000000,
      lastAuthoritativeUpdateTs: 1680000100000,
      // Heavy static fields that must be excluded:
      tradeHistory: [{ id: 'closed-1', pnl: 50 }],
      lifetimeAnalytics: { cumulativePnL: [] },
      analytics: { maxDrawdown: 5 }
    };

    const partialized = partializeFn(dummyState);

    // Verify included fields
    assert.strictEqual(partialized.sessionActive, true);
    assert.strictEqual(partialized.strategyId, 'test-strategy-uuid');
    assert.strictEqual(partialized.balance, 15000);
    assert.strictEqual(partialized.totalPnl, 350.5);
    assert.deepStrictEqual(partialized.activeTrades, [{ id: 'trade-1', symbol: 'BTCUSDT' }]);
    assert.strictEqual(partialized.totalRiskPct, 1.5);
    assert.strictEqual(partialized.totalSlUsed, 150);
    assert.deepStrictEqual(partialized.config, { paper_mode: true });
    assert.deepStrictEqual(partialized.variantStats, { 'Momentum Strategy': {} });
    assert.strictEqual(partialized.lastScanTs, 1680000000000);
    assert.strictEqual(partialized.lastAuthoritativeUpdateTs, 1680000100000);

    // Verify excluded heavy fields
    assert.strictEqual(partialized.tradeHistory, undefined, 'tradeHistory must be excluded from partialize to avoid local storage bloat');
    assert.strictEqual(partialized.lifetimeAnalytics, undefined, 'lifetimeAnalytics must be excluded from partialize to avoid local storage bloat');
    assert.strictEqual(partialized.analytics, undefined, 'analytics must be excluded from partialize to avoid local storage bloat');
  });
});
