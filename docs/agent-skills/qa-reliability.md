# Learning: Binance Lifecycle & Balance Integrity

## Background
Audits revealed that real-time account updates (`ACCOUNT_UPDATE` UDS events) were not consistently updating the session state for both Live and Paper balances, potentially leading to stale state in hybrid modes or when switching environments.

## Lessons Learned
- **State Consistency:** When receiving real-time account data (`ACCOUNT_UPDATE`), ensure the internal `sessionState` updates both `balanceLive` and `balancePaper` (or properly segregated state) to avoid desynchronization between the engine's perception and the exchange's truth.
- **Multi-Collateral Awareness:** Always aggregate balances across all assets (USDT, USDC, FDUSD, etc.) provided in the `B` array of the `ACCOUNT_UPDATE` event, rather than assuming a single USDT-based balance.

## Action Taken
- Updated `SessionLifecycleService.handleAccountUpdate` to unconditionally update `sessionState.balancePaper` alongside `balanceLive` when receiving a real-time account update event, ensuring consistent state regardless of the initial `paper_mode` configuration.
- Verified that `fetchBinanceBalance` properly aggregates all collateral assets.
