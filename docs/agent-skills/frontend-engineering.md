# Frontend Engineering & Modular React

## 1. State Management (Zustand)
- **Centralized Store:** Use a single source of truth (`trading.js`) for session state, logs, and scanner data.
- **Delta-Sync Handling:** Efficiently merge WebSocket updates into the local state to minimize re-renders.
- **Computed State:** Derive complex UI metrics (e.g., total risk, weighted PnL) within the store rather than in component render cycles.

## 2. Component Architecture
- **Primitive Decomposition:** Extract small, reusable atoms (`PulseDot`, `Btn`, `StatusBadge`) into a `primitives.jsx` library.
- **Logic Decoupling:** Keep view components (e.g., `DashboardView`) lean by delegating complex calculations to hooks or the store.
- **Tailwind + CLSX:** Use `twMerge` and `clsx` for robust, conditional styling that remains maintainable.

## 3. UI Resilience
- **Interceptors:** Use Axios interceptors to globally handle 401 Unauthorized errors and trigger Auth overlays.
- **Graceful Degradation:** Show skeleton states or "N/A" values when WebSocket data is stale or disconnected.
- **Safe Math:** Replicate backend precision logic in frontend formatting to ensure PnL consistency between server and UI.
