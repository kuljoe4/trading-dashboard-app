const fs = require('fs');

// Fix session-lifecycle.uds-balance.spec.ts
let filepath = 'backend/node/src/engine/session-lifecycle.uds-balance.spec.ts';
let content = fs.readFileSync(filepath, 'utf8');

// The test is now using totalSlUsedForStrategy because canEnter was modified. We need to pass the strategy_label.
let search = `const blockedAtLow = riskEngine.canEnter([], [], sessionState.getBalance(false), 'BTCUSDT', riskConfig, totalSlUsed);`;
let replace = `const blockedAtLow = riskEngine.canEnter([], [], sessionState.getBalance(false), 'BTCUSDT', riskConfig, totalSlUsed);`;
// wait, the problem is totalSlUsed is passed, but canEnter now ignores it unless isBaseStrategy.
// isBaseStrategy is targetLabel === baseLabel || targetLabel === 'Momentum Strategy'.
// Let's check riskConfig in that test.

// Fix knife_whipsaw_gating.spec.ts
let filepath3 = 'backend/node/src/engine/knife_whipsaw_gating.spec.ts';
let content3 = fs.readFileSync(filepath3, 'utf8');
let search3 = `expect(result.reason).toContain('Global max open trades (1) reached');`;
let replace3 = `expect(result.reason).toContain('Strategy max open trades (1) reached');`;
content3 = content3.replace(search3, replace3);
fs.writeFileSync(filepath3, content3);
