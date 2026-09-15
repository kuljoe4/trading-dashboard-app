import '../store/mock-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLog } from '../store/trading.js';

test('Log Sorting Optimization Unit Tests & Benchmark', async (t) => {
  await t.test('normalizeLog correctly attaches pre-calculated ts_ms numeric timestamp', () => {
    const isoTime = '2026-09-15T12:30:45.000Z';
    const expectedMs = new Date(isoTime).getTime();

    const logWithIso = normalizeLog({ msg: 'Test ISO log', ts: isoTime, level: 'info' });
    assert.equal(logWithIso.ts_ms, expectedMs, 'Pre-calculated ts_ms matches Date.getTime()');

    const numTime = 1789475445000;
    const logWithNum = normalizeLog({ msg: 'Test Num log', ts: numTime, level: 'warn' });
    assert.equal(logWithNum.ts_ms, numTime, 'Pre-calculated ts_ms matches primitive timestamp number');

    const logFallback = normalizeLog({ msg: 'Test Fallback log', level: 'error' });
    assert.ok(typeof logFallback.ts_ms === 'number' && logFallback.ts_ms > 0, 'Fallback ts_ms is a positive numeric timestamp');
  });

  await t.test('Numeric ts_ms sorting produces exact same descending order as Date.getTime() comparator', () => {
    const rawLogs = [
      { id: '1', msg: 'Log 1', ts: '2026-09-15T10:00:00.000Z' },
      { id: '2', msg: 'Log 2', ts: '2026-09-15T12:00:00.000Z' },
      { id: '3', msg: 'Log 3', ts: '2026-09-15T11:00:00.000Z' },
      { id: '4', msg: 'Log 4', ts: '2026-09-15T09:30:00.000Z' },
      { id: '5', msg: 'Log 5', ts: '2026-09-15T14:15:00.000Z' },
    ];

    const normalized = rawLogs.map(normalizeLog);

    const sortedWithDate = [...normalized].sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());
    const sortedWithTsMs = [...normalized].sort((a, b) => (b.ts_ms || 0) - (a.ts_ms || 0));

    assert.deepEqual(
      sortedWithTsMs.map(l => l.id),
      sortedWithDate.map(l => l.id),
      'Descending sort order is identical between ts_ms subtraction and new Date() parsing'
    );
  });

  await t.test('benchmark: verify numeric ts_ms sorting performance speedup over in-comparator new Date()', () => {
    const logsCount = 500;
    const iterations = 5000;
    const baseTs = Date.now();

    const normalizedLogs = [];
    for (let i = 0; i < logsCount; i++) {
      const isoTs = new Date(baseTs - i * 1000).toISOString();
      normalizedLogs.push(normalizeLog({
        id: `bench_${i}`,
        msg: `Decision log message entry ${i} for performance benchmark`,
        ts: isoTs,
        level: i % 3 === 0 ? 'error' : i % 2 === 0 ? 'warn' : 'info'
      }));
    }

    // Benchmark 1: Unoptimized in-comparator new Date() parsing
    const startOriginal = performance.now();
    for (let iter = 0; iter < iterations; iter++) {
      const copy = [...normalizedLogs];
      copy.sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());
    }
    const elapsedOriginal = performance.now() - startOriginal;

    // Benchmark 2: Optimized pre-calculated numeric ts_ms subtraction
    const startOptimized = performance.now();
    for (let iter = 0; iter < iterations; iter++) {
      const copy = [...normalizedLogs];
      copy.sort((a, b) => (b.ts_ms || 0) - (a.ts_ms || 0));
    }
    const elapsedOptimized = performance.now() - startOptimized;

    const speedup = elapsedOriginal / (elapsedOptimized || 0.001);

    console.log(`\n# ⚡ Bolt Performance Benchmark (Log Store Sorting, ${logsCount} logs, ${iterations} iterations):`);
    console.log(`#   - Unoptimized (in-comparator new Date() parsing): ${elapsedOriginal.toFixed(2)} ms`);
    console.log(`#   - Optimized (numeric ts_ms subtraction):           ${elapsedOptimized.toFixed(2)} ms`);
    console.log(`#   - Execution Speedup:                                ${speedup.toFixed(2)}x faster\n`);

    assert.ok(
      elapsedOptimized < elapsedOriginal,
      `Pre-calculated ts_ms numeric sorting (${elapsedOptimized.toFixed(2)}ms) must be faster than in-comparator Date parsing (${elapsedOriginal.toFixed(2)}ms)`
    );
  });
});
