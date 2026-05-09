# Momentum Engine: Designer’s Guide

Welcome! This guide is designed to help you understand the **Momentum Engine**, a real-time crypto trading bot, so you can build a brand-new design system and a mobile version.

---

## 1. Project Vision & Goals
The Momentum Engine is a high-speed trading tool that monitors hundreds of crypto pairs simultaneously. It looks for "momentum" (sudden, strong price moves) and automatically executes trades based on strict risk management rules.

**Key Goals for Design:**
- **Real-Time Awareness:** The user needs to feel the "pulse" of the market. Data is live (updated every second via WebSockets).
- **Risk Clarity:** Trading is risky. The UI must clearly show how much money is at stake and how "safe" the current session is.
- **Actionable Scanner:** The engine scans for opportunities; the design must help users distinguish between a "passing interest" and a "strong buy signal."
- **Mobile-First Utility:** Traders often need to monitor or "Kill" (panic stop) sessions while on the move.

---

## 2. Glossary of Terms (for Designers)

| Term | Meaning | Design Implication |
| :--- | :--- | :--- |
| **Momentum** | A rapid change in price (%) over a short window. | Needs visual "strength" indicators (e.g., progress bars, intensity colors). |
| **SL (Stop-Loss)** | The "Exit if I'm wrong" price. It prevents further losses. | Should be styled with "Danger" or "Guard" visual cues (often Red). |
| **TP (Take-Profit)** | The "Exit if I'm right" price. Where we bank the win. | Should be styled with "Success" visual cues (often Green). |
| **RR (Risk:Reward)** | The ratio of potential profit vs. potential loss. | A core metric. 1:2 means we risk $1 to make $2. High RR is good. |
| **Sizing (Position Size)** | How many units we buy. Scaled automatically by SL distance. | Users need to see why a trade is large or small (wider stops = smaller size). |
| **Paper Mode** | Simulated trading with fake money. | Requires a clear, distinct "SIMULATION" or "SANDBOX" visual state. |
| **Kill Switch** | Immediate emergency stop of all trading. | Needs to be the most accessible and prominent "emergency" action. |

---

## 3. Data Flow & Interactivity
The engine isn't a static dashboard; it’s a living system.

- **WebSockets (WS):** The "Heartbeat." Every second, prices change. In the UI, this is represented by the **Pulse Dot** and shifting progress bars in the `ActiveTradeBar`.
- **The Scanner:** A background process that ranks symbols by price move. It’s a "Top 10" list that constantly re-orders itself.
- **Decision Log:** Every time the engine *thinks* about a trade but decides not to take it, it logs a "reason." This is crucial for user trust.

---

## 4. Visual Language (Current Prototype)
The current prototype (`momentum-engine-ux.jsx`) uses a "Terminal/Cyberpunk" aesthetic.

- **Palette:**
  - `Background`: Deep Navy/Black (`#080b0f`)
  - `Surfaces`: Dark Grey (`#0d1117`)
  - `Primary Accent`: Electric Blue/Indigo (`#5b6fff`)
  - `Success`: Neon Green (`#00e5a0`)
  - `Danger`: Bright Red (`#ff4466`)
  - `Warning`: Amber (`#f5a623`)
- **Typography:** Monospace fonts (`IBM Plex Mono`, `Fira Code`) are used to convey technical precision and "data-heavy" vibes.
- **Motion:** The "Ping" animation on pulse dots indicates live connectivity.

---

## 5. Components to Design

### A. The Live Scanner
A list of symbols moving the most.
- **Fields:** Symbol Name, % Change, Volume, "Score" (Engine's confidence).
- **Interactive:** Needs to be filterable or allow the user to click to see the chart.

### B. Active Trade Card
The most important component when a trade is live.
- **Visuals:** A "Price Runway" showing the distance between SL, Entry, and TP.
- **States:** Winning (Green glow), Losing (Red glow), or Neutral.

### C. Condition Widgets
These explain *why* a trade hasn't happened yet.
- **Example:** "Scanner threshold ≥ 2%." If current move is 1.8%, the widget should show a progress bar at 90% and an "Awaiting" state.

### D. Session Guard
Shows the "Budget" for the day. If the user sets a $200 Stop-Loss Guard, and they have lost $150, the UI should show a "Low Fuel" or "Warning" state.

---

## 6. Mobile Strategy (New Requirement)
Since the user wants a mobile version, consider these UX shifts:

1. **The "Glance" View:** On a phone, the user primarily wants to see: *Is the bot running? Am I up or down? Do I need to Kill it?*
2. **Bottom Sheet Navigation:** Use bottom sheets for "Config" and "Scanner" to keep the main "Active Position" visible.
3. **Micro-Interactions:** Use haptic feedback for "Kill" actions and "Trade Entry" notifications.
4. **Condensed Data:** In the Scanner, hide "Volume" and "Score" on small screens, focusing only on "Symbol" and "% Change."

---

## 7. The User Journey (Workflow)

Understanding how a user interacts with the bot is key to designing intuitive navigation.

### Step 1: Configuration & Setup
The user doesn't just "start" a trade. They start a **Session**.
- **Action:** User clicks "New Session."
- **Design Task:** Design a configuration form (Modal or Full Page) where users set their "Scanner" rules and "Risk" limits.
- **Key Insight:** Include a "Sizing Preview" so users can see how much they will risk *before* the session goes live.

### Step 2: The "Watching" State
Once started, the engine is scanning. No trades might be open yet.
- **Action:** User monitors the **Live Scanner** and **Condition Widgets**.
- **Design Task:** Ensure the UI feels "active" even if nothing is being bought. Use animations or pulse dots to show the connection is alive.

### Step 3: Trade Entry (Automation)
The engine finds a match and buys a symbol automatically.
- **Action:** An **Active Trade Card** appears.
- **Design Task:** Use a notification or visual "Pop" to alert the user that a position is now open.

### Step 4: Active Monitoring
The trade is live. The user watches the price move toward the TP or SL.
- **Action:** User checks P&L and "Distance to Exit."
- **Design Task:** Design a "Price Runway" or "Progress Bar" that shows the current price relative to the entry, stop-loss, and take-profit targets.

### Step 5: Termination
The session ends either because the user hits "Stop," the "Kill" switch, or the "SL Guard" is triggered.
- **Action:** Session stops, orders are cancelled.
- **Design Task:** Design a "Session Summary" state. Show the total P&L for that specific run and a list of all trades taken.

---

## 8. Design System Checklist
When creating the new system, ensure you define:
- [ ] **Paper vs. Live:** How does the whole UI change when in "Simulated" mode? (e.g., an amber border around the whole screen).
- [ ] **Numeric Precision:** How do we handle prices like `$0.0000211` vs `$62,000`?
- [ ] **The "Kill" Button:** How do we make it prominent but hard to press accidentally? (e.g., Long-press or Slide-to-Kill).
- [ ] **Empty States:** What does it look like when no trades are active? (The scanner should take center stage here).
