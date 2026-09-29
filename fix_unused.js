const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/exit_estimation.service.ts', 'utf8');

content = content.replace(/const firedEsts = estimationsList\.filter\(e => e\.state === 'fired'\);\n\s*const readyEsts = estimationsList\.filter\(e => e\.state === 'ready'\);\n/g, '');

fs.writeFileSync('backend/node/src/engine/exit_estimation.service.ts', content);
