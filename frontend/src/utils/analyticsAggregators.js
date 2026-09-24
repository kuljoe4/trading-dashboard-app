/**
 * BOLT OPTIMIZATION: Single-pass loop-fused data aggregation for TODPerformance
 * Consolidates filtering, max PnL lookup, and average positive/negative PnL calculations
 * into a single traversal, eliminating intermediate array allocations (.filter(), .map()).
 *
 * @param {Array} data The time-of-day performance data to aggregate
 * @returns {Object} Aggregated data including valid points, max PnL, and averages
 */
export const aggregateTODPerformance = (data) => {
  const safeData = Array.isArray(data) ? data : [];
  const valid = [];
  let max = 1;
  let posSum = 0;
  let posCount = 0;
  let negSum = 0;
  let negCount = 0;

  const len = safeData.length;
  for (let i = 0; i < len; i++) {
    const d = safeData[i];
    if (d && typeof d.pnl === 'number' && !Number.isNaN(d.pnl)) {
      valid.push(d);
      const absPnl = Math.abs(d.pnl);
      if (absPnl > max) {
        max = absPnl;
      }
      if (d.pnl > 0) {
        posSum += d.pnl;
        posCount++;
      } else if (d.pnl < 0) {
        negSum += absPnl;
        negCount++;
      }
    }
  }

  return {
    validData: valid,
    maxPnl: max,
    avgPos: posCount > 0 ? posSum / posCount : 0,
    avgNeg: negCount > 0 ? negSum / negCount : 0
  };
};