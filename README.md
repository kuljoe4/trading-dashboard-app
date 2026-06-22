# Momentum Engine Trading Dashboard

Resource-lean momentum trading dashboard for Binance USDⓈ-M futures. The app is now a **Node/NestJS backend** plus a **React/Vite frontend**; it is WebSocket-first, paper-trading by default, and tuned to minimize CPU, memory, API weight, and browser/network egress.

> Trading risk: this project can place live exchange orders when configured for live mode. Start in paper or testnet mode, use least-privilege API keys, and validate strategy behavior before enabling real capital.

---

## Current Architecture

```text
backend/node/                         NestJS + TypeScript service
  src/server.ts                       HTTP server, security headers, CORS, /health, WS fan-out
  src/trading/                        REST controllers, settings, persisted sessions
  src/engine/
    market_feed.service.ts            Binance miniTicker + combined kline WebSockets
    ticker_cache.service.ts           In-memory latest price/volume cache
    kline_store.service.ts            Bounded per-symbol candle cache
    momentum_scanner.service.ts       Momentum opportunity scanner
    signalEngine.ts                   Entry/exit signal checks
    riskEngine.ts                     Position sizing and risk gates
    orderManager.ts                   Paper/testnet/live order handling
    positionTracker.ts                Active trade tracking and SL/TP checks
    trading_session.service.ts        Session orchestration and delta broadcasts
    monitoring.service.ts             Low-frequency runtime metrics
  Dockerfile                          Multi-stage production image

frontend/                             React 18 + Vite + Zustand
  src/api/client.js                   REST client and config allow-list
  src/store/trading.js                WebSocket state, delta merge, user preferences
  src/views/                          Dashboard, History, Settings, Strategy detail
  src/components/                     Scanner, active trades, analytics, config modal
  public/sw.js                        Service worker shell
  Dockerfile                          Static Nginx image with gzip/cache headers
```

---

## Lean Resource Profile

The default configuration favors the smallest practical footprint over maximum scan frequency:

| Area | Lean default | Why it matters |
|------|--------------|----------------|
| Global watchlist | `25` symbols | Reduces Binance kline streams, candle memory, scanner CPU, and browser updates. |
| Candle retention | `KLINE_MAX_CANDLES=200` | Caps memory per symbol/interval while preserving enough lookback for the bundled strategies. |
| Hot loop | `5000ms` | Lowers active-trade PnL/exit check CPU and WS tick churn. |
| Main loop | `15000ms` | Lowers scanner and entry-processing CPU. |
| Watchlist refresh | `120s` | Reduces top-volume recomputation and stream rebuild churn. |
| Monitoring samples | `10s` | Avoids frequent runtime syscalls. |
| Frontend log buffer | `500` rows | Bounds browser memory for long sessions. |
| Backend image | `NODE_OPTIONS=--max-old-space-size=256` | Keeps V8 heap growth contained in production containers. |

Existing runtime controls also help keep resource use low:

- **WebSocket-First state management**: REST is used strictly once at session startup to seed balance and position state. All subsequent updates rely on User Data Stream `ACCOUNT_UPDATE` and `ORDER_TRADE_UPDATE` events.
- **Aggressive REST Throttling**: All REST API calls pass through a centralized request queue with a mandatory 100ms delay and adaptive weight-based backoff to prevent IP bans.
- **Sequential Backfills**: Kline warming is performed symbol-by-symbol rather than in concurrent bursts.
- **Quiet ticks and delta payloads**: unchanged tick fields are omitted; analytics are sent on heartbeat or trade events rather than every loop.
- **Listener-aware ECO mode**: when no active client is listening and no positions are open, expensive loops are skipped/throttled.
- **View-based pruning**: dashboard clients receive thin tick/scanner payloads; focused trade views receive the heavier trade detail only when needed.
- **Client-side controls**: users can disable health metrics, streaming, or mark the tab inactive to reduce backend fan-out.
- **Static frontend serving**: the production frontend is served by Nginx with gzip and immutable asset cache headers.

### Performance vs. Lean Trade-offs

For faster exit monitoring or more aggressive scanning, raise these fields in the strategy config:

```json
{
  "watchlist_size": 50,
  "hot_loop_interval_ms": 2000,
  "main_loop_interval_ms": 15000
}
```

For the leanest deployments, keep defaults and prefer explicit `symbols` or a small `single_symbol_configs` list instead of a broad global scanner.

---

## Data Flow

1. The backend opens Binance futures WebSockets for `!miniTicker@arr` and combined `<symbol>@kline_<interval>` streams.
2. `TickerCacheService` stores latest price and 24h volume in memory.
3. `KlineStoreService` stores bounded OHLCV candles per watched symbol/interval.
4. `MomentumScannerService` ranks qualifying symbols by momentum, volatility, trend, and volume filters.
5. `SignalEngineService` confirms entries/exits based on enabled signals.
6. `RiskEngineService` sizes orders and blocks entries that violate risk gates.
7. `TradingSessionService` tracks positions and broadcasts compact deltas to connected clients.
8. The frontend merges deltas in Zustand and renders dashboard/history/settings views.

---

## Setup

### Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL for persisted sessions/settings in production-like environments
- Binance futures API keys for testnet/live trading; not required for basic frontend/backend development in paper mode

### Backend

```bash
cd backend/node
npm ci
npm run build
npm start
```

Development mode:

```bash
cd backend/node
npm ci
npm run dev
```

Backend defaults to port `3000`. Health check: `http://localhost:3000/health`.

### Frontend

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`.

### Environment Variables

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `PORT` | backend/frontend containers | backend: `3000`, frontend image: platform-provided or `80` | HTTP listen port. |
| `NODE_ENV` | backend | development unless set by deployment | Enables production-only hardening such as HSTS. |
| `ALLOWED_ORIGINS` | backend | localhost + deployed Railway origins | Comma-separated allowed browser origins. |
| `ADMIN_API_KEY` | backend | unset | Optional key required by REST guard and WebSocket token validation when set. |
| `VITE_API_URL` | frontend build | localhost backend in dev, same-origin otherwise | REST API base URL. |
| `VITE_WS_URL` | frontend build | derived from current host | WebSocket URL; `/session/ws` is appended if omitted. |
| `VITE_ADMIN_API_KEY` | frontend build | unset | Adds `X-API-Key` and WS token for protected deployments. |
| `KLINE_MAX_CANDLES` | backend | `200` | Per symbol/interval candle retention, clamped between `50` and `500`. |
| `NODE_OPTIONS` | backend container | `--max-old-space-size=256` | Production V8 heap cap. |

---

## API and WebSocket Surface

### REST

Base path: `/session`

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/session/start` | Start a paper/testnet/live trading session. |
| `POST` | `/session/stop` | Stop the active session. |
| `POST` | `/session/pause` | Pause or resume entries. |
| `GET` | `/session/status` | Current session snapshot. |
| `GET` | `/session/list` | Persisted sessions. |
| `PATCH` | `/session/:id` | Update a stored session config. |
| `DELETE` | `/session/:id` | Delete a stored session. |
| `GET` | `/session/history` | Trade history. |
| `GET` | `/session/analytics` | Current-session analytics. |
| `GET` | `/session/lifetime-analytics?mode=paper` | Lifetime analytics by mode. |
| `POST` | `/session/trade/:symbol/close` | Manually close an active trade. |
| `POST` | `/session/reset-paper-balance` | Reset paper balance. |
| `GET` | `/session/binance/rate-limit` | Last observed Binance request weight. |

### WebSocket

Path: `/session/ws`

Client control messages:

| Message | Effect |
|---------|--------|
| `{ "type": "set_active", "active": false }` | Suppresses high-frequency fan-out for inactive/background clients. |
| `{ "type": "set_monitoring", "enabled": false }` | Disables monitoring payloads for that client and can suppress backend sampling when no clients need metrics. |
| `{ "type": "set_log_filters", "filters": { "info": true, "warn": true, "error": true } }` | Filters log fan-out by severity. |
| `{ "type": "set_focus_mode", "enabled": true, "tradeId": "..." }` | Requests focused trade detail and skips scanner fan-out. |

---

## Strategy Config Reference

Common fields:

| Field | Lean default | Description |
|-------|--------------|-------------|
| `paper_mode` | `true` | Simulate fills unless testnet/live mode is configured. |
| `trading_mode` | `paper` | `paper`, `testnet`, or `live`. |
| `global_scanner_enabled` | `true` | Enable top-volume scanner. Disable for symbol-only operation. |
| `symbols` | `[]` | Explicit scan symbols; avoids top-volume sorting when provided. |
| `single_symbol_configs` | `[]` | Per-symbol monitors with optional custom config. |
| `watchlist_size` | `25` | Number of top-volume symbols watched when `symbols` is empty. |
| `scan_interval` | `5m` | Kline interval for momentum scan. |
| `scan_lookback` | `3` | Number of candles back for momentum calculation. |
| `scan_pct_threshold` | `2.0` | Minimum absolute momentum percentage. |
| `scan_min_volume_usdt` | `500000` | Minimum 24h quote volume. |
| `entry_side` | `both` | `both`, `long`, or `short`. |
| `enabled_signals` | `["momentum_pct"]` | Entry signal list. |
| `signal_logic` | `all` | `all` or `any` signal matching. |
| `sl_type` | `pct` | Percent stop loss or structural lookback stop. |
| `sl_distance_pct` | `0.8` | Percent stop distance when `sl_type=pct`. |
| `tp_mode` | `fixed` | Fixed TP or RR-sequence mode. |
| `tp_ratio` | `2.0` | TP distance relative to stop distance. |
| `risk_pct_per_trade` | `1.0` | Account risk per trade. |
| `max_open_trades` | `5` | Global concurrent position limit. |
| `max_open_trades_per_symbol` | `1` | Per-symbol concurrent position limit. |
| `max_total_risk_pct` | `5.0` | Aggregate open risk cap. |
| `total_sl_guard_usdt` | `200` | Stop entering after session stop-loss usage reaches this amount. |
| `hot_loop_interval_ms` | `5000` | Exit/PnL/tick loop cadence. Lower is faster but heavier. |
| `main_loop_interval_ms` | `15000` | Scanner/entry loop cadence. Lower is faster but heavier. |
| `debug_mode` | `false` | Enables verbose/debug logging. Keep disabled in lean deployments. |

---

## Risk Formula

```text
qty = (balance × risk_pct_per_trade) / (entry_price × sl_distance_pct)
```

The engine sizes positions by stop-loss distance so the intended dollar risk stays consistent. Tighter stops produce larger notional positions; wider stops produce smaller notional positions. Additional risk gates cap concurrent trades, per-symbol exposure, aggregate risk, and session stop-loss usage.

---

## Docker

Build backend:

```bash
docker build -t momentum-engine-backend ./backend/node
docker run --rm -p 3000:3000 -e PORT=3000 momentum-engine-backend
```

Build frontend:

```bash
docker build -t momentum-engine-frontend ./frontend
docker run --rm -p 8080:80 -e PORT=80 momentum-engine-frontend
```

The backend image installs production dependencies in a separate stage, runs as the non-root `node` user, and caps V8 heap by default. The frontend image serves static files through Nginx with gzip and long-lived cache headers for hashed assets.

---

## Testing

Backend:

```bash
cd backend/node
npm test
npm run build
```

Frontend:

```bash
cd frontend
npm test
npm run build
```

---

## Operational Notes

- Keep `debug_mode=false`; the production frontend does not ship an Eruda debug chunk.
- Prefer `symbols` or a small `single_symbol_configs` set for ultra-low resource deployments.
- Disable health metrics from the UI if you do not need runtime charts.
- Use `ALLOWED_ORIGINS` and `ADMIN_API_KEY` outside local development.
- Use testnet keys before live mode and monitor exchange API weight through the rate-limit endpoint.
