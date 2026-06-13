import { TrendingUp, TrendingDown, Target, AlertTriangle, ShieldCheck, Zap } from 'lucide-react'

export const getExpectancyStatus = (wr, wl) => {
  const expectancy = (wr * wl) - (1 - wr);

  if (expectancy > 0.50) {
    return {
      expectancy,
      label: 'Excellent',
      color: 'text-green',
      icon: ShieldCheck
    };
  }
  if (expectancy >= 0.25) {
    return {
      expectancy,
      label: 'Good',
      color: 'text-blue',
      icon: Zap
    };
  }
  if (expectancy >= 0.05) {
    return {
      expectancy,
      label: 'Acceptable',
      color: 'text-amber',
      icon: Target
    };
  }
  if (expectancy >= 0) {
    return {
      expectancy,
      label: 'Weak',
      color: 'text-orange',
      icon: AlertTriangle
    };
  }

  return {
    expectancy,
    label: 'Poor',
    color: 'text-red',
    icon: TrendingDown
  };
};

export const getSharpeStatus = (sharpe) => {
  const val = Number(sharpe || 0);
  if (val >= 2.0) return { label: 'Excellent', color: 'text-green', icon: ShieldCheck };
  if (val >= 1.5) return { label: 'Good', color: 'text-blue', icon: Zap };
  if (val >= 1.0) return { label: 'Acceptable', color: 'text-amber', icon: Target };
  if (val >= 0.5) return { label: 'Weak', color: 'text-orange', icon: AlertTriangle };
  return { label: 'Poor', color: 'text-red', icon: TrendingDown };
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
  if (val >= 3.0) return { label: 'Excellent', color: 'text-green', icon: ShieldCheck };
  if (val >= 2.0) return { label: 'Good', color: 'text-blue', icon: Zap };
  if (val >= 1.0) return { label: 'Acceptable', color: 'text-amber', icon: Target };
  if (val >= 0.5) return { label: 'Weak', color: 'text-orange', icon: AlertTriangle };
  return { label: 'Poor', color: 'text-red', icon: TrendingDown };
};
