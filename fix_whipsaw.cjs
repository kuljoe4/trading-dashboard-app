const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

const targetStr = `                  const toTimestampMs = (val: any): number => {
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
                  };`;

if (!code.includes(targetStr)) {
    console.error("target not found");
    process.exit(1);
}

// Remove it from the inner loop
code = code.replace(targetStr, "");

// Add it to the class level or above the processEntries loop
const insertStr = `
  private toTimestampMs(val: any): number {
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
  }
`;

// Insert it right before processEntries
code = code.replace('  async processEntries(', insertStr + '\n  async processEntries(');

// Replace the local calls
code = code.replace(/toTimestampMs\(/g, 'this.toTimestampMs(');

fs.writeFileSync(file, code);
console.log("Done");
