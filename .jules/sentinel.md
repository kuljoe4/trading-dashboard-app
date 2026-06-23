## 2026-06-07 - [WebSocket Auth Throttling Bypass]
**Vulnerability:** IP-based brute-force protection (throttling) was bypassed for WebSocket connections when the authentication token was missing or had an invalid format/length.
**Learning:** Security checks that return early (fail-fast) must still trigger defensive mechanisms like failure counters. In `server.ts`, the `verifyClient` hook logged the rejection but didn't call `recordFailure(clientIp)`, allowing attackers to bypass the 10-attempt limit by sending malformed requests.
**Prevention:** Always ensure that all authentication failure paths, including initial validation/sanity checks, invoke the throttling/audit system before returning a rejection.

## 2026-06-07 - [Memory Exhaustion via Unbounded IP Failure Tracking]
**Vulnerability:** The `FAILURES` map in `throttle.ts` had no maximum size limit, allowing an attacker to spoof thousands of unique IP addresses to exhaust server memory (DoS).
**Learning:** In-memory security tracking structures (like IP blacklists or failure counters) must always be bounded in size to prevent they themselves becoming an attack vector.
**Prevention:** Implement a hard limit on Map size with an eviction policy (e.g., FIFO) for all in-memory tracking structures.

## 2026-06-08 - [IP Spoofing via Multiple X-Forwarded-For Headers]
**Vulnerability:** The `extractIp` utility only considered the first element of an array when multiple `X-Forwarded-For` headers were provided, allowing attackers to spoof their IP and bypass brute-force protections.
**Learning:** Node.js/Express can represent repeated headers as an array. Security logic that relies on `X-Forwarded-For` must account for this by joining all header values before extracting the reliable (last) IP in the chain.
**Prevention:** Always normalize `X-Forwarded-For` by joining array values into a single comma-separated string before parsing the IP chain.

## 2026-06-08 - [Incomplete Brute-Force Protection in WebSocket Handshake]
**Vulnerability:** Several rejection paths in the WebSocket `verifyClient` hook (unauthorized origins and malformed URLs) failed to record the failure in the IP throttling system.
**Learning:** Security middleware must be exhaustive. If a request is rejected for any security or structural reason, it should contribute to the sender's failure count to prevent "stealthy" probing or DoS via error-triggering payloads.
**Prevention:** Ensure every `return done(false)` in `verifyClient` (or equivalent handshake hooks) is preceded by a call to the throttling/audit system.

## 2026-06-15 - [Comprehensive Audit Metadata Propagation]
**Vulnerability:** Audit logs only captured action and actor (IP), but lacked depth (User-Agent, specific resource IDs) for many sensitive operations, making forensic analysis difficult.
**Learning:** Security auditing must be pervasive and include as much context as possible without logging secrets. By propagating IP and User-Agent from the controller layer down to the service layer for all state-changing operations, we create a much more robust trail.
**Prevention:** Always extract `ip` and `userAgent` at the edge (controllers) and pass them through to audit logging services for any action that modifies system state (configurations, session control, credential updates).

## 2026-06-18 - [Permissive CORS Wildcard Bypass]
**Vulnerability:** The CORS origin validation logic used a greedy `.*` regex for wildcards, allowing attackers to bypass origin checks by injecting the allowed domain into paths, query parameters, or fragments (e.g., `https://attacker.com/.example.com` matching `https://*.example.com`).
**Learning:** Wildcards in security-sensitive string matching must be constrained to the expected character set. Hostname wildcards should never match path separators (`/`), query starts (`?`), or fragment identifiers (`#`).
**Prevention:** Use restrictive character classes (e.g., `[^/?#]+`) instead of `.*` when generating regular expressions for wildcard matching in URLs or hostnames.

## 2026-06-22 - [Missing Outgoing Request Timeouts]
**Vulnerability:** Outgoing external API requests (e.g., Binance key validation) lacked timeouts, creating a risk of resource exhaustion (DoS) if the external service hung or responded very slowly.
**Learning:** Every external integration point is a potential availability risk. Synchronous-feeling operations like credential validation must be bounded to protect the application's event loop and socket pool.
**Prevention:** Enforce the use of `AbortSignal.timeout()` for all external `fetch` calls and ensure graceful handling of `TimeoutError` and `AbortError`.

## 2026-06-22 - [IP Reputation Preservation via Fail-Fast Lifecycle]
**Vulnerability:** Application repeatedly hammered the Binance API with REST polling when the User Data Stream failed to initialize, leading to extended IP bans and complete account lockout.
**Learning:** Security and availability are linked to exchange reputation. Polling fallbacks are 'Deadly Loops' if the IP is already flagged. Failing fast is a protective security measure for the application's infrastructure.
**Prevention:** Disable automatic polling fallbacks for critical exchange state. Implement mandatory inter-request delays (throttling) at the client level and ensure IP ban status (418/429) triggers an immediate system-wide cooldown.

## 2026-06-23 - [Shared IP Reputation Coordination in Multi-Client Environments]
**Vulnerability:** Rate-limiting and throttling state in `BinanceRequestQueue` was instance-scoped, allowing multiple trading session clients to collectively exceed the IP-wide rate limits of the Binance API.
**Learning:** Security and reliability mechanisms that protect external IP reputation must be coordinated process-wide. In Node.js, this is most effectively achieved by using static class members for state that represents the shared reality of the server's public IP.
**Prevention:** Always use static members for rate-limit and IP-reputation tracking when multiple service instances share the same upstream identity.

## 2026-06-23 - [Fatal-Log Propagation for Critical IP Bans]
**Vulnerability:** Detection of an HTTP 418 (IP Ban) only logged a warning and triggered a temporary cooldown, potentially allowing other parts of the system or manual retries to worsen the reputation damage.
**Learning:** Critical security and reputation events like IP bans must be treated as fatal system states. Implementing an immediate but clean exit (`process.exit(1)`) satisfies the 'Fail Fast' directive and protects the infrastructure from compounding penalties.
**Prevention:** Ensure that catastrophic infrastructure rejections (like permanent bans) trigger a deliberate system halt rather than just a transient error.

## 2026-06-23 - [Insufficient Entropy in Admin Authentication Secrets]
**Vulnerability:** `ADMIN_API_KEY` had no minimum length requirement, allowing users to configure weak, easily guessable secrets for dashboard and monitoring protection.
**Learning:** Security guards are only as strong as the secrets they protect. Enforcing minimum entropy (e.g., 16+ characters) at the guard level prevents "security theater" where an endpoint is technically protected but practically vulnerable to brute-force.
**Prevention:** Implement strict length and complexity validation for all authentication secrets in guards and configuration services.
