const fs = require('fs');
const filepath = 'backend/node/src/engine/riskEngine.spec.ts';
let content = fs.readFileSync(filepath, 'utf8');

const search = `    it('should block entry if nominal risk itself exceeds max_total_risk_pct', () => {
      const activeTrades: any[] = [];
      const closedTrades: any[] = [];
      const balance = 1000;
      const config = {
        risk_pct_per_trade: 1.5, // nominal risk is 1.5%
        max_total_risk_pct: 2.0 // limit is 2.0%
      } as any;
      const currentSlUsed = 10; // 1.0% of 1000 used`;

const replace = `    it('should block entry if nominal risk itself exceeds max_total_risk_pct', () => {
      const activeTrades: any[] = [{ symbol: 'ETHUSDT', risk_usdt: 10, status: 'OPEN', strategy_label: 'Momentum Strategy' }];
      const closedTrades: any[] = [];
      const balance = 1000;
      const config = {
        strategy_label: 'Momentum Strategy',
        risk_pct_per_trade: 1.5, // nominal risk is 1.5%
        max_total_risk_pct: 2.0 // limit is 2.0%
      } as any;
      const currentSlUsed = 10; // 1.0% of 1000 used`;

content = content.replace(search, replace);
fs.writeFileSync(filepath, content);
