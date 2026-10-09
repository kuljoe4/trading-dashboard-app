import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getMarketRegimeInfo } from '../utils/marketRegime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Market Regime Analytics Unit Tests - getMarketRegimeInfo', async (t) => {
  await t.test('evaluates quiet / slow market regime correctly when candidates are below scan threshold', () => {
    const mockScannerResults = [
      { symbol: 'BTCUSDT', momentum: 0.35, pct: 0.35, score: 25, price: 62000, high_24h: 63000, low_24h: 61000, score_breakdown: { volatility: 10 } },
      { symbol: 'ETHUSDT', momentum: -0.42, pct: -0.42, score: 30, score_breakdown: { volatility: 12 } },
      { symbol: 'SOLUSDT', momentum: 0.18, pct: 0.18, score: 15, score_breakdown: { volatility: 5 } }
    ];
    const mockConfig = { scan_pct_threshold: 2.0, scan_interval: '1m' };

    const regime = getMarketRegimeInfo(mockScannerResults, mockConfig);

    assert.equal(regime.regime, 'slow');
  });
});
