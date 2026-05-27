## 2025-05-14 - Exit Signal Price Formatting & SL Indicators

**Learning:** When displaying trading metrics, raw numbers can be ambiguous. Using currency symbols ($) for price-based signals and visual cues (dots/pulses) for dynamic state changes (like trailing SL) significantly reduces cognitive load.

**Action:** Always check the 'unit' of a metric before rendering. If it's a price or distance from entry, use a proper currency/price formatter. Add subtle visual indicators for background-processed changes that might not be immediately obvious.

## 2026-05-26 - Interactive Feedback for Copy Operations

**Learning:** Providing immediate visual confirmation (like an icon swap from 'Copy' to 'Check') for clipboard actions reduces user uncertainty and eliminates the need for redundant toast notifications in dense UIs.

**Action:** Use a local 'copied' state with a 2-second timeout to toggle icons and colors for copy buttons. Ensure 'e.stopPropagation()' is used if the button is nested within a clickable card.

## 2025-05-15 - Visual State Feedback for Toggles

**Learning:** Adding a subtle rotation animation to a chevron icon on expansion toggles provides an immediate and intuitive visual confirmation of the component's state, improving the perceived responsiveness of the interface.

**Action:** When implementing collapsible sections or detail views, include a chevron icon and animate its rotation (usually 180 degrees) using a library like `framer-motion` to match the transition of the content.
## 2026-05-27 - [Eco Mode Transparency] **Learning:** Automated power saving features should be visually communicated to the user to prevent confusion over data staleness. **Action:** Added real-time EcoBadges and power-state indicators synchronized with backend engine state.

## 2024-05-27 - [UX] Contextual Tab Icons
**Learning:** Dense configuration modals with many sections can be overwhelming. Adding small, relevant icons to tab triggers significantly aids visual scanning and helps users locate specific settings faster without reading every label.
**Action:** In multi-section interfaces, always pair text labels with a supporting icon to improve accessibility and navigation speed.
