# Refactoring Proposal: Momentum Engine Core Hardening

Based on the Industry Standard Evaluation, the following refactoring tasks are proposed to improve maintainability, reduce architectural drift, and enhance system reliability.

---

## 1. WebSocket Fidelity Logic Extraction
**Current State:** Complex trade-pruning and fidelity-selection logic (stripping sequences, logs, and metadata) is handled directly within the `wss` message handler in `server.ts`.
**Proposed Change:** Move this logic into `EngineBroadcasterService`. Introduce a `serializeTradeForClient(trade, clientContext)` method that applies the correct fidelity tier (Full, Mid, or Low) based on the client's focus mode.
**Benefit:** Decouples business/display logic from the transport layer. Improves testability of the pruning logic.

## 2. Event-Driven Decoupling of Core Services
**Current State:** `TradingSessionService`, `OrderManagerService`, and `PositionTrackerService` are tightly coupled using `forwardRef`.
**Proposed Change:**
- Transition `PositionTracker` to emit events (e.g., `TRADE_CLOSED`, `SL_ADJUSTED`) via `EventEmitter2`.
- `TradingSessionService` and `SessionService` should listen to these events to trigger persistence and broadcasts, rather than being called directly via injected references.
- Use a shared `State` service for read-access to active trades, reducing the need for services to inject each other just for data retrieval.
**Benefit:** Removes circular dependencies, simplifies the dependency graph, and makes services easier to unit test.

## 3. Indicator Convergence (Burn-in) Validation
**Current State:** Config validation checks indicator periods against `KLINE_MAX_CANDLES`, but there is no runtime check if a signal has enough data to be accurate.
**Proposed Change:** Update `SignalEngineService` to include an `insufficientData` flag in the `SignalDetail` if the number of available candles is less than `period * 2` (standard for EMA convergence). Add a runtime warning to the log if a signal fires without full convergence.
**Benefit:** Prevents "signal flicker" and inaccurate entries during the first few minutes after a session starts or a new symbol is added to the watchlist.

## 4. DB-Level Mutex for Atomic Saves
**Current State:** `SessionService` uses a local `Promise` chain to serialize trade saves.
**Proposed Change:** Transition to using TypeORM's `transaction` with `pessimistic_write` locks on the `Session` entity for the duration of the save-and-sync operation.
**Benefit:** Ensures data integrity even if the backend is scaled horizontally or restarted during a high-frequency update burst.
