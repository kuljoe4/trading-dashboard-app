const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/signalEngine.ts', 'utf8');

content = content.replace(
  /threshold: curr\.close, \/\/ Fallback target when no streak is found/g,
  'threshold: 0, // Fallback target when no streak is found'
);

content = content.replace(
  /description: sequential\n\s*\? \`Previous \$\{streakReq\} candles not \$\{side === 'LONG' \? 'bearish' : 'bullish'\}\`\n\s*: \`No \$\{streakReq\}-candle \$\{side === 'LONG' \? 'bearish' : 'bullish'\} streak found in last \$\{lookback\} candles\`,\n\s*threshold_is_price: true,/g,
  `description: sequential
            ? \`Previous \${streakReq} candles not \${side === 'LONG' ? 'bearish' : 'bullish'}\`
            : \`No \${streakReq}-candle \${side === 'LONG' ? 'bearish' : 'bullish'} streak found in last \${lookback} candles\``
);

fs.writeFileSync('backend/node/src/engine/signalEngine.ts', content);
