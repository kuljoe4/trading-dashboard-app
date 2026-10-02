import re
import sys

def replace_in_file():
    with open('backend/node/src/engine/exit_estimation.service.ts', 'r') as f:
        content = f.read()

    # Revert the previous bad change to have a clean slate or replace it with stateless code
    # Actually wait, the problem is that Kalman filter requires historical iterations to build up
    # the state (P, k_v) correctly over time. We can just run the filter over the past candles!

    # We have `candles` array! We can loop over the last N candles (e.g., 20) and run the filter
    # on them. That way we don't need persistent state in the service, we can compute it on the fly
    # by running it over the historical data buffer we already have in `candles`.

    # The existing block:
    search_block = """
        // --- KALMAN FILTER FOR SPREAD VELOCITY AND ETA ---
        // Initialize simple 1D Kalman Filter state for spread
        let k_x = prevSpread;
        let k_v = spreadVelocity; // Initial velocity estimate

        // P (covariance) and Q (process noise), R (measurement noise)
        let p00 = 1, p01 = 0, p10 = 0, p11 = 1;
        const q = 0.01;
        const r = 1.0;

        // Time step
        const dt = 1;

        // Predict
        const x_pred = k_x + k_v * dt;
        const v_pred = k_v;
        const p00_pred = p00 + dt * p10 + dt * (p01 + dt * p11) + q;
        const p01_pred = p01 + dt * p11;
        const p10_pred = p10 + dt * p11;
        const p11_pred = p11 + q;

        // Update with current measurement
        const y_err = currentSpread - x_pred;
        const S = p00_pred + r;
        const K0 = p00_pred / S;
        const K1 = p10_pred / S;

        k_x = x_pred + K0 * y_err;
        k_v = v_pred + K1 * y_err;

        // Use Kalman velocity (negated since we track contraction)
        spreadVelocity = -k_v;

        if (spreadVelocity > 0 && currentSpread > 0) {
          const rawEta = currentSpread / spreadVelocity;
          const etaCandles = Math.max(1, Math.round(rawEta * 10) / 10);
          const etaSeconds = Math.round((etaCandles * intervalMs) / 1000);

          // KALMAN FILTER FOR PRICE TRAJECTORY
          let p_x = candles[prevIdx].close;
          let p_v = priceVelocity;
          let pp00 = 1, pp01 = 0, pp10 = 0, pp11 = 1;
          const px_pred = p_x + p_v * dt;
          const pv_pred = p_v;
          const pp00_pred = pp00 + dt * pp10 + dt * (pp01 + dt * pp11) + q;
          const pp01_pred = pp01 + dt * pp11;
          const pp10_pred = pp10 + dt * pp11;
          const pp11_pred = pp11 + q;
          const py_err = currentPrice - px_pred;
          const pS = pp00_pred + r;
          const pK0 = pp00_pred / pS;
          const pK1 = pp10_pred / pS;
          p_v = pv_pred + pK1 * py_err;

          const filteredPriceVelocity = p_v;

          const estimatedExitPrice = roundTo(currentPrice + filteredPriceVelocity * etaCandles, 8);
          const { estPnl, estR } = computePnLAndR(estimatedExitPrice);
          const proximity = Math.min(99, Math.max(1, Math.round((1 - (currentSpread / (currentSpread + spreadVelocity * 5))) * 100)));
"""

    replace_block = """
        // --- KALMAN FILTER FOR SPREAD VELOCITY AND ETA ---
        // Run Kalman filter over the last 10 candles (or available) to build state
        const kalmanLookback = Math.min(10, candles.length);
        const kStartIdx = candles.length - kalmanLookback;

        // Compute EMAs for historical spreads
        // We will just approximate historical spread using price delta if fast/slow history is unavailable,
        // but since we only have `val` and `thresh` (current) and `prevFast`/`prevSlow`, we can interpolate
        // or just use a simple history array. Actually, we should compute the EMA series if we want exact history.
        // Or we can use the Kalman filter over the available prevSpread and currentSpread.
        // For a more robust filter without full EMA recalculation, we can just apply the filter on the available points
        // But to truly build state we need more points. Let's recalculate the fast/slow EMA series for the lookback.
        const sp = config.signal_params || {};
        const isCloseSignal = baseType === 'ema_dual_close';
        const p1 = Number(sp[isCloseSignal ? 'entry_ema_fast' : 'ema_dual_fast']) || Number(sp['ema_fast']) || 9;
        const p2 = Number(sp[isCloseSignal ? 'entry_ema_slow' : 'ema_dual_slow']) || Number(sp['ema_slow']) || 21;

        const fastSeries = this.calculateEMAValues(candles, p1);
        const slowSeries = this.calculateEMAValues(candles, p2);

        // P (covariance) and Q (process noise), R (measurement noise)
        let p00 = 1, p01 = 0, p10 = 0, p11 = 1;
        let pp00 = 1, pp01 = 0, pp10 = 0, pp11 = 1;
        const q = 0.01;
        const r = 1.0;
        const dt = 1;

        let k_x = 0;
        let k_v = 0;
        let p_x = candles[kStartIdx].close;
        let p_v = 0;

        // Initialize with first point in window
        if (fastSeries.length >= candles.length && slowSeries.length >= candles.length) {
            const initFast = fastSeries[kStartIdx];
            const initSlow = slowSeries[kStartIdx];
            k_x = isLong ? (initSlow - initFast) : (initFast - initSlow);
        } else {
            k_x = prevSpread;
        }

        for (let i = kStartIdx + 1; i < candles.length; i++) {
            // Spread measurement
            let z_spread = 0;
            if (fastSeries.length >= candles.length && slowSeries.length >= candles.length) {
                z_spread = isLong ? (slowSeries[i] - fastSeries[i]) : (fastSeries[i] - slowSeries[i]);
            } else {
                z_spread = i === candles.length - 1 ? currentSpread : prevSpread;
            }

            // Predict Spread
            const x_pred = k_x + k_v * dt;
            const v_pred = k_v;
            const p00_pred = p00 + dt * p10 + dt * (p01 + dt * p11) + q;
            const p01_pred = p01 + dt * p11;
            const p10_pred = p10 + dt * p11;
            const p11_pred = p11 + q;

            // Update Spread
            const y_err = z_spread - x_pred;
            const S = p00_pred + r;
            const K0 = p00_pred / S;
            const K1 = p10_pred / S;

            k_x = x_pred + K0 * y_err;
            k_v = v_pred + K1 * y_err;

            p00 = (1 - K0) * p00_pred;
            p01 = (1 - K0) * p01_pred;
            p10 = -K1 * p00_pred + p10_pred;
            p11 = -K1 * p01_pred + p11_pred;

            // Price measurement
            const z_price = candles[i].close;

            // Predict Price
            const px_pred = p_x + p_v * dt;
            const pv_pred = p_v;
            const pp00_pred = pp00 + dt * pp10 + dt * (pp01 + dt * pp11) + q;
            const pp01_pred = pp01 + dt * pp11;
            const pp10_pred = pp10 + dt * pp11;
            const pp11_pred = pp11 + q;

            // Update Price
            const py_err = z_price - px_pred;
            const pS = pp00_pred + r;
            const pK0 = pp00_pred / pS;
            const pK1 = pp10_pred / pS;

            p_x = px_pred + pK0 * py_err;
            p_v = pv_pred + pK1 * py_err;

            pp00 = (1 - pK0) * pp00_pred;
            pp01 = (1 - pK0) * pp01_pred;
            pp10 = -pK1 * pp00_pred + pp10_pred;
            pp11 = -pK1 * pp01_pred + pp11_pred;
        }

        // Use Kalman velocity (negated since we track contraction)
        spreadVelocity = -k_v;

        if (spreadVelocity > 0 && currentSpread > 0) {
          const rawEta = currentSpread / spreadVelocity;
          const etaCandles = Math.max(1, Math.round(rawEta * 10) / 10);
          const etaSeconds = Math.round((etaCandles * intervalMs) / 1000);

          const filteredPriceVelocity = p_v;
          const estimatedExitPrice = roundTo(currentPrice + filteredPriceVelocity * etaCandles, 8);
          const { estPnl, estR } = computePnLAndR(estimatedExitPrice);
          const proximity = Math.min(99, Math.max(1, Math.round((1 - (currentSpread / (currentSpread + spreadVelocity * 5))) * 100)));
"""

    if search_block not in content:
        print("Search block not found")
        return

    content = content.replace(search_block, replace_block)

    with open('backend/node/src/engine/exit_estimation.service.ts', 'w') as f:
        f.write(content)

    print("Replaced!")

replace_in_file()
