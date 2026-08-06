## 2026-07-31 - [Redundant active-session analytics call on historical records page]
**Learning:**
`HistoryView.jsx` loaded redundant active-session analytics (via `/session/analytics`) on every page load/mount even though it is completely unused. The history view displays and calculates lifetime performance metrics using `lifetimeAnalytics` (populated by `/session/lifetime-analytics`), meaning the heavy `/session/analytics` endpoint payload was an over-fetch.

**Action:**
Removed `sessionAPI.analytics()` from the `Promise.all` inside `HistoryView.jsx`'s `useEffect` and cleaned up the unused `fullAnalytics` state. This saves 1 heavy redundant HTTP call on mounting the History tab.
