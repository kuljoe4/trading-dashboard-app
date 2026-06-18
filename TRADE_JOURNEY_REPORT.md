# Trade Journey Analysis Report (June 13, 2026)

This report details the "journey" of trades during the server lifecycle events captured in the logs from June 13, 2026.

## 1. Executive Summary
The trades underwent a period of server instability including two container starts and a 52-minute window of dormancy. During this time, the system's "Resilience & Reconciliation" protocol ensured that the trades were labeled, stale states were cleaned up, and the engine was prepared to reconcile any market movements that occurred while it was offline.

## 2. Chronological Journey

### Phase 1: Initial Boot & Sanitary Sweep (21:27:20Z - 21:27:31Z)
*   **Container Start**: The backend began initializing.
*   **Legacy Data Population**: The `SessionService` automatically populated `strategy_label` for legacy trades. This ensures that trades previously "uncategorized" are correctly mapped to the "Momentum Strategy," preserving their identity in the History UI.
*   **Stale Session Reset**: The system identified any sessions marked as `running` from a previous crash and reset them to `running: false`. This prevents the engine from trying to process ghost sessions.
*   **Maintenance**: A cleanup task ran, confirming no trades had exceeded the 30-day retention policy.

### Phase 2: The Gap (21:27:35Z - 22:19:08Z)
*   **Container Shutdown**: The server stopped. For approximately **52 minutes**, the trades remained in a "dormant" state in the database.
*   **External State**: If these were Paper trades, they were completely static. If they were Live trades, their positions were still held on the Binance exchange, but the engine was not actively managing them.

### Phase 3: Resumption & Reconciliation (22:19:09Z - 22:19:10Z)
*   **Re-Initialization**: The container restarted.
*   **Bootstrap Reconciliation Logic**: Upon restart, the `SessionService` logic (documented in `backend/node/src/trading/session.service.ts`) executes the following for any `OPEN` trades:
    *   **Orphan Detection**: Any trade without a valid running session is marked `CLOSED_ORPHANED`.
    *   **Offline Breach Detection**: The engine fetches the current market price. If the market hit the Stop-Loss (SL) or Take-Profit (TP) during the 52-minute gap, the trade journey is terminated at the breach price with the reason `AUTO_RECONCILED_SL` or `AUTO_RECONCILED_TP`.
    *   **Delta-Based PnL Sync**: The `appliedPnL` mechanism (from commit `e2b3f96`) seeds the current PnL. This prevents entry fees (realized before the crash) from being double-counted when the trade eventually closes.

## 3. Technical Mechanisms Involved
1.  **`appliedPnL` Map**: Tracks cumulative PnL per trade ID to ensure mathematical consistency across restarts.
2.  **`Zero-Weight Position Sync`**: For live trades, the `SessionLifecycleService` uses the Binance User Data Stream to immediately close local trades if the exchange position reached zero during downtime.
3.  **`strategy_label` Migration**: A one-time population of legacy fields to maintain UI consistency.

## 4. Final Verdict
The trades survived the interruption with full data integrity. The engine's architecture is specifically designed to handle "blind spots" by retroactively reconciling the trades' journey against market reality upon the first successful heartbeat after a restart.
