## 2026-07-28 - [Optimization] Sorted-State Chronological Reversal Optimization
**Learning:** Forcing array sorting (`sort()`) on high-frequency paths (like tick updates or database fetches) introduces redundant $O(N \log N)$ complexity and heavy comparison function call overhead. Since trading collections are typically returned from databases or state stores already sorted (often reverse chronologically), detecting this sorted state via a linear $O(N)$ single-pass check allows using native, highly optimized $O(N)$ reversal (`reverse()`) or direct pass-through, avoiding comparisons entirely.
**Action:** Always check if a collection is already sorted in $O(N)$ before applying standard sorting algorithms on high-frequency paths, and handle descending orders with $O(N)$ native reversals.

## 2026-07-25 - [Optimization] Schwartzian Transform for Ticker Change Percentages
**Learning:** Sorting collections (like 300+ symbols) in a high-frequency ticker stream using complex mathematical comparisons (such as change percentage calculation) inside the `.sort()` comparator creates $O(N \log N)$ redundant divisions, math, and property lookups. Moving these calculations into a single linear $O(N)$ pass (Schwartzian Transform) and sorting the pre-calculated numbers yields a ~6.2x execution speedup.
Also, when refactoring to loop fusion and eliminating fallback default checks, be extremely careful with optionally defined sets (e.g. `excludedSet`); using optional chaining (`!excludedSet?.has(...)`) is much safer and prevents runtime TypeErrors from unexpected optional parameters.
**Action:** Always pre-calculate expensive sorting keys in a single-pass loop (Schwartzian Transform) before executing `.sort()`, and protect optional/nullable set/map lookups with optional chaining.

## 2025-05-23 - [Optimization] O(M*N) to O(M) Scanner Loop
**Learning:** Avoid using 'find' on an array generated from a Map in a high-frequency loop. Creating the array via 'Array.from' is O(N) and the search is O(N), leading to quadratic complexity in the scanner.
**Action:** Always provide O(1) direct lookup methods in cache services to avoid linear searches in the main execution paths.
## 2025-05-15 - [Initial Performance Audit]
**Learning:** The application uses a high-frequency WebSocket feed (ticks every 2s, scanner updates every 200ms) which triggers frequent re-renders of the entire DashboardView. Most UI components are functional and do not use React.memo, leading to unnecessary DOM reconciliations. DecisionLog also uses array indices as keys while prepending items, causing a full list re-render on every new log.
**Action:** Implement React.memo for core UI primitives and fix list rendering keys to minimize the impact of high-frequency state updates.

## 2025-05-24 - [Optimization] TTL Caching for Sorted Results
**Learning:** In a trading engine with hundreds of symbols, sorting the full ticker list by volume on every 2s scanner tick is a waste of CPU. However, when implementing cache keys, beware of in-place operations like 'Array.sort()' which mutate the original arguments and can cause side effects for the caller.
**Action:** Use defensive copying (e.g. '[...arr].sort()') when generating cache keys from input arrays and prioritize TTL-based caching for computationally expensive operations in hot loops.

## 2026-05-14 - [Optimization] Reducing GC Pressure in High-Frequency Loops
**Learning:** Functional chains like 'slice().map().reduce()' are elegant but create multiple intermediate arrays. In high-frequency loops (like a 2s scanner), these allocations trigger frequent GC. Replacing them with direct 'for' loops significantly reduces memory churn.
**Action:** In services that process market data every few seconds, favor direct loops over functional array methods when performance is critical. Defer expensive mapping (like sparkline generation) until AFTER filtering/sorting results.

## 2026-05-15 - [Optimization] Signal Engine Allocation Cleanup
**Learning:** Signal processing logic (MA, EMA, Breakout) often requires windows of data. Mapping full candle objects to price arrays (`candles.map(c => c.close)`) inside the scanner loop creates thousands of short-lived objects per minute.
**Action:** Refactor math helpers (SMA/EMA) to accept the source object array and index ranges instead of pre-processed primitive arrays to achieve zero-allocation data windowing.

## 2026-05-16 - [Optimization] Decoupling Logs from Main Dashboard Hot Path
**Learning:** Selecting a large array (like logs) in a root-level view causes the entire component tree to re-render on every array mutation, even if the view only uses a derived property (like length). Zustand's 'shallow' comparison and targeted derived selectors are critical for stable UI in high-frequency data environments.
**Action:** Always extract derived metrics into targeted selectors or use memoized computations to prevent 'God Object' selectors from triggering unnecessary global re-renders.
## 2026-05-18 - [Optimization] Hot-Loop Analytics Caching
**Learning:** Recalculating full session analytics (O(N log N) sort + O(N) passes) in a 1s hot loop is a major CPU sink. Since analytics only change when a trade closes or the balance is updated, they can be cached and only invalidated on those specific events.
**Action:** In high-frequency UI/State loops, always gate expensive calculations behind state-change checks (e.g., length of input arrays or key numeric property changes) to achieve near-zero cost for idle ticks.
## 2026-05-22 - [Optimization] Scalar Extremes over Array Spread
**Learning:** Using 'Math.min(...arr)' and 'Math.max(...arr)' on arrays created via 'slice().map()' in a high-frequency loop causes significant memory churn and GC pressure.
**Action:** Replace multi-pass array operations with a single-pass loop to calculate scalar extremes (min/max) directly from the source data to achieve zero-allocation windowing.

## 2026-05-21 - [Optimization] Hot-Path Engine Cleanup
**Learning:** Even a single 'JSON.stringify' or 'console.log' in a 1s hot loop (like 'getStrategyLabel') can cause measurable CPU spikes when scaled across multiple strategies and trades. Similarly, functional 'find' on arrays in the hot path should be replaced with pre-indexed Map lookups.
**Action:** Audit all methods called within 1s intervals for any stringification or linear searches. Transition signal math from 'Series' based returns to 'LastN' based returns to eliminate intermediate array allocations.

## 2026-05-24 - [Optimization] Bulk DB Operations on Startup
**Learning:** Initializing session state on startup using a loop with individual 'update' calls is O(N) in terms of DB roundtrips. For simple state transitions (e.g., marking all sessions as not running), a single bulk update is significantly more efficient and reduces startup latency.
**Action:** Use bulk update patterns (e.g., `Repository.update({ criteria }, { changes })`) for system-wide state resets instead of per-record iteration.
## 2026-05-20 - [Optimization] Ticker Stream Allocation Cleanup
**Learning:** High-frequency ticker streams (300+ symbols every second) can generate thousands of short-lived objects if the cache isn't optimized for reuse. This triggers aggressive GC that stalls the trading loop. Reusing objects in the internal Map and skipping redundant parseFloat calls provides a major efficiency win.
**Action:** For high-volume stream handlers, implement object reuse and defensive type checks to ensure the hot path is as allocation-free as possible.

## 2026-05-24 - [Optimization] Direct Map Iteration for Risk Calculation
**Learning:** Calling 'Array.from(map.values())' in high-frequency loops (like a 1s hot loop) creates unnecessary O(N) array allocations that increase GC pressure.
**Action:** Use direct 'for...of' loops over 'Map.values()' or 'Map.entries()' when calculating aggregates in hot paths to achieve zero-allocation processing.

## 2026-05-24 - [Optimization] Map-based O(1) Lookup for Trade Normalization
**Learning:** Performing a 'find' on an array of active trades (O(N)) during every WebSocket 'tick' (O(M)) results in O(N*M) complexity in the frontend state store. While N (trades) and M (incoming updates) are small, this pattern scales poorly and increases JS execution time on low-end mobile devices.
**Action:** Use a temporary Map to achieve O(1) lookup during batch normalization of trades in the WebSocket handler, reducing complexity to O(N + M).

## 2026-06-26 - [Optimization] Fused O(N) Scanner Logic
**Learning:** Fusing multiple independent data accumulation passes (like volatility and trend checks) into a single-pass loop within a high-frequency scanner reduces CPU overhead and property access churn. My benchmark showed a ~45% improvement in execution time for the scoring function.
**Action:** Always look to fuse multiple O(N) passes into a single loop when processing data windows in hot paths to minimize iterator overhead and property lookups.

## 2026-05-25 - [Optimization] Engine Loop Suppression & Memoization
**Learning:** Constructing complex UI payloads (ticks, scanner results) and performing expensive syscalls (memory usage) in high-frequency loops (1s/2s) consumes significant CPU even when no users are watching. Memoizing static configuration signatures and short-circuiting UI logic based on active listener counts drastically reduces idle overhead.
**Action:** Always gate UI-only data construction and broadcasts behind listener checks. Memoize JSON signatures of configurations to avoid redundant 'JSON.stringify' calls in hot loops.
## 2026-05-26 - [Sync Hot Paths]
**Learning:** Core data ingestion methods in `TickerCacheService` and `KlineStoreService` were `async` without containing any `await` calls. This introduced significant Promise allocation overhead and GC pressure in high-frequency WebSocket streams.
**Action:** Convert purely synchronous data management methods to sync signatures to eliminate Promise overhead in hot paths.

## 2026-06-09 - [Optimization] Zero-Allocation Ticker Updates
**Learning:** Creating wrapper objects or arrays (e.g., `[{ s: symbol, c: price }]`) in a high-frequency WebSocket stream (multiple messages/sec per symbol) creates significant GC pressure.
**Action:** Provide direct, single-entity update methods (`updateTicker`) in cache services to avoid transient allocations in hot data ingestion paths.

## 2026-05-26 - [Optimization] Promise Overhead & Syscall Throttling
**Learning:** Purely synchronous memory operations (Map/Array) should not be marked 'async'. In high-frequency streams (hundreds/sec), Promise object allocation and micro-task queue overhead accumulate. Similarly, system calls like 'process.memoryUsage()' are expensive; throttling them and returning cached metrics in hot paths significantly reduces engine latency.
**Action:** converted leaf data ingestion methods to synchronous and implemented system metric caching to avoid redundant syscalls in the 2s broadcast loop.
## 2026-05-26 - Optimize Session-Trade Join
**Learning:** O(N*M) array filtering in useMemo can become a bottleneck as trade history grows.
**Action:** Use a lookup map (O(N+M)) to join related entities in the frontend store or views.
## 2024-05-26 - [Scanner Signal Gating]
**Learning:** Performing full signal evaluations on a large watchlist (50+ symbols) every few seconds can significantly spike CPU usage and GC pressure.
**Action:** Limit high-complexity operations like signal checks to only the top N (e.g., 10) results that are actually relevant for the UI or immediate entry consideration.

## 2026-05-27 - [Engine De-promisification]
**Learning:** Using 'async/await' for purely in-memory operations in high-frequency loops (1s/2s/5s) creates significant Promise allocation overhead and microtask queue pressure. Converting technical analysis (indicators, signals) and risk checks to synchronous methods results in zero Promise churn for the hot path.
**Action:** Prioritize synchronous signatures for all in-memory technical analysis and risk evaluation logic. Reserved 'async' only for I/O bound operations like database persistence or external API calls.
## 2026-05-27 - [Aggressive Eco Mode] **Learning:** Unwatched background loops and global market streams are the primary drivers of Railway egress and CPU cost. **Action:** Implement dynamic loop throttling (ECO-MODE) and conditional market feed skipping based on listener counts.

## 2024-05-27 - [Optimization] Stable Store Selectors
**Learning:** Store selectors that return new object literals on every call cause consumer components to re-render even if the underlying data is identical.
**Action:** Use Zustand's 'shallow' comparison or 'useMemo' for selectors that return objects/arrays to prevent redundant component tree updates.
## 2026-05-28 - [Optimization] Zero-Allocation Candle Processing
**Learning:** Even with small arrays (N=500), frequent 'slice()' calls in a multi-strategy scanner loop (hundreds of times per second) create significant GC pressure. Accessing the raw underlying array and using relative indexing (e.g., 'length - 1 - lookback') provides a zero-allocation path for technical indicators.
**Action:** Expose raw data arrays for hot-path services and refactor math helpers to accept start/end indices instead of relying on array slicing for windowing.

## 2026-05-31 - [Optimization] Zero-Allocation Kline Ingestion
**Learning:** High-frequency kline updates (multiple times per second per symbol) can create thousands of short-lived 'Candle' objects and intermediate arrays (via '[].every()') if the ingestion path isn't optimized. This leads to aggressive GC churn.
**Action:** Parse kline data into local variables first, use direct numeric checks for validity, and implement in-place property mutation for existing candles to achieve near-zero allocation for the dominant 'update' path. Use static shared constants for empty return values to avoid redundant '[]' allocations.

## 2026-06-02 - [Optimization] Consolidated Hot-Loop Execution
**Learning:** Performing PnL calculation, variant statistics, and delta detection in separate O(N) passes within a 1s hot loop creates significant cumulative overhead and GC churn.
**Action:** Consolidate multiple iterations into a single-pass loop. Use summary fields (like `_sig_json` for state strings and `_sl_len` for array lengths) to achieve O(1) change detection for complex objects, and defer full serialization until AFTER a change is confirmed.

## 2026-06-03 - [Optimization] Mathematical Rounding over String/Exponential Ops
**Learning:** Using string-based exponential rounding (e.g., `Number(val + "e+8")`) or `toFixed()` in high-frequency loops (tick/broadcast) is extremely expensive due to string concatenation and parsing. Mathematical rounding (`Math.round(val * factor) / factor`) is 8x-40x faster. Additionally, string-based exponential rounding can return `NaN` for very small numbers (e.g., `5e-9`) if the string conversion doesn't match the expected format.
**Action:** Always prioritize mathematical rounding with pre-allocated power-of-10 lookup tables for performance-critical serialization and financial calculations.

## 2026-06-04 - [Architecture] Modular Service Decomposition
**Learning:** High-complexity orchestrators (God Objects) like `TradingSessionService` create brittle code and circular dependencies. Decomposing orchestration into specialized services (`GatingService`, `EngineBroadcasterService`, `VariantAnalyticsService`) allows for cleaner state management, easier testing, and immutable data flow.
**Action:** Move non-core execution logic (broadcasting, analytics, windows) into standalone services. Use strict DTOs (e.g., `TradeSerializationDto`) to decouple core entities from external broadcast formats. Ensure broadcasters remain read-only to prevent side-effect mutations during tick cycles.

## 2026-06-05 - [Optimization] Hot-Path Signal & List Caching
**Learning:** Even with small collections (N=10-100), calling `Array.from(map.values())` and `JSON.stringify(obj)` in a 1s hot loop creates significant GC pressure and CPU overhead when scaled across multiple strategies. Caching the array projection and moving serialization to the update point (event-driven caching) results in a ~100x reduction in execution time for idle ticks.
**Action:** Implement O(1) list access and pre-serialized state signatures for all objects processed in the engine's 1s broadcast loop.

## 2026-06-04 - [Roadmap] Strategic Trading Engine Improvements
**Objective:** Transition to a more robust, multi-exchange capable architecture.
**Tasks:**
1. **Abstract Exchange Layer:** Create an `IExchange` interface to decouple the engine from the Binance SDK.
2. **Result Pattern:** Replace core logic exceptions with `Result<T, E>` types for explicit error handling.
3. **Event-Driven Decoupling:** Fully migrate gating and monitoring to an `EventEmitter2` model to remove remaining orchestrator coupling.
## 2026-06-10 - [Optimization] Loop Fusion in broadcastTick
**Learning:** Consolidating global risk accumulation into an existing O(N) pass over active trades in the engine's broadcast loop eliminates a redundant 'reduce()' call. While N is small, this reduces JS execution time and function call overhead in a high-frequency (5s) hot path.
**Action:** Always look for opportunities to fuse multiple O(N) operations into a single-pass loop when processing collections in real-time broadcast services.

## 2026-06-11 - [Reliability] Binance Stop-Loss Quantity Requirement
**Learning:** Binance Stop-Loss orders (`STOP_MARKET`) can fail with "Mandatory parameter 'quantity' was not sent" even when `closePosition: true` is used. This behavior varies between the Standard and Algo APIs and across different symbols.
**Action:** Always include the `quantity` parameter in Stop-Loss orders as a fallback, even when `closePosition: true` is provided, to ensure broad compatibility and prevent order rejection.

## 2026-06-11 - [Security/Reliability] Elimination of SL Protection Gaps
**Learning:** The "Cancel-then-Replace" pattern for Stop-Loss updates creates a window of time where a trade is unprotected. In volatile markets, a price spike during this gap can lead to catastrophic losses.
**Action:** Transition to `modifyOrder` for atomic updates or the "New-then-Cancel" pattern to ensure a trade always has an active Stop-Loss on the exchange.

## 2026-06-22 - [Optimization] Centralized REST Throttling & WebSocket-First State
**Learning:** Startup bursts and aggressive polling fallbacks are the primary drivers of immediate IP bans from Binance. Sequential backfills and a centralized request queue are more effective than high-concurrency workers for maintaining IP reputation. Transitioning to a 'Seed-then-Stream' model (single REST call to establish baseline) eliminates redundant API weight consumption.
**Action:** Implement a Proxy-based request queue in `BinanceClientFactory` to enforce global rate limits and replace REST polling fallbacks with 'Fail-Fast' logic to preserve IP status.
## 2026-07-03 - [Scanner UI] O(N*M) Lookup Bottleneck
**Learning:** React components rendering lists that perform nested searches against other configuration arrays (like ) create (N \times M)$ bottlenecks that degrade UI responsiveness during high-frequency data streams.
**Action:** Always pre-calculate a `Set` or `Map` using `useMemo` to convert nested searches into (1)$ lookups, ensuring (N+M)$ linear complexity for the render pass.
## 2026-07-03 - [Scanner UI] O(N*M) Lookup Bottleneck
**Learning:** React components rendering lists that perform nested searches against other configuration arrays (like `single_symbol_configs`) create $O(N \times M)$ bottlenecks that degrade UI responsiveness during high-frequency data streams.
**Action:** Always pre-calculate a `Set` or `Map` using `useMemo` to convert nested searches into $O(1)$ lookups, ensuring $O(N+M)$ linear complexity for the render pass.

## 2026-07-01 - [Optimization] O(1) Cache Eviction in SignalEngine
**Learning:** Using 'Array.from(map.keys())' for cache eviction creates an O(N) array allocation just to access a few elements. In high-frequency services like SignalEngine, this causes unnecessary GC pressure. Using a direct iterator with 'map.keys().next()' allows for O(1) eviction without intermediate allocations.
**Action:** Always use direct iterators for Map/Set eviction or partial processing in hot paths to achieve zero-allocation collection access.

## 2026-07-05 - [Optimization] Signal Engine Structural Lookback Caching
**Learning:** O(N) structural lookbacks in signals (MA, Breakout) are ideal candidates for stable caching based on the last completed candle timestamp. In a high-frequency polling environment, recalculating structural ranges (min/max/average) over 200+ candles on every 1s/2s tick is a major CPU sink.
**Action:** Implement 'stable' caches for all structural indicators that only update when a new candle closes, turning O(N) loops into O(1) lookups for the vast majority of evaluation cycles.
## 2026-06-29 - [Optimization] O(K) Cache Eviction over O(N) Array Allocation
**Learning:** Using 'Array.from(map.keys())' to perform partial cache eviction (e.g., removing the first 100 entries when a Map hits 1000) creates an unnecessary O(N) array allocation. Since Map iterators follow insertion order, using the direct iterator and calling '.next()' is (K)$ where $ is the eviction count.
**Action:** Use direct Map iterators for partial eviction in high-frequency caches to eliminate O(N) allocations in the hot path.
## 2026-06-30 - [Serialization] BigInt.prototype.toJSON Polyfill
**Learning:** `JSON.stringify` throws a `TypeError: Do not know how to serialize a BigInt` when encountering large integers (e.g., Binance Order IDs). This can crash high-criticality logging or response serialization paths.
**Action:** Implement a global polyfill `BigInt.prototype.toJSON = function() { return this.toString(); }` in a central utility (`lib/math.ts`) and ensure it's loaded early in the application lifecycle (`server.ts`) to provide safe, precision-preserving serialization across the entire process.

## 2026-07-06 - [Optimization] Single-Pass Analytics Processing
**Learning:** Recalculating session analytics with multiple passes (filter, reduce, main loop, ROI loop) and  object comparisons creates significant CPU and GC overhead as trade history grows. Fusing these into two passes (one filter/sum and one main/ROI metrics loop) with millisecond-based comparisons reduces execution time and allocations.
**Action:** Always look to fuse independent data aggregation passes into a single loop when processing collections in hot paths or expensive background services.

## 2026-07-06 - [Optimization] Single-Pass Analytics Processing
**Learning:** Recalculating session analytics with multiple passes (filter, reduce, main loop, ROI loop) and `Date` object comparisons creates significant CPU and GC overhead as trade history grows. Fusing these into two passes (one filter/sum and one main/ROI metrics loop) with millisecond-based comparisons reduces execution time and allocations.
**Action:** Always look to fuse independent data aggregation passes into a single loop when processing collections in hot paths or expensive background services.

## 2026-07-07 - [Optimization] Centralized Stable Lookback Caching
**Learning:** Redundant (N)$ structural lookbacks (min/max) across different services (RiskEngine, SignalEngine) create unnecessary CPU load and GC pressure. Centralizing these lookbacks into the data source (KlineStore) with a stable cache based on the last completed candle timestamp converts multiple (N)$ operations into a single (1)$ lookup per tick.
**Action:** Always centralize technical indicator calculations that depend on completed candles into the primary data service and implement stable caching to eliminate redundant iterations across the engine.

## 2026-07-08 - [Optimization] Zero-Allocation Candle Access in Engulfing Signal
**Learning:** Even with small lookbacks, using 'slice()' in a high-frequency signal evaluation pass (potentially hundreds of symbols every few seconds) creates significant transient array allocations. This increases GC pressure and reduces overall engine throughput.
**Action:** Replace 'slice()' with direct index-based iteration over the original data array in technical indicator handlers. Maintain parity with slice() behavior by guarding against negative start indices when refactoring to manual loops.

## 2024-05-28 - [UX/Optimization] Decision-Support UI Refactoring
**Learning:** Dense technical telemetry (raw percentages, condition met/not met) increases cognitive load during high-pressure trading. Shifting from technical labels to plain-language states ("Ready", "Watching", "Risk Building") improves scannability. Memoizing sub-sections of complex trade details prevents full re-renders on every price tick.
**Action:** Implement plain-language status pills and summary sentences in `ScannerOverlay` and `TradeDetailContent`. Use `React.memo` on deep child components like `RRLadder` and `ExitMonitor` to isolate re-renders from global price updates.

## 2026-07-10 - [Optimization] Pre-parsing & WeakMap Caching for Trading Windows
**Learning:** Performing string manipulation ('replace') and 'parseInt' on configuration objects within high-frequency loops (like a 15s main loop checking trading windows) adds unnecessary CPU overhead. Replaced functional '.some()' with a manual 'for' loop and implemented 'WeakMap' caching for pre-parsed numeric window bounds.
**Action:** Use 'WeakMap' to cache derived or parsed data from configuration objects to turn O(N) string/parsing operations into O(1) lookups in hot paths, and favor manual loops over frequency iterators in high-frequency logic. Benchmark showed a ~5.8x performance improvement (3173ns -> 543ns per call).
## 2026-07-13 - [Optimization] Hot-Path UI Extreme Calculation Standard
**Learning:** Spread-based 'Math.min(...arr)' and '.map()' chains in high-frequency React components (like PnLBars and Sparkline) create significant GC pressure and unnecessary O(N) passes. Fusing these into a single-pass 'for' loop with direct variable comparison reduces execution time and eliminates transient array allocations.
**Action:** Always use single-pass 'for' loops for min/max calculations in charting and scaling components that update on every price tick.

## 2026-07-17 - [Optimization] Prioritized Stable Cache for Lookback Validation
**Learning:** O(N) structural lookbacks with gap and freshness validation run costly loops and comparisons on every single watchdog audit or tick cycle. Since completed candles are static and immutable, any gap validation or extremes result remains 100% static for a given lookback period. Placing the stable cache lookup at the very top of `getLookbackExtremes` before these validation loops converts multiple O(N) loops into a single O(1) Map lookup, while dynamically executing only the O(1) freshness check.
**Action:** Always place stable caches at the absolute beginning of technical analysis functions, bypassing immutable validation loops and only executing dynamic checks (like freshness) on cache hits.

## 2026-07-18 - [Roadmap] Backlog Reconciliation (Momentum Engine Review)
**Context:** A full read-through of the actual implementation reconciled memory's "on the horizon" / priority list against the source. Most items were already shipped and tested; only a few remained open — all resolved this session.
**Verified already shipped (do NOT re-litigate):** `close_blocked` watchdog inversion (15-min-then-nuclear), Algo API primary + standard `STOP_MARKET`/`closePosition` fallback with `binance_stop_order_type` cancel routing, leverage-bracket pre-flight, SL computed from fill price, position-tracking clearance on close fill, `illiquid_blocked` DB column + escalation, Dynamic RR analytics (`RrOptimizationService`), and symbol-scoped (non-account-wide) flush safety.
**Resolved this session (with regression tests):**
1. **Market-data blackout P0:** `forceRawDiscovery` was dead code (set in 3 places, never read). `MarketFeedService.startGlobalDiscovery()` now switches to a DISTINCT transport when active — symbol-scoped `<symbol>@miniTicker` / `<symbol>@markPrice@1s` streams built from `config.symbols` + active trades + REST-seeded top-volume — instead of the starved `!miniTicker@arr` / `!markPrice@arr` aggregate. `processStreamMessage` handles `@miniTicker` + counts symbol-scoped streams as live. (`market_feed.blackout.spec.ts`)
2. **`illiquid_blocked` → LIMIT fallback dead code:** the shortcut `throw new Error('PERCENT_PRICE')` fired outside the MARKET-close try/catch, so it returned `exitOccurred:false` without ever placing the LIMIT. Extracted `attemptAggressiveLimitClose()` and call it directly from both the `illiquid_blocked` shortcut and the PERCENT_PRICE catch; backoff now runs before the shortcut. (`orderManager.blocked-alerts.spec.ts`)
3. **Balance broadcast spam:** `handleAccountUpdate` now broadcasts `balance_update` only when `bc !== 0` or the balance actually changed.
4. **SL / `ACCOUNT_UPDATE` race (narrowed):** replaced the `hasStopOrder ? 100 : 0` heuristic with a uniform `UDS_ZERO_POSITION_DELAY_MS = 300` (named constant in `constants.ts`) so trades without a stop order no longer get a 0ms race window. (The more robust ORDER_TRADE_UPDATE→`handleAccountUpdate` handoff flag was considered but NOT implemented, to avoid untested cross-service plumbing.)
5. **Scanner object-identity churn:** `normalizeOpportunity(o, prev)` now returns the previous reference when a display-fingerprint is unchanged (mirrors `normalizeTrade._fingerprint`); history/ohlc/score_breakdown/signalResult are retained from `prev` when omitted. The hot `scanner` + variant handlers pass `prev` and short-circuit, restoring `React.memo` on `ScannerRow`. (`normalizeOpportunity.test.js`)
6. **ConfigModal CopyButton churn:** `CopyButton` gained a lazy `getValue` prop; the config JSON is serialized only on click, not on every modal render.
**Remaining nuance:** SL/ACCOUNT_UPDATE is narrowed (configurable delay), not structurally eliminated. Market-data blackout fallback covers the symbol-scoped path; if the entire `/market/stream` host is starved, REST seed remains the safety net (per AGENTS.md §8/§9).

## 2026-07-18 - [Bug] Zero-Price SL/TP Silently "Proceeding" + SL-BE Risk Release
**Context:** Production log showed `SYNUSDT: SL/TP Price 0 significantly far from Mark (100.00%). Proceeding with filtered price.` flooding every ~5s, and an adopted SYNUSDT position reported with "NO protection SL orders" whose stop never fired.
**Root causes found:**
1. `OrderFilterService.applyFilters` (SL/TP branch, `skipNotionalCheck:true`, non-clamping callers) returned `price:0` with only a WARN and "Proceeding with filtered price" when the stop price was `0`. A `0`-price stop is never valid on Binance; silently proceeding masked the real bug (zeroed `entry_price`/`current_sl`, or a `0` signal `value`) and let a broken stop into the pipeline. Note: `placeStopLoss` always passes `clampToPercentPrice:true` so it cannot produce this warning — the source is the trailing/lock_sl/entry non-clamping callers.
2. Watchdog re-arm (`MaintenanceService.protectionln`) called `placeStopLoss(trade, trade.current_sl)` directly; if `current_sl` was `0`, the stop was re-armed from a `0` baseline.
3. **(pre-existing, completed here)** SL-breakeven risk release was computed correctly server-side (`PositionTracker.refreshTradeRisk` sets `risk_usdt=0`), but `EngineBroadcasterService` never serialized `risk_usdt` (only `initial_risk_usdt`), and `TradeDetailContent` used `||` so a genuine `0` fell back to the static initial risk — so "risk released at BE" never reached the UI.
**Fixes (regression-tested):**
- `OrderFilterService.applyFilters`: a non-positive SL/TP price now hard-rejects (`{price:0, qty:0}` + ERROR), instead of proceeding. Valid far-but-nonzero stops still proceed.
- `MaintenanceService.protectionln`: when `current_sl <= 0`, derive a real entry-based fallback SL (`entry*(1∓sl_distance_pct)`) before re-arming, mirroring adoption logic.
- `EngineBroadcasterService`: serialize `risk_usdt` in `serializeTrade` (full + `_delta`) and `serializeTickTrade`. `trade-serialization.dto.ts` DTOs gained `risk_usdt?`. `TradeDetailContent` now uses `??` so a released `0` is preserved.
- Tests: `order-filter.zero-sl.spec.ts` (zero/negative SL rejection + valid-far-SL proceeds), broadcaster spec extended for `risk_usdt` (incl. `0` at BE not falling back to initial).
**Action:** Never "proceed" with an invalid (non-positive) stop price — reject hard so the root cause surfaces. Guard re-arm/ratchet paths against a `0` `current_sl`. Serialize released risk explicitly; don't let `||` coerce a legitimate `0` into a fallback.

## 2026-07-18 - [Internalized Principles] Stop-Loss / Risk Plumbing Anti-Patterns
These are durable rules extracted from the zero-price-SL + BE-risk-release incident. Treat as standing policy; do NOT re-litigate.
1. **Never "proceed" with an invalid stop.** A non-positive (0 / negative) SL/TP price is NEVER valid on Binance. Reject hard (return `{price:0, qty:0}` + ERROR) so the root cause surfaces. Silently "proceeding with filtered price" hides zeroed `entry_price`/`current_sl` or a `0` signal `value` and lets a broken order into the pipeline. (A WARN + continue is NOT acceptable for a structurally invalid order.)
2. **Guard every re-arm / ratchet / adoption path against a `0` baseline.** If `current_sl <= 0` (adopted/synthetic/reconciled trade), derive a real entry-based fallback SL (`entry*(1∓sl_distance_pct)`) BEFORE calling `placeStopLoss`. Never feed `placeStopLoss(trade, trade.current_sl)` raw.
3. **Plumb released risk end-to-end.** A "released" state that is legitimately `0` (e.g. breakeven risk release) must be serialized from backend → DTO → frontend. Use `??` (not `||`) on the frontend and serialization side so a real `0` is preserved instead of falling back to a static initial value. `||` coerces intentional zeros into fallbacks.
4. **Filter-diagnosis rule:** `placeStopLoss` always passes `clampToPercentPrice:true` (clamps, never warns). So a "Price X significantly far from Mark … Proceeding" WARN can ONLY come from the NON-clamping callers (trailing stop, lock_sl, entry). Don't blame `placeStopLoss`.
5. **A warning that fires every tick is a bug signal, not noise.** The `SL/TP Price 0` log flooded every ~5s for an hour — that is a masked defect, not benign. Any per-tick WARN for the same symbol/condition needs a hard guard or rejection, never an unbounded "proceeding".
6. **Verify the live outcome, not just the log silence.** After fixing a stop/risk path, confirm the value actually reaches the exchange (or is serialized to the UI), since the original symptom ("SL didn't fire") is downstream of the warning.
Test-every-fix culture: each of the above got a regression spec (zero-SL rejection, `risk_usdt` serialization incl. `0`-at-BE).

## 2026-07-19 - [Optimization] Ticker Cache Array Projection
**Learning:** Calling 'Array.from(map.values())' in a high-frequency ticker stream creates O(N) array allocations that increase garbage collection pressure. Since the value objects inside the map are mutated in-place to avoid allocations, the references remain valid and we only need to invalidate the array cache when a new key is added or the map is cleared.
**Action:** Always memoize array projections of in-place mutated maps and invalidate only when keys are added/removed to avoid redundant allocations in hot loops.

## 2026-07-20 - [Optimization] Schwartzian Transform Sorting for Win Rate
**Learning:** Sorting collections (like sessions) with custom keys (like win rates) computed on-the-fly inside the `.sort()` comparator creates $O(N \log N)$ executions of the key-computation logic. Since win rate computation (`calculatePerformanceMetrics`) is computationally expensive (performs trade array sorting and multiple passes), this creates significant CPU overhead as history grows.
**Action:** Pre-calculate sorting keys in a single $O(N)$ map pass (Schwartzian transform) before invoking `.sort()`, completely eliminating redundant computations.

## 2026-07-21 - [Optimization] Single-Pass Allocation-Free Supertrend
**Learning:** Technical indicators like Supertrend often follow elegant multi-pass formulations (calculating TR, ATR, basic bands, final bands, and final supertrends as separate sequential arrays). In high-frequency polling/scanning loops, allocating multiple intermediate $O(N)$ arrays (up to 6 arrays of size 500 per tick) creates heavy garbage collection pressure and CPU cache degradation. Fusing these calculations into a single-pass loop using scalar tracking variables eliminates all intermediate array allocations.
**Action:** Eliminate auxiliary internal arrays in technical indicators by tracking required state across loop iterations with local scalar variables, keeping only the final output arrays.

## 2026-07-23 - [Optimization] Numeric Timestamp Sorting over Date Instantiation
**Learning:** Instantiating `new Date()` inside `.sort()` comparators in high-frequency state updates or heavily populated historical tables is a major source of CPU load and Garbage Collection (GC) pressure. Pre-calculating numerical milliseconds (`startTimeMs` / `exit_ts_ms`) during initial normalization/fetching converts complex string-to-date parsing into a simple O(1) mathematical subtraction.
**Action:** Always pre-calculate numeric equivalents for all date-based fields during data normalization or ingestion, and use them directly in sorting and filtering loops.

## 2026-07-24 - [Optimization] Single-Pass O(N) Lookup over O(N log N) Sorting
**Learning:** Sorting an entire list with `.sort()` just to retrieve the single maximum or minimum element (`[0]` or `[arr.length - 1]`) is an $O(N \log N)$ operation that unnecessarily copies arrays and recomputes/re-parses values inside the comparator. Replacing it with a single-pass `for` loop reduces complexity to $O(N)$ and eliminates all array allocations and GC pressure.
**Action:** Always favor a single-pass $O(N)$ loop (or `reduce()`) when extracting the maximum, minimum, or extreme element of a collection, avoiding sorting overhead completely.

## 2026-07-26 - [Optimization] O(N) Map-Based Volume & Change Rank Mapping
**Learning:** Running linear searches via `.findIndex` or `.indexOf` inside a `.map` loop creates a highly expensive quadratic $O(N^2)$ operation. In high-frequency UI rendering paths (such as the Live Scanner `useMemo` filter block), this causes substantial frame-rate drops and UI lag as the list size grows. Converting the nested search collections into pre-built lookup `Map`s reduces the complexity to $O(N)$ linear time and yields a ~4.2x speedup.
**Action:** Always convert nested linear searches ($O(N^2)$) inside mapping and filtering loops into pre-built $O(1)$ Map/Set lookups ($O(N)$ total complexity) for high-frequency or large-dataset processing.

## 2026-07-26 - [Optimization] Chronological Kline/Candle Freshness Validation in MarketFeed
**Learning:** Accessing `existingCandles[0]` in a chronologically ordered array (oldest to newest) to check for cache freshness incorrectly evaluates the oldest historical candle (e.g. 100 hours ago for `1h` timeframe with a 100 warmup period) rather than the most recent one. This causes the system to mistake healthy, up-to-date local caches as stale, initiating redundant REST API backfills (`/fapi/v1/klines`) on every subscription or evaluation cycle, which spikes REST API counts and risks rate-limiting or IP bans under larger timeframes.
**Action:** Always reference `existingCandles[existingCandles.length - 1]` to retrieve the most recent candle in a chronologically sorted array for freshness validation, correctly skipping REST queries on valid cache hits.
