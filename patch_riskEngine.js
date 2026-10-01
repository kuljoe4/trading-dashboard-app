const fs = require('fs');
const filepath = 'backend/node/src/engine/riskEngine.ts';
let content = fs.readFileSync(filepath, 'utf8');

const search = `    const riskPerTrade = prospectiveRiskPct !== undefined ? prospectiveRiskPct : (config.risk_pct_per_trade ?? 1.0);
    // In base strategy (or tests), fallback to the passed totalSlUsed to maintain backward compatibility
    const slUsed = isBaseStrategy ? totalSlUsed : totalSlUsedForStrategy;
    const totalRiskPct = balance > 0 ? (slUsed / balance) * 100 : 0;`;

const replace = `    const riskPerTrade = prospectiveRiskPct !== undefined ? prospectiveRiskPct : (config.risk_pct_per_trade ?? 1.0);
    // BOLT: Fix gating bug where base strategy was gated by global active risks instead of its own
    const slUsed = totalSlUsedForStrategy;
    const totalRiskPct = balance > 0 ? (slUsed / balance) * 100 : 0;`;

content = content.replace(search, replace);

const searchMsg = `    if (!isKnifeGatedBypass && activeTradesCountForStrategy + enteringCount >= maxOpenTrades) {
      const maxOpenMsg = isBaseStrategy ? \`Global max open trades (\${maxOpenTrades}) reached\` : \`Strategy max open trades (\${maxOpenTrades}) reached\`;
      return { canEnter: false, reason: \`\${maxOpenMsg} (incl. \${enteringCount} pending)\${!isBaseStrategy ? ' for label "' + targetLabel + '"' : ''}\` };
    }`;

const replaceMsg = `    if (!isKnifeGatedBypass && activeTradesCountForStrategy + enteringCount >= maxOpenTrades) {
      return { canEnter: false, reason: \`Strategy max open trades (\${maxOpenTrades}) reached (incl. \${enteringCount} pending) for label "\${targetLabel}"\` };
    }`;

content = content.replace(searchMsg, replaceMsg);

const searchSymbol = `    if (symbolTradeCount >= maxOpenTradesPerSymbol) {
      return { canEnter: false, reason: \`Max open trades for \${symbol} (\${maxOpenTradesPerSymbol}) reached\${!isBaseStrategy ? ' for label "' + targetLabel + '"' : ''}\` };
    }`;

const replaceSymbol = `    if (symbolTradeCount >= maxOpenTradesPerSymbol) {
      return { canEnter: false, reason: \`Max open trades for \${symbol} (\${maxOpenTradesPerSymbol}) reached for label "\${targetLabel}"\` };
    }`;

content = content.replace(searchSymbol, replaceSymbol);

fs.writeFileSync(filepath, content);
