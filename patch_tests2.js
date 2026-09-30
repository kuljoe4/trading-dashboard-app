const fs = require('fs');

// Fix session-lifecycle.uds-balance.spec.ts
let filepath = 'backend/node/src/engine/session-lifecycle.uds-balance.spec.ts';
let content = fs.readFileSync(filepath, 'utf8');

// The test is now using totalSlUsedForStrategy because canEnter was modified.
// We need to set `strategy_label: 'Momentum Strategy'` on the config to ensure `isBaseStrategy` evaluates to true, OR pass activeTrades with the correct strategy label and risk.
let searchConfig = `  // Config that gates purely on total SL risk % of balance.
  const riskConfig = {
    max_open_trades: 5,
    max_open_trades_per_symbol: 1,
    max_total_risk_pct: 4,
    risk_pct_per_trade: 1,
    total_sl_guard_usdt: 200,
  } as any;`;

let replaceConfig = `  // Config that gates purely on total SL risk % of balance.
  const riskConfig = {
    strategy_label: 'Momentum Strategy',
    max_open_trades: 5,
    max_open_trades_per_symbol: 1,
    max_total_risk_pct: 4,
    risk_pct_per_trade: 1,
    total_sl_guard_usdt: 200,
  } as any;`;

content = content.replace(searchConfig, replaceConfig);

// And we must pass activeTrades to reflect the slUsed because `totalSlUsedForStrategy` depends on activeTrades if we don't hit the fallback.
// Wait, isBaseStrategy falls back to totalSlUsed. If targetLabel === baseLabel (both 'Momentum Strategy'), it falls back to totalSlUsed.
// So just adding strategy_label: 'Momentum Strategy' should fix it.
fs.writeFileSync(filepath, content);
