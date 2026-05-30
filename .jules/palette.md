## 2026-05-30 - Config Modal Interaction Stability
**Learning:** In 'vaul' drawers, horizontal scrolling containers (like tabs) and vertical scroll areas can conflict with the drag-to-dismiss gesture, leading to frustrating accidental closures on mobile.
**Action:** Apply 'data-vaul-no-drag' to all interactive scrollable regions within a bottom sheet. Combine this with sticky headers and backdrop-blur to maintain context and provide high-quality visual feedback during long configuration sessions.
