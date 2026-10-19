# Implementation Plan - Graceful Ban / Geo-Restriction Fallback (HTTP 451)

Prevent backend server crashes when encountering Binance HTTP 451 geo-restrictions or IP bans, allowing local backend operations, WebSocket communication, and UI navigation to function normally while halting external Binance requests and disabling trading actions in the UI.

## Proposed Changes

### Backend (`backend/node/src/`)

#### 1. `binanceClientFactory.ts` & `binanceRequestQueue.ts`
- **Graceful Error Handling for 451 / Ban**: Catch HTTP 451 ("Service unavailable from a restricted location") and ban errors (`418`, `429`) without calling `process.exit()` or entering fatal terminal crashes that stop the NestJS container.
- **Safe Offline Mode**: Enter a persistent "Banned / Restricted" state in `BinanceRequestQueue` that immediately rejects outbound Binance REST/WS requests with a clean error (`IP banned or geo-restricted`), while keeping the NestJS server, controllers, REST endpoints (`/session/...`, `/settings/...`, `/presets`), and local WebSocket server running.
- **Automatic Cooldown**: Set a generous cooldown period (e.g., 24 hours or until manually cleared via `/session/clear-ban`) during which outbound requests to Binance are suppressed.

#### 2. `session.service.ts` / `market_feed.service.ts`
- **Startup Resilience**: Catch startup initialization errors (like `getServerTime` or exchange info fetch returning HTTP 451) during module init. Log a clear warning and enter offline/degraded mode instead of crashing the application or halting NestJS startup.

### Frontend (`frontend/src/`)

#### 1. `trading.js` (Zustand Store) & `DashboardView.jsx`
- **Ban Status Polling / WebSocket**: Ensure `apiStatus` correctly reflects `isBanned: true` and `lastErrorMessage` when an HTTP 451 or ban occurs.
- **Ban Banner Display**: Ensure `BanBanner` prominently displays the restriction message, countdown timer, and an active **Unlock** button.
- **Disable Trading Actions**: Automatically disable order placement, strategy start, and execution controls when `apiStatus.isBanned` is true, while keeping navigation, settings, history view, and local app state fully interactive.

## Verification Plan

### Automated Tests
- Run backend unit tests (`jest`) to verify `BinanceRequestQueue` handles HTTP 451 and ban status gracefully without throwing fatal crashes.
- Compile applet with `compile_applet`.

### Manual Verification
- Verify that startup with geo-restriction logs a warning instead of exiting.
- Verify that local backend routes and WebSockets remain responsive.
- Verify that the Ban Banner appears in the UI and disables trading actions correctly.
