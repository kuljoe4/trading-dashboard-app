import test from 'node:test';
import assert from 'node:assert';
import { analyzeTradeDiagnostics } from '../utils/tradeDiagnostics.js';

test('analyzeTradeDiagnostics detects missing SL and generates error issue', () => {
  const trade = {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 50000,
    current_sl: 0,
    initial_sl: 0,
    qty: 1,
    status: 'OPEN'
  };

  const result = analyzeTradeDiagnostics(trade, { paper_mode: false });
  assert.strictEqual(result.hasError, true);
  assert.ok(result.issues.some(i => i.code === 'SL_MISSING'));
  assert.ok(result.traceSnippet.includes('Active Trade Diagnostic Trace: BTCUSDT'));
});

test('analyzeTradeDiagnostics detects Guard Ladder discrepancy and generates warning issue', () => {
  const trade = {
    symbol: 'ETHUSDT',
    direction: 'LONG',
    entry_price: 3000,
    initial_sl: 2900, // riskUnit = 100
    current_sl: 2900,
    rr_sequence_index: 0,
    live_rr_sequence: [1, 2],
    exit_rr_sequence: [0.5, 1], // expected target SL for index 0 is 3000 + 100*0.5 = 3050
    qty: 2,
    status: 'OPEN'
  };

  const result = analyzeTradeDiagnostics(trade, { paper_mode: true });
  assert.strictEqual(result.hasWarning, true);
  assert.ok(result.issues.some(i => i.code === 'SL_LADDER_DISCREPANCY'));
  assert.ok(result.traceSnippet.includes('Guard Ladder Discrepancy'));
});

test('analyzeTradeDiagnostics detects close blocked and exit warmup status', () => {
  const trade = {
    symbol: 'SOLUSDT',
    direction: 'SHORT',
    entry_price: 150,
    initial_sl: 155,
    current_sl: 155,
    qty: 10,
    status: 'OPEN',
    close_blocked: true,
    illiquid_blocked: true,
    is_reconciliation: true,
    exit_signals_status: {
      supertrend: { is_warming_up: true, warmup_candles: 10, required_warmup: 50, warmup_tf: '4h' }
    }
  };

  const result = analyzeTradeDiagnostics(trade, { paper_mode: true });
  assert.strictEqual(result.hasError, true);
  assert.strictEqual(result.hasWarning, true);
  assert.ok(result.issues.some(i => i.code === 'CLOSE_BLOCKED'));
  assert.ok(result.issues.some(i => i.code === 'EXIT_WARMUP_INCOMPLETE'));
  assert.ok(result.issues.some(i => i.code === 'RECONCILIATION_ADOPTED'));
});
