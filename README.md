# Momentum Engine

Capitalise.ai-style momentum trading bot — Binance WebSocket-first, stop-loss distance position sizing, resource-lean.

---

## Architecture

```
backend/                  FastAPI + asyncio
  app/
    engine/
      market_feed.py      Manages all WS streams (miniTicker + klines)
      ticker_cache.py     In-memory all-symbol price state
      kline_store.py      Per-symbol OHLCV deque (WS + one-time REST backfill)
      momentum_scanner.py % change over configurable interval, no REST polling
      signal_engine.py    Breakout confirmation check
      risk_engine.py      SL-distance position sizing
      order_manager.py    Paper + live order placement
      position_tracker.py 1s async loop — SL/TP monitoring
      trading_session.py  Orchestrates all modules
      session_registry.py In-memory session store
    api/                  FastAPI routers (session, scanner, trades)
    ws/                   WebSocket broadcaster
    models/               SessionConfig, Trade

frontend/                 React 18 + Vite + Zustand
  src/
    store/trading.js      Zustand state
    hooks/useEngineSocket.js  WS client with auto-reconnect
    views/                Dashboard, Scanner, History, Config
    components/           TopBar, NavBar, ActiveTradeCard, DecisionLog
```

---

## WebSocket Streams Used

| Stream | Purpose |
|--------|---------|
| `!miniTicker@arr` | All USDT perp prices + 24h data (~1s) |
| `<sym>@kline_<tf>` | OHLCV candles for top-50 symbols by volume |
| `userDataStream` | Fill confirmations (live mode) |

REST is used for: balance fetch (session start), kline backfill (once per symbol), order placement only.

---

## Setup

### Prerequisites
- Python 3.11+
- Node 18+
- PostgreSQL (or SQLite for dev)

### Backend

```bash
cd backend
cp .env.example .env
# Fill in BINANCE_API_KEY and BINANCE_SECRET_KEY (testnet keys to start)

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## Risk Formula

```
qty = (balance × risk_pct_per_trade) / (entry_price × sl_distance_pct)
```

Position size is automatically scaled by stop distance. Tighter stop → larger position (same dollar risk). Wider stop → smaller position. Hard cap at 20% notional of leveraged balance.

---

## Config Reference

| Field | Default | Description |
|-------|---------|-------------|
| `scan_interval` | `5m` | Kline interval for % change window |
| `scan_lookback` | `3` | Candles back to measure move |
| `scan_pct_threshold` | `2.0` | Min % move to qualify |
| `sl_distance_pct` | `0.8` | SL as % of entry (drives sizing) |
| `risk_pct_per_trade` | `1.0` | % of balance at risk per trade |
| `tp_ratio` | `2.0` | TP = entry ± (sl_dist × tp_ratio) |
| `max_open_trades` | `5` | Max concurrent positions |
| `total_sl_guard_usdt` | `200` | Stop entering after this session SL loss |
| `paper_mode` | `true` | Simulate fills, no real orders |

---

## Extending

- **Auth**: Replace hardcoded `USER_ID = "default"` in routers with JWT middleware
- **DB persistence**: Add SQLModel queries to save trades in `_close_trade()`  
- **userDataStream**: Wire live fill confirmations in `market_feed.py` for production
- **Multi-strategy**: `SessionRegistry` already keyed by user_id — extend to strategy_id
