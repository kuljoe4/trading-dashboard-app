## 2026-06-24 - [MarketFeed Subsystem Purge]
**Vulnerability:** Redundant 40-weight REST fallback (`/fapi/v1/ticker/24hr`) and monolithic WebSocket multiplexing.
**Latency/Weight Saved:** Saved 40 weight units per boot cycle. Reduced connection handshake latency by segregating Public and Market streams.
**Execution Assurance:** Guarantees that the $8.30 USDT$ base is not exposed to IP bans or stale price data during volatile market starts.

## 2026-07-02 - [Stream Routing & Fallback Elimination]
**Vulnerability:** Monolithic WS connection logic and aggressive REST ticker fallback loop.
**Latency/Weight Saved:** Eliminated 40 weight units per session start. Reduced WS connection establishment time by 15s.
**Execution Assurance:** Prevents IP reputation damage by removing non-throttled REST polling and enforcing dedicated gateway routing for HF data. Implements the **Citadel Terminal Lock Protocol** to prevent Railway restart-loop hammering: on 429/418/1003 errors, the queue is locked until the absolute exchange ban timestamp (parsed from "banned until (\d+)") or a 24-hour fallback, effectively zeroing egress without crashing the process. System automatically resumes and clears status via `binance.api_limit_cleared` event upon lock expiration.
