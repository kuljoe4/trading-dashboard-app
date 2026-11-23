import type { Candle } from './kline_store.service';

export type HtfFreshnessState = 'fresh' | 'approaching' | 'early' | 'extended' | 'stale';

export interface HtfEmaCrossSummary {
  interval: string;
  avg_profit_pct: number;
  avg_peak_rr: number;
  win_rate: number;
  cross_count: number;
  last_cross_direction?: 'LONG' | 'SHORT';
  bars_since_cross: number;
  ema_spread_pct: number;
  move_since_cross_pct: number;
  is_converging: boolean;
  freshness_state: HtfFreshnessState;
  freshness_score: number;
  suitability_score: number;
}

/**
 * Single-pass fused dual EMA computation over candles.
 */
export function computeDualEmaArrays(
  candles: Candle[],
  fastPeriod: number,
  slowPeriod: number,
): { fastEma: number[]; slowEma: number[] } {
  const len = candles.length;
  const fastEma = new Array<number>(len);
  const slowEma = new Array<number>(len);

  const fastK = 2 / (fastPeriod + 1);
  const slowK = 2 / (slowPeriod + 1);

  let fastSum = 0;
  let slowSum = 0;
  let fastVal = 0;
  let slowVal = 0;

  for (let i = 0; i < len; i++) {
    const close = candles[i].close;

    if (i < fastPeriod) {
      fastSum += close;
      fastEma[i] = close;
      if (i === fastPeriod - 1) {
        fastVal = fastSum / fastPeriod;
        fastEma[i] = fastVal;
      }
    } else {
      fastVal += (close - fastVal) * fastK;
      fastEma[i] = fastVal;
    }

    if (i < slowPeriod) {
      slowSum += close;
      slowEma[i] = close;
      if (i === slowPeriod - 1) {
        slowVal = slowSum / slowPeriod;
        slowEma[i] = slowVal;
      }
    } else {
      slowVal += (close - slowVal) * slowK;
      slowEma[i] = slowVal;
    }
  }

  return { fastEma, slowEma };
}

/**
 * Evaluates HTF EMA dual crossover historical profitability AND current freshness/non-staleness
 * in a single backwards scan with zero extra memory retention.
 */
export function evaluateHtfEmaCross(
  candles: Candle[],
  options?: {
    interval?: string;
    fastPeriod?: number;
    slowPeriod?: number;
    targetCrossCount?: number;
    slDistPct?: number;
    allowPreCrossOnly?: boolean;
    preferFresh?: boolean;
    maxFreshBars?: number;
  },
): HtfEmaCrossSummary | null {
  const fastPeriod = Math.max(2, options?.fastPeriod || 9);
  const slowPeriod = Math.max(fastPeriod + 1, options?.slowPeriod || 21);
  const targetCrossCount = Math.min(20, Math.max(1, options?.targetCrossCount ?? 4));
  const slDistPct = Math.max(0.05, options?.slDistPct ?? 0.8);
  const interval = options?.interval || '4h';
  const preferFresh = options?.preferFresh !== false;
  const maxFreshBars = Math.min(30, Math.max(2, Math.round(options?.maxFreshBars ?? 6)));

  if (!candles || candles.length < slowPeriod + 3) {
    return null;
  }

  const { fastEma, slowEma } = computeDualEmaArrays(candles, fastPeriod, slowPeriod);
  const lastIdx = candles.length - 1;
  if (fastEma.length !== candles.length || slowEma.length !== candles.length) {
    return null;
  }

  const lastSlow = slowEma[lastIdx];
  const lastFast = fastEma[lastIdx];
  const prevSlow = slowEma[lastIdx - 1];
  const prevFast = fastEma[lastIdx - 1];
  const emaSpreadPct = lastSlow > 0 ? ((lastFast - lastSlow) / lastSlow) * 100 : 0;
  const prevSpreadPct = prevSlow > 0 ? ((prevFast - prevSlow) / prevSlow) * 100 : emaSpreadPct;
  const isConverging = Math.abs(emaSpreadPct) < Math.abs(prevSpreadPct);

  // Check if forming candle itself just crossed
  const formingBull = prevFast <= prevSlow && lastFast > lastSlow;
  const formingBear = prevFast >= prevSlow && lastFast < lastSlow;

  let profitSum = 0;
  let rrSum = 0;
  let crossCount = 0;
  let wins = 0;
  let lastCrossDirection: 'LONG' | 'SHORT' | undefined = formingBull ? 'LONG' : formingBear ? 'SHORT' : undefined;
  let latestCrossIdx = (formingBull || formingBear) ? lastIdx : -1;

  for (let i = candles.length - 2; i >= slowPeriod; i--) {
    const pFast = fastEma[i - 1];
    const pSlow = slowEma[i - 1];
    const cFast = fastEma[i];
    const cSlow = slowEma[i];

    const isBullCross = pFast <= pSlow && cFast > cSlow;
    const isBearCross = pFast >= pSlow && cFast < cSlow;

    if (isBullCross || isBearCross) {
      const crossDir: 'LONG' | 'SHORT' = isBullCross ? 'LONG' : 'SHORT';
      if (latestCrossIdx === -1) {
        latestCrossIdx = i;
        lastCrossDirection = crossDir;
      } else if (!lastCrossDirection) {
        lastCrossDirection = crossDir;
      }

      const entryPrice = candles[i].close;
      const slPriceLong = entryPrice * (1 - slDistPct / 100);
      const slPriceShort = entryPrice * (1 + slDistPct / 100);
      let actualExitPrice = entryPrice;
      let hitSl = false;

      const forwardWindow = candles.length - 1;
      for (let j = i + 1; j <= forwardWindow; j++) {
        const fPrevFast = fastEma[j - 1];
        const fPrevSlow = slowEma[j - 1];
        const fCurrFast = fastEma[j];
        const fCurrSlow = slowEma[j];

        const fBullCross = fPrevFast <= fPrevSlow && fCurrFast > fCurrSlow;
        const fBearCross = fPrevFast >= fPrevSlow && fCurrFast < fCurrSlow;

        if (crossDir === 'LONG' && candles[j].low <= slPriceLong) {
          actualExitPrice = slPriceLong;
          hitSl = true;
          break;
        } else if (crossDir === 'SHORT' && candles[j].high >= slPriceShort) {
          actualExitPrice = slPriceShort;
          hitSl = true;
          break;
        }

        if (crossDir === 'LONG' && fBearCross) {
          actualExitPrice = candles[j].close;
          break;
        } else if (crossDir === 'SHORT' && fBullCross) {
          actualExitPrice = candles[j].close;
          break;
        }

        if (j === forwardWindow) {
          actualExitPrice = candles[j].close;
        }
      }

      const profitPct = hitSl
        ? -slDistPct
        : crossDir === 'LONG'
          ? ((actualExitPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - actualExitPrice) / entryPrice) * 100;

      const actualRr = slDistPct > 0 ? profitPct / slDistPct : profitPct;

      profitSum += profitPct;
      rrSum += actualRr;
      crossCount++;
      if (profitPct > 0) wins++;

      if (crossCount >= targetCrossCount) {
        break;
      }
    }
  }

  if (crossCount === 0 && !(options?.allowPreCrossOnly && Math.abs(emaSpreadPct) <= 0.45 && isConverging)) {
    return null;
  }

  const avgProfitPct = crossCount > 0 ? profitSum / crossCount : 0;
  const avgPeakRr = crossCount > 0 ? rrSum / crossCount : 0;
  const winRate = crossCount > 0 ? (wins / crossCount) * 100 : 0;

  const barsSinceCross = latestCrossIdx >= 0 ? Math.max(0, lastIdx - latestCrossIdx) : candles.length;
  const currClose = candles[lastIdx].close;
  const crossPrice = latestCrossIdx >= 0 ? candles[latestCrossIdx].close : currClose;
  const activeDir: 'LONG' | 'SHORT' = lastCrossDirection || (emaSpreadPct >= 0 ? 'LONG' : 'SHORT');
  const moveSinceCrossPct = crossPrice > 0
    ? (activeDir === 'LONG'
        ? ((currClose - crossPrice) / crossPrice) * 100
        : ((crossPrice - currClose) / crossPrice) * 100)
    : 0;

  const absSpread = Math.abs(emaSpreadPct);
  const freshLimit = Math.max(1, Math.min(12, Math.round(maxFreshBars * 0.5)));
  const earlyLimit = Math.max(freshLimit + 1, maxFreshBars);
  const extendedLimit = Math.max(earlyLimit + 2, Math.round(maxFreshBars * 1.67));

  let freshnessState: HtfFreshnessState;
  if (barsSinceCross <= freshLimit && moveSinceCrossPct <= 4.5) {
    freshnessState = 'fresh';
  } else if (absSpread <= 0.35 && (isConverging || barsSinceCross > freshLimit)) {
    freshnessState = 'approaching';
  } else if (barsSinceCross <= earlyLimit && moveSinceCrossPct <= 7.0) {
    freshnessState = 'early';
  } else if (barsSinceCross <= extendedLimit && moveSinceCrossPct <= 11.0) {
    freshnessState = 'extended';
  } else {
    freshnessState = 'stale';
  }

  let freshnessScore = 0;
  if (freshnessState === 'fresh') {
    const extPenalty = Math.max(0, moveSinceCrossPct - 2.0) * 4;
    freshnessScore = Math.max(68, 100 - barsSinceCross * 7 - extPenalty);
  } else if (freshnessState === 'approaching') {
    const proximityBonus = Math.max(0, (0.35 - absSpread) / 0.35) * 18;
    freshnessScore = 70 + proximityBonus + (isConverging ? 6 : 0);
  } else if (freshnessState === 'early') {
    const extPenalty = Math.max(0, moveSinceCrossPct - 3.0) * 4;
    freshnessScore = Math.max(42, 74 - (barsSinceCross - freshLimit) * 7 - extPenalty);
  } else if (freshnessState === 'extended') {
    const extPenalty = Math.max(0, moveSinceCrossPct - 5.0) * 3;
    freshnessScore = Math.max(20, 48 - Math.max(0, barsSinceCross - earlyLimit) * 4 - extPenalty);
  } else {
    const barDecay = Math.max(0, barsSinceCross - extendedLimit) * 2.5;
    const extPenalty = Math.max(0, moveSinceCrossPct - 8.0) * 2;
    freshnessScore = Math.max(4, 28 - barDecay - extPenalty);
  }
  freshnessScore = Math.min(100, Math.max(0, freshnessScore));

  // Profitability component (0-100) rewarding positive win rate, avg peak RR, and net cross profit
  const rrNorm = Math.min(100, Math.max(0, (avgPeakRr / 3.0) * 100));
  const profitNorm = Math.min(100, Math.max(0, (avgProfitPct / 5.0) * 100));
  let profitScore = crossCount > 0
    ? (winRate * 0.45 + rrNorm * 0.35 + profitNorm * 0.20)
    : 50; // Neutral prior when approaching first cross in window

  if (crossCount > 0 && avgProfitPct < 0) {
    profitScore *= 0.45;
  }

  let suitabilityScore: number;
  if (preferFresh) {
    suitabilityScore = freshnessScore * 0.55 + profitScore * 0.45;
    if (freshnessState === 'stale') {
      suitabilityScore = Math.min(39, suitabilityScore * 0.45);
    } else if (freshnessState === 'extended') {
      suitabilityScore = Math.min(59, suitabilityScore * 0.68);
    }
    if (crossCount >= 2 && avgProfitPct < 0) {
      suitabilityScore *= 0.72;
    }
  } else {
    // Pure historical profitability mode when freshness filtering is opted out
    suitabilityScore = profitScore;
  }
  suitabilityScore = Math.min(100, Math.max(0, suitabilityScore));

  return {
    interval,
    avg_profit_pct: Number(avgProfitPct.toFixed(2)),
    avg_peak_rr: Number(avgPeakRr.toFixed(2)),
    win_rate: Number(winRate.toFixed(1)),
    cross_count: crossCount,
    last_cross_direction: activeDir,
    bars_since_cross: barsSinceCross,
    ema_spread_pct: Number(emaSpreadPct.toFixed(3)),
    move_since_cross_pct: Number(moveSinceCrossPct.toFixed(2)),
    is_converging: isConverging,
    freshness_state: freshnessState,
    freshness_score: Number(freshnessScore.toFixed(1)),
    suitability_score: Number(suitabilityScore.toFixed(1)),
  };
}
