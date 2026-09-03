import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('R:R Dynamic Trailing Stop Calculations Unit Tests', () => {
  test('calculates trailing distance in currency units based on pct vs rr mode', () => {
    const entryPrice = 100;
    const initialSl = 95; // Initial Risk = 5 USDT
    const initialRisk = Math.abs(entryPrice - initialSl);

    // Mode 1: Percentage Trailing (2%)
    const pctDistance = entryPrice * (2.0 / 100);
    assert.strictEqual(pctDistance, 2.0);

    // Mode 2: R:R Trailing (1.5 R)
    const rrMultiple = 1.5;
    const rrDistance = initialRisk * rrMultiple;
    assert.strictEqual(rrDistance, 7.5);

    // Mode 2 LONG prospective SL calculation: currentPrice 110 - rrDistance 7.5 = 102.5
    const currentPrice = 110;
    const longProspectiveSlRr = currentPrice - rrDistance;
    assert.strictEqual(longProspectiveSlRr, 102.5);

    // Mode 2 SHORT prospective SL calculation: currentPrice 90 + rrDistance 7.5 = 97.5
    const shortProspectiveSlRr = 90 + rrDistance;
    assert.strictEqual(shortProspectiveSlRr, 97.5);
  });
});
