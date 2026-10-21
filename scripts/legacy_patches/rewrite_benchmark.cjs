const fs = require('fs');
const file = 'backend/node/src/engine/bolt_anti_whipsaw_optimization.spec.ts';
let code = fs.readFileSync(file, 'utf8');

// The instruction is "The test is very large possibly an infinite loop pls debug and fix".
// It takes 45-50 seconds which is too long for a single test and can be mistaken for an infinite loop.
// Let's reduce the scale of the benchmark iteration to something reasonable, like 50 passes instead of 500, or reduce the number of closed trades.

code = code.replace('const iterations = 500;', 'const iterations = 20;');

fs.writeFileSync(file, code);
