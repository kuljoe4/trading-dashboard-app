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

  // BOLT OPTIMIZATION: Single-pass pre-processing and loop fusion.
  // We pre-calculate numeric values and timestamps once, prioritizing pre-computed ms timestamps (exit_ts_ms, entry_ts_ms)
  // to avoid redundant property accesses and expensive Date object creation inside sort and calculation loops.
  const processed = new Array(count);
  let totalNetPnL = 0;

  for (let i = 0; i < count; i++) {
    const t = trades[i];
    const pnl = Number(t.pnl || 0);
    totalNetPnL += pnl;
    processed[i] = {
      pnl,
      exitTs: t.exit_ts_ms !== undefined ? t.exit_ts_ms : (t.exit_ts || t.createdAt ? new Date(t.exit_ts || t.createdAt).getTime() : 0),
      entryTs: t.entry_ts_ms !== undefined ? t.entry_ts_ms : (t.entry_ts || t.createdAt ? new Date(t.entry_ts || t.createdAt).getTime() : 0)
    };
  }

  // Numeric sort is significantly faster than Date object comparison
  processed.sort((a, b) => a.exitTs - b.exitTs);

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

  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let totalDurationMs = 0;

  // BOLT OPTIMIZATION: Fused three passes into a single O(N) iteration.
  for (let i = 0; i < count; i++) {
    const t = processed[i];
    const pnl = t.pnl;
    sumPnL += pnl;

    const tradeReturnPct = rollingBalance > 0 ? (pnl / rollingBalance) * 100 : 0;
    rollingBalance = Math.max(1, rollingBalance + pnl);

    sumReturnPct += tradeReturnPct;
    sumSquaredReturnPct += tradeReturnPct * tradeReturnPct;

    if (t.entryTs && t.exitTs) totalDurationMs += (t.exitTs - t.entryTs);

    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else if (pnl < 0) {
      grossLoss += Math.abs(pnl);
      downsideSumSquaredReturnPct += tradeReturnPct * tradeReturnPct;
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
