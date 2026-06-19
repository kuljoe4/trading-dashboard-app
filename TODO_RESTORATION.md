# Restoration TODO Plan (PR #341 Regressions)

This plan outlines the remaining work to restore functionality and optimizations regressed by PR #341, based on the commit history from PRs #336-#340.

## 1. Trading Analytics Suite (`backend/node/src/engine/analytics.service.ts` & `frontend/src/lib/analytics.js`)
- [ ] **Task:** Restore high-performance single-pass algorithms for Sharpe, Sortino, and Profit Factor.
- [ ] **Reference:** Commit `46ba5b7` (Backend engine & Frontend utils).
- [ ] **Verification:** Run `backend/node/src/engine/analytics.service.spec.ts`.

## 2. History UI/UX (`frontend/src/views/HistoryView.jsx`)
- [ ] **Task:** Restore session duration tracking, color-coded risk metrics, and consolidated performance percentages.
- [ ] **Reference:** Commit `46ba5b7`, `4db6736`.
- [ ] **Verification:** Manual check of HistoryView rendering and interactivity.

## 3. Core Engine Concurrency & Accuracy
- [ ] **Task:** Review and ensure the atomic closure locks (`closingSymbols` in `PositionTrackerService`) and PnL audit logging are correctly implemented.
- [ ] **Reference:** Commit `b1e5622` (PR #339).
- [ ] **Verification:** Run `backend/node/src/engine/orderManager.resilience.spec.ts` and `pnl_verification.spec.ts`.

## 4. Session Migration
- [ ] **Task:** Re-implement `1718000000000-AddEndTimeToSession.ts` migration.
- [ ] **Reference:** Commit `46ba5b7`.
- [ ] **Verification:** Ensure database schema reflects the new `endTime` field.

---
*Note: Before applying each item, check if subsequent PRs (#342-#348) have already addressed the issue or introduced conflicting improvements.*
