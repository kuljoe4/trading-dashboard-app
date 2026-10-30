# Static Watchlist Scheduler, Strict Limits & Double-Logging Resolution

## Overview
This implementation resolves two core operational needs:
1. **Double-Logging Resolution**: Diagnose and permanently eliminate duplicate decision log entries appearing in the UI and clipboard exports with identical timestamps down to the millisecond.
2. **Static Watchlist Scheduler & Dynamic Scanner Promotion**:
   - Strict watchlist capacity limits (e.g., if set to 1, strictly only 1 symbol stays on the list).
   - Automated rotation scheduler with configurable interval (e.g. 5m, 15m, 30m, 1h, 4h).
   - "No to change" (frozen/locked) mode to prevent automated rotation when desired.
   - Auto-promote top favorable opportunities from the dynamic scanner based on momentum score and signal readiness.
   - SRE Capital Safeguard: Never evict or rotate out a symbol that has an active open position.
   - High-efficiency UI/UX controls: Direct 1-click "Promote to Watchlist" on Scanner rows, interactive Watchlist Control Bar with live metrics, and limit selector.

---

## 1. Root Cause Analysis: Double Log
- **Mechanism**:
  - Live WebSocket broadcast: When an event occurs (e.g. order placed, balance update, trade closed, gating state change), the backend emits `log` via WebSocket without an explicit database ID.
  - In frontend `store/trading.js`: `normalizeLog` generates a random ephemeral ID (e.g., `Math.random()`).
  - Database status / fetchLogs sync: When `status` arrives with `logLines` or `fetchLogs()` is polled, the backend provides persisted DB logs containing database IDs (UUIDs).
  - Key mismatch in deduplication: `existingMap` in the status handler was keyed strictly on `l.id || ...`. Because the ephemeral random ID does not match the database UUID, the exact same log entry was inserted a second time into `st.logs`.
  - In `DecisionLog.jsx`: `visibleLogs` and `copyAllText` lacked an output deduplication filter on `(timestamp + msg)`.
- **Resolution**:
  - Deterministic log keys: Use `${source.ts_ms || source.ts}::${source.msg}` as canonical fingerprint.
  - Multi-condition deduplication in `status` and `fetchLogs`: Match by either ID or identical message within timestamp window.
  - Safeguard in `visibleLogs`: Enforce uniqueness on `(ts + msg)` so duplicate entries are never rendered or exported.
  - Debounce `[Gating] State changed` in backend engine.

---

## 2. Static Watchlist Architecture & Scheduler
- **Configuration Fields**:
  - `symbols`: `string[]` (active static symbols)
  - `watchlist_max_symbols`: `number` (e.g. 1, 2, 3, 5, 10; 0 for unlimited)
  - `watchlist_auto_rotate`: `boolean` (toggle scheduler on/off)
  - `watchlist_rotate_interval_min`: `number` (5, 15, 30, 60, 240 minutes)
  - `watchlist_min_score`: `number` (minimum score threshold for auto-promotion, default 75)
  - `watchlist_locked`: `boolean` ("no to change" / manual freeze mode)
- **Rotation Engine**:
  - Periodically (or on manual "Rotate Now" click), queries top opportunities from dynamic scanner.
  - Identifies most favorable candidate (highest score/momentum, all signals ready).
  - If already in watchlist, no change.
  - If new and watchlist is at limit (e.g. limit=1): finds an idle symbol (NOT in open position) and replaces it.
  - Emits descriptive log to Decision Log.
- **UI/UX Experience**:
  - **Watchlist Control Bar**: Placed directly above the Scanner table and on the Dashboard.
    - Active chips with live 24h %, momentum, in-position badges, and 1-click removal.
    - Capacity indicator (`1 / 1 (Max)`).
    - Limit selector dropdown (`1`, `2`, `3`, `5`, `10`, `Unlimited`).
    - Scheduler toggle (`Auto-Rotate` vs `Locked / No Change`) with interval selector.
    - Manual `Rotate Favorable Now` trigger.
    - Quick-add input with autocomplete.
  - **Scanner Row Action**:
    - Direct "Promote to Watchlist" button on each row in `ScannerOverlay.jsx`.
    - If at limit, automatically swaps or prompts cleanly.

---

## 3. Verification & Compliance
- Compliance with `AGENTS.md` (no automated leverage changes, correct WebSocket protocol, accessibility attributes).
- Zero regressions in order execution, risk gating, and position tracking.
