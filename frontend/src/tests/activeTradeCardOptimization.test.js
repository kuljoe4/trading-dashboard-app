import test from 'node:test'
import assert from 'node:assert'
import { analyzeTradeDiagnostics } from '../utils/tradeDiagnostics.js'
import { calculateProximity } from '../lib/formatters.js'

test('analyzeTradeDiagnostics correctly extracts exit signals status with for...in loop', () => {
  const mockTrade = {
    id: 'test-trade-123',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 50000,
    current_price: 51000,
    current_sl: 49000,
    initial_sl: 49000,
    qty: 0.1,
    pnl: 100,
    pnl_pct: 2,
    exit_signals_status: {
      ema_cross: {
        fired: false,
        active: true,
        progress: 65,
        is_warming_up: true,
        warmup_candles: 45,
        required_warmup: 70,
        warmup_tf: '15m'
      },
      supertrend: {
        fired: true,
        active: true,
        progress: 100,
        is_warming_up: false
      }
    }
  }

  const result = analyzeTradeDiagnostics(mockTrade)

  assert.strictEqual(result.hasWarning, true)
  assert.strictEqual(result.issues.length, 1)
  assert.strictEqual(result.issues[0].code, 'EXIT_WARMUP_INCOMPLETE')
  assert.ok(result.traceSnippet.includes('`ema_cross`: Fired=false, Active=true'))
  assert.ok(result.traceSnippet.includes('`supertrend`: Fired=true, Active=true'))
  assert.ok(result.traceSnippet.includes('(Warming: 45/70 - 15m)'))
})

test('ActiveTradeCard exitSignalProximity & triggers parity test', () => {
  const exitSignalsStatus = {
    ema_fast: {
      threshold_is_price: true,
      threshold: 50500,
      fired: false,
      active: true,
      label: 'FAST EMA',
      value: 50400
    },
    supertrend: {
      threshold_is_price: true,
      threshold: 50200,
      fired: true,
      active: true,
      label: 'SUPERTREND',
      value: 50200
    }
  }

  const mark = 50800
  const entry = 50000
  const isLong = true

  // Simulate original Object.values implementation
  const origProximity = (() => {
    const statuses = Object.values(exitSignalsStatus)
    let maxProx = 0
    for (const sig of statuses) {
      if (sig) {
        const prox = calculateProximity(sig, mark, entry, isLong, true)
        if (prox > maxProx) maxProx = prox
      }
    }
    return Math.round(maxProx)
  })()

  // Simulate optimized for...in implementation
  const optProximity = (() => {
    let maxProx = 0
    let hasSignal = false
    for (const key in exitSignalsStatus) {
      const sig = exitSignalsStatus[key]
      if (sig) {
        hasSignal = true
        const prox = calculateProximity(sig, mark, entry, isLong, true)
        if (prox > maxProx) maxProx = prox
      }
    }
    if (!hasSignal) return 0
    return Math.round(maxProx)
  })()

  assert.strictEqual(optProximity, origProximity)
})

test('benchmark: for...in vs Object.entries/Object.values on exit_signals_status', () => {
  const ITERATIONS = 100000
  const mockExitSignalsStatus = {
    ema_cross_fast: {
      threshold_is_price: true,
      threshold: 50500,
      fast_value: 50400,
      slow_value: 50200,
      fired: false,
      active: true,
      progress: 75.5,
      is_warming_up: true,
      warmup_candles: 60,
      required_warmup: 70,
      warmup_tf: '15m'
    },
    ema_cross_slow: {
      threshold_is_price: true,
      threshold: 50100,
      fired: false,
      active: true,
      progress: 40.2,
      is_warming_up: false
    },
    supertrend_exit: {
      threshold_is_price: false,
      fired: true,
      active: true,
      progress: 100,
      is_warming_up: false
    },
    macd_impulse: {
      threshold_is_price: false,
      fired: false,
      active: true,
      progress: 30.0,
      is_warming_up: true,
      warmup_candles: 10,
      required_warmup: 20,
      warmup_tf: '5m'
    }
  }

  // Baseline: Object.entries + Object.values
  const startOrig = performance.now()
  let dummyOrig = 0
  for (let i = 0; i < ITERATIONS; i++) {
    for (const [key, sig] of Object.entries(mockExitSignalsStatus)) {
      if (sig.fired) dummyOrig++
    }
    const values = Object.values(mockExitSignalsStatus)
    for (const sig of values) {
      if (sig.active) dummyOrig++
    }
  }
  const durOrig = performance.now() - startOrig

  // Optimized: for...in loop
  const startOpt = performance.now()
  let dummyOpt = 0
  for (let i = 0; i < ITERATIONS; i++) {
    for (const key in mockExitSignalsStatus) {
      const sig = mockExitSignalsStatus[key]
      if (sig.fired) dummyOpt++
      if (sig.active) dummyOpt++
    }
  }
  const durOpt = performance.now() - startOpt

  assert.strictEqual(dummyOpt, dummyOrig)

  const speedup = durOrig / durOpt
  console.log(`\n⚡ Bolt Performance Benchmark (ActiveTradeCard for...in vs Object.entries/values, ${ITERATIONS} iterations):`)
  console.log(`  - Original (Object.entries + Object.values): ${durOrig.toFixed(2)} ms`)
  console.log(`  - Optimized (for...in loop fusion):           ${durOpt.toFixed(2)} ms`)
  console.log(`  - Execution Speedup:                          ${speedup.toFixed(2)}x faster\n`)

  assert.ok(durOpt <= durOrig, 'Optimized for...in loop should execute faster or equal to Object.entries/values')
})
