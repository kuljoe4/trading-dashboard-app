## 64c81e8 Merge pull request #348 from kuljoe4/fix/400-bad-request-sanitization-5863998778127117490

Fix/400 bad request sanitization 5863998778127117490
---

## af73b4a fix: resolve 400 Bad Request, restore scanner offset, and fix tooltip wrapping

- Implemented recursive configuration sanitization in the frontend to prevent 400 Bad Request validation errors caused by nested UI-only properties.
- Improved backend `AllExceptionsFilter` to log stringified validation error objects.
- Restored `watchlist_offset` feature:
    - Added `watchlist_offset` to `SessionConfig`.
    - Updated `MarketFeedService` and `MomentumScannerService` to apply the offset to volume-sorted symbols.
    - Implemented `volume_rank` propagation to the UI.
    - Added "Watchlist Offset" input to `ConfigModal.jsx`.
    - Enhanced `ScannerOverlay.jsx` to show list position and absolute volume rank.
- Fixed tooltip regression: Added max-width and whitespace-normal to the global `Tooltip` component in `primitives.jsx` to ensure multi-line content wraps correctly on mobile and desktop.
- Updated unit tests to verify recursive sanitization.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## e9bc38d fix: resolve 400 Bad Request and restore scanner watchlist offset

- Implemented recursive configuration sanitization in the frontend to ensure nested objects like `strategy_variants` and `single_symbol_configs` are properly stripped of UI-specific properties, preventing 400 Bad Request validation errors in the backend.
- Improved backend `AllExceptionsFilter` to stringify complex error messages (like validation arrays) for better visibility.
- Restored the `watchlist_offset` feature:
    - Added `watchlist_offset` to `SessionConfig` model.
    - Updated `MarketFeedService` and `MomentumScannerService` to use the offset when selecting symbols by volume.
    - Implemented `volume_rank` propagation from backend to frontend.
    - Added "Watchlist Offset" control to `ConfigModal.jsx`.
    - Enhanced `ScannerOverlay.jsx` to display absolute volume rank (`VOL #X`) alongside list position.
- Updated and verified frontend unit tests.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## a8589fb Merge pull request #347 from kuljoe4/fix-pnl-inconsistency-on-restart-11382472221058191581

Fix PnL/Balance Inconsistency on Session Restart
---

## 9928763 Merge pull request #346 from kuljoe4/bolt-signal-optimization-v2-3563545522294319897

⚡ Bolt: Signal Evaluation & EMA Caching Optimization
---

## b6a8ff1 Merge pull request #345 from kuljoe4/ux-history-enhancements-8579436929101466432

🎨 Palette: Trade History UX Enhancements
---

## 145b705 Merge pull request #344 from kuljoe4/harden-ws-auth-failures-3728861687132263489

🛡️ Sentinel: [HIGH] Harden WebSocket authentication failure paths
---

## e2b3f96 fix: prevent double-counting PnL/fees on session restart

Initialize TradingSessionService.appliedPnL from resumed open trades in the start method.
This ensures that delta-based balance updates correctly account for already realized
PnL (like entry fees) when a session is restarted with active positions.

Includes a new unit test 'restart_pnl.spec.ts' verifying the fix.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## daa130f ⚡ Bolt: Signal Evaluation & EMA Caching Optimization

- Implement WeakMap caching for strategy warmup requirements in SignalEngineService.
- Refactor warmup calculation to use single-pass loop (O(N) instead of O(N+M)).
- Implement per-tick caching for calculateEMA and calculateEMALastTwo.
- Use robust composite cache keys (symbol:interval:period:time:close:length) to ensure correctness during price updates.
- Benchmarks show ~40x speedup for warmup checks and ~30% improvement in EMA evaluation latency.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 4db6736 🎨 Palette: Enhance Trade History UX

- Added search filtering by strategy label, symbol, and session ID.
- Implemented session duration display in history groups.
- Added auto-expansion logic for sessions when linked via URL.
- Replaced native confirm() with custom ConfirmationModal for standalone records deletion.
- Improved accessibility and visual consistency.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 21ccb88 Harden WebSocket authentication failure paths

Record failures for unauthorized origins and malformed URLs in the
IP-based throttling system to prevent brute-force bypass.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 77326c5 Merge pull request #343 from kuljoe4/fix/400-bad-request-sanitization-5863998778127117490

Fix 400 Bad Request and Improve Exception Logging
---

## 2a8f9ec fix: resolve 400 Bad Request by recursively sanitizing session config

Implemented recursive sanitization in `frontend/src/api/client.js` to ensure nested objects like `strategy_variants` and `single_symbol_configs` are properly stripped of UI-only properties and `signal_params` are stringified before being sent to the backend.

Improved `AllExceptionsFilter` in `backend/node/src/lib/all-exceptions.filter.ts` to log detailed error messages for HTTP exceptions, providing better visibility into validation failures.

Updated `frontend/src/api/client.test.js` to verify recursive sanitization logic.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 3172ca6 Merge pull request #342 from kuljoe4/fix-missing-roundeight-import-1018342130361005380

Fix missing roundEight import in ExecutionService
---

## dd65588 fix(engine): add missing roundEight import in ExecutionService

Added the missing 'roundEight' import from '../lib/math' in 'execution.service.ts'
to resolve a TypeScript compilation error (TS2304) that was blocking the build.
Verified the fix with a successful 'pnpm run build' and passed related math tests.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## f9910cb Merge pull request #341 from kuljoe4/fix-pnl-inaccuracy-and-race-conditions-8789253062796866081

Fix pnl inaccuracy and race conditions 8789253062796866081
---

## 35b09e0 Merge branch 'master' into fix-pnl-inaccuracy-and-race-conditions-8789253062796866081


---

## ec25bea fix: resolve PnL inaccuracies, harden concurrency, and handle PERCENT_PRICE filters

- Fix state mutation in EngineBroadcasterService overwriting trade.pnl
- Implement Symbol Locks and Risk Reservation to prevent entry race conditions and over-leveraging
- Track Mark Price via !markTicker stream to improve PnL accuracy and filter validation
- Implement PERCENT_PRICE filter validation for MARKET orders
- Harden balance synchronization with delta accumulation during debounce windows
- Refine frontend visuals to eliminate double negatives and standardize markers

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 0e6eaa4 fix: resolve PnL inaccuracies and harden multi-symbol concurrency

- Fix critical state mutation in EngineBroadcasterService overwriting trade.pnl
- Implement symbol-level entry/exit locks in PositionTrackerService
- Introduce Pending Risk Tracking to prevent over-leveraging during concurrent entries
- Add re-entrancy guards and improved balance fallback logic to TradingSessionService
- Refine frontend visuals to eliminate double negatives and standardize markers
- Add detailed PnL audit logging in OrderManagerService

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 3348ede fix: resolve PnL inaccuracies and harden concurrency guards

- Fix state mutation in EngineBroadcasterService overwriting trade.pnl
- Implement entering/closing atomic locks in PositionTrackerService
- Add re-entrancy guards to TradingSessionService loops
- Improve PnL delta tracking and audit logging
- Refine frontend visuals to eliminate double negatives and standardize markers

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 4e4b7c0 Merge pull request #340 from kuljoe4/fix/scanner-resilience-sl-conflict-1786841175507496449

Fix/scanner resilience sl conflict 1786841175507496449
---

## 0addf27 Merge branch 'master' into fix/scanner-resilience-sl-conflict-1786841175507496449


---

## 1bb064e Merge pull request #339 from kuljoe4/fix-pnl-inaccuracy-and-race-conditions-8789253062796866081

Fix PnL inaccuracies and trade closure race conditions
---

## cdc7c41 Merge branch 'master' into fix-pnl-inaccuracy-and-race-conditions-8789253062796866081


---

## 870fced Merge pull request #338 from kuljoe4/feat/watchlist-offset-rank-7115825232116687709

Watchlist Offset and Volume Rank Integration
---

## 3d1adbd Merge pull request #337 from kuljoe4/fix-resource-leaks-12156473561844398584

Fix progressive resource usage (CPU, RAM, Network)
---

## 4d2df2f Merge pull request #336 from kuljoe4/feat/expectancy-status-tiers-9799204153634735482

Expectancy Status Tiers and Tooltip Optimization
---

## b1e5622 fix: resolve PnL inaccuracies and trade closure race conditions

- Fix state mutation in EngineBroadcasterService.serializeTrade overwriting trade.pnl
- Implement closingSymbols lock in PositionTrackerService for atomic closures
- Improve delta tracking in TradingSessionService.updateBalance
- Refine fmtUSD and StatCard visuals to eliminate double negatives
- Add PnL audit logging in OrderManagerService

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 19acda2 feat: add watchlist offset setting and volume rank display

- Implement watchlist_offset in SessionConfig (backend/frontend)
- Optimize TickerCacheService.topByVolume with caching and offset support
- Propagate global volume rank to scanner results
- Add "Watchlist offset" field to ConfigModal
- Display "VOL #X" rank in ScannerOverlay for visual feedback
- Improve type safety in scanner mapping logic

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 2ccffce fix: improve scanner resilience, handle Binance SL conflicts, and fix mobile tooltips

- Wrap `orderManager.enter` in a `try-catch` block in `ExecutionService` to ensure the scanner continues if an entry fails.
- Enhance `OrderManagerService.placeStopLoss` with a retry loop that surgically cleans up orphan `closePosition` orders (Standard and Algo) when a placement conflict occurs.
- Update `Tooltip` component in `primitives.jsx` to toggle on tap on mobile devices (viewport < 768px) and stop event propagation.
- Add unit tests in `orderManager.resilience.spec.ts` for the SL orphan cleanup logic.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 23a1816 fix: prevent resource leaks and optimize network usage

- Implemented WebSocket `_isExplicitClose` logic in `MarketFeedService` to prevent zombie reconnections.
- Fixed a memory leak in `subscriptionTasks` by removing executed timeout references.
- Added memory pruning in `KlineStoreService` and `TickerCacheService` to purge inactive state.
- Optimized `backfillKlines` freshness check to prevent redundant REST API calls.
- Added comprehensive unit tests in `leak_prevention.spec.ts`.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 46ba5b7 feat: comprehensive trading analytics and premium UI overhaul

- Backend: Re-engineered `AnalyticsService` with high-performance, single-pass algorithms for Sharpe ratio, Sortino ratio, Profit Factor, and percentage performance.
- Backend: Implemented session `endTime` tracking with database migration and lifecycle integration.
- Frontend: Refactored `analytics.js` with O(N) performance metric utilities and a standardized 5-tier grading system (Excellent, Good, Acceptable, Weak, Poor).
- UI/UX: Revamped `HistoryView` with session duration tracking, color-coded risk metrics, and consolidated performance percentages.
- UI Polish: Globally refined direction markers (▴/▾) to be significantly smaller and less intrusive; implemented automated styling in `StatCard`.
- Mobile: Patched Tooltip interactions to support single-tap toggling and added responsive CSS to prevent viewport clipping.
- Performance: Leveraged aggressive memoization and unified data processing to ensure a buttery-smooth dashboard experience.
- Design System: Introduced 'Orange' variant for clearer performance status differentiation.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 0d5b662 feat: high-performance analytics suite and UI aesthetic overhaul

- Backend: Optimized `AnalyticsService` with single-pass Sharpe, Sortino, and Profit Factor calculations.
- Backend: Implemented `endTime` tracking and TypeORM migration for session duration analysis.
- Frontend: Refactored `analytics.js` with single-pass performance metrics utility.
- UI/UX: Integrated session duration and color-coded risk-adjusted metrics into `HistoryView`.
- UI Polish: Globally reduced direction marker (▴/▾) weight and enabled single-tap mobile tooltips.
- Performance: Consolidated `SessionGroup` calculations into a unified `useMemo` block for O(N) traversal.
- Quality: Verified with backend unit tests and sanitized UI primitives for new markers.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 365375e feat: advanced trading analytics, session duration, and UI polish

- Backend: Added Sharpe/Sortino ratios and correct Profit Factor to `AnalyticsService`.
- Backend: Implemented `endTime` tracking for sessions to calculate duration.
- Frontend: Added multi-tier grading for Expectancy, Sharpe, and Sortino (Excellent to Poor).
- Frontend: Displayed session duration in `HistoryView` headers.
- UI/UX: Integrated risk-adjusted return metrics into lifetime overview and session groups.
- UI Polish: Globally refined direction markers (▴/▾) for improved elegance.
- Mobile: Improved Tooltip interaction (tap to toggle) and responsive layout.
- Data Integrity: Added database migration for `endTime` and backend unit tests.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 9d27c2e feat: comprehensive analytics suite and UI aesthetic refinement

- Backend: Enhanced `AnalyticsService` with Sharpe ratio, Sortino ratio, and correct Profit Factor calculation.
- Frontend: Implemented multi-tier grading for all ratios and utility functions for session-level analysis.
- UI/UX: Integrated risk-adjusted return metrics (Sharpe/Sortino) into both lifetime overview and session groups.
- UI Polish: Globally reduced direction marker (▴/▾) weight and enhanced mobile tooltip interaction.
- Correction: Fixed "Profit Factor" terminology and data mapping in `HistoryView`.
- Quality: Added backend tests for new metric calculations.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 009d341 fix: improve scanner resilience, handle Binance SL conflicts, and fix mobile tooltips

- Wrap `orderManager.enter` in a `try-catch` block in `ExecutionService` to ensure the scanner continues if an entry fails.
- Enhance `OrderManagerService.placeStopLoss` with a retry loop that surgically cleans up orphan `closePosition` orders (Standard and Algo) when a placement conflict occurs.
- Update `Tooltip` component in `primitives.jsx` to toggle on tap on mobile devices (viewport < 768px) and stop event propagation.
- Add unit tests in `orderManager.resilience.spec.ts` for the SL orphan cleanup logic.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## e14000e feat: advanced trading analytics and refined UI aesthetic

- Backend: Added Sharpe and Sortino ratio calculations to `AnalyticsService`.
- Frontend: Implemented multi-tier grading for Expectancy, Sharpe, and Sortino in `analytics.js`.
- UI/UX: Integrated advanced metrics into `HistoryView` with color-coded status grades (Good=Blue, Weak=Orange).
- UI Polish: Globally optimized direction markers (▴/▾) with reduced visual weight and scaling.
- Mobile: Improved Tooltip interaction (single-tap to open) and responsiveness (prevent clipping).
- Performance: Leveraged `useMemo` and `StatCard` optimizations for efficient rendering.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 1a71a29 feat: enhance trading analytics with status grading and UI refinements

- Backend: Added Sharpe and Sortino ratio calculations to `AnalyticsService` with unit tests.
- Frontend: Implemented multi-tier grading for Expectancy, Sharpe, and Sortino in `analytics.js`.
- UI/UX: Integrated advanced metrics into `HistoryView` with color-coded status grades.
- UI Refinement: Globally optimized direction markers (▴/▾) to be smaller and more subtle.
- Theme: Added orange color variant and refined status color mappings (Good=Blue, Weak=Orange).
- Accessibility & Mobile: Improved `Tooltip` responsiveness to prevent clipping on mobile devices.
- Performance: Optimized `HistoryView` with `useMemo` for analytics status calculations.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## e716bb8 feat: add Sharpe/Sortino ratios, color-coded grading, and UI refinements

- Backend: Enhanced `AnalyticsService` to calculate Sharpe and Sortino ratios (trade-based). Added unit tests.
- Frontend: Implemented multi-tier grading for Sharpe and Sortino in `analytics.js`.
- UI/UX: Integrated new metrics into `HistoryView` with color-coded status grades.
- UI Refinement: Replaced large direction markers (▲/▼) with smaller, more elegant variants (▴/▾) across all components.
- Accessibility & Mobile: Optimized `Tooltip` responsiveness to prevent clipping on mobile and ensured high contrast for status grades.
- Performance: Utilized `useMemo` for lifetime analytics calculations to minimize re-renders.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 0e3832b feat: implement expectancy status tiers and improve tooltip responsiveness

- Updated `getExpectancyStatus` in `analytics.js` with new performance tiers: Excellent, Good, Acceptable, Weak, and Poor.
- Enhanced `HistoryView.jsx` to display these labels alongside numerical expectancy values in session groups and lifetime stats.
- Improved `Tooltip` responsiveness in `primitives.jsx` by ensuring content wraps on mobile and stays within the viewport.
- Optimized performance in `HistoryView.jsx` using `useMemo` for lifetime expectancy calculations.
- Preserved "Expectancy" title in all UI updates as requested.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---

## 89bc487 Merge pull request #335 from kuljoe4/fix/scanner-resilience-sl-conflict-1786841175507496449

Improve Scanner Resilience and Handle Binance SL Conflicts
---

## aa2cb3b fix(engine): improve scanner resilience and handle Binance SL conflicts

- Wrap `orderManager.enter` in a `try-catch` block in `ExecutionService` to ensure the scanner continues to the next opportunity if an entry fails.
- Enhance `OrderManagerService.placeStopLoss` to detect and surgically cancel conflicting orphan `closePosition` orders (Standard and Algo) when a placement conflict is encountered.
- Implement a 2-attempt retry loop for SL placement to recover from network errors and orphan order conflicts.
- Add unit tests in `orderManager.resilience.spec.ts` to verify the orphan cleanup and retry logic.

Co-authored-by: kuljoe4 <11159997+kuljoe4@users.noreply.github.com>

---
