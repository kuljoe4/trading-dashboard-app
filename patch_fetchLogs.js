const fs = require('fs');
const filepath = 'frontend/src/store/trading.js';
let content = fs.readFileSync(filepath, 'utf8');

const oldFetchLogs = `  fetchLogs: async (limit = 50) => {
    try {
      const res = await sessionAPI.logs(limit);
      if (res.data && Array.isArray(res.data)) {
        const incoming = res.data.map(normalizeLog).filter(Boolean);
        set(st => {
          const existingMap = new Map((st.logs || []).map(l => [l.id || \`\${l.ts}-\${l.msg}\`, l]));
          incoming.forEach(l => {
            const key = l.id || \`\${l.ts}-\${l.msg}\`;
            if (!existingMap.has(key)) {
              existingMap.set(key, l);
            }
          });
          const mergedLogs = Array.from(existingMap.values())
            .sort((a, b) => (b.ts_ms || 0) - (a.ts_ms || 0))
            .slice(0, MAX_LOG_LINES);
          return { logs: mergedLogs };
        });
      }
    } catch (e) {}
  },`;

const newFetchLogs = `  fetchLogs: async (limit = 50) => {
    try {
      const res = await sessionAPI.logs(limit);
      if (res.data && Array.isArray(res.data)) {
        const incoming = res.data.map(normalizeLog).filter(Boolean);
        set(st => {
          // Keep WS logs and DB logs deduplicated by id and fuzzy timestamp/msg matching
          const existingLogs = st.logs || [];
          const existingMap = new Map(existingLogs.map(l => [l.id || \`\${l.ts}-\${l.msg}\`, l]));

          incoming.forEach(l => {
            const exactKey = l.id || \`\${l.ts}-\${l.msg}\`;
            if (existingMap.has(exactKey)) return;

            // Fuzzy match for WS vs DB logs (same message, within 2000ms)
            const isDuplicate = existingLogs.some(ex =>
              ex.msg === l.msg &&
              Math.abs((ex.ts_ms || 0) - (l.ts_ms || 0)) < 2000
            );

            if (!isDuplicate) {
              existingMap.set(exactKey, l);
            }
          });

          const mergedLogs = Array.from(existingMap.values())
            .sort((a, b) => (b.ts_ms || 0) - (a.ts_ms || 0))
            .slice(0, MAX_LOG_LINES);
          return { logs: mergedLogs };
        });
      }
    } catch (e) {}
  },`;

content = content.replace(oldFetchLogs, newFetchLogs);
fs.writeFileSync(filepath, content);
