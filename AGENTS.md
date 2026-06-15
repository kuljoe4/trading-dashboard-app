# Industry Standards and Senior Engineer Review Mode

When plan mode is active, research the current industry standards relevant to the project domain before proposing implementation or refactoring.

Evaluate the codebase and architecture against the following:

1. Industry standards

   - Identify the common patterns, expectations, and best practices used in this industry.
   - Compare the codebase against current norms for architecture, security, reliability, maintainability, observability, and delivery workflow.
   - Note any compliance, interoperability, or operational requirements that are typically expected in this domain.

2. Code quality

   - Review correctness, clarity, consistency, modularity, naming, testability, documentation, error handling, and resilience.
   - Flag code smells, duplication, hidden complexity, weak abstractions, unsafe assumptions, and brittle dependencies.
   - Check whether the code is easy to extend, debug, verify, and maintain by another engineer.

3. Senior engineer review standards

   - Review the system as a senior engineer would: practical, rigorous, and biased toward long-term maintainability.
   - Judge whether the design choices are justified by the problem size and constraints.
   - Call out overengineering, underengineering, architectural drift, and unnecessary complexity.
   - Separate strong engineering decisions from risky or inconsistent ones.

4. Evidence-based assessment

   - Tie every finding to a specific file, module, workflow, or pattern in the codebase.
   - Distinguish between confirmed issues, likely risks, and recommendations.
   - Do not invent standards that are not relevant to the project domain.

5. Output format

   - Start with a concise overall verdict.
   - Then provide:
     a. Industry standard alignment
     b. Code quality review
     c. Senior engineer concerns
     d. Priority fixes
     e. Long-term improvements
     f. What is already strong
   - Keep the review practical and actionable.

Rules:

- Prefer proven industry practices over novelty.
- Do not recommend changes that are not justified by the codebase.
- Optimize for maintainability, safety, and long-term team velocity.
- Be strict about quality, but separate issues that are cosmetic from those that affect delivery or reliability.
## 2026-06-11 - Critical Trading Engine Compliance & Best Practices

To avoid regressions and ensure compliance with exchange (Binance) behavior and internal standards, all agents must adhere to the following:

### 1. Binance Stop-Loss Order Mandatory Fallback
- **Pattern**: When placing `STOP_MARKET` orders, always include an explicit `quantity` parameter (formatted to the correct `LOT_SIZE` precision) even if `closePosition: true` is used.
- **Reason**: Certain symbols and API endpoints on Binance Futures reject orders missing the quantity, causing critical protection failures.
- **Compliance**: Verified in `OrderManagerService.placeStopLoss`.

### 2. Leverage Feature intentional Disablement
- **Pattern**: Do not attempt to re-enable or use automated leverage setting via `changeInitialLeverage`.
- **Reason**: This feature was intentionally disabled in June 2026 to prevent account/exchange synchronization issues that led to inconsistent trade states.
- **Audit**: `OrderManagerService.setLeverage` is a no-op; UI fields have been removed.

### 3. Robust Database Migration Discovery
- **Pattern**: Use the non-recursive glob `*.{ts,js}` for migrations in `AppModule.ts`.
- **Reason**: Complex nested globs (`**/*`) can fail in specific Node.js or Docker environments, leading to missing database columns and startup crashes.

### 4. UI/UX & A11Y Standards for Financial Data
- **Clarity**: Use explicit labels for risk (`Stop Distance (Live)` vs `Max Entry Risk`).
- **Responsive Flow**: Avoid absolute positioning for dynamic text (like timers) in compact layouts to prevent mobile overlaps.
- **Discoverability**: All critical metrics must have helper tooltips (`<Tooltip content="..." />`) to align with the user's mental model.

### 5. Gapless Stop-Loss Updates (Ratcheting)
- **Standard Orders**: Use `modifyOrder` to update the stop price of an existing `STOP_MARKET` order. This avoids the protection gap inherent in cancel-then-replace.
- **Fallback**: If `modifyOrder` fails or is unsupported for a symbol, you MUST use **Cancel-then-Replace**. Attempting to place a second `closePosition: true` order while one exists will be rejected by Binance.
- **Rollback**: If the replacement SL fails, the system must attempt to re-place the OLD SL price to ensure the position remains protected.
- **Audit**: Verified in `OrderManagerService.updateStopLoss`.

### 7. Structural Trading Resilience (2026-06-15)
- **Algo API**: The Algo Order API is intentionally disabled/removed due to SDK incompatibilities and matching unreliability. Standard `STOP_MARKET` with `closePosition: true` is the only supported protection mechanism.
- **Close Attempts**: Automated closes (e.g. for PERCENT_PRICE rejections) use exponential backoff and a hard ceiling of 5 attempts. After the ceiling, the trade is marked `close_blocked` and requires manual intervention.
- **Stream Stability**: User Data Streams use a proactive 24-hour reconnect (at 23h 50m) to avoid silent disconnections and event loss.
- **Fill Price**: Extract fill price primarily via `cumQuote / executedQty` as `avgPrice` is deprecated by Binance.
- **Rate Limits**: The system tracks `X-MBX-ORDER-COUNT-10S/1M` headers. Entries and low-priority SL ratchets are throttled/blocked when approaching limits (80%/90%), while emergency closes always proceed.
