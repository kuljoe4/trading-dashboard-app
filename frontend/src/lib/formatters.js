/**
 * Performance-optimized price formatter.
 * Standardizes price display across the application.
 */
export const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '---';
  const n = Number(value);
  if (n === 0) return '$0.00';
  if (n >= 100) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

  // For small prices (e.g. 0.00024), dynamically adjust precision to show at least 4 significant digits
  // but cap at 8 to avoid floating point noise.
  const magnitude = Math.floor(Math.log10(Math.abs(n)));
  const precision = Math.min(8, Math.max(4, Math.abs(magnitude) + 4));

  return `$${n.toFixed(precision).replace(/0+$/, '').replace(/\.$/, '')}`;
};

/**
 * Human-readable duration formatter for trade activity.
 * Converts milliseconds to a compact d/h/m string.
 */
export const formatDuration = (ms) => {
  if (ms == null || ms < 0) return '0m';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h % 24 > 0 || d > 0) parts.push(`${h % 24}h`);
  if (m % 60 > 0 || h > 0 || parts.length === 0) parts.push(`${m % 60}m`);

  return parts.join(' ');
};

/**
 * Legacy duration helper for entry timestamps.
 */
export const durationFromTimestamp = (entryTs) => {
  if (!entryTs) return '0m';
  const now = Date.now();
  const entry = new Date(entryTs).getTime();
  return formatDuration(now - entry);
};

/**
 * Robust UI Proximity Bar Standard:
 * Proximity and progress metrics across both entry and exit views (including `SignalGauge.jsx` and `TradeDetailContent.jsx`)
 * are evaluated via this centralized direction-aware helper function.
 * Enforces safe validation guarding against `NaN`, `Infinity`, and division-by-zero errors (such as when `threshold === 0`
 * or `threshold === entryPrice`) and correctly processes direction momentum progress for both LONG and SHORT configurations.
 * Features an opposite-sign guard for indicators, clamps progress to 99% if the signal hasn't fired yet to avoid visual mismatches,
 * and handles `insufficientData` gracefully.
 */
export const calculateProximity = (signal, mark, entryPrice, isLong = true, isExit = false) => {
  if (!signal) return 0;

  const value = Number(signal.value);
  const threshold = Number(signal.threshold);
  const entry = Number(entryPrice);
  const currentMark = Number(mark);

  const insufficientData = !!signal.insufficientData;
  const isFired = !!signal.fired;
  const isActive = signal.active !== false;
  const thresholdIsPrice = !!(signal.threshold_is_price || signal.thresholdIsPrice);

  if (insufficientData) {
    return 0;
  }

  if (isFired && isActive) {
    return 100;
  }

  const maxVal = isFired ? 100 : 99;

  // Handle price-based signals
  if (thresholdIsPrice) {
    if (entry === 0 || threshold === 0 || threshold === entry) {
      return 0;
    }
    if (isExit) {
      const reference = Math.max(1e-8, Math.abs(entry - threshold));
      let progress = 0;
      if (isLong) {
        if (currentMark <= threshold) {
          progress = maxVal;
        } else {
          const distance = currentMark - threshold;
          progress = (1 - (distance / reference)) * 100;
        }
      } else {
        // SHORT
        if (currentMark >= threshold) {
          progress = maxVal;
        } else {
          const distance = threshold - currentMark;
          progress = (1 - (distance / reference)) * 100;
        }
      }
      return isFinite(progress) && !isNaN(progress) ? Math.max(0, Math.min(maxVal, progress)) : 0;
    } else {
      // Entry signals
      const totalDist = threshold - entry;
      const currentDist = currentMark - entry;
      const progress = (currentDist / totalDist) * 100;
      return isFinite(progress) && !isNaN(progress) ? Math.max(0, Math.min(maxVal, progress)) : 0;
    }
  }

  // Handle indicator-based signals
  if (threshold === 0) {
    return 0;
  }

  const hasOppositeSign = (value > 0 && threshold < 0) || (value < 0 && threshold > 0);
  if (hasOppositeSign) {
    return 0;
  }

  const progress = (Math.abs(value) / Math.abs(threshold)) * 100;
  return isFinite(progress) && !isNaN(progress) ? Math.max(0, Math.min(maxVal, progress)) : 0;
};

// BOLT OPTIMIZATION: Bounded stable WeakMap cache for Supertrend calculations to avoid redundant O(N) passes on the same dataset.
// Using WeakMap keyed on the candles array reference ensures 100% collision-proof, memory-safe, and asset-isolated caching.
const supertrendWeakCache = new WeakMap();

/**
 * Premium Wilder's RMA/ATR-based Supertrend calculation on the frontend.
 * Matches the backend calculation in signalEngine.ts exactly.
 */
export const calculateSupertrend = (candles = [], period = 10, multiplier = 3) => {
  const len = candles.length;
  if (len === 0) {
    return { supertrend: [], direction: [], insufficientData: true };
  }

  let assetCache = supertrendWeakCache.get(candles);
  if (!assetCache) {
    assetCache = new Map();
    supertrendWeakCache.set(candles, assetCache);
  }

  const key = `${period}:${multiplier}`;
  const cached = assetCache.get(key);
  if (cached) return cached;

  const supertrend = new Array(len).fill(0);
  const direction = new Array(len).fill('up'); // 'up' | 'down'

  if (len < period + 1) {
    return { supertrend, direction, insufficientData: true };
  }

  // Safe getter for OHLC values from different possible shapes
  const getCandle = (c) => ({
    open: Number(c.open ?? c.o ?? 0),
    high: Number(c.high ?? c.h ?? 0),
    low: Number(c.low ?? c.l ?? 0),
    close: Number(c.close ?? c.c ?? 0),
  });

  // 1. Calculate TR sum for the initial period to bootstrap ATR
  const c0 = getCandle(candles[0]);
  let trSum = c0.high - c0.low;
  for (let i = 1; i < period; i++) {
    const ci = getCandle(candles[i]);
    const ciPrev = getCandle(candles[i - 1]);
    const hL = ci.high - ci.low;
    const hC = Math.abs(ci.high - ciPrev.close);
    const lC = Math.abs(ci.low - ciPrev.close);
    trSum += Math.max(hL, hC, lC);
  }

  let prevAtr = trSum / period;

  // 2. Initialize variables for tracking final bands and supertrend
  const cpMinus1 = getCandle(candles[period - 1]);
  const initHl2 = (cpMinus1.high + cpMinus1.low) / 2;
  let prevFinalUpper = initHl2 + multiplier * prevAtr;
  let prevFinalLower = initHl2 - multiplier * prevAtr;

  supertrend[period - 1] = prevFinalUpper;
  direction[period - 1] = 'down';

  // 3. Main single-pass loop over the remaining candles
  for (let i = period; i < len; i++) {
    const ci = getCandle(candles[i]);
    const ciPrev = getCandle(candles[i - 1]);

    // Calculate TR
    const hL = ci.high - ci.low;
    const hC = Math.abs(ci.high - ciPrev.close);
    const lC = Math.abs(ci.low - ciPrev.close);
    const tr = Math.max(hL, hC, lC);

    // Calculate ATR (Wilder's RMA smoothing)
    const atr = (prevAtr * (period - 1) + tr) / period;
    prevAtr = atr;

    // Calculate basic bands
    const hl2 = (ci.high + ci.low) / 2;
    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    // Calculate final bands
    const prevClose = ciPrev.close;
    let finalUpper = 0;
    let finalLower = 0;

    if (basicUpper < prevFinalUpper || prevClose > prevFinalUpper) {
      finalUpper = basicUpper;
    } else {
      finalUpper = prevFinalUpper;
    }

    if (basicLower > prevFinalLower || prevClose < prevFinalLower) {
      finalLower = basicLower;
    } else {
      finalLower = prevFinalLower;
    }

    // Calculate Supertrend and direction
    const prevST = supertrend[i - 1];
    if (prevST === prevFinalUpper) {
      if (ci.close > finalUpper) {
        supertrend[i] = finalLower;
        direction[i] = 'up'; // bullish breakout
      } else {
        supertrend[i] = finalUpper;
        direction[i] = 'down';
      }
    } else { // prevST === prevFinalLower
      if (ci.close < finalLower) {
        supertrend[i] = finalUpper;
        direction[i] = 'down'; // bearish breakout
      } else {
        supertrend[i] = finalLower;
        direction[i] = 'up';
      }
    }

    // Update band trackers for next iteration
    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
  }

  const result = { supertrend, direction, insufficientData: false };
  assetCache.set(key, result);

  return result;
};
