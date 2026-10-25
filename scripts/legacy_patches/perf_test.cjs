const { performance } = require('perf_hooks');

const val = new Date();

function testOuter() {
  let count = 0;
  for (let i = 0; i < 50000; i++) {
    const d = typeof val === 'number' ? val : (val instanceof Date ? val.getTime() : 0);
    count += d;
  }
  return count;
}

const start2 = performance.now();
for (let i=0; i<100; i++) testOuter();
const end2 = performance.now();

console.log(`Outer: \${end2 - start2}ms`);
