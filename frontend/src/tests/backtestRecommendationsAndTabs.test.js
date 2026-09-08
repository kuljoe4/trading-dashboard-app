import test from 'node:test';
import assert from 'node:assert/strict';

test('Backtest Symbol Performance Leaderboard & Injection Logic', () => {
  const mockSymbolPerformance = [
    { symbol: 'BTCUSDT', totalTrades: 12, winRate: 66.67, totalPnl: 450.5, profitFactor: 2.1, isRecommended: true },
    { symbol: 'ETHUSDT', totalTrades: 8, winRate: 50.0, totalPnl: 120.0, profitFactor: 1.4, isRecommended: true },
    { symbol: 'SOLUSDT', totalTrades: 5, winRate: 20.0, totalPnl: -80.0, profitFactor: 0.6, isRecommended: false },
  ];

  // 1. Filter top recommended symbols
  const recommended = mockSymbolPerformance.filter(sp => sp.isRecommended).map(sp => sp.symbol);
  assert.deepEqual(recommended, ['BTCUSDT', 'ETHUSDT']);

  // 2. Test manual symbol injection into existing watchlist
  const existingWatchlist = ['SOLUSDT'];
  const injectSingle = (sym, list) => list.includes(sym) ? list : [...list, sym];

  const updatedWatchlist = injectSingle('BTCUSDT', existingWatchlist);
  assert.deepEqual(updatedWatchlist, ['SOLUSDT', 'BTCUSDT']);

  // 3. Test auto-inject top recommended symbols without duplicates
  const autoInjectedWatchlist = Array.from(new Set([...existingWatchlist, ...recommended]));
  assert.deepEqual(autoInjectedWatchlist, ['SOLUSDT', 'BTCUSDT', 'ETHUSDT']);
});

test('SectionTabs Overflow Tab Classification & Indicator Logic', () => {
  const primaryTabIds = ['scan', 'strategy', 'risk'];
  const secondaryTabIds = ['env', 'smart', 'backtest', 'presets'];

  // Test active tab classification
  const isSecondaryActive = (section) => secondaryTabIds.includes(section);

  assert.equal(isSecondaryActive('scan'), false);
  assert.equal(isSecondaryActive('strategy'), false);
  assert.equal(isSecondaryActive('risk'), false);
  assert.equal(isSecondaryActive('backtest'), true);
  assert.equal(isSecondaryActive('presets'), true);

  // Test error propagation for secondary tabs
  const errors = { trading_mode: 'env' };
  const TAB_ERROR_MAP = { trading_mode: 'env' };
  const tabHasError = (tabId) => Object.keys(errors).some(key => TAB_ERROR_MAP[key] === tabId);
  const secondaryHasError = secondaryTabIds.some(t => tabHasError(t));

  assert.equal(secondaryHasError, true);
  assert.equal(tabHasError('scan'), false);
});
