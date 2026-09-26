# Citadel Purge Audit Log

## 2026-08-23 - [Market Feed Ticker Fallback Purge]
**Vulnerability:** Redundant execution of heavy 40-weight `GET /fapi/v1/ticker/24hr` REST requests in `seedMarketDataFromRest` when `TickerCache` is already populated.
**Latency/Weight Saved:** Saved 40 weight units per prevented seed invocation when WebSocket feeds or previous seeds maintain populated ticker cache state.
**Execution Assurance:** Preserves host IP reputation and eliminates unthrottled REST weight bursts on Binance API rate limits, ensuring $8.30 USDT$ base live execution safety.

## 2026-09-23 - [WebSocket ACK Timeout & Ticker Cooldown Purge]
**Vulnerability:** Silent 5s subscription ACK timeout causing connection drops under network jitter, and missing cooldown on `seedMarketDataFromRest()` leading to potential 40-weight `GET /fapi/v1/ticker/24hr` REST loops.
**Latency/Weight Saved:** Extended `ackTimeoutMs` to 15s to eliminate premature drops; enforced 5-minute `lastRestSeedTs` cooldown saving up to 2400 weight units/hour.
**Execution Assurance:** Prevents rate limit exhaustion and IP bans (-1003/418) on host routes, safeguarding live edge capital on the $8.30172494 USDT$ base.
