## 2026-05-26 - Trade Duration Tooltips
**Learning:** Displaying only duration (e.g. 5m) is sometimes insufficient for audit.
**Action:** Add tooltips with exact timestamps to duration labels to provide more context without cluttering the UI.
## 2024-05-26 - [Signal Transparency]
**Learning:** Users find dummy or placeholder authorization gates confusing ("Entry Authorization" showing random values).
**Action:** Integrate real-time signal firing counts into automation gating widgets to provide immediate feedback on why a trade is or isn't being entered.

## 2026-05-28 - [Accessible Technical Tooltips]
**Learning:** Complex technical indicators (e.g., "EMA Price Cross") can be intimidating for new users or when switching strategies. Native 'title' attributes provide poor UX and no styling control.
**Action:** Implement a reusable Radix-UI based Tooltip component with consistent project-themed styling (surface background, mono font) and use it to provide technical definitions and clear button actions across the dashboard.
