## 2024-05-23 - Add Tooltip to Dashboard Search Clear Button
**Learning:** Adding a Tooltip to an icon-only clear button inside a relative-positioned search input container requires careful consideration of the `Tooltip` component's existing z-index and hover bounds. Using `Tooltip` for `XCircle` buttons greatly improves discoverability compared to bare `aria-labels`, especially for custom UI elements like `DashboardView`'s search. Implementing `Escape` to clear search aligns with expected accessibility behavior across all views.
**Action:** When adding clear buttons (`XCircle`) to search inputs, always wrap them in `<Tooltip content="Clear Search">` instead of just using `aria-label`, attach a `useRef` to refocus the input on clear, and bind `onKeyDown` to listen for the `Escape` key.

## 2024-05-23 - Add Aria-labels and Escape support to Search Inputs
**Learning:** ConfigModal.jsx's Watchlist search and Preset search inputs lacked `aria-label`s and support for clearing via the `Escape` key, creating inconsistency with `DashboardView` and `HistoryView` searches.
**Action:** Always ensure search inputs, especially those with clear buttons, have `aria-label`s or proper `id`/`htmlFor` associations and support `Escape` key to clear.
