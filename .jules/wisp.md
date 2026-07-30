## 2026-07-29 - High-Frequency Status Trade History Bloat
**Learning:**
On every status poll or WebSocket connection handoff, `getStatus()` was querying the DB for 200 closed trades via `getHistory` and serializing them, causing severe NestJS memory churn and slow serialization times. By decoupling trade history from the primary status ping, we avoid a redundant database query and optimize memory allocation.
**Action:**
Removed `history` fetching and return field from `getStatus()`. Updated `getAnalytics()` to fetch trade history independently via a highly optimized sparse field select query instead of relying on status cache.
