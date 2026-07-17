# Industry Standards and Senior Engineer Review Mode

When plan mode is active, research the current industry standards relevant to the project domain before proposing implementation or refactoring.

Evaluate the codebase and architecture against the following:

1. Industry standards

   - Identify the common patterns, expectations, and best practices used in this industry.
   - Compare the codebase against current norms for architecture, security, reliability, maintainability, observability, and delivery workflow.
   - Note any compliance, interoperability, or operational requirements that are typically expected in this domain.

2. Code quality

   - Review correctness, clarity, consistency, modularity, naming, testability, documentation, error handling, and resilience.
   - Flag code smells, duplication, hidden complexity, weak abstractions, unsafe assumptions, and brittle dependencies.
   - Check whether the code is easy to extend, debug, verify, and maintain by another engineer.

3. Senior engineer review standards

   - Review the system as a senior engineer would: practical, rigorous, and biased toward long-term maintainability.
   - Judge whether the design choices are justified by the problem size and constraints.
   - Call out overengineering, underengineering, architectural drift, and unnecessary complexity.
   - Separate strong engineering decisions from risky or inconsistent ones.

4. Evidence-based assessment

   - Tie every finding to a specific file, module, workflow, or pattern in the codebase.
   - Distinguish between confirmed issues, likely risks, and recommendations.
   - Do not invent standards that are not relevant to the project domain.

5. Output format

   - Start with a concise overall verdict.
   - Then provide:
     a. Industry standard alignment
     b. Code quality review
     c. Senior engineer concerns
     d. Priority fixes
     e. Long-term improvements
     f. What is already strong
   - Keep the review practical and actionable.

Rules:

- Prefer proven industry practices over novelty.
- Do not recommend changes that are not justified by the codebase.
- Optimize for maintainability, safety, and long-term team velocity.
- Be strict about quality, but separate issues that are cosmetic from those that affect delivery or reliability.
## 2026-06-11 - Critical Trading Engine Compliance & Best Practices

To avoid regressions and ensure compliance with exchange (Binance) behavior and internal standards, all agents must adhere to the following:

### 1. Binance Stop-Loss Order Mandatory Fallback
- **Pattern**: When placing `STOP_MARKET` orders, always include an explicit `quantity` parameter (formatted to the correct `LOT_SIZE` precision) even if `closePosition: true` is used.
- **Reason**: Certain symbols and API endpoints on Binance Futures reject orders missing the quantity, causing critical protection failures.
- **Compliance**: Verified in `OrderManagerService.placeStopLoss`.

### 2. Leverage Feature intentional Disablement
- **Pattern**: Do not attempt to re-enable or use automated leverage setting via `changeInitialLeverage`.
- **Reason**: This feature was intentionally disabled in June 2026 to prevent account/exchange synchronization issues that led to inconsistent trade states.
- **Audit**: `OrderManagerService.setLeverage` is a no-op; UI fields have been removed.

### 3. Robust Database Migration Discovery
- **Pattern**: Use the non-recursive glob `*.{ts,js}` for migrations in `AppModule.ts`.
- **Reason**: Complex nested globs (`**/*`) can fail in specific Node.js or Docker environments, leading to missing database columns and startup crashes.

### 4. UI/UX & A11Y Standards for Financial Data
- **Clarity**: Use explicit labels for risk (`Stop Distance (Live)` vs `Max Entry Risk`).
- **Responsive Flow**: Avoid absolute positioning for dynamic text (like timers) in compact layouts to prevent mobile overlaps.
- **Discoverability**: All critical metrics must have helper tooltips (`<Tooltip content="..." />`) to align with the user's mental model.

### 5. Gapless Stop-Loss Updates (Ratcheting)
- **Market Structure**: Per Binance API, `modifyOrder` is NOT supported for `STOP_MARKET`. All SL updates MUST use **Cancel-then-Replace**.
- **Constraint**: Attempting to place a second `closePosition: true` order while one exists will be rejected by Binance.
- **Rollback**: If the replacement SL fails, the system must attempt to re-place the OLD SL price (or the most conservative valid SL) to ensure the position remains protected.
- **Audit**: Verified in `OrderManagerService.updateStopLoss`.

### 7. Structural Trading Resilience (2026-06-21 Update)
- **Algo API**: The Algo Order API (CONDITIONAL) is the primary path for stop-loss protection. Standard `STOP_MARKET` with `closePosition: true` is used as a mandatory fallback if the Algo API is unsupported (-4120).
- **Protection Gaps**: `closeTrade` must attempt to close the position *before* canceling stop-losses, and must implement a 're-arm SL' rollback if the close order fails (e.g., due to illiquidity/PERCENT_PRICE).
- **Nuclear Bypass**: The Watchdog's 'Nuclear Option' must bypass the `close_blocked` attempt ceiling to ensure capital safety.
- **Risk Integrity**: Position sizing via `auto_scale_min_notional` must not exceed 3x the intended dollar risk.
- **SL Ratcheting**: Apply a minimum 0.01% price delta guard before replacing SL orders to minimize order-count rate limit pressure.
- **Close Attempts**: Automated closes (e.g. for PERCENT_PRICE rejections) use exponential backoff and a hard ceiling of 5 attempts. After the ceiling, the trade is marked `close_blocked` and requires manual intervention.
- **Stream Stability**: User Data Streams use a proactive 24-hour reconnect (at 23h 50m) to avoid silent disconnections and event loss.
- **Fill Price**: Extract fill price primarily via `cumQuote / executedQty` as `avgPrice` is deprecated by Binance.
- **Rate Limits**: The system tracks `X-MBX-ORDER-COUNT-10S/1M` headers. Entries and low-priority SL ratchets are throttled/blocked when approaching limits (80%/90%), while emergency closes always proceed.

### 8. Rate Limit & IP Reputation Compliance (2026-06-22 Update)
- **Centralized Throttling**: ALL Binance SDK `restAPI` calls must pass through the `BinanceRequestQueue` (Proxy-based). This enforces a mandatory 100ms inter-request delay and adaptive backoff starting at 70% weight usage.
- **Fail-Fast Lifecycle**: REST polling fallbacks for account state (balance/positions) are FORBIDDEN. If the User Data Stream (UDS) fails to initialize, the session must halt immediately to preserve IP reputation and prevent cascading bans.
- **WebSocket-First State**: Establish the account baseline (balance, active positions) EXACTLY ONCE via REST at session startup. All subsequent state tracking must rely on UDS `ACCOUNT_UPDATE` and `ORDER_TRADE_UPDATE` events.
- **Sequential Warmup**: Kline backfills must be performed sequentially (concurrency=1) with jittered delays (150-300ms) to avoid startup bursts that trigger immediate IP bans.
- **Ban Visibility**: Any IP ban (418) or severe rate limit (429) must be broadcast to the UI via `api_status` event and displayed with a high-visibility alert.

### 9. Live Market Data WebSocket — Endpoint & Resilience (2026-07-17)
- **Endpoint (LIVE)**: Market data MUST be subscribed via the newer `wss://fstream.binance.com/market/stream?streams=<s1>/<s2>/...` endpoint with streams embedded in the URL. The classic `wss://fstream.binance.com/stream` endpoint is **starved by Binance from many IP ranges** (handshake + `SUBSCRIBE` ACK succeed, but ZERO data frames arrive) and must NOT be used for live.
- **Subscription method**: On `/market/stream` the `SUBSCRIBE`/`UNSUBSCRIBE` request method is **NOT served** — streams must be passed as the `?streams=` URL param. (`BinanceSubscriptionManager` already no-ops the method when the URL contains `?streams=`.)
- **Testnet**: Keep `wss://fstream.binancefuture.com/stream` + `SUBSCRIBE` method (testnet serves the method and is not starved). Do NOT "align" testnet to live.
- **Diagnostic discipline**: When live WS delivers 0 frames while testnet works with identical code, the variable is the **HOST**, not the code. Before adding app-level fallback logic, verify the actual endpoint from the deployment's network: test `/market/stream?streams=...`, `/stream`, `/public/stream` directly. Browser-like headers do **NOT** unblock a starved endpoint — do not churn headers as a fix.
- **Reconnect storms**: Never reconnect a market WS in a tight loop. Use capped exponential backoff (5s -> 60s). A silent-stall reconnect every ~2 min reads as abusive to exchanges and risks IP bans. The stall watchdog / health-check must not force full session or manager restarts on every tick.
- **REST seed is a safety net, not streaming**: `seedMarketDataFromRest()` populates the TickerCache once at startup (weight 40, `ticker/24hr`). Keep it one-time / cache-empty-only — never poll periodically (per §8 no-REST-polling and IP-ban avoidance).
- **Batched `ACCOUNT_UPDATE` safety**: In any `for (const pos of data.a.P)` handler, use `continue` (not `return`) to skip a symbol mid-transition; a `return` drops every other symbol in the same batched event (can silently discard unrelated SL closures / quantity syncs).
- **Alert visibility**: Capital-at-risk transitions (`close_blocked`, `illiquid_blocked`) must emit `ENGINE_EVENTS.ALERT` (not only `LOG_MESSAGE`) so they surface in the UI alert banner.

### 10. Frontend Dev Connectivity & React Rules (2026-07-17)
- **Dev WebSocket protocol**: Derive the WS protocol from the page protocol (`ws` on http, `wss` on https) rather than hardcoding `wss`. In dev, `VITE_WS_URL` typically points at `ws://localhost:3000`; forcing `wss://localhost:3000` makes the browser fail the connection. A Vite `server.proxy` forwards `/session`, `/settings`, `/monitoring`, `/presets`, `/auth`, `/healthz` to the backend so the SPA stays same-origin (no CORS) in dev. Railway (static `vite build`) is unaffected.
- **Rules of Hooks**: Never call hooks (`useState`/`useEffect`/`useX`) after an early `return`. A component that returns `null` before its hooks run, then later renders with a different hook count, corrupts React's fiber and throws `Expected static flag was missing`. Move all hooks above any early return (see `DashboardView.GateBanner`).
- **Radix Dialog a11y**: Every `<Dialog.Content>` requires a `<Dialog.Title>`; add `<Dialog.Description>` or `aria-describedby={undefined}` to avoid the `Missing Description` warning. Audited in `DecisionLog`, `TradeDetailModal`, `ConfirmationModal`.
