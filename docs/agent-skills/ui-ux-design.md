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

## Reusable Patterns
- **Localized Error Feedback:** Auto-clearing inline alerts instead of intrusive modals.
- **Copy-to-Clipboard:** Quick-access buttons for technical identifiers (Symbols, IDs).
- Tooltip Technical Context: Hover states that explain complex technical metrics or strategy signals.

### 4. Layout Robustness
- **Prefer Flex Gap:** Use `flex flex-col gap-*` instead of `space-y-*` for container spacing, especially when dealing with heterogeneous child elements (e.g., mixing structural elements like `<section>` with conditional `<motion.div>` or other dynamic content). This ensures layout stability across varied deployment environments.
- **Natural Content Flow:** Avoid fixed container heights (e.g., `h-[450px]`) for scrollable content areas (like logs/feeds). Let the content define the container height dynamically based on available layout space, ensuring vertical consistency and responsive adaptability.
- **Desktop Strategy Utilization:** Maximize screen real estate by dynamically scaling the grid columns (e.g., expanding strategy card views to 3 columns on desktop), improving visual balance and information density without sacrificing readability.

