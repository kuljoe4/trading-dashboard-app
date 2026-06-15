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
## 2026-05-30 - Config Modal Interaction Stability
**Learning:** In 'vaul' drawers, horizontal scrolling containers (like tabs) and vertical scroll areas can conflict with the drag-to-dismiss gesture, leading to frustrating accidental closures on mobile.
**Action:** Apply 'data-vaul-no-drag' to all interactive scrollable regions within a bottom sheet. Combine this with sticky headers and backdrop-blur to maintain context and provide high-quality visual feedback during long configuration sessions.

## 2026-05-30 - Sync Feedback Visibility
**Learning:** Users perceive a "jumpy" UI as broken. If data is still loading or synchronizing, the UI should explicitly state it.
**Action:** Added "Synchronizing..." indicators to high-value metrics during WebSocket reconnection to manage user expectations and explain potential data staleness.

## 2026-05-31 - Power-User Navigation Shortcuts
**Learning:** For high-frequency "cockpit" interfaces, keyboard navigation significantly reduces cognitive load and physical movement, but shortcuts must be discoverable and safe from input focus conflicts.
**Action:** Implemented global shortcuts (1-3, S) with discoverability hints in tooltips and focus-aware suppression to ensure they don't fire during data entry.

## 2026-05-31 - Semantic Mnemonic Shortcuts
**Learning:** Numeric shortcuts are efficient but can be harder to remember than mnemonics (C for Cockpit, H for History). Providing both improves recall for different user types.
**Action:** Expanded global keyboard listeners to include 'C' and 'H' mnemonics and updated sidebar tooltips to communicate these alternative shortcuts, enhancing overall dashboard accessibility.

## 2026-06-13 - Standardized StatCard and Responsive Tooltip Hierarchy
**Learning:** Consistent data hierarchy (Title -> Value -> Sub-Value) and explicit top-alignment are critical for professional, readable dashboards. Tooltips should act as reference tables for tiers to improve utility.
**Action:** Established project-wide standards for `StatCard` layout (avoiding truncation for titles, explicit top-alignment, consistent gap) and Tooltip structure (adding 'Info' triggers, comprehensive tier reference tables).

## 2026-05-31 - Motion-Driven Confirmation Feedback
**Learning:** Static state changes in confirmation buttons can be missed if the user is focused on the data. Subtle motion (like sliding icons) combined with pulsing color cues provides a stronger affordance that the button is "armed" for a destructive action.
**Action:** Implemented a Framer Motion transition on the "Terminate Session" button icon to slide out of view during the confirmation phase, heightening the visual impact and reducing accidental double-taps.

## 2026-06-15 - Robust Layout via Flex Gap
**Learning:** The `space-y-*` Tailwind utility can cause inconsistent vertical spacing when used on containers with mixed child types (e.g., mixing `<section>` elements with `<motion.div>` or conditional elements) because it depends on specific DOM structure.
**Action:** Favor `flex flex-col gap-*` over `space-y-*` for containers with heterogeneous children, as it ensures uniform spacing regardless of the element type or dynamic rendering state, preventing layout regressions in deployed environments.

