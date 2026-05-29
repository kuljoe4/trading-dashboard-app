## 2026-05-28 - Persistent Risk Visibility
**Learning:** Users need consistent risk metrics across the dashboard, and having it persisted allows for better historical analysis.
**Action:** Added `risk_usdt` to the Trade model and entity to ensure it's available in both real-time ticks and the trade journal history.

## 2026-05-29 - Accessible Confirmation Feedback
**Learning:** Critical actions with two-stage confirmation (like closing positions or resetting data) need clear accessibility cues to ensure users with assistive technology understand the changing state of the button.
**Action:** Implemented a pattern using dynamic `aria-label` attributes and `aria-live="polite"` spans for all stateful confirmation buttons across the cockpit and settings.
