import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeTrade } from './trading.js';

test('normalizeTrade preserves critical fields during delta updates', (t) => {
  const previousState = {
    symbol: 'BTCUSDT',
    mark_price: 50000,
    last_price: 50010,
    realized_fee: 5.5,
    funding_fee: -0.2,
    is_reconciliation: true,
    pnl: 100,
    rr: 1.5,
    current_price: 50100,
    sl_price: 49000,
    _fingerprint: '100:1.5:50100:49000'
  };

  const deltaUpdate = {
    _delta: true,
    pnl: 110,
    rr: 1.6,
    current_price: 50110
  };

  const nextState = normalizeTrade(deltaUpdate, previousState);

  assert.strictEqual(nextState.pnl, 110);
  assert.strictEqual(nextState.rr, 1.6);
  assert.strictEqual(nextState.mark_price, 50000, 'mark_price should be preserved');
  assert.strictEqual(nextState.last_price, 50010, 'last_price should be preserved');
  assert.strictEqual(nextState.realized_fee, 5.5, 'realized_fee should be preserved');
  assert.strictEqual(nextState.funding_fee, -0.2, 'funding_fee should be preserved');
  assert.strictEqual(nextState.is_reconciliation, true, 'is_reconciliation should be preserved');
});

test('normalizeTrade updates critical fields when provided in delta', (t) => {
  const previousState = {
    mark_price: 50000,
    realized_fee: 5.5,
  };

  const deltaUpdate = {
    _delta: true,
    mark_price: 50500,
    realized_fee: 6.0
  };

  const nextState = normalizeTrade(deltaUpdate, previousState);

  assert.strictEqual(nextState.mark_price, 50500, 'mark_price should be updated');
  assert.strictEqual(nextState.realized_fee, 6.0, 'realized_fee should be updated');
});
