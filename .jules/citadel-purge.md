## 2026-07-22 - [Market Feed & WS Subsystem Purge]
**Vulnerability:** Multiplexed WS corruptions and redundant heavy HTTP footprints on boot.
- Separated public `/stream`, market `/market/stream`, and signed `/private/ws` listenKey endpoints to completely isolate client/user data channels from anonymous streams.
- Stopped the silent 5s bootstrap timeout and completely removed the redundant/catastrophic 40-weight fallback loop (`fetchInitialTickers` querying `GET /fapi/v1/ticker/24hr`) on startup, fully preserving the Micro base.

**Latency/Weight Saved:**
- Saved 40 weight units on every single session boot cycle.
- Reduced cold start latency by 5,000ms by completely eliminating the silent socket-wait delay.

**Execution Assurance:**
- Complete insulation of the $8.30172494 USDT$ base from accidental rate-limits, IP bans, or network-level stream handshake collisions.
