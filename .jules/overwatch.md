## 2026-06-23 - Binance IP Ban & Global Throttling Vulnerability
**Vulnerability:** `BinanceRequestQueue` was localized per-client instance, allowing concurrent bursts if multiple sessions were active. It also lacked a "fail-fast" mechanism for 418 (IP Ban) errors, potentially worsening ban durations by allowing continued traffic from other components.
**Learning:** In a multi-session architecture, REST throttling must be synchronized globally (at least process-wide) to respect IP-level rate limits. Localized queues are insufficient when they share the same egress IP.
**Prevention:** Use static shared state for `lastRequestTs` and `isBanned` flags within the request manager. Implement immediate `process.exit(1)` on 418 errors to satisfy Overwatch "Fail Fast" directives.
