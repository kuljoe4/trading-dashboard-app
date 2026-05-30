# Engineer Skills & Patterns

This document tracks specialized engineering patterns and skills implemented in this repository to ensure high performance, stability, and UX quality.

## 1. High-Efficiency State Persistence (Frontend)

**Problem:** To minimize backend network egress, the server often sends "thin" or "delta" updates (e.g., only price and PnL) over WebSockets. If the frontend store simply replaces the trade object with this thin update, static metadata like entry price, initial stop-loss, and configuration are lost, leading to UI flickering, `NaN` displays, or "None" values.

**Solution:** Implement an explicit **Merging Strategy** in the frontend state management layer (Zustand).

**Implementation Details:**
- The `normalizeTrade` function in the store checks for `_thin` or `_delta` flags.
- If present, it performs a non-destructive merge with the existing trade object in memory.
- Critical static fields (e.g., `entry_price`, `initial_sl`, `qty`) are preserved locally.
- Complex nested objects (e.g., `exit_signals_status`) are only updated if the new data is present, otherwise, the cached version is kept.

**Benefits:**
- **Zero Network Egress Increase:** The backend continues sending tiny payloads.
- **Robust UI:** The user sees a stable dashboard with no flashing loaders or missing metadata.
- **Resilience:** The app handles high-frequency price updates gracefully even on low-bandwidth mobile connections.

## 2. Background Resumption & Throttling (Mobile Optimization)

**Problem:** Mobile browsers aggressively throttle or suspend WebSockets and JavaScript execution when a tab is in the background. Upon returning to the app, the state may be stale or the connection "stuck" without the UI realizing it.

**Solution:** Implement **Visibility-Aware Lifecycle Management**.

**Implementation Details:**
- Use the `Visibility API` to detect when the user leaves or returns to the dashboard.
- **Throttling:** When hidden, the frontend signals the backend to stop sending non-essential updates (ticks, scanner results) to save egress and battery.
- **Resumption:** Upon returning (`visibilitychange` -> `visible`), the frontend automatically triggers a full status sync and verifies WebSocket health, performing a silent reconnect if the stream has stalled.

**Benefits:**
- **Battery Life:** Reduced CPU/Network usage when the app isn't visible.
- **Data Freshness:** The UI immediately synchronizes with the latest exchange state the moment the user brings it into focus.
