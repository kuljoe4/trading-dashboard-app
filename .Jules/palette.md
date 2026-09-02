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

## 2026-07-27 - Global Text Input Focus-Visible Accessibility Standard
**Learning:** Under high-contrast, dark-mode dashboard environments, interactive inputs and textareas that only apply standard border hover transitions frequently fail visual-gating requirements for keyboard-driven navigation. Upgrading all text fields to apply explicit `focus-visible:ring-2` focus rings that match the context theme (such as purple for testnet elements and accent blue for live elements) establishes absolute visual parity and keyboard accessibility.
**Action:** Ensure all input fields, textareas, search inputs, and manual tracking fields use theme-aligned `focus-visible:ring-2` rules paired with `focus-visible:outline-none`.

## 2026-07-28 - Frontend Hash Routing E2E Test Warmup
**Learning:** In single-page applications where view states are managed via custom hash routers, cold-starting directly into deeply nested routes (e.g. `#/settings`) during visual automated testing (like Playwright) often results in a blank view or redirection. This occurs because early hydration guards check if the store has hydrated before registering the global hashchange event listeners. First loading the default cockpit route (`#/`), waiting for hydration, and then performing hash transitions guarantees consistent view initialization.
**Action:** Always warm-start E2E testing flows on the root route (`#/`), wait for store hydration, and then navigate to nested subviews.

## 2026-07-29 - Search Inputs Keyboard Focus-Visible & Preset Clear Tooltip Cohesion
**Learning:** Inline icon-only clear buttons (such as the preset search clear button inside the strategy configuration modal) can easily omit tooltips or aria-labels, making them confusing or invisible to keyboard and screen-reader users. Additionally, dense views like `HistoryView.jsx` can forget high-contrast keyboard-driven focus rings (`focus-visible:ring-2 focus-visible:ring-accent`), violating WCAG 2.1 AAA compliance and dark mode accessibility rules.
**Action:** Ensure all accessory search inputs' clear buttons across modals are consistently wrapped with descriptive Radix tooltips and that every interactive text input/search bar possesses theme-aligned focus-visible rings.

## 2026-07-29 - Unmounting Clear Search Buttons Focus Recovery Standard
**Learning:** In highly interactive, keyboard-navigated single-page applications, conditionally rendering clear buttons inside search fields (e.g., search inputs in `HistoryView.jsx` or `DecisionLog.jsx`) creates an accessibility trap. When the user activates the clear button, the search state is cleared, which immediately unmounts the clear button itself. Because the element that had focus is now gone, the browser drops focus back to the `<body>` element, disrupting keyboard navigation flow. Explicitly recovering focus by shifting it back to the corresponding search input on clear prevents context disruption.
**Action:** Always bind a ref to search input elements and programmatically restore focus to them when clearing search query states.

## 2026-07-31 - Search Input Keyboard Shortcut Inline Badge Standard
**Learning:** Text-based placeholder keyboard hints (like `... [/]`) look cluttered, reduce visual polish, and are completely invisible on secondary search forms that omit them. Replacing them with a styled, absolute-positioned `/` keyboard shortcut badge (`<kbd>`) that fades out seamlessly on focus (`group-focus-within:opacity-0`) and unmounts to make room for clear buttons when a query is entered dramatically elevates SPA look-and-feel and accessibility.
**Action:** Always wrap search input elements inside a relative `group` parent, update right padding to standard spacing (e.g. pr-10), and conditionally render a styled `/` `<kbd>` badge when empty that fades out on group-focus-within.

## 2026-08-01 - Global Search Input Focus Recovery and Modal Viewport Management
**Learning:** In highly interactive, single-page application dashboards, display and transition states should never disrupt user flow. Specifically, (1) clearing a text-based search input must programmatically recover focus to the input element via refs to prevent keyboard focus loss or accidental page traps, and (2) global helpers like cheatsheets (e.g. keyboard shortcuts) must automatically close on hash routing changes to prevent overlay blocking when using hotkeys.
**Action:** Establish strict ref-based focus recovery on all accessory clear triggers and sync modal toggles to hash changes to prevent persistent layout blocking.

## 2026-08-02 - Tooltip Backdrop and Interactive Trigger Click-Hijacking Prevention
**Learning:** Tooltips must remain completely lightweight, non-blocking, and transparent to underlying user interactions. Rendering a `fixed inset-0` backdrop (even with `pointer-events-none`) can interfere with mobile touch events and browser click propagation. Furthermore, custom touch/click handlers on tooltip triggers must never hijack clicks on interactive elements (like buttons, links, or inputs) on mobile/touch viewports, which blocks critical user actions like pausing or resuming strategies.
**Action:** Always ensure tooltips never render fullscreen backdrops, keep their portals completely non-blocking (`pointer-events-none`), and strictly gate trigger click/tap-to-toggle logic to non-interactive elements only.

## 2026-08-10 - Consolidating Copy-to-Clipboard Accessibility and De-duplication
**Learning:** Manual clipboard copy logic in modals can lead to duplicated state management and inconsistency in focus rings, visual tooltips, and state-clearing transitions. Replacing these manual implementations with a reusable, highly accessible `<CopyButton>` primitive ensures consistent visual feedback, standardizes custom transition states ("Copy" -> "Copied!"), and enforces keyboard-driven focus rings and descriptive ARIA attributes seamlessly across all modals.
**Action:** Always replace manual copy-to-clipboard interactions and local state tracking with a unified design system `<CopyButton>` wrapper.

## 2026-08-14 - Settings View Switch Accessibility and Click Target Standard
**Learning:** Dense toggle panels in system configurations often separate text descriptions from active switches, limiting the interactive hit target to the small toggle switch itself and violating WCAG 2.1 touch target guidelines. Wrapping the description text in a semantic `<label>` element bound to the switch `<button>` via matching `htmlFor` and `id` properties, paired with `cursor-pointer flex-grow`, drastically expands the clickable hit target for better responsive usability and perfect screen-reader associations.
**Action:** Always ensure all toggle/switch controls utilize matching `<label>` elements for expanded click hit targets and seamless keyboard/touch navigation.

## 2026-08-15 - Keyboard Shortcut Cheatsheet Interactivity and Accessibility Standard
**Learning:** Displaying shortcut keys inside a static modal list misses an opportunity to turn the cheatsheet into an interactive command palette. Converting shortcut rows into semantic `<button>` elements equipped with `aria-label` descriptions (including action label and keys), hover highlights, and `focus-visible:ring-2` focus indicators allows users to either press the hotkey or click the shortcut row directly to execute actions (like view navigation or search focusing).
**Action:** Always render shortcut rows in cheatsheet modals as interactive `<button>` elements with clear `aria-label` strings and action handlers.

## 2026-08-16 - Navigation Active Position Context & Button Semantics Standard
**Learning:** Navigation buttons (such as bottom bar tabs or sidebar navigation buttons) that render visual notification badges (like active position counts) often fail to communicate those badge updates to screen reader users if the `aria-label` is static. Dynamically incorporating active position counts into the `aria-label` (e.g. "Trades (2 active positions)") alongside explicit `type="button"` and `cursor-pointer` declarations provides complete auditory parity and standard button semantics across both desktop and mobile viewports.
**Action:** Ensure navigation items with badge indicators dynamically enrich their `aria-label` strings with badge context for screen readers.

## 2026-08-31 - Confirmation Modal In-Flight Loading Backdrop & Accessible Button Standard
**Learning:** Confirmation modals performing critical, asynchronous actions (such as emergency position liquidations) create UX and state-integrity risks if backdrop click-to-dismiss handlers or dialog close buttons remain active while requests are in flight. Guarding `onOpenChange` with `!loading`, switching the overlay backdrop to `cursor-wait`, disabling dialog close buttons during `loading={true}`, and supplying explicit `aria-label` and `type="button"` attributes ensures safe-by-default, WCAG-compliant dialog interactions.
**Action:** Always guard dialog `onOpenChange` state dismissals against in-flight loading operations and enforce explicit button ARIA labels across confirmation modals.

## 2026-09-01 - Informative System Metrics Tooltip & Keyboard Focus Standard
**Learning:** Informative dashboard metric elements (such as rate limits or risk level badges) that render tooltips on mouse hover are often completely skipped during keyboard tabbing (`Tab` key) and ignored by screen readers if wrapped in plain, non-focusable `<div>` elements. Adding `tabIndex={0}`, dynamic/descriptive `aria-label` strings, and high-contrast theme focus rings (`focus-visible:ring-2 focus-visible:outline-none`) ensures screen readers announce the exact live values and keyboard users can reveal tooltips on focus.
**Action:** Always ensure informative metric badges with tooltips feature `tabIndex={0}`, descriptive `aria-label` properties, and theme-aligned focus-visible rings.

## 2026-09-02 - Active Position Bar Button Semantics and Landmark Role Avoidance
**Learning:** Adding `role="region"` to small inline UI elements (such as estimated Stop Loss PnL badges inside active position bars) violates WAI-ARIA landmark guidelines and creates landmark pollution for screen readers. Instead, making inline informative badges focusable (`tabIndex={0}`) with explicit `aria-label` descriptions, Radix `<Tooltip>` wrappers, and focus-visible rings (`focus-visible:ring-1 focus-visible:ring-accent`) provides full keyboard and screen reader accessibility without landmark clutter.
**Action:** Never apply landmark roles (`role="region"`) to small inline badges or buttons; use `tabIndex={0}` and descriptive `aria-label` attributes instead.
