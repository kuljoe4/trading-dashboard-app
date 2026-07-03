## 2026-07-02 - Information Disclosure via Insecure Error Logging
**Vulnerability:** Use of `JSON.stringify(error)` in `SettingsController` catch blocks.
**Learning:** Error objects in Node.js, especially those from network request libraries or database drivers, frequently encapsulate the entire request context. This includes sensitive headers (like `X-MBX-APIKEY`) and raw payloads. Stringifying these objects for logging purposes creates a high risk of leaking plaintext credentials into persistent application logs.
**Prevention:** Always sanitize error objects before logging. Manually extract and log only non-sensitive fields such as `message`, `code`, and `name`. Avoid generic stringification of unknown or complex objects in security-sensitive code paths.
