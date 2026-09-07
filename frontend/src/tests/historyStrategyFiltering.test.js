import test from 'node:test'
import assert from 'node:assert/strict'

// Pure logic helper mirroring per-session strategy filtering and top wins/losses inside SessionGroup
function processSessionTradeFiltering(sessionTrades, sessionStrategyFilter) {
  // Available session strategy badges calculation
  const map = new Map();
  const safeTrades = sessionTrades || [];
  for (let i = 0; i < safeTrades.length; i++) {
    const t = safeTrades[i];
    const label = t.strategy_label || t.strategyLabel || 'Momentum Strategy';
    const pnl = Number(t.pnl || 0);
    const fee = Number(t.realized_fee || t.commission || 0);
    const funding = Number(t.funding_fee || 0);
    if (!map.has(label)) {
      map.set(label, { label, count: 0, pnl: 0, fees: 0, funding: 0 });
    }
    const item = map.get(label);
    item.count += 1;
    item.pnl += pnl;
    item.fees += fee;
    item.funding += funding;
  }
  const availableSessionStrategies = Array.from(map.values()).sort((a, b) => b.count - a.count);

  // Filter trades by selected strategy
  const filteredTrades = sessionStrategyFilter === 'ALL'
    ? safeTrades
    : safeTrades.filter(t => (t.strategy_label || t.strategyLabel || 'Momentum Strategy') === sessionStrategyFilter);

  // Calculate per-session top 5 wins and losses and fees
  const wins = [];
  const losses = [];
  let totalSessionFees = 0;
  let totalSessionFunding = 0;

  for (let i = 0; i < filteredTrades.length; i++) {
    const t = filteredTrades[i];
    const pnl = Number(t.pnl || 0);
    totalSessionFees += Number(t.realized_fee || t.commission || 0);
    totalSessionFunding += Number(t.funding_fee || 0);

    if (pnl > 0) wins.push(t);
    else if (pnl < 0) losses.push(t);
  }

  wins.sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0));
  losses.sort((a, b) => Number(a.pnl || 0) - Number(b.pnl || 0));

  return {
    availableSessionStrategies,
    filteredTrades,
    totalSessionFees,
    totalSessionFunding,
    sessionTopWins: wins.slice(0, 5),
    sessionTopLosses: losses.slice(0, 5)
  };
}

test('SessionGroup Per-Session Strategy Filtering & Top Wins/Losses Unit Tests', async (t) => {
  const sessionTrades = [
    { id: '1', symbol: 'BTCUSDT', pnl: 150, realized_fee: 1.5, funding_fee: 0.2, strategy_label: 'Momentum Strategy' },
    { id: '2', symbol: 'ETHUSDT', pnl: -80, realized_fee: 1.0, funding_fee: -0.1, strategy_label: 'Momentum Strategy' },
    { id: '3', symbol: 'SOLUSDT', pnl: 300, realized_fee: 2.0, funding_fee: 0.5, strategy_label: 'EMA Breakout Variant' },
    { id: '4', symbol: 'DOGEUSDT', pnl: -150, realized_fee: 1.2, funding_fee: 0.0, strategy_label: 'EMA Breakout Variant' },
    { id: '5', symbol: 'AVAXUSDT', pnl: 90, realized_fee: 0.8, funding_fee: 0.1, strategy_label: 'Momentum Strategy' },
    { id: '6', symbol: 'ADAUSDT', pnl: -200, realized_fee: 1.8, funding_fee: -0.3, strategy_label: 'EMA Breakout Variant' },
    { id: '7', symbol: 'LINKUSDT', pnl: 500, realized_fee: 2.5, funding_fee: 0.8, strategy_label: 'EMA Breakout Variant' },
    { id: '8', symbol: 'XRPUSDT', pnl: -20, realized_fee: 0.5, funding_fee: 0.0, strategy_label: 'Momentum Strategy' },
  ];

  await t.test('derives available strategy badges for a single session with fee and funding subtotals', () => {
    const result = processSessionTradeFiltering(sessionTrades, 'ALL');
    assert.equal(result.availableSessionStrategies.length, 2);

    const momentum = result.availableSessionStrategies.find(s => s.label === 'Momentum Strategy');
    assert.equal(momentum.count, 4);
    assert.equal(momentum.pnl, 150 - 80 + 90 - 20); // 140
    assert.equal(momentum.fees, 1.5 + 1.0 + 0.8 + 0.5); // 3.8

    const variant = result.availableSessionStrategies.find(s => s.label === 'EMA Breakout Variant');
    assert.equal(variant.count, 4);
    assert.equal(variant.pnl, 300 - 150 - 200 + 500); // 450
    assert.equal(variant.fees, 2.0 + 1.2 + 1.8 + 2.5); // 7.5
  });

  await t.test('aggregates session fees and funding correctly for selected strategy variant', () => {
    const allResult = processSessionTradeFiltering(sessionTrades, 'ALL');
    assert.equal(allResult.totalSessionFees, 11.3); // 3.8 + 7.5
    assert.equal(Number(allResult.totalSessionFunding.toFixed(2)), 1.2);

    const variantResult = processSessionTradeFiltering(sessionTrades, 'EMA Breakout Variant');
    assert.equal(variantResult.totalSessionFees, 7.5);
    assert.equal(Number(variantResult.totalSessionFunding.toFixed(2)), 1.0);
  });

  await t.test('extracts top 5 wins and losses per session under ALL strategies filter', () => {
    const result = processSessionTradeFiltering(sessionTrades, 'ALL');
    assert.equal(result.sessionTopWins.length, 4); // 4 wins in session
    assert.equal(result.sessionTopWins[0].id, '7'); // +500 PnL
    assert.equal(result.sessionTopWins[1].id, '3'); // +300 PnL

    assert.equal(result.sessionTopLosses.length, 4); // 4 losses in session
    assert.equal(result.sessionTopLosses[0].id, '6'); // -200 PnL
    assert.equal(result.sessionTopLosses[1].id, '4'); // -150 PnL
  });

  await t.test('filters session trades and top wins/losses when filtering by strategy variant', () => {
    const result = processSessionTradeFiltering(sessionTrades, 'EMA Breakout Variant');
    assert.equal(result.filteredTrades.length, 4);

    // Wins in EMA Breakout Variant: id 7 (+500), id 3 (+300)
    assert.equal(result.sessionTopWins.length, 2);
    assert.equal(result.sessionTopWins[0].id, '7');
    assert.equal(result.sessionTopWins[1].id, '3');

    // Losses in EMA Breakout Variant: id 6 (-200), id 4 (-150)
    assert.equal(result.sessionTopLosses.length, 2);
    assert.equal(result.sessionTopLosses[0].id, '6');
    assert.equal(result.sessionTopLosses[1].id, '4');
  });
});
