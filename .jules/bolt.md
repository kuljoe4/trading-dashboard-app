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

## 2026-05-25 - [Optimization] Engine Loop Suppression & Memoization
**Learning:** Constructing complex UI payloads (ticks, scanner results) and performing expensive syscalls (memory usage) in high-frequency loops (1s/2s) consumes significant CPU even when no users are watching. Memoizing static configuration signatures and short-circuiting UI logic based on active listener counts drastically reduces idle overhead.
**Action:** Always gate UI-only data construction and broadcasts behind listener checks. Memoize JSON signatures of configurations to avoid redundant 'JSON.stringify' calls in hot loops.
