const fs = require('fs');

// Fix session-lifecycle.uds-balance.spec.ts
let filepath = 'backend/node/src/engine/session-lifecycle.uds-balance.spec.ts';
let content = fs.readFileSync(filepath, 'utf8');

// We need to pass the activeTrades with risk_usdt because riskEngine uses `totalSlUsedForStrategy` exclusively now.
let search = `const allowedAtHigh = riskEngine.canEnter([], [], sessionState.getBalance(false), 'BTCUSDT', riskConfig, totalSlUsed);`;
let replace = `const allowedAtHigh = riskEngine.canEnter([{ symbol: 'ETHUSDT', risk_usdt: 50, status: 'OPEN', strategy_label: 'Momentum Strategy' } as any], [], sessionState.getBalance(false), 'BTCUSDT', riskConfig, totalSlUsed);`;

let search2 = `const blockedAtLow = riskEngine.canEnter([], [], sessionState.getBalance(false), 'BTCUSDT', riskConfig, totalSlUsed);`;
let replace2 = `const blockedAtLow = riskEngine.canEnter([{ symbol: 'ETHUSDT', risk_usdt: 50, status: 'OPEN', strategy_label: 'Momentum Strategy' } as any], [], sessionState.getBalance(false), 'BTCUSDT', riskConfig, totalSlUsed);`;

content = content.replace(search, replace).replace(search2, replace2);
fs.writeFileSync(filepath, content);
