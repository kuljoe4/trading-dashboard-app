## 2026-07-02 - Information Disclosure via Insecure Error Logging
**Vulnerability:** Use of `JSON.stringify(error)` in `SettingsController` catch blocks.
**Learning:** Error objects in Node.js, especially those from network request libraries or database drivers, frequently encapsulate the entire request context. This includes sensitive headers (like `X-MBX-APIKEY`) and raw payloads. Stringifying these objects for logging purposes creates a high risk of leaking plaintext credentials into persistent application logs.
**Prevention:** Always sanitize error objects before logging. Manually extract and log only non-sensitive fields such as `message`, `code`, and `name`. Avoid generic stringification of unknown or complex objects in security-sensitive code paths.
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

## 2026-06-27 - [Missing WebSocket Auth Failure Auditing]
**Vulnerability:** WebSocket authentication failures (invalid tokens and unauthorized origins) were only logged to the console but not recorded in the persistent database audit log, creating an observability gap for security monitoring.
**Learning:** In a hybrid API architecture, all authentication entry points (both HTTP and WebSocket) must share a common auditing standard. Failing to persist rejections on one interface allows for unmonitored probing.
**Prevention:** Ensure the `AuditLogService` is utilized in the WebSocket handshake hook (`verifyClient`) to mirror the auditing behavior of HTTP guards. Always normalize headers like `host` and `user-agent` (which can be arrays) before passing them to logging or URL parsing logic.

## 2026-06-30 - [Log Injection via X-Forwarded-For]
**Vulnerability:** The `extractIp` utility did not validate that the string extracted from the `X-Forwarded-For` header was actually a valid IP address. An attacker could provide a malicious payload (e.g., HTML tags for XSS in an audit dashboard, or CRLF for log splitting) which would then be persisted in the audit logs.
**Learning:** External data used as an identifier or for logging MUST be validated against its expected format. For IP addresses, Node's built-in `net.isIP` provides a robust validation mechanism.
**Prevention:** Always use `net.isIP(candidate)` to validate extracted IP addresses before using them in logging, throttling, or persistent storage. Fall back to a safe default if validation fails.

## 2026-06-30 - [Credential Leakage in Error Logs]
**Vulnerability:** Controllers handling sensitive data (like `SettingsController.updateKeys`) sometimes logged the full error object using `JSON.stringify(err)`. If an error occurred (e.g., a database constraint violation), the serialized error object could contain the full request body, including plaintext API keys and secrets.
**Learning:** Serialization of error objects is dangerous as they often capture the state of the application at the point of failure, which may include sensitive inputs or internal metadata.
**Prevention:** Never use `JSON.stringify(err)` for logging in paths that touch sensitive data. Log a specific error message and safe metadata instead. Ensure that internal error objects are caught and sanitized before they reach the controller's logger.
## 2026-07-11 - [Availability Risk via Unbounded Startup Requests]
**Vulnerability:** Outgoing network requests during application initialization (e.g., clock synchronization) lacked timeouts and status validation.
**Learning:** External dependencies that hang or fail silently during a synchronous-looking startup sequence can prevent the application from booting or reaching a ready state, leading to a self-inflicted Denial of Service.
**Prevention:** Always enforce strict timeouts (e.g., 5s) and validate response status for all network requests initiated during the application bootstrap phase.
