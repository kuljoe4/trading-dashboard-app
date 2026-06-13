# Project Standards & Conventions

## UI/UX & Component Patterns

### StatCard Component
To maintain consistency and readability across the dashboard:
- **Layout Hierarchy:** Must strictly follow a top-to-bottom vertical flow: `Label (Title)` -> `Value` -> `Sub-Value`.
- **Alignment:** Always use top-alignment (`items-start` on container, `self-start` on content wrapper).
- **Responsiveness:**
  - Titles must **never** be clipped; remove `truncate` from labels to allow wrapping.
  - Main numerical values may be truncated (`truncate`) if they are wide, to maintain card compactness.
  - Do not use `justify-between` or fixed heights that force elements to the bottom; let the content define the natural vertical flow.
- **Spacing:** Use consistent `gap-1` between card internal elements. Use `gap-y-4` in grid containers for consistent row spacing.

### Tooltip Implementation
- **Triggers:** Complex metric status labels or data points should use an `Info` icon (from `lucide-react`) as a visual trigger.
- **Content:**
  - When displaying multiple tiers or reference data, structure them clearly (e.g., using a grid or table format) inside the tooltip.
  - Include both a brief description and a clear mapping of ranges/thresholds.
