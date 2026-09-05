import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('USDT Pair Filtering Unit Tests', () => {
  const sampleOpportunities = [
    { symbol: 'BTCUSDT', pct: 2.5, score: 85 },
    { symbol: 'ETHUSDT', pct: -1.2, score: 70 },
    { symbol: 'TRUMPUSDC', pct: 5.0, score: 90 },
    { symbol: 'BTCUSDC', pct: 0.8, score: 60 },
    { symbol: 'SOLUSDT', pct: 3.1, score: 80 },
    { symbol: 'BTCEUR', pct: -2.0, score: 50 },
    { symbol: 'BNBBUSD', pct: 1.5, score: 65 },
  ];

  test('filters out non-USDT pairs correctly when USDT Pairs filter is active', () => {
    const usdtOnly = sampleOpportunities.filter(r => (r.symbol || '').toUpperCase().endsWith('USDT'));

    assert.strictEqual(usdtOnly.length, 3);
    assert.deepStrictEqual(
      usdtOnly.map(o => o.symbol),
      ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
    );
    assert.strictEqual(usdtOnly.some(o => o.symbol === 'TRUMPUSDC'), false);
    assert.strictEqual(usdtOnly.some(o => o.symbol === 'BTCUSDC'), false);
  });

  test('isolates non-USDT pairs correctly when non_usdt filter is active', () => {
    const nonUsdtOnly = sampleOpportunities.filter(r => !(r.symbol || '').toUpperCase().endsWith('USDT'));

    assert.strictEqual(nonUsdtOnly.length, 4);
    assert.deepStrictEqual(
      nonUsdtOnly.map(o => o.symbol),
      ['TRUMPUSDC', 'BTCUSDC', 'BTCEUR', 'BNBBUSD']
    );
    assert.strictEqual(nonUsdtOnly.some(o => o.symbol === 'BTCUSDT'), false);
  });

  test('handles empty or malformed symbol objects gracefully without throwing', () => {
    const edgeCaseList = [
      { symbol: null },
      { symbol: undefined },
      { symbol: '' },
      { symbol: 'ETHUSDT' },
    ];

    const filtered = edgeCaseList.filter(r => (r.symbol || '').toUpperCase().endsWith('USDT'));
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].symbol, 'ETHUSDT');
  });
});
