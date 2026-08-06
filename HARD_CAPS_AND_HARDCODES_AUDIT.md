# Hard Caps and Hard-Coded Values Audit

## Overall verdict

The app has many reasonable guardrails for a trading dashboard running on a constrained Railway-style deployment, but the hard caps and hard-coded defaults are split across the backend DTO, engine services, frontend store, and UI input attributes. The biggest engineering risk is **configuration drift**: the UI often presents a narrower or different range than the backend accepts, while operational values such as Binance limits, stream chunk size, payload size, heartbeat cadence, cache TTLs, and history truncation are embedded as local literals instead of named policy constants.

From a UI/UX perspective, several caps are valid safety rails, but they need to be surfaced as intentional product constraints with helper text, validation parity, and presets for conservative/default/aggressive operation. From an engineering perspective, limits that protect capital, exchange rate quotas, memory, and browser performance should remain hard limits, but they should be centralized, named, tested, and documented.

## Industry standard alignment

Research basis used for this review:

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) is a current, widely used baseline for web application security controls and secure-development requirements. This supports keeping explicit request, WebSocket, payload, and input-size limits rather than removing them.
- [Binance USD-M Futures docs](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams) explicitly publish endpoint, WebSocket, ping/pong, stream-count, and rate-limit expectations, and the [general info limits](https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info) document the REST rate-limit/backoff model. This supports using exchange-aware caps, backoff, and WebSocket-first data access rather than uncapped polling.
- Senior frontend practice for data-dense trading UIs is to keep browser rendering bounded: cap logs, charts, scanner rows, and histories; progressively disclose dense controls; and avoid pushing every backend event directly into React.

## Confirmed hard caps and hard-coded values

### 1. Configuration model caps and defaults

| Area | Current hard cap / default | Judgement | Evidence |
| --- | --- | --- | --- |
| Strategy variants | Backend allows at most 10 variants. | Reasonable to avoid combinatorial scan/load explosion, but the UI should show why and prevent adding the 11th variant. | `@ArrayMaxSize(10)` on `strategy_variants` in `backend/node/src/models/SessionConfig.ts`. |
| Single-symbol monitors | Backend allows at most 100 symbol monitors. | Reasonable backend safety cap; UI has no visible remaining-count or max-state. | `@ArrayMaxSize(100)` on `single_symbol_configs` in `backend/node/src/models/SessionConfig.ts`. |
| Watchlist size | Backend allows 1-200, defaults to 25; UI allows 10-100. | Drift. UI is stricter than backend without explanation, which creates confusion when editing configs created elsewhere. | Backend `@Max(200)` and default `25`; frontend input `min: 10, max: 100`. |
| Signal lists | Backend caps entry/exit signals at 20 each. | Fine defensive cap; currently higher than the visible signal catalog, so it is mostly future-proofing. | `enabled_signals` and `exit_signals` use `@ArrayMaxSize(20)`. |
| Signal params payload | Backend caps `signal_params` at 2000 characters. | Good payload protection; should have parse/shape validation as the signal set grows. | `@MaxLength(2000)` on `signal_params`. |
| Stop-loss distance | Backend allows 0.1-10%; UI allows minimum 0.05% and no max for fixed SL. | Drift and trading-risk concern. UI can submit values backend rejects, and missing max encourages unsafe fat-finger values. | Backend `@Min(0.1)`/`@Max(10)`; frontend fixed SL input `min: 0.05`. |
| Risk per trade | Backend allows 0.01-100%; UI allows minimum 0.1% and no max in the global risk section. | The backend max is technically safe from validation failure, but product safety should add a stronger recommended warning threshold well below 100%. | Backend `@Min(0.01)`/`@Max(100)`; frontend `Risk % per trade` only sets `min: 0.1`. |
| Max total risk | Backend allows 0.1-100%; UI allows minimum 0.5 and no max. | Should expose max or warning. This is a capital-preservation setting and should not be an unbounded numeric field in UX. | Backend `@Min(0.1)`/`@Max(100)`; frontend `Max total risk %` only sets `min: 0.5`. |
| Trading windows | Backend caps to 10 windows; UI does not show the limit. | Reasonable operational cap; add disabled state and count in UI. | `@ArrayMaxSize(10)` on `trading_windows`; UI “+ Add Window” has no max check. |
| Loop intervals | Backend minimums are 500ms hot and 1000ms main; defaults are 5000ms and 15000ms. | Good resource guardrails, but README/config modal text still references older 2000/5000 defaults in places. | `SessionConfig` defaults and ConfigModal performance note. |

### 2. Backend engine and exchange-operation caps

| Area | Current hard cap / default | Judgement | Evidence |
| --- | --- | --- | --- |
| Binance market endpoints | Production REST and WS URLs are hard-coded. | Acceptable for a Binance-only product, but should be configuration-driven for testnet/staging parity and future exchange adapters. | `BINANCE_WS_BASE` and `https://fapi.binance.com` REST calls in `market_feed.service.ts`. |
| WebSocket stream chunks | Combined kline streams are split into chunks of 20. | Good conservative URL-length and reliability choice, but the reason is not tied to Binance's 1024-stream connection max. Use named constant and document tradeoff. | `CHUNK_SIZE = 20` in `market_feed.service.ts`. |
| Ticker bootstrap fallback | Waits up to 5 seconds for miniTicker before REST seeding. | Reasonable, but should be named and observable. Slow startups can otherwise look like empty markets. | 100ms checks and 5000ms timeout in `market_feed.service.ts`. |
| Watchlist refresh | Rebuilds watchlist every 120 seconds. | Good for resource control; make configurable because high-volatility users may expect fresher top-volume discovery. | `setInterval(..., 120000)` in `market_feed.service.ts`. |
| Backfill jitter | Random delay up to 2000ms before REST backfill. | Good anti-burst pattern; should be named and tested around startup spikes. | `Math.random() * 2000` in `market_feed.service.ts`. |
| Kline retention | Stored candle retention comes from `KLINE_MAX_CANDLES` with clamp 50-500 and default 200. | Strong design. This is a real memory cap and is already centralized in the service. | `kline_store.service.ts` uses env/default/clamp. |
| Top-volume cache | Cache TTL 60000ms and max 12 cache keys. | Reasonable browser/backend CPU cap; should be named in docs and maybe tuned with watchlist refresh. | `TOP_VOLUME_CACHE_TTL_MS` and `TOP_VOLUME_CACHE_MAX_KEYS`. |
| Scanner results | Scanner sorts then returns only top 15; frontend/status usually show 5-10. | Good UI performance cap, but users may not know opportunities were hidden. Add “showing top N” copy and config. | `momentum_scanner.service.ts` slices to 15; `trading_session.service.ts` slices scanner broadcasts. |
| Scanner sparklines | History limited to 20 closes. | Good mobile/chart cap. Keep hard, but name as chart payload policy. | `historyLen = Math.min(20, candles.length)`. |
| Analytics curve | Tick payload sends last 20 cumulative PnL points. | Good payload cap; long-term analytics screens should fetch full data separately. | `cumulativePnL.slice(-20)` in `trading_session.service.ts`. |
| Session history payload | Runtime snapshots/status send 50 closed trades. | Good for dashboard speed but should be labeled “recent history” and not treated as full history. | `closedTrades.slice(0, 50)` in `trading_session.service.ts`. |
| History API | `/history` fetches 200 closed trades. | Reasonable initial page cap; needs pagination before serious usage. | `take: 200` in `session.service.ts`. |
| Rate-limit display | Binance request-weight limit hard-coded to 1200. | Risky because Binance exposes rate limits through `exchangeInfo` and headers. Display should treat this as an observed/default limit, not invariant truth. | `getBinanceRateLimit()` returns `limit: 1200`; frontend store default mirrors it. |
| Live balance poll fallback | 30-second polling if user-data stream fails. | Good fallback, but should be a named policy with backoff and visible degraded-state indicator. | `setInterval(..., 30000)` in `trading_session.service.ts`. |
| User-data keepalive | 30-minute listen-key keepalive. | Correct pattern, but should be named and tied to Binance user-stream docs. | `30 * 60 * 1000` in `trading_session.service.ts`. |
| Quiet tick heartbeat | 10 seconds with active trades, 30 seconds without. | Strong performance design. Expose as status/debug info so users understand lower update cadence. | `heartbeatInterval = hasActiveTrades ? 10000 : 30000`. |
| Eco-mode floors | No-listener mode floors hot loop at 5000ms and main loop at 15000ms. | Strong resource guard. Use shared constants; current code has duplicated fallback values and one older 2000/5000 fallback path. | `Math.max(5000...)` and `Math.max(15000...)` in `trading_session.service.ts`. |

### 3. API, WebSocket, and security hard limits

| Area | Current hard cap / default | Judgement | Evidence |
| --- | --- | --- | --- |
| HTTP body limit | JSON and URL-encoded bodies capped at 50kb. | Good security/resource cap; keep. For config-heavy presets, surface friendly 413 errors in UI. | `server.ts` body parser limits. |
| CORS origins | Railway production/staging URLs and localhost are hard-coded defaults. | Fine as fallback, but deployment-specific hostnames should live in env only to avoid stale origin failures. | `allowedOrigins` default array in `server.ts`. |
| WebSocket compression | perMessageDeflate has hard-coded chunk size, mem level, level, window bits, concurrency, threshold. | Reasonable but obscure operational tuning. Move to named constants or env if memory pressure varies by host. | `server.ts` WebSocketServer `perMessageDeflate` options. |
| WebSocket heartbeat | Server pings every 30 seconds. | Good zombie-connection control. Keep named. | `heartbeatInterval` in `server.ts`. |
| WebSocket inbound rate limit | 20 messages/sec per socket and 1000-character max message length. | Good minimum protection; should close or warn instead of silently returning, and should be documented for UI/devtools. | `socket.msgCount > 20` and `message.length > 1000`. |
| API-key token in WS query string | Frontend appends `token=` to WebSocket URL. | Functional, but query strings can appear in logs/proxies. Prefer short-lived WS auth message or cookie/header-compatible upgrade path where infrastructure supports it. | `frontend/src/store/trading.js` appends `VITE_ADMIN_API_KEY` as query token. |

### 4. Frontend UI/UX caps and hard-coded presentation limits

| Area | Current hard cap / default | Judgement | Evidence |
| --- | --- | --- | --- |
| Frontend config defaults | Duplicates backend defaults for balances, risk, scanner, RR sequences, and loop intervals. | Highest drift risk. Generate/shared config schema or fetch defaults from backend. | `defaultConfig` in `frontend/src/store/trading.js` duplicates `SessionConfig`. |
| Log buffer | Browser log buffer capped at 500. | Good browser-memory guard. Add “latest 500” copy in log UI. | `MAX_LOG_LINES = 500`. |
| Scanner throttle | React scanner updates capped to one every 200ms. | Good UI performance guard. Keep as named UI policy and consider pausing animations on low-power/mobile. | `SCANNER_THROTTLE_MS = 200`. |
| Trade history in store | Closed trade events keep 50 items. | Good dashboard cap; should not be confused with all history. | `tradeHistory.slice(0, 50)` in `frontend/src/store/trading.js`. |
| Dashboard scanner cards | Strategy card displays top 5 opportunities. | Good scannability choice, but needs “top 5” label and drill-in to all backend-returned opportunities. | `scannerResults.slice(0, 5)` in `DashboardView.jsx`. |
| Modal/drawer max sizes | Config drawer max-height 96%, width 800px/1000px depending content. | Good responsive guard for modals. Consider design tokens for drawer widths. | `DashboardView.jsx` drawer classes. |
| Detail/chart fixed heights | Strategy detail chart panels are fixed at 450px. | Acceptable desktop default; may waste space or crowd smaller screens. Use responsive min/max heights or CSS container queries. | `StrategyDetailView.jsx` fixed `h-[450px]`. |
| Page max widths | Detail/history/settings pages use fixed 800px/1200px max widths. | Good readability, but should be design tokens rather than repeated literals. | `max-w-[800px]` and `max-w-[1200px]` classes across views. |
| Confirmation timeout | Destructive action confirm states clear after 3000ms. | Good safety UX; make consistent helper/hook to avoid duplicated magic timeout. | Active trade, dashboard stop, and settings reset use 3000ms timers. |
| Copy/save success timeout | Success state clears after 2000ms. | Fine microinteraction; centralize as toast duration token. | `ConfigModal` and `CopyButton` use 2000ms timers. |
| Health colors | CPU >50%, event loop >50ms, hot loop >100ms, main loop >500ms thresholds are hard-coded. | These are helpful but not calibrated to configured loop intervals or host class. Use relative thresholds or backend-provided health state. | `SystemMetrics.jsx` threshold comparisons. |

## Senior engineer concerns

1. **Config drift is already present.** Backend `watchlist_size` allows 200, frontend caps at 100; backend fixed SL minimum is 0.1%, frontend allows 0.05%; performance defaults in the modal note reference 2000ms/5000ms while backend/store defaults are 5000ms/15000ms.
2. **Risk controls are configurable but not sufficiently productized.** Allowing up to 100% risk per trade and 100% max total risk may be acceptable as a validation ceiling, but the UI should warn well before those values and distinguish “allowed” from “recommended.”
3. **Exchange limits are partly assumed rather than discovered.** A hard-coded 1200 request-weight display can be wrong if Binance changes tiers or endpoint limits. The backend already reads weight headers; it should also load exchangeInfo rate limits or label 1200 as a fallback.
4. **Payload caps are useful but invisible.** Scanner results, analytics curves, histories, logs, and trade arrays are trimmed aggressively. This is good performance engineering, but users need labels like “Top 5 shown” or “Recent 50 trades” to avoid misinterpreting partial data.
5. **Operational constants are scattered.** Cadences and caps live in several services/components. This makes tuning hard, especially for a trading system where latency, API quota, CPU, and UI responsiveness are coupled.
6. **Deployment-specific hard-codes remain.** Railway frontend URLs in backend CORS defaults and production Binance endpoints inside market-feed code are practical shortcuts, but they weaken portability and testnet confidence.

## Priority fixes

1. **Create a shared configuration policy.** Add named constants or a shared schema for defaults, min/max values, UI helper text, and backend validators. Start with scanner, stop loss, risk, loop intervals, and RR sequence limits.
2. **Fix frontend/backend validation drift.** Align watchlist, SL distance, loop interval, max risk, trading windows, and signal parameter ranges. Where the UI intentionally narrows backend limits, label that as a product recommendation.
3. **Centralize engine/exchange constants.** Extract stream chunk size, heartbeat intervals, reconnect/backoff values, scanner result caps, history caps, and rate-limit fallback into named constants with comments.
4. **Make partial-data caps explicit in UI.** Add labels for “Top 5”, “Recent 50”, “Latest 500 logs”, and “Last 20 points” where applicable.
5. **Treat Binance limits as runtime data.** Fetch `exchangeInfo` rate limits when possible and use observed headers as source of truth; keep 1200 only as fallback.
6. **Move deployment-specific URLs to env.** Keep localhost defaults, but remove Railway hostnames from source defaults once deployment envs define `ALLOWED_ORIGINS`.

## Long-term improvements

- Add pagination/virtualization for history and logs before increasing caps.
- Add a backend `/session/config-schema` or `/session/default-config` endpoint so the frontend does not duplicate trading defaults.
- Add preset tiers: **Conservative**, **Balanced**, **Aggressive**, and **Railway Low Resource**, with clear risk and resource implications.
- Add tests that assert UI ranges match backend validators for important trading controls.
- Add observability around cap hits: scanner results truncated, WS rate-limit messages dropped, body payload rejected, history truncated, and exchange quota thresholds crossed.
- Add per-mode endpoints/hosts for live vs testnet Binance operations to avoid accidental production/testnet mismatch.

## What is already strong

- The app already uses explicit resource caps for logs, candles, scanner output, histories, request payloads, WebSocket messages, and update cadences.
- WebSocket-first market data and REST fallback align with Binance guidance to reduce REST pressure.
- Eco-mode and quiet ticks are practical choices for a resource-constrained always-on dashboard.
- Backend validation exists for most capital/risk/scanner fields, which is the right safety layer.
- UI has progressive sections, toggles, and compact controls that are appropriate for a dense trading configuration surface.
