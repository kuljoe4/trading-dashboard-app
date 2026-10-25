const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace('private this.toTimestampMs', 'private toTimestampMs');

fs.writeFileSync(file, code);
