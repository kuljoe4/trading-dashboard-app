import { test } from 'node:test'
import assert from 'node:assert/strict'

// Baseline implementation using Object.keys() and .forEach()
function getActiveSignalKeysBaseline(trade, activeSessionConfig) {
  const keys = new Set();
  if (trade?.exit_signals_status) {
    Object.keys(trade.exit_signals_status).forEach(k => keys.add(k));
  }
  if (trade?.strategy_config?.exit_signals) {
    trade.strategy_config.exit_signals.forEach(k => keys.add(k));
  }
  if (activeSessionConfig?.exit_signals) {
    activeSessionConfig.exit_signals.forEach(k => keys.add(k));
  }
  return Array.from(keys);
}

// Optimized implementation using zero-allocation for...in loop and standard for loops
function getActiveSignalKeysOptimized(trade, activeSessionConfig) {
  const keys = new Set();
  if (trade?.exit_signals_status) {
    for (const k in trade.exit_signals_status) {
      if (Object.prototype.hasOwnProperty.call(trade.exit_signals_status, k)) {
        keys.add(k);
      }
    }
  }
  const tradeExitSignals = trade?.strategy_config?.exit_signals;
  if (tradeExitSignals) {
    for (let i = 0; i < tradeExitSignals.length; i++) {
      keys.add(tradeExitSignals[i]);
    }
  }
  const sessionExitSignals = activeSessionConfig?.exit_signals;
  if (sessionExitSignals) {
    for (let i = 0; i < sessionExitSignals.length; i++) {
      keys.add(sessionExitSignals[i]);
    }
  }
  return Array.from(keys);
}

test('activeSignalKeys optimization: correctness & exact output parity', () => {
  const mockTrade = {
    exit_signals_status: {
      ema_close: { fired: true, value: 100 },
      supertrend: { fired: false, value: 95 },
      macd_fade: { fired: false, value: 0.1 },
    },
    strategy_config: {
      exit_signals: ['ema_close', 'breakout_hl'],
    },
  };

  const mockSessionConfig = {
    exit_signals: ['supertrend', 'engulfing', 'momentum_pct'],
  };

  const baselineKeys = getActiveSignalKeysBaseline(mockTrade, mockSessionConfig);
  const optimizedKeys = getActiveSignalKeysOptimized(mockTrade, mockSessionConfig);

  assert.deepEqual(
    optimizedKeys.sort(),
    baselineKeys.sort(),
    'Optimized zero-allocation for...in extraction must match baseline output'
  );
  assert.equal(optimizedKeys.length, 6);
});

test('activeSignalKeys performance benchmark: for...in vs Object.keys()', () => {
  const ITERATIONS = 100000;

  const mockTrade = {
    exit_signals_status: {
      ema_close: { fired: true, value: 100 },
      supertrend: { fired: false, value: 95 },
      macd_fade: { fired: false, value: 0.1 },
      ema_dual_close: { fired: false, value: 102 },
      breakout_hl: { fired: true, value: 90 },
    },
    strategy_config: {
      exit_signals: ['ema_close', 'breakout_hl', 'engulfing'],
    },
  };

  const mockSessionConfig = {
    exit_signals: ['supertrend', 'engulfing', 'momentum_pct', 'macd_impulse'],
  };

  // Warmup
  for (let i = 0; i < 1000; i++) {
    getActiveSignalKeysBaseline(mockTrade, mockSessionConfig);
    getActiveSignalKeysOptimized(mockTrade, mockSessionConfig);
  }

  // Baseline Benchmark
  const startOrig = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    getActiveSignalKeysBaseline(mockTrade, mockSessionConfig);
  }
  const durOrig = performance.now() - startOrig;

  // Optimized Benchmark
  const startOpt = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    getActiveSignalKeysOptimized(mockTrade, mockSessionConfig);
  }
  const durOpt = performance.now() - startOpt;

  const speedup = durOrig / Math.max(durOpt, 0.001);

  console.log(`\n⚡ Bolt Performance Benchmark (activeSignalKeys for...in vs Object.keys(), ${ITERATIONS} iterations):`);
  console.log(`  - Original (Object.keys + forEach): ${durOrig.toFixed(2)} ms`);
  console.log(`  - Optimized (for...in zero-allocation): ${durOpt.toFixed(2)} ms`);
  console.log(`  - Execution Speedup:                    ${speedup.toFixed(2)}x faster`);

  assert.ok(durOpt <= durOrig * 1.2, 'Optimized for...in loop should execute faster or equal to Object.keys()');
});
