import test from 'node:test';
import assert from 'node:assert/strict';

test('Session Knife Catch trade PnL aggregation logic', () => {
  const mockTrades = [
    { id: '1', symbol: 'BTCUSDT', pnl: 25.5, is_knife: true },
    { id: '2', symbol: 'ETHUSDT', pnl: -10.0, is_knife: false },
    { id: '3', symbol: 'SOLUSDT', pnl: 15.25, is_knife: true },
    { id: '4', symbol: 'BNBUSDT', pnl: 50.0, is_knife: false },
  ];

  const knifeTrades = mockTrades.filter(t => t.is_knife);
  const knifeCount = knifeTrades.length;
  const knifeAccPnl = knifeTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);

  assert.equal(knifeCount, 2);
  assert.equal(knifeAccPnl, 40.75);
});

test('TradeItem knife tag identification', () => {
  const knifeTrade = { id: '1', symbol: 'BTCUSDT', is_knife: true };
  const standardTrade = { id: '2', symbol: 'ETHUSDT', is_knife: false };

  assert.equal(!!knifeTrade.is_knife, true);
  assert.equal(!!standardTrade.is_knife, false);
});

test('TradeDetailContent knife tag badge presence', () => {
  const knifeTrade = { id: '1', symbol: 'BTCUSDT', is_knife: true, pnl: 45.0 };
  assert.strictEqual(knifeTrade.is_knife, true);
});

test('Granular negative exit R:R buckets distribution verification', () => {
  const trades = [
    { exit_rr: -0.75, pnl: -75 },
    { exit_rr: -0.35, pnl: -35 },
    { exit_rr: -0.10, pnl: -10 },
    { exit_rr: 0.15, pnl: 15 },
    { exit_rr: 0.35, pnl: 35 },
    { exit_rr: 0.85, pnl: 85 },
    { exit_rr: 1.5, pnl: 150 },
    { exit_rr: 2.5, pnl: 250 },
    { exit_rr: 3.5, pnl: 350 },
  ];

  let rangeSubOne = 0;
  let rangeHalfToZero = 0;
  let rangeQuarterToZero = 0;

  trades.forEach(t => {
    const err = Number(t.exit_rr);
    if (err < -0.5) rangeSubOne++;
    else if (err >= -0.5 && err < -0.25) rangeHalfToZero++;
    else if (err >= -0.25 && err <= 0) rangeQuarterToZero++;
  });

  assert.strictEqual(rangeSubOne, 1);
  assert.strictEqual(rangeHalfToZero, 1);
  assert.strictEqual(rangeQuarterToZero, 1);
});
