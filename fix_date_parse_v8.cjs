const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /\(\(typeof (t\.entry_ts|t\.exit_ts) === 'number'\) \? \1 : \(\1 instanceof Date \? \1\.getTime\(\) : 0\)\)/g;

code = code.replace(regex, `((typeof $1 === 'number') ? $1 : ($1 instanceof Date ? $1.getTime() : (typeof $1 === 'string' ? (isNaN(Date.parse($1)) ? (isNaN(Date.parse($1.trim().replace(' ', 'T') + (!($1.trim().endsWith('Z') || $1.trim().includes('+') || $1.trim().includes(' -')) ? 'Z' : ''))) ? 0 : Date.parse($1.trim().replace(' ', 'T') + (!($1.trim().endsWith('Z') || $1.trim().includes('+') || $1.trim().includes(' -')) ? 'Z' : ''))) : Date.parse($1)) : 0)))`);

// Wait, I shouldn't mess with it if the test passes...
// Actually, I don't strictly need to do string parsing if t.entry_ts is always parsed as Date / number by DB layer / memory layer.
// But to be completely safe I will just put the helper function back.
