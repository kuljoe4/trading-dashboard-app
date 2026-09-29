const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/signalEngine.ts', 'utf8');

content = content.replace(
  /return \{ fired: false, value: candles\[candles\.length - 1\]\?\.close \|\| 0, threshold: 0, unit: 'price', metric: 'Engulfing', description: closeOnlyMode \? 'Waiting for closed confirmation candle' : 'Insufficient data', insufficientData: true, threshold_is_price: true \};/g,
  `return { fired: false, value: candles[candles.length - 1]?.close || 0, threshold: 0, unit: 'price', metric: 'Engulfing', description: closeOnlyMode ? 'Waiting for closed confirmation candle' : 'Insufficient data', insufficientData: true };`
);

content = content.replace(
  /return \{ fired: false, value: passedCandles\?\.\[passedCandles\.length - 1\]\?\.close \|\| 0, threshold: 0, unit: 'error', metric: 'Engulfing', description: 'Signal error', threshold_is_price: true \};/g,
  `return { fired: false, value: passedCandles?.[passedCandles.length - 1]?.close || 0, threshold: 0, unit: 'error', metric: 'Engulfing', description: 'Signal error' };`
);

fs.writeFileSync('backend/node/src/engine/signalEngine.ts', content);
