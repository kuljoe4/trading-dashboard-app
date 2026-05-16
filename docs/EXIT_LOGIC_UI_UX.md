# Momentum Engine: Exit Logic & UI/UX Flow

This document explains how the Momentum Engine handles trade exits, from the internal logic and exchange interaction to the visual representation in the Operator Cockpit.

---

## 1. Exit Mechanisms

The system monitors for exits in a high-frequency **"Hot Loop"** (every 1,000ms), ensuring that as soon as a condition is met, the exit is triggered.

### A. Fixed Stop-Loss (SL) & Take-Profit (TP)
These are the hard boundaries defined during session configuration.
- **SL**: Calculated at entry based on the `sl_type` (e.g., `lookback_low/high` or `pct`). It serves as the ultimate safety net.
- **TP**: If using `fixed` TP mode, the engine calculates a target price based on the `tp_ratio` (e.g., 2.0R). If price touches this level, the trade is closed for a win.

### B. The Ratchet SL (RR Ladder)
This is the "Automated Guard" or trailing stop-loss logic. As the trade moves into profit, the system "ratchets" the Stop-Loss higher (for Longs) to lock in gains.
- **Logic**: The engine tracks `max_rr_achieved`. If the peak RR crosses a milestone defined in `live_rr_sequence` (e.g., [1.5, 2.5, 3.5]), it updates the `current_sl` to the corresponding value in `exit_rr_sequence` (e.g., [0.0, 1.0, 2.0]).
- **Exchange Sync (Live/Testnet)**: When the SL ratchets, the system automatically cancels the existing stop order on Binance and places a new **STOP_MARKET** order at the updated price.
- **Result**: A trade that hits 1.5R profit might have its SL moved to Break-Even (0.0R), ensuring a "risk-free" trade from that point forward.

### C. Signal-Based Exits (with Indicators)
The engine monitors **reversal signals** that are the same indicators used for entry (momentum_pct, breakout_hl, engulfing, ma, ema, ema_cross).

**How it works**:
1. Each exit signal has an **activation delay** (in seconds) configured via `exit_signal_delays`.
2. After the trade opens, the `OrderManagerService.checkExitSignals()` method runs every Hot Loop tick.
3. For each configured exit signal:
   - It creates a temporary config with only that signal enabled
   - Calls `SignalEngineService.checkEntry()` to evaluate if the signal fires
   - Tracks: `fired` (signal condition met), `active` (delay period elapsed), `remaining_delay` (seconds until activation)
4. The **logic mode** determines exit:
   - `any`: Exit if ANY signal fires (while active)
   - `all`: Exit only if ALL signals fire (while active)
5. When triggered, returns `SIGNAL_EXIT` with the signal type (e.g., `SIGNAL_momentum_pct`)

**Available signals**:
- `% Momentum` — Price moved >= threshold % over lookback period
- `Breakout H/L` — Price breaks above/below recent highs/lows
- `EMA Cross` — EMA crossover (uses `signal_params.ema_period`)
- `MA Cross` — MA crossover (uses `signal_params.ma_period`)
- `Engulfing` — Candle engulfs previous candle

### D. Manual/Emergency Termination
- **Pause**: Stops the scanner from entering new trades. Active trades are still managed by the automated SL/TP/Signal logic.
- **Terminate/Kill**: Stops the session entirely and immediately sends a MARKET close order to the exchange for any active positions.

---

## 2. Exchange Interaction (Binance API)

When an exit is triggered in Live Mode:

1. Stop-Loss Protection: Immediately upon entry, a **STOP_MARKET** order is placed on Binance.
   - **Close-Position**: Set to `true` to ensure the entire position is covered.
   - **Reduce-Only**: Set to `true` for maximum safety.
   - **Lifecycle**: This order is automatically managed (canceled/replaced) during Ratchet SL updates and canceled if the trade closes via TP or Signal.
2. Market Execution: For TP or Signal exits, the system uses MARKET orders on Binance Futures. This prioritized certainty of exit over price precision, ensuring the engine can exit quickly during high volatility.
3. Position Balancing: The OrderManagerService calculates the offsetting quantity (e.g., if you are LONG 100 units, it sends a MARKET SELL for 100 units).
4. Exit Safety: In live and testnet modes, all exit orders (Market close, Stop-Loss) are submitted with `reduceOnly: true`, so the exchange treats them as position-reducing orders instead of potential new opens.
5. Paper Mode Simulation: In Paper Mode, no actual orders are sent. The system "simulates" the fill at the current ticker price the moment the condition is met, updating the local `balancePaper` and moving the trade to `closedTrades`.
6. Confirmation: In Live Mode, the system waits for the Binance `orderId` to confirm the exit before finalizing the trade in the local database and UI.

---

## 3. UI/UX Flow

The interface is built to provide At-a-Glance certainty about active positions.

### A. The Price Runway (ActiveTradeBar)
Instead of static numbers, active positions are shown as a horizontal runway:
- Red Zone (Left): Stop-Loss level.
- Green Zone (Right): Take-Profit target.
- Live Indicator: A glowing dot moves along this runway in real-time. If it moves toward the green, the bar glows green; if it drops toward the red, the bar glows red.
  - transition-all duration-1000 ease-out for smooth movement
  - shadow-[0_0_15px_rgba(0,229,160,0.4)] green glow / shadow-[0_0_15px_rgba(255,68,102,0.4)] red glow

### B. The Guard Ladder (RRLadder)
For strategies using the Ratchet SL, a visual Ladder appears:
- Milestones: Shows the R:R targets (e.g., 1R, 2R, 3R).
- Progress: Completed milestones are highlighted in green with transition-all duration-500 animations.
- Active SL: Displays exactly where the current Ratchet has moved the stop-loss (e.g., "Active SL: Entry Price").
- Live RR dot: Glowing accent dot with shadow-[0_0_15px_rgba(91,111,255,0.4)] that moves along the progress bar.

### C. Exit Signal Monitor (ExitMonitor)
Shows real-time status of each exit signal:
- Each signal displayed as a ConditionWidget with:
  - Progress bar: transition-all duration-700 ease-out showing how close the signal is to firing
  - Numeric indicator value: shows the actual signal metric or breakout distance when active
  - Before activation: Shows remaining delay countdown with amber AlertCircle icon
  - After activation (active): Shows "Monitoring..." or "Signal Firing" with green CheckCircle2 when satisfied
  - Border glow: shadow-[0_0_15px_rgba(0,229,160,0.05)] when satisfied
- Logic badge: Shows "Require All" or "Allow Any" mode
- Signals are highlighted with red border (border-red/40) when enabled

### D. Intelligence Log (DecisionLog)
The moment an exit occurs:
1. The Active Trade Card is removed from the dashboard.
2. A new entry appears in the Session Logs with a clear exit reason (e.g., Close: BTCUSDT @ 65000 P&L=+150.00 Reason=SIGNAL_momentum_pct).
3. The Session P&L and Live Risk stats at the top of the screen update instantly via WebSocket.

### E. Expand/Collapse Animations
- Uses framer-motion AnimatePresence for smooth expand/collapse:
  - initial={{ height: 0, opacity: 0 }}
  - animate={{ height: auto, opacity: 1 }}
  - exit={{ height: 0, opacity: 0 }}
- Activation delay inputs appear with animate-in fade-in slide-in-from-top-1 duration-300

---

## 4. Configuration (ConfigModal)

Exit signals are configured in the Exit Signals section:
- Toggle signals on/off with Radix UI Switch components
- Set activation delay (seconds) per signal - the signal is only evaluated after this delay
- Choose logic: Allow Any (exit on first firing signal) or Require All (all must fire)
- Available signals match entry signals: Momentum %, Breakout, EMA Cross, MA Cross, Engulfing
