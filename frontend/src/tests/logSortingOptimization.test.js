import { test } from 'node:test'
import assert from 'node:assert/strict'

class StorageMock {
  constructor() {
    this.store = {};
  }
  clear() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new StorageMock();
}
if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = new StorageMock();
}

const { normalizeLog } = await import('../store/trading.js');

test('normalizeLog pre-calculates numeric ts_ms timestamp', () => {
  const isoTime = '2026-09-17T15:00:00.000Z'
  const log = normalizeLog({ msg: 'Test log', ts: isoTime, level: 'info' })

  assert.ok(log, 'normalizeLog should return an object')
  assert.equal(log.msg, 'Test log')
  assert.equal(typeof log.ts_ms, 'number', 'log.ts_ms should be a number')
  assert.equal(log.ts_ms, new Date(isoTime).getTime(), 'ts_ms should match parsed millisecond timestamp')
})

test('normalizeLog handles fallback and timestamp field variations', () => {
  const tsNum = 1750000000000
  const logWithNum = normalizeLog({ msg: 'Log with numeric timestamp', timestamp: tsNum })
  assert.equal(logWithNum.ts_ms, tsNum, 'ts_ms should equal numeric timestamp input')

  const logWithMissing = normalizeLog({ msg: 'Log without timestamp' })
  assert.equal(typeof logWithMissing.ts_ms, 'number', 'ts_ms should default to current millisecond timestamp')
  assert.ok(logWithMissing.ts_ms > 0, 'ts_ms should be positive')
})

test('Decision log sorting with pre-calculated ts_ms vs raw Date parsing benchmark', () => {
  const sampleCount = 1000
  const baseTs = 1750000000000
  const rawLogs = []

  for (let i = 0; i < sampleCount; i++) {
    const randomOffset = Math.floor(Math.random() * 86400000)
    const isoString = new Date(baseTs + randomOffset).toISOString()
    rawLogs.push({
      id: `log-${i}`,
      msg: `Log message ${i}`,
      ts: isoString,
      level: 'info'
    })
  }

  const normalizedLogs = rawLogs.map(normalizeLog)

  // Verify correctness of sorting using ts_ms
  const sorted = [...normalizedLogs].sort((a, b) => (b.ts_ms || 0) - (a.ts_ms || 0))
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1].ts_ms >= sorted[i].ts_ms, 'Logs must be sorted in descending chronological order')
  }

  // Benchmark: raw Date parsing inside comparator vs ts_ms subtraction
  const iterations = 500

  const startUnoptimized = performance.now()
  for (let i = 0; i < iterations; i++) {
    const copy = [...normalizedLogs]
    copy.sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime())
  }
  const durationUnoptimized = performance.now() - startUnoptimized

  const startOptimized = performance.now()
  for (let i = 0; i < iterations; i++) {
    const copy = [...normalizedLogs]
    copy.sort((a, b) => (b.ts_ms || 0) - (a.ts_ms || 0))
  }
  const durationOptimized = performance.now() - startOptimized

  const speedup = durationUnoptimized / durationOptimized

  console.log(`\n⚡ Bolt Performance Benchmark (Decision Log Sorting, ${sampleCount} logs, ${iterations} iterations):`)
  console.log(`  - Original (new Date() in sort comparator): ${durationUnoptimized.toFixed(2)} ms`)
  console.log(`  - Optimized (ts_ms integer subtraction):     ${durationOptimized.toFixed(2)} ms`)
  console.log(`  - Execution Speedup:                          ${speedup.toFixed(2)}x faster\n`)

  assert.ok(durationOptimized <= durationUnoptimized, 'Optimized integer subtraction should be faster or equal to string-to-Date parsing')
})
