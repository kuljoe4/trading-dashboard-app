const fs = require('fs');
let code = fs.readFileSync('frontend/src/tests/tradeDiagnostics.test.js', 'utf8');

// For test 82: analyzeTradeDiagnostics detects missing SL
code = code.replace(`
test('analyzeTradeDiagnostics detects missing SL and generates error issue', () => {
  const trade = {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 50000,
    current_sl: 0,
    initial_sl: 0,
    qty: 1,
    status: 'OPEN'
  };`, `
test('analyzeTradeDiagnostics detects missing SL and generates error issue', () => {
  const trade = {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 50000,
    current_sl: 0,
    initial_sl: 0,
    rr_sequence_index: 0,
    max_rr_achieved: 0,
    qty: 1,
    status: 'OPEN'
  };`);
fs.writeFileSync('frontend/src/tests/tradeDiagnostics.test.js', code);
