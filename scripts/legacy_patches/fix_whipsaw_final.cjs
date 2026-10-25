const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

// What if the benchmark doesn't stop because it hits something else?
// Let's actually look at the optimization memory issue
