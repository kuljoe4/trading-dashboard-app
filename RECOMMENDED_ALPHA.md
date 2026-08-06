# Recommended Alpha: Momentum Strategy Configuration

Based on a deep audit of the **Momentum Engine** codebase and current industry standards for algorithmic trading, here is the recommended configuration for the **Momentum Strategy**.

## 1. Recommended Signal ("Alpha") Parameters
These parameters define the threshold and sensitivity for opportunity discovery:

*   **Scan Timeframe:** `5m` (Recommended)
    *   *Rationale:* Provides a superior signal-to-noise ratio compared to the `1m` default, allowing technical indicators (EMA/MA) to converge more reliably.
*   **Momentum Threshold (`scan_pct_threshold`):** `2.0%`
    *   *Rationale:* This is the engine's primary alpha gate. A 2% move in 15 minutes (on a 5m chart) typically identifies a high-conviction momentum breakout.
*   **Lookback Period (`scan_lookback`):** `3`
    *   *Rationale:* Captures the immediate "burst" without diluting the momentum score with older, irrelevant price action.
*   **Signal Logic:** `all` (Entry) / `any` (Exit)
    *   *Rationale:* Industry best practice. Require all conditions to align for entry (High Conviction), but allow any signal to trigger an exit (Capital Preservation).

## 2. The Core Indicators
For the most robust alpha generation, enable these two signals in tandem:

1.  **`momentum_pct`**: Filters for the raw price expansion.
2.  **`ema_price_cross` (Period: 12)**: Provides a trend-following anchor.
    *   **Alpha Smoothing:** The engine uses the standard EMA alpha formula: $\alpha = 2 / (period + 1)$. For a 12-period EMA, the smoothing factor is **0.1538**.
    *   **Burn-in Guard:** Always ensure the symbol has at least **24 candles** of history before trading to allow the EMA to converge (Period $\times$ 2).

## 3. The Opportunity Score (Alpha Weights)
The engine calculates a final score (0–100) using a weighted model. To maximize alpha, prioritize opportunities with a score **> 75**:

*   **Momentum (50%)**: Derived from the magnitude of the price move relative to your threshold.
*   **Volatility (30%)**: Measures the average High-Low range over 10 candles. Higher volatility improves alpha by ensuring sufficient price movement.
*   **Trend (20%)**: Counts consecutive candles in the same direction over the last 5 periods. 4/5 or 5/5 directionality confirms strong alpha.

## 4. Risk-Adjusted Alpha (Safety Caps)
*   **Min Volume Filter:** `500,000 USDT` (24h)
*   **Risk per Trade:** `1.0%`
*   **TP Ratio:** `2.0R` (Fixed)
*   **SL Guard:** `200 USDT` (Session limit)

---

### Implementation Note
To deploy this strategy, set your **Timeframe to 5m**, use **EMA-12** for price crossing, and require **Momentum >= 2.0%** with a **Minimum Volume of 500k USDT**. Using the **'ALL'** signal logic ensures you only enter trades where price action and trend-following indicators are in perfect synchronization.
