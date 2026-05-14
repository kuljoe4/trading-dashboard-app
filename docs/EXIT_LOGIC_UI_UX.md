# Momentum Engine: Exit Logic & UI/UX Flow

This document explains how the Momentum Engine handles trade exits, from the internal logic and exchange interaction to the visual representation in the Operator Cockpit.

---

## 1. Exit Mechanisms

The system monitors for exits in a high-frequency **"Hot Loop"** (every 1,000ms), ensuring that as soon as a condition is met, the exit is triggered.

### A. Fixed Stop-Loss (SL) & Take-Profit (TP)
These are the hard boundaries defined during session configuration.
- **SL:** Calculated at entry based on the `sl_type` (e.g., `lookback_low/high` or `pct`). It serves as the ultimate safety net.
- **TP:** If using `fixed` TP mode, the engine calculates a target price based on the `tp_ratio` (e.g., 2.0R). If price touches this level, the trade is closed for a win.

### B. The Ratchet SL (RR Ladder)
This is the "Automated Guard" or trailing stop-loss logic. As the trade moves into profit, the system "ratchets" the Stop-Loss higher (for Longs) to lock in gains.
- **Logic:** The engine tracks `max_rr_achieved`. If the peak RR crosses a milestone defined in `live_rr_sequence` (e.g., [1.5, 2.5, 3.5]), it updates the `current_sl` to the corresponding value in `exit_rr_sequence` (e.g., [0.0, 1.0, 2.0]).
- **Result:** A trade that hits 1.5R profit might have its SL moved to Break-Even (0.0R), ensuring a "risk-free" trade from that point forward.

### C. Signal-Based Exits
The engine can watch for "Reversal Signals." If the indicators that triggered the entry (like RSI or Momentum) suddenly flip to the opposite direction (as defined in `exit_signals`), the engine will trigger a **SIGNAL_EXIT** to preserve capital before a hard SL is hit.

### D. Manual/Emergency Termination
- **Pause:** Stops the scanner from entering *new* trades. Active trades are still managed by the automated SL/TP/Signal logic.
- **Terminate/Kill:** Stops the session entirely and immediately sends a `MARKET` close order to the exchange for any active positions.

---

## 2. Exchange Interaction (Binance API)

When an exit is triggered in **Live Mode**:

1.  **Market Execution:** The system uses `MARKET` orders on Binance Futures. This prioritized *certainty* of exit over price precision, ensuring the engine can exit quickly during high volatility.
2.  **Position Balancing:** The `OrderManagerService` calculates the offsetting quantity (e.g., if you are LONG 100 units, it sends a MARKET SELL for 100 units).
3.  **Paper Mode Simulation:** In Paper Mode, no actual orders are sent. The system "simulates" the fill at the current ticker price the moment the condition is met, updating the local `balancePaper` and moving the trade to `closedTrades`.
4.  **Confirmation:** In Live Mode, the system waits for the Binance `orderId` to confirm the exit before finalizing the trade in the local database and UI.

---

## 3. UI/UX Flow

The interface is built to provide "At-a-Glance" certainty about active positions.

### A. The Price Runway (`ActiveTradeBar`)
Instead of static numbers, active positions are shown as a horizontal runway:
- **Red Zone (Left):** Stop-Loss level.
- **Green Zone (Right):** Take-Profit target.
- **Live Indicator:** A glowing dot moves along this runway in real-time. If it moves toward the green, the bar glows green; if it drops toward the red, the bar glows red.

### B. The Guard Ladder (`RRLadder`)
For strategies using the Ratchet SL, a visual "Ladder" appears:
- **Milestones:** Shows the R:R targets (e.g., 1R, 2R, 3R).
- **Progress:** Completed milestones are highlighted in green.
- **Active SL:** Displays exactly where the current "Ratchet" has moved the stop-loss (e.g., "Active SL: Entry Price").

### C. Intelligence Log (`DecisionLog`)
The moment an exit occurs:
1.  The **Active Trade Card** is removed from the dashboard.
2.  A new entry appears in the **Session Logs** with a clear exit reason (e.g., `Close: BTCUSDT @ 65000 P&L=+150.00 Reason=SL_HIT (Ratchet)`).
3.  The **Session P&L** and **Live Risk** stats at the top of the screen update instantly via WebSocket.
