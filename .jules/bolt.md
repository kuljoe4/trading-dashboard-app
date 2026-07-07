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

## 2024-05-27 - [Optimization] Memoized Strategy Joins
**Learning:** Re-calculating strategy-specific data (PnL, filtered trades) inside a main view's render loop bypasses 'React.memo' optimizations on child components, as new object literals are created on every tick.
**Action:** Extract list-item data derivation into memoized sub-components or 'useMemo' blocks to ensure props remain stable and only trigger re-renders when their underlying data Materially changes.

## 2024-05-27 - [Reliability] Maintaining Scanner Consistency
**Learning:** Slicing real-time data arrays in the backend to save egress can cause UI flickering if the frontend component expects the full dataset (e.g., in a detailed overlay). Bandwidth optimization should focus on stripping heavy non-essential fields (like history arrays) rather than truncating the primary list.
**Action:** Always ensure backend data payloads match the maximum possible requirement of active UI components, using field-level stripping for optimization instead of array truncation.

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
