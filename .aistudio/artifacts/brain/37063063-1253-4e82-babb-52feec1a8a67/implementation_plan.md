# Stop Loss Ratchet & Protection Verification Plan

This plan outlines the verification strategy to ensure that Stop-Loss (SL) ratcheting correctly synchronizes updates with the Binance exchange while preserving existing robust Exit Signal and Trailing Stop execution.

## User Review & Critical Decisions

> [!IMPORTANT]
> All requested fixes for exchange SL synchronization (fixing status code 200, removing stale `binance_order_id` check, reference SL comparison, and Watchdog price parity audit) have been successfully implemented and compiled.

- **Confirmed Decision 1**: Use Cancel-then-Replace for exchange SL ratcheting with automatic rollback protection.
- **Confirmed Decision 2**: Validate SL price parity via periodic watchdog checks without interfering with running trailing stops.

## 1. Overview & Core Concept

- **What It Does**: Verifies that automated stop-loss ratcheting pushes higher milestone SL prices to Binance live futures via REST API while maintaining real-time WebSocket state consistency.
- **Target Audience / Persona**: Live algorithmic crypto traders running multi-milestone risk management.
- **Key Value**: Prevents desynchronization between local UI stop-loss prices and exchange-enforced stop-loss orders.

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. Active position advances past milestone threshold.
  2. Engine calculates new SL price and executes Cancel-then-Replace on Binance.
  3. UI updates active SL badge and notification log.
- **Visual Identity & Theme**: Professional trading dashboard aesthetic with high-contrast alert badges for risk states.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1**: Reference SL Price Tracking
  - *Chosen Approach*: Compare new prospective SL against `prevSlPrice` or `trade.current_sl` with a 0.01% price delta guard.
  - *Why*: Minimizes unnecessary exchange API calls while ensuring every meaningful ratchet reaches Binance.
- **Decision 2**: Watchdog Parity Audit
  - *Chosen Approach*: Periodic inspection of open exchange SL orders against local `trade.current_sl`.
  - *Why*: Self-healing guarantee against dropped socket updates.

## 4. Technical Architecture & Data Strategy

\`\`\`
┌────────────────────────────────────────────────────────┐
│               Position Tracker Service                 │
│  (Detects Milestone / Trailing Stop / Exit Trigger)    │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                 Order Manager Service                  │
│  - placeStopLoss()                                     │
│  - updateStopLoss() (Cancel-then-Replace)              │
│  - cancelBinanceOrder() (Error Tolerance -2011/-2022)  │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                 Binance Futures REST API               │
└────────────────────────────────────────────────────────┘
\`\`\`
