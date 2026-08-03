## 2026-07-29 - High-Frequency Status Trade History Bloat
**Learning:**
On every status poll or WebSocket connection handoff, `getStatus()` was querying the DB for 200 closed trades via `getHistory` and serializing them, causing severe NestJS memory churn and slow serialization times. By decoupling trade history from the primary status ping, we avoid a redundant database query and optimize memory allocation.
**Action:**
Removed `history` fetching and return field from `getStatus()`. Updated `getAnalytics()` to fetch trade history independently via a highly optimized sparse field select query instead of relying on status cache.

## 2026-08-02 - Zustand High-Frequency Local Storage Write Churn
**Learning:**
Real-time scanner data (up to 25 symbols + nested details/ohlc history/signals per variant) was being persisted in `localStorage` under `momentum_trading_store`. Because `localStorage` is synchronous, writing this transient, high-frequency data to disk on every single scanner broadcast was causing severe CPU/disk thrashing and blocking the UI rendering thread. Since fresh scanner data is instantly re-fetched/streamed on initial page load, persistence of this real-time data is completely redundant.
**Action:**
Excluded `scannerResults` and `variantScannerResults` from the `persist` middleware's `partialize` whitelist in `frontend/src/store/trading.js`.
