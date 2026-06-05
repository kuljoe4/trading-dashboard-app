# Reliability & SRE (Site Reliability Engineering)

## 1. System Stability
- **Memory Limits:** Design for resource-constrained environments (e.g., 256MB/512MB RAM). Use structured object reuse and lean service architecture.
- **Process Supervision:** Ensure the backend can recover from DB connection drops (e.g., 'SSL error: unexpected eof') by implementing reconnection logic and startup health guards.
- **Environment Hardening:** Use `NODE_ENV=production` defaults and mandatory environment variable checks to ensure security guards are active by default.

## 2. Observability & Monitoring
- **Health Checks:** Implement `/health` endpoints that verify database connectivity and Binance API reachability.
- **Structured Logging:** Use NestJS `Logger` with context-specific tags to allow for easy log filtering in production.
- **Runtime Metrics:** Track critical metrics like CPU usage, Memory heap, and Binance API weight usage to detect leaks or rate-limit proximity.

## 3. Failure Handling
- **Graceful Shutdown:** Implement `onModuleDestroy` hooks to cancel pending orders and save session state before the process terminates.
- **Fallback Balance Sync:** Prioritize Binance balance polling, but fall back to local PnL-based calculations if the API is unreachable to maintain UI continuity.
- **Append-Only Audit Logs:** Use a dedicated `AuditLog` entity to track system-critical events, including actor IP and timestamp, for post-incident analysis.
