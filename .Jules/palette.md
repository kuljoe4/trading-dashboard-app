## 2025-05-14 - [Enhanced Button Primitives & Form Accessibility]
**Learning:** Generic primitives like `Btn` often miss critical states (disabled, focus) and attribute support (props spreading), which limits their accessibility and usability. Forms also frequently lack proper label-input associations.
**Action:** Always ensure UI primitives support `disabled` states, spread props for ARIA/title attributes, and have clear focus indicators. Use `htmlFor` and `id` to explicitly link labels and inputs.
## 2025-05-11 - [Accessibility for Trading Visualizations]
**Learning:** Data visualization components like PnL bars and sparklines are often overlooked for accessibility. Adding ARIA roles like `role="img"` and descriptive `aria-label` provides essential context for screen reader users without cluttering the visual UI.
**Action:** Always include `role="img"` and `aria-label` on SVG or custom-div based visualization components.

## 2025-05-11 - [Unified Button Primitive UX]
**Learning:** Consolidating raw HTML buttons into a single `Btn` primitive ensures that accessibility fixes (like `aria-label`) and interaction improvements (like disabled state cursors and transitions) propagate consistently throughout the dashboard cockpit.
**Action:** Prefer refactoring unique buttons to use the shared `Btn` primitive whenever possible to maintain UX standards.
