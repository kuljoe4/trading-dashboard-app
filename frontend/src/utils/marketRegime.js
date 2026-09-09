/**
 * Market Regime & Pace Analytics Utility
 *
 * Evaluates market speed, volatility, and momentum density across scanner results.
 * Provides zero-allocation memoized metrics, WCAG-compliant styling badges, and
 * contextual guidance messages for slow vs active market conditions.
 */

export const getMarketRegimeInfo = (scannerResults = [], config = {}, extraState = {}) => {
  const threshold = Math.max(0.01, Number(config?.scan_pct_threshold ?? 2.0));
  const scanInterval = String(config?.scan_interval || '1m');
  const resultsArr = Array.isArray(scannerResults) ? scannerResults : [];
  const totalCount = resultsArr.length;

  let sumAbsMomentum = 0;
  let sumVolScore = 0;
  let sumScore = 0;
  let maxAbsMomentum = 0;
  let passingCount = 0;

  // Single-pass O(N) iteration over scanner candidates
  for (let i = 0; i < totalCount; i++) {
    const opp = resultsArr[i];
    if (!opp) continue;

    const absMom = Math.abs(Number(opp.momentum ?? opp.pct ?? 0));
    sumAbsMomentum += absMom;
    if (absMom > maxAbsMomentum) maxAbsMomentum = absMom;

    if (opp.score_breakdown && typeof opp.score_breakdown.volatility === 'number') {
      sumVolScore += opp.score_breakdown.volatility;
    } else {
      sumVolScore += Math.min(100, absMom * 25);
    }

    sumScore += Number(opp.score ?? 0);

    if (absMom >= threshold) {
      passingCount++;
    }
  }

  const avgMomentum = totalCount > 0 ? sumAbsMomentum / totalCount : 0;
  const avgVolScore = totalCount > 0 ? sumVolScore / totalCount : 0;
  const avgScore = totalCount > 0 ? sumScore / totalCount : 0;

  // Check state overrides
  if (extraState?.scannerPaused) {
    return {
      regime: 'paused',
      label: 'Scanner Paused',
      subLabel: 'Market evaluation temporarily suspended',
      badgeClass: 'bg-red/10 text-red border-red/20',
      pillClass: 'bg-red/20 text-red border-red/30',
      iconName: 'PauseCircle',
      avgMomentum,
      avgVolScore,
      avgScore,
      maxAbsMomentum,
      passingCount,
      totalCount,
      threshold,
      scanInterval,
      speedPct: 0,
      guidance: 'The market scanner is currently paused. Resume scanning in strategy controls to evaluate opportunities.',
    };
  }

  if (extraState?.hibernating) {
    return {
      regime: 'hibernating',
      label: 'Engine Hibernating',
      subLabel: 'Resource saving mode active',
      badgeClass: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
      pillClass: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
      iconName: 'Moon',
      avgMomentum,
      avgVolScore,
      avgScore,
      maxAbsMomentum,
      passingCount,
      totalCount,
      threshold,
      scanInterval,
      speedPct: 0,
      guidance: 'Engine is in hibernation mode to conserve resources during idle periods.',
    };
  }

  // Evaluate market regime thresholds
  const isQuiet = totalCount === 0 || (passingCount === 0 && avgMomentum < 1.2 && avgScore < 45 && maxAbsMomentum < threshold);
  const isActive = passingCount >= 2 || avgMomentum >= 2.0 || avgScore >= 65 || maxAbsMomentum >= (threshold * 1.5);

  if (isQuiet) {
    const rawSpeed = Math.min(30, Math.round((avgMomentum / threshold) * 25));
    return {
      regime: 'slow',
      label: 'Slow / Quiet Market',
      subLabel: 'Low Volatility • Rangebound Consolidation',
      badgeClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
      pillClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
      meterClass: 'bg-cyan-400',
      iconName: 'Turtle',
      avgMomentum,
      avgVolScore,
      avgScore,
      maxAbsMomentum,
      passingCount,
      totalCount,
      threshold,
      scanInterval,
      speedPct: Math.max(10, rawSpeed),
      guidance: `Low market velocity detected (Avg momentum ${avgMomentum.toFixed(2)}%). Price action is consolidating below the ${threshold.toFixed(1)}% scan threshold. The scanner is actively monitoring ${scanInterval} klines and will trigger signals upon range expansion.`,
    };
  }

  if (isActive) {
    const rawSpeed = Math.min(100, Math.max(70, Math.round((avgMomentum / threshold) * 55)));
    return {
      regime: 'active',
      label: 'Fast / High Volatility',
      subLabel: 'Strong Momentum • Expansion Phase',
      badgeClass: 'bg-accent/10 text-accent border-accent/20',
      pillClass: 'bg-accent/20 text-accent border-accent/30',
      meterClass: 'bg-accent',
      iconName: 'Flame',
      avgMomentum,
      avgVolScore,
      avgScore,
      maxAbsMomentum,
      passingCount,
      totalCount,
      threshold,
      scanInterval,
      speedPct: rawSpeed,
      guidance: `High market velocity detected (${passingCount}/${totalCount} candidates > ${threshold.toFixed(1)}% threshold). Price range is expanding rapidly with active strategy entry evaluation.`,
    };
  }

  // Moderate / Neutral
  const rawSpeed = Math.min(69, Math.max(35, Math.round((avgMomentum / threshold) * 40)));
  return {
    regime: 'moderate',
    label: 'Moderate Pace',
    subLabel: 'Steady Volatility • Selective Opportunities',
    badgeClass: 'bg-amber/10 text-amber border-amber/20',
    pillClass: 'bg-amber/20 text-amber border-amber/30',
    meterClass: 'bg-amber',
    iconName: 'Zap',
    avgMomentum,
    avgVolScore,
    avgScore,
    maxAbsMomentum,
    passingCount,
    totalCount,
    threshold,
    scanInterval,
    speedPct: rawSpeed,
    guidance: `Market velocity is steady (Avg momentum ${avgMomentum.toFixed(2)}%). Opportunities are evaluated selectively as candidates approach the ${threshold.toFixed(1)}% scan threshold.`,
  };
};
