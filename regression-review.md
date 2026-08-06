fix: resolve 400 Bad Request, restore scanner offset, and fix tooltip wrapping

Implemented recursive configuration sanitization in the frontend to prevent 400 Bad Request validation errors caused by nested UI-only properties.

Improved backend AllExceptionsFilter to log stringified validation error objects.

Restored watchlist_offset feature:

Added watchlist_offset to SessionConfig.

Updated MarketFeedService and MomentumScannerService to apply the offset to volume-sorted symbols.

Implemented volume_rank propagation to the UI.

Added "Watchlist Offset" input to ConfigModal.jsx.

Enhanced ScannerOverlay.jsx to show list position and absolute volume rank.

Fixed tooltip regression: Added max-width and whitespace-normal to the global Tooltip component in primitives.jsx to ensure multi-line content wraps correctly on mobile and desktop.

Updated unit tests to verify recursive sanitization.


#347

fix: prevent double-counting PnL/fees on session restart

Initialize TradingSessionService.appliedPnL from resumed open trades in the start method.

This ensures that delta-based balance updates correctly account for already realized

PnL (like entry fees) when a session is restarted with active positions.

Includes a new unit test 'restart_pnl.spec.ts' verifying the fix.

#346

 Bolt: Signal Evaluation & EMA Caching Optimization

Implement WeakMap caching for strategy warmup requirements in SignalEngineService.

Refactor warmup calculation to use single-pass loop (O(N) instead of O(N+M)).

Implement per-tick caching for calculateEMA and calculateEMALastTwo.

Use robust composite cache keys (symbol:interval:period:time:close:length) to ensure correctness during price updates.

Benchmarks show ~40x speedup for warmup checks and ~30% improvement in EMA evaluation latency.

#345

 Palette: Enhance Trade History UX

Added search filtering by strategy label, symbol, and session ID.

Implemented session duration display in history groups.

Added auto-expansion logic for sessions when linked via URL.

Replaced native confirm() with custom ConfirmationModal for standalone records deletion.

Improved accessibility and visual consistency.

#344

Harden WebSocket authentication failure paths

Record failures for unauthorized origins and malformed URLs in the

IP-based throttling system to prevent brute-force bypass.

#343

fix: resolve 400 Bad Request by recursively sanitizing session config

Implemented recursive sanitization in frontend/src/api/client.js to ensure nested objects like strategy_variants and single_symbol_configs are properly stripped of UI-only properties and signal_params are stringified before being sent to the backend.

Improved AllExceptionsFilter in backend/node/src/lib/all-exceptions.filter.ts to log detailed error messages for HTTP exceptions, providing better visibility into validation failures.

Updated frontend/src/api/client.test.js to verify recursive sanitization logic.

#342

fix(engine): add missing roundEight import in ExecutionService

Added the missing 'roundEight' import from '../lib/math' in 'execution.service.ts'

to resolve a TypeScript compilation error (TS2304) that was blocking the build.

Verified the fix with a successful 'pnpm run build' and passed related math tests.

#341
