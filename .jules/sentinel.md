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
