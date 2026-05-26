## 2025-05-14 - Exit Signal Price Formatting & SL Indicators

**Learning:** When displaying trading metrics, raw numbers can be ambiguous. Using currency symbols ($) for price-based signals and visual cues (dots/pulses) for dynamic state changes (like trailing SL) significantly reduces cognitive load.

**Action:** Always check the 'unit' of a metric before rendering. If it's a price or distance from entry, use a proper currency/price formatter. Add subtle visual indicators for background-processed changes that might not be immediately obvious.

## 2026-05-26 - Interactive Feedback for Copy Operations

**Learning:** Providing immediate visual confirmation (like an icon swap from 'Copy' to 'Check') for clipboard actions reduces user uncertainty and eliminates the need for redundant toast notifications in dense UIs.

**Action:** Use a local 'copied' state with a 2-second timeout to toggle icons and colors for copy buttons. Ensure 'e.stopPropagation()' is used if the button is nested within a clickable card.
