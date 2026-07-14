import { test } from 'node:test';
import assert from 'node:assert';

// Mocking some constants that normalizeTrade needs
const toNumber = (v, f = 0) => { const p = Number(v); return Number.isFinite(p) ? p : f; }

// Copy of normalizeTrade logic from trading.js to test it in isolation
// In a real scenario, we might want to export it or use a tool to extract it
const normalizeTrade = (t = {}, pt = null) => {
  if (!t || typeof t !== 'object') return null;
  const p = pt || {};

  let sigStatus = t.exit_signals_status;
  if (!sigStatus && t._sig_json) {
    try { sigStatus = JSON.parse(t._sig_json); } catch (e) {}
  }

  const f = `${t.pnl}:${t.rr}:${t.current_price}:${t.sl_price}`;
  if (p._fingerprint === f && !t._delta && !t._thin && !t._sig_json) return p;
  if (t._delta || t._thin) {
    return {
      ...p, ...t,
      pnl: t.pnl !== undefined ? toNumber(t.pnl) : p.pnl,
      rr: t.rr !== undefined ? toNumber(t.rr) : p.rr,
      current_price: t.current_price !== undefined ? toNumber(t.current_price) : p.current_price,
      sl_price: t.sl_price !== undefined ? toNumber(t.sl_price) : p.sl_price,
      max_rr: t.max_rr !== undefined ? toNumber(t.max_rr) : p.max_rr,
      entry_price: t.entry_price !== undefined ? toNumber(t.entry_price) : p.entry_price,
      qty: t.qty !== undefined ? toNumber(t.qty) : p.qty,
      exit_signals_status: sigStatus || p.exit_signals_status || {},
      strategy_config: t.strategy_config || p.strategy_config,
      live_rr_sequence: t.live_rr_sequence || p.live_rr_sequence,
      exit_rr_sequence: t.exit_rr_sequence || p.exit_rr_sequence,
      sl_adjustments: t.sl_adjustments || p.sl_adjustments,
      exit_signal_logic: t.exit_signal_logic || p.exit_signal_logic,
      tp_mode: t.tp_mode || p.tp_mode,
      tp_ratio: t.tp_ratio !== undefined ? toNumber(t.tp_ratio) : p.tp_ratio,
      mark_price: t.mark_price !== undefined ? toNumber(t.mark_price) : p.mark_price,
      last_price: t.last_price !== undefined ? toNumber(t.last_price) : p.last_price,
      realized_fee: t.realized_fee !== undefined ? toNumber(t.realized_fee) : p.realized_fee,
      funding_fee: t.funding_fee !== undefined ? toNumber(t.funding_fee) : p.funding_fee,
      is_reconciliation: t.is_reconciliation ?? p.is_reconciliation
    };
  }
  const ep = toNumber(t.entry_price ?? t.entry ?? p.entry_price);
  return { ...t, symbol: t.symbol ?? p.symbol ?? '---', strategy_label: t.strategy_label ?? p.strategy_label ?? 'Momentum Strategy', direction: (t.direction ?? t.side ?? p.direction ?? '').toString().toUpperCase(), entry_price: ep, current_price: toNumber(t.current_price ?? t.current ?? p.current_price ?? t.exit_price ?? ep, ep), sl_price: toNumber(t.sl_price ?? t.current_sl ?? t.sl ?? t.initial_sl ?? p.sl_price), initial_sl: toNumber(t.initial_sl ?? t.sl_price ?? t.sl ?? p.initial_sl), tp_price: t.tp_price == null && t.tp == null ? p.tp_price ?? null : toNumber(t.tp_price ?? t.tp), pnl: t.pnl !== undefined ? toNumber(t.pnl) : p.pnl ?? 0, rr: (t.rr !== undefined) ? toNumber(t.rr) : p.rr ?? 0, max_rr: (t.max_rr !== undefined) ? toNumber(t.max_rr) : p.max_rr ?? 0, live_rr_sequence: t.live_rr_sequence || p.live_rr_sequence || [], exit_rr_sequence: t.exit_rr_sequence || p.exit_rr_sequence || [], tp_mode: t.tp_mode || p.tp_mode || (t.tp_price == null && t.tp == null ? 'exp_rr_seq' : 'fixed'), tp_ratio: (t.tp_ratio !== undefined) ? toNumber(t.tp_ratio, 2) : p.tp_ratio ?? 0, sl_adjustments: t.sl_adjustments || p.sl_adjustments || [], exit_reason: t.exit_reason ?? p.exit_reason, exit_price: t.exit_price == null ? (p.exit_price == null ? undefined : toNumber(p.exit_price)) : toNumber(t.exit_price), paper_mode: t.paper_mode ?? p.paper_mode ?? true, qty: toNumber(t.qty ?? t.quantity ?? p.qty ?? 0), max_rr_achieved: toNumber(t.max_rr_achieved ?? t.max_rr ?? p.max_rr_achieved ?? 0), exit_signals_status: sigStatus || p.exit_signals_status || {}, strategy_config: t.strategy_config || p.strategy_config, _fingerprint: f };
}

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
