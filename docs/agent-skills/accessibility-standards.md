# Accessibility (A11y) Standards

## 1. Interactive Components
- **Keyboard Access:** Ensure all clickable cards (e.g., `ActiveTradeCard`) have `role="button"`, `tabIndex={0}`, and `onKeyDown` handlers for Enter/Space.
- **Explicit Labels:** Use `aria-label` on icon-only buttons (e.g., `CopyButton`, `KillSwitch`) to provide context to screen readers.
- **Focus Management:** Provide clear visual focus rings for all interactive elements, especially in high-density dashboards.

## 2. Dynamic Content
- **Live Regions:** Use `aria-live="polite"` for error messages and status updates to ensure assistive technologies announce changes.
- **Semantic Structure:** Use proper heading hierarchies and landmark regions (`nav`, `main`, `footer`) even in single-page cockpit layouts.
- **Meaningful Color:** Do not rely on color alone (Green/Red) to convey status. Include text labels (e.g., "LIVE", "STOPPED") and icons (Pulse dot, Zap) to provide redundant cues.

## 3. Modal & Dialog Accessibility (Radix UI)
- **Dialog Components:** `DialogContent` requires `DialogTitle` and `DialogDescription` components.
- **Linking:** If `DialogTitle` or `DialogDescription` are not direct children or are inside `VisuallyHidden`, use explicit `aria-labelledby` and `aria-describedby` attributes on `DialogContent` linked to `id`s on the title/description elements.
- **Hiding:** Use `VisuallyHidden` to wrap `DialogDescription` or other accessibility-only content to satisfy screen reader requirements without cluttering the visual UI.

## 4. Inclusive Design
- **Monospace Readability:** Ensure monospace fonts used for technical data maintain high contrast ratios against dark backgrounds.
- **Touch Targets:** Maintain minimum tap targets (44x44px) for critical controls like "Kill" or "Stop," even when the layout is high-density.
- **Visually Hidden Labels:** Use the `VisuallyHidden` component to provide context that is only accessible to screen readers without cluttering the visual UI.
