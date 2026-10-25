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

  const regex = /(\s+(?:const|let|var)?\s*)([a-zA-Z0-9_\.]+)\s*=\s*setInterval\([^;]+;/g;

  content = content.replace(regex, (match, prefix, varName) => {
    // If it's `this.something`, varName will be `this.something`.
    // If it's just `something`, varName will be `something`.
    // Let's only append unref if it doesn't already have one immediately after.

    // Check if the varName is valid (not global or weird)
    if (varName === 'global.setInterval' || varName === 'originalSetInterval') return match;

    // Don't duplicate unref calls
    if (content.includes(`if (${varName}.unref) ${varName}.unref();`)) {
       return match;
    }

    return match + `\n${prefix}if (${varName}.unref) ${varName}.unref();`;
  });

  // Custom fix for short closures
  const regexShort = /(\s+(?:const|let|var)?\s*)([a-zA-Z0-9_\.]+)\s*=\s*setInterval\([^,]+,\s*[^;]+;/g;
  content = content.replace(regexShort, (match, prefix, varName) => {
    if (varName === 'global.setInterval' || varName === 'originalSetInterval') return match;
    if (content.includes(`if (${varName}.unref) ${varName}.unref();`)) {
       return match;
    }
    return match + `\n${prefix}if (${varName}.unref) ${varName}.unref();`;
  });

  fs.writeFileSync(f, content);
}
