# Sentinel's Journal

## 2026-05-12 - Input Validation and Partial Updates for Sensitive Credentials
**Vulnerability:** Lack of strict input validation on Binance API key/secret update endpoint, and accidental deletion of credentials during partial updates.
**Learning:** Even internal-ish management endpoints need strict DTO-based validation to prevent malformed data or DoS via large inputs. Partial updates should be handled explicitly to avoid overwriting existing data with empty values if the client only sends one field.
**Prevention:** Always use NestJS `ValidationPipe` with dedicated DTOs and only update fields that are explicitly provided in the request.

## 2025-05-20 - Missing Security Headers and Loose Credential Sanitization
**Vulnerability:** The backend was missing essential security headers (X-Frame-Options, CSP, etc.), and Binance API credentials were not trimmed, potentially leading to auth failures due to whitespace.
**Learning:** Defense-in-depth requires both transport-level protections (headers) and strict input handling for sensitive data. Even if the frontend is trusted, the backend must enforce security boundaries.
**Prevention:** Implement global security header middleware and always sanitize/validate sensitive inputs at the controller level, even if using DTOs.

## 2026-05-19 - Missing Field-Level Exclusion for Sensitive Credentials
**Vulnerability:** Sensitive Binance API credentials in the `Settings` entity were missing the `select: false` attribute, making them susceptible to accidental exposure in generic TypeORM queries (e.g., `repository.find()`).
**Learning:** Defense-in-depth requires that secrets are not only encrypted but also excluded from default data retrieval paths. Relying on manual field filtering in controllers is error-prone.
**Prevention:** Always mark sensitive columns with `select: false` in TypeORM entities and explicitly select them only in the specific services or controllers where they are required for functional operations.
