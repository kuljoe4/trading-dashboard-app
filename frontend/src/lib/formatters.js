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
