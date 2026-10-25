const { performance } = require('perf_hooks');

const val = new Date();

function testInner() {
  let count = 0;
  for (let i = 0; i < 50000; i++) {
    const toTimestampMs = (val) => {
      if (!val) return 0;
      if (typeof val === 'number') return val;
      if (val instanceof Date) return val.getTime();
      if (typeof val === 'string') {
        return 0; // simplified
      }
      return 0;
    };
    count += toTimestampMs(val);
  }
  return count;
}

const toTimestampMsOut = (val) => {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') {
    return 0; // simplified
  }
  return 0;
};

function testOuter() {
  let count = 0;
  for (let i = 0; i < 50000; i++) {
    count += toTimestampMsOut(val);
  }
  return count;
}

const start1 = performance.now();
for (let i=0; i<100; i++) testInner();
const end1 = performance.now();

const start2 = performance.now();
for (let i=0; i<100; i++) testOuter();
const end2 = performance.now();

console.log(`Inner: ${end1 - start1}ms`);
console.log(`Outer: ${end2 - start2}ms`);
