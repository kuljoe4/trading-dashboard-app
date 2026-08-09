## 2026-07-23 - Settings Input Accessory Buttons Focus-Visible Accessibility
**Learning:** Input inline accessory buttons (such as clear 'X' buttons and visibility toggle 'Eye/EyeOff' buttons) can easily be skipped or remain visually un-identifiable to keyboard navigators when they receive focus. Enforcing distinct keyboard-driven WCAG accessibility focus styles (`focus-visible:ring-2 focus-visible:ring-accent` or `focus-visible:ring-purple` for testnet fields, paired with `focus-visible:outline-none rounded-md`) ensures perfect visual parity for keyboard-driven layouts.
**Action:** Always verify all inline input utility buttons have high-contrast focus rings and roundings matching their input fields to guarantee complete WCAG keyboard compliance.

## 2026-07-24 - Credentials Input Inline Accessory Button Tooltips
**Learning:** Icon-only inputs' utility elements, such as inline 'X' clear and 'Eye' show/hide controls, require immediate visual and screen-reader guidance to achieve WCAG/Radix compliance. Integrating `<Tooltip>` wrappers on these elements ensures they are fully understandable on hover/focus, creating a cohesive, professional UX throughout dense forms.
**Action:** Always wrap utility input accessories with `<Tooltip>` helpers and matching `aria-label` attributes to ensure consistent keyboard-driven and visual accessibility.

## 2026-07-25 - Search and Filter Accessory Clear Buttons Focus-Visible & Tooltip Standard
**Learning:** Dense trading dashboards with search inputs (such as decision logs, strategy config drawers, or scanner lists) frequently omit keyboard focus rings and tooltips for their inline clear buttons. Standardizing these accessory buttons with high-contrast keyboard-driven focus rings (`focus-visible:ring-2 focus-visible:ring-accent`), explicit screen-reader `aria-label` fields, and Radix-based `<Tooltip>` helpers provides a seamless, pro-grade accessibility flow for mouse and keyboard navigators.
**Action:** Ensure all accessory inputs' clear action buttons across logs, configs, and scanner components utilize focus-visible rings and tooltip triggers consistently.

## 2026-08-02 - Tooltip Backdrop and Interactive Trigger Click-Hijacking Prevention
**Learning:** Tooltips must remain completely lightweight, non-blocking, and transparent to underlying user interactions. Rendering a `fixed inset-0` backdrop (even with `pointer-events-none`) can interfere with mobile touch events and browser click propagation. Furthermore, custom touch/click handlers on tooltip triggers must never hijack clicks on interactive elements (like buttons, links, or inputs) on mobile/touch viewports, which blocks critical user actions like pausing or resuming strategies.
**Action:** Always ensure tooltips never render fullscreen backdrops, keep their portals completely non-blocking (`pointer-events-none`), and strictly gate trigger click/tap-to-toggle logic to non-interactive elements only.
