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

export const calculateSharpe = (trades = []) => {
  if (trades.length <= 1) return 0;
  const pnls = trades.map(t => Number(t.pnl || 0));
  const mean = pnls.reduce((a, b) => a + b, 0) / trades.length;
  const varianceSum = pnls.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0);
  const stdDev = Math.sqrt(varianceSum / trades.length);
  return stdDev > 0 ? mean / stdDev : 0;
};

export const calculateSortino = (trades = []) => {
  if (trades.length <= 1) return 0;
  const pnls = trades.map(t => Number(t.pnl || 0));
  const mean = pnls.reduce((a, b) => a + b, 0) / trades.length;
  const downsideVarianceSum = pnls.reduce((acc, p) => p < 0 ? acc + Math.pow(p, 2) : acc, 0);
  const downsideStdDev = Math.sqrt(downsideVarianceSum / trades.length);
  return downsideStdDev > 0 ? mean / downsideStdDev : 0;
};

export const getSortinoStatus = (sortino) => {
  const val = Number(sortino || 0);
  if (val >= 3.0) return { label: 'Excellent', color: 'text-green', icon: ShieldCheck };
  if (val >= 2.0) return { label: 'Good', color: 'text-blue', icon: Zap };
  if (val >= 1.0) return { label: 'Acceptable', color: 'text-amber', icon: Target };
  if (val >= 0.5) return { label: 'Weak', color: 'text-orange', icon: AlertTriangle };
  return { label: 'Poor', color: 'text-red', icon: TrendingDown };
};
