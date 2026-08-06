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

## 2026-08-05 - Centralized UI Clock/Intervals Optimization
**Learning:**
Multiple high-frequency frontend components (such as `ActiveTradeCard`, `DashboardView`, and `TradeDetailView`) were maintaining independent local `setInterval` loops and local `now` state variables. This created up to 8+ concurrent timers ticking every second, competing for the browser's main thread, causing CPU thrashing and asynchronous rendering jitter. Consolidating to a unified `useNow` callback registration eliminates redundant interval overhead and batches rendering cycles synchronously.
**Action:**
Replaced all component-level independent timers with the centralized, high-performance `useNow` unified timer hook in `ActiveTradeCard.jsx`, `TradeDetailView.jsx`, and `DashboardView.jsx`.

## 2026-08-05 - Robust NaN/Infinity Guards on Real-Time Estimated P&L calculations
**Learning:**
In `engine-broadcaster.service.ts`, real-time estimated P&L (`total_est_pnl_to_realize` and `variantStats` fields) was vulnerable to `NaN` and `isFinite` propagation if any raw trade parameter (such as `qty`, `entry_price`, `current_sl`, or exit threshold prices) from live WebSocket feeds was undefined, null, or corrupted. Since `NaN` propagates transitively across arithmetic operators, any single bad trade could corrupt session-level or variant-level metrics to `NaN`, breaking the UI.
**Action:**
Harnessed `Number` coercion, `isNaN`, and `isFinite` checks with defensive fallbacks and logger warnings to isolate and protect active and estimated P&L calculations from anomalies.
