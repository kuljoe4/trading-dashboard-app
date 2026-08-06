# UI/UX Expert: Operator Cockpit Philosophy

## Core Principles
The application follows an "Operator Cockpit" philosophy, prioritizing real-time awareness and actionable data over aesthetic marketing.

### 1. Real-Time Awareness
- **Visual Pulse:** Use `PulseDot` and ping animations to indicate live connectivity.
- **Dynamic Indicators:** Progress bars (e.g., `ConditionWidget`) show real-time proximity to thresholds.
- **Price Runways:** Visual mapping of Stop-Loss (SL), Entry, and Take-Profit (TP) levels relative to current price.

### 2. Information Density
- **High-Density Cards:** `StatCard` and `ActiveTradeCard` maximize information in small footprints using monospace fonts for values.
- **Tiered Layouts:** Responsive strategy that rearranges components for Desktop Cockpits vs. Mobile Glance views.

### 3. Safety & Trust
- **Color Semantics:** Strict adherence to color codes (Green for Success/TP, Red for Danger/SL, Amber for Warning/Paper).
- **Paper Mode Distinction:** Visual "Sandbox" state (e.g., Amber borders/badges) to prevent confusion with live trading.
- **Decision Logs:** Transparent logging of "why" the bot didn't take a trade to build user confidence.

## Data Accuracy
- **Consistency:** Prioritize backend-calculated performance metrics (e.g., PnL%, Drawdown) over local frontend calculations to ensure accuracy across all views, especially regarding account-level scaling (deposits/withdrawals) and balance history. Frontend should leverage backend analytics output directly.

## Reusable Patterns
- **Localized Error Feedback:** Auto-clearing inline alerts instead of intrusive modals.
- **Copy-to-Clipboard:** Quick-access buttons for technical identifiers (Symbols, IDs).
- **Tooltip Technical Context:** Hover states that explain complex technical metrics or strategy signals.
- **Radix UI Primitives:** When using `Portal` from any Radix UI primitive, it MUST wrap exactly one single child element (e.g., a `div`). If multiple elements (e.g., a backdrop and the content) are required, they must be wrapped within a single container `div`.


### 4. Layout Robustness
- **Prefer Flex Gap:** Use `flex flex-col gap-*` instead of `space-y-*` for container spacing, especially when dealing with heterogeneous child elements (e.g., mixing structural elements like `<section>` with conditional `<motion.div>` or other dynamic content). This ensures layout stability across varied deployment environments.
- **Natural Content Flow:** Avoid fixed container heights (e.g., `h-[450px]`) for scrollable content areas (like logs/feeds). Let the content define the container height dynamically based on available layout space, ensuring vertical consistency and responsive adaptability.
- **Desktop Strategy Utilization:** Maximize screen real estate by dynamically scaling the grid columns (e.g., expanding strategy card views to 3 columns on desktop), improving visual balance and information density without sacrificing readability.
- **Avoid Justify-Between:** Never use `justify-between` on components meant to follow a strict top-to-bottom vertical flow (e.g., `InteractiveLimitCard`). Use `flex-grow` on content containers instead to allow elements to fill available space naturally without breaking the hierarchical structure.

### 5. Component Ref Management
When creating UI components meant to be used as children of Radix UI primitives using the `asChild` prop:
- **Always** use `React.forwardRef` to ensure the `ref` is passed down to the underlying DOM node.
- **Avoid** wrapping `forwardRef` components with `React.memo` unless necessary. If `React.memo` is required, the `React.memo(React.forwardRef(...))` pattern *should* work, but if you encounter runtime ref warnings, prioritize `React.forwardRef` alone, as it directly addresses the component's inability to receive refs.
- **Always** set `displayName` explicitly for debugging and stack traces.

