## 2026-07-29 - Status Payload Bandwidth Reduction
**Learning:**
Returning 200 fully-serialized closed trades (including complex nested strategy config JSON blocks) in the core `getStatus()` response bloated the payload to over 200KB per response. Since the frontend already fetches closed trades on mount via `/session/history`, this transfer was 100% redundant.
**Action:**
Eliminated `history` from the `getStatus()` response payload, reducing the status network transfer footprint by ~97% (from ~200KB+ down to ~5KB) while preserving zero-flicker frontend state merges.
