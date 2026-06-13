import { TrendingUp, TrendingDown, Target, AlertTriangle, ShieldCheck, Zap } from 'lucide-react'

export const getExpectancyStatus = (wr, wl) => {
  const expectancy = (wr * wl) - (1 - wr);

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
export const calculatePerformanceMetrics = (trades = []) => {
  const count = trades.length;
  if (count === 0) return { sharpe: 0, sortino: 0, profitFactor: 0, winRate: 0, wins: 0, totalPnl: 0, grossProfit: 0, grossLoss: 0 };

  let sumPnL = 0;
  let sumSquaredPnL = 0;
  let downsideSumSquaredPnL = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (let i = 0; i < count; i++) {
    const pnl = Number(trades[i].pnl || 0);
    sumPnL += pnl;
    sumSquaredPnL += pnl * pnl;

    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      grossLoss += Math.abs(pnl);
      downsideSumSquaredPnL += pnl * pnl;
    }
  }

  const mean = sumPnL / count;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 100 : 0);

  let sharpe = 0;
  let sortino = 0;

  if (count > 1) {
    const variance = Math.max(0, (sumSquaredPnL / count) - (mean * mean));
    const stdDev = Math.sqrt(variance);
    const downsideStdDev = Math.sqrt(downsideSumSquaredPnL / count);

    if (stdDev > 0) sharpe = mean / stdDev;
    if (downsideStdDev > 0) sortino = mean / downsideStdDev;
  }

  return {
    sharpe,
    sortino,
    profitFactor,
    winRate: Math.round((wins / count) * 100),
    wins,
    totalPnl: sumPnL,
    grossProfit,
    grossLoss
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
