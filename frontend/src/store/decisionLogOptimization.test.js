import test from 'node:test';
import assert from 'node:assert/strict';

test('formatMessage regex optimization correctness and performance benchmark', () => {
  const HIGHLIGHTS = {
    positive: ['BUY', 'PROFIT', 'TP', 'HIT', 'SUCCESS', 'STARTED', 'ENTER'],
    negative: ['SELL', 'LOSS', 'SL', 'REJECTED', 'ERROR', 'FAILED', 'STOPPED', 'CRITICAL', 'GATED', 'SLEEPING'],
    neutral: ['MONITORING', 'WARM-UP', 'SYNC', 'LIFECYCLE', 'RECONCILING', 'ADAPTIVE', 'COOLDOWN', 'VARIANT']
  };

  const REGEX_POSITIVE = /BUY|PROFIT|TP|HIT|SUCCESS|STARTED|ENTER/i;
  const REGEX_NEGATIVE = /SELL|LOSS|SL|REJECTED|ERROR|FAILED|STOPPED|CRITICAL|GATED|SLEEPING/i;
  const REGEX_NEUTRAL = /MONITORING|WARM-UP|SYNC|LIFECYCLE|RECONCILING|ADAPTIVE|COOLDOWN|VARIANT/i;

  const sampleLogs = [
    "[12:34:56] [Momentum Strategy] ENTER LONG trade on BTCUSDT at 65000.00 SL 64000 TP 67000 SUCCESS",
    "[12:35:01] [Engine] MONITORING 25 symbols in WARM-UP state for COOLDOWN and LIFECYCLE check",
    "[12:35:10] [RiskEngine] GATED order REJECTED: CRITICAL SL_GUARD active SLEEPING for 300s",
    "[12:35:15] [PositionTracker] PROFIT target HIT for ETHUSDT (+2.5R) trade STARTED",
    "[12:35:20] [MarketFeed] SYNC completed: RECONCILING VARIANT 1 data ADAPTIVE threshold met"
  ];

  // Original implementation
  const formatOriginal = (msg) => {
    if (typeof msg !== 'string') return msg == null ? '' : String(msg);
    if (!msg) return msg;
    const words = msg.split(/(\s+)/);
    return words.map((word) => {
      const clean = word.toUpperCase().trim();
      if (HIGHLIGHTS.positive.some(h => clean.includes(h))) return 'pos';
      if (HIGHLIGHTS.negative.some(h => clean.includes(h))) return 'neg';
      if (HIGHLIGHTS.neutral.some(h => clean.includes(h))) return 'neu';
      return word;
    });
  };

  // Optimized implementation
  const formatOptimized = (msg) => {
    if (typeof msg !== 'string') return msg == null ? '' : String(msg);
    if (!msg) return msg;
    const words = msg.split(/(\s+)/);
    return words.map((word) => {
      if (REGEX_POSITIVE.test(word)) return 'pos';
      if (REGEX_NEGATIVE.test(word)) return 'neg';
      if (REGEX_NEUTRAL.test(word)) return 'neu';
      return word;
    });
  };

  // 1. Correctness Verification
  for (const log of sampleLogs) {
    const resOrig = formatOriginal(log);
    const resOpt = formatOptimized(log);
    assert.deepStrictEqual(resOpt, resOrig, `Formatted output for log must match exactly: ${log}`);
  }

  // 2. Performance Benchmark
  const logs = [];
  for (let i = 0; i < 100; i++) {
    logs.push(...sampleLogs);
  }

  const iterations = 1000;

  // Warmup
  for (let i = 0; i < logs.length; i++) {
    formatOriginal(logs[i]);
    formatOptimized(logs[i]);
  }

  const startOrig = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < logs.length; i++) {
      formatOriginal(logs[i]);
    }
  }
  const endOrig = performance.now();
  const origDuration = endOrig - startOrig;

  const startOpt = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < logs.length; i++) {
      formatOptimized(logs[i]);
    }
  }
  const endOpt = performance.now();
  const optDuration = endOpt - startOpt;

  console.log(`\n⚡ Bolt Performance Benchmark (DecisionLog formatMessage, ${logs.length} logs, ${iterations} iterations):`);
  console.log(`  - Original (.some() + toUpperCase().trim()): ${origDuration.toFixed(2)} ms`);
  console.log(`  - Optimized (Pre-compiled Regex.test()):     ${optDuration.toFixed(2)} ms`);
  console.log(`  - Execution Speedup:                         ${(origDuration / Math.max(0.0001, optDuration)).toFixed(2)}x faster`);

  assert.ok(optDuration < origDuration, 'Optimized version must be faster than original');
});
