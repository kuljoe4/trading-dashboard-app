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
**Learning:** In technical domains like trading, acronyms and jargon (e.g., "RR", "Move", "Score") can be opaque to new users. Standardizing a discovery pattern using tooltips combined with subtle visual cues (`cursor-help` and `border-b border-dotted`) provides a non-intrusive way to educate users without cluttering the UI. This pattern is particularly effective for table headers and status badges where space is at a premium.
**Action:** Use Radix UI `Tooltip` for all technical acronyms and status indicators. Apply `cursor-help` and `border-b border-dotted border-dim/30` to text-based triggers to signify discoverable information.
