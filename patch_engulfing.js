const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/signalEngine.ts', 'utf8');

content = content.replace(
  /return \{\s*fired: false,\s*value: curr\.close,\s*threshold: curr\.close, \/\/ Fallback target when no streak is found\s*,\s*unit: 'price',\s*metric: 'Engulfing',\s*description: sequential\s*\?\s*`Previous \$\{streakReq\} candles not \$\{side === 'LONG' \? 'bearish' : 'bullish'\}`\s*:\s*`No \$\{streakReq\}-candle \$\{side === 'LONG' \? 'bearish' : 'bullish'\} streak found in last \$\{lookback\} candles`,\s*threshold_is_price: true,\s*\};/g,
  `return {
          fired: false,
          value: curr.close,
          threshold: 0, // Fallback target when no streak is found
          unit: 'price',
          metric: 'Engulfing',
          description: sequential
            ? \`Previous \${streakReq} candles not \${side === 'LONG' ? 'bearish' : 'bullish'}\`
            : \`No \${streakReq}-candle \${side === 'LONG' ? 'bearish' : 'bullish'} streak found in last \${lookback} candles\`
        };`
);

content = content.replace(
  /return \{ fired: false, value: candles\[candles\.length - 1\]\?\.close \|\| 0, threshold: 0, unit: 'price', metric: 'Engulfing', description: closeOnlyMode \? 'Waiting for closed confirmation candle' : 'Insufficient data', insufficientData: true, threshold_is_price: true \};/g,
  `return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'Engulfing', description: closeOnlyMode ? 'Waiting for closed confirmation candle' : 'Insufficient data', insufficientData: true };`
);

content = content.replace(
  /return \{ fired: false, value: passedCandles\?\.\[passedCandles\.length - 1\]\?\.close \|\| 0, threshold: 0, unit: 'error', metric: 'Engulfing', description: 'Signal error', threshold_is_price: true \};/g,
  `return { fired: false, value: passedCandles?.[passedCandles.length - 1]?.close || 0, threshold: 0, unit: 'error', metric: 'Engulfing', description: 'Signal error' };`
);


fs.writeFileSync('backend/node/src/engine/signalEngine.ts', content);
