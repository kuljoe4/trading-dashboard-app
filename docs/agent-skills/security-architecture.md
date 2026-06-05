# Security Architecture & Auditor Guidelines

## 1. Credential Protection
- **AES-256-GCM Encryption:** Encrypt sensitive API keys at rest.
- **IV + Tag Storage:** Store Initialization Vectors (IV) and Authentication Tags alongside the ciphertext (`iv:tag:encrypted`) to ensure integrity.
- **Fixed Salt Scrypt:** Use `crypto.scryptSync` with a fixed salt derived from environment variables for consistent key derivation.

## 2. Authentication Hardening
- **Timing-Safe Comparisons:** Use `crypto.timingSafeEqual` for all API key and token validations to prevent timing attacks.
- **IP-Based Throttling:** Track failures centrally with a TTL (e.g., 10 minutes) to block brute-force attempts on REST and WebSocket handshakes.
- **Auth Persistence:** Use `localStorage` with restricted expiration and sensitive headers (`ADMIN_API_KEY`) that are never returned by the API itself.

## 3. Communication Security
- **Dynamic Origin Validation:** Use wildcard-aware patterns for CORS and WebSocket origin checks (e.g., `https://*.railway.app`).
- **Cache Control:** Enforce `no-store` headers on all trading data to prevent leakage via browser cache or proxies.
- **Trust Proxy:** Enable `trust proxy` in Express to accurately capture client IPs behind load balancers for throttling.

## 4. Secure Coding Standards
- **Unknown Error Narrowing:** Always narrow `unknown` error types in catch blocks to prevent TS safety bypass.
- **Mandatory Env Guards:** Fail-fast at startup if `ENCRYPTION_KEY` or `ADMIN_API_KEY` are missing in production.
