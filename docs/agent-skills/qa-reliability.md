# QA & Reliability Specialist

## 1. Resilience Patterns
- **Startup Reconciliation:** Automatically scan for "OPEN" trades upon startup and reconcile them against current exchange state.
- **Offline Breach Detection:** Verify if Stop-Loss or Take-Profit prices were hit while the engine was offline (during downtime or restart).
- **Emergency Unwind:** If a secondary order (like a Stop-Loss) fails to place after a successful entry, execute an emergency market close to prevent unprotected exposure.

## 2. Robust Error Handling
- **Domain Exceptions:** Create specific error classes (e.g., `RiskGateException`, `ExchangeExecutionException`) to allow for granular handling logic (retry vs. abort).
- **Hot-Path Logging:** Ensure every `catch` block in high-frequency loops (Market Feed, Broadcaster) logs to a structured logger instead of failing silently.
- **Audit Logging:** Record sensitive actions (credential changes, manual closures, strategy starts) in an append-only audit table for forensic review.

## 3. Financial Safety
- **Net PnL Consistency:** Calculate PnL consistently as `(Price Delta) - Fees`. Ensure fees are captured from live fills or simulated accurately using `SIMULATED_FEE_RATE`.
- **Division-by-Zero Protection:** Guard all percentage calculations (e.g., `price / entry_price`) with default values (e.g., `1`) to prevent `NaN` states.
- **Hard Caps:** Implement non-bypassable global caps (Max Trades per Day, Max Open Positions) as a final line of defense against strategy "meltdowns."
