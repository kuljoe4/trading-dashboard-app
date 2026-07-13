import { TrendingUp, TrendingDown, Target, AlertTriangle, ShieldCheck, Zap } from 'lucide-react'

export const getExpectancyStatus = (wr, wl) => {
  const wlSafe = wl === Infinity || isNaN(wl) ? 100 : wl;
  const expectancy = (wr * wlSafe) - (1 - wr);

  const tiers = [
    { label: 'Excellent', range: '> 0.50' },
    { label: 'Good', range: '0.25 - 0.50' },
    { label: 'Acceptable', range: '0.05 - 0.25' },
    { label: 'Weak', range: '0.00 - 0.05' },
    { label: 'Poor', range: '< 0.00' }
  ];

  if (expectancy > 0.50) {
    return { expectancy, label: 'Excellent', color: 'text-green', icon: ShieldCheck, description: 'Highly profitable.', tiers };
  }
  if (expectancy >= 0.25) {
    return { expectancy, label: 'Good', color: 'text-blue', icon: Zap, description: 'Healthy returns.', tiers };
  }
  if (expectancy >= 0.05) {
    return { expectancy, label: 'Acceptable', color: 'text-amber', icon: Target, description: 'Within expectations.', tiers };
  }
  if (expectancy >= 0) {
    return { expectancy, label: 'Weak', color: 'text-orange', icon: AlertTriangle, description: 'Expectancy is low.', tiers };
  }

  return { expectancy, label: 'Poor', color: 'text-red', icon: TrendingDown, description: 'Losing money.', tiers };
};

export const getSharpeStatus = (sharpe) => {
  const val = Number(sharpe || 0);
  const tiers = [
    { label: 'Excellent', range: '≥ 2.0' },
    { label: 'Good', range: '1.5 - 2.0' },
    { label: 'Acceptable', range: '1.0 - 1.5' },
    { label: 'Weak', range: '0.5 - 1.0' },
    { label: 'Poor', range: '< 0.5' }
  ];
  if (val >= 2.0) return { label: 'Excellent', color: 'text-green', icon: ShieldCheck, description: 'Outstanding returns.', tiers };
  if (val >= 1.5) return { label: 'Good', color: 'text-blue', icon: Zap, description: 'Strong performance.', tiers };
  if (val >= 1.0) return { label: 'Acceptable', color: 'text-amber', icon: Target, description: 'Satisfactory return.', tiers };
  if (val >= 0.5) return { label: 'Weak', color: 'text-orange', icon: AlertTriangle, description: 'Low return.', tiers };
  return { label: 'Poor', color: 'text-red', icon: TrendingDown, description: 'Negative returns.', tiers };
};

/**
 * BOLT OPTIMIZATION: Single-pass calculation of all performance metrics.
 * Eliminates redundant iterations and temporary array allocations.
 */
/**
 * BOLT OPTIMIZATION: Unified performance metrics calculation.
 * Aligned with backend AnalyticsService to use percentage returns for Sharpe/Sortino.
 * This ensures consistency across session and lifetime views.
 */
export const calculatePerformanceMetrics = (trades = [], sessionBalance) => {
  const count = trades.length;
  if (count === 0) return { sharpe: 0, sortino: 0, profitFactor: 0, winRate: 0, wins: 0, totalPnl: 0, grossProfit: 0, grossLoss: 0 };

  // Sort trades by exit time to replicate rolling balance correctly
  const sorted = [...trades].sort((a, b) => {
    const tsA = new Date(a.exit_ts || a.createdAt).getTime();
    const tsB = new Date(b.exit_ts || b.createdAt).getTime();
    return tsA - tsB;
  });

  let totalNetPnL = 0;
  for (let i = 0; i < count; i++) totalNetPnL += Number(trades[i].pnl || 0);

  // If sessionBalance is not provided, we estimate it backwards from total PnL
  // This matches the backend's effectiveStartingBalance logic.
  let rollingBalance = sessionBalance ? Math.max(1, sessionBalance - totalNetPnL) : 10000;

  let sumReturnPct = 0;
  let sumSquaredReturnPct = 0;
  let downsideSumSquaredReturnPct = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let sumPnL = 0;

  for (let i = 0; i < count; i++) {
    const pnl = Number(sorted[i].pnl || 0);
    sumPnL += pnl;

    const tradeReturnPct = rollingBalance > 0 ? (pnl / rollingBalance) * 100 : 0;
    rollingBalance = Math.max(1, rollingBalance + pnl);

    sumReturnPct += tradeReturnPct;
    sumSquaredReturnPct += tradeReturnPct * tradeReturnPct;

    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      grossLoss += Math.abs(pnl);
      downsideSumSquaredReturnPct += tradeReturnPct * tradeReturnPct;
    }
  }

  // Calculate streaks and duration
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let totalDurationMs = 0;

  for (let i = 0; i < count; i++) {
    const t = sorted[i];
    const pnl = Number(t.pnl || 0);
    const entryTs = new Date(t.entry_ts || t.createdAt).getTime();
    const exitTs = new Date(t.exit_ts || t.createdAt).getTime();

    if (entryTs && exitTs) totalDurationMs += (exitTs - entryTs);

    if (pnl > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else if (pnl < 0) {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    }
  }

  const meanReturn = sumReturnPct / count;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 100 : 0);

  let sharpe = 0;
  let sortino = 0;

  if (count > 1) {
    const variance = Math.max(0, (sumSquaredReturnPct / count) - (meanReturn * meanReturn));
    const stdDev = Math.sqrt(variance);
    const downsideStdDev = Math.sqrt(downsideSumSquaredReturnPct / count);

    if (stdDev > 0) sharpe = meanReturn / stdDev;
    if (downsideStdDev > 0) sortino = meanReturn / downsideStdDev;
  }

  return {
    sharpe,
    sortino,
    profitFactor,
    winRate: Math.round((wins / count) * 100),
    wins,
    totalPnl: sumPnL,
    grossProfit,
    grossLoss,
    maxWinStreak,
    maxLossStreak,
    avgDuration: count > 0 ? Math.round(totalDurationMs / count) : 0
  };
};

// Deprecated in favor of calculatePerformanceMetrics, kept for legacy if needed
export const calculateSharpe = (trades = []) => calculatePerformanceMetrics(trades).sharpe;
export const calculateSortino = (trades = []) => calculatePerformanceMetrics(trades).sortino;

export const getSortinoStatus = (sortino) => {
  const val = Number(sortino || 0);
  const tiers = [
    { label: 'Excellent', range: '≥ 3.0' },
    { label: 'Good', range: '2.0 - 3.0' },
    { label: 'Acceptable', range: '1.0 - 2.0' },
    { label: 'Weak', range: '0.5 - 1.0' },
    { label: 'Poor', range: '< 0.5' }
  ];
  if (val >= 3.0) return { label: 'Excellent', color: 'text-green', icon: ShieldCheck, description: 'Superior protection.', tiers };
  if (val >= 2.0) return { label: 'Good', color: 'text-blue', icon: Zap, description: 'Strong protection.', tiers };
  if (val >= 1.0) return { label: 'Acceptable', color: 'text-amber', icon: Target, description: 'Adequate protection.', tiers };
  if (val >= 0.5) return { label: 'Weak', color: 'text-orange', icon: AlertTriangle, description: 'Insufficient protection.', tiers };
  return { label: 'Poor', color: 'text-red', icon: TrendingDown, description: 'High downside risk.', tiers };
};

export const getRrRecommendationStatus = (rr) => {
  const val = Number(rr || 0);
  const tiers = [
    { label: 'Aggressive', range: '≥ 3.0R' },
    { label: 'Balanced', range: '1.5R - 3.0R' },
    { label: 'Conservative', range: '0.8R - 1.5R' },
    { label: 'Scalp', range: '< 0.8R' }
  ];

  if (val >= 3.0) return { label: 'Aggressive', color: 'text-purple', icon: Zap, description: 'High reward target.', tiers };
  if (val >= 1.5) return { label: 'Balanced', color: 'text-blue', icon: Target, description: 'Optimal risk/reward.', tiers };
  if (val >= 0.8) return { label: 'Conservative', color: 'text-green', icon: ShieldCheck, description: 'High probability target.', tiers };
  return { label: 'Scalp', color: 'text-amber', icon: TrendingUp, description: 'Quick turnarounds.', tiers };
};
