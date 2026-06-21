# Palette's Journal - Critical UX & Accessibility Learnings

## 2026-06-12 - Tooltip Trigger Focus Standard
**Learning:** Radix UI tooltips with `asChild` require the immediate child to be natively focusable (like a `<button>` or having `tabIndex={0}`) for keyboard accessibility. Without this, keyboard users cannot discover or read the tooltip content.
**Action:** Always ensure tooltip triggers are focusable and have appropriate `focus-visible` styles.

## 2026-06-12 - Modal Escape Key Navigation
**Learning:** Users expect to be able to dismiss confirmation modals using the `Escape` key. High-stakes actions (like trade termination) should follow standard modal patterns to allow quick and intuitive cancellation.
**Action:** Implement `Escape` key listeners in all modal components.
