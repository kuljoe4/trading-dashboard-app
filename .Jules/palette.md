## 2025-05-11 - [Accessibility for Trading Visualizations]
**Learning:** Data visualization components like PnL bars and sparklines are often overlooked for accessibility. Adding ARIA roles like `role="img"` and descriptive `aria-label` provides essential context for screen reader users without cluttering the visual UI.
**Action:** Always include `role="img"` and `aria-label` on SVG or custom-div based visualization components.

## 2025-05-11 - [Unified Button Primitive UX]
**Learning:** Consolidating raw HTML buttons into a single `Btn` primitive ensures that accessibility fixes (like `aria-label`) and interaction improvements (like disabled state cursors and transitions) propagate consistently throughout the dashboard cockpit.
**Action:** Prefer refactoring unique buttons to use the shared `Btn` primitive whenever possible to maintain UX standards.
