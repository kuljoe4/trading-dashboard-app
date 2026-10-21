const fs = require('fs');

const files = [
  'backend/node/src/trading/session.service.ts',
  'backend/node/src/server.ts',
  'backend/node/src/engine/trading_session.service.ts',
  'backend/node/src/engine/session-lifecycle.service.ts',
  'backend/node/src/engine/market_feed.service.ts',
  'backend/node/src/lib/binanceSubscriptionManager.ts',
  'backend/node/src/lib/throttle.ts',
  'backend/node/src/lib/binanceClientFactory.ts'
];

for (let f of files) {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace(/const if/g, 'if');
  content = content.replace(/let if/g, 'if');
  content = content.replace(/var if/g, 'if');
  fs.writeFileSync(f, content);
}
