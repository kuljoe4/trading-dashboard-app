## 2025-05-16 - Accessible Interactive Headers and Utility Buttons
**Learning:** Interactive accordion headers implemented as `div`s require explicit ARIA roles, tab indexing, and keyboard event handlers (Enter/Space) to be accessible. Utility buttons like "Copy" should be hidden by default to maintain high data density but must be revealed on both hover *and* focus-visible to ensure keyboard users can discover and use them.
**Action:** Always add `role="button"`, `tabIndex={0}`, and `onKeyDown` to non-native interactive elements. Use `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` for micro-interactions.

## 2025-05-16 - Robust Frontend Verification Workaround
**Learning:** Frontend verification in restricted environments often fails due to remote font-loading timeouts. Blocking font requests (`context.route("**/*.{ttf,woff,woff2,otf}", lambda route: route.abort())`) and injecting fallback system fonts (`* { font-family: sans-serif !important; }`) reliably bypasses these hangs. Additionally, mocking backend APIs using `page.route` prevents "Network Error" alerts and allows verification of data-dependent UI states.
**Action:** Use font-blocking and API mocking in Playwright scripts when remote assets or backend connectivity is unreliable.

## 2026-06-11 - Intuitive Labeling and Mobile Layout Robustness
**Learning:** Technical labels like "SL Distance" and "Initial Risk" are often ambiguous to users. Using explicit, context-aware names like "Stop Distance (Live)" and "Max Entry Risk" combined with helper tooltips significantly improves mental model alignment. Additionally, absolute-positioned elements (like timers) in compact mobile layouts frequently cause overlaps; integrating these into the natural flex flow of labels ensures layout stability across all screen sizes.
**Action:** Prioritize descriptive, long-form labels with tooltips for critical metrics. Avoid absolute positioning for content that can vary in length (like timers or prices) to prevent UI collisions on small screens.

## 2026-06-11 - Decision Log Parsing and Filterable Discovery
**Learning:** Dense activity logs are difficult to parse without visual cues. Word-based regex highlighting (e.g., coloring "BUY" green and "SELL" red) significantly reduces cognitive load. Furthermore, horizontal scrolling for long log lines is essential on mobile to prevent clipping or excessive vertical growth that breaks the "sticky" interaction patterns.
**Action:** Implement search/filtering for all log-heavy components. Use context-aware color coding for domain-specific keywords. Always enable `overflow-x-auto` with `whitespace-nowrap` for technical log entries.

## 2026-06-11 - Decision Log Detail and Global Clipboard Access
**Learning:** For high-density log feeds, a detail modal provides much-needed focus for inspecting specific events. Pairing individual log inspection with a "Copy All" capability at the header level optimizes for both forensic deep-dives and quick status sharing. Consistent modal design (using Radix Dialog) ensures these micro-interactions feel like a native part of the engine's orchestration layer.
**Action:** Provide `Dialog`-based detail views for list items. Implement "Copy All" with visual feedback in log headers. Maintain 1:1 design language between trade and log modals.

## 2026-06-15 - Global Search Shortcut Guarding and Interaction
**Learning:** Global keyboard shortcuts (like `/` for search) must include strict target guards (checking against `INPUT`, `TEXTAREA`, or `isContentEditable`) to prevent hijacking the user's natural typing flow within those fields. Additionally, pairing `focus()` with `select()` on search inputs dramatically improves UX by allowing users to immediately overwrite a previous query without manual deletion.
**Action:** Always guard global shortcuts with `e.target` checks. Use `searchInput.select()` after `focus()` for one-touch query replacement.

## 2026-06-23 - Destructive Modal Safety and Accessibility
**Learning:** Destructive confirmation modals must implement a "safe-by-default" focus strategy by auto-focusing the non-destructive action (e.g., 'Cancel'). This prevents accidental data loss from rapid 'Enter' key presses. Proper ARIA wiring (`role="alertdialog"`, `aria-labelledby`, `aria-describedby`) and `Escape` key listeners are essential for screen readers and keyboard power users. Additionally, exit animations in conditional React components require `AnimatePresence` to be situated around the condition to ensure the 'Exit' state transitions correctly before the component is unmounted.
**Action:** Use `useRef` and `useEffect` with a small debounce to focus the 'Cancel' button. Always wrap modal conditions in `AnimatePresence`. Link titles and descriptions to ARIA IDs.

## 2026-06-25 - Standardizing Information Discovery for Technical Jargon
**Learning:** In trading environments, visual density is high, making explicit text labels difficult to fit. A standard way to provide educational details without visual clutter is pairing tooltips with subtle visual cues (`cursor-help` and a dotted underline). This provides non-intrusive discovery of acronym definitions (like "RR", "MFE", "SL") for screen-reader and mouse users alike.
**Action:** Use Radix UI `Tooltip` on technical headers and badges, styled with `cursor-help` and a light dotted border.

## 2026-07-04 - Stable Sidebar Tooltip Anchoring
**Learning:** Tying navigation tooltips to volatile hover states (e.g., `isExpanded`) causes them to flicker or fail to appear during the "hover-to-expand" transition. Anchoring them strictly to the underlying `collapsed` state from the store ensures they remain active and reliable for keyboard users and quick-hover interactions in the narrow sidebar.
**Action:** Use the base `collapsed` state for sidebar tooltip triggers instead of derived hover states to maintain shortcut hint visibility.

## 2026-07-04 - Keyboard Shortcut Discoverability and Tooltip Redundancy
**Learning:** Communicating global keyboard shortcuts visually (e.g., via `group-hover` hints) significantly improves user productivity. However, tooltips that repeat these shortcuts become redundant and visually distracting when the sidebar is expanded and the labels/hints are already visible.
**Action:** Use subtle mono-spaced hints (e.g., `opacity-0 group-hover:opacity-100`) to teach shortcuts. Conditionally disable tooltips when the parent container is expanded to minimize UI noise.

## 2024-07-13 - Focusable Dashboard Metrics for Information Discovery
**Learning:** High-density dashboard cards (like `StatCard`) often hide essential context in tooltips. Making these cards keyboard-focusable via `tabIndex={0}` only when tooltips are present ensures keyboard users can access the same informational depth as mouse users. Synchronizing focus visuals (`focus-visible`) with existing hover states maintains a cohesive aesthetic.
**Action:** Use conditional `tabIndex` and `group-focus-visible` to reveal supplemental information on interactive dashboard components.

## 2026-07-13 - Keyboard Discoverability for Hover-Only Utilities
**Learning:** Utility elements like "Copy" buttons or keyboard shortcut hints that are hidden by default to maintain data density are often inaccessible to keyboard users. Synchronizing their visibility with both `hover` and `focus-visible`/`focus-within` states ensures parity between mouse and keyboard interaction models without cluttering the baseline UI.
**Action:** Use `group-focus-visible:opacity-100` or `group-focus-within:opacity-100` on parent containers to reveal hidden utility children when they or their parent receive keyboard focus.

## 2026-07-16 - Screen Reader Accessibility in Forms and Search Fields
**Learning:** High-density inputs (such as search boxes and preset naming fields) are frequently stripped of visible text labels to maintain a sleek, clean, modern UI. However, this pattern leaves screen-reader users completely disoriented. Providing an explicit `aria-label` or wrapping hidden labels in a custom `<VisuallyHidden>` component linked to inputs with a unique generated ID (via React's `useId`) restores accessibility parity without introducing any visual clutter or layout shifts.
**Action:** Always provide an `aria-label` for search/filter inputs, and use `useId` paired with `<VisuallyHidden><label htmlFor={id}>` for un-labeled high-density text fields. Ensure all icon-only utility buttons have meaningful context-aware ARIA attributes.
