const fs = require('fs');

function addUnref(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/(const |let |this\.)([a-zA-Z0-9_]+)\s*=\s*setInterval\((.*?)\);/gs, (match, p1, p2) => {
     // If the next line already has unref, skip
     if (content.includes(`if (${p2}.unref) ${p2}.unref();`)) {
       return match;
     }
     return match + `\n    if (${p2}.unref) ${p2}.unref();`;
  });

  // Handcrafted fix for the tricky ones
  content = content.replace(/this\.hotLoopInterval = setInterval\(\(\) => this\.hotLoop\(\), hotMs\);/g, 'this.hotLoopInterval = setInterval(() => this.hotLoop(), hotMs);\n    if (this.hotLoopInterval.unref) this.hotLoopInterval.unref();');
  content = content.replace(/this\.mainLoopInterval = setInterval\(\(\) => this\.mainLoop\(\), mainMs\);/g, 'this.mainLoopInterval = setInterval(() => this.mainLoop(), mainMs);\n    if (this.mainLoopInterval.unref) this.mainLoopInterval.unref();');

  content = content.replace(/this\.hotLoopInterval = setInterval\(\(\) => this\.hotLoop\(\), hot\);/g, 'this.hotLoopInterval = setInterval(() => this.hotLoop(), hot);\n    if (this.hotLoopInterval.unref) this.hotLoopInterval.unref();');
  content = content.replace(/this\.mainLoopInterval = setInterval\(\(\) => this\.mainLoop\(\), main\);/g, 'this.mainLoopInterval = setInterval(() => this.mainLoop(), main);\n    if (this.mainLoopInterval.unref) this.mainLoopInterval.unref();');

  fs.writeFileSync(file, content);
}

addUnref('backend/node/src/trading/session.service.ts');
addUnref('backend/node/src/server.ts');
addUnref('backend/node/src/engine/trading_session.service.ts');
addUnref('backend/node/src/engine/session-lifecycle.service.ts');
addUnref('backend/node/src/engine/market_feed.service.ts');
addUnref('backend/node/src/lib/binanceSubscriptionManager.ts');
addUnref('backend/node/src/lib/throttle.ts');
addUnref('backend/node/src/lib/binanceClientFactory.ts');
