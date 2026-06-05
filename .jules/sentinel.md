## 2026-05-28 - Trade Model Consistency
**Vulnerability:** Missing properties in core models can lead to runtime errors or inconsistent data persistence if using "as any" type casting.
**Learning:** Always synchronize in-memory models (DTOs/Classes) with database entities to ensure schema integrity and avoid property access crashes.
**Prevention:** Use stricter TypeScript configurations and ensure all properties used in the logic are explicitly defined in the relevant interfaces/entities.

## 2026-05-29 - API Key Authorization and WebSocket Stability
**Vulnerability:** Sensitive REST endpoints and WebSocket connections were unprotected, allowing unauthorized access to Binance API keys and trading controls. Additionally, unhandled WebSocket errors could crash the Node.js process.
**Learning:** In public-facing applications, even internal ones, sensitive endpoints must be guarded. For WebSockets, always implement error handlers at the socket level to prevent fatal process crashes from unexpected disconnections or malformed frames during the handshake.
**Prevention:** Implement a global or controller-level Guard for API authorization. Use `verifyClient` for WebSocket handshakes and ensure every socket instance has an `.on('error')` handler.

## 2026-05-30 - Atomic Balance Reconciliation
**Vulnerability:** Forced session termination could bypass balance updates if the primary closure logic failed, leading to data drift between the database and the actual account state upon restart.
**Learning:** Fallback paths in critical state-changing logic (like trade closure) must be as robust as the primary path, including explicit balance synchronization.
**Prevention:** Always ensure that every logical branch leading to trade finalization includes a mandatory account/session balance update.
## 2026-05-30 - Timing Attacks on Secret Comparison
**Vulnerability:** Standard strict equality (`===`) used for verifying API keys and WebSocket tokens was susceptible to timing attacks, potentially leaking secret values.
**Learning:** String comparison in most runtimes is optimized to return as soon as a mismatch is found, meaning the execution time depends on how many characters match. `crypto.timingSafeEqual` provides constant-time comparison but requires inputs of equal length.
**Prevention:** Use a `safeCompare` utility that hashes both strings (e.g., using SHA-256) before using `crypto.timingSafeEqual`. This ensures equal-length inputs and prevents leaking the secret's length or value via timing.

## 2026-05-30 - Client-Side State Protection
**Vulnerability:** Relying on the backend to provide the full state in every update can lead to sensitive UI data being exposed or cleared unexpectedly if the backend applies aggressive pruning.
**Learning:** The frontend must act as a secondary guard for data integrity. Implementing "Local State Preservation" ensures that once sensitive or critical data (like trade configs) is delivered over a secure channel, it is held securely in client memory even if subsequent partial updates omit it.
**Prevention:** Design frontend stores to merge updates by default, rather than replacing state, specifically for complex objects delivered via WebSockets.

## 2026-05-30 - Background Task Suppression
**Vulnerability:** Maintaining high-frequency market data streams and engine loops for idle or backgrounded clients can lead to resource exhaustion and potential DoS on the server side.
**Learning:** Resource suppression should be applied as close to the source as possible.
**Prevention:** Implement "ECO-MODE" floors for loop intervals and strictly suppress data ingestion (miniTickers) when no active traders or listeners are present.

## 2026-05-31 - WebSocket Zombie Connection Protection
**Vulnerability:** Broken or "zombie" WebSocket connections could remain open indefinitely on the server, leading to resource exhaustion (memory/handles) and potential Denial of Service.
**Learning:** Modern networking environments (firewalls, load balancers, unstable mobile links) can cause connections to hang in a half-open state where the server believes the client is still connected but no data is flowing.
**Prevention:** Implement a standard heartbeat (ping/pong) mechanism at the application level. Periodically ping all clients and strictly terminate those that fail to respond within a defined window.

## 2026-05-31 - Insecure Credential Entry Warning
**Vulnerability:** Users might inadvertently enter sensitive Binance API credentials over an unencrypted HTTP connection if the dashboard is deployed without forced SSL, exposing secrets to man-in-the-middle (MITM) attacks.
**Learning:** Security is a shared responsibility. While the backend should enforce HSTS, the UI must proactively warn users before they perform high-risk actions over insecure channels.
**Prevention:** Implement a prominent UI banner in the settings view that detects and warns against insecure (non-HTTPS) connections when not on localhost.

## 2026-05-31 - Server Header Suppression
**Vulnerability:** The default 'Server' header often leaks information about the underlying web server or framework version, aiding reconnaissance for potential attackers.
**Learning:** Minimizing the attack surface includes removing unnecessary information disclosure in HTTP headers. While often overlooked, the 'Server' header can provide specific version clues.
**Prevention:** Explicitly remove the 'Server' header in middleware to ensure it's not broadcasted in HTTP responses.

## 2026-06-01 - Global Structured Exception Handling
**Vulnerability:** Unhandled exceptions in NestJS can leak internal stack traces and implementation details in the response body, especially for 500 Internal Server Errors.
**Learning:** Default error handling is often too verbose for production. A custom global filter is necessary to decouple internal debugging logs from client-facing responses.
**Prevention:** Implement a global `ExceptionFilter` that intercepts all errors, logs full stack traces to the server console, but returns only sanitized, predefined fields (statusCode, message, timestamp, path) to the client.

## 2026-06-02 - Production Security Enforcement
**Vulnerability:** Opt-in security models (optional ADMIN_API_KEY) can lead to accidental exposure of sensitive dashboards and trading controls if environment variables are omitted or misconfigured in production.
**Learning:** Security should be "fail-closed" by default in production. While "opt-in" is convenient for development, a production environment must explicitly require authentication credentials to start or accept connections.
**Prevention:** Implement mandatory environment variable checks during application bootstrap and within authorization guards to refuse operation in production if core security secrets are missing.

## 2026-06-04 - Bootstrapping Sensitive Configuration
**Vulnerability:** Premature access to `process.env` during module instantiation caused spurious warnings or incorrect initialization before the configuration module had loaded the `.env` file. Furthermore, strict validation (`IsNotEmpty`) in DTOs prevented the UI from clearing sensitive credentials (sending empty strings).
**Learning:** Application configuration loading must be idempotent and delayed until the runtime environment is fully established. Additionally, DTO validation must be permissive enough to allow legitimate state changes (like clearing a field) while still preventing invalid inputs.
**Prevention:** Avoid top-level `process.env` lookups in service/library files that run during module import. For DTOs, use `IsOptional` to allow empty values, and use custom validation or service-level logic to handle the business rules for "clearing" sensitive data.

## 2026-06-05 - Audit Logging and Cache Hardening
**Vulnerability:** Sensitive Binance API credentials could be updated without an audit trail, and API responses containing sensitive trading data lacked cache-control headers, potentially exposing data in browser caches or intermediate proxies.
**Learning:** High-value administrative actions must always be logged with client context (IP address). Furthermore, real-time trading dashboards should explicitly disable all caching to prevent data leakage in shared or public networking environments.
**Prevention:** Implement mandatory audit logging for all state-changing administrative endpoints. Enforce strict `Cache-Control: no-store` headers globally for all API responses.
