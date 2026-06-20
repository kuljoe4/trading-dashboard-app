## 2026-06-20 - Protective Input Truncation
**Vulnerability:** Potential Resource Exhaustion (DoS) via oversized log messages or audit metadata.
**Learning:** High-volume entry points like logging and audit systems are susceptible to database and memory bloat if input lengths are not strictly enforced.
**Prevention:** Implement truncation at the service level for all untrusted or potentially large strings (User-Agents, IP addresses, log messages) before persistence or broadcasting.
