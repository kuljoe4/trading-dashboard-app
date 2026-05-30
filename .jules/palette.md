## 2026-05-28 - Persistent Risk Visibility
**Learning:** Users need consistent risk metrics across the dashboard, and having it persisted allows for better historical analysis.
**Action:** Added `risk_usdt` to the Trade model and entity to ensure it's available in both real-time ticks and the trade journal history.

## 2026-05-29 - Accessible Confirmation Feedback
**Learning:** Critical actions with two-stage confirmation (like closing positions or resetting data) need clear accessibility cues to ensure users with assistive technology understand the changing state of the button.
**Action:** Implemented a pattern using dynamic `aria-label` attributes and `aria-live="polite"` spans for all stateful confirmation buttons across the cockpit and settings.

## 2026-05-30 - Reliable PnL Display
**Learning:** Inconsistent PnL calculation during session termination (missing from fallback path) can lead to confusing "zero PnL" entries in the trade history.
**Action:** Implemented explicit PnL calculation in the engine's termination fallback to ensure that even forced trade closures provide accurate financial feedback in the UI.
## 2026-05-30 - Standardized Descriptive Tooltips
**Learning:** Native `title` attributes provide poor UX and inconsistent styling. Reusing the project's Radix-based `Tooltip` for all icon-only actions and supplementary data (like trade timestamps) ensures a cohesive "pro-grade" feel and better accessibility.
**Action:** Replaced all remaining native `title` attributes in `ConfigModal` and `HistoryView` with the styled `<Tooltip>` component.

## 2026-05-30 - Anti-Flicker Data Preservation
**Learning:** UX stability is compromised when UI elements (like "Deep Diagnostics") disappear and reappear as a loading state during partial updates.
**Action:** Modified component rendering to use locally cached data for complex states (exit signals) even during thin updates, ensuring the UI stays populated and stable while waiting for the next full sync.
