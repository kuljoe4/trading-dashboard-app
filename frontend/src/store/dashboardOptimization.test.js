import './mock-env.js';
import { test } from 'node:test';
import assert from 'node:assert';

// The original sorting algorithm
function findLastSessionSort(sessionList) {
  const ls = (!sessionList || sessionList.length === 0) ? null : [...sessionList].sort((a, b) => {
    const bTime = b.startTimeMs ?? (b.startTime ? new Date(b.startTime).getTime() : 0);
    const aTime = a.startTimeMs ?? (a.startTime ? new Date(a.startTime).getTime() : 0);
    return bTime - aTime;
  })[0];
  return ls;
}

// The optimized single-pass algorithm
function findLastSessionSinglePass(sessionList) {
  let ls = null;
  if (sessionList && sessionList.length > 0) {
    let maxTime = -Infinity;
    for (let i = 0; i < sessionList.length; i++) {
      const s = sessionList[i];
      if (!s) continue;
      const sTime = s.startTimeMs ?? (s.startTime ? new Date(s.startTime).getTime() : 0);
      if (sTime > maxTime) {
        maxTime = sTime;
        ls = s;
      }
    }
  }
  return ls;
}

test('findLastSession returns null for empty or null sessionList', () => {
  assert.strictEqual(findLastSessionSinglePass(null), null);
  assert.strictEqual(findLastSessionSinglePass([]), null);
});

test('findLastSession correctly identifies the most recent session (mixed dates and milliseconds)', () => {
  const sessions = [
    { id: 'session-1', startTime: '2026-07-20T10:00:00.000Z' }, // 10:00
    { id: 'session-2', startTimeMs: new Date('2026-07-20T12:00:00.000Z').getTime() }, // 12:00 (Latest)
    { id: 'session-3', startTime: '2026-07-20T11:00:00.000Z' }, // 11:00
    { id: 'session-4', startTimeMs: new Date('2026-07-20T09:00:00.000Z').getTime() }  // 09:00
  ];

  const sortedResult = findLastSessionSort(sessions);
  const singlePassResult = findLastSessionSinglePass(sessions);

  assert.strictEqual(sortedResult.id, 'session-2');
  assert.strictEqual(singlePassResult.id, 'session-2');
  assert.deepStrictEqual(singlePassResult, sortedResult, 'Both implementations must return the exact same session object.');
});

test('findLastSession performance comparison benchmark', () => {
  // Generate 1000 mockup sessions
  const listSize = 1000;
  const sessions = Array.from({ length: listSize }, (_, i) => ({
    id: `session-${i}`,
    startTime: new Date(Date.now() - i * 60000).toISOString()
  }));

  // Benchmark sorting approach
  const startSort = performance.now();
  const resSort = findLastSessionSort(sessions);
  const endSort = performance.now();
  const sortDuration = endSort - startSort;

  // Benchmark single-pass approach
  const startSingle = performance.now();
  const resSingle = findLastSessionSinglePass(sessions);
  const endSingle = performance.now();
  const singleDuration = endSingle - startSingle;

  assert.strictEqual(resSingle.id, resSort.id, 'Optimized results must match sort results exactly');

  console.log(`\n⚡ Bolt Performance Benchmark (List size: ${listSize} sessions):`);
  console.log(`  - Original Sorting-based Lookup: ${sortDuration.toFixed(4)} ms`);
  console.log(`  - Optimized Single-pass Lookup:   ${singleDuration.toFixed(4)} ms`);
  console.log(`  - Execution Speedup:             ${(sortDuration / Math.max(0.0001, singleDuration)).toFixed(1)}x faster`);
});
