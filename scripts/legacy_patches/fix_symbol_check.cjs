const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

const targetLoop = `        // BOLT OPTIMIZATION: Loop-fused anti-whipsaw same-candle re-entry check.
        // Replaces intermediate .filter() array allocation, .some() closure, and redundant new Date() parsing
        // with a single-pass traversal over closedTrades using numeric timestamps.
        const closedTrades = this.sessionState.closedTrades;
        let hasClosedForSymbol = false;
        for (let i = 0; i < closedTrades.length; i++) {
          if (closedTrades[i].symbol === opp.symbol) {
            hasClosedForSymbol = true;
            break;
          }
        }`;

const optLoop = `        // BOLT OPTIMIZATION: Loop-fused anti-whipsaw same-candle re-entry check.
        // Replaces intermediate .filter() array allocation, .some() closure, and redundant new Date() parsing
        // with a single-pass traversal over closedTrades using numeric timestamps.
        const closedTrades = this.sessionState.closedTrades;
        let hasClosedForSymbol = false;

        const symbolClosedTrades = [];
        for (let i = 0; i < closedTrades.length; i++) {
          if (closedTrades[i].symbol === opp.symbol) {
            hasClosedForSymbol = true;
            symbolClosedTrades.push(closedTrades[i]);
          }
        }`;

code = code.replace(targetLoop, optLoop);

const toReplace = `          // Pre-filter trades for this specific symbol once to avoid O(N*M) nested iterations
          const symbolClosedTrades = [];
          for (let i = 0; i < closedTrades.length; i++) {
            if (closedTrades[i].symbol === opp.symbol) {
              symbolClosedTrades.push(closedTrades[i]);
            }
          }`;

code = code.replace(toReplace, "");
fs.writeFileSync(file, code);
