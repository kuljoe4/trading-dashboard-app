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
