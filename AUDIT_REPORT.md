# Momentum Engine - Performance & Architecture Audit (May 2026)

## 1. Data Transmission Audit (Network Egress)
The system is designed for high-frequency trading while maintaining a lean network footprint for remote dashboard monitoring.

| Category | Source | Type | Frequency | Est. Size | Optimization Strategy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Market Data Ingestion** | Binance WS | Inbound | ~100ms | 200B - 5KB | **ECO-MODE:** MiniTicker stream processing is suppressed when no trades are active and no UI is connected. |
| **Real-time Ticks** | Backend WS | Outbound | 1s - 10s | 400B - 2KB | **Delta Updates:** Only changed fields are sent. **View-Pruning:** Background tabs receive minimal data; non-focused strategies are "thinned". |
| **Market Scanner** | Backend WS | Outbound | 15s | 1KB - 8KB | **Hybrid Egress:** Full sparkline history sent only every 30s. Delta updates include only price/momentum changes for top 5 symbols. |
| **Decision Logs** | Backend WS | Outbound | Event | 150B | **Level Filtering:** Server-side suppression based on client preference (info/warn/error). |
| **Analytics & Sync** | REST / WS | Hybrid | Demand | 15KB - 40KB | **Downsampling:** Cumulative PnL curves are capped to 500 data points to prevent linear egress growth over years of data. |

## 2. Calculation & CPU Audit
CPU usage is dominated by data parsing and signal evaluation.

| Module | Core Logic | Complexity | Frequency | Optimization |
| :--- | :--- | :--- | :--- | :--- |
| **Data Ingestion** | `JSON.parse` + Upsert | O(N) | Continuous | **Buffer Parsing:** Direct binary parsing in Node 20+ avoids string allocation overhead. |
| **Momentum Scanner**| Signal Evaluation | O(S * L) | 15s | **Momentum Gating:** Early return for "quiet" symbols avoids expensive technical analysis (volatility/trend). |
| **Risk Engine** | Gating Logic | O(T_window)| On Entry | **Single-Pass Loops:** Replaces multiple `filter/reduce` calls with a single manual loop over trade history. |
| **Position Tracker** | SL/TP/Signal Check| O(A) | 1s | **Synchronous Iteration:** Uses direct Map values to avoid array allocations in the hot loop. |
| **Analytics Service**| Equity/DD Calc | O(T_total) | On Close | **Lazy Caching:** Statistics are cached until the next trade closure. |

*S = Watchlist Size (~50), L = Lookback (~20), A = Active Trades (<10), T = Trade History*

## 3. Memory Audit (Backend Heap)
Memory usage is strictly capped to ensure stability in low-resource environments (e.g., Railway Starter/Pro).

| Store | Data Structure | Capacity | Est. Footprint | Retention Policy |
| :--- | :--- | :--- | :--- | :--- |
| **KlineStore** | `Map<string, Candle[]>` | 200-500/key | ~6.5MB | O(1) pruning via `shift()` on every new candle. |
| **TickerCache** | `Map<string, Ticker>` | ~500 entries | ~1.2MB | **Object Reuse:** Existing objects are mutated in-place to prevent GC pressure. |
| **TradingSession**| `closedTrades[]` | 1000 trades | ~2.5MB | In-memory cap for rapid metrics; older data accessible via DB. |
| **Broadcaster** | String Cache | 1 JSON string | <100KB | Reused across all concurrent WS clients per broadcast tick. |

## 4. Frontend Resilience & Performance
The React dashboard (Vite + Zustand) is optimized for long-running sessions (weeks of uptime).

- **Local State Preservation:** Frontend merges partial WS updates (`_thin`, `_delta`) with full historical state to prevent UI flickering or `NaN` displays.
- **Log Capping:** In-memory decision log is capped to 500 lines to prevent browser tab sluggishness.
- **Throttled Rendering:** Scanner and Ticker updates are throttled to 200ms-500ms to maintain 60fps UI responsiveness even during market volatility.
- **Visibility Optimization:** Background tabs send a `set_active: false` signal, pausing all non-critical UI updates and reducing CPU/Network usage to near-zero.
