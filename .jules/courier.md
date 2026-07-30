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

## 2026-07-30 - High-Frequency Status Log Query & Egress Bypass
**Learning:**
On every single high-frequency REST status polling call `/session/status` (triggered on page mount, tab unthrottling/visibility change, state syncs), the backend performed a heavy database query to fetch the last 100 log lines from the database and returned them as `logLines` in the payload. However, the REST-polling client never maps or displays these logs (it only renders logs received in real-time over WebSockets). This resulted in massive unnecessary database load and bloated egress payload size (potentially up to 400KB of redundant text per status check).
**Action:**
Added an optional `includeLogs?: boolean` (defaulting to `false`) parameter to `getStatus()`. For all high-frequency HTTP status polling and non-initial WebSocket messages, `includeLogs` is set to `false`, completely bypassing the database log query and omitting the redundant log data. Set `includeLogs = true` only during initial WebSocket handshake to safely populate the terminal window.
