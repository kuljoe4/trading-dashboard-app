## 2026-06-20 - Early Filtering in Momentum Scanner
**Learning:** The `MomentumScannerService` was performing full opportunity scoring (including candle loops for volatility and trend) for symbols that would eventually be disqualified by session-level `entry_side` or `scan_min_volume_usdt` filters. Moving these checks to an early return in `scanSymbol` avoids expensive mathematical processing for ~50% of symbols.
**Action:** Always implement session-level criteria as early returns in scanning pipelines before triggering complex technical indicators or scoring algorithms.
