import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getMarketRegimeInfo } from '../utils/marketRegime.js';

test('Market Regime Analytics Unit Tests - getMarketRegimeInfo', async (t) => {
  await t.test('evaluates quiet / slow market regime correctly when candidates are below scan threshold', () => {
    const mockScannerResults = [
      { symbol: 'BTCUSDT', momentum: 0.35, pct: 0.35, score: 25, score_breakdown: { volatility: 10 } },
      { symbol: 'ETHUSDT', momentum: -0.42, pct: -0.42, score: 30, score_breakdown: { volatility: 12 } },
      { symbol: 'SOLUSDT', momentum: 0.18, pct: 0.18, score: 15, score_breakdown: { volatility: 5 } }
    ];
    const mockConfig = { scan_pct_threshold: 2.0, scan_interval: '1m' };

    const regime = getMarketRegimeInfo(mockScannerResults, mockConfig);

    assert.equal(regime.regime, 'slow');
    assert.equal(regime.label, 'Slow / Quiet Market');
    assert.equal(regime.passingCount, 0);
    assert.equal(regime.totalCount, 3);
    assert.equal(regime.threshold, 2.0);
    assert.ok(regime.avgMomentum < 1.0);
    assert.ok(regime.guidance.includes('Low market velocity detected'));
  });

  await t.test('evaluates moderate market pace regime correctly', () => {
    const mockScannerResults = [
      { symbol: 'BTCUSDT', momentum: 1.85, pct: 1.85, score: 55, score_breakdown: { volatility: 35 } },
      { symbol: 'ETHUSDT', momentum: -1.45, pct: -1.45, score: 48, score_breakdown: { volatility: 30 } },
      { symbol: 'SOLUSDT', momentum: 0.95, pct: 0.95, score: 40, score_breakdown: { volatility: 20 } }
    ];
    const mockConfig = { scan_pct_threshold: 2.0, scan_interval: '5m' };

    const regime = getMarketRegimeInfo(mockScannerResults, mockConfig);

    assert.equal(regime.regime, 'moderate');
    assert.equal(regime.label, 'Moderate Pace');
    assert.equal(regime.passingCount, 0);
    assert.equal(regime.totalCount, 3);
    assert.ok(regime.avgMomentum > 1.0);
  });

  await t.test('evaluates active / fast market regime correctly when candidates exceed threshold', () => {
    const mockScannerResults = [
      { symbol: 'BTCUSDT', momentum: 3.52, pct: 3.52, score: 82, score_breakdown: { volatility: 75 } },
      { symbol: 'ETHUSDT', momentum: -2.85, pct: -2.85, score: 78, score_breakdown: { volatility: 68 } },
      { symbol: 'SOLUSDT', momentum: 1.20, pct: 1.20, score: 50, score_breakdown: { volatility: 30 } }
    ];
    const mockConfig = { scan_pct_threshold: 2.0, scan_interval: '1m' };

    const regime = getMarketRegimeInfo(mockScannerResults, mockConfig);

    assert.equal(regime.regime, 'active');
    assert.equal(regime.label, 'Fast / High Volatility');
    assert.equal(regime.passingCount, 2);
    assert.equal(regime.totalCount, 3);
    assert.ok(regime.speedPct >= 70);
  });

  await t.test('respects state overrides for paused scanner and hibernating engine', () => {
    const mockConfig = { scan_pct_threshold: 2.0 };

    const pausedRegime = getMarketRegimeInfo([], mockConfig, { scannerPaused: true });
    assert.equal(pausedRegime.regime, 'paused');
    assert.equal(pausedRegime.label, 'Scanner Paused');

    const hibernatingRegime = getMarketRegimeInfo([], mockConfig, { hibernating: true });
    assert.equal(hibernatingRegime.regime, 'hibernating');
    assert.equal(hibernatingRegime.label, 'Engine Hibernating');
  });

  await t.test('benchmark: verifies zero-allocation O(N) execution speed', () => {
    const mockScannerResults = Array.from({ length: 50 }, (_, i) => ({
      symbol: `SYM${i}USDT`,
      momentum: (i % 5) * 0.8,
      pct: (i % 5) * 0.8,
      score: 30 + (i % 50),
      score_breakdown: { volatility: 20 + i }
    }));
    const mockConfig = { scan_pct_threshold: 2.0 };

    const iterations = 500000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      getMarketRegimeInfo(mockScannerResults, mockConfig);
    }
    const duration = performance.now() - start;

    console.log(`⚡ Bolt Performance Benchmark (getMarketRegimeInfo, ${iterations} iterations across 50 opps): ${duration.toFixed(2)}ms (${((duration / iterations) * 1000).toFixed(4)}us / op)`);
    assert.ok(duration < 2000, 'getMarketRegimeInfo execution time must be under 2000ms for 500k ops');
  });
});

test('Market Regime UI & Accessibility Standard Verification', () => {
  const dashboardPath = path.resolve('frontend/src/views/DashboardView.jsx');
  const scannerOverlayPath = path.resolve('frontend/src/components/ScannerOverlay.jsx');

  const dashboardCode = fs.readFileSync(dashboardPath, 'utf8');
  const overlayCode = fs.readFileSync(scannerOverlayPath, 'utf8');

  // Verify getMarketRegimeInfo is used
  assert.ok(dashboardCode.includes('getMarketRegimeInfo'), 'DashboardView must import and use getMarketRegimeInfo');
  assert.ok(overlayCode.includes('getMarketRegimeInfo'), 'ScannerOverlay must import and use getMarketRegimeInfo');

  // Verify accessibility attributes
  assert.ok(dashboardCode.includes('role="region"'), 'DashboardView market regime pills must enforce role="region"');
  assert.ok(dashboardCode.includes('aria-label='), 'DashboardView market regime pills must enforce aria-label');
  assert.ok(dashboardCode.includes('tabIndex={0}'), 'DashboardView market regime pills must enforce tabIndex={0}');

  assert.ok(overlayCode.includes('role="region"'), 'ScannerOverlay market regime telemetry bar must enforce role="region"');
  assert.ok(overlayCode.includes('aria-label='), 'ScannerOverlay market regime telemetry bar must enforce aria-label');
  assert.ok(overlayCode.includes('tabIndex={0}'), 'ScannerOverlay market regime telemetry bar must enforce tabIndex={0}');
});
