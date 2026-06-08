## 2026-06-07 - [WebSocket Auth Throttling Bypass]
**Vulnerability:** IP-based brute-force protection (throttling) was bypassed for WebSocket connections when the authentication token was missing or had an invalid format/length.
**Learning:** Security checks that return early (fail-fast) must still trigger defensive mechanisms like failure counters. In `server.ts`, the `verifyClient` hook logged the rejection but didn't call `recordFailure(clientIp)`, allowing attackers to bypass the 10-attempt limit by sending malformed requests.
**Prevention:** Always ensure that all authentication failure paths, including initial validation/sanity checks, invoke the throttling/audit system before returning a rejection.

## 2026-06-07 - [Memory Exhaustion via Unbounded IP Failure Tracking]
**Vulnerability:** The `FAILURES` map in `throttle.ts` had no maximum size limit, allowing an attacker to spoof thousands of unique IP addresses to exhaust server memory (DoS).
**Learning:** In-memory security tracking structures (like IP blacklists or failure counters) must always be bounded in size to prevent they themselves becoming an attack vector.
**Prevention:** Implement a hard limit on Map size with an eviction policy (e.g., FIFO) for all in-memory tracking structures.
