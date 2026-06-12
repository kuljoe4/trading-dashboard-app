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
