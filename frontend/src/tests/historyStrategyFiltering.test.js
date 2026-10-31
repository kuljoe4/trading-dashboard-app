import test from 'node:test'
import assert from 'node:assert/strict'

// Pure logic helper mirroring per-session strategy, symbol, and combined combo filtering inside SessionGroup
function processSessionTradeFiltering(sessionTrades, sessionStrategyFilter = 'ALL', sessionSymbolFilter = 'ALL') {
  const stratMap = new Map();
  const symMap = new Map();
  const comboMap = new Map();

  const stratList = [];
  const symList = [];
  const comboList = [];

  const safeTrades = sessionTrades || [];
  for (let i = 0; i < safeTrades.length; i++) {
    const t = safeTrades[i];
    const label = t.strategy_label || t.strategyLabel || 'Momentum Strategy';
    const sym = t.symbol || 'UNKNOWN';
    const comboKey = `${label}::${sym}`;

    const pnl = Number(t.pnl || 0);
    const fee = Number(t.realized_fee || t.commission || 0);
    const funding = Number(t.funding_fee || 0);

    let sItem = stratMap.get(label);
    if (sItem === undefined) {
      sItem = { label, count: 0, pnl: 0, fees: 0, funding: 0 };
      stratMap.set(label, sItem);
      stratList.push(sItem);
    }
    sItem.count += 1;
    sItem.pnl += pnl;
    sItem.fees += fee;
    sItem.funding += funding;

    let symItem = symMap.get(sym);
    if (symItem === undefined) {
      symItem = { symbol: sym, count: 0, pnl: 0, fees: 0, funding: 0 };
      symMap.set(sym, symItem);
      symList.push(symItem);
    }
    symItem.count += 1;
    symItem.pnl += pnl;
    symItem.fees += fee;
    symItem.funding += funding;

    let comboItem = comboMap.get(comboKey);
    if (comboItem === undefined) {
      comboItem = { key: comboKey, strategy: label, symbol: sym, count: 0, pnl: 0, fees: 0, funding: 0 };
      comboMap.set(comboKey, comboItem);
      comboList.push(comboItem);
    }
    comboItem.count += 1;
    comboItem.pnl += pnl;
    comboItem.fees += fee;
    comboItem.funding += funding;
  }

  const availableSessionStrategies = stratList.sort((a, b) => b.count - a.count);
  const availableSessionSymbols = symList.sort((a, b) => b.count - a.count);
  const availableSessionCombos = comboList.sort((a, b) => b.count - a.count);

  // Filter trades by selected strategy and symbol together
  const filteredTrades = safeTrades.filter(t => {
    const label = t.strategy_label || t.strategyLabel || 'Momentum Strategy';
    const matchStrat = sessionStrategyFilter === 'ALL' || label === sessionStrategyFilter;
    const matchSym = sessionSymbolFilter === 'ALL' || t.symbol === sessionSymbolFilter;
    return matchStrat && matchSym;
  });

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
    availableSessionSymbols,
    availableSessionCombos,
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

  await t.test('filters session trades by symbol independently', () => {
    const btcResult = processSessionTradeFiltering(sessionTrades, 'ALL', 'BTCUSDT');
    assert.equal(btcResult.filteredTrades.length, 1);
    assert.equal(btcResult.filteredTrades[0].id, '1');

    const solResult = processSessionTradeFiltering(sessionTrades, 'ALL', 'SOLUSDT');
    assert.equal(solResult.filteredTrades.length, 1);
    assert.equal(solResult.filteredTrades[0].pnl, 300);
  });

  await t.test('filters session trades by symbol AND strategy together', () => {
    // Session trades with same symbol across multiple strategies
    const multiStratTrades = [
      { id: '10', symbol: 'BTCUSDT', pnl: 100, strategy_label: 'Momentum Strategy' },
      { id: '11', symbol: 'BTCUSDT', pnl: -50, strategy_label: 'EMA Breakout Variant' },
      { id: '12', symbol: 'ETHUSDT', pnl: 200, strategy_label: 'Momentum Strategy' },
      { id: '13', symbol: 'BTCUSDT', pnl: 300, strategy_label: 'Momentum Strategy' },
    ];

    // Filter by Strategy='Momentum Strategy' AND Symbol='BTCUSDT'
    const comboResult = processSessionTradeFiltering(multiStratTrades, 'Momentum Strategy', 'BTCUSDT');
    assert.equal(comboResult.filteredTrades.length, 2);
    assert.deepEqual(comboResult.filteredTrades.map(t => t.id), ['10', '13']);

    // Filter by Strategy='EMA Breakout Variant' AND Symbol='BTCUSDT'
    const comboResult2 = processSessionTradeFiltering(multiStratTrades, 'EMA Breakout Variant', 'BTCUSDT');
    assert.equal(comboResult2.filteredTrades.length, 1);
    assert.equal(comboResult2.filteredTrades[0].id, '11');

    // Filter by non-matching combination
    const emptyResult = processSessionTradeFiltering(multiStratTrades, 'EMA Breakout Variant', 'ETHUSDT');
    assert.equal(emptyResult.filteredTrades.length, 0);
  });
});
