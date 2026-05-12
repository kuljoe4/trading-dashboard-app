## 2026-05-11 - DTO-based Input Validation for Binance API Keys
**Vulnerability:** Lack of input validation in `SettingsController` allowed for potentially large or malformed strings to be passed to the backend, and a logic flaw in the update process could lead to accidental clearing of existing keys.
**Learning:** Even if `ValidationPipe` is enabled globally, it won't enforce validation on anonymous `@Body()` types. Using explicit DTOs with `class-validator` decorators is required for proper protection.
**Prevention:** Always use DTOs for incoming request bodies and prefer strict `undefined` checks over truthy checks when performing partial updates on sensitive credentials.
