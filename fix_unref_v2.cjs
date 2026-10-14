const fs = require('fs');

function addUnref2(file) {
  let content = fs.readFileSync(file, 'utf8');

  // It's probably easier to just find the names of the intervals and inject the unref
  const names = [
    'cleanupInterval',
    'heartbeatInterval',
    'this.hotLoopInterval',
    'this.mainLoopInterval',
    'this.udsLivenessCheck',
    'this.listenKeyKeepAlive',
    'this.watchlistInterval',
    'this.processQueueInterval',
    'this.pingInterval',
    'this.statsInterval',
    'this.stallWatchdogInterval',
    'throttleInterval',
    'pingInterval',
    'BinanceRequestQueue.rolloverInterval'
  ];

  for (let n of names) {
     const regex = new RegExp(`(${n.replace(/\./g, '\\.')}\\s*=\\s*setInterval\\([^;]+;)`, 'gs');
     content = content.replace(regex, `$1\n    if (${n}.unref) ${n}.unref();`);
  }

  fs.writeFileSync(file, content);
}

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

  // just generic
  content = content.replace(/(\w+(?:\.\w+)?\s*=\s*setInterval\(.*?\}\s*,\s*[^;]+;)/gs, (match, p1) => {
      let varName = match.split('=')[0].trim();
      varName = varName.replace('const ', '').replace('let ', '').replace('var ', '');
      if (content.includes(`if (${varName}.unref) ${varName}.unref();`)) return match;
      if (varName === 'global.setInterval' || varName === 'originalSetInterval') return match;
      return match + `\n    if (${varName}.unref) ${varName}.unref();`;
  });

  // Also catch simple setInterval(() => ..., ms); without multiline
  content = content.replace(/(\w+(?:\.\w+)?\s*=\s*setInterval\([^,]+,\s*[^;]+;)/g, (match, p1) => {
      let varName = match.split('=')[0].trim();
      varName = varName.replace('const ', '').replace('let ', '').replace('var ', '');
      if (content.includes(`if (${varName}.unref) ${varName}.unref();`)) return match;
      if (varName === 'global.setInterval' || varName === 'originalSetInterval') return match;
      return match + `\n    if (${varName}.unref) ${varName}.unref();`;
  });

  fs.writeFileSync(f, content);
}
