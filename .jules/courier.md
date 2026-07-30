## 2026-07-29 - Status Payload Bandwidth Reduction
**Learning:**
Returning 200 fully-serialized closed trades (including complex nested strategy config JSON blocks) in the core `getStatus()` response bloated the payload to over 200KB per response. Since the frontend already fetches closed trades on mount via `/session/history`, this transfer was 100% redundant.
**Action:**
Eliminated `history` from the `getStatus()` response payload, reducing the status network transfer footprint by ~97% (from ~200KB+ down to ~5KB) while preserving zero-flicker frontend state merges.

## 2026-07-29 - History, List, and Lifetime Analytics Payload Bandwidth Optimization
**Learning:**
Retrieving full `strategy_config` JSON structures (with heavy nested strategy variants) for up to 200 closed trades in `/session/history` and 20 sessions in `/session/list` severely bloated the payload sizes and backend database load. Furthermore, filtering trades by mode in-memory inside `getLifetimeAnalytics` forced loading full JSON config structures for all historical trades.
**Action:**
Implemented sparse column selection for trade history list to omit heavy columns, mapped session config blocks to keep only the minimum summarized properties used by the UI, and shifted lifetime-analytics mode filtering directly to the database level using a TypeORM Query Builder `innerJoin` on the Session table.
