## 2026-07-23 - Settings Input Accessory Buttons Focus-Visible Accessibility
**Learning:** Input inline accessory buttons (such as clear 'X' buttons and visibility toggle 'Eye/EyeOff' buttons) can easily be skipped or remain visually un-identifiable to keyboard navigators when they receive focus. Enforcing distinct keyboard-driven WCAG accessibility focus styles (`focus-visible:ring-2 focus-visible:ring-accent` or `focus-visible:ring-purple` for testnet fields, paired with `focus-visible:outline-none rounded-md`) ensures perfect visual parity for keyboard-driven layouts.
**Action:** Always verify all inline input utility buttons have high-contrast focus rings and roundings matching their input fields to guarantee complete WCAG keyboard compliance.

## 2026-07-24 - Credentials Input Inline Accessory Button Tooltips
**Learning:** Icon-only inputs' utility elements, such as inline 'X' clear and 'Eye' show/hide controls, require immediate visual and screen-reader guidance to achieve WCAG/Radix compliance. Integrating `<Tooltip>` wrappers on these elements ensures they are fully understandable on hover/focus, creating a cohesive, professional UX throughout dense forms.
**Action:** Always wrap utility input accessories with `<Tooltip>` helpers and matching `aria-label` attributes to ensure consistent keyboard-driven and visual accessibility.

## 2026-07-25 - Search and Filter Accessory Clear Buttons Focus-Visible & Tooltip Standard
**Learning:** Dense trading dashboards with search inputs (such as decision logs, strategy config drawers, or scanner lists) frequently omit keyboard focus rings and tooltips for their inline clear buttons. Standardizing these accessory buttons with high-contrast keyboard-driven focus rings (`focus-visible:ring-2 focus-visible:ring-accent`), explicit screen-reader `aria-label` fields, and Radix-based `<Tooltip>` helpers provides a seamless, pro-grade accessibility flow for mouse and keyboard navigators.
**Action:** Ensure all accessory inputs' clear action buttons across logs, configs, and scanner components utilize focus-visible rings and tooltip triggers consistently.

## 2026-07-26 - Keyboard Shortcuts Modal Persistent Overlay and Auto-Closure Standard
**Learning:** In highly keyboard-driven, single-page application dashboards, displaying a global keyboard shortcut cheatsheet modal (such as on pressing `?`) can lead to confusing visual states if the modal is not automatically dismissed on navigation. When a user executes a hotkey or navigation link while the cheatsheet is open, keeping the modal active blocks the target viewport and forces manual dismissal. Automatically syncing modal visibility to routing/hash change events ensures a seamless, launcher-like transition.
**Action:** Always auto-dismiss global cheatsheet and help modals upon routing/hash change events to prevent overlay blocking.
