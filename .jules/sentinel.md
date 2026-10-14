## 2026-10-14 - Add Strict Auth Rate Limiting to SettingsController
**Vulnerability:** The sensitive `/settings/keys` and `/settings/keys/validate` endpoints were lacking specific rate limiting, making them vulnerable to brute-force credential testing or resource exhaustion attacks against the database and Binance API.
**Learning:** General API rate limits are not sufficient for authentication or credential validation routes, which require much stricter thresholds to mitigate credential stuffing and prevent downstream exchange API rate limit issues.
**Prevention:** Implement and enforce a dedicated, stricter `isAuthRateLimited` function for authentication-related endpoints, throwing 429 Too Many Requests to prevent abuse.
