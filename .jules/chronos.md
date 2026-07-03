## 2026-06-22 - Non-Atomic SL Ratcheting Race & Protection Gaps
**Learning:** The engine's hot-loop can trigger multiple SL milestones for the same trade within milliseconds. Without a per-symbol mutex, these calls race to cancel and replace the exchange-side Stop Loss. Because Binance does not support `modifyOrder` for `STOP_MARKET`, a failed replacement after cancellation leaves the position completely unprotected. Assumed-success local state updates (updating SL price before exchange confirmation) further exacerbate this by creating a "ghost" protection level that doesn't exist.
**Action:** Always implement a per-symbol mutex for exchange-side mutations. Apply the "Acknowledge-then-Update" pattern where local state is only committed after the exchange confirms success. Mandatory "Rollback-on-Failure" must be implemented for all cancel-replace patterns to ensure capital safety.

## 2026-06-25 - Real-time Quantity Synchronization Gap
**Learning:** The engine assumed entry quantities were atomic and static. In reality, Binance FAPI User Data Stream (UDS) events often report cumulative fills (order.z) or account-level net position changes (pos.pa) that diverge from the locally tracked trade.qty during partial fills or manual reductions.
**Action:** Implemented event-driven quantity synchronization. Both ORDER_TRADE_UPDATE and ACCOUNT_UPDATE now emit a trade.quantity_sync event, triggering immediate risk recalculation and reactive watchdog audits to ensure SL protection matches the real exchange quantity.

## 2026-06-27 - Watchdog Quantity Parity Gap
**Learning:** The protection watchdog previously only verified the *existence* of a Stop Loss order, but ignored its *quantity*. Manual position adjustments on the exchange (outside the engine) or previous partial fill artifacts could leave a position significantly under-protected or over-protected (creating reverse position risk). Synchronizing the local trade quantity with the exchange position is insufficient if the associated SL order is not also synchronized.
**Action:** The watchdog must perform a "Quantity Parity Audit" on matching SL orders. Any mismatch between the order quantity and the current position quantity (excluding quantity-agnostic 'Close Position' orders) must trigger a Cancel-Replace cycle to ensure safety.

## 2026-06-29 - Non-Atomic SL Milestone Commitment
**Learning:** `PositionTrackerService` was committing R:R milestone indices to local state *before* successful exchange confirmation. If a ratchet failed (e.g. due to Binance 429 or network timeout), the engine would assume the milestone was reached and never retry the SL update, leaving the position unprotected or at a stale price level.
**Action:** Implemented the "Acknowledge-then-Commit" pattern for SL ratchets. Local milestone state and peak R:R are only updated after `OrderManagerService.updateStopLoss` returns a confirmed success from the exchange.

## 2026-06-29 - Orphan SL Order Accumulation
**Learning:** While the engine tracked its primary SL order, previous failed ratchets or external exchange activity could leave "orphan" SL orders active. Binance's limit of 10 conditional orders per symbol (Error -2027) meant these orphans could block critical protection updates.
**Action:** Enhanced the `MaintenanceService` watchdog to perform a "Single-Truth SL Audit". Any stop-loss order found on the exchange that is not the tracked `binance_stop_order_id` or matching the engine's deterministic `clientOrderId` is now explicitly cancelled.

## 2026-07-02 - Multi-Part Execution PnL & Commission Integrity
**Learning:** The engine previously ignored `PARTIALLY_FILLED` UDS events for Stop Loss orders and lacked execution-level deduplication for commissions. This led to "ghost positions" (local qty > exchange qty) during SL slippage/partial fills and double-counting of fees when the same trade was reported via both REST responses and the User Data Stream. Binance FAPI provides a unique trade ID (`t` or `tradeId`) for every execution slice which must be the authoritative key for financial state mutation.
**Action:** Implemented a `tradeExecutionCache` to deduplicate commissions by Binance Trade ID. `OrderManagerService` now synchronizes `trade.qty` to the remaining exchange quantity on SL partial fills and restores it to total order size on the final fill to ensure atomic PnL integrity.
