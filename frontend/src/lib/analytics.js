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
      color: 'text-green',
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
      color: 'text-dim',
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
  if (val >= 1.5) return { label: 'Good', color: 'text-green', icon: Zap };
  if (val >= 1.0) return { label: 'Acceptable', color: 'text-amber', icon: Target };
  if (val >= 0.5) return { label: 'Weak', color: 'text-dim', icon: AlertTriangle };
  return { label: 'Poor', color: 'text-red', icon: TrendingDown };
};

export const getSortinoStatus = (sortino) => {
  const val = Number(sortino || 0);
  if (val >= 3.0) return { label: 'Excellent', color: 'text-green', icon: ShieldCheck };
  if (val >= 2.0) return { label: 'Good', color: 'text-green', icon: Zap };
  if (val >= 1.0) return { label: 'Acceptable', color: 'text-amber', icon: Target };
  if (val >= 0.5) return { label: 'Weak', color: 'text-dim', icon: AlertTriangle };
  return { label: 'Poor', color: 'text-red', icon: TrendingDown };
};
