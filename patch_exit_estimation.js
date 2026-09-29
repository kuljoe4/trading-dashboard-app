const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/exit_estimation.service.ts', 'utf8');

// Fix estimator 4 (Single EMA / MA / Indicator Convergence)
const est4Regex = /const targetPrice = signalDetail\?\.threshold_is_price \? thresh : roundTo\(currentPrice \+ \(isLong \? -dist : dist\), 8\);\n\s*const \{ estPnl, estR \} = computePnLAndR\(targetPrice\);\n\s*const proximity = Math\.min\(99, Math\.max\(1, Math\.round\(Math\.max\(0, 1 - \(dist \/ \(3 \* atr\)\)\) \* 100\)\)\);/;

const est4Replacement = `const targetPrice = signalDetail?.threshold_is_price ? thresh : roundTo(currentPrice + (isLong ? -dist : dist), 8);
      const { estPnl, estR } = computePnLAndR(targetPrice);

      let proximity = 0;
      if (signalDetail?.threshold_is_price) {
        proximity = Math.min(99, Math.max(1, Math.round(Math.max(0, 1 - (dist / (3 * atr))) * 100)));
      } else {
        const magnitude = Math.max(Math.abs(thresh), 1e-8);
        proximity = Math.min(99, Math.max(1, Math.round(Math.max(0, 1 - (dist / magnitude)) * 100)));
      }`;

content = content.replace(est4Regex, est4Replacement);

// Fix momentum %
const momRegex = /if \(baseType === 'momentum_pct'\) \{\n\s*const thresholdPct = Number\(config\.signal_params\?\.scan_pct_threshold \|\| 2\.0\);\n\s*const lookback = Number\(config\.signal_params\?\.scan_lookback \|\| 3\);/;
const momReplacement = `if (baseType === 'momentum_pct') {
      const sp = config.signal_params || {};
      const thresholdPct = Number(sp.exit_momentum_pct_threshold || sp.scan_pct_threshold || 2.0);
      const lookback = Number(sp.exit_momentum_lookback || sp.scan_lookback || 3);`;

content = content.replace(momRegex, momReplacement);

fs.writeFileSync('backend/node/src/engine/exit_estimation.service.ts', content);
