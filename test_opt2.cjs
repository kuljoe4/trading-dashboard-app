const { performance } = require('perf_hooks');
const val = new Date();

function testClosure1() {
  let count = 0;
  for (let i = 0; i < 50000; i++) {
    const toTimestampMs = (val) => {
      if (!val) return 0;
      if (typeof val === 'number') return val;
      if (val instanceof Date) return val.getTime();
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return 0;
        const normalized = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed;
        const iso = (!normalized.endsWith('Z') && !normalized.includes('+') && !normalized.includes(' -')) ? normalized + 'Z' : normalized;
        const parsed = new Date(iso).getTime();
        return isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    };
    count += toTimestampMs(val);
  }
  return count;
}

const start1 = performance.now();
for (let i=0; i<100; i++) testClosure1();
const end1 = performance.now();
console.log(`Inner full: ${end1 - start1}ms`);
