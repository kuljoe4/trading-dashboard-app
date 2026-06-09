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

## 2026-05-28 - Integrated Confirmation Patterns
**Learning:** Native browser primitives like `confirm()` disrupt the immersive experience of a themed dashboard. Using integrated components like `ConfirmationModal` allows for consistent styling and the addition of async loading states, which provides better feedback during destructive actions.
**Action:** Replace all instances of `confirm()` with the `ConfirmationModal` component and ensure a `loading` state is passed during async operations.

## 2026-06-05 - Semantic Accessibility for Interactive Cards
**Learning:** Purely clickable `div` elements are invisible to keyboard users and screen readers. Upgrading them with `role="button"`, `tabIndex={0}`, and explicit `aria-label` along with a keydown listener for Enter/Space creates a truly inclusive dashboard experience.
**Action:** Always wrap or upgrade top-level clickable containers in dashboards with proper ARIA attributes and keyboard event handlers.

## 2026-06-05 - Utility Micro-Delights
**Learning:** Adding a "Copy" utility next to primary identifiers (like ticker symbols) in detail views significantly improves user flow for multi-tool workflows (e.g., moving from dashboard to charting software).
**Action:** Identify primary keys or symbols in modals and provide a one-click `CopyButton` to reduce manual selection friction.

## 2026-06-05 - Semantic Accessibility for Nav and Cards
**Learning:** Adding aria-current="page" to navigation buttons provides essential context for screen reader users, indicating which view they are currently on.
**Action:** Always include aria-current for active states in navigation components.

## 2026-06-06 - Accessible Hover Utilities
**Learning:** Utilities that are only visible on hover (like 'Copy' buttons in dense grids) must also be visible on focus to ensure keyboard accessibility. Using `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` ensures a clean UI for mouse users while remaining fully inclusive.
**Action:** When adding hover-activated secondary controls, always include `focus-visible` or `group-focus-within` visibility classes.
