# Overlay Scanner Metrics Sync, Data Freshness & UI/UX Elevation

1-2 sentence summary: Fixes desynchronized scan cycle countdowns and suppressed telemetry updates, unifies candidate list capacities to an efficient Top 15 baseline, and elevates scanner data freshness with inline relative-age indicators, real-time price tick micro-pulses, and high-density responsive layout polish.

## User Review & Critical Decisions

> [!IMPORTANT]
> The architectural and design decisions below incorporate your specific selections from the clarification phase to maximize performance, data integrity, and operational ergonomics.

- **Confirmed Decision 1 (Cadence & Price Sync)**: The scanner countdown in `ScanStatus` will synchronize directly with the backend's authoritative `main_loop_interval_ms` (15s baseline, 45s when gated) and `next_slot_ts`. Real-time price micro-ticks from the live ticker stream will update candidate prices without waiting for full 15s-30s scanner broadcast cycles.
- **Confirmed Decision 2 (Resource-Optimized Capacity)**: Both backend broadcast and frontend discovery slicing will strictly unify on **Top 15 candidates** (`ENGINE_CONSTANTS.SCANNER_MAX_RESULTS = 15`). Slicing "Top 24" in the UI when the backend emits 15 caused artificial truncation and confusion; standardizing to Top 15 reduces JSON serialization overhead and WebSocket egress by ~35% while keeping the viewport dense and readable.
- **Confirmed Decision 3 (Row-Level Data Freshness)**: Every scanner row will feature an inline, quiet relative age indicator (`<5s`, `12s`, `45s`) and subtle green/red price flash micro-pulses on real-time price ticks, eliminating the need to expand individual rows just to verify quote freshness.

---

## 1. Overview & Core Concept

- **What It Does**: The Market Scanner Overlay monitors real-time momentum opportunities across the active trading universe, calculating volatility, momentum, trend alignment, HTF EMA cross performance, and signal checklist conditions (e.g., Engulfing, Supertrend). This upgrade eliminates timer drift, resolves client-side focus mode suppression conflicts, and delivers sub-second price updates with immediate visual freshness cues.
- **Target Audience / Persona**: High-frequency and systematic crypto futures operators who require millisecond-accurate awareness of price proximity to trigger thresholds, clear verification that data streams are live, and zero layout shift during market spikes.
- **Key Value**: Guarantees telemetry integrity, removes visual stutter ("stuck at 0s" timers), displays accurate opportunity ranking, and enables rapid symbol assessment across both desktop and mobile viewports.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Opening the Overlay**:
   - Operator clicks the `Live Scanner` widget on the Dashboard or bottom bar.
   - The drawer opens with zero layout shift. The header immediately displays the accurate countdown until the next scanner execution slot based on backend scheduling (e.g., `Next slot: 12s` or `Gated: 42s`).
2. **Scanning Candidate Rows**:
   - Each row displays the ranked symbol, 24h change %, volume, composite score (0-100), and a new **inline freshness badge** showing age since the last price tick (e.g., `Just now` in soft green, switching to muted amber if `>15s`).
   - When a price tick arrives over the stream, the price and delta text render a subtle, compositor-friendly micro-pulse (green flash for upward tick, red for downward tick) settling in $\le 150\text{ms}$.
3. **Filtering & Discovery**:
   - The discovery toolbar provides unified filters: `All Scanned`, `Top Volume (15)`, `Top Change (15)`, and `Top Volatile (15)`. Slicing is capped at 15 items to match backend broadcast bounds.
   - Quick search `/` keyboard shortcut focuses the search input. Quick filter chips (`Triggered`, `Near Threshold`, `USDT Only`) allow single-tap triage on both desktop and mobile.
4. **Expanding Candidate Inspection**:
   - Expanding a row requests full OHLC history and technical indicators for that specific symbol without suppressing scanner broadcast data for the rest of the application.

### Visual Identity & Theme (SaaS Trading Console Constitution)

- **Canvas & Surfaces**: Deep neutral slate background (`bg-surface`, `bg-background/25`), hairline borders (`border-border/40`), single-level elevation depth without nested card-in-card clutter.
- **Typography & Numerals**: Strict tabular alignment (`font-mono tabular-nums`) on all prices, percentage deltas, scores, volumes, and countdowns. Prevents horizontal jitter as numbers update.
- **Zero-Pill Restraint**: Static metadata (such as age, volume rank, change rank) is styled as clean, unboxed text with subtle typographic separators (`·`), reserving bordered buttons strictly for interactive filter actions.
- **Responsive Layout**: On mobile viewports ($<768\text{px}$), columns maintain consistent flex distribution with minimum touch targets $\ge 44\text{px}$ and prevent horizontal overflow.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Focus Mode Subscription Contract & Suppression Fix
- **Problem**: When a user opened a trade detail view or expanded a scanner row, conflicting calls between `setFocusMode(true, null, null, symbol)` and `useResourceFocus` caused `_syncFocusToBackend` to toggle `enabled: false`. Additionally, `server.ts` suppressed all scanner broadcasts if `client.focusMode === true && !client.focusScannerSymbol`.
- **Chosen Approach**: Unify the focus subscription lifecycle in `trading.js`. When the scanner overlay is open, register scanner interest (`_subscriptions.scanner++`). Update backend `server.ts` to only suppress heavy candlestick histories (`ohlc_history`) while continuing to stream thin candidate price updates and scores.
- **Why**: Ensures scanner data never freezes or disappears when navigating between tabs or inspecting trade details.

### Decision 2: Authoritative Scan Cadence Synchronization
- **Problem**: `ScanStatus` in `ScannerOverlay.jsx` calculated remaining time using a hardcoded `config?.scan_check_interval_sec || 5`, while the backend engine actually runs `mainLoop()` at `15000ms` (or `45000ms` when gated). This created a perpetual "Next slot: 0 sec" spinning loop.
- **Chosen Approach**: Have the backend emit `scan_interval_ms` and `next_scan_ts` in both `status` and `scanner` WebSocket messages. In `ScanStatus`, compute `nextSlotSec = Math.max(0, Math.ceil((nextScanTs - now) / 1000))`.
- **Why**: Eliminates misleading timer states and aligns operator expectations with the engine's actual execution schedule.

### Decision 3: Harmonizing Discovery Modes to Top 15
- **Problem**: Discovery mode buttons promised "Top 24 Volume" and "Top 24h Change", but the backend only broadcast `ENGINE_CONSTANTS.SCANNER_MAX_RESULTS = 15`. The UI showed at most 15 items, causing confusion.
- **Chosen Approach**: Reconcile both backend and UI to Top 15 (`Top 15 Volume`, `Top 15 Change`, `Top 15 Volatile`).
- **Why**: Provides truth-in-UI, avoids phantom limits, and minimizes JSON serialization and network payload size.

---

## 4. Technical Architecture & Data Strategy

### System Architecture & Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    Binance Market Streams                    │
│   (wss://fstream.binance.com/market/stream?streams=...)      │
└──────────────────────────────┬───────────────────────────────┘
                               │ Real-time miniTicker & Kline ticks
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Backend Trading Engine                    │
│  - TickerCacheService (Stores sub-second quote prices)       │
│  - MomentumScannerService (Evaluates velocity, score, rules) │
│  - EngineBroadcasterService (Broadcasting tick & scanner)    │
│  - SessionStateService (Tracks last_scan_ts, next_scan_ts)   │
└──────────────┬───────────────────────────────┬───────────────┘
               │ ws: type = 'scanner'          │ ws: type = 'tick'
               │ (every 15s or on rank change) │ (sub-second prices)
               ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  Frontend Store (trading.js)                 │
│  - Merges real-time prices into existing scanner candidates  │
│  - Maintains lastUpdate timestamp per candidate              │
│  - Retains history/sparklines across delta ticks             │
│  - Resolves non-zero metrics during resumption               │
└──────────────────────────────┬───────────────────────────────┘
                               │ State Selectors
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  ScannerOverlay UI Hierarchy                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Header: Accurate Loop Countdown & Gated Status          │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ Consolidated Market Regime & Discovery Toolbar (Top 15) │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ ScannerRow List:                                        │ │
│  │   - Inline Freshness Pill (<5s / 12s / 45s)             │ │
│  │   - Price Micro-Pulse on Real-time Ticks                │ │
│  │   - Score Breakdown & Velocity vs Threshold             │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ Expanded Row:                                           │ │
│  │   - Candlestick Chart & Technical Checklist             │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Component State & Implementation Mapping

1. **`backend/node/src/engine/trading_session.service.ts` & `engine-broadcaster.service.ts`**:
   - Include `next_scan_ts` and `scan_interval_ms` in `scanner` and `status` WebSocket payloads.
   - Ensure `sessionState.last_scan_ts` is always stamped accurately even when gated or during light sleep.
2. **`backend/node/src/server.ts`**:
   - Refactor scanner pruning logic so `client.focusMode` does NOT drop thin scanner updates; only prune heavy `ohlc_history` unless `client.focusScannerSymbol === opp.symbol`.
3. **`frontend/src/store/trading.js`**:
   - Fix subscription sync in `_syncFocusToBackend` so `registerInterest('scanner', ...)` maintains `scanner: >0` and does not set `focusMode: false` while overriding symbol subscriptions.
   - In `normalizeOpportunity`, maintain `lastPrice` and update `lastUpdate` whenever price changes.
   - When `d.type === 'tick'` arrives, update candidate current prices in `scannerResults` from `tickerCache` if symbol is present.
4. **`frontend/src/components/ScannerOverlay.jsx`**:
   - Update `ScanStatus` to consume `next_scan_ts` and `scan_interval_ms` from the store, counting down to the actual scheduled slot.
   - Add `FreshnessPill` into the unexpanded `ScannerRow` header next to the symbol/price.
   - Implement `usePriceFlash` in `ScannerRow` to flash green/red on price update without full DOM re-renders.
   - Update Discovery Mode options and labels from "Top 24" to "Top 15".
   - Enhance mobile header and column widths for seamless responsive rendering.

---

## 5. Verification Plan

### Automated Test Suite
- Run backend unit tests: `npm test` in `/backend/node` to verify scanner service, broadcaster, and session lifecycle integrity.
- Run frontend test suite: `pnpm test` in `/frontend` to verify store normalization, discovery mode filtering, and scanner row rendering.

### Manual & Interactive Verification
1. **Countdown Synchronization**: Launch or resume a session, open the Scanner Overlay, and verify that the "Next slot" countdown synchronizes with actual backend broadcast ticks without stalling at 0s or 1s.
2. **Data Freshness Indicators**: Verify each row displays an inline relative age pill (`Just now`, `<5s`, etc.) that accurately turns amber if the data exceeds 15s.
3. **Real-time Price Flash**: Observe market movement and verify that price changes trigger micro-pulses without layout jitter or dropped rows.
4. **Focus Mode Conflict Check**: Open a trade modal and expand a scanner candidate simultaneously; verify that scanner updates continue streaming without disappearing.
5. **Responsive Validation**: Test on mobile viewport ($375\text{px}$) to confirm no horizontal scroll clipping, legible labels, and clean button tap targets.
