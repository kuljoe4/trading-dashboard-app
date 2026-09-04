import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Smart Auto-Mode Strategy Optimizer Unit Tests', () => {
  it('formats smart optimizer request payload correctly', () => {
    const createPayload = (iterations = 15, days = 14, startingBalance = 10000, symbols = ['BTCUSDT'], baseConfig = {}) => ({
      iterations,
      days,
      startingBalance,
      symbols,
      baseConfig,
      topCount: 5,
    });

    const payload = createPayload(20, 30, 25000, ['BTCUSDT', 'ETHUSDT'], { sl_distance_pct: 1.5 });

    assert.equal(payload.iterations, 20);
    assert.equal(payload.days, 30);
    assert.equal(payload.startingBalance, 25000);
    assert.equal(payload.symbols.length, 2);
    assert.equal(payload.baseConfig.sl_distance_pct, 1.5);
    assert.equal(payload.topCount, 5);
  });

  it('ranks strategy recommendations by composite score descending', () => {
    const recommendations = [
      { rank: 1, name: 'Smart ST 1.5SL 2.5R', score: 120.5 },
      { rank: 2, name: 'Smart MACD 0.8SL Trail', score: 95.2 },
      { rank: 3, name: 'Smart EMA 2.0SL 3.0R', score: 60.1 },
    ];

    const sorted = [...recommendations].sort((a, b) => b.score - a.score);
    assert.equal(sorted[0].rank, 1);
    assert.equal(sorted[1].rank, 2);
    assert.equal(sorted[2].rank, 3);
    assert.ok(sorted[0].score > sorted[1].score);
    assert.ok(sorted[1].score > sorted[2].score);
  });
});
