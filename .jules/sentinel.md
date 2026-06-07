## 2026-06-07 - [WebSocket Auth Throttling Bypass]
**Vulnerability:** IP-based brute-force protection (throttling) was bypassed for WebSocket connections when the authentication token was missing or had an invalid format/length.
**Learning:** Security checks that return early (fail-fast) must still trigger defensive mechanisms like failure counters. In `server.ts`, the `verifyClient` hook logged the rejection but didn't call `recordFailure(clientIp)`, allowing attackers to bypass the 10-attempt limit by sending malformed requests.
**Prevention:** Always ensure that all authentication failure paths, including initial validation/sanity checks, invoke the throttling/audit system before returning a rejection.
