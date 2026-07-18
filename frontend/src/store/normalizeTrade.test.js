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

test('normalizeTrade calculates pnl_pct fallback and preserves explicitly set pnl_pct', (t) => {
  // Case A: pnl_pct explicitly set
  const tradeA = {
    entry_price: 100,
    current_price: 110,
    direction: 'LONG',
    pnl_pct: 10.5 // slightly different from simple calculation to prove explicit value is used
  };
  const normA = normalizeTrade(tradeA);
  assert.strictEqual(normA.pnl_pct, 10.5);

  // Case B: pnl_pct is missing, falls back to calculated LONG
  const tradeB = {
    entry_price: 100,
    current_price: 110,
    direction: 'LONG'
  };
  const normB = normalizeTrade(tradeB);
  assert.strictEqual(normB.pnl_pct, 10.0);

  // Case C: pnl_pct is missing, falls back to calculated SHORT
  const tradeC = {
    entry_price: 100,
    current_price: 90,
    direction: 'SHORT'
  };
  const normC = normalizeTrade(tradeC);
  assert.strictEqual(normC.pnl_pct, 10.0);
});

test('normalizeTrade preserves all TradeEntity custom/additional fields during delta updates', (t) => {
  const previousState = {
    symbol: 'BTCUSDT',
    entry_daily_change_pct: 1.25,
    rr_sequence_index: 2,
    close_attempts: 1,
    last_close_attempt_ts: 1780000000000,
    strategy_label: 'Custom Strategy',
    strategy_config: { key: 'value' }
  };

  const deltaUpdate = {
    _delta: true,
    pnl: 150
  };

  const nextState = normalizeTrade(deltaUpdate, previousState);

  assert.strictEqual(nextState.pnl, 150);
  assert.strictEqual(nextState.entry_daily_change_pct, 1.25, 'entry_daily_change_pct should be preserved');
  assert.strictEqual(nextState.rr_sequence_index, 2, 'rr_sequence_index should be preserved');
  assert.strictEqual(nextState.close_attempts, 1, 'close_attempts should be preserved');
  assert.strictEqual(nextState.last_close_attempt_ts, 1780000000000, 'last_close_attempt_ts should be preserved');
  assert.strictEqual(nextState.strategy_label, 'Custom Strategy', 'strategy_label should be preserved');
  assert.deepStrictEqual(nextState.strategy_config, { key: 'value' }, 'strategy_config should be preserved');
});
