## 2025-05-15 - [Initial Performance Audit]
**Learning:** The application uses a high-frequency WebSocket feed (ticks every 2s, scanner updates every 200ms) which triggers frequent re-renders of the entire DashboardView. Most UI components are functional and do not use React.memo, leading to unnecessary DOM reconciliations. DecisionLog also uses array indices as keys while prepending items, causing a full list re-render on every new log.
**Action:** Implement React.memo for core UI primitives and fix list rendering keys to minimize the impact of high-frequency state updates.
