import { TrendingUp, TrendingDown } from 'lucide-react'

export const getExpectancyStatus = (wr, wl) => {
  const expectancy = (wr * wl) - (1 - wr);
  return {
    expectancy,
    color: expectancy >= 0 ? 'text-green' : 'text-red',
    icon: expectancy >= 0 ? TrendingUp : TrendingDown
  };
};
