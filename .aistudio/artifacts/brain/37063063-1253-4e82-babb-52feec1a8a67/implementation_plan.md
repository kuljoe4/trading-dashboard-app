# Watchlist, Scanner & Multi-Strategy Full-Stack Integrity Audit Plan (Revised)

## Overall Verdict
Analysis of the runtime logs confirms the exact root causes of the reported symptoms:
1. **Persistent "Awaiting Signal" & Empty Scanners**: Candle buffer warmup was incomplete for multi-timeframe strategies (e.g., 5m/15m/4h). The signal engine requires 50 historical candles for indicator convergence (EMA dual cross, Supertrend, ATR); without pre-fetching, candidates stalled at 1/50 candles in persistent "AWAITING" state.
2. **Variant Watchlists Restricted to Base Limits**: In `market_feed.service.ts` (line 713), the condition `sc.discovery_mode && (sc.discovery_mode !== config.discovery_mode || ...)` failed whenever a variant inherited the default discovery mode or omitted `discovery_mode`. This caused variant candidate discovery to bypass custom `watchlist_size` and fall back to base strategy symbols.
3. **Misleading Discovery Mode Tabs**: The client-side discovery tabs in `ScannerOverlay.jsx` attempted to sort an already-sliced list of 15 items, showing no visible difference and confusing the operator.
4. **Gated / Max Trades Paused Scanning**: When "5m top mart long" reached its 1-trade limit, gating engaged (`max_trades`), pausing scanner updates without clear contextual feedback.
5. **API Rate Weight Surges (85.6%)**: Uncoordinated concurrent kline requests and REST polls caused weight spikes approaching Binance limits (2054/2400).

---

## Senior Engineer & Industry Standards Review

### a. Industry Standard Alignment
- **Pre-Emptive Warmup in Quant Trading Engines**: Institutional market scanners must never evaluate live signals against unconverged cold buffers. Candidates entering the active watchlist must have historical klines pre-fetched sequentially through a throttled queue before being passed to technical evaluation.
- **Strict Strategy Partitioning**: Multi-strategy engines must maintain total independence between strategy containers. Variant strategies specifying custom watchlist sizes (e.g. 20, 50) or discovery criteria must independently populate their candidate lists without being capped or clipped by base strategy parameters.
- **Truthful UI State Representation**: A UI control labeled "Discovery Mode" must trigger an actual backend discovery re-scan rather than a client-side sort of a truncated 15-item array.

### b. Code Quality Review
- **Confirmed Vulnerability - Incomplete Discovery Logic**: In `market_feed.service.ts` line 713, the discovery branch condition `if (sc.discovery_mode && ...)` failed to execute when `sc.discovery_mode` was undefined on the variant, causing `scSymbols` to default to the base strategy's symbols and watchlist size.
- **Confirmed Vulnerability - Missing Multi-Interval Pre-Fetch**: When a variant or base strategy specified non-1m timeframes (`5m`, `15m`, `4h`), candles were only accumulated as live 1m ticks arrived, taking hours to reach the 50-candle warmup threshold.
- **Confirmed Vulnerability - Slicing Redundancy**: In `ScannerOverlay.jsx`, `discoveryMode` filtering sliced already-truncated data, creating dead UI states.
- **Confirmed Vulnerability - Gated Opacity**: Gating reasons were emitted to logs but lacked clear dedicated pause status banners in the scanner overlay.

### c. Senior Engineer Concerns
1. **API Ban Risk from Warmup Bursts**: Pre-fetching candles for multiple symbols across multiple timeframes must strictly utilize the existing `BinanceRequestQueue` with 150–300ms jittered delays to prevent IP bans.
2. **False Empty States**: Displaying a spinning loader or blank table when a strategy is simply at max capacity confuses the operator into thinking the scanner crashed.

### d. Priority Fixes
1. **Sequential Multi-Timeframe Pre-Fetch**: In `MarketFeedService`, when symbols enter the watchlist for a strategy with timeframe $T \neq \text{1m}$, sequentially pre-fetch 50 historical candles via the throttled queue so signals converge immediately.
2. **Fix Variant Watchlist Resolution**: Update `market_feed.service.ts` and `momentum_scanner.service.ts` so variants evaluate their own `watchlist_size` and `discovery_mode` regardless of whether `discovery_mode` matches the base strategy.
3. **Engine-Level Discovery Mode & Redundancy Removal**: Remove the cosmetic client-side discovery sorting tabs from `ScannerOverlay.jsx`. Implement real strategy-level discovery switching that re-runs the scanner in the engine.
4. **Dedicated Gated & Pause Status Banners**: Replace blank/loading scanner screens with informative status banners when a strategy is gated (e.g. "Strategy max open trades (1/1) reached — scanning paused until position closes").
5. **In-Overlay Strategy Switcher & Timeframe Badges**: Add clean tabs in `ScannerOverlay.jsx` showing the base strategy and all active variants, each displaying its scan timeframe, signal depth, and open capacity.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The user confirmed the following decisions in Turn 3:
> - **Multi-Timeframe Warmup**: Pre-fetch historical candles for all active strategy timeframes sequentially.
> - **Discovery Controls**: Remove misleading client-side sort and trigger engine discovery re-scan.
> - **Gated Strategy Display**: Pause scanning for gated strategies until a trade slot opens, with explicit status indicators.

---

## 1. Overview & Core Concept
Achieve complete end-to-end reliability for multi-timeframe base and variant strategy scanning:
- Pre-warm candle history so indicators (EMA dual cross, Supertrend) fire without multi-hour delays.
- Decouple variant watchlist discovery so variants scan their full configured watchlist size.
- Clean, non-redundant Scanner UI with zero-pill strategy tabs, real engine discovery mode controls, and clear gating explanations.

---

## 2. User Experience & Visual Design
- **Clean In-Overlay Strategy Tabs**: Segmented controls at the top of `ScannerOverlay.jsx`:
  - `[ Momentum Strategy · 1m (Active) ]`
  - `[ 5m Top Mart Long · 5m (1/1 Max Trades) ]`
- **Gated / Paused Banner**: When a selected strategy is gated or paused, render a clean banner:
  - *"Scanning Paused: Max open trades (1) reached for '5m top mart long'. Resumes automatically when trade closes."*
- **Active Engine Discovery Selector**: Dropdown or buttons that trigger genuine backend discovery mode switching (`Volume Rank`, `24h Change %`, `Absolute Volatility`).
- **Telemetry & Freshness**: Timeframe badge (e.g. `1m`, `5m`, `15m`), candle buffer readiness gauge, and live tick freshness dot.

---

## 3. Key Product Decisions & Trade-Offs
- **Decision 1: Sequential Warmup vs. Concurrent Burst**:
  - *Chosen Approach*: Sequential queueing with 150-300ms jitter.
  - *Why*: User logs showed rate limit spikes to 85.6%. Concurrency would trigger 429/418 bans.
- **Decision 2: Clear Pause vs. Background Scanning**:
  - *Chosen Approach*: Explicitly pause scanning for gated strategies and display clear status.
  - *Why*: Prevents wasted API weight on candidates that cannot be traded, aligning with user preference.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Market Feed & Discovery                         │
│   - Base Strategy Discovery (Watchlist Size: N, Mode: M1)              │
│   - Variant Strategy Discovery (Independent Size: K, Mode: M2)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│           Sequential Multi-Timeframe Pre-Fetch (BinanceRequestQueue)   │
│   - For each candidate symbol: Ensure 50 candles for Scan Interval     │
│   - 150-300ms Jittered Inter-Request Delay (Keeps Weight < 70%)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     SignalEngine & Gating Audit                        │
│   - Active Strategies: Evaluate signals with converged 50-candle buffer│
│   - Gated Strategies (max_trades): Mark paused, halt candidate search  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│             WebSocket & getStatus REST Synchronization                 │
│   - Emits { scannerResults, variant_opportunities, strategy_gate_states│
│   - Ingested symmetrically in Zustand store on both status & scanner   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Revamped ScannerOverlay UI                        │
│   - Direct Strategy Switcher Tabs (Base + Variants)                    │
│   - Real Engine Discovery Selector (Triggers backend re-scan)          │
│   - Gated Pause Explanatory Banner (No mysterious empty/loading states)│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Verification & Testing Plan
- **Backend Tests**:
  - Verify variant watchlist discovery with custom `watchlist_size` and `discovery_mode`.
  - Verify candle buffer warmup pre-fetching without rate surge warnings.
  - Verify `getStatus` delivers full multi-variant scanner data.
- **Frontend Tests**:
  - Verify `variantScannerResults` isolation and strategy tab switching in `ScannerOverlay.jsx`.
  - Verify gated banner rendering when strategy reaches `max_trades`.
  - Run `pnpm test` and `compile_applet`.
