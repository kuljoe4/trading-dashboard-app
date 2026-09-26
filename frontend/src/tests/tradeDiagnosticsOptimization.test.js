import test from 'node:test';
import assert from 'node:assert';
import { analyzeTradeDiagnostics } from '../utils/tradeDiagnostics.js';

test('analyzeTradeDiagnostics optimization: correctness & output parity', () => {
  const trade = {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 50000,
    current_price: 51000,
    sl_price: 49000,
    initial_sl: 49000,
    qty: 1,
    live_rr_sequence: [1, 2, 3],
    exit_rr_sequence: [0.5, 1, 2],
    max_rr: 1.5,
    exit_signals_status: {
      ema_fast: { fired: false, active: true, progress: 45, warmup_candles: 10, required_warmup: 20, is_warming_up: true },
      macd_hist: { fired: false, active: true, progress: 80 }
    }
  };

  const result = analyzeTradeDiagnostics(trade, { paper_mode: true });

  assert.strictEqual(typeof result.hasError, 'boolean');
  assert.strictEqual(typeof result.hasWarning, 'boolean');
  assert.strictEqual(result.hasWarning, true);
  assert.strictEqual(result.hasError, false);
  assert.ok(Array.isArray(result.issues));
  assert.strictEqual(result.issues.length, 2);
  assert.ok(result.issues.some(i => i.code === 'SL_LADDER_DISCREPANCY'));
  assert.ok(result.issues.some(i => i.code === 'EXIT_WARMUP_INCOMPLETE'));

  // Verify traceSnippet lazy getter evaluates properly
  assert.ok(typeof result.traceSnippet === 'string');
  assert.ok(result.traceSnippet.includes('Active Trade Diagnostic Trace: BTCUSDT'));
  assert.ok(result.traceSnippet.includes('`ema_fast`: Fired=false, Active=true, Progress=45.0% (Warming: 10/20 - undefined)'));
});

test('analyzeTradeDiagnostics performance benchmark', () => {
  const trade = {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 50000,
    current_price: 51000,
    sl_price: 49000,
    initial_sl: 49000,
    qty: 1,
    live_rr_sequence: [1, 2, 3],
    exit_rr_sequence: [0.5, 1, 2],
    max_rr: 1.5,
    exit_signals_status: {
      ema_fast: { fired: false, active: true, progress: 45, warmup_candles: 10, required_warmup: 20, is_warming_up: true },
      macd_hist: { fired: false, active: true, progress: 80 }
    }
  };

  const iterations = 100000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const res = analyzeTradeDiagnostics(trade, {});
    if (res.hasError || res.hasWarning) {
      // Hot path in UI components checking issues
    }
  }
  const duration = performance.now() - start;

  console.log(`\n⚡ Bolt Performance Benchmark (analyzeTradeDiagnostics with lazy traceSnippet, ${iterations} iterations):`);
  console.log(`  - Total Time: ${duration.toFixed(2)} ms`);
  console.log(`  - Time per call: ${((duration / iterations) * 1000).toFixed(2)} us`);

  assert.ok(duration < 800, `Execution time must be under 800ms for ${iterations} iterations (got ${duration.toFixed(2)}ms)`);
});
