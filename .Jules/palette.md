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

## 2026-06-14 - Context-Aware Feedback for Shared Utility Primitives
**Learning:** Generic utility components like `CopyButton` often lack sufficient context when used for bulk actions or specific fields. Extending these primitives to support context-aware tooltips (e.g., "Copy All Visible Logs" vs "Copy") significantly improves user confidence during high-stakes operations. Additionally, safety mechanisms like the lock in `InteractiveLimitCard` require explicit educational tooltips to prevent user frustration when controls appear disabled but are actually just guarded.
**Action:** Always provide `tooltip` and `successTooltip` props for copy/action primitives. Ensure all "guarded" UI states (locks, throttles) have descriptive tooltips explaining how to transition to an active state.
