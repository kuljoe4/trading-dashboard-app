import test from 'node:test'
import assert from 'node:assert/strict'

// Lightweight pure logic extractor matching HistoryView strategy filtering & top wins/losses computation
function processHistoryTradeFiltering(modeTrades, selectedStrategy) {
  // Available strategies map calculation
  const map = new Map();
  for (let i = 0; i < modeTrades.length; i++) {
    const t = modeTrades[i];
    const label = t.strategy_label || t.strategyLabel || 'Momentum Strategy';
    const pnl = Number(t.pnl || 0);
    if (!map.has(label)) {
      map.set(label, { label, count: 0, pnl: 0 });
    }
    const item = map.get(label);
    item.count += 1;
    item.pnl += pnl;
  }
  const availableStrategies = Array.from(map.values()).sort((a, b) => b.count - a.count);

  // Top 5 Wins & Top 5 Losses calculation
  const wins = [];
  const losses = [];
  const tradesToProcess = selectedStrategy === 'ALL'
    ? modeTrades
    : modeTrades.filter(t => (t.strategy_label || t.strategyLabel || 'Momentum Strategy') === selectedStrategy);

  for (let i = 0; i < tradesToProcess.length; i++) {
    const t = tradesToProcess[i];
    const pnl = Number(t.pnl || 0);
    if (pnl > 0) wins.push(t);
    else if (pnl < 0) losses.push(t);
  }

  wins.sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0));
  losses.sort((a, b) => Number(a.pnl || 0) - Number(b.pnl || 0));

  return {
    availableStrategies,
    topWins: wins.slice(0, 5),
    topLosses: losses.slice(0, 5),
    filteredCount: tradesToProcess.length
  };
}

test('HistoryView Strategy Filtering & Top 5 Wins/Losses Unit Tests', async (t) => {
  const sampleTrades = [
    { id: '1', symbol: 'BTCUSDT', pnl: 250, strategy_label: 'Dual EMA Cross' },
    { id: '2', symbol: 'ETHUSDT', pnl: -120, strategy_label: 'Dual EMA Cross' },
    { id: '3', symbol: 'SOLUSDT', pnl: 450, strategy_label: 'Supertrend Trend' },
    { id: '4', symbol: 'DOGEUSDT', pnl: -300, strategy_label: 'Supertrend Trend' },
    { id: '5', symbol: 'AVAXUSDT', pnl: 100, strategy_label: 'Dual EMA Cross' },
    { id: '6', symbol: 'ADAUSDT', pnl: -50, strategy_label: 'Supertrend Trend' },
    { id: '7', symbol: 'LINKUSDT', pnl: 600, strategy_label: 'Dual EMA Cross' },
    { id: '8', symbol: 'XRPUSDT', pnl: -400, strategy_label: 'Dual EMA Cross' },
    { id: '9', symbol: 'DOTUSDT', pnl: -10, strategy_label: 'Supertrend Trend' },
    { id: '10', symbol: 'BNBUSDT', pnl: 50, strategy_label: 'Supertrend Trend' },
  ];

  await t.test('derives available strategy badges with counts and total PnLs', () => {
    const result = processHistoryTradeFiltering(sampleTrades, 'ALL');
    assert.equal(result.availableStrategies.length, 2);

    const dualEma = result.availableStrategies.find(s => s.label === 'Dual EMA Cross');
    assert.equal(dualEma.count, 5);
    assert.equal(dualEma.pnl, 250 - 120 + 100 + 600 - 400); // 430

    const supertrend = result.availableStrategies.find(s => s.label === 'Supertrend Trend');
    assert.equal(supertrend.count, 5);
    assert.equal(supertrend.pnl, 450 - 300 - 50 - 10 + 50); // 140
  });

  await t.test('extracts top 5 biggest wins and top 5 biggest losses across all strategies', () => {
    const result = processHistoryTradeFiltering(sampleTrades, 'ALL');
    assert.equal(result.topWins.length, 5); // 5 wins in sample dataset
    assert.equal(result.topWins[0].id, '7'); // +600 PnL
    assert.equal(result.topWins[1].id, '3'); // +450 PnL
    assert.equal(result.topWins[2].id, '1'); // +250 PnL

    assert.equal(result.topLosses.length, 5); // 5 losses in sample dataset
    assert.equal(result.topLosses[0].id, '8'); // -400 PnL
    assert.equal(result.topLosses[1].id, '4'); // -300 PnL
    assert.equal(result.topLosses[2].id, '2'); // -120 PnL
  });

  await t.test('filters top wins and losses when a specific strategy filter is active', () => {
    const result = processHistoryTradeFiltering(sampleTrades, 'Dual EMA Cross');
    assert.equal(result.filteredCount, 5);

    // Wins in Dual EMA Cross: id 7 (+600), id 1 (+250), id 5 (+100)
    assert.equal(result.topWins.length, 3);
    assert.equal(result.topWins[0].id, '7');
    assert.equal(result.topWins[1].id, '1');
    assert.equal(result.topWins[2].id, '5');

    // Losses in Dual EMA Cross: id 8 (-400), id 2 (-120)
    assert.equal(result.topLosses.length, 2);
    assert.equal(result.topLosses[0].id, '8');
    assert.equal(result.topLosses[1].id, '2');
  });
});
