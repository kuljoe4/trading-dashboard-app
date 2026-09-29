const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/signalEngine.ts', 'utf8');

// The emaDualCloseSignal method returns `prevFast` and `prevSlow`
// We need to calculate them at completedCandleIdx - 1
const targetBlockRegex = /const fastEma = fastRes\.value;\n\s*const slowEma = slowRes\.value;/;
const replacementBlock = `const fastEma = fastRes.value;
      const slowEma = slowRes.value;

      // Calculate prevFast and prevSlow for exit estimation spread velocity
      const prevCompletedCandleIdx = completedCandleIdx - 1;
      let prevFast = fastEma;
      let prevSlow = slowEma;
      if (prevCompletedCandleIdx >= 0) {
        prevFast = this.calculateEMAAt(candles, prevCompletedCandleIdx, fastPeriod, interval, symbol).value;
        prevSlow = this.calculateEMAAt(candles, prevCompletedCandleIdx, slowPeriod, interval, symbol).value;
      }`;

content = content.replace(targetBlockRegex, replacementBlock);

const returnBlockRegex = /metric: purpose === 'exit' \? 'Exit EMA Dual Close' : 'Entry EMA Dual Close',\n\s*description,\n\s*threshold_is_price: true,\n\s*slPrice: roundTo\(slowEma, 8\),\n\s*rejected: macdRejected,/;
const replacementReturnBlock = `metric: purpose === 'exit' ? 'Exit EMA Dual Close' : 'Entry EMA Dual Close',
        description,
        threshold_is_price: true,
        slPrice: roundTo(slowEma, 8),
        rejected: macdRejected,
        prevFast: roundTo(prevFast, 8),
        prevSlow: roundTo(prevSlow, 8),`;

content = content.replace(returnBlockRegex, replacementReturnBlock);

fs.writeFileSync('backend/node/src/engine/signalEngine.ts', content);
