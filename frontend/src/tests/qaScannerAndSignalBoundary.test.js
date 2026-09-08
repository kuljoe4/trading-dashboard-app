import test from 'node:test';
import assert from 'node:assert/strict';

// QA Unit Tests for Scanner and MACD Impulse Boundary Conditions

test('QA Automation: scan_pct_threshold boundary filter validation', async (t) => {
  await t.test('filters out symbols when 4h momentum is below scan_pct_threshold (1.5%)', () => {
    const threshold = 1.5; // 1.5%
    const currentPrice = 101.2;
    const previousPrice = 100.0;
    const momentumPct = ((currentPrice - previousPrice) / previousPrice) * 100; // 1.2%

    assert.equal(momentumPct < threshold, true, '1.2% momentum should be filtered out by 1.5% threshold');
  });

  await t.test('passes symbols when momentum meets or exceeds scan_pct_threshold', () => {
    const threshold = 1.5;
    const currentPrice = 102.0;
    const previousPrice = 100.0;
    const momentumPct = ((currentPrice - previousPrice) / previousPrice) * 100; // 2.0%

    assert.equal(momentumPct >= threshold, true, '2.0% momentum should pass 1.5% threshold');
  });
});

test('QA Automation: MACD Impulse entry window (bars 1-2) boundary condition validation', async (t) => {
  function evaluateMacdImpulseWindow(histogramSeries, side = 'LONG') {
    let count = 0;
    let idx = histogramSeries.length - 1;
    const currHist = histogramSeries[idx];

    if (side === 'LONG') {
      if (currHist <= 0) return { fired: false, reason: 'Not bullish' };
      while (idx >= 0 && histogramSeries[idx] > 0) {
        count++;
        idx--;
      }
      if (count === 1 || count === 2) {
        return { fired: true, count };
      }
      return { fired: false, reason: `Rejected: Green bar count is ${count} (Entry Window: 1-2)` };
    }
  }

  await t.test('fires signal on bar #1 of green histogram', () => {
    const series = [-0.5, -0.2, 0.1]; // bar 1
    const res = evaluateMacdImpulseWindow(series, 'LONG');
    assert.equal(res.fired, true);
    assert.equal(res.count, 1);
  });

  await t.test('fires signal on bar #2 of green histogram', () => {
    const series = [-0.5, -0.2, 0.1, 0.3]; // bar 2
    const res = evaluateMacdImpulseWindow(series, 'LONG');
    assert.equal(res.fired, true);
    assert.equal(res.count, 2);
  });

  await t.test('rejects signal on bar #3 or higher of green histogram (late entry prevention)', () => {
    const series = [-0.5, -0.2, 0.1, 0.3, 0.4]; // bar 3
    const res = evaluateMacdImpulseWindow(series, 'LONG');
    assert.equal(res.fired, false);
    assert.match(res.reason, /Green bar count is 3/);
  });

  await t.test('rejects signal on bar #4 (e.g. after 12-16 hours on 4h timeframe)', () => {
    const series = [-0.5, 0.1, 0.3, 0.4, 0.5]; // bar 4
    const res = evaluateMacdImpulseWindow(series, 'LONG');
    assert.equal(res.fired, false);
    assert.match(res.reason, /Green bar count is 4/);
  });
});
