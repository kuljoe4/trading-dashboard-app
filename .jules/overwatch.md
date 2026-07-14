## 2026-06-23 - Binance IP Ban & Global Throttling Vulnerability
**Vulnerability:** `BinanceRequestQueue` was localized per-client instance, allowing concurrent bursts if multiple sessions were active. It also lacked a "fail-fast" mechanism for 418 (IP Ban) errors, potentially worsening ban durations by allowing continued traffic from other components.
**Learning:** In a multi-session architecture, REST throttling must be synchronized globally (at least process-wide) to respect IP-level rate limits. Localized queues are insufficient when they share the same egress IP.
**Prevention:** Use static shared state for `lastRequestTs` and `isBanned` flags within the request manager. Implement immediate `process.exit(1)` on 418 errors to satisfy Overwatch "Fail Fast" directives.

## 2026-06-30 - Manual Fetch Throttling Gap
**Vulnerability:** Several components (`MarketFeedService`, `SettingsController`) used direct `fetch` calls to Binance, bypassing the centralized `BinanceRequestQueue`. These unthrottled requests ignored process-wide weight limits and IP-ban cooldowns.
**Learning:** A request queue is only as effective as its coverage. Naked REST calls outside the primary SDK wrapper can trigger IP bans even if the main trading logic is perfectly throttled.
**Prevention:** Enforce a "Gatekeeper" pattern where all external exchange traffic must pass through a throttled factory method (`BinanceClientFactory.genericRequest`). Standardize weight extraction and logging for these generic tasks to maintain telemetry visibility.

## 2026-07-07 - Volatile API Ban Status
**Vulnerability:** API ban and rate-limit cooldowns were stored only in static memory within `BinanceRequestQueue`. Upon application crash or restart (common in cloud environments like Railway), this state was lost, causing the bot to immediately resume hammering the exchange API even if a 24-hour ban was still active.
**Learning:** For high-stakes exchange integrations, "Terminal Lock" states must be persistent. Relying on process memory for IP reputation protection is a single point of failure in distributed or auto-restarting infrastructures.
**Prevention:** Persist `api_ban_until` and `api_ban_reason` to a global settings table. Implement `OnModuleInit` in the client factory to re-hydrate the request queue's cooldown state from the database before any egress traffic is dispatched.
