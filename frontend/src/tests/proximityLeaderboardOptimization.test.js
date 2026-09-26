import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOpportunityProximity } from '../lib/formatters.js';

// Original multi-pass mapping, filtering, and sorting implementation
function originalProximityLeaderboard(strategyScannerResults, strategyConfig) {
  const list = strategyScannerResults || [];

  return list.map(opp => {
    const proximity = calculateOpportunityProximity(opp, strategyConfig);
    return {
      ...opp,
      proximity
    };
  })
  .filter(opp => {
    const isFired = !!(opp.signalResult?.allFired && opp.signalResult?.signals);
    return !isFired && opp.proximity < 100;
  })
  .sort((a, b) => b.proximity - a.proximity);
}

// Optimized single-pass loop implementation with early rejection and zero pre-allocations for filtered items
function optimizedProximityLeaderboard(strategyScannerResults, strategyConfig) {
  const list = strategyScannerResults || [];
  const len = list.length;
  const candidates = [];

  for (let i = 0; i < len; i++) {
    const opp = list[i];
    if (!opp) continue;

    // Fast-fail: Exclude opportunities that have crossed already (fired/triggered) before computing proximity
    const isFired = !!(opp.signalResult?.allFired && opp.signalResult?.signals);
    if (isFired) continue;

    const proximity = calculateOpportunityProximity(opp, strategyConfig);
    if (proximity < 100) {
      candidates.push({ ...opp, proximity });
    }
  }

  candidates.sort((a, b) => b.proximity - a.proximity);
  return candidates;
}

describe('StrategyDetailView Proximity Leaderboard Optimization Tests', () => {
  const mockConfig = {
    enabled_signals: ['momentum_pct', 'ema_dual_cross'],
    scan_pct_threshold: 2.0,
    signal_logic: 'all'
  };

  const sampleResults = Array.from({ length: 300 }, (_, i) => {
    const isFired = i % 5 === 0;
    const isOver100 = i % 7 === 0;
    return {
      symbol: `SYM_${i}`,
      pct: (i % 10) * 0.5,
      score: (i * 17) % 100,
      signalResult: {
        allFired: isFired,
        signals: isFired ? { momentum_pct: { fired: true } } : {}
      },
      signals_status: {
        momentum_pct: { status: isOver100 ? 'fired' : 'approaching', isFired: isOver100 }
      }
    };
  });

  it('produces identical output structure and values as original implementation', () => {
    const orig = originalProximityLeaderboard(sampleResults, mockConfig);
    const opt = optimizedProximityLeaderboard(sampleResults, mockConfig);

    assert.equal(opt.length, orig.length, 'Length should match');
    assert.deepEqual(opt, orig, 'Outputs must be structurally and value-identical');
  });

  it('handles empty or edge case inputs gracefully', () => {
    assert.deepEqual(optimizedProximityLeaderboard([], mockConfig), []);
    assert.deepEqual(optimizedProximityLeaderboard(null, mockConfig), []);
    assert.deepEqual(optimizedProximityLeaderboard([null, undefined], mockConfig), []);
  });

  it('benchmark: single-pass loop with early rejection vs multi-pass chaining', () => {
    const iterations = 5000;

    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      originalProximityLeaderboard(sampleResults, mockConfig);
    }
    const t1 = performance.now();
    const durationOrig = t1 - t0;

    const t2 = performance.now();
    for (let i = 0; i < iterations; i++) {
      optimizedProximityLeaderboard(sampleResults, mockConfig);
    }
    const t3 = performance.now();
    const durationOpt = t3 - t2;

    const speedup = (durationOrig / durationOpt).toFixed(2);
    console.log(`\n⚡ Bolt Performance Benchmark (proximityLeaderboard, ${iterations} iterations x 300 symbols):`);
    console.log(`  - Original (map -> filter -> sort):  ${durationOrig.toFixed(2)} ms`);
    console.log(`  - Optimized (single-pass loop):      ${durationOpt.toFixed(2)} ms`);
    console.log(`  - Execution Speedup:                 ${speedup}x faster\n`);

    assert.ok(durationOpt <= durationOrig, 'Optimized version should be faster or equal');
  });
});
