const fs = require('fs');
const filepath = 'backend/node/src/engine/riskEngine.spec.ts';
let content = fs.readFileSync(filepath, 'utf8');

const search = `expect(result.reason).toContain('Global max open trades (5) reached (incl. 1 pending)');`;
const replace = `expect(result.reason).toContain('Strategy max open trades (5) reached (incl. 1 pending)');`;

content = content.replace(search, replace);

// The test 'should block entry if nominal risk itself exceeds max_total_risk_pct'
// It sets currentSlUsed to 100 on a balance of 1000, so risk is 10%.
// Max total risk pct is 5.
// However, since we now use totalSlUsedForStrategy, we need to make sure the mock trades have the right strategy label.
const search2 = `const activeTrades = [
        { symbol: 'ETHUSDT', risk_usdt: 100, status: 'OPEN', strategy_label: 'Momentum Strategy' } as Trade
      ];`;
content = content.replace(search2, search2); // Wait, active trades are not passed correctly in the test for this case?

fs.writeFileSync(filepath, content);
