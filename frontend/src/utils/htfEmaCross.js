/**
 * Shared HTF EMA Cross freshness, suitability ranking, formatting, and rotation selector utilities.
 * Designed for zero-bloat O(N) evaluation and deterministic UI/scheduler ranking.
 */

export function computeDualEmaArrays(candles, fastPeriod = 9, slowPeriod = 21) {
  const len = Array.isArray(candles) ? candles.length : 0;
  const fastEma = new Array(len);
  const slowEma = new Array(len);
  if (len === 0) return { fastEma, slowEma };

  const fastK = 2 / (fastPeriod + 1);
  const slowK = 2 / (slowPeriod + 1);

  let fastSum = 0;
  let slowSum = 0;
  let fastVal = 0;
  let slowVal = 0;

  for (let i = 0; i < len; i++) {
    const close = Number(candles[i]?.close ?? candles[i] ?? 0);

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

export function evaluateHtfEmaCrossFromCandles(candles, options = {}) {
  const fastPeriod = Math.max(2, Number(options.fastPeriod || 9));
  const slowPeriod = Math.max(fastPeriod + 1, Number(options.slowPeriod || 21));
  const targetCrossCount = Math.min(20, Math.max(1, Number(options.targetCrossCount ?? 4)));
  const slDistPct = Math.max(0.05, Number(options.slDistPct ?? 0.8));
  const interval = options.interval || '4h';
  const preferFresh = options.preferFresh !== false;
  const maxFreshBars = Math.min(30, Math.max(2, Math.round(Number(options.maxFreshBars ?? 6))));

  if (!Array.isArray(candles) || candles.length < slowPeriod + 3) {
    return null;
  }

  const { fastEma, slowEma } = computeDualEmaArrays(candles, fastPeriod, slowPeriod);
  const lastIdx = candles.length - 1;

  const lastSlow = slowEma[lastIdx];
  const lastFast = fastEma[lastIdx];
  const prevSlow = slowEma[lastIdx - 1];
  const prevFast = fastEma[lastIdx - 1];
  const emaSpreadPct = lastSlow > 0 ? ((lastFast - lastSlow) / lastSlow) * 100 : 0;
  const prevSpreadPct = prevSlow > 0 ? ((prevFast - prevSlow) / prevSlow) * 100 : emaSpreadPct;
  const isConverging = Math.abs(emaSpreadPct) < Math.abs(prevSpreadPct);

  const formingBull = prevFast <= prevSlow && lastFast > lastSlow;
  const formingBear = prevFast >= prevSlow && lastFast < lastSlow;

  let profitSum = 0;
  let rrSum = 0;
  let crossCount = 0;
  let wins = 0;
  let lastCrossDirection = formingBull ? 'LONG' : formingBear ? 'SHORT' : undefined;
  let latestCrossIdx = (formingBull || formingBear) ? lastIdx : -1;

  for (let i = candles.length - 2; i >= slowPeriod; i--) {
    const pFast = fastEma[i - 1];
    const pSlow = slowEma[i - 1];
    const cFast = fastEma[i];
    const cSlow = slowEma[i];

    const isBullCross = pFast <= pSlow && cFast > cSlow;
    const isBearCross = pFast >= pSlow && cFast < cSlow;

    if (isBullCross || isBearCross) {
      const crossDir = isBullCross ? 'LONG' : 'SHORT';
      if (latestCrossIdx === -1) {
        latestCrossIdx = i;
        lastCrossDirection = crossDir;
      } else if (!lastCrossDirection) {
        lastCrossDirection = crossDir;
      }

      const entryPrice = Number(candles[i].close);
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

        const cLow = Number(candles[j].low ?? candles[j].close);
        const cHigh = Number(candles[j].high ?? candles[j].close);
        const cClose = Number(candles[j].close);

        if (crossDir === 'LONG' && cLow <= slPriceLong) {
          actualExitPrice = slPriceLong;
          hitSl = true;
          break;
        } else if (crossDir === 'SHORT' && cHigh >= slPriceShort) {
          actualExitPrice = slPriceShort;
          hitSl = true;
          break;
        }

        if (crossDir === 'LONG' && fBearCross) {
          actualExitPrice = cClose;
          break;
        } else if (crossDir === 'SHORT' && fBullCross) {
          actualExitPrice = cClose;
          break;
        }

        if (j === forwardWindow) {
          actualExitPrice = cClose;
        }
      }

      const profitPct = hitSl
        ? -slDistPct
        : entryPrice > 0
          ? (crossDir === 'LONG'
              ? ((actualExitPrice - entryPrice) / entryPrice) * 100
              : ((entryPrice - actualExitPrice) / entryPrice) * 100)
          : 0;

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

  if (crossCount === 0 && !(options.allowPreCrossOnly && Math.abs(emaSpreadPct) <= 0.45 && isConverging)) {
    return null;
  }

  const avgProfitPct = crossCount > 0 ? profitSum / crossCount : 0;
  const avgPeakRr = crossCount > 0 ? rrSum / crossCount : 0;
  const winRate = crossCount > 0 ? (wins / crossCount) * 100 : 0;

  const barsSinceCross = latestCrossIdx >= 0 ? Math.max(0, lastIdx - latestCrossIdx) : candles.length;
  const currClose = Number(candles[lastIdx].close);
  const crossPrice = latestCrossIdx >= 0 ? Number(candles[latestCrossIdx].close) : currClose;
  const activeDir = lastCrossDirection || (emaSpreadPct >= 0 ? 'LONG' : 'SHORT');
  const moveSinceCrossPct = crossPrice > 0
    ? (activeDir === 'LONG'
        ? ((currClose - crossPrice) / crossPrice) * 100
        : ((crossPrice - currClose) / crossPrice) * 100)
    : 0;

  const absSpread = Math.abs(emaSpreadPct);
  const freshLimit = Math.max(1, Math.min(12, Math.round(maxFreshBars * 0.5)));
  const earlyLimit = Math.max(freshLimit + 1, maxFreshBars);
  const extendedLimit = Math.max(earlyLimit + 2, Math.round(maxFreshBars * 1.67));

  let freshnessState;
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

  const rrNorm = Math.min(100, Math.max(0, (avgPeakRr / 3.0) * 100));
  const profitNorm = Math.min(100, Math.max(0, (avgProfitPct / 5.0) * 100));
  let profitScore = crossCount > 0
    ? (winRate * 0.45 + rrNorm * 0.35 + profitNorm * 0.20)
    : 50;

  if (crossCount > 0 && avgProfitPct < 0) {
    profitScore *= 0.45;
  }

  let suitabilityScore;
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

/**
 * Extracts normalized HTF EMA cross telemetry from either a catalog item or scanner opportunity.
 */
export function extractHtfEmaCross(item) {
  if (!item || typeof item !== 'object') return null;
  const raw = item.htf_ema_cross || item.htf_ema_cross_perf;
  if (!raw || typeof raw !== 'object') return null;
  const suitability = Number(raw.suitability_score);
  const freshness = Number(raw.freshness_score);
  const winRate = Number(raw.win_rate);
  if (!Number.isFinite(suitability) && !Number.isFinite(freshness) && !Number.isFinite(winRate)) {
    return null;
  }
  const fallbackSuitability = Number.isFinite(suitability)
    ? suitability
    : (Number.isFinite(freshness) ? freshness : Math.min(75, (winRate || 0) * 0.6 + Math.max(0, Number(raw.avg_peak_rr || 0)) * 10));

  return {
    interval: raw.interval || '4h',
    last_cross_direction: raw.last_cross_direction,
    bars_since_cross: Number.isFinite(Number(raw.bars_since_cross)) ? Number(raw.bars_since_cross) : undefined,
    ema_spread_pct: Number.isFinite(Number(raw.ema_spread_pct)) ? Number(raw.ema_spread_pct) : undefined,
    move_since_cross_pct: Number.isFinite(Number(raw.move_since_cross_pct)) ? Number(raw.move_since_cross_pct) : undefined,
    avg_profit_pct: Number.isFinite(Number(raw.avg_profit_pct)) ? Number(raw.avg_profit_pct) : 0,
    avg_peak_rr: Number.isFinite(Number(raw.avg_peak_rr)) ? Number(raw.avg_peak_rr) : 0,
    win_rate: Number.isFinite(winRate) ? winRate : 0,
    cross_count: Number.isFinite(Number(raw.cross_count)) ? Number(raw.cross_count) : 0,
    is_converging: Boolean(raw.is_converging),
    freshness_state: raw.freshness_state || 'early',
    freshness_score: Number.isFinite(freshness) ? freshness : fallbackSuitability,
    suitability_score: fallbackSuitability,
  };
}

/**
 * Deterministic comparator placing fresh + profitable HTF EMA cross pairs first,
 * pushing stale/extended pairs down, and falling back to liquidity/score for un-warmed pairs.
 */
export function compareByHtfEmaCross(a, b) {
  const ha = extractHtfEmaCross(a);
  const hb = extractHtfEmaCross(b);

  if (ha && !hb) return -1;
  if (!ha && hb) return 1;

  if (ha && hb) {
    if (hb.suitability_score !== ha.suitability_score) {
      return hb.suitability_score - ha.suitability_score;
    }
    if (hb.freshness_score !== ha.freshness_score) {
      return hb.freshness_score - ha.freshness_score;
    }
    if (hb.win_rate !== ha.win_rate) {
      return hb.win_rate - ha.win_rate;
    }
  }

  const volDiff = Number(b?.volume_24h ?? b?.vol ?? 0) - Number(a?.volume_24h ?? a?.vol ?? 0);
  if (volDiff !== 0) return volDiff;

  const scoreDiff = Number(b?.score ?? 0) - Number(a?.score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;

  return String(a?.symbol || '').localeCompare(String(b?.symbol || ''));
}

/**
 * Selects the best rotation candidate for Watchlist Scheduler according to rotateMode:
 * - 'htf_ema_cross' (default): prefers fresh/approaching/early & profitable HTF EMA crosses; avoids stale/extended ones.
 * - 'score': classic composite scanner score / momentum fallback.
 */
export function pickBestRotationCandidate(candidates, options = {}) {
  const {
    rotateMode = 'score',
    preferFresh = true,
    currentSymbols = new Set(),
    activeSymbols = new Set(),
    minScore = 70,
  } = options;

  const eligible = (Array.isArray(candidates) ? candidates : []).filter((o) => {
    if (!o?.symbol) return false;
    if (currentSymbols.has(o.symbol) || activeSymbols.has(o.symbol)) return false;
    const htf = extractHtfEmaCross(o);
    const hasFreshHtfSetup = Boolean(
      htf &&
      (!preferFresh || htf.freshness_state === 'fresh' || htf.freshness_state === 'approaching' || htf.freshness_state === 'early') &&
      htf.suitability_score >= 55
    );
    const meetsBaseScore =
      (o.score !== undefined && Number(o.score) >= minScore) ||
      Boolean(o.signalResult?.allFired) ||
      Math.abs(Number(o.pct ?? o.momentum ?? 0)) >= 1.5 ||
      Number(o.volume_24h ?? o.vol ?? 0) > 0;
    return rotateMode === 'htf_ema_cross' ? (hasFreshHtfSetup || meetsBaseScore) : meetsBaseScore;
  });

  if (eligible.length === 0) return null;

  if (rotateMode !== 'htf_ema_cross') {
    const sorted = [...eligible].sort((a, b) => {
      const scoreDiff = Number(b?.score ?? 0) - Number(a?.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(b?.volume_24h ?? b?.vol ?? 0) - Number(a?.volume_24h ?? a?.vol ?? 0);
    });
    return sorted[0];
  }

  // When preferFresh is active, prefer non-stale candidates first when any exist
  const nonStale = preferFresh
    ? eligible.filter((o) => {
        const htf = extractHtfEmaCross(o);
        return !htf || htf.freshness_state !== 'stale';
      })
    : eligible;
  const pool = nonStale.length > 0 ? nonStale : eligible;
  const sorted = [...pool].sort(compareByHtfEmaCross);
  return sorted[0];
}

/**
 * Formats compact, unboxed UI readout for Static Catalog items.
 */
export function formatHtfCrossCompact(raw) {
  const htf = raw?.freshness_state ? raw : extractHtfEmaCross({ htf_ema_cross: raw });
  if (!htf) return null;

  const tf = String(htf.interval || '4h');
  const bars = Number.isFinite(htf.bars_since_cross) ? `${htf.bars_since_cross}b` : '';
  const dirLabel = htf.last_cross_direction === 'SHORT' ? 'S' : 'L';
  const wr = htf.cross_count > 0 ? `${Math.round(htf.win_rate)}%` : '';

  switch (htf.freshness_state) {
    case 'fresh':
      return {
        label: `${tf} Fresh ${dirLabel}${bars ? ` · ${bars}` : ''}${wr ? ` · ${wr}` : ''}`,
        tone: 'fresh',
        suitability: htf.suitability_score,
      };
    case 'approaching':
      return {
        label: `${tf} Near ${htf.ema_spread_pct >= 0 ? '+' : ''}${Number(htf.ema_spread_pct ?? 0).toFixed(2)}%${wr ? ` · ${wr}` : ''}`,
        tone: 'approaching',
        suitability: htf.suitability_score,
      };
    case 'early':
      return {
        label: `${tf} Early ${dirLabel}${bars ? ` · ${bars}` : ''}${wr ? ` · ${wr}` : ''}`,
        tone: 'early',
        suitability: htf.suitability_score,
      };
    case 'extended':
      return {
        label: `${tf} Ext${bars ? ` · ${bars}` : ''}`,
        tone: 'extended',
        suitability: htf.suitability_score,
      };
    default:
      return {
        label: `${tf} Stale${bars ? ` · ${bars}` : ''}`,
        tone: 'stale',
        suitability: htf.suitability_score,
      };
  }
}
