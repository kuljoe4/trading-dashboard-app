# Performance Optimization & Efficiency

## Mathematical Precision (math.ts)
Avoid `toFixed()` and string parsing in hot paths.
- **Lookup Tables:** Use pre-allocated `POWERS_OF_10` to avoid `Math.pow()` overhead.
- **Epsilon Guarding:** Add `Number.EPSILON` before rounding to handle floating-point artifacts (e.g., `1.005` rounding correctly).
- **O(1) Math Operations:** Favor pure mathematical rounding (`Math.round(v * p) / p`) over string conversions.

## Resource Stewardship
- **Tiered Data Fidelity:** Update frequency and data detail should scale based on client window focus (Focus vs. Background).
- **Eco-Mode:** Throttling engine loops and market data consumption when no active trades are open or when the UI is inactive.
- **Active List Caching:** Use `_activeListCache` patterns in services like `PositionTrackerService` to transform O(N) allocations into O(1) reads in high-frequency loops.

## Execution Efficiency
- **Single-Pass Processing:** Combine statistics calculation, PnL tracking, and serialization in a single loop through the trade/ticker list.
- **Object Reuse:** Reuse ticker objects or buffer pools to minimize Garbage Collection (GC) pressure in 1s heartbeat loops.
- **Delta Merging:** Send only changed data over WebSockets (handled via optimized Zustand merging on the frontend).
