## 2026-07-31 - [Redundant active-session analytics call on historical records page]
**Learning:**
`HistoryView.jsx` loaded redundant active-session analytics (via `/session/analytics`) on every page load/mount even though it is completely unused. The history view displays and calculates lifetime performance metrics using `lifetimeAnalytics` (populated by `/session/lifetime-analytics`), meaning the heavy `/session/analytics` endpoint payload was an over-fetch.

**Action:**
Removed `sessionAPI.analytics()` from the `Promise.all` inside `HistoryView.jsx`'s `useEffect` and cleaned up the unused `fullAnalytics` state. This saves 1 heavy redundant HTTP call on mounting the History tab.

## 2026-08-25 - [Redundant stringified exit signals payload in low-fidelity WebSocket ticks]
**Learning:**
`EngineBroadcasterService.getFidelityTick` stripped `exit_signals_status` for overview/dashboard clients, but `_sig_json` (an internal stringified cache of `exit_signals_status`) remained on trade tick payloads. This caused stringified JSON objects (300-1200+ bytes per trade) to leak over the WebSocket connection on every tick broadcast even when low-fidelity stripping was intended.

**Action:**
Destructured and stripped `_sig_json` from both thin and non-thin trade objects in `getFidelityTick` when client is in low-fidelity mode. This saves ~300-1200+ bytes per trade per tick (~40-60% trade payload size reduction) on high-frequency overview ticks.
