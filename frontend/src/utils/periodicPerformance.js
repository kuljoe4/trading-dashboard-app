export const PERIODIC_TIMEFRAME_LIMITS = Object.freeze({
  '7D': 250,
  '14D': 500,
  '4W': 1000,
  '6M': 3000,
  '1Y': 5000,
});

export function getPeriodicFetchLimit(timeframe) {
  return PERIODIC_TIMEFRAME_LIMITS[timeframe] || 250;
}

export function resolveAdaptivePeriodicLimit(timeframe, closedCounts) {
  if (closedCounts && typeof closedCounts === 'object') {
    const rawBucket = closedCounts[timeframe];
    const hasBucket = rawBucket !== undefined && rawBucket !== null && Number.isFinite(Number(rawBucket));
    const bucketCount = hasBucket
      ? Number(rawBucket)
      : (closedCounts.total !== undefined && closedCounts.total !== null && Number.isFinite(Number(closedCounts.total))
          ? Number(closedCounts.total)
          : null);

    if (bucketCount !== null) {
      const has30d = closedCounts['30D'] !== undefined && closedCounts['30D'] !== null && Number.isFinite(Number(closedCounts['30D']));
      const badge30d = has30d ? Number(closedCounts['30D']) : 0;
      const actualCount = Math.max(0, bucketCount, badge30d);
      return {
        limit: Math.min(Math.max(actualCount, 1), 50000),
        actualCount,
        isKnown: true,
      };
    }
  }

  return {
    limit: getPeriodicFetchLimit(timeframe),
    actualCount: null,
    isKnown: false,
  };
}

export function resolveAdaptiveHistoryTradeLimit(tradeLimitPref = 'AUTO', timeRange = 'ALL', closedCounts = null) {
  const countsValid = closedCounts && typeof closedCounts === 'object';
  const totalKnown = countsValid && Number.isFinite(Number(closedCounts.total))
    ? Math.max(0, Number(closedCounts.total))
    : null;

  const pickRangeCount = () => {
    if (!countsValid) return null;
    if (timeRange === '24H' || timeRange === '7D') {
      const c = Number(closedCounts['7D']);
      return Number.isFinite(c) ? Math.max(0, c) : totalKnown;
    }
    if (timeRange === '30D') {
      const c = Number(closedCounts['30D']);
      return Number.isFinite(c) ? Math.max(0, c) : totalKnown;
    }
    return totalKnown;
  };

  const rangeCount = pickRangeCount();

  if (tradeLimitPref === 'AUTO') {
    if (rangeCount !== null) {
      return {
        limit: Math.min(Math.max(rangeCount, 1), 50000),
        actualCount: rangeCount,
        totalCount: totalKnown,
        isKnown: true,
        isAdaptive: true,
      };
    }
    const fallback = timeRange === '24H' || timeRange === '7D' ? 250 : timeRange === '30D' ? 1000 : 1000;
    return {
      limit: fallback,
      actualCount: null,
      totalCount: totalKnown,
      isKnown: false,
      isAdaptive: true,
    };
  }

  if (tradeLimitPref === 'ALL') {
    const resolved = totalKnown !== null ? Math.min(Math.max(totalKnown, 1), 50000) : 50000;
    return {
      limit: resolved,
      actualCount: rangeCount ?? totalKnown,
      totalCount: totalKnown,
      isKnown: totalKnown !== null,
      isAdaptive: false,
    };
  }

  const numericPref = Math.min(Math.max(Number(tradeLimitPref) || 250, 1), 50000);
  const capped = totalKnown !== null ? Math.min(Math.max(totalKnown, 1), numericPref) : numericPref;
  return {
    limit: capped,
    actualCount: rangeCount,
    totalCount: totalKnown,
    isKnown: totalKnown !== null,
    isAdaptive: false,
  };
}

export function resolveAdaptiveSessionLimit(sessionLimitPref = 'AUTO', sessionCounts = null, activeMode = 'paper', visibleCount = 10) {
  const countsValid = sessionCounts && typeof sessionCounts === 'object';
  const totalKnown = countsValid && Number.isFinite(Number(sessionCounts.total))
    ? Math.max(0, Number(sessionCounts.total))
    : null;
  const modeKnown = countsValid && Number.isFinite(Number(sessionCounts[activeMode]))
    ? Math.max(0, Number(sessionCounts[activeMode]))
    : totalKnown;

  if (sessionLimitPref === 'AUTO') {
    if (totalKnown !== null) {
      // Ensure sessions in non-dominant modes aren't buried behind newer sessions of other modes,
      // while avoiding excessive over-fetch on multi-hundred-session databases.
      const target = totalKnown <= 200
        ? totalKnown
        : Math.min(totalKnown, Math.max(visibleCount * 3, 40));
      return {
        limit: Math.min(Math.max(target, 1), 500),
        modeCount: modeKnown,
        totalCount: totalKnown,
        isKnown: true,
        isAdaptive: true,
      };
    }
    return {
      limit: Math.min(Math.max(visibleCount * 3, 20), 500),
      modeCount: null,
      totalCount: null,
      isKnown: false,
      isAdaptive: true,
    };
  }

  if (sessionLimitPref === 'ALL') {
    const resolved = totalKnown !== null ? Math.min(Math.max(totalKnown, 1), 500) : 500;
    return {
      limit: resolved,
      modeCount: modeKnown,
      totalCount: totalKnown,
      isKnown: totalKnown !== null,
      isAdaptive: false,
    };
  }

  const numericPref = Math.min(Math.max(Number(sessionLimitPref) || 20, 1), 500);
  const resolved = totalKnown !== null ? Math.min(Math.max(totalKnown, 1), numericPref) : numericPref;
  return {
    limit: resolved,
    modeCount: modeKnown,
    totalCount: totalKnown,
    isKnown: totalKnown !== null,
    isAdaptive: false,
  };
}

export function resolveExplicitTradeMode(trade) {
  if (!trade || typeof trade !== 'object') return null;
  if (trade.trading_mode) return String(trade.trading_mode).toLowerCase();
  if (trade.tradingMode) return String(trade.tradingMode).toLowerCase();
  if (typeof trade.paper_mode === 'boolean') return trade.paper_mode ? 'paper' : 'live';
  if (typeof trade.paperMode === 'boolean') return trade.paperMode ? 'paper' : 'live';
  return null;
}

export function isClosedValidTrade(trade, activeMode = null) {
  if (!trade || typeof trade !== 'object') return false;
  if (trade.status === 'OPEN' || trade.status === 'ENTRY_FAILED') return false;
  if (trade.is_reconciliation === true) return false;
  if (activeMode) {
    const tradeMode = resolveExplicitTradeMode(trade);
    if (tradeMode && tradeMode !== String(activeMode).toLowerCase()) {
      return false;
    }
  }
  return true;
}

export function getTradeExitMs(trade) {
  if (!trade) return 0;
  if (typeof trade.exit_ts_ms === 'number' && Number.isFinite(trade.exit_ts_ms) && trade.exit_ts_ms > 0) {
    return trade.exit_ts_ms;
  }
  if (trade.exit_ts) {
    const parsed = new Date(trade.exit_ts).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function computePeriodicBuckets({ trades = [], timeframe = '7D', nowTs = Date.now() } = {}) {
  const now = new Date(nowTs);
  const buckets = [];

  if (timeframe === '7D' || timeframe === '14D') {
    const numDays = timeframe === '7D' ? 7 : 14;
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      buckets.push({
        id: dateKey,
        label,
        subLabel: d.toLocaleDateString([], { weekday: 'short' }),
        startMs: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
        endMs: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1,
        pnl: 0,
        tradesCount: 0,
        winCount: 0,
      });
    }
  } else if (timeframe === '4W' || timeframe === '8W') {
    const numWeeks = timeframe === '4W' ? 4 : 8;
    for (let i = numWeeks - 1; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(now.getDate() - (now.getDay() + i * 7));
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);

      const label = `W${numWeeks - i}`;
      const subLabel = `${start.getDate()} ${start.toLocaleDateString([], { month: 'short' })}`;

      buckets.push({
        id: `week-${i}`,
        label,
        subLabel,
        startMs: start.getTime(),
        endMs: end.getTime(),
        pnl: 0,
        tradesCount: 0,
        winCount: 0,
      });
    }
  } else {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const numMonths = timeframe === '3M' ? 3 : timeframe === '1Y' ? 12 : 6;

    for (let i = numMonths - 1; i >= 0; i--) {
      const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const last = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
      buckets.push({
        id: `month-${first.getFullYear()}-${first.getMonth()}`,
        label: monthNames[first.getMonth()],
        subLabel: String(first.getFullYear()),
        startMs: first.getTime(),
        endMs: last.getTime(),
        pnl: 0,
        tradesCount: 0,
        winCount: 0,
      });
    }
  }

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (!t) continue;
    const ts = getTradeExitMs(t);
    if (!ts) continue;

    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b];
      if (ts >= bucket.startMs && ts <= bucket.endMs) {
        const pnl = Number(t.pnl || 0);
        if (!Number.isFinite(pnl)) break;
        bucket.pnl += pnl;
        bucket.tradesCount++;
        if (pnl > 0) bucket.winCount++;
        break;
      }
    }
  }

  let maxVal = 0;
  for (let i = 0; i < buckets.length; i++) {
    const absVal = Math.abs(buckets[i].pnl);
    if (absVal > maxVal) maxVal = absVal;
  }
  if (maxVal === 0) maxVal = 500;

  return { buckets, maxVal };
}

export function computePeriodBadges({ trades = [], nowTs = Date.now() } = {}) {
  const now = new Date(nowTs);
  // Align TODAY, 7D, and 30D to local midnight boundaries so 7D badge matches 7D chart Net total
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;
  const sevenDaysStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const thirtyDaysStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();

  let today = 0;
  let d7 = 0;
  let d30 = 0;

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (!t) continue;
    const ts = getTradeExitMs(t);
    if (!ts || ts > todayEnd) continue;

    const pnl = Number(t.pnl || 0);
    if (!Number.isFinite(pnl)) continue;
    if (ts >= todayStart) today += pnl;
    if (ts >= sevenDaysStart) d7 += pnl;
    if (ts >= thirtyDaysStart) d30 += pnl;
  }

  return { today, d7, d30 };
}
