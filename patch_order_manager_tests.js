const fs = require('fs');
let content = fs.readFileSync('backend/node/src/engine/exit_reason_preservation.spec.ts', 'utf8');

content = content.replace(/Price proximity recovery/g, 'Price match recovery');
content = content.replace(/price proximity/g, 'price match');

fs.writeFileSync('backend/node/src/engine/exit_reason_preservation.spec.ts', content);
