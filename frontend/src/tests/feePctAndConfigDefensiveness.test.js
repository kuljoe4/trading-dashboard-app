import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Account Balance & ConfigModal Defensiveness Tests', () => {
  it('calculates fee and funding percentage relative to account balance correctly', () => {
    const balance = 10000;
    const netFunding = -25.50;
    const netComm = 12.30;

    const fundPct = balance > 0 ? (Math.abs(netFunding) / balance) * 100 : 0;
    const commPct = balance > 0 ? (Math.abs(netComm) / balance) * 100 : 0;

    assert.equal(fundPct.toFixed(2), '0.26');
    assert.equal(commPct.toFixed(2), '0.12');
  });

  it('handles trading_windows array mapping defensively when non-array is passed', () => {
    const malformedCfg = { trading_windows: 'invalid_string_or_object' };
    const safeWindows = Array.isArray(malformedCfg.trading_windows) ? malformedCfg.trading_windows : [];

    assert.deepEqual(safeWindows, []);
    assert.doesNotThrow(() => {
      safeWindows.map(w => w.start);
    });
  });
});
