## 2026-07-23 - Settings Input Accessory Buttons Focus-Visible Accessibility
**Learning:** Input inline accessory buttons (such as clear 'X' buttons and visibility toggle 'Eye/EyeOff' buttons) can easily be skipped or remain visually un-identifiable to keyboard navigators when they receive focus. Enforcing distinct keyboard-driven WCAG accessibility focus styles (`focus-visible:ring-2 focus-visible:ring-accent` or `focus-visible:ring-purple` for testnet fields, paired with `focus-visible:outline-none rounded-md`) ensures perfect visual parity for keyboard-driven layouts.
**Action:** Always verify all inline input utility buttons have high-contrast focus rings and roundings matching their input fields to guarantee complete WCAG keyboard compliance.

## 2026-07-24 - Credentials Input Inline Accessory Button Tooltips
**Learning:** Icon-only inputs' utility elements, such as inline 'X' clear and 'Eye' show/hide controls, require immediate visual and screen-reader guidance to achieve WCAG/Radix compliance. Integrating `<Tooltip>` wrappers on these elements ensures they are fully understandable on hover/focus, creating a cohesive, professional UX throughout dense forms.
**Action:** Always wrap utility input accessories with `<Tooltip>` helpers and matching `aria-label` attributes to ensure consistent keyboard-driven and visual accessibility.
