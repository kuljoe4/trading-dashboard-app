import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePerformanceMetrics,
  getExpectancyStatus,
  getSharpeStatus,
  getSortinoStatus,
  getRrRecommendationStatus
} from '../lib/analytics.js';

describe('calculatePerformanceMetrics', () => {
  test('returns default values for empty trades array', () => {
    const metrics = calculatePerformanceMetrics([], 10000);
    assert.deepEqual(metrics, {
      sharpe: 0,
      sortino: 0,
      profitFactor: 0,
      winRate: 0,
      wins: 0,
      totalPnl: 0,
      grossProfit: 0,
      grossLoss: 0
    });
  });

  test('calculates correct values for single winning trade', () => {
    const trades = [
      { pnl: 100, entry_ts: 1000, exit_ts: 2000 }
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);

    assert.equal(metrics.winRate, 100);
    assert.equal(metrics.wins, 1);
    assert.equal(metrics.totalPnl, 100);
    assert.equal(metrics.grossProfit, 100);
    assert.equal(metrics.grossLoss, 0);
    assert.equal(metrics.profitFactor, 100);
    assert.equal(metrics.maxWinStreak, 1);
    assert.equal(metrics.maxLossStreak, 0);
    assert.equal(metrics.avgDuration, 1000);
    assert.equal(metrics.sharpe, 0);
    assert.equal(metrics.sortino, 0);
  });

  test('calculates correct values for single losing trade', () => {
    const trades = [
      { pnl: -50, entry_ts: 1000, exit_ts: 3000 }
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);

    assert.equal(metrics.winRate, 0);
    assert.equal(metrics.wins, 0);
    assert.equal(metrics.totalPnl, -50);
    assert.equal(metrics.grossProfit, 0);
    assert.equal(metrics.grossLoss, 50);
    assert.equal(metrics.profitFactor, 0);
    assert.equal(metrics.maxWinStreak, 0);
    assert.equal(metrics.maxLossStreak, 1);
    assert.equal(metrics.avgDuration, 2000);
    assert.equal(metrics.sharpe, 0);
    assert.equal(metrics.sortino, 0);
  });

  test('calculates correctly with mixed trades and missing session balance', () => {
    const trades = [
      { pnl: 100, entry_ts: 1000, exit_ts: 2000 },
      { pnl: -50, entry_ts: 2000, exit_ts: 3000 },
      { pnl: 150, entry_ts: 3000, exit_ts: 5000 }
    ];
    // Will estimate balance if null (backwards estimation)
    const metrics = calculatePerformanceMetrics(trades, null);

    assert.equal(metrics.winRate, 67); // 2/3 wins
    assert.equal(metrics.wins, 2);
    assert.equal(metrics.totalPnl, 200); // 100 - 50 + 150
    assert.equal(metrics.grossProfit, 250); // 100 + 150
    assert.equal(metrics.grossLoss, 50);
    assert.equal(metrics.profitFactor, 5); // 250 / 50
    assert.equal(metrics.maxWinStreak, 1);
    assert.equal(metrics.maxLossStreak, 1);
    assert.equal(metrics.avgDuration, Math.round((1000 + 1000 + 2000) / 3));
    assert.ok(metrics.sharpe > 0);
    assert.ok(metrics.sortino > 0);
  });

  test('sorts reverse chronological array properly', () => {
    // Array sorted in descending order of exit_ts
    const trades = [
      { pnl: 150, entry_ts: 3000, exit_ts: 5000 },
      { pnl: -50, entry_ts: 2000, exit_ts: 3000 },
      { pnl: 100, entry_ts: 1000, exit_ts: 2000 }
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);
    assert.equal(metrics.totalPnl, 200);
    assert.equal(metrics.profitFactor, 5);
    // Sequence in chronological order is: 100, -50, 150
    // Win streaks should be 1
    assert.equal(metrics.maxWinStreak, 1);
    assert.equal(metrics.maxLossStreak, 1);
  });

  test('calculates streaks correctly', () => {
    const trades = [
      { pnl: 10, exit_ts: 1000 },
      { pnl: 20, exit_ts: 2000 },
      { pnl: 30, exit_ts: 3000 }, // Win streak: 3
      { pnl: -10, exit_ts: 4000 },
      { pnl: -20, exit_ts: 5000 }, // Loss streak: 2
      { pnl: 40, exit_ts: 6000 },
      { pnl: 50, exit_ts: 7000 } // Win streak: 2
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);

    assert.equal(metrics.maxWinStreak, 3);
    assert.equal(metrics.maxLossStreak, 2);
  });

  test('handles zero pnl trades', () => {
    const trades = [
      { pnl: 0, exit_ts: 1000 },
      { pnl: 0, exit_ts: 2000 }
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);

    assert.equal(metrics.wins, 0);
    assert.equal(metrics.grossProfit, 0);
    assert.equal(metrics.grossLoss, 0);
    assert.equal(metrics.maxWinStreak, 0);
    assert.equal(metrics.maxLossStreak, 0);
    assert.equal(metrics.profitFactor, 0);
  });

  test('handles ms timestamps correctly', () => {
    const trades = [
      { pnl: 100, entry_ts_ms: 1000, exit_ts_ms: 2000 }
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);
    assert.equal(metrics.avgDuration, 1000);
  });

  test('handles string iso timestamps', () => {
    const trades = [
      { pnl: 100, entry_ts: "2023-01-01T00:00:00Z", exit_ts: "2023-01-01T01:00:00Z" } // 1 hour difference = 3600000ms
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);
    assert.equal(metrics.avgDuration, 3600000);
  });

  test('handles missing exit_ts with createdAt fallback', () => {
    const trades = [
      { pnl: 100, createdAt: "2023-01-01T01:00:00Z", entry_ts: "2023-01-01T00:00:00Z" } // 1 hour difference = 3600000ms
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);
    assert.equal(metrics.avgDuration, 3600000);
  });

  test('handles missing timestamps without crashing', () => {
    const trades = [
      { pnl: 100 }
    ];
    const metrics = calculatePerformanceMetrics(trades, 1000);
    assert.equal(metrics.avgDuration, 0);
  });
});

describe('Status Formatters', () => {
  test('getExpectancyStatus', () => {
    // expectancy = (wr * wl) - (1 - wr)
    // 0.6 * 2 - (1 - 0.6) = 1.2 - 0.4 = 0.8 -> Excellent
    assert.equal(getExpectancyStatus(0.6, 2).label, 'Excellent');
    // 0.5 * 1.5 - (1 - 0.5) = 0.75 - 0.5 = 0.25 -> Good
    assert.equal(getExpectancyStatus(0.5, 1.5).label, 'Good');
    // 0.4 * 1.2 - (1 - 0.4) = 0.48 - 0.6 = -0.12 -> Poor (Wait, it says Weak >= 0, so < 0 is Poor)
    assert.equal(getExpectancyStatus(0.4, 1.2).label, 'Poor');
    // 0.4 * 2.0 - (1 - 0.4) = 0.8 - 0.6 = 0.20 -> Acceptable
    assert.equal(getExpectancyStatus(0.4, 2.0).label, 'Acceptable');
    // 0.3 * 2.5 - (1 - 0.3) = 0.75 - 0.7 = 0.05 -> Acceptable
    assert.equal(getExpectancyStatus(0.3, 2.5).label, 'Acceptable');
    // 0.2 * 3.6 - (1 - 0.2) = 0.72 - 0.8 = -0.08 -> Poor
    assert.equal(getExpectancyStatus(0.2, 3.6).label, 'Poor');
    // 0.5 * 1.1 - 0.5 = 0.05 -> Acceptable
    assert.equal(getExpectancyStatus(0.5, 1.1).label, 'Acceptable');
    // 0.5 * 1.05 - 0.5 = 0.025 -> Weak
    assert.equal(getExpectancyStatus(0.5, 1.05).label, 'Weak');
    assert.equal(getExpectancyStatus(1, Infinity).label, 'Excellent'); // Infinity WL
    assert.equal(getExpectancyStatus(1, NaN).label, 'Excellent'); // NaN WL
  });

  test('getSharpeStatus', () => {
    assert.equal(getSharpeStatus(2.5).label, 'Excellent');
    assert.equal(getSharpeStatus(1.8).label, 'Good');
    assert.equal(getSharpeStatus(1.2).label, 'Acceptable');
    assert.equal(getSharpeStatus(0.8).label, 'Weak');
    assert.equal(getSharpeStatus(0.2).label, 'Poor');
    assert.equal(getSharpeStatus(null).label, 'Poor');
  });

  test('getSortinoStatus', () => {
    assert.equal(getSortinoStatus(3.5).label, 'Excellent');
    assert.equal(getSortinoStatus(2.5).label, 'Good');
    assert.equal(getSortinoStatus(1.5).label, 'Acceptable');
    assert.equal(getSortinoStatus(0.8).label, 'Weak');
    assert.equal(getSortinoStatus(0.2).label, 'Poor');
    assert.equal(getSortinoStatus(undefined).label, 'Poor');
  });

  test('getRrRecommendationStatus', () => {
    assert.equal(getRrRecommendationStatus(3.5).label, 'Aggressive');
    assert.equal(getRrRecommendationStatus(2.0).label, 'Balanced');
    assert.equal(getRrRecommendationStatus(1.0).label, 'Conservative');
    assert.equal(getRrRecommendationStatus(0.5).label, 'Scalp');
    assert.equal(getRrRecommendationStatus(0).label, 'Scalp');
  });
});
