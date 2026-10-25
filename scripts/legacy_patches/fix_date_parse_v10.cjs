const fs = require('fs');
const file = 'backend/node/src/engine/execution.service.ts';
let code = fs.readFileSync(file, 'utf8');

// Also notice how the `toTimestampMs` was recreated to prevent infinite loops, but we also found out that
// "A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them."
// Memory leaks with interval!
// Let's check `backend/node/src/engine/session-lifecycle.service.ts` or `execution.service.ts` for unreferenced setIntervals!
