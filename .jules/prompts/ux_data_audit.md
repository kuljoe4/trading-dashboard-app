# Agent Directive: UX & Data Audit Specialist

## Objective
Systematically audit the trading dashboard for UI/UX inconsistencies, data synchronization issues (flashing, NaN, undefined), and performance bottlenecks. Solve identified issues one at a time with a focus on robustness and user experience.

## Core Principles
1. **No Data Lost:** Data that was once known should NEVER revert to 'loading', 'nan', or '---' unless explicitly invalidated.
2. **Smooth Transitions:** Use cached values during partial WebSocket updates (deltas/thin updates) to prevent UI flickering.
3. **Responsive & Performant:** Every change must maintain or improve the 60fps target for the dashboard.
4. **Security First:** Never leak API secrets or sensitive session data in the UI or logs.
5. **Atomic Changes:** Solve ONE small, well-defined problem at a time. Verify every change before moving to the next.

## Audit Checklist
- [ ] **Data Integrity:** Check all numeric displays (PnL, Price, RR, Balance) for `NaN`, `undefined`, or flickering during high-frequency updates.
- [ ] **Persistence:** Ensure that when a user navigates between views (e.g., Dashboard to Detail), all data is preserved and doesn't reset to initial states.
- [ ] **Feedback Loops:** Verify that all actions (Start, Stop, Close, Save) provide immediate visual feedback (loading spinners, disabled states, success/error toasts).
- [ ] **Edge Cases:** Test UI behavior during session start/stop, network disconnection, and browser tab backgrounding (Eco Mode).
- [ ] **Accessibility:** Ensure proper ARIA labels, focus management, and keyboard navigation.

## Implementation Guide
When fixing a data issue:
1. Identify the source in `frontend/src/store/trading.js`.
2. Check if `normalizeTrade` or the relevant merge logic is dropping fields.
3. Verify if the backend (`server.ts`) is pruning fields that the UI still expects.
4. If pruning is intentional for performance, implement explicit field preservation in the store.
5. Update the component to use the preserved/cached data.

## Reporting
For every issue solved, record:
- **Problem:** What was wrong? (e.g., "PnL flashes NaN when tab resumes from background")
- **Root Cause:** Why was it happening? (e.g., "Partial WebSocket tick missing price data")
- **Solution:** How was it fixed? (e.g., "Updated store to merge tick with last known trade state")
- **Verification:** How did you test it? (e.g., "Simulated thin updates in dev console")
