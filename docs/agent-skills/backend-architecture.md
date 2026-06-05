# Backend Architecture & Service Design

## 1. Modular Decomposition (NestJS)
- **Domain Services:** Separate concerns into specialized services:
  - `OrderManagerService`: Raw exchange execution.
  - `RiskEngine`: Validation and gating.
  - `PositionTracker`: In-memory state management.
  - `MarketFeedService`: External data ingestion.
- **Event-Driven Communication:** Use `@OnEvent` and `EventEmitter2` to decouple market data events from trade execution, preventing circular dependencies.

## 2. Data Integrity
- **Atomic Persistence:** Use promise-chain mutexes and pessimistic database locks (`pessimistic_write`) to ensure PnL and balance updates are thread-safe.
- **Migration Strategy:** Use versioned TypeORM migrations with `synchronize: false` to ensure non-destructive schema updates.
- **NaN Guards:** Explicitly check `Number.isFinite` before persisting financial values to the database.

## 3. High-Frequency Logic
- **Broadcaster Immutability:** The WebSocket broadcaster should never mutate shared trade objects; it should calculate ephemeral display values during serialization only.
- **Ticker Cache:** Maintain a high-performance in-memory cache for market prices to avoid repeated database or API lookups in the 1s hot loop.
- **Circular Ref Management:** Utilize `forwardRef()` for mandatory cross-service injections (e.g., between `ExecutionService` and `OrderManager`).
