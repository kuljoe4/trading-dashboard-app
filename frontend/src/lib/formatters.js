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
 * Converts milliseconds to a compact d/h/m/s string.
 */
export const formatDuration = (ms) => {
  if (ms == null || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

/**
 * Legacy duration helper for entry timestamps.
 */
export const durationFromTimestamp = (entryTs) => {
  if (!entryTs) return '0s';
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
