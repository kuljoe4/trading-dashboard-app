/**
 * High-performance financial rounding utility.
 * Standardizes all financial calculations to 8 decimal places to match exchange precision
 * and prevent floating-point accumulation errors.
 */
export function roundEight(value: number): number {
  if (value === 0) return 0;
  // Use exponential notation to avoid floating point issues with large/small numbers
  // and round to 8 decimal places.
  return Number(Math.round(Number(value + "e+8")) + "e-8");
}

/**
 * Rounds to a specific number of decimal places.
 */
export function roundTo(value: number, decimals: number): number {
  const p = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * p) / p;
}

/**
 * Rounds down to a step size (e.g. for Binance LOT_SIZE)
 */
export function floorStep(value: number, step: number): number {
  if (!step || step === 0) return value;
  const precision = Math.log10(1 / step);
  if (precision <= 0) return Math.floor(value / step) * step;
  return Number((Math.floor(value / step) * step).toFixed(Math.max(0, Math.floor(precision))));
}
