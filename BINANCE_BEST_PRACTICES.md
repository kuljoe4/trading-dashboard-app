# Binance Futures End-to-End Best Practices Prompt

**Objective:** Conduct an end-to-end audit of Binance Futures API interactions to ensure peak performance, minimal resource usage, and flawless execution.

## 1. END-TO-END TRADE FLOW & IDEMPOTENCY
- **Idempotency Strategy:** Verify that every order (Market Entry, Stop Loss, Take Profit, Close) uses the `newClientOrderId` parameter. Ensure IDs are prefixed (e.g., `ent-`, `sl-`, `cls-`) and derived from the internal Trade UUID for 1:1 mapping.
- **Atomic Entry & Protection:** Ensure that a Stop Loss is placed immediately after a successful entry. If the SL placement fails (e.g., due to API error), the system must perform an "emergency unwind" (market close of the position) to prevent unmanaged risk.
- **One-Way Mode Enforcement:** Confirm that `changePositionMode` is called during session initialization to enforce `dualSidePosition: false`. This prevents errors caused by account-level Hedge Mode settings.

## 2. NETWORK & WEIGHT OPTIMIZATION (ZERO WEIGHT PRIORITY)
- **Event-Driven Architecture:** Prioritize the **User Data Stream** (`ORDER_TRADE_UPDATE`) over REST polling. The engine should react to SL/TP hits via WebSocket events to achieve "zero weight" monitoring during a trade's lifecycle.
- **Rate Limit Intelligence:** Proactively track the `X-MBX-USED-WEIGHT-1M` header from all REST responses.
- **Graceful Throttling:** Implement a multi-tier throttling strategy:
  - **70% Usage:** Skip non-critical updates (e.g., minor trailing stop adjustments).
  - **80% Usage:** Pause background tasks like kline backfilling.
  - **90% Usage:** Block new trade entries to preserve weight for critical exits.

## 3. DATA INTEGRITY & PRECISION
- **Exchange Filter Compliance:** Locally validate all orders against `PRICE_FILTER`, `LOT_SIZE`, and `MIN_NOTIONAL` before dispatching to the API.
- **Execution Accuracy:** Extract the exact `avgPrice` and `executedQty` from the `RESULT` response of the `newOrder` call (or from WebSocket `ORDER_TRADE_UPDATE` fills) to ensure local trade logs perfectly match exchange reality.
- **Fee Calculation:** Cache the `takerCommissionRate` per symbol to compute realized fees locally, ensuring session balance synchronization is accurate without redundant balance requests.
