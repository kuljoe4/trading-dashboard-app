import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionAPI, sanitizeSessionConfig } from '../api/client.js';

describe('Backtest API & UI Integration', () => {
  it('correctly creates backtest API request with sanitized config payload', async () => {
    let capturedUrl = '';
    let capturedBody = null;

    const mockAxios = {
      post: async (url, body) => {
        capturedUrl = url;
        capturedBody = body;
        return {
          data: {
            totalTrades: 12,
            wins: 8,
            losses: 4,
            winRate: 66.67,
            totalPnl: 450.25,
            pnlPct: 4.5,
            profitFactor: 2.1,
            maxDrawdown: 120.50,
            maxDrawdownPct: 1.2,
            sharpeRatio: 1.85,
            expectancy: 37.52,
            startingBalance: 10000,
            endingBalance: 10450.25,
            totalFees: 18.20,
            executionTimeMs: 150,
            trades: [],
            equityCurve: [],
          },
        };
      },
    };

    const api = createSessionAPI(mockAxios);
    const result = await api.backtest({
      config: {
        trading_mode: 'backtest',
        scan_interval: '5m',
        risk_pct_per_trade: 1.5,
        unallowed_field: 'should_be_stripped',
      },
      symbols: ['BTCUSDT', 'ETHUSDT'],
      days: 14,
      startingBalance: 10000,
    });

    assert.equal(capturedUrl, '/session/backtest');
    assert.equal(capturedBody.days, 14);
    assert.equal(capturedBody.startingBalance, 10000);
    assert.deepEqual(capturedBody.symbols, ['BTCUSDT', 'ETHUSDT']);
    assert.equal(capturedBody.config.trading_mode, 'backtest');
    assert.equal(capturedBody.config.scan_interval, '5m');
    assert.equal(capturedBody.config.unallowed_field, undefined);
    assert.equal(result.data.totalTrades, 12);
  });

  it('sanitizes backtest config parameters cleanly', () => {
    const raw = {
      trading_mode: 'backtest',
      scan_interval: '15m',
      risk_pct_per_trade: 2.0,
      invalidKey: 'test',
    };

    const sanitized = sanitizeSessionConfig(raw);
    assert.equal(sanitized.trading_mode, 'backtest');
    assert.equal(sanitized.scan_interval, '15m');
    assert.equal(sanitized.risk_pct_per_trade, 2.0);
    assert.equal(sanitized.invalidKey, undefined);
  });
});
