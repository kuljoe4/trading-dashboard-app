const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/exit_estimation.service.ts', 'utf8');

const distMomRegex = /const currentPct = Math\.abs\(\(currentPrice - pastPrice\) \/ pastPrice\) \* 100;\n\s*const proximity = Math\.min\(99, Math\.max\(1, Math\.round\(\(currentPct \/ thresholdPct\) \* 100\)\)\);/;
const distMomReplacement = `const rawPct = ((currentPrice - pastPrice) / pastPrice) * 100;
        // Evaluate distance in the correct direction
        const currentPct = isLong ? rawPct : -rawPct;

        let proximity = 0;
        if (currentPct > 0) {
          proximity = Math.min(99, Math.max(1, Math.round((currentPct / thresholdPct) * 100)));
        }`;

content = content.replace(distMomRegex, distMomReplacement);
fs.writeFileSync('backend/node/src/engine/exit_estimation.service.ts', content);
