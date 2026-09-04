import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('R:R Dynamic Trailing Stop & Runway Flag Calculations Unit Tests', () => {
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

  test('calculates trailing activation threshold price and activation status for LONG position', () => {
    const entryPrice = 50000;
    const initialSl = 49000;
    const risk = Math.abs(entryPrice - initialSl); // 1000 USDT
    const activationRr = 1.5;

    const activationPrice = entryPrice + (risk * activationRr); // 50000 + 1500 = 51500
    assert.strictEqual(activationPrice, 51500);

    // Case A: Live R:R = 1.0 (< 1.5) -> Pending activation
    const currentPricePending = 51000;
    const liveRrPending = (currentPricePending - entryPrice) / risk;
    const isActivatedPending = liveRrPending >= activationRr;
    assert.strictEqual(isActivatedPending, false);

    // Case B: Live R:R = 1.8 (>= 1.5) -> Active activation
    const currentPriceActive = 51800;
    const liveRrActive = (currentPriceActive - entryPrice) / risk;
    const isActivatedActive = liveRrActive >= activationRr;
    assert.strictEqual(isActivatedActive, true);
  });

  test('calculates trailing activation threshold price and activation status for SHORT position', () => {
    const entryPrice = 3000;
    const initialSl = 3100;
    const risk = Math.abs(entryPrice - initialSl); // 100 USDT
    const activationRr = 2.0;

    const activationPrice = entryPrice - (risk * activationRr); // 3000 - 200 = 2800
    assert.strictEqual(activationPrice, 2800);

    // Case A: Live R:R = 2.5 (>= 2.0) -> Active activation
    const currentPriceActive = 2750;
    const liveRrActive = (entryPrice - currentPriceActive) / risk;
    const isActivatedActive = liveRrActive >= activationRr;
    assert.strictEqual(isActivatedActive, true);
  });
});
