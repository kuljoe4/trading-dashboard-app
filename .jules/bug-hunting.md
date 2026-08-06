# Bug-Hunting Investigation Log

Cycle: #1
Task: Audit `Trade` and `TradeEntity` for field parity.
Objective: Identify missing or mismatched fields between `backend/node/src/models/Trade.ts` and `backend/node/src/models/entities/Trade.entity.ts` to prevent data loss or type errors during persistence.
Evidence:
- `TradeEntity` (Entity): `@Column('decimal', { precision: 20, scale: 8 }) qty: number;`
- `Trade` (Model): `qty: number = 0;`
- `TradeEntity` (Entity): `@Column({ type: 'varchar', nullable: true }) binance_stop_order_type: string | null;`
- `Trade` (Model): `binance_stop_order_type?: 'standard' | 'algo';`
Findings:
- The `Trade` model and `TradeEntity` are synchronized regarding primary fields.
- `binance_stop_order_type` is correctly mapped from union type to varchar.
- Legacy fields `quantity` and `_last_funding_delta` were found to be missing from the model despite memory instructions.
Hypotheses:
1. Potential for regressions if legacy components access `quantity`.
Confidence: High
Next Task: Inspect PnL aggregation logic in `SessionService`.

Cycle: #2
Task: Inspect PnL aggregation in `SessionService`.
Objective: Verify that `executeSaveTradeAtomic` correctly aggregates PnL from both OPEN and CLOSED trades.
Evidence:
- `SessionService.executeSaveTradeAtomic` (Lines 343-356) includes `OPEN` trades in the PnL summation for live/testnet modes.
- `TERMINAL_STATUSES` are correctly used alongside `"OPEN"`.
Findings:
- The aggregation logic correctly incorporates `OPEN` trades, ensuring that fees and funding are reflected in `totalPnl`.
Hypotheses:
1. Logic is robust against external balance changes in live mode.
Confidence: High
Next Task: Verify legacy field presence in `Trade.ts`.

Cycle: #3
Task: Verify legacy fields in `Trade` model.
Objective: Confirm if `quantity` and `_last_funding_delta` are missing from `Trade.ts`.
Evidence:
- `grep` for these fields in `Trade.ts` returned no results.
Findings:
- Legacy fields are missing, violating the "retained to prevent regressions" rule in memory.
Hypotheses:
1. Missing fields could cause `undefined` errors in `maintenance.service.ts`.
Confidence: High
Next Task: Restore legacy fields in `Trade.ts`.

Cycle: #4
Task: Restore legacy fields in `Trade` model.
Objective: Add `quantity` and `_last_funding_delta` back to `backend/node/src/models/Trade.ts`.
Evidence:
- Applied patch to `Trade.ts`.
Findings:
- Compatibility restored.
Hypotheses:
1. Regression risk mitigated.
Confidence: High
Next Task: Verify `binance_stop_order_type` usage in `OrderManagerService`.

Cycle: #5
Task: Verify `binance_stop_order_type` usage.
Objective: Confirm assignment logic for stop order types.
Evidence:
- `OrderManagerService.placeStopLoss` and `updateStopLoss` correctly assign `'standard'` or `'algo'`.
Findings:
- Logic is consistent with model and entity definitions.
Hypotheses:
1. No inconsistency found.
Confidence: High
Next Task: Verify `_sig_json` persistence.

Cycle: #6
Task: Verify `_sig_json` persistence.
Objective: Confirm `_sig_json` is correctly updated and persisted.
Evidence:
- Updated in `OrderManagerService.checkExitSignals`.
- Persisted in `SessionService.executeSaveTradeAtomic`.
Findings:
- Change detection mechanism is intact.
Hypotheses:
1. Broadcaster correctly identifies state changes.
Confidence: High
Next Task: Check `SessionStateService` mutex.

Cycle: #7
Task: Check `SessionStateService` mutex.
Objective: Verify the `entryInProgress` lock.
Evidence:
- Implemented in `SessionStateService` and respected in `ExecutionService`.
Findings:
- Sequential entry processing is enforced.
Hypotheses:
1. Prevents race conditions during simultaneous signal fires.
Confidence: High
Next Task: Verify `AuditLog` metadata.

Cycle: #8
Task: Verify `AuditLog` metadata.
Objective: Confirm extraction of `actor`, `ip`, and `userAgent`.
Evidence:
- Captured in `startSession` and `closeTradeManually`.
Findings:
- Auditing pattern is correctly implemented.
Hypotheses:
1. Provides full audit trail for sensitive actions.
Confidence: High
Next Task: Verify `BinanceRequestQueue` priority system.

Cycle: #9
Task: Verify `BinanceRequestQueue` priority system.
Objective: Inspect 4-tier priority and shedding thresholds.
Evidence:
- 4 tiers (EMERGENCY, CRITICAL, OPERATIONAL, BACKGROUND) implemented.
- Shedding thresholds (110%, 100%, 80%, 50%) active.
Findings:
- Citadel Protocol tiered shedding is correctly implemented.
Hypotheses:
1. Protects IP reputation during heavy load.
Confidence: High
Next Task: Verify `MarketFeedService` backfill logic.

Cycle: #10
Task: Verify `MarketFeedService` backfill logic.
Objective: Inspect adaptive delays and weight-aware sleep.
Evidence:
- Delays scale based on usage ratio.
- 50% threshold for background tasks.
- Window-end awareness (wait for rollover).
Findings:
- Backfill logic is weight-optimized.
Hypotheses:
1. Prevents background tasks from exhausting weight needed for critical trades.
Confidence: High
Next Task: Verify deterministic `clientOrderId`.

Cycle: #11
Task: Verify deterministic `clientOrderId`.
Objective: Confirm standardization of order IDs.
Evidence:
- Prefixes `ent-`, `sl-`, `cls-` used with trade UUID.
Findings:
- IDs are unique and reconstructible across restarts.
Hypotheses:
1. Enables reliable order state recovery.
Confidence: High
Next Task: Verify test alignment with optimized logic.

Cycle: #12
Task: Verify test alignment.
Objective: Ensure unit tests match the optimized targeted audit logic.
Evidence:
- `watchdog_robustness.spec.ts` was failing because it expected `fetchAllPositions` (bulk) for a single trade.
- Engine uses `fetchPosition` (targeted) for small sets.
Findings:
- Tests were stale relative to the optimized engine logic.
Hypotheses:
1. Updating tests to match engine logic will restore suite health.
Confidence: High
Next Task: Fix test dependencies and run build.

Cycle: #13
Task: Fix test dependencies.
Objective: Add `EventEmitter2` to `leak_prevention.spec.ts`.
Evidence:
- Dependency injection failure in test logs.
Findings:
- Mock module was incomplete.
Hypotheses:
1. Restores test execution.
Confidence: High
Next Task: Build and test verification.

Cycle: #14
Task: Build and test verification.
Objective: Run full build and test suite.
Evidence:
- `pnpm run build`: Success.
- `pnpm test`: 170/170 tests passed.
Findings:
- System is stable and synchronized.
Confidence: High
Next Task: Stop investigation (Root cause of test failures identified as stale tests; missing fields restored).

Cycle: #15
Task: Diagnose live market-data blackout (0 frames) on staging/Railway while testnet streams normally.
Objective: Determine why live `fstream.binance.com` delivers no data though testnet works with identical client code, and restore live streaming without increasing Binance API footprint / IP-ban risk.
Evidence:
- Staging (current `deploy`) connected to `wss://fstream.binance.com/stream`, got SUBSCRIBE ACK `{"result":null,"id":1}` but 0 data frames, session after session.
- Production (PR #746) connected to `wss://fstream.binance.com/market/stream?streams=...` and received frames (discovery `!miniTicker@arr`, combined klines).
- Local direct test (same network): `/market/stream?streams=btcusdt@kline_1m` -> 23 frames/12s; `/stream` (+SUBSCRIBE method) -> 0; `/public/stream` -> 0; `/market/stream` + SUBSCRIBE method -> 1 (ACK only).
- Restoring live WS browser headers (reverting commit 3304f59) did NOT change the result -> headers were a red herring.
- Both the market WS and the User Data Stream were starved on the classic endpoint; order flow fell back to REST `queryOrder` (log: 'UDS cache empty. Fetching authoritative price via queryOrder').
Findings:
- Root cause: the classic `/stream` endpoint is starved by Binance from many IP ranges (handshake + SUBSCRIBE ACK succeed, 0 data frames). The `SUBSCRIBE` method is NOT served on `/market/stream`, so it must be replaced by `?streams=` URL-param subscription.
- Fix applied: `BINANCE_WS_MARKET` -> `wss://fstream.binance.com/market/stream`; `MarketFeedService` builds the connection URL with `?streams=` for live (testnet unchanged). This restored streaming AND removed the self-amplifying reconnect storm (the storm was caused by the starved endpoint never confirming).
- Secondary fixes: (a) `handleAccountUpdate` `return`->`continue` (batched ACCOUNT_UPDATE could drop other symbols' syncs/closures); (b) capped exponential reconnect backoff 5s->60s; (c) emit `ENGINE_EVENTS.ALERT` for `close_blocked`/`illiquid_blocked`; (d) REST seed kept one-time only (safety net, never periodic).
Hypotheses:
1. Staging should now stream live market data like production after redeploy.
Confidence: High
Next Task: Stop investigation (root cause resolved; verify on staging deploy).
