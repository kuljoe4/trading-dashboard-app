/**
 * Performance-optimized price formatter.
 * Standardizes price display across the application.
 */
export const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '---';
  const n = Number(value);
  if (n >= 100) return `$${n.toFixed(2)}`;
  // For small prices, show more precision but trim trailing zeros
  return `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
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
