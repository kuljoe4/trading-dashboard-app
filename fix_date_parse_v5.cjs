const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

const oldFunc = `  private toTimestampMs(val: any): number {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (val instanceof Date) return val.getTime();
    return 0; // We know trades in memory use Date objects or numeric MS, parsing strings is only needed from DB directly, but here they are parsed on load.
  }`;

const newFunc = `  private toTimestampMs(val: any): number {
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
  }`;

code = code.replace(oldFunc, newFunc);

fs.writeFileSync(file, code);
