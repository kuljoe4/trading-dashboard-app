# Sentinel's Journal

## 2026-05-12 - Input Validation and Partial Updates for Sensitive Credentials
**Vulnerability:** Lack of strict input validation on Binance API key/secret update endpoint, and accidental deletion of credentials during partial updates.
**Learning:** Even internal-ish management endpoints need strict DTO-based validation to prevent malformed data or DoS via large inputs. Partial updates should be handled explicitly to avoid overwriting existing data with empty values if the client only sends one field.
**Prevention:** Always use NestJS `ValidationPipe` with dedicated DTOs and only update fields that are explicitly provided in the request.
