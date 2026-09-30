const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/exit_estimation.service.ts', 'utf8');

const regex = /spreadVelocity: roundTo\(spreadVelocity, 8\)\n\s*\}/g;
const replacement = `spreadVelocity: roundTo(spreadVelocity, 8),
              distancePct: roundTo(Math.abs((val - thresh) / thresh) * 100, 4)
            }`;
content = content.replace(regex, replacement);

const regex2 = /components: \{ fastValue: val, slowValue: thresh, spread: roundTo\(currentSpread, 8\) \}/g;
const replacement2 = `components: { fastValue: val, slowValue: thresh, spread: roundTo(currentSpread, 8), distancePct: roundTo(Math.abs((val - thresh) / thresh) * 100, 4) }`;
content = content.replace(regex2, replacement2);

fs.writeFileSync('backend/node/src/engine/exit_estimation.service.ts', content);
