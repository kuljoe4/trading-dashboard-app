# Implementation Plan: Mobile-Friendly Scanner, Header Optimization, Column Sorting & Collapsible Sticky Target Strategy

## Key Implementations Completed

1. **Header De-Cluttering & Resource/Space Optimization**:
   - Removed the bulky visible 400px+ telemetry bar from Row 1, replacing it with an ultra-compact status pill and WCAG-compliant screen-reader telemetry region.
   - Removed the noisy `🔥 Fast Market Expansion` alert bar and "Focus Movers" clutter from Row 2, replacing it with a clean candidate counter badge and active gating pill.
   - Removed the redundant, clunky `Filter:` and `Sort:` `<select>` dropdowns from Row 2.

2. **Interactive Column-Header Sorting (Desktop & Mobile)**:
   - Clickable column headers with visual sort direction indicators (`▲` / `▼`):
     - `#`: Resets to algorithm score sort
     - `Symbol & Trend` / `Symbol`: Toggles alphabetical sort (`symbol_asc` / `symbol_desc`)
     - `24h Change` / `Move`: Toggles percent change sort (`pct_desc` / `pct_asc`)
     - `Volume`: Toggles volume sort (`vol_desc` / `vol_asc`)
     - `Score`: Toggles score sort (`score_asc` / `score_desc`)
     - `Status`: Toggles opportunity proximity sort (`proximity` / `proximity_asc`)
   - Both Desktop table headers and Mobile headers support 1-tap sorting.

3. **Collapsible / Expandable Sticky Target Strategy & Watchlist Header**:
   - Pinned at the top of the scrollable scanner container (`sticky top-0 z-20` with blur backdrop).
   - In collapsed state (default on mobile screens < 768px):
     - Displays a slim ~36px summary strip with the active strategy title, solo coin (`Solo: LITUSDT` + In-Trade badge) or watchlist count (`Watchlist: 3 Pairs • AUTO`), and a `[Manage Watchlist ▼]` toggle button.
     - Leaves maximum vertical screen real estate for viewing live scanner candidates.
   - In expanded state:
     - Smoothly slides open the full `WatchlistManager` (Solo Mode Hero card, quick swap input, candidate picker, and 1-click recommendations) with a `[Collapse ▲]` button.
   - Pinned directly above the table column headers, remaining visible while scrolling through candidates.

4. **Mobile Responsiveness**:
   - Wordmark label `Live Scanner` collapses to icon-only on small mobile screens to prevent crowding the Strategy Selector Dropdown and Search box.
   - Solo Mode Hero Card adapts with `flex-col sm:flex-row` layout so action buttons wrap cleanly without horizontal scrolling on 320px-400px mobile devices.
   - Candidate picker and search inputs scale gracefully with touch-friendly tap targets.

5. **Verification**:
   - All 111 test suites (263 unit tests) passed with 100% success.
   - `compile_applet` confirmed clean build with zero TypeScript / bundling errors.
