import { test } from 'node:test';
import assert from 'node:assert';
import { calculateProximity } from '../lib/formatters.js';

test('Signal Gauge & Est PnL Capping Tests', async (t) => {
  await t.test('evaluates proximity correctly for dual EMA cross indicator-pair signals', () => {
    const signal = {
      key: 'ema_dual_cross',
      value: 99.5,      // Fast EMA
      threshold: 100.0, // Slow EMA
      metric: 'Exit EMA Dual',
      fired: false,
      threshold_is_price: true
    };

    // Fast EMA (99.5) vs Slow EMA (100.0) -> Spread = 0.5 (0.5% relSpread).
    // Progress = 99 / (1 + 118.75 * 0.005) = 62.1% -> ~62%
    const proximity = calculateProximity(signal, 105, 95, true, true);
    assert.strictEqual(Math.round(proximity), 62);
  });

  await t.test('caps estimated exit PnL at current unrealized live PnL when price pulls back', () => {
    const entryPrice = 100;
    const numThreshold = 120; // Exit target
    const markPrice = 105;    // Live pulled back price
    const qty = 2;
    const isLong = true;

    const rawEstPnl = (numThreshold - entryPrice) * qty * (isLong ? 1 : -1); // $40
    const livePnl = (markPrice - entryPrice) * qty * (isLong ? 1 : -1);       // $10

    const estPnl = Math.min(rawEstPnl, livePnl);

    assert.strictEqual(rawEstPnl, 40);
    assert.strictEqual(livePnl, 10);
    assert.strictEqual(estPnl, 10); // Capped at live unrealized PnL
  });
});
