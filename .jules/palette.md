## 2026-05-28 - Persistent Risk Visibility
**Learning:** Users need consistent risk metrics across the dashboard, and having it persisted allows for better historical analysis.
**Action:** Added `risk_usdt` to the Trade model and entity to ensure it's available in both real-time ticks and the trade journal history.

## 2026-05-29 - Accessible Confirmation Feedback
**Learning:** Critical actions with two-stage confirmation (like closing positions or resetting data) need clear accessibility cues to ensure users with assistive technology understand the changing state of the button.
**Action:** Implemented a pattern using dynamic `aria-label` attributes and `aria-live="polite"` spans for all stateful confirmation buttons across the cockpit and settings.

## 2026-05-30 - Standardized Descriptive Tooltips
**Learning:** Native `title` attributes provide poor UX and inconsistent styling. Reusing the project's Radix-based `Tooltip` for all icon-only actions and supplementary data (like trade timestamps) ensures a cohesive "pro-grade" feel and better accessibility.
**Action:** Replaced all remaining native `title` attributes in `ConfigModal` and `HistoryView` with the styled `<Tooltip>` component.
