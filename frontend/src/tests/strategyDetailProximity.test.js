import { test } from 'node:test';
import assert from 'node:assert';
import { calculateProximity } from '../lib/formatters.js';

test('StrategyDetailView proximity leaderboard filtering and direction awareness unit tests', async (t) => {
  await t.test('filters out candidates that have already fired or crossed (100% proximity)', () => {
    const strategyScannerResults = [
      {
        symbol: 'BTCUSDT',
        dir: 'long',
        pct: 2.5,
        close: 65000,
        signalResult: {
          allFired: true,
          signals: {
            ema_cross: { fired: true, value: 65000, threshold: 64800, threshold_is_price: true }
          }
        }
      },
      {
        symbol: 'ETHUSDT',
        dir: 'long',
        pct: 1.8,
        close: 3500,
        signalResult: {
          allFired: false,
          signals: {
            ema_cross: { fired: false, value: 3480, threshold: 3500, threshold_is_price: true }
          }
        }
      },
      {
        symbol: 'SOLUSDT',
        dir: 'short',
        pct: -1.5,
        close: 140,
        signalResult: {
          allFired: false,
          signals: {
            ema_cross: { fired: false, value: 142, threshold: 140, threshold_is_price: true }
          }
        }
      }
    ];

    const enabledSigs = ['ema_cross'];
    const scanThresh = 2.0;

    const leaderboard = strategyScannerResults
      .map(opp => {
        const isLong = opp.dir === 'long' || opp.pct >= 0;
        const velocityProgress = Math.min(100, (Math.abs(opp.pct || 0) / scanThresh) * 100);

        let sigSum = velocityProgress;
        let count = 1;

        if (opp.signalResult?.signals) {
          for (const sigKey of enabledSigs) {
            const s = opp.signalResult.signals[sigKey];
            if (s) {
              const prox = calculateProximity(s, opp.close || s.value || 0, 0, isLong, false);
              sigSum += prox;
              count++;
            }
          }
        }

        const avgProximity = count > 0 ? sigSum / count : 0;
        const isFired = !!(opp.signalResult?.allFired && opp.signalResult?.signals);
        return {
          ...opp,
          proximity: isFired ? 100 : Math.min(99, Math.round(avgProximity))
        };
      })
      .filter(opp => {
        const isFired = !!(opp.signalResult?.allFired && opp.signalResult?.signals);
        return !isFired && opp.proximity < 100;
      })
      .sort((a, b) => b.proximity - a.proximity);

    assert.strictEqual(leaderboard.length, 2, 'Fired candidates should be filtered out');
    assert.strictEqual(leaderboard.find(item => item.symbol === 'BTCUSDT'), undefined, 'BTCUSDT (allFired) must be excluded');
    assert.strictEqual(leaderboard[0].symbol, 'ETHUSDT');
    assert.ok(leaderboard[0].proximity < 100 && leaderboard[0].proximity > 0);
  });

  await t.test('evaluates direction-aware proximity for SHORT candidates yet to cross', () => {
    const shortNotCrossedSignal = {
      value: 105,
      threshold: 100,
      fired: false,
      threshold_is_price: true
    };
    // For SHORT: value is 105, threshold is 100. Price is moving down towards threshold.
    const proxShort = calculateProximity(shortNotCrossedSignal, 105, 0, false, false);
    assert.ok(proxShort > 0 && proxShort < 100, `SHORT proximity (${proxShort}) should be between 0 and 100`);

    const shortCrossedSignal = {
      value: 95,
      threshold: 100,
      fired: false,
      threshold_is_price: true
    };
    // For SHORT: value is 95, crossed below threshold 100. Should return 100% indicating threshold crossed.
    const proxCrossed = calculateProximity(shortCrossedSignal, 95, 0, false, false);
    assert.strictEqual(proxCrossed, 100, 'SHORT crossed signal should be at 100%');
  });
});
