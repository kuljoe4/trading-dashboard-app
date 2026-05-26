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

## 2026-05-25 - Robust WebSocket Parsing and Origin Warnings
**Vulnerability:** The WebSocket message handler lacked a `try-catch` around `JSON.parse` and a type check for the resulting data, making it vulnerable to process crashes via malformed JSON or "null" payloads. Additionally, development origin bypasses were silent.
**Learning:** WebSocket handlers in Node.js must be extremely defensive as they are long-lived. A single malformed message can crash the entire connection or even the process if not handled. Development fallbacks for security features (like CORS/Origin) should always log warnings to prevent them from being forgotten in production-like environments.
**Prevention:** Always wrap `JSON.parse` in `try-catch` within socket message handlers. Log prominent security warnings when falling back to loose origin verification in non-production environments to maintain visibility.

## 2026-05-26 - HTTP Payload Limits and Semantic Exception Handling
**Vulnerability:** The application lacked explicit HTTP payload size limits, leaving it vulnerable to DoS attacks via massive JSON bodies. Additionally, generic error throws resulted in 500 status codes and potential info leakage.
**Learning:** NestJS/Express default limits might be too permissive for small, dedicated services. Standardizing on semantic exceptions (BadRequest, Conflict) not only improves API quality but also hardens the error boundary against internal detail exposure.
**Prevention:** Always configure `json` and `urlencoded` middleware with strict `limit` values (e.g., 50kb). Prefer specific NestJS HTTP exceptions over generic `Error` objects in controllers and services.
