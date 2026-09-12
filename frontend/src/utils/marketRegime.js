/**
 * Global Market Regime, 24h Range & Breadth Analytics Utility
 *
 * Evaluates market-wide speed, volatility, global market breadth (advance/decline ratio),
 * and BTC benchmark 24h market range position across scanner candidates.
 * Provides zero-allocation memoized metrics, WCAG-compliant styling badges, and
 * contextual guidance messages for slow vs active market conditions.
 */

export const getMarketRegimeInfo = (scannerResults = [], config = {}, extraState = {}) => {
  // FAST-FAIL: If UI Eco-Mode is active or explicit uiEcoMode flag passed, immediately return lightweight static regime
  if (extraState?.uiEcoMode || (typeof localStorage !== 'undefined' && localStorage.getItem('ui_eco_mode') === 'true')) {
    const threshold = Math.max(0.01, Number(config?.scan_pct_threshold ?? 2.0));
    return {
      avgMomentum: 0,
      avgVolScore: 0,
      avgScore: 0,
      maxAbsMomentum: 0,
      passingCount: 0,
      totalCount: Array.isArray(scannerResults) ? scannerResults.length : 0,
      threshold,
      scanInterval: String(config?.scan_interval || '1m'),
      advancingCount: 0,
      decliningCount: 0,
      advanceRatioPct: 50,
      breadthLabel: 'Eco Mode',
      breadthIcon: 'Zap',
      benchmarkSymbol: 'BTC',
      btcPrice: 0,
      btc24hHigh: 0,
      btc24hLow: 0,
      btcRangePct: 50,
      valid24hRange: false,
      maxPct: 0,
      minPct: 0,
      scanMaxPct: 0,
      scanMinPct: 0,
      regime: 'eco',
      label: 'Eco Mode Active',
      subLabel: 'CPU/RAM Optimization Mode',
      badgeClass: 'bg-amber/10 text-amber border-amber/20',
      pillClass: 'bg-amber/20 text-amber border-amber/30',
      meterClass: 'bg-amber',
      iconName: 'Zap',
      speedPct: 50,
      guidance: 'UI Eco-Graphics Mode is active. Heavy market calculations are bypassed to save browser CPU and laptop battery.',
    };
  }

  const threshold = Math.max(0.01, Number(config?.scan_pct_threshold ?? 2.0));
  const scanInterval = String(config?.scan_interval || '1m');
  const resultsArr = Array.isArray(scannerResults) ? scannerResults : [];
  const totalCount = resultsArr.length;

  let sumAbsMomentum = 0;
  let sumVolScore = 0;
  let sumScore = 0;
  let maxAbsMomentum = 0;
  let maxPct = totalCount > 0 ? -Infinity : 0;
  let minPct = totalCount > 0 ? Infinity : 0;
  let passingCount = 0;
  let advancingCount = 0;
  let decliningCount = 0;

  let btcOpp = null;
  let globalHigh24h = 0;
  let globalLow24h = Infinity;
  let globalMinPct = Infinity;
  let globalMaxPct = -Infinity;

  let btc24hHigh = 0;
  let btc24hLow = 0;

  // Single-pass O(N) iteration over scanner candidates & global market tickers
  for (let i = 0; i < totalCount; i++) {
    const opp = resultsArr[i];
    if (!opp) continue;

    // Use 24h percentage change from ticker if available (representing full global 24h change) or fallback to momentum %
    const raw24hPct = Number(opp.price_change_percent_24h ?? opp.percent_change_24h ?? opp.momentum ?? opp.pct ?? 0);
    if (raw24hPct > globalMaxPct) globalMaxPct = raw24hPct;
    if (raw24hPct < globalMinPct) globalMinPct = raw24hPct;

    const mom = Number(opp.momentum ?? opp.pct ?? 0);
    if (mom > maxPct) maxPct = mom;
    if (mom < minPct) minPct = mom;

    const absMom = Math.abs(mom);
    sumAbsMomentum += absMom;
    if (absMom > maxAbsMomentum) maxAbsMomentum = absMom;

    if (mom > 0) advancingCount++;
    else if (mom < 0) decliningCount++;

    if (opp.score_breakdown && typeof opp.score_breakdown.volatility === 'number') {
      sumVolScore += opp.score_breakdown.volatility;
    } else {
      sumVolScore += Math.min(100, absMom * 25);
    }

    sumScore += Number(opp.score ?? 0);

    if (absMom >= threshold) {
      passingCount++;
    }

    // BOLT OPTIMIZATION: Zero-allocation single-pass calculation of candidate high and low bounds.
    // Avoids transient .map() array allocations and Math.max(...)/Math.min(...) array spreads on every tick frame.
    let oppHigh = 0;
    let oppLow = Infinity;

    if (opp.high_24h != null) {
      oppHigh = Number(opp.high_24h);
    } else if (opp.price_high_24h != null) {
      oppHigh = Number(opp.price_high_24h);
    }

    if (opp.low_24h != null) {
      oppLow = Number(opp.low_24h);
    } else if (opp.price_low_24h != null) {
      oppLow = Number(opp.price_low_24h);
    }

    if ((oppHigh === 0 || oppLow === Infinity) && opp.ohlc_history && opp.ohlc_history.length > 0) {
      let maxH = 0;
      let minL = Infinity;
      for (let j = 0; j < opp.ohlc_history.length; j++) {
        const candle = opp.ohlc_history[j];
        if (candle) {
          const h = candle.high || 0;
          const l = candle.low || Infinity;
          if (h > maxH) maxH = h;
          if (l < minL) minL = l;
        }
      }
      if (oppHigh === 0) oppHigh = maxH;
      if (oppLow === Infinity) oppLow = minL;
    }

    if (oppHigh > globalHigh24h) globalHigh24h = oppHigh;
    if (oppLow > 0 && oppLow < globalLow24h && oppLow !== Infinity) globalLow24h = oppLow;

    // Benchmark BTC lookup
    if (opp.symbol === 'BTCUSDT' || opp.symbol === 'BTC') {
      btcOpp = opp;
      btc24hHigh = oppHigh;
      btc24hLow = oppLow;
    }
  }

  if (maxPct === -Infinity) maxPct = 0;
  if (minPct === Infinity) minPct = 0;

  // Global market 24h min/max percentage extremes
  const global24hMinPct = globalMinPct !== Infinity ? globalMinPct : minPct;
  const global24hMaxPct = globalMaxPct !== -Infinity ? globalMaxPct : maxPct;

  const avgMomentum = totalCount > 0 ? sumAbsMomentum / totalCount : 0;
  const avgVolScore = totalCount > 0 ? sumVolScore / totalCount : 0;
  const avgScore = totalCount > 0 ? sumScore / totalCount : 0;

  // Global Market Breadth Ratio
  const advanceRatioPct = totalCount > 0 ? Math.round((advancingCount / totalCount) * 100) : 50;
  let breadthLabel = 'Mixed Breadth';
  let breadthIcon = 'Balance';
  if (advanceRatioPct >= 65) {
    breadthLabel = 'Bullish Expansion';
    breadthIcon = 'TrendingUp';
  } else if (advanceRatioPct <= 35) {
    breadthLabel = 'Bearish Pressure';
    breadthIcon = 'TrendingDown';
  }

  // BTC / Global Benchmark 24h Range Calculations
  let benchmarkSymbol = 'BTC';
  let btcPrice = Number(btcOpp?.price ?? btcOpp?.close ?? 0);

  if (!btc24hHigh || !btc24hLow || btc24hHigh <= btc24hLow) {
    benchmarkSymbol = 'Scanned Universe';
    btc24hHigh = globalHigh24h;
    btc24hLow = globalLow24h !== Infinity ? globalLow24h : 0;
  }

  const valid24hRange = btc24hHigh > 0 && btc24hLow > 0 && btc24hHigh > btc24hLow;
  const btcRangePct = valid24hRange && btcPrice > 0
    ? Math.min(100, Math.max(0, Math.round(((btcPrice - btc24hLow) / (btc24hHigh - btc24hLow)) * 100)))
    : 50;

  const baseMetrics = {
    avgMomentum,
    avgVolScore,
    avgScore,
    maxAbsMomentum,
    passingCount,
    totalCount,
    threshold,
    scanInterval,
    advancingCount,
    decliningCount,
    advanceRatioPct,
    breadthLabel,
    breadthIcon,
    benchmarkSymbol,
    btcPrice,
    btc24hHigh,
    btc24hLow,
    btcRangePct,
    valid24hRange,
    maxPct: global24hMaxPct,
    minPct: global24hMinPct,
    scanMaxPct: maxPct,
    scanMinPct: minPct,
  };

  // Check state overrides
  if (extraState?.scannerPaused) {
    return {
      ...baseMetrics,
      regime: 'paused',
      label: 'Scanner Paused',
      subLabel: 'Market evaluation temporarily suspended',
      badgeClass: 'bg-red/10 text-red border-red/20',
      pillClass: 'bg-red/20 text-red border-red/30',
      iconName: 'PauseCircle',
      speedPct: 0,
      guidance: 'The market scanner is currently paused. Resume scanning in strategy controls to evaluate opportunities.',
    };
  }

  if (extraState?.hibernating) {
    return {
      ...baseMetrics,
      regime: 'hibernating',
      label: 'Engine Hibernating',
      subLabel: 'Resource saving mode active',
      badgeClass: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
      pillClass: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
      iconName: 'Moon',
      speedPct: 0,
      guidance: 'Engine is in hibernation mode to conserve resources during idle periods.',
    };
  }

  // Evaluate market regime thresholds
  const isQuiet = totalCount === 0 || (passingCount === 0 && avgMomentum < 1.2 && avgScore < 45 && maxAbsMomentum < threshold);
  const isActive = passingCount >= 2 || avgMomentum >= 2.0 || avgScore >= 65 || maxAbsMomentum >= (threshold * 1.5);

  if (isQuiet) {
    const rawSpeed = Math.min(30, Math.round((avgMomentum / threshold) * 25));
    return {
      ...baseMetrics,
      regime: 'slow',
      label: 'Slow / Quiet Market',
      subLabel: 'Low Volatility • Rangebound Consolidation',
      badgeClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
      pillClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
      meterClass: 'bg-cyan-400',
      iconName: 'Turtle',
      speedPct: Math.max(10, rawSpeed),
      guidance: `Low market velocity detected (Avg momentum ${avgMomentum.toFixed(2)}% • Breadth: ${breadthLabel}). Price action is consolidating below the ${threshold.toFixed(1)}% scan threshold. The scanner is actively monitoring ${scanInterval} klines and will trigger signals upon range expansion.`,
    };
  }

  if (isActive) {
    const rawSpeed = Math.min(100, Math.max(70, Math.round((avgMomentum / threshold) * 55)));
    return {
      ...baseMetrics,
      regime: 'active',
      label: 'Fast / High Volatility',
      subLabel: 'Strong Momentum • Expansion Phase',
      badgeClass: 'bg-accent/10 text-accent border-accent/20',
      pillClass: 'bg-accent/20 text-accent border-accent/30',
      meterClass: 'bg-accent',
      iconName: 'Flame',
      speedPct: rawSpeed,
      guidance: `High market velocity detected (${passingCount}/${totalCount} candidates > ${threshold.toFixed(1)}% threshold • Breadth: ${advanceRatioPct}% Advancing). Price range is expanding rapidly with active strategy entry evaluation.`,
    };
  }

  // Moderate / Neutral
  const rawSpeed = Math.min(69, Math.max(35, Math.round((avgMomentum / threshold) * 40)));
  return {
    ...baseMetrics,
    regime: 'moderate',
    label: 'Moderate Pace',
    subLabel: 'Steady Volatility • Selective Opportunities',
    badgeClass: 'bg-amber/10 text-amber border-amber/20',
    pillClass: 'bg-amber/20 text-amber border-amber/30',
    meterClass: 'bg-amber',
    iconName: 'Zap',
    speedPct: rawSpeed,
    guidance: `Market velocity is steady (Avg momentum ${avgMomentum.toFixed(2)}% • Breadth: ${advanceRatioPct}% Advancing). Opportunities are evaluated selectively as candidates approach the ${threshold.toFixed(1)}% scan threshold.`,
  };
};
