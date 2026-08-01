## 2026-08-01 - Denial of Service via Malformed Nested Array Configurations
**Vulnerability:** The `trading_windows` configuration array inside `SessionConfig` used loose object-level validation (`@IsObject({ each: true })`), bypassing nested field type checks. A malformed request containing non-string start/end values (e.g., numbers or null fields) could pass the API gateway and subsequently crash the entire NestJS background engine with a runtime `TypeError` when parsing time intervals inside `GatingService.isInsideTradingWindow`.
**Learning:** Complex configuration blocks represented as nested objects or arrays of objects must always utilize strict class-transformer and nested class-validator mappings (`@ValidateNested` with `@Type`). Loose dictionary constraints leave hot-path background service logic highly vulnerable to fatal type crashes.
**Prevention:** Always model nested arrays of objects with dedicated validation classes and apply strict type-checking, regex constraint matching, and robust runtime filtering before executing string or array manipulation functions.

## 2026-07-31 - Unbounded Arrays in Hot-Path Active Trade Config Updates
**Vulnerability:** The active trade configuration endpoint `/session/trade/:id/config` accepted optional arrays `live_rr_sequence` and `exit_rr_sequence` without any size constraints or length compatibility checks. An attacker or corrupted config could submit massive numeric arrays to these fields, causing severe CPU performance degradation and event-loop blocks (Denial of Service) because these sequences are iterated over on every single price ticker tick.
**Learning:** In high-frequency event loops or hot paths, any user-supplied arrays or objects that are iterated over dynamically on every tick must have strict, early size limits and structural integrity checks at both the DTO and service layer.
**Prevention:** Apply strict `@ArrayMaxSize` validation decorators in NestJS DTOs and defensively merge/validate final arrays at the service layer before saving or hot-reloading configurations in the engine.

## 2026-07-29 - Client IP Anti-Spoofing and CDN-Proxy Resolution
**Vulnerability:** Relying solely on the `X-Forwarded-For` header for client IP extraction in the security throttling and audit logging layer is highly prone to spoofing, as clients can easily append arbitrary, fake IPs to the leftmost parts of this header. This can bypass IP-based brute-force protections or corrupt forensic audit logs.
**Learning:** For application deployments behind trusted CDNs or edge proxies (such as Cloudflare or customized Nginx setups), client IP detection must prioritize single-value edge-validated headers (such as `CF-Connecting-IP` or `X-Real-IP`). These headers are securely populated by the CDN/proxy and cannot be spoofed.
**Prevention:** Prioritize extracting the IP address from `cf-connecting-ip` and `x-real-ip` headers, strictly verifying their format, length, and validity as a real IP address before falling back to `x-forwarded-for` parsing.

## 2026-07-28 - Whitelist Gating for Manual Configuration Validations
**Vulnerability:** Manual invocation of class-validator's `validate()` on programmatically reconstructed or merged objects (such as partial updates inside `executeUpdateSession` or presets saving in `savePreset`) lacked strict whitelisting constraints. This allowed attackers to perform mass-assignment and over-posting attacks by injecting arbitrary non-decorated properties into persistent database storage models via generic/record types.
**Learning:** NestJS global validation pipes do not recursively filter nested inputs if they are declared as generic types (e.g. `Record<string, any>`). To ensure complete data integrity, manual validation steps must explicitly enforce strict schema conformity.
**Prevention:** Always pair `validate(configInstance)` with `{ whitelist: true, forbidNonWhitelisted: true }` when validating programmatically merged settings or configurations to reject any extraneous properties.

## 2026-07-27 - PauseSessionDto Strategy Label Input Gating and XSS Prevention Standard
**Vulnerability:** The optional `strategyLabel` property inside `PauseSessionDto` lacked size and format validation, exposing the application to Reflected/Stored XSS via script payloads, log/header injection vectors, and potential Denial of Service (DoS) memory/storage exhaustion via excessively large payloads.
**Learning:** Even simple state-transition parameters such as pause/resume labels must be strictly bound and validated against the same standards as configuration models if they can be logged, stored, or broadcast back to UI clients.
**Prevention:** Enforce `@MaxLength(100)` and strict alphanumeric/safe-character whitelists `/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]*$/` with HTML tag blocking via negative lookaheads `/^(?!.*<[a-zA-Z!/]).*$/` on any custom label inputs at the DTO layer.

## 2026-07-26 - Dynamic SessionConfig Record Validation and Hardening Standard
**Vulnerability:** Dynamic dictionary properties inside `SessionConfig` (like `signal_params`, `exit_signal_delays`, `exit_signal_actions`, `signal_timeframes`, and `scanner_weights`) bypassed standard class-validator structural guards, exposing the system to Stored XSS via parameter keys/values, memory exhaustion DoS via huge payloads, and type-confusion crashes in downstream trading engines.
**Learning:** Object properties mapped as dynamic records/dictionaries (`Record<string, any>`) must be explicitly audited at the service layer if class-validator cannot check nested elements natively. Safe whitelisting must check keys (length, character patterns, tag prevention), size of keys, and value types/ranges.
**Prevention:** Implement a recursive flat/shallow validation helper (`validateRecord`) inside `validateConfig` to enforce size limits (e.g., max 50 keys), regex whitelist gating on keys (`/^[a-zA-Z0-9_\-]*$/`), and strict value-type assertions.

## 2026-07-25 - Secure API Key Masking and Short Key Protection Standard
**Vulnerability:** The dynamic key masking logic inside `SettingsController.getKeys()` sliced any stored key using `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` without validating the key's length. For short/mock test keys or secrets (e.g., less than 8 characters), the prefix and suffix slices overlapped, disclosing the entire secret or a vast majority of its unique characters to the client.
**Learning:** Security-sensitive maskers must always establish a defensive minimum character threshold before exposing any plaintext subsets of credential strings. Masking must be absolute or length-capped for any string below this threshold to preserve complete confidentiality of credentials.
**Prevention:** Mask any sensitive key/secret shorter than 16 characters completely, using a fixed-length or capped mask (like `********` or `***`) to avoid leakage of string length or partial key content.

## 2026-07-24 - Robust Binance Interval Validation and Defensive Parsing Standard
**Vulnerability:** The session config interval properties (`scan_interval` and `sl_lookback_timeframe`) lacked validation, which could allow malformed interval strings to be passed to internal utility functions like `parseIntervalToMs`. These functions in turn lacked defensive type and format guards, exposing the backend to fatal `TypeError: Cannot read properties of undefined (reading 'slice')` or `NaN` crashes (Denial of Service).
**Learning:** Hardening core system parameters requires strict format whitelisting on user-provided strings at the DTO layer, coupled with explicit type checking and fallback mechanisms in low-level utility methods. This guarantees absolute system resiliency under arbitrary inputs.
**Prevention:** Always enforce `@Matches` regex bounds on inputs representing enumeration or specific domain patterns (like kline intervals) and add strict fallback defaults in parsing helpers.

## 2026-07-23 - SessionConfig and Strategy Label Hardening
**Vulnerability:** The session config `strategy_label` parameter lacked character-level gating and tag restrictions, creating a high-severity Stored XSS vulnerability as attackers could submit arbitrary JavaScript/HTML scripts that would be persisted in the `Session` and `Trade` database entities and subsequently rendered in the frontend dashboard.
**Learning:** Hardening core system boundaries requires auditing all user-input configuration models (like `SessionConfig`) rather than just presets and key fields. Enforcing safe character whitelists combined with negative HTML-tag lookaheads at the input validation tier provides definitive XSS and injection immunity.
**Prevention:** Apply strict character constraints and lookahead rules using class-validator `@Matches` decorators on all descriptive string parameters, and enforce strict item-level type/regex/length validation (`{ each: true }`) on all input string arrays.

## 2026-07-22 - API Key and Secret Input Validation Hardening
**Vulnerability:** API key and secret inputs lacked character-level gating, exposing endpoints to potentially hazardous inputs containing Stored XSS payloads, SQL/Command Injection characters, or carriage returns/newlines for Log Injection/CRLF attacks.
**Learning:** To allow safe Copy-Paste and Masked representations (e.g., `abcd...efgh`), the validation regex must permit dots `.` and spaces ` ` alongside standard base64/alphanumeric characters, while strictly excluding newlines, carriage returns, tabs, quotes, and HTML tag delimiters.
**Prevention:** Enforce `/^[a-zA-Z0-9_\-\.\+/= ]*$/` on API keys and secrets via NestJS class-validator `@Matches` decorators to secure the application boundary while preserving user convenience.

## 2026-07-20 - Stored XSS Mitigation via HTML Tag Gating
**Vulnerability:** Expanding preset name character whitelist to support logical comparisons (`<` and `>`) introduces a high-severity Stored XSS vector, as attackers could save arbitrary HTML tags and scripts (e.g. `<script>`).
**Learning:** Permitting logical comparisons inside validation schemas must be coupled with strict negative lookaheads/checks that detect and reject HTML/XML tag starts (`<` followed by an alphabet char, `!`, or `/`) to maintain absolute security while preserving full descriptive capabilities.
**Prevention:** Always pair mathematical or relational character allowances with explicit defenses blocking the generation of executable HTML/JS tag initializations.

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
## 2026-07-15 - Log Injection and Storage Exhaustion Protection
**Vulnerability:** Metadata fields in audit logs (User-Agent, Actor) and application logs lacked length limits and character sanitization, creating risks of Log Injection and storage-based Denial of Service.
**Learning:** Even internal/audit metadata must be treated as untrusted input. Maliciously crafted headers or extremely long strings can compromise log integrity or exhaust system resources (DB storage, memory).
**Prevention:** Implement a strict "Sanitize & Truncate" policy at the persistence layer. Strip non-printable control characters to prevent log forging and enforce hard length limits (e.g., 4000 chars for logs, 1024 for User-Agents) to protect system availability.
## 2026-07-15 - Robust Metadata Sanitization for Multi-Value Headers
**Vulnerability:** `AuditLogService.log` crashed with a `TypeError` when metadata fields (like `userAgent`) were passed as arrays (e.g., from multi-value `X-Forwarded-For` or `User-Agent` headers), as the `sanitizeMeta` function expected strings.
**Learning:** Security utilities handling request metadata must be polymorphic. Express/NestJS can represent repeated headers as arrays, and assuming a string type leads to availability failures in the audit trail. Furthermore, fallback logging logic must prioritize the sanitization of sensitive fields (like `details`) even if the primary sanitization block fails.
**Prevention:** Always check for `Array.isArray()` when processing header-derived metadata and join values into a string before sanitization and truncation. Ensure fallback loggers use a "fail-safe" approach that guarantees sanitization of high-risk fields.

## 2026-07-17 - Logging Leakage via Unsanitized String Exceptions
**Vulnerability:** Non-500 `HttpException` warning logs in `AllExceptionsFilter` bypassed the `sanitize` utility when the error message was a string primitive, risking the leakage of credentials and keys (like `api_key`) in logs.
**Learning:** Type check conditionals (like `typeof message === 'object' ? ... : message`) can inadvertently bypass security filters for primitives, assuming they are inherently safe when they are actually the primary carrier of sensitive raw messages.
**Prevention:** Always run all variations of user-derived error and exception messages through standard sanitization pipelines, regardless of whether they are structured objects or primitive string values.

## 2026-07-18 - Fixing Stale Account Balance Updates
- **Problem:** Binance `ACCOUNT_UPDATE` events were being processed by `SessionLifecycleService` and correctly updating the internal `sessionState.balanceLive`, but the new balance was not being broadcast to the frontend WebSocket clients.
- **Root Cause:** Missing `BroadcastService.broadcast` call in the `handleAccountUpdate` method after updating the internal state.
- **Action:** Injected `BroadcastService` into `SessionLifecycleService` and added `this.broadcastService.broadcast('balance_update', { balance: nb })` inside `handleAccountUpdate` when a real-time balance update is processed.
- **System Impact:** The trading dashboard now receives real-time balance updates whenever Binance sends an `ACCOUNT_UPDATE` event, ensuring consistent and accurate UI displays.

## 2026-07-21 - Unbounded Startup Network Request Timeout
**Vulnerability:** Outgoing REST requests initiated during application initialization/startup (specifically `fetchInitialTickers` in `MarketFeedService`) lacked a timeout signal, exposing the application to permanent hangs or self-inflicted Denial of Service (DoS) during cold boots if the exchange REST gateway is unresponsive or rate-limiting.
**Learning:** All startup REST/HTTP queries must have bounded execution guarantees to protect the event loop and ensure successful bootstrap sequences under unstable network/gateway conditions.
**Prevention:** Always couple startup `fetch` requests with explicit timeout signals (e.g. `AbortSignal.timeout(5000)`) and robust `try/catch` handlers that allow the system to proceed gracefully if the external dependency is slow or unreachable.
