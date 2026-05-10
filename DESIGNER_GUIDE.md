# Momentum Engine: Designer’s Guide

Welcome! This guide is designed to help you understand the **Momentum Engine**, a real-time crypto trading bot, so you can build a brand-new design system and a mobile version.

---

## 1. Project Vision & Goals
The Momentum Engine is a high-speed trading tool that monitors hundreds of crypto pairs simultaneously. It looks for "momentum" (sudden, strong price moves) and automatically executes trades based on strict risk management rules.

Think of the product as an **operator cockpit**, not a marketing site. The user is trying to answer a few urgent questions quickly:

- Is the bot running?
- Is my risk under control?
- What is the scanner seeing?
- Did it enter a trade?
- Am I making or losing money?
- Can I stop everything quickly?

**Key Goals for Design:**
- **Real-Time Awareness:** The user needs to feel the "pulse" of the market. Data is live (updated every second via WebSockets).
- **Risk Clarity:** Trading is risky. The UI must clearly show how much money is at stake and how "safe" the current session is.
- **Actionable Scanner:** The engine scans for opportunities; the design must help users distinguish between a "passing interest" and a "strong buy signal."
- **Responsive Across Screen Sizes:** The app must work well on mobile, tablet, desktop, and large/wide monitors. Mobile is important for monitoring and emergency actions, but the main cockpit should also take advantage of larger screens with richer layouts and better information density.
- **No Duplicate Views:** Do not create multiple UI screens or panels that solve the same user need with slightly different layouts. Each view should have a distinct job, and repeated information should be reused through shared components.

---

## 2. Repo Map for Designers

The repo is split into a React frontend and backend trading engines.

```txt
frontend/                 React 18 + Vite + Zustand
  src/
    main.jsx              App shell, top navigation, scanner overlay trigger
    views/
      DashboardView.jsx   Main dashboard, strategy card, detail drill-in
      SettingsView.jsx    Binance API key settings
    components/
      TopBar.jsx          Global status, balance, risk, kill control
      ConfigModal.jsx     New strategy/session setup
      ScannerOverlay.jsx  Live opportunity scanner
      ActiveTradeBar.jsx  Active position display
      DecisionLog.jsx     Engine reasoning/history feed
      ui/primitives.jsx   Small reusable UI pieces
    store/trading.js      Live state, WebSocket handling, config state
    lib/theme.js          Current color tokens and number formatting

backend/                  Python FastAPI implementation
backend/node/             Node/NestJS implementation used by the current frontend defaults
```

The frontend defaults to:

- HTTP API: `http://localhost:3000`
- WebSocket: `ws://localhost:3000/session/ws`

The current app styling is mostly inline React styles plus a small shared color file. That means visual decisions are spread across components rather than centralized in a mature design system.

### Mobile Prototype Reference
File: `mobile_dashboard_stable.tsx`

This file is a useful design/interaction reference, not a second production view to mount directly. It shows strong mobile ideas:

- Compact session bar and stat cards
- Bottom-sheet-like scanner/config surfaces
- Stable live-updating trade cards
- Scanner opportunity cards that collapse dense table data into readable rows
- Risk/gate banners and active-window concepts

Current gaps in that file:

- It is standalone and duplicates dashboard/scanner/config/history concepts already present in the app.
- It uses hardcoded demo data for scanner, logs, history, and trade examples.
- It introduces UI concepts that are not fully backed by current live API fields, such as active windows, RR ladder details, and history summaries.
- It is optimized for mobile first, while the production app also needs strong desktop and wide-screen behavior.
- It mixes many local atoms into one file instead of using the existing frontend component structure.

Implementation decision: use it as a reference library for interaction patterns, but promote improvements into the existing shared views/components so there is one responsive UI system and no duplicate screens.

---

## 3. Current Product Surfaces

### A. Dashboard
File: `frontend/src/views/DashboardView.jsx`

The main screen. It shows session state, strategy cards, start/stop controls, and four key stats:

- Account balance
- Total session P&L
- Active risk
- Stop-loss guard status

Design role: this should be the highest-confidence, fastest-to-scan surface.

### B. Strategy Detail
File: `frontend/src/views/DashboardView.jsx`

The dashboard has a drill-in detail view for the active strategy. It includes:

- Entry condition widgets
- Active position module
- Session decision log
- P&L performance bars

Design role: this is the "why is the bot doing this?" view.

### C. New Strategy Modal
File: `frontend/src/components/ConfigModal.jsx`

This is the setup flow before starting a session. It groups scanner settings, risk settings, a sizing preview, and Paper Mode.

Design role: help the user understand risk before they go live.

### D. Live Scanner Overlay
File: `frontend/src/components/ScannerOverlay.jsx`

This shows ranked market opportunities:

- Symbol
- Percent move
- Volume
- Score
- Pass/fail against the configured threshold

Design role: turn noisy market movement into a ranked, actionable list.

### E. Settings
File: `frontend/src/views/SettingsView.jsx`

This is where Binance API credentials are entered and the current key is shown masked.

Design role: simple, secure, low-drama credential management.

---

## 4. Glossary of Terms (for Designers)

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

## 5. Data Flow & Interactivity
The engine isn't a static dashboard; it’s a living system.

- **WebSockets (WS):** The "Heartbeat." Every second, prices change. In the UI, this is represented by the **Pulse Dot** and shifting progress bars in the `ActiveTradeBar`.
- **The Scanner:** A background process that ranks symbols by price move. It’s a "Top 10" list that constantly re-orders itself.
- **Decision Log:** Every time the engine *thinks* about a trade but decides not to take it, it logs a "reason." This is crucial for user trust.
- **Zustand Store:** The frontend keeps live state in `frontend/src/store/trading.js`. This includes session status, balance, P&L, scanner results, active trades, logs, and config.
- **Paper vs. Live Data:** Paper Mode is simulated trading. Live Mode means actual exchange-connected behavior, so the design must make the current mode impossible to miss.

---

## 6. Visual Language (Current Prototype)
The current prototype uses a dark, cockpit-like trading interface.

- **Palette:**
  - `Background`: Deep Navy/Black (`#080b0f`)
  - `Surfaces`: Dark Grey (`#0d1117`)
  - `Primary Accent`: Electric Blue/Indigo (`#5b6fff`)
  - `Success`: Neon Green (`#00e5a0`)
  - `Danger`: Bright Red (`#ff4466`)
  - `Warning`: Amber (`#f5a623`)
- **Typography:** Monospace styling is used heavily for prices, symbols, P&L, and technical values.
- **Motion:** The "Ping" animation on pulse dots indicates live connectivity.
- **Density:** The current UI is compact and information-heavy. This is appropriate for trading, but spacing and hierarchy need more consistency.
- **Components:** Reusable primitives live in `frontend/src/components/ui/primitives.jsx`, but many design details still live directly inside each screen/component.

---

## 7. Components to Design

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

### E. Strategy Card
The dashboard-level preview of a running or available strategy.
- **Fields:** Status, mode, strategy name, scanner config, total P&L, hits, SL guard, active trade preview.
- **Interaction:** Click opens the Strategy Detail view.
- **Design Goal:** It should feel like a compact version of the detail screen, not a disconnected card.

### F. Top Bar
The persistent safety/status chrome.
- **Fields:** Product name, balance, open risk, kill control.
- **Design Goal:** Make critical state available everywhere without visually overwhelming the workspace.

---

## 8. Responsive Layout Strategy

The product should not be designed only as a mobile-first experience. Traders may monitor the bot from a phone, but the primary cockpit should feel excellent on desktop and larger screens too.

### Large Desktop / Wide Screens
- Use the extra space for persistent context: active strategy, scanner, logs, and risk summary can coexist without forcing constant modal switching.
- Avoid stretching cards across the full viewport if the content becomes hard to scan. Use max-widths, multi-column regions, or side panels.
- Consider a three-zone layout: session/risk overview, active trade detail, scanner/log context.
- Keep critical controls like Kill, Stop, running state, open risk, and P&L visible in the top-level chrome.

### Standard Desktop / Laptop
- Prioritize the main dashboard plus a clear drill-in detail view.
- Scanner can be a side panel, drawer, or modal depending on available width.
- Keep stat cards in a stable grid, but avoid cramping text or making cards too shallow.

### Tablet
- Collapse secondary context into panels or tabs while keeping session state and active trade visible.
- Use larger tap targets, but preserve enough density for scanner and risk monitoring.

### Mobile
Since mobile is still important, consider these UX shifts:

1. **The "Glance" View:** On a phone, the user primarily wants to see: *Is the bot running? Am I up or down? Do I need to Kill it?*
2. **Bottom Sheet Navigation:** Use bottom sheets for "Config" and "Scanner" to keep the main "Active Position" visible.
3. **Micro-Interactions:** Use haptic feedback for "Kill" actions and "Trade Entry" notifications.
4. **Condensed Data:** In the Scanner, hide "Volume" and "Score" on small screens, focusing only on "Symbol" and "% Change."

---

## 9. The User Journey (Workflow)

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

## 10. Improvement Backlog

Use this as the first pass for a designer/dev cleanup plan.

### Information Architecture
- Clarify the dashboard hierarchy: safety/risk first, strategy performance second, logs/scanner third.
- Make the strategy card and strategy detail feel like the same object at different zoom levels.
- Decide whether scanner is a modal, side panel, drawer, or persistent workspace region.
- Add a proper session summary after stop/kill/guard-triggered termination.
- Remove duplicate or near-duplicate views. If two screens show the same status, scanner, trade, or risk information, consolidate them or make one a clear drill-in of the other.
- Define responsive behavior for large desktop, standard desktop, tablet, and mobile instead of treating mobile as the only target.
- Treat `mobile_dashboard_stable.tsx` as a reference artifact. Do not ship it as a separate route unless its concepts are merged into the main component system.

### Interaction & Safety
- Replace symbolic text controls like `▶`, `■`, `⬛`, and `✕` with consistent icons, labels, and tooltips.
- Make the Kill action prominent but guarded against accidental taps, especially on mobile.
- Add explicit loading, reconnecting, offline, stopped, and failed states.
- Make Paper Mode visually unmistakable across the whole UI, not just a small badge.

### Components & Design System
- Standardize spacing, radius, typography, field sizing, button states, and focus states.
- Extract repeated inline styles into reusable components or tokens.
- Define consistent data table/list behavior for scanner and logs.
- Add accessible hover, focus, keyboard, and disabled states for all controls.
- Normalize backend data before rendering so UI components do not care whether the engine sends `pct` or `momentum`, `dir` or `direction`, `entry` or `entry_price`.

### Data Visualization
- Improve the active trade "price runway" so SL, entry, current price, and TP are immediately understandable.
- Make risk progress more legible as it approaches warning/critical thresholds.
- Improve scanner score visualization so score, threshold, and direction do not compete visually.
- Add better empty states when no trades are open and no scanner data has arrived.

### Mobile
- Prioritize a one-screen glance state: running status, P&L, open risk, active trade, kill.
- Use bottom sheets for scanner/config/logs.
- Avoid dense six-column scanner layouts on phone.
- Consider haptic confirmation for trade entry, kill, and critical risk events.

### Large Screens
- Use wider screens to show more live context at once, especially scanner, active trade, logs, and risk.
- Avoid oversized empty cards or stretched rows that reduce scanability.
- Define max content widths and responsive grid rules for dashboard cards, detail panels, and scanner rows.
- Ensure large-screen layouts do not duplicate mobile views; they should rearrange the same components into richer workspace layouts.

---

## 11. Design System Checklist
When creating the new system, ensure you define:
- [ ] **Paper vs. Live:** How does the whole UI change when in "Simulated" mode? (e.g., an amber border around the whole screen).
- [ ] **Numeric Precision:** How do we handle prices like `$0.0000211` vs `$62,000`?
- [ ] **The "Kill" Button:** How do we make it prominent but hard to press accidentally? (e.g., Long-press or Slide-to-Kill).
- [ ] **Empty States:** What does it look like when no trades are active? (The scanner should take center stage here).
- [ ] **Live Connectivity:** How does the app show healthy, reconnecting, stale, or failed data?
- [ ] **Risk Thresholds:** What visual treatment appears at normal, warning, critical, and blocked states?
- [ ] **Scanner Confidence:** How do users distinguish "interesting movement" from "actionable signal"?
- [ ] **Session Summary:** What does the user see after a session ends?
- [ ] **No Duplicate Views:** Does every screen have a unique purpose, with shared information handled through shared components rather than repeated layouts?
- [ ] **Responsive Layouts:** How does the app adapt at mobile, tablet, desktop, and wide desktop breakpoints?
- [ ] **Large-Screen Density:** Does the desktop cockpit use extra space for useful context without stretching or duplicating views?
