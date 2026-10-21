const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /\(\(typeof (t\.entry_ts|t\.exit_ts) === 'number'\) \? \1 : \(\1 instanceof Date \? \1\.getTime\(\) : 0\)\)/g;

const helper = `  private toTimestampMs(val: any): number {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string') {
      const parsed = Date.parse(val);
      if (!isNaN(parsed)) return parsed;
      const trimmed = val.trim();
      if (!trimmed) return 0;
      const normalized = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed;
      const iso = (!normalized.endsWith('Z') && !normalized.includes('+') && !normalized.includes(' -')) ? normalized + 'Z' : normalized;
      const parsedFallback = Date.parse(iso);
      return isNaN(parsedFallback) ? 0 : parsedFallback;
    }
    return 0;
  }
`;

if (!code.includes('toTimestampMs(')) {
  code = code.replace(regex, 'this.toTimestampMs($1)');
  code = code.replace('  async processEntries(', helper + '\n  async processEntries(');
}

fs.writeFileSync(file, code);
