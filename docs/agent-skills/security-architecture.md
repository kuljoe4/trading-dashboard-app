# Learning: Binance API Compliance and Reliability Hardening

## Background
Following a series of API ban incidents, a comprehensive audit revealed critical gaps in how the engine interacts with Binance API, leading to ban storm risk, REDUCE_ONLY order rejections, and inefficient startup sequences.

## Lessons Learned
- **Proactive Ban Guarding:** Always check ban status (`isBanned()`) before performing any heavy REST operations. Centralizing this state across different components (queue, state service, DB) is essential for consistency.
- **Order Closure Logic:** Always place the close order *first* to consume reduce-only capacity, then cancel the stop-loss order. Reversing this causes predictable `REDUCE_ONLY` rejections.
- **Rate Limit Throttling:** Weight-based throttling is insufficient. Proactively track and throttle based on order count headers (`X-MBX-ORDER-COUNT-10S/1M`) to avoid 429 bans.
- **Stall Watchdog:** Avoid overly aggressive watchdog thresholds (e.g., 2m) which can induce reconnect storms. Use longer thresholds (e.g., 7m) to allow for transient network degradation, relying on Binance's ping/pong for recovery.
- **Startup Sequence:** Perform sequential, jittered startup to avoid "thundering herd" API bursts when starting or restarting.

## Action Taken
- Implemented global ban guards in `ExecutionService`.
- Increased Stall Watchdog threshold in `BinanceSubscriptionManager`.
- Added proactive order rate limit throttling hook in `BinanceClientFactory`.
- Centralized ban state synchronization via Event Emitter in `SessionStateService`.
- Refactored `MarketFeedService` to use sequential, jittered startup warmup.
