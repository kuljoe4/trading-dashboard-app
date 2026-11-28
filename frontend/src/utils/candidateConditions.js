import { price as fmtPrice, calculateProximity, formatDuration } from '../lib/formatters.js';
import { formatSignalLabel, getSignalParamsSummary, resolveSignalParamClient, getBaseSignalType } from './strategyDiagnostics.js';
import {
  timeframeToMs,
  resolveAntiWhipsawTimeframes,
  evaluateAntiWhipsawStatus,
  evaluateStrategyAntiWhipsawLocks,
  resolveTradingMode,
  formatTradingModeLabel,
  evaluateCounterpartModeAntiWhipsaw,
} from './antiWhipsaw.js';

export {
  timeframeToMs,
  resolveAntiWhipsawTimeframes,
  evaluateAntiWhipsawStatus,
  evaluateStrategyAntiWhipsawLocks,
  resolveTradingMode,
  formatTradingModeLabel,
  evaluateCounterpartModeAntiWhipsaw,
};

function formatCompactValue(val, unit, thresholdIsPrice) {
  if (val === undefined || val === null || Number.isNaN(Number(val))) return '---';
  const num = Number(val);
  if (thresholdIsPrice) return fmtPrice(num);
  const decimals = Math.abs(num) >= 100 ? 2 : Math.abs(num) >= 1 ? 3 : 4;
  return `${num.toFixed(decimals)}${unit || ''}`;
}

function formatSignedDeltaValue(delta, unit, thresholdIsPrice) {
  if (!Number.isFinite(delta)) return '';
  const sign = delta >= 0 ? '+' : '-';
  const abs = Math.abs(delta);
  if (thresholdIsPrice) {
    return `${sign}${fmtPrice(abs)}`;
  }
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `${sign}${abs.toFixed(decimals)}${unit || ''}`;
}

function formatSignedPct(pct) {
  if (!Number.isFinite(pct)) return '';
  const sign = pct >= 0 ? '+' : '-';
  const abs = Math.abs(pct);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${sign}${abs.toFixed(decimals)}%`;
}

function formatScaleBound(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '1';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(1)));
}

function formatAbsPct(pct) {
  const abs = Math.abs(Number(pct) || 0);
  if (abs >= 100) return abs.toFixed(0);
  if (abs >= 10) return abs.toFixed(1);
  return abs.toFixed(2);
}

/**
 * Selects a clean, human-readable symmetric percentage bound S for linear bipolar price/EMA gauges [-S%, +S%].
 */
export function pickNicePercentBound(absPct, referenceSpanPct = 1.0) {
  const NICE_BOUNDS = [0.5, 1, 2, 3, 5, 10, 15, 25, 50];
  const refSpan = Number.isFinite(Number(referenceSpanPct)) && Number(referenceSpanPct) > 0
    ? Math.min(Math.max(Number(referenceSpanPct), 0.5), 10)
    : 1.0;
  const needed = Math.max(Math.abs(Number(absPct) || 0) * 1.15, refSpan);
  for (let i = 0; i < NICE_BOUNDS.length; i++) {
    if (NICE_BOUNDS[i] >= needed) return NICE_BOUNDS[i];
  }
  return NICE_BOUNDS[NICE_BOUNDS.length - 1];
}

/**
 * Selects a clean linear upper bound for ratio/past-target gauges [0%, maxPct] so overshoots > +50%
 * remain proportional on the arc instead of pegging at the right stop.
 */
export function pickNiceRatioMax(rawDialPct) {
  const NICE_MAXES = [150, 200, 300, 500, 1000];
  const val = Math.max(0, Number(rawDialPct) || 0);
  if (val <= 145) return 150;
  const needed = val * 1.12;
  for (let i = 0; i < NICE_MAXES.length; i++) {
    if (NICE_MAXES[i] >= needed) return NICE_MAXES[i];
  }
  return NICE_MAXES[NICE_MAXES.length - 1];
}

/**
 * Generates proportionate R-multiple tick marks across a runway [minR, maxR].
 */
export function buildRunwayRTicks(minR, maxR, toPctFn) {
  const span = Math.max(0.5, maxR - minR);
  const step = span <= 3 ? 0.5 : span <= 7 ? 1 : span <= 15 ? 2 : 5;
  const start = Math.ceil(minR / step) * step;
  const ticks = [];
  const seen = new Set();

  const pushTick = (rVal, isAnchor = false) => {
    const rounded = Math.round(rVal * 100) / 100;
    if (rounded < minR - 1e-6 || rounded > maxR + 1e-6) return;
    if (seen.has(rounded)) return;
    seen.add(rounded);
    const label = rounded === 0 ? '0R' : `${rounded > 0 ? '+' : ''}${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}R`;
    ticks.push({
      r: rounded,
      pct: toPctFn(rounded),
      label,
      isAnchor,
    });
  };

  pushTick(-1, true);
  pushTick(0, true);
  for (let r = start; r <= maxR + 1e-6; r += step) {
    pushTick(r, r === 0 || r === -1);
  }
  return ticks.sort((a, b) => a.r - b.r);
}

function asText(val, fallback = '') {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object' && typeof val.paramsText === 'string') return val.paramsText;
  return fallback;
}

export function isCrossoverEventSignal(signalKey = '', signalDetail = null) {
  const baseType = getBaseSignalType(signalKey);
  if (baseType === 'ema_dual_cross' || baseType === 'ema_cross' || baseType === 'ema_price_cross') {
    return true;
  }
  const metric = String(signalDetail?.metric || signalDetail?.label || '').toLowerCase();
  if (metric.includes('dual cross') || metric.includes('ema crossover')) {
    return true;
  }
  return false;
}

/**
 * Maps a 0..150 dial percentage to its semantic zone and label:
 * - <80:     Watching
 * - 80..99:  Near
 * - 100..105: Fresh (0-5% past target)
 * - 105..115: Stale (5-15% past target)
 * - >115:    Late (>15% past target)
 * Preserves unclamped rawDialPct so overshoots > +50% display true % + "off-scale".
 */
export function resolveDialZone(dialPct, { insufficientData = false, rejected = false, rawDialPct = null } = {}) {
  if (insufficientData) {
    return { dialZone: 'warming', dialStatus: 'Warming', dialOverText: 'Warming', isOffScale: false };
  }
  const p = Math.max(0, Math.min(150, Math.round(Number(dialPct) || 0)));
  const raw = rawDialPct !== null && rawDialPct !== undefined && Number.isFinite(Number(rawDialPct))
    ? Math.round(Number(rawDialPct))
    : p;
  const trueOverPct = Math.max(0, raw - 100);
  const isOffScale = raw > 150;

  if (rejected) {
    const overSuffix = trueOverPct > 0 ? `+${trueOverPct}% past · rejected` : 'Blocked';
    return { dialZone: 'blocked', dialStatus: 'Rejected', dialOverText: overSuffix, isOffScale };
  }

  const dialOverText = p >= 100
    ? (isOffScale ? `+${trueOverPct}% past · off-scale` : `+${trueOverPct}% past`)
    : `${Math.round(100 - p)}% to go`;

  if (p < 80) return { dialZone: 'watching', dialStatus: 'Watching', dialOverText, isOffScale: false };
  if (p < 100) return { dialZone: 'near', dialStatus: 'Near', dialOverText, isOffScale: false };
  if (p <= 105) return { dialZone: 'fresh', dialStatus: 'Fresh', dialOverText, isOffScale };
  if (p <= 115) return { dialZone: 'stale', dialStatus: 'Stale', dialOverText, isOffScale };
  return { dialZone: 'late', dialStatus: 'Late', dialOverText, isOffScale };
}

/**
 * Single source of truth for pre-trade / candidate Stop-Loss check & cap telemetry.
 * Computes live SL distance (% of price), compares against sl_min_pct / sl_max_pct,
 * and resolves percentage of SL check used (slCapUsedPct = slDistPct / slMaxPct * 100)
 * alongside clamp vs reject enforcement.
 */
export function evaluateSlCheck({
  opp = null,
  strategyConfig = {},
  livePrice = NaN,
  isLong = true,
  isExit = false,
  signalDetail = null,
  refHigh = NaN,
  refLow = NaN,
  trigTfFallback = null,
} = {}) {
  const cfg = strategyConfig || {};
  const sig = signalDetail || {};
  const wantUpper = isExit ? !isLong : isLong;
  const priceNum = Number(livePrice);
  const hasPrice = Number.isFinite(priceNum) && priceNum > 0;

  const slType = String(cfg.sl_type || (cfg.sl_lookback_period !== undefined ? 'lookback_low/high' : 'pct'));
  const defaultLookback = cfg.signal_params?.htf_breakout_lookback ?? 5;
  const slLookbackPeriod = Math.max(1, Number(cfg.sl_lookback_period ?? defaultLookback) || 5);
  const rawSlTf = cfg.sl_lookback_timeframe;
  const scanTf = String(cfg.scan_interval || '5m');
  const slLookbackTf = (!rawSlTf || rawSlTf === 'default')
    ? String(trigTfFallback || cfg.signal_timeframes?.[slType] || scanTf)
    : String(rawSlTf);

  const hasExplicitSlMax = cfg.sl_max_pct !== undefined && cfg.sl_max_pct !== null && cfg.sl_max_pct !== '' && Number.isFinite(Number(cfg.sl_max_pct)) && Number(cfg.sl_max_pct) > 0;
  const slMaxPct = hasExplicitSlMax ? Number(cfg.sl_max_pct) : 3.0;
  const hasExplicitSlMin = cfg.sl_min_pct !== undefined && cfg.sl_min_pct !== null && cfg.sl_min_pct !== '' && Number.isFinite(Number(cfg.sl_min_pct)) && Number(cfg.sl_min_pct) >= 0;
  const slMinPct = hasExplicitSlMin ? Math.max(0.01, Number(cfg.sl_min_pct)) : 0.3;
  const slOobAction = cfg.sl_out_of_bounds_action
    ? String(cfg.sl_out_of_bounds_action).toLowerCase()
    : (cfg.reject_entry_if_sl_exceeds_max === true ? 'reject' : 'clamp');

  const rawOppSlDistPct = opp?.sl_dist_pct !== undefined && opp?.sl_dist_pct !== null ? Number(opp.sl_dist_pct) : NaN;
  const rawOppUnboundedSlDistPct = opp?.raw_sl_dist_pct !== undefined && opp?.raw_sl_dist_pct !== null ? Number(opp.raw_sl_dist_pct) : NaN;
  const configuredFixedSlPct = Number(cfg.sl_distance_pct ?? 0);
  const explicitOppSlPrice = Number(opp?.sl_price ?? NaN);
  const sigSlPrice = Number(sig?.slPrice ?? NaN);
  const refHighNum = Number(refHigh);
  const refLowNum = Number(refLow);
  const defaultLookbackExtreme = wantUpper
    ? (Number.isFinite(refLowNum) && refLowNum > 0 ? refLowNum : NaN)
    : (Number.isFinite(refHighNum) && refHighNum > 0 ? refHighNum : NaN);

  let slDistPct = 0.8;
  let slPrice = hasPrice ? (wantUpper ? priceNum * 0.992 : priceNum * 1.008) : NaN;
  let slSource = 'default';

  if (Number.isFinite(rawOppSlDistPct) && rawOppSlDistPct > 0) {
    slDistPct = Number.isFinite(rawOppUnboundedSlDistPct) && rawOppUnboundedSlDistPct > 0
      ? rawOppUnboundedSlDistPct
      : rawOppSlDistPct;
    slPrice = Number.isFinite(explicitOppSlPrice) && explicitOppSlPrice > 0
      ? explicitOppSlPrice
      : (hasPrice
          ? (wantUpper ? priceNum * (1 - rawOppSlDistPct / 100) : priceNum * (1 + rawOppSlDistPct / 100))
          : NaN);
    slSource = 'opportunity';
  } else if (slType === 'pct') {
    slDistPct = configuredFixedSlPct > 0 ? configuredFixedSlPct : 0.8;
    slPrice = Number.isFinite(explicitOppSlPrice) && explicitOppSlPrice > 0
      ? explicitOppSlPrice
      : (hasPrice
          ? (wantUpper ? priceNum * (1 - slDistPct / 100) : priceNum * (1 + slDistPct / 100))
          : NaN);
    slSource = 'fixed_pct';
  } else if (Number.isFinite(explicitOppSlPrice) && explicitOppSlPrice > 0 && hasPrice) {
    slPrice = explicitOppSlPrice;
    slDistPct = Math.max(0.05, (Math.abs(priceNum - slPrice) / priceNum) * 100);
    slSource = 'opp_price';
  } else if (Number.isFinite(sigSlPrice) && sigSlPrice > 0 && hasPrice) {
    slPrice = sigSlPrice;
    slDistPct = Math.max(0.05, (Math.abs(priceNum - slPrice) / priceNum) * 100);
    slSource = 'signal_price';
  } else if (Number.isFinite(defaultLookbackExtreme) && defaultLookbackExtreme > 0 && hasPrice) {
    slPrice = defaultLookbackExtreme;
    slDistPct = Math.max(0.05, (Math.abs(priceNum - slPrice) / priceNum) * 100);
    slSource = 'ref_extreme';
  } else {
    slDistPct = configuredFixedSlPct > 0 ? configuredFixedSlPct : 0.8;
    slPrice = hasPrice
      ? (wantUpper ? priceNum * (1 - slDistPct / 100) : priceNum * (1 + slDistPct / 100))
      : NaN;
  }

  slDistPct = Math.max(0.05, Number(slDistPct.toFixed(2)));
  const applyStructuralBounds = slType !== 'pct';
  const hasStructuralData = slSource !== 'default';
  if (applyStructuralBounds && !hasStructuralData) {
    slDistPct = Number(slMaxPct.toFixed(2));
  }
  const slCapUsedPct = slMaxPct > 0 ? Math.max(0, (slDistPct / slMaxPct) * 100) : 0;
  const slCapRoomPct = slMaxPct - slDistPct;
  const slExceedsMax = applyStructuralBounds && hasStructuralData && slDistPct > slMaxPct;
  const slBelowMin = applyStructuralBounds && hasStructuralData && slDistPct < slMinPct;
  const slRejected = (slExceedsMax || slBelowMin) && slOobAction === 'reject';
  const slClamped = slExceedsMax && !slRejected;
  const slWidened = slBelowMin && !slRejected;
  const effectiveSlDistPct = (Number.isFinite(rawOppSlDistPct) && rawOppSlDistPct > 0 && (slClamped || slWidened))
    ? Number(rawOppSlDistPct.toFixed(2))
    : (slExceedsMax && slClamped
        ? slMaxPct
        : (slWidened ? slMinPct : slDistPct));
  const slStatus = slRejected
    ? 'rejected'
    : (slClamped ? 'clamped' : (slWidened ? 'widened' : 'pass'));

  return {
    slType,
    slLookbackPeriod,
    slLookbackTf,
    hasExplicitSlMax,
    slMaxPct,
    slMinPct,
    slOobAction,
    slPrice,
    slDistPct,
    effectiveSlDistPct,
    slCapUsedPct,
    slCapRoomPct,
    slExceedsMax,
    slBelowMin,
    slRejected,
    slClamped,
    slWidened,
    slStatus,
    slSource,
    applyStructuralBounds,
  };
}

/**
 * Builds structured spatial level-ladder telemetry for HTF Breakout (`htf_breakout` / `prev_day_breakout`).
 * `htf_breakout_max_expansion_pct` is expressed as `% of HTF reference candle distance` (ref_high - ref_low)
 * (e.g. 10% of a 6% ref candle range = 0.6% max price expansion above breakout level).
 * Zone cutoffs scale directly from that cap (Fresh 0-25%, Stale 25-60%, Late 60-100%, Rejected >100%).
 */
export function buildHtfLadderModel({
  sigKey = 'htf_breakout',
  signalDetail = {},
  opp = {},
  strategyConfig = {},
  markPrice = 0,
  isLong = true,
  isExit = false,
  nowMs = Date.now(),
}) {
  const baseType = getBaseSignalType(sigKey);
  const sp = strategyConfig.signal_params || {};
  const scanTf = strategyConfig.scan_interval || strategyConfig.kline_interval || '5m';
  const refTf = String(
    signalDetail.ref_timeframe ||
    resolveSignalParamClient(sp, sigKey, baseType, 'htf_breakout_ref_timeframe', strategyConfig.htf_breakout_ref_timeframe || '1d')
  );
  const trigRaw = String(
    signalDetail.trigger_timeframe ||
    resolveSignalParamClient(sp, sigKey, baseType, 'htf_breakout_trigger_timeframe', strategyConfig.htf_breakout_trigger_timeframe || scanTf)
  );
  const trigTf = (!trigRaw || trigRaw === 'default') ? scanTf : trigRaw;
  const mode = String(
    signalDetail.mode ||
    resolveSignalParamClient(sp, sigKey, baseType, 'htf_breakout_mode', strategyConfig.htf_breakout_mode || 'close_break')
  );
  const lookback = Number(
    signalDetail.lookback ??
    resolveSignalParamClient(sp, sigKey, baseType, 'htf_breakout_lookback', strategyConfig.htf_breakout_lookback ?? 1)
  ) || 1;
  const refLevelType = String(
    signalDetail.reference_level ||
    resolveSignalParamClient(sp, sigKey, baseType, 'htf_breakout_reference_level', strategyConfig.htf_breakout_reference_level || 'high_low')
  );
  const bufferPct = Math.max(0, Number(
    signalDetail.buffer_pct ??
    resolveSignalParamClient(sp, sigKey, baseType, 'htf_breakout_buffer_pct', strategyConfig.htf_breakout_buffer_pct ?? 0)
  ) || 0);
  const configuredMaxExpPct = Math.max(0, Number(
    signalDetail.max_expansion_pct ??
    resolveSignalParamClient(sp, sigKey, baseType, 'htf_breakout_max_expansion_pct', strategyConfig.htf_breakout_max_expansion_pct ?? 0)
  ) || 0);

  const livePriceNum = Number(signalDetail.live_price ?? signalDetail.value ?? markPrice ?? 0);
  const closedPriceNum = Number(signalDetail.closed_value ?? signalDetail.value ?? livePriceNum);

  let refHigh = Number(signalDetail.ref_high ?? signalDetail.pattern_high ?? NaN);
  let refLow = Number(signalDetail.ref_low ?? signalDetail.pattern_low ?? NaN);
  const thrNum = Number(signalDetail.breakout_level ?? signalDetail.threshold ?? NaN);

  const ohlc = Array.isArray(opp?.ohlc_history) && opp.ohlc_history.length > 0 ? opp.ohlc_history : [];
  if ((!Number.isFinite(refHigh) || !Number.isFinite(refLow) || refHigh <= 0 || refLow <= 0) && ohlc.length > 0) {
    const completed = ohlc.length > 2 ? ohlc.slice(0, -1) : ohlc;
    let h = -Infinity;
    let l = Infinity;
    for (let i = 0; i < completed.length; i++) {
      const c = completed[i];
      if (!c) continue;
      if (Number(c.high) > h) h = Number(c.high);
      if (Number(c.low) < l) l = Number(c.low);
    }
    if (!Number.isFinite(refHigh) || refHigh <= 0) {
      if (isLong && Number.isFinite(thrNum) && thrNum > 0) {
        refHigh = thrNum / (1 + bufferPct / 100);
      } else if (Number.isFinite(h) && h > 0) {
        refHigh = h;
      }
    }
    if (!Number.isFinite(refLow) || refLow <= 0) {
      if (!isLong && Number.isFinite(thrNum) && thrNum > 0) {
        refLow = thrNum / (1 - bufferPct / 100);
      } else if (Number.isFinite(l) && l > 0) {
        refLow = l;
      }
    }
  }

  if ((!Number.isFinite(refHigh) || refHigh <= 0) && Number.isFinite(thrNum) && thrNum > 0) {
    refHigh = isLong ? thrNum / (1 + bufferPct / 100) : thrNum * 1.018;
  }
  if ((!Number.isFinite(refLow) || refLow <= 0) && Number.isFinite(thrNum) && thrNum > 0) {
    refLow = !isLong ? thrNum / (1 - bufferPct / 100) : thrNum * 0.982;
  }
  if ((!Number.isFinite(refHigh) || refHigh <= 0) && livePriceNum > 0) {
    refHigh = livePriceNum * 1.012;
  }
  if ((!Number.isFinite(refLow) || refLow <= 0) && livePriceNum > 0) {
    refLow = livePriceNum * 0.988;
  }
  if (Number.isFinite(refHigh) && Number.isFinite(refLow) && refHigh <= refLow) {
    const mid = (refHigh + refLow) / 2 || livePriceNum || 1;
    refHigh = mid * 1.01;
    refLow = mid * 0.99;
  }

  const hasValidPrices = Number.isFinite(livePriceNum) && livePriceNum > 0 && Number.isFinite(refHigh) && refHigh > 0 && Number.isFinite(refLow) && refLow > 0;
  if (!hasValidPrices) {
    return null;
  }

  const wantUpper = isExit ? !isLong : isLong;
  const activeRefLevel = wantUpper ? refHigh : refLow;
  const breakoutLevel = Number.isFinite(thrNum) && thrNum > 0
    ? thrNum
    : (wantUpper ? refHigh * (1 + bufferPct / 100) : refLow * (1 - bufferPct / 100));

  const slCheck = evaluateSlCheck({
    opp,
    strategyConfig,
    livePrice: livePriceNum,
    isLong,
    isExit,
    signalDetail,
    refHigh,
    refLow,
    trigTfFallback: trigTf,
  });

  const {
    slType,
    slLookbackPeriod,
    slLookbackTf,
    hasExplicitSlMax,
    slMaxPct,
    slMinPct,
    slOobAction,
    slDistPct,
    slCapUsedPct,
    slCapRoomPct,
    slExceedsMax,
    slRejected,
    slClamped,
  } = slCheck;
  const rawOppSlDistPct = Number(opp?.sl_dist_pct);
  let slPrice = slCheck.slPrice;

  // Keep protective fallback SL price on the protective side only if no authoritative SL dist was provided
  if (slCheck.slSource === 'default' || slCheck.slSource === 'ref_extreme') {
    if (wantUpper && slPrice >= breakoutLevel) {
      slPrice = Math.min(refLow, breakoutLevel * (1 - Math.max(0.4, slDistPct) / 100));
    } else if (!wantUpper && slPrice <= breakoutLevel) {
      slPrice = Math.max(refHigh, breakoutLevel * (1 + Math.max(0.4, slDistPct) / 100));
    }
  } else if (!Number.isFinite(slPrice) || slPrice <= 0) {
    slPrice = wantUpper
      ? livePriceNum * (1 - slDistPct / 100)
      : livePriceNum * (1 + slDistPct / 100);
  }

  // Breakout Max Expansion Cap = % of HTF Reference Candle Distance (completely independent of SL distance / sl_max_pct)
  const capUsesSlLookback = false;
  const refCandleSpan = refHigh > refLow ? (refHigh - refLow) : 0;
  const backendRefRangePct = Number(signalDetail.ref_range_pct ?? NaN);
  const computedRefRangePct = activeRefLevel > 0 && refCandleSpan > 0
    ? Number(((refCandleSpan / activeRefLevel) * 100).toFixed(4))
    : 0;
  const refRangePct = Number.isFinite(backendRefRangePct) && backendRefRangePct > 0
    ? backendRefRangePct
    : computedRefRangePct;

  const backendEffectiveExpPct = Number(signalDetail.effective_max_expansion_pct ?? NaN);
  const refFractionExpPct = configuredMaxExpPct > 0
    ? (refRangePct > 0
        ? Number(((refRangePct * configuredMaxExpPct) / 100).toFixed(4))
        : configuredMaxExpPct)
    : 0;

  const hasHardCap = configuredMaxExpPct > 0;
  const hasAuthoritativeRefCap = Number.isFinite(backendEffectiveExpPct) && backendEffectiveExpPct > 0;
  const effectiveMaxExpPct = hasHardCap
    ? (hasAuthoritativeRefCap ? backendEffectiveExpPct : refFractionExpPct)
    : (refRangePct > 0 ? Number(Math.max(1.0, refRangePct * 0.25).toFixed(4)) : 2.0);
  const explicitCap = Number(signalDetail.expansion_cap ?? NaN);
  const canUseExplicitCap = hasHardCap && Number.isFinite(explicitCap) && explicitCap > 0 && (hasAuthoritativeRefCap || refCandleSpan <= 0);
  const expansionCap = canUseExplicitCap
    ? explicitCap
    : (hasHardCap && refCandleSpan > 0
        ? (wantUpper
            ? refHigh + refCandleSpan * (configuredMaxExpPct / 100)
            : refLow - refCandleSpan * (configuredMaxExpPct / 100))
        : (wantUpper
            ? refHigh * (1 + effectiveMaxExpPct / 100)
            : refLow * (1 - effectiveMaxExpPct / 100)));

  // Keep SL cap headroom telemetry purely for SL reference diagnostics (not breakout cap)
  const rawSlCapPrice = wantUpper
    ? slPrice / Math.max(0.1, 1 - slMaxPct / 100)
    : slPrice / (1 + slMaxPct / 100);
  const slCapHeadroomExhausted = Number.isFinite(rawSlCapPrice) && breakoutLevel > 0
    ? (wantUpper ? rawSlCapPrice <= breakoutLevel : rawSlCapPrice >= breakoutLevel)
    : false;
  const slCapPrice = slCapHeadroomExhausted ? breakoutLevel : rawSlCapPrice;

  // Signed % distance from breakout level (>0 means price has crossed beyond breakoutLevel in target direction)
  const distFromLevelPct = breakoutLevel > 0
    ? (wantUpper
        ? ((livePriceNum - breakoutLevel) / breakoutLevel) * 100
        : ((breakoutLevel - livePriceNum) / breakoutLevel) * 100)
    : 0;

  const capSpanPct = breakoutLevel > 0
    ? Math.max(0.0001, Math.abs(((expansionCap - breakoutLevel) / breakoutLevel) * 100))
    : effectiveMaxExpPct;

  const expansionCapUsedPct = distFromLevelPct <= 0
    ? 0
    : (distFromLevelPct / capSpanPct) * 100;
  const expansionCapRoomPct = distFromLevelPct <= 0
    ? capSpanPct
    : capSpanPct - distFromLevelPct;

  const capUsedPct = expansionCapUsedPct;
  const capRoomPct = expansionCapRoomPct;

  // Prospective or Snapshot SL <-> Entry <-> Target/Exit & R:R Ratio telemetry
  const tpRatio = Math.max(0.5, Number(strategyConfig.tp_ratio ?? opp?.prospect_rr ?? 2.0) || 2.0);
  const entryPrice = opp?.isEntrySnapshot && Number(opp?.price) > 0 ? Number(opp.price) : livePriceNum;
  const exitSnap = opp?.exitSnapshot || null;
  const targetRewardPct = Number((slCheck.effectiveSlDistPct * tpRatio).toFixed(2));
  const targetExitPrice = wantUpper
    ? entryPrice * (1 + targetRewardPct / 100)
    : entryPrice * (1 - targetRewardPct / 100);
  const exitOrTargetPrice = exitSnap && Number(exitSnap.exitPrice) > 0
    ? Number(exitSnap.exitPrice)
    : targetExitPrice;
  const pnlOrRewardPct = exitSnap && Number.isFinite(Number(exitSnap.pnlPct))
    ? Number(exitSnap.pnlPct)
    : targetRewardPct;
  const rrRatio = exitSnap && Number.isFinite(Number(exitSnap.exitRr))
    ? Number(exitSnap.exitRr)
    : Number(tpRatio.toFixed(2));

  // Build slim, color-filled lookback candles + trigger candle with wicks
  const lookbackCandles = (() => {
    const count = Math.min(5, Math.max(3, slLookbackPeriod));
    if (ohlc.length >= 2) {
      const slice = ohlc.slice(-(count + 1));
      return slice.map((c, idx) => {
        const isTrig = idx === slice.length - 1;
        const o = Number(c?.open ?? livePriceNum);
        const cl = isTrig ? livePriceNum : Number(c?.close ?? o);
        const hi = Math.max(o, cl, Number(c?.high ?? Math.max(o, cl)));
        const lo = Math.min(o, cl, Number(c?.low ?? Math.min(o, cl)));
        return {
          open: o,
          high: hi,
          low: lo,
          close: cl,
          isUp: cl >= o,
          isTrigger: isTrig,
        };
      });
    }

    // Deterministic lookback candles spanning the trigger-TF lookback window [slPrice .. breakoutLevel] + current trigger candle
    const capSpan = Math.max(Math.abs(expansionCap - breakoutLevel), breakoutLevel * 0.006, 1e-9);
    const slAnchor = slPrice > 0 ? slPrice : (wantUpper ? breakoutLevel - capSpan : breakoutLevel + capSpan);
    const lowAnchor = wantUpper ? Math.min(slAnchor, breakoutLevel - capSpan * 0.4) : breakoutLevel;
    const highAnchor = !wantUpper ? Math.max(slAnchor, breakoutLevel + capSpan * 0.4) : breakoutLevel;
    const span = Math.max(Math.abs(highAnchor - lowAnchor), capSpan * 0.5, 1e-9);
    const profiles = wantUpper
      ? [
          { o: 0.32, c: 0.16, h: 0.44, l: 0.00 }, // lookback low wick anchor
          { o: 0.16, c: 0.48, h: 0.58, l: 0.10 },
          { o: 0.48, c: 0.36, h: 0.62, l: 0.26 },
          { o: 0.36, c: 0.78, h: 0.90, l: 0.30 },
          { o: 0.78, c: 0.92, h: 1.00, l: 0.68 }, // refHigh anchor
        ]
      : [
          { o: 0.68, c: 0.84, h: 1.00, l: 0.56 }, // lookback high wick anchor
          { o: 0.84, c: 0.52, h: 0.90, l: 0.42 },
          { o: 0.52, c: 0.64, h: 0.74, l: 0.38 },
          { o: 0.64, c: 0.22, h: 0.70, l: 0.10 },
          { o: 0.22, c: 0.08, h: 0.32, l: 0.00 }, // refLow anchor
        ];
    const usedProfiles = profiles.slice(-count);
    const totalRange = Math.max(1e-9, highAnchor - lowAnchor);
    const synth = usedProfiles.map((p) => {
      const o = lowAnchor + totalRange * p.o;
      const cl = lowAnchor + totalRange * p.c;
      const hi = Math.max(o, cl, lowAnchor + totalRange * p.h);
      const lo = Math.min(o, cl, lowAnchor + totalRange * p.l);
      return {
        open: o,
        high: hi,
        low: lo,
        close: cl,
        isUp: cl >= o,
        isTrigger: false,
      };
    });

    const trigOpen = synth.length > 0 ? synth[synth.length - 1].close : (wantUpper ? refHigh * 0.996 : refLow * 1.004);
    const rawTrigHigh = Number(signalDetail.candle_high ?? NaN);
    const rawTrigLow = Number(signalDetail.candle_low ?? NaN);
    const trigHigh = Number.isFinite(rawTrigHigh) && rawTrigHigh > 0
      ? Math.max(rawTrigHigh, trigOpen, livePriceNum, closedPriceNum)
      : Math.max(trigOpen, livePriceNum, closedPriceNum) + span * 0.12;
    const trigLow = Number.isFinite(rawTrigLow) && rawTrigLow > 0
      ? Math.min(rawTrigLow, trigOpen, livePriceNum, closedPriceNum)
      : Math.min(trigOpen, livePriceNum, closedPriceNum) - span * 0.10;

    synth.push({
      open: trigOpen,
      high: trigHigh,
      low: trigLow,
      close: livePriceNum,
      isUp: livePriceNum >= trigOpen,
      isTrigger: true,
    });
    return synth;
  })();

  // Candle confirm state
  let candleConfirmState = signalDetail.candle_confirm_state || null;
  if (!candleConfirmState) {
    const closedCrossed = wantUpper ? closedPriceNum > breakoutLevel : closedPriceNum < breakoutLevel;
    const liveCrossed = wantUpper ? livePriceNum > breakoutLevel : livePriceNum < breakoutLevel;
    if (signalDetail.fired || (mode !== 'closed_candle_confirm' && liveCrossed) || (mode === 'closed_candle_confirm' && closedCrossed)) {
      candleConfirmState = 'closed_beyond';
    } else if (liveCrossed) {
      candleConfirmState = 'wicked_only';
    } else {
      candleConfirmState = 'below';
    }
  }

  // Trigger candle close countdown — anchor to a deterministic UTC boundary so the UI
  // counts down smoothly without jumping minute/second values across WS ticks.
  const tfMs = timeframeToMs(trigTf);
  const utcCloseTs = tfMs > 0 ? Math.floor(nowMs / tfMs) * tfMs + tfMs : 0;
  let candleCloseTs = utcCloseTs;
  if (Number.isFinite(Number(signalDetail.trig_close_time)) && Number(signalDetail.trig_close_time) > 0) {
    candleCloseTs = Number(signalDetail.trig_close_time);
  } else if (signalDetail.trig_close_countdown_ms !== undefined && Number.isFinite(Number(signalDetail.trig_close_countdown_ms))) {
    const serverCloseTs = nowMs + Math.max(0, Number(signalDetail.trig_close_countdown_ms));
    candleCloseTs = utcCloseTs > 0 && Math.abs(serverCloseTs - utcCloseTs) <= 10_000
      ? utcCloseTs
      : Math.round(serverCloseTs / 1000) * 1000;
  }
  const countdownMs = signalDetail.trig_close_countdown_ms !== undefined
    ? Math.max(0, Number(signalDetail.trig_close_countdown_ms))
    : (candleCloseTs > 0 ? Math.max(0, candleCloseTs - nowMs) : 0);
  const countdownMin = Math.max(1, Math.ceil(countdownMs / 60000));
  const countdownText = countdownMs >= 3600000
    ? `${trigTf} close in ${Math.floor(countdownMs / 3600000)}h ${Math.ceil((countdownMs % 3600000) / 60000)}m`
    : `${trigTf} close in ${countdownMin}m`;

  const isOverExpansionCap = (configuredMaxExpPct > 0 && expansionCapUsedPct > 100) || Boolean(signalDetail.rejected);
  const isOverCap = isOverExpansionCap;
  let zone = 'below';
  let zoneLabel = 'Below level';
  if (isOverCap) {
    zone = 'rejected';
    zoneLabel = 'Past cap · rejected';
  } else if (distFromLevelPct < 0) {
    if (Math.abs(distFromLevelPct) <= 0.5) {
      zone = 'near';
      zoneLabel = 'Near level';
    } else {
      zone = 'below';
      zoneLabel = 'Below level';
    }
  } else if (capUsedPct <= 25) {
    zone = 'fresh';
    zoneLabel = 'Fresh breakout';
  } else if (capUsedPct <= 60) {
    zone = 'stale';
    zoneLabel = 'Stale · aging';
  } else {
    zone = 'late';
    zoneLabel = hasHardCap ? 'Late · near cap' : 'Late · extended';
  }

  // Equivalent 0..150 dialPct so composite dial math & zone badges stay aligned
  let dialPct = 0;
  let rawDialPct = 0;
  if (isOverCap) {
    rawDialPct = Math.max(151, Math.round(150 + Math.max(1, capUsedPct - 100) * 0.5));
    dialPct = 150;
  } else if (distFromLevelPct < 0) {
    const absDist = Math.abs(distFromLevelPct);
    // Within 0.5% -> 80..99% (Near); 0.5%..3.5% -> 10..79% (Watching)
    if (absDist <= 0.5) {
      dialPct = Math.round(80 + ((0.5 - absDist) / 0.5) * 19);
    } else {
      dialPct = Math.max(5, Math.min(79, Math.round(80 / (1 + (absDist - 0.5) * 1.1))));
    }
    rawDialPct = dialPct;
  } else if (candleConfirmState === 'wicked_only' && mode === 'closed_candle_confirm' && !signalDetail.fired) {
    dialPct = 98;
    rawDialPct = 98;
  } else {
    // Map capUsedPct: 0..25% -> 100..105 (Fresh), 25..60% -> 105..115 (Stale), 60..100% -> 115..150 (Late)
    const boundedCap = Math.min(100, Math.max(0, capUsedPct));
    if (boundedCap <= 25) {
      rawDialPct = Math.round(100 + (boundedCap / 25) * 5);
    } else if (boundedCap <= 60) {
      rawDialPct = Math.round(105 + ((boundedCap - 25) / 35) * 10);
    } else {
      rawDialPct = Math.round(115 + ((boundedCap - 60) / 40) * 35);
    }
    dialPct = Math.max(100, Math.min(150, rawDialPct));
  }

  const entrySideCfg = String(strategyConfig.entry_side || 'both').toLowerCase();

  return {
    refTf,
    trigTf,
    mode,
    lookback,
    refLevelType,
    bufferPct,
    maxExpansionPct: configuredMaxExpPct,
    effectiveMaxExpPct,
    refRangePct,
    hasHardCap,
    capUsesSlLookback,
    slType,
    slLookbackPeriod,
    slLookbackTf,
    slPrice,
    slDistPct,
    effectiveSlDistPct: slCheck.effectiveSlDistPct,
    slMaxPct,
    slMinPct,
    slOobAction,
    slExceedsMax,
    slRejected,
    slClamped,
    slCapHeadroomExhausted,
    rawSlCapPrice,
    slCapPrice,
    slCapUsedPct,
    slCapRoomPct,
    tpRatio,
    entryPrice,
    targetExitPrice,
    exitOrTargetPrice,
    targetRewardPct,
    pnlOrRewardPct,
    rrRatio,
    lookbackCandles,
    refHigh,
    refLow,
    activeRefLevel,
    breakoutLevel,
    expansionCap,
    livePrice: livePriceNum,
    closedPrice: closedPriceNum,
    distFromLevelPct,
    capSpanPct,
    capUsedPct,
    capRoomPct,
    expansionCapUsedPct,
    expansionCapRoomPct,
    candleConfirmState,
    countdownMs,
    countdownText,
    candleCloseTs,
    trigTfMs: tfMs,
    zone,
    zoneLabel,
    isOverCap,
    isLong: wantUpper,
    entrySide: entrySideCfg,
    dialPct,
    rawDialPct,
  };
}

/**
 * Computes true-proportion linear vertical domain [pMin, pMax] for the HTF Breakout ladder:
 * - When `hasHardCap` is true, enforces 1:1 price spacing across [slPrice, breakoutLevel, expansionCap, livePrice]
 *   (only breaking SL axis past 6.0x / <0.12x capDist and accommodating over-cap moves up to 2.5x past expansionCap).
 * - When `hasHardCap` is false (`Cap Off`), keeps strict 1:1 spacing across [slPrice, breakoutLevel, livePrice]
 *   with an open-ended directional skirt (`effectiveCapTarget`) rather than fabricating a fake cap box.
 */
export function computeHtfLadderDomain({
  isLong,
  breakoutLevel,
  expansionCap,
  slPrice,
  livePrice,
  hasHardCap,
}) {
  const rawCapDist = hasHardCap ? Math.abs(expansionCap - breakoutLevel) : 0;
  const slBehindBreakout = slPrice > 0
    ? (isLong ? slPrice < breakoutLevel : slPrice > breakoutLevel)
    : true;
  const rawSlDist = slPrice > 0
    ? Math.abs(breakoutLevel - slPrice)
    : Math.max(rawCapDist * 0.85, breakoutLevel * 0.005);

  let slScaleBreak = false;
  let slVisualPrice = slPrice > 0 ? slPrice : (isLong ? breakoutLevel - rawSlDist : breakoutLevel + rawSlDist);
  let overCapActive = false;
  let pMax = breakoutLevel;
  let pMin = breakoutLevel;
  let effectiveCapTarget = expansionCap;

  if (hasHardCap) {
    const capDist = Math.max(rawCapDist, breakoutLevel * 0.0005, 1e-9);
    const minTrueSlSpan = capDist * 0.12;
    const maxTrueSlSpan = capDist * 6.0;
    if (slBehindBreakout) {
      slScaleBreak = slPrice > 0 && (rawSlDist > maxTrueSlSpan || rawSlDist < minTrueSlSpan);
      const visualSlSpan = slScaleBreak
        ? Math.min(Math.max(rawSlDist, minTrueSlSpan), maxTrueSlSpan)
        : rawSlDist;
      slVisualPrice = isLong ? breakoutLevel - visualSlSpan : breakoutLevel + visualSlSpan;
    } else {
      slScaleBreak = false;
      slVisualPrice = slPrice;
    }

    overCapActive = isLong ? livePrice > expansionCap : livePrice < expansionCap;
    const lowAnchor = slBehindBreakout ? slVisualPrice : (breakoutLevel - capDist * 0.25);
    const highAnchor = slBehindBreakout ? slVisualPrice : (breakoutLevel + capDist * 0.25);
    const underSlActive = slBehindBreakout && (isLong ? livePrice < slVisualPrice : livePrice > slVisualPrice);
    const clampedLiveForDomain = isLong
      ? Math.max(lowAnchor - capDist * 0.35, Math.min(expansionCap + capDist * 2.5, livePrice))
      : Math.min(highAnchor + capDist * 0.35, Math.max(expansionCap - capDist * 2.5, livePrice));

    pMax = isLong
      ? (overCapActive
          ? Math.max(expansionCap + capDist * 0.18, clampedLiveForDomain + capDist * 0.08)
          : expansionCap + capDist * 0.05)
      : (underSlActive
          ? Math.max(highAnchor + capDist * 0.15, clampedLiveForDomain + capDist * 0.08)
          : (slBehindBreakout ? highAnchor + capDist * 0.04 : highAnchor));

    pMin = isLong
      ? (underSlActive
          ? Math.min(lowAnchor - capDist * 0.15, clampedLiveForDomain - capDist * 0.08)
          : (slBehindBreakout ? lowAnchor - capDist * 0.04 : lowAnchor))
      : (overCapActive
          ? Math.min(expansionCap - capDist * 0.18, clampedLiveForDomain - capDist * 0.08)
          : expansionCap - capDist * 0.05);
  } else {
    const liveDistPastBreak = isLong
      ? Math.max(0, livePrice - breakoutLevel)
      : Math.max(0, breakoutLevel - livePrice);
    const slRefSpan = slPrice > 0
      ? Math.max(Math.abs(livePrice - slPrice), rawSlDist)
      : rawSlDist;
    const openSpan = Math.max(liveDistPastBreak * 1.45, slRefSpan * 0.55, breakoutLevel * 0.002);
    effectiveCapTarget = isLong ? breakoutLevel + openSpan : breakoutLevel - openSpan;

    const underSlActive = isLong ? livePrice < slVisualPrice : livePrice > slVisualPrice;
    const liveBeyondSl = isLong ? Math.max(0, slVisualPrice - livePrice) : Math.max(0, livePrice - slVisualPrice);
    const slTail = slBehindBreakout
      ? (underSlActive ? Math.min(rawSlDist * 0.5, liveBeyondSl + rawSlDist * 0.15) : rawSlDist * 0.04)
      : openSpan * 0.25;

    pMax = isLong ? effectiveCapTarget : (slBehindBreakout ? slVisualPrice + slTail : breakoutLevel + slTail);
    pMin = isLong ? (slBehindBreakout ? slVisualPrice - slTail : breakoutLevel - slTail) : effectiveCapTarget;
  }

  return {
    rawCapDist,
    rawSlDist,
    slBehindBreakout,
    slScaleBreak,
    slVisualPrice,
    overCapActive,
    pMax,
    pMin,
    effectiveCapTarget,
  };
}

/**
 * Computes a value-based + percentage meter anchored around target (100% on 0..150 dial,
 * and 75% on 0..100 linear bar):
 * - Dial [0..100): approaching target (Watching <80, Near 80-100)
 * - Dial [100..150]: at or past target (Fresh 0-5% past, Stale 5-15% past, Late >15% past)
 */
export function computeConditionMeter({
  value,
  threshold,
  thresholdIsPrice = false,
  unit = '',
  isLong = true,
  isExit = false,
  fired = false,
  active = true,
  rejected = false,
  alreadyCrossed = false,
  insufficientData = false,
  signalKey = '',
  proximity = 0,
  isIndicatorPair = false,
  referenceSpanPct = null,
}) {
  const safeProx = Math.max(0, Math.min(100, Math.round(Number(proximity) || 0)));

  if (insufficientData) {
    return {
      meterFillPct: 0,
      targetTickPct: 75,
      meterState: 'warming',
      deltaValueText: '',
      deltaPctText: '',
      meterReadout: 'Warming',
      dialPct: 0,
      rawDialPct: 0,
      dialScale: null,
      dialZone: 'warming',
      dialStatus: 'Warming',
      dialOverText: 'Warming',
    };
  }

  const val = value === undefined || value === null || value === '' ? NaN : Number(value);
  const thr = threshold === undefined || threshold === null || threshold === '' ? NaN : Number(threshold);
  const hasNumeric = Number.isFinite(val) && Number.isFinite(thr);

  if (!hasNumeric) {
    if (alreadyCrossed) {
      return {
        meterFillPct: 50,
        targetTickPct: 75,
        meterState: 'stale_crossed',
        deltaValueText: '',
        deltaPctText: '0%',
        meterReadout: 'Already crossed · needs reset',
        dialPct: 0,
        rawDialPct: 0,
        dialScale: null,
        dialZone: 'crossed_stale',
        dialStatus: 'Already Crossed',
        dialOverText: 'Crossed · needs reset',
        deltaLabel: 'Past cross (no pass)',
        isOffScale: false,
        alreadyCrossed: true,
      };
    }
    const isMet = Boolean(fired && active);
    const fill = isMet ? 82 : Math.min(74, Math.round((safeProx / 100) * 75));
    const dialPct = isMet ? 103 : Math.min(99, safeProx);
    const zoneInfo = resolveDialZone(dialPct, { rejected, rawDialPct: dialPct });
    return {
      meterFillPct: fill,
      targetTickPct: 75,
      meterState: rejected ? 'blocked' : isMet ? 'exceeded' : safeProx > 0 ? 'approaching' : 'idle',
      deltaValueText: '',
      deltaPctText: `${safeProx}%`,
      meterReadout: isMet ? 'Target met' : `${safeProx}% ready`,
      dialPct,
      rawDialPct: dialPct,
      dialScale: null,
      ...zoneInfo,
    };
  }

  let signedDelta = 0;
  let pctDelta = NaN;
  let rawRatio = 0;

  if (signalKey === '__velocity__') {
    const absVal = Math.abs(val);
    signedDelta = absVal - thr;
    pctDelta = thr !== 0 ? (signedDelta / Math.abs(thr)) * 100 : NaN;
    rawRatio = thr > 0 ? absVal / thr : (absVal > 0 ? 1 : 0);
  } else if (thresholdIsPrice) {
    const wantUpper = isExit ? !isLong : isLong;
    signedDelta = wantUpper ? (val - thr) : (thr - val);
    pctDelta = thr !== 0 ? (signedDelta / Math.abs(thr)) * 100 : NaN;
    const boundPct = pickNicePercentBound(Math.abs(pctDelta), referenceSpanPct || 1.0);
    if (Number.isFinite(pctDelta)) {
      rawRatio = pctDelta >= 0
        ? 1 + (pctDelta / boundPct) * 0.5
        : Math.max(0, 1 + pctDelta / boundPct);
    } else {
      rawRatio = safeProx / 100;
    }
  } else if (thr === 0) {
    const wantPositive = isExit ? !isLong : isLong;
    signedDelta = wantPositive ? val : -val;
    pctDelta = NaN;
    rawRatio = signedDelta >= 0 ? 1.15 : (safeProx / 100);
  } else {
    if (isLong) {
      signedDelta = thr > 0 ? (val - thr) : (thr - val);
    } else {
      if (thr < 0) {
        signedDelta = thr - val;
      } else {
        signedDelta = val < 0 ? (Math.abs(val) - thr) : -(val + thr);
      }
    }
    pctDelta = (signedDelta / Math.abs(thr)) * 100;
    if (signedDelta >= 0) {
      rawRatio = 1 + Math.max(0, pctDelta / 100);
    } else {
      rawRatio = safeProx / 100;
    }
  }

  const isExceeded = (fired && active && signedDelta >= 0) || (signedDelta >= 0 && (!isExit || fired || safeProx >= 99));
  let meterFillPct;
  let dialPct;
  let rawDialPct;
  let dialScale = null;
  let zoneInfo;

  if (thresholdIsPrice && Number.isFinite(pctDelta)) {
    // True-proportion symmetric bipolar linear scale [-boundPct%, +boundPct%] centered on Cross / Target (0%)
    const boundPct = pickNicePercentBound(Math.abs(pctDelta), referenceSpanPct || 1.0);
    const boundLabel = formatScaleBound(boundPct);
    const clampedPct = Math.max(-boundPct, Math.min(boundPct, pctDelta));
    const isOffScale = Math.abs(pctDelta) > boundPct;

    dialScale = {
      mode: 'bipolar_pct',
      boundPct,
      valuePct: pctDelta,
      clampedValuePct: clampedPct,
      minLabel: `-${boundLabel}%`,
      centerLabel: isIndicatorPair ? 'cross' : 'target',
      maxLabel: `+${boundLabel}%`,
      subText: `scale ±${boundLabel}%`,
      isOffScale,
    };

    // Linear meter fill centered at 50% (0..50 approaching, 50..100 past)
    meterFillPct = Math.max(0, Math.min(100, Math.round(50 + (clampedPct / boundPct) * 50)));

    if (alreadyCrossed) {
      const pctFormatted = formatAbsPct(pctDelta);
      const sign = pctDelta >= 0 ? '+' : '-';
      dialPct = 0;
      rawDialPct = 0;
      dialScale = {
        ...dialScale,
        subText: 'No pass · needs reset',
      };
      zoneInfo = {
        dialZone: 'crossed_stale',
        dialStatus: 'Already Crossed',
        dialOverText: `${sign}${pctFormatted}% · crossed`,
        isOffScale,
      };
    } else if (pctDelta >= 0 && (fired || safeProx >= 95 || pctDelta > 0)) {
      rawDialPct = 100 + Math.max(fired && pctDelta > 0 ? 1 : 0, Math.round((pctDelta / boundPct) * 50));
      dialPct = Math.min(150, rawDialPct);
      const pctFormatted = formatAbsPct(pctDelta);
      if (rejected) {
        zoneInfo = {
          dialZone: 'blocked',
          dialStatus: 'Rejected',
          dialOverText: `+${pctFormatted}% · rejected`,
          isOffScale,
        };
      } else {
        const ratioOfBound = pctDelta / boundPct;
        const dialZone = ratioOfBound <= 0.25 ? 'fresh' : ratioOfBound <= 0.6 ? 'stale' : 'late';
        const dialStatus = dialZone === 'fresh' ? 'Fresh' : dialZone === 'stale' ? 'Stale' : 'Late';
        zoneInfo = {
          dialZone,
          dialStatus,
          dialOverText: isOffScale ? `+${pctFormatted}% · off-scale` : `+${pctFormatted}% past`,
          isOffScale,
        };
      }
    } else {
      const linearPre = Math.max(0, Math.min(99, Math.round((1 + pctDelta / boundPct) * 100)));
      dialPct = linearPre;
      rawDialPct = linearPre;
      const pctFormatted = formatAbsPct(pctDelta);
      if (rejected) {
        zoneInfo = {
          dialZone: 'blocked',
          dialStatus: 'Rejected',
          dialOverText: 'Blocked',
          isOffScale: false,
        };
      } else {
        const dialZone = Math.abs(pctDelta) <= boundPct * 0.2 ? 'near' : 'watching';
        const dialStatus = dialZone === 'near' ? 'Near' : 'Watching';
        zoneInfo = {
          dialZone,
          dialStatus,
          dialOverText: `${pctFormatted}% to ${isIndicatorPair ? 'cross' : 'target'}`,
          isOffScale,
        };
      }
    }
  } else {
    if (alreadyCrossed) {
      meterFillPct = 50;
      dialPct = 0;
      rawDialPct = 0;
      zoneInfo = {
        dialZone: 'crossed_stale',
        dialStatus: 'Already Crossed',
        dialOverText: 'Crossed · needs reset',
        isOffScale: false,
      };
      dialScale = null;
    } else {
      if (signedDelta >= 0 && (fired || safeProx >= 95 || signalKey === '__velocity__')) {
        const overshoot = Number.isFinite(pctDelta)
          ? Math.min(1, Math.max(0, pctDelta / 100))
          : 0.25;
        meterFillPct = Math.min(100, Math.max(fired ? 78 : 75, Math.round(75 + overshoot * 25)));

        let rawOvershoot = 3;
        if (Number.isFinite(pctDelta)) {
          rawOvershoot = Math.max(fired && pctDelta > 0 ? 1 : 0, Math.floor(pctDelta + 1e-9));
        }
        rawDialPct = 100 + rawOvershoot;
        dialPct = Math.min(150, rawDialPct);
      } else if (signedDelta < 0) {
        const clampedRatio = Math.max(0, Math.min(0.99, rawRatio));
        meterFillPct = Math.min(74, Math.max(0, Math.round(clampedRatio * 75)));
        dialPct = Math.min(99, Math.max(0, Math.round(clampedRatio * 100)));
        rawDialPct = dialPct;
      } else {
        meterFillPct = Math.min(74, Math.max(0, Math.round((safeProx / 100) * 75)));
        dialPct = Math.min(99, Math.max(0, safeProx));
        rawDialPct = dialPct;
      }

      zoneInfo = resolveDialZone(dialPct, { rejected, rawDialPct });

      const scaleMax = pickNiceRatioMax(rawDialPct);
      dialScale = {
        mode: 'linear_ratio',
        minPct: 0,
        targetPct: 100,
        maxPct: scaleMax,
        valuePct: rawDialPct,
        minLabel: '0%',
        targetLabel: 'target',
        maxLabel: `+${scaleMax - 100}%`,
        subText: rawDialPct >= 100
          ? `${(rawDialPct / 100).toFixed(2)}× target`
          : `${Math.round(rawDialPct)}% of target`,
        isOffScale: rawDialPct > scaleMax,
      };
    }
  }

  const meterState = alreadyCrossed
    ? 'stale_crossed'
    : rejected
      ? 'blocked'
      : (signedDelta >= 0 && meterFillPct >= (thresholdIsPrice ? 50 : 75))
        ? 'exceeded'
        : safeProx <= 0 && signedDelta < 0
          ? 'diverging'
          : 'approaching';

  const deltaValueText = formatSignedDeltaValue(signedDelta, unit, thresholdIsPrice);
  const deltaPctText = Number.isFinite(pctDelta) ? formatSignedPct(pctDelta) : '';

  let meterReadout = '';
  if (alreadyCrossed) {
    meterReadout = deltaValueText && deltaPctText
      ? `${deltaValueText} (${deltaPctText}) crossed · no pass`
      : 'Already crossed · needs reset';
  } else if (deltaValueText && deltaPctText) {
    meterReadout = signedDelta >= 0
      ? `${deltaValueText} (${deltaPctText}) past`
      : `${deltaValueText} (${deltaPctText}) to target`;
  } else if (deltaValueText) {
    meterReadout = `${deltaValueText} ${signedDelta >= 0 ? 'past' : 'to'} 0`;
  } else {
    meterReadout = `${safeProx}%`;
  }

  void isExceeded;
  return {
    meterFillPct,
    targetTickPct: thresholdIsPrice ? 50 : 75,
    meterState,
    signedDelta,
    pctDelta: Number.isFinite(pctDelta) ? pctDelta : null,
    deltaValueText,
    deltaPctText,
    meterReadout,
    dialPct,
    rawDialPct,
    dialScale,
    ...(alreadyCrossed ? { deltaLabel: 'Past cross (no pass)', alreadyCrossed: true } : {}),
    ...zoneInfo,
  };
}

function formatHistNumber(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '---';
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const decimals = abs >= 10 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
  return `${sign}${abs.toFixed(decimals)}`;
}

/**
 * Builds a normalized MACD Filter & Histogram telemetry model for:
 * - EMA Dual variants (`ema_dual`, `ema_dual_cross`, `ema_dual_close`) when `ema_dual_macd_filter` is enabled
 * - Standalone MACD signals (`macd_impulse`, `macd_pbc`, `macd_fade`)
 */
export function buildMacdFilterModel({
  sigKey = '',
  signalDetail = {},
  strategyConfig = {},
  isLong = true,
  isExit = false,
} = {}) {
  const baseType = getBaseSignalType(sigKey);
  const raw = signalDetail?.macd_filter;

  if (raw && typeof raw === 'object' && raw.enabled !== false) {
    const histNum = Number(raw.histogram);
    const prevHistNum = Number(raw.prev_histogram);
    const recentHist = Array.isArray(raw.recent_hist)
      ? raw.recent_hist.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : [];
    const expectedSign = raw.expected_sign || (isExit ? (isLong ? 'negative' : 'positive') : (isLong ? 'positive' : 'negative'));
    return {
      enabled: true,
      mode: raw.mode || (baseType.startsWith('macd_') ? baseType : 'ema_filter'),
      fast: Number(raw.fast) || 12,
      slow: Number(raw.slow) || 26,
      signal: Number(raw.signal) || 9,
      histogram: Number.isFinite(histNum) ? histNum : null,
      prevHistogram: Number.isFinite(prevHistNum) ? prevHistNum : null,
      histogramText: Number.isFinite(histNum) ? formatHistNumber(histNum) : '---',
      recentHist,
      aligned: Boolean(raw.aligned),
      rejected: Boolean(raw.rejected || signalDetail?.rejected),
      expectedSign,
      expectedLabel: raw.expected_label || (expectedSign === 'negative' ? 'Red (-Hist)' : 'Green (+Hist)'),
      gates: Array.isArray(raw.gates) ? raw.gates : [],
      barCount: Number.isFinite(Number(raw.bar_count)) ? Number(raw.bar_count) : null,
      maxEntryCandle: Number.isFinite(Number(raw.max_entry_candle)) ? Number(raw.max_entry_candle) : null,
      strictExpansion: raw.strict_expansion === true,
    };
  }

  // Fallback synthesis when backend snapshot predates macd_filter payload
  const params = strategyConfig?.signal_params || {};
  const scopedParams = (params[sigKey] && typeof params[sigKey] === 'object')
    ? params[sigKey]
    : (params[baseType] && typeof params[baseType] === 'object' ? params[baseType] : {});
  const suffix = sigKey !== baseType && sigKey.startsWith(baseType) ? sigKey.substring(baseType.length) : '';
  const resolveParam = (k, defVal) => {
    if (scopedParams[k] !== undefined) return scopedParams[k];
    if (suffix) {
      if (params[`${k}${suffix}`] !== undefined) return params[`${k}${suffix}`];
      if (k.startsWith(baseType) && params[`${sigKey}${k.substring(baseType.length)}`] !== undefined) {
        return params[`${sigKey}${k.substring(baseType.length)}`];
      }
      if (k.startsWith('ema_dual') && params[`${sigKey}${k.substring('ema_dual'.length)}`] !== undefined) {
        return params[`${sigKey}${k.substring('ema_dual'.length)}`];
      }
    }
    return params[k] ?? strategyConfig?.[k] ?? defVal;
  };

  const isEmaDual = baseType === 'ema_dual' || baseType === 'ema_dual_cross' || baseType === 'ema_dual_close';
  const desc = String(signalDetail?.description || '');
  const emaMacdEnabled = isEmaDual && (
    resolveParam('ema_dual_macd_filter', false) === true ||
    resolveParam('ema_dual_macd_filter', false) === 'true' ||
    /rejected by macd/i.test(desc)
  );

  if (emaMacdEnabled) {
    const fast = Number(resolveParam('macd_fast', 12)) || 12;
    const slow = Number(resolveParam('macd_slow', 26)) || 26;
    const sig = Number(resolveParam('macd_signal', 9)) || 9;
    const expectPositive = isExit ? !isLong : isLong;
    const rejectedByMacd = Boolean(signalDetail?.rejected && /macd/i.test(desc));
    const matchHist = desc.match(/MACD(?: histogram)? \(([+-]?\d+(?:\.\d+)?)/i);
    const parsedHist = matchHist ? Number(matchHist[1]) : null;
    const aligned = parsedHist !== null
      ? (expectPositive ? parsedHist > 0 : parsedHist < 0)
      : (rejectedByMacd ? false : Boolean(signalDetail?.fired));
    const isHistGreen = parsedHist !== null
      ? parsedHist >= 0
      : (aligned ? expectPositive : !expectPositive);

    return {
      enabled: true,
      mode: 'ema_filter',
      fast,
      slow,
      signal: sig,
      histogram: Number.isFinite(parsedHist) ? parsedHist : null,
      prevHistogram: null,
      histogramText: Number.isFinite(parsedHist) ? formatHistNumber(parsedHist) : (isHistGreen ? 'Hist. Green' : 'Hist. Red'),
      recentHist: Number.isFinite(parsedHist) ? [parsedHist] : [],
      aligned,
      rejected: rejectedByMacd,
      expectedSign: expectPositive ? 'positive' : 'negative',
      expectedLabel: expectPositive ? 'Green (+Hist)' : 'Red (-Hist)',
      gates: [
        {
          key: 'macd_hist',
          label: `MACD(${fast}/${slow}/${sig}) ${expectPositive ? '> 0 (Green)' : '< 0 (Red)'}`,
          passed: aligned,
          rejected: rejectedByMacd,
          value: Number.isFinite(parsedHist) ? formatHistNumber(parsedHist) : (isHistGreen ? 'Hist. Green' : 'Hist. Red'),
        },
      ],
    };
  }

  if (baseType === 'macd_impulse' || baseType === 'macd_pbc' || baseType === 'macd_fade') {
    const fast = Number(resolveParam('macd_fast', 12)) || 12;
    const slow = Number(resolveParam('macd_slow', 26)) || 26;
    const sig = Number(resolveParam('macd_signal', 9)) || 9;
    const valNum = Number(signalDetail?.value);
    const threshNum = Number(signalDetail?.threshold);
    const isHistUnit = baseType === 'macd_pbc' && signalDetail?.unit !== 'price' || baseType === 'macd_fade';
    const histVal = isHistUnit && Number.isFinite(valNum) ? valNum : null;
    const prevHistVal = isHistUnit && Number.isFinite(threshNum) ? threshNum : null;
    const rejected = Boolean(signalDetail?.rejected || /rejected:/i.test(desc));
    const fired = Boolean(signalDetail?.fired);
    const expectedSign = isExit ? (isLong ? 'negative' : 'positive') : (isLong ? 'positive' : 'negative');

    return {
      enabled: true,
      mode: baseType,
      fast,
      slow,
      signal: sig,
      histogram: histVal,
      prevHistogram: prevHistVal,
      histogramText: histVal !== null ? formatHistNumber(histVal) : (Number.isFinite(valNum) ? `${valNum}${signalDetail?.unit || ''}` : '---'),
      recentHist: histVal !== null && prevHistVal !== null ? [prevHistVal, histVal] : (histVal !== null ? [histVal] : []),
      aligned: fired,
      rejected,
      expectedSign,
      expectedLabel: expectedSign === 'negative' ? 'Red (-Hist)' : 'Green (+Hist)',
      gates: [],
    };
  }

  return null;
}

/** Normalizes Engulfing telemetry for a compact candle-sequence visualization. */
export function buildEngulfingPatternModel({
  sigKey = '',
  signalDetail = {},
  strategyConfig = {},
  isLong = true,
  isExit = false,
} = {}) {
  const baseType = getBaseSignalType(sigKey);
  if (baseType !== 'engulfing') return null;

  const params = strategyConfig?.signal_params || {};
  const raw = signalDetail?.engulfing_pattern || {};
  const direction = raw.direction || (isExit ? (isLong ? 'bearish' : 'bullish') : (isLong ? 'bullish' : 'bearish'));
  const mode = String(raw.mode || resolveSignalParamClient(params, sigKey, baseType, 'engulfing_mode', strategyConfig.engulfing_mode || 'range'));
  const lookback = Math.max(1, Number(raw.lookback ?? resolveSignalParamClient(params, sigKey, baseType, 'engulfing_lookback', strategyConfig.engulfing_lookback || 1)) || 1);
  const streakRequired = Math.max(1, Number(raw.streak_required ?? resolveSignalParamClient(params, sigKey, baseType, 'engulfing_streak', strategyConfig.engulfing_streak || 1)) || 1);
  const streakFound = Math.max(0, Number(raw.streak_found ?? (signalDetail.streak_end - signalDetail.streak_start)) || 0);
  const sequentialRaw = raw.sequential ?? resolveSignalParamClient(params, sigKey, baseType, 'engulfing_sequential', strategyConfig.engulfing_sequential !== false);
  const volumeRaw = raw.volume_confirm ?? resolveSignalParamClient(params, sigKey, baseType, 'engulfing_volume_confirm', strategyConfig.engulfing_volume_confirm || false);
  const maxExpansion = Number(raw.max_expansion_pct ?? signalDetail.max_expansion_pct);
  const expansion = Number(raw.expansion_pct ?? signalDetail.expansion_pct);
  const fired = Boolean(signalDetail.fired);
  const late = raw.state === 'late' || /already engulfed|late/i.test(String(signalDetail.description || ''));
  const state = raw.state || (fired ? 'confirmed' : (late ? 'late' : (streakFound >= streakRequired ? 'waiting_break' : 'waiting_streak')));

  return {
    direction,
    mode,
    lookback,
    streakRequired,
    streakFound,
    sequential: sequentialRaw === true || sequentialRaw === 'true',
    volumeConfirm: volumeRaw === true || volumeRaw === 'true',
    closeOnly: Boolean(raw.close_only || mode === 'close_range' || mode === 'close_body'),
    fired,
    late,
    state,
    expansionPct: Number.isFinite(expansion) ? expansion : null,
    maxExpansionPct: Number.isFinite(maxExpansion) ? maxExpansion : null,
  };
}

/**
 * Normalizes close-confirmation telemetry for `ema_close` and `ema_dual_close`
 * so Inspect Candidates renders completed-candle vs live-forming alignment
 * alongside a live UTC-anchored candle close countdown.
 */
export function buildCloseConfirmationModel({
  sigKey = '',
  signalDetail = {},
  timeframe = '5m',
  isLong = true,
  isExit = false,
  nowMs = Date.now(),
} = {}) {
  const baseType = getBaseSignalType(sigKey);
  if (baseType !== 'ema_close' && baseType !== 'ema_dual_close') return null;

  const isDual = baseType === 'ema_dual_close';
  const effectiveTf = String(signalDetail?.timeframe || timeframe || '5m');
  const tfMs = timeframeToMs(effectiveTf) || 60000;
  const wantUpper = isExit ? !isLong : isLong;

  const numOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  let closedVal = isDual
    ? (numOrNull(signalDetail?.closed_fast) ?? numOrNull(signalDetail?.closed_value) ?? numOrNull(signalDetail?.value))
    : (numOrNull(signalDetail?.closed_value) ?? numOrNull(signalDetail?.value));
  let closedTarget = isDual
    ? (numOrNull(signalDetail?.closed_slow) ?? numOrNull(signalDetail?.closed_threshold) ?? numOrNull(signalDetail?.threshold))
    : (numOrNull(signalDetail?.closed_threshold) ?? numOrNull(signalDetail?.threshold));

  // Backward compatibility with legacy backend snapshots where ema_dual_close placed completedClose in value and liveFast in live_price
  if (isDual && signalDetail?.closed_fast === undefined && signalDetail?.live_fast === undefined && numOrNull(signalDetail?.live_price) !== null && numOrNull(signalDetail?.threshold) !== null) {
    closedTarget = closedTarget ?? numOrNull(signalDetail?.threshold);
  }

  const liveVal = isDual
    ? (numOrNull(signalDetail?.live_fast) ?? numOrNull(signalDetail?.live_price) ?? closedVal)
    : (numOrNull(signalDetail?.live_price) ?? closedVal);
  const liveTarget = isDual
    ? (numOrNull(signalDetail?.live_slow) ?? numOrNull(signalDetail?.live_threshold) ?? numOrNull(signalDetail?.threshold) ?? closedTarget)
    : (numOrNull(signalDetail?.live_threshold) ?? closedTarget);

  if (closedVal === null && liveVal === null && closedTarget === null) {
    // Still return structured metadata during warmup/standby so the close-wait contract is visible
  }

  const isAlignedSide = (v, t) => {
    if (v === null || t === null || t === 0) return null;
    return wantUpper ? v > t : v < t;
  };

  const pctGap = (v, t) => {
    if (v === null || t === null || t === 0) return null;
    const raw = ((v - t) / Math.abs(t)) * 100;
    return wantUpper ? raw : -raw;
  };

  const fired = Boolean(signalDetail?.fired);
  const rejected = Boolean(signalDetail?.rejected || signalDetail?.status === 'blocked');

  const closedAligned = typeof signalDetail?.closed_aligned === 'boolean'
    ? signalDetail.closed_aligned
    : (fired ? true : Boolean(isAlignedSide(closedVal, closedTarget)));

  const liveAligned = typeof signalDetail?.live_aligned === 'boolean'
    ? signalDetail.live_aligned
    : Boolean(isAlignedSide(liveVal, liveTarget));

  let state = 'waiting';
  if (rejected) {
    state = 'rejected';
  } else if (fired || closedAligned) {
    state = 'confirmed';
  } else if (liveAligned || signalDetail?.candle_confirm_state === 'wicked_only') {
    state = 'wait_close';
  }

  let stateLabel = 'WAITING';
  if (state === 'rejected') stateLabel = 'BLOCKED';
  else if (state === 'confirmed') stateLabel = 'CONFIRMED';
  else if (state === 'wait_close') stateLabel = 'WAIT CLOSE';

  const explicitCloseTs = Number(signalDetail?.candle_close_ts);
  const explicitCountdown = Number(signalDetail?.trig_close_countdown_ms);
  const candleCloseTs = Number.isFinite(explicitCloseTs) && explicitCloseTs > 0
    ? explicitCloseTs
    : (Number.isFinite(explicitCountdown) && explicitCountdown > 0 && Number.isFinite(nowMs)
        ? nowMs + explicitCountdown
        : (tfMs > 0 && Number.isFinite(nowMs) ? Math.ceil((nowMs + 1) / tfMs) * tfMs : 0));

  return {
    enabled: true,
    mode: isDual ? 'dual_ema' : 'price_ema',
    timeframe: effectiveTf,
    tfMs,
    candleCloseTs,
    wantUpper,
    closedTitle: isDual ? 'Closed EMA' : 'Closed Candle',
    liveTitle: isDual ? 'Live EMA' : 'Live Candle',
    closedSubjectLabel: isDual ? 'Fast' : 'Close',
    closedTargetLabel: isDual ? 'Slow' : 'EMA',
    closedVal,
    closedTarget,
    closedValText: closedVal !== null ? formatCompactValue(closedVal, 'price', true) : '---',
    closedTargetText: closedTarget !== null ? formatCompactValue(closedTarget, 'price', true) : '---',
    closedDeltaPct: pctGap(closedVal, closedTarget),
    closedAligned,
    liveVal,
    liveTarget,
    liveValText: liveVal !== null ? formatCompactValue(liveVal, 'price', true) : '---',
    liveTargetText: liveTarget !== null ? formatCompactValue(liveTarget, 'price', true) : '---',
    liveDeltaPct: pctGap(liveVal, liveTarget),
    liveAligned,
    fired,
    rejected,
    pullingBack: state === 'confirmed' && liveVal !== null && liveTarget !== null && !liveAligned,
    state,
    stateLabel,
  };
}

/**
 * Computes real-time tick delta and directional color-coding between two consecutive evaluations
 * of the same condition item so the UI can highlight what value is changing and whether it is
 * moving toward the target, pulling back, or extending past the cap.
 */
export function computeConditionValueDelta(prevItem, currItem) {
  if (!prevItem || !currItem) return null;

  const prevVal = Number(prevItem.liveValue);
  const currVal = Number(currItem.liveValue);
  const hasNumeric = Number.isFinite(prevVal) && Number.isFinite(currVal);
  const rawDiff = hasNumeric ? (currVal - prevVal) : 0;
  const numericChanged = hasNumeric && Math.abs(rawDiff) > 1e-10;

  const prevDial = Number(prevItem.rawDialPct ?? prevItem.dialPct ?? 0);
  const currDial = Number(currItem.rawDialPct ?? currItem.dialPct ?? 0);
  const dialDelta = Math.round(currDial - prevDial);

  const prevHist = Number(prevItem.macdFilter?.histogram);
  const currHist = Number(currItem.macdFilter?.histogram);
  const hasHist = Number.isFinite(prevHist) && Number.isFinite(currHist);
  const histDiff = hasHist ? (currHist - prevHist) : 0;
  const histChanged = hasHist && Math.abs(histDiff) > 1e-10;
  const alignedChanged = Boolean(prevItem.macdFilter && currItem.macdFilter && Boolean(prevItem.macdFilter.aligned) !== Boolean(currItem.macdFilter.aligned));

  const textChanged = Boolean(prevItem.liveText && currItem.liveText && prevItem.liveText !== currItem.liveText);
  const stateChanged = Boolean(prevItem.stateLabel && currItem.stateLabel && prevItem.stateLabel !== currItem.stateLabel);
  const changed = numericChanged || textChanged || dialDelta !== 0 || stateChanged || histChanged || alignedChanged;

  if (!changed) return null;

  const arrow = numericChanged
    ? (rawDiff > 0 ? '▲' : '▼')
    : (dialDelta > 0 ? '▲' : dialDelta < 0 ? '▼' : (histChanged ? (histDiff > 0 ? '▲' : '▼') : ''));

  const tickDeltaText = numericChanged
    ? formatSignedDeltaValue(rawDiff, currItem.unit || '', Boolean(currItem.thresholdIsPrice))
    : (dialDelta !== 0
        ? `${dialDelta > 0 ? '+' : ''}${dialDelta}%`
        : (histChanged ? formatHistNumber(histDiff) : ''));

  const zone = currItem.dialZone || 'watching';
  let direction = 'steady';
  let toneClass = 'text-accent';
  let flashBgClass = 'bg-accent/15 ring-1 ring-accent/40';

  if (zone === 'blocked' || (currDial > 115 && dialDelta > 0)) {
    direction = 'over';
    toneClass = 'text-red';
    flashBgClass = 'bg-red/15 ring-1 ring-red/40';
  } else if (zone === 'crossed_stale' || (zone === 'stale' && dialDelta > 0)) {
    direction = 'over';
    toneClass = 'text-amber';
    flashBgClass = 'bg-amber/15 ring-1 ring-amber/40';
  } else if (dialDelta > 0 || (numericChanged && currDial >= prevDial) || (histChanged && currItem.macdFilter?.aligned)) {
    direction = 'toward';
    toneClass = 'text-green';
    flashBgClass = 'bg-green/15 ring-1 ring-green/40';
  } else if (dialDelta < 0 || (numericChanged && currDial < prevDial) || (histChanged && !currItem.macdFilter?.aligned)) {
    direction = 'away';
    toneClass = 'text-amber';
    flashBgClass = 'bg-amber/15 ring-1 ring-amber/40';
  }

  return {
    changed: true,
    numericChanged,
    stateChanged,
    histChanged,
    histDiff,
    histArrow: histChanged ? (histDiff > 0 ? '▲' : '▼') : '',
    histDeltaText: histChanged ? formatHistNumber(histDiff) : '',
    alignedChanged,
    direction,
    arrow,
    rawDiff,
    dialDelta,
    tickDeltaText,
    toneClass,
    flashBgClass,
  };
}

/**
 * Builds a pure, memoizable Capitalize.ai-style condition tree for either
 * Exit Monitoring (when an active position exists for the candidate) or Entry Readiness.
 */
export function buildCandidateConditionsModel({
  opp,
  strategyConfig = {},
  activeTrade = null,
  closedTrades = [],
  isPaused = false,
  gateState = 'ACTIVE',
  gateReason = '',
  lastScanTs = 0,
  nowMs = Date.now(),
  tradingMode = null,
}) {
  const effectiveMode = resolveTradingMode(strategyConfig, tradingMode);
  const effectiveModeLabel = formatTradingModeLabel(effectiveMode);
  const symbol = activeTrade?.symbol || opp?.symbol || '---';
  const scanTf = strategyConfig.scan_interval || '5m';
  const dirRaw = activeTrade?.direction || opp?.dir || opp?.direction || (opp?.pct !== undefined ? (opp.pct >= 0 ? 'LONG' : 'SHORT') : '---');
  const dir = typeof dirRaw === 'string' && dirRaw !== '---' ? dirRaw.toUpperCase() : '---';
  const isLong = dir !== 'SHORT';
  const markPrice = Number(activeTrade?.current_price || activeTrade?.mark_price || opp?.close || opp?.price || 0);

  if (activeTrade) {
    const tradeCfg = { ...strategyConfig, ...(activeTrade.strategy_config || {}) };
    const exitLogic = (tradeCfg.exit_signal_logic || 'any').toLowerCase();
    const requiredExit = tradeCfg.required_exit_signals || [];
    const configuredExits = Array.isArray(tradeCfg.exit_signals) ? tradeCfg.exit_signals : [];
    const exitStatusMap = activeTrade.exit_signals_status || {};
    const exitEst = activeTrade.exit_estimation || null;
    const estMap = exitEst?.signalEstimations || {};

    const entryPrice = Number(activeTrade.entry_price || 0);
    const slPrice = Number(activeTrade.current_sl || activeTrade.sl_price || activeTrade.initial_sl || 0);
    const tpPrice = Number(activeTrade.tp_price || 0);
    const qty = Number(activeTrade.qty || activeTrade.remaining_qty || 0);
    const riskUsdt = Number(activeTrade.initial_risk_usdt || activeTrade.risk_usdt || 0);
    const slDist = Math.abs(entryPrice - slPrice);
    const livePnl = Number(activeTrade.pnl ?? (entryPrice > 0 && markPrice > 0 && qty > 0 ? (markPrice - entryPrice) * qty * (isLong ? 1 : -1) : 0));
    const currentR = riskUsdt > 0 ? livePnl / riskUsdt : (slDist > 0 && markPrice > 0 ? ((markPrice - entryPrice) * (isLong ? 1 : -1)) / slDist : 0);

    let roomToSlR = null;
    if (markPrice > 0 && slPrice > 0 && slDist > 0) {
      roomToSlR = (isLong ? (markPrice - slPrice) : (slPrice - markPrice)) / slDist;
    }
    let roomToTpR = null;
    if (markPrice > 0 && tpPrice > 0 && slDist > 0) {
      roomToTpR = (isLong ? (tpPrice - markPrice) : (markPrice - tpPrice)) / slDist;
    }

    // Visual price runway positions (SL -> Entry -> Live -> TP) scaled strictly linearly in favorable R space
    let positionRunway = null;
    if (entryPrice > 0 && slPrice > 0 && markPrice > 0) {
      const initialSlPrice = Number(activeTrade.initial_sl || 0);
      const initialSlDist = initialSlPrice > 0 ? Math.abs(entryPrice - initialSlPrice) : 0;
      const riskUnitPrice = (riskUsdt > 0 && qty > 0)
        ? (riskUsdt / qty)
        : (initialSlDist > 1e-12 ? initialSlDist : slDist);
      const safeRiskUnit = riskUnitPrice > 1e-12 ? riskUnitPrice : (entryPrice * 0.01);
      const targetR = tpPrice > 0
        ? Math.max(0.5, Math.abs(tpPrice - entryPrice) / safeRiskUnit)
        : Number(tradeCfg.tp_ratio || 2.0);
      const slR = (isLong ? (slPrice - entryPrice) : (entryPrice - slPrice)) / safeRiskUnit;
      const minR = Math.min(-1.1, slR - 0.15, currentR < -1 ? currentR - 0.15 : -1.1);
      const maxR = Math.max(targetR * 1.08, currentR + 0.25, 2.0);
      const span = Math.max(1, maxR - minR);
      const rawToPct = (rVal) => ((rVal - minR) / span) * 100;
      const toPct = (rVal) => Math.max(1, Math.min(99, Math.round(rawToPct(rVal) * 10) / 10));
      const rawLivePct = rawToPct(currentR);
      positionRunway = {
        slPct: toPct(slR),
        entryPct: toPct(0),
        livePct: toPct(currentR),
        tpPct: tpPrice > 0 ? toPct(targetR) : null,
        minR,
        maxR,
        slR,
        currentR,
        targetR,
        liveOffLeft: rawLivePct < 0,
        liveOffRight: rawLivePct > 100,
        rTicks: buildRunwayRTicks(minR, maxR, toPct),
      };
    }

    const keys = configuredExits.length > 0 ? configuredExits : Object.keys(exitStatusMap);
    const exitConditions = keys.map((sigKey, idx) => {
      const s = exitStatusMap[sigKey] || {};
      const est = estMap[sigKey] || null;
      const summary = getSignalParamsSummary(tradeCfg, sigKey, 'exit');
      const rawTf = tradeCfg.signal_timeframes?.[sigKey];
      const fallbackTf = (!rawTf || rawTf === 'default') ? (tradeCfg.scan_interval || scanTf) : rawTf;
      const tf = asText(summary?.timeframe, fallbackTf) || fallbackTf;
      const paramsText = asText(summary, 'Standard') || 'Standard';
      const closeConfirm = buildCloseConfirmationModel({
        sigKey,
        signalDetail: s,
        timeframe: tf,
        isLong,
        isExit: true,
        nowMs,
      });

      const rawEffectiveExitValue = (s.live_price !== undefined && s.live_price !== null && Number.isFinite(Number(s.live_price)))
        ? Number(s.live_price)
        : s.value;
      const effectiveExitValue = closeConfirm && (s.fired || closeConfirm.closedAligned) && closeConfirm.closedVal !== null
        ? closeConfirm.closedVal
        : rawEffectiveExitValue;
      const effectiveExitThreshold = closeConfirm && (s.fired || closeConfirm.closedAligned) && closeConfirm.closedTarget !== null
        ? closeConfirm.closedTarget
        : (closeConfirm?.liveTarget ?? s.threshold);

      let proximity = (est && typeof est.proximity === 'number')
        ? Math.round(est.proximity)
        : Math.round(calculateProximity({ ...s, value: effectiveExitValue, threshold: effectiveExitThreshold, key: sigKey }, markPrice, entryPrice, isLong, true));

      const isTriggered = Boolean((s.fired && s.active) || est?.state === 'fired');
      const isBlockedExit = Boolean(s.rejected || s.status === 'blocked' || est?.state === 'blocked');
      const isDelayed = Number(s.remaining_delay || 0) > 0 && !isTriggered;
      const isCloseWaitPending = Boolean(
        closeConfirm && !s.insufficientData && !isTriggered && !s.fired && !closeConfirm.rejected && closeConfirm.state === 'wait_close'
      );
      const exitValNum = Number(effectiveExitValue);
      const exitThrNum = Number(effectiveExitThreshold);
      const isCrossoverOnPassedSide = Boolean(
        isCrossoverEventSignal(sigKey, s) &&
        !s.fired &&
        !isBlockedExit &&
        !s.insufficientData &&
        !isCloseWaitPending &&
        Number.isFinite(exitValNum) &&
        Number.isFinite(exitThrNum) &&
        (isLong ? exitValNum < exitThrNum : exitValNum > exitThrNum)
      );
      const isAlreadyCrossed = Boolean(
        !s.insufficientData &&
        !isTriggered &&
        !s.fired &&
        !isBlockedExit &&
        !isCloseWaitPending &&
        (s.status === 'stale' || est?.state === 'stale' || isCrossoverOnPassedSide)
      );
      if (isAlreadyCrossed) {
        proximity = 0;
      } else if (isCloseWaitPending) {
        proximity = Math.min(98, Math.max(88, proximity));
      }

      let stateLabel = 'WATCHING';
      let tone = 'neutral';
      if (s.insufficientData) {
        stateLabel = 'WARMING';
        tone = 'warning';
      } else if (isTriggered) {
        stateLabel = 'TRIGGERED';
        tone = 'danger';
      } else if (isBlockedExit) {
        stateLabel = 'BLOCKED';
        tone = 'danger';
      } else if (isAlreadyCrossed) {
        stateLabel = 'ALREADY CROSSED';
        tone = 'warning';
      } else if (isCloseWaitPending) {
        stateLabel = 'WAIT CLOSE';
        tone = 'accent';
      } else if (est?.state === 'diverging') {
        stateLabel = 'DIVERGING';
        tone = 'dim';
      } else if (isDelayed) {
        stateLabel = `DELAY ${Math.ceil(s.remaining_delay)}s`;
        tone = 'warning';
      } else if (s.fired || est?.state === 'ready' || proximity >= 99) {
        stateLabel = 'READY';
        tone = 'warning';
      } else if (proximity >= 75) {
        stateLabel = 'NEAR';
        tone = 'accent';
      }

      const exitRefSpanPct = entryPrice > 0 && slDist > 0
        ? (slDist / entryPrice) * 100
        : (Number(tradeCfg.sl_distance_pct) || 1.5);
      let meter = computeConditionMeter({
        value: effectiveExitValue,
        threshold: effectiveExitThreshold,
        thresholdIsPrice: Boolean(s.threshold_is_price || s.thresholdIsPrice),
        unit: s.unit || '',
        isLong,
        isExit: true,
        fired: Boolean(s.fired),
        active: s.active !== false,
        rejected: isBlockedExit,
        alreadyCrossed: isAlreadyCrossed,
        insufficientData: Boolean(s.insufficientData),
        signalKey: sigKey,
        proximity,
        isIndicatorPair: sigKey.includes('dual') || sigKey.includes('_cross'),
        referenceSpanPct: exitRefSpanPct,
      });

      if (isCloseWaitPending) {
        const clampedPre = Math.min(98, Math.max(88, Math.round(meter.dialPct >= 100 ? 98 : meter.dialPct)));
        meter = {
          ...meter,
          dialPct: clampedPre,
          rawDialPct: clampedPre,
          meterFillPct: Math.min(49, Math.max(42, Number(meter.meterFillPct) || 46)),
          dialZone: 'near',
          dialStatus: 'Wait Close',
          dialOverText: 'Crossed · wait close',
          meterState: 'approaching',
        };
      }

      const connector = idx === 0
        ? 'IF'
        : (exitLogic === 'all'
            ? 'AND'
            : (exitLogic === 'combo'
                ? (requiredExit.includes(sigKey) ? 'REQ' : 'OPT')
                : 'OR'));

      const macdFilter = buildMacdFilterModel({
        sigKey,
        signalDetail: s,
        strategyConfig: tradeCfg,
        isLong,
        isExit: true,
      });
      const engulfingPattern = buildEngulfingPatternModel({
        sigKey,
        signalDetail: s,
        strategyConfig: tradeCfg,
        isLong,
        isExit: true,
      });

      return {
        key: sigKey,
        connector,
        visualization: 'dial',
        label: asText(s.label, formatSignalLabel(sigKey)),
        timeframe: tf,
        paramsText,
        closeConfirm,
        macdFilter,
        engulfingPattern,
        liveValue: !s.insufficientData && Number.isFinite(Number(effectiveExitValue)) ? Number(effectiveExitValue) : null,
        targetValue: Number.isFinite(Number(effectiveExitThreshold)) ? Number(effectiveExitThreshold) : null,
        unit: s.unit || '',
        thresholdIsPrice: Boolean(s.threshold_is_price || s.thresholdIsPrice),
        liveText: s.insufficientData ? '---' : formatCompactValue(effectiveExitValue, s.unit, s.threshold_is_price),
        targetText: formatCompactValue(effectiveExitThreshold, s.unit, s.threshold_is_price),
        proximity,
        alreadyCrossed: isAlreadyCrossed,
        ...meter,
        etaCandles: est?.etaCandles ?? null,
        estimatedPnl: est?.estimatedPnl ?? est?.est_pnl ?? null,
        estimatedR: est?.estimatedR ?? est?.risk_reward ?? null,
        stateLabel,
        tone,
        description: asText(est?.description || s.description, ''),
        evaluatedAtMs: s.evaluated_at_ms
          ? Number(s.evaluated_at_ms)
          : (activeTrade.exit_signals_status_ts
              ? new Date(activeTrade.exit_signals_status_ts).getTime()
              : (Number(lastScanTs) > 0 ? Number(lastScanTs) : undefined)),
      };
    });

    const compositeProximity = (exitEst && typeof exitEst.proximity === 'number')
      ? Math.round(exitEst.proximity)
      : (exitConditions.length === 0
          ? 0
          : exitLogic === 'all'
            ? Math.min(...exitConditions.map(c => c.proximity))
            : Math.max(...exitConditions.map(c => c.proximity)));

    const compositeDialPct = exitConditions.length === 0
      ? compositeProximity
      : exitLogic === 'all'
        ? Math.min(...exitConditions.map(c => Number(c.dialPct) || 0))
        : exitLogic === 'combo'
          ? (() => {
              const reqItems = exitConditions.filter(c => c.connector === 'REQ' || requiredExit.includes(c.key));
              const optItems = exitConditions.filter(c => !reqItems.includes(c));
              const reqMin = reqItems.length > 0 ? Math.min(...reqItems.map(c => Number(c.dialPct) || 0)) : 150;
              const optMax = optItems.length > 0 ? Math.max(...optItems.map(c => Number(c.dialPct) || 0)) : reqMin;
              return Math.min(reqMin, optMax);
            })()
          : Math.max(...exitConditions.map(c => Number(c.dialPct) || 0));
    const firedConditionsCount = exitConditions.filter(c => !c.alreadyCrossed && (Number(c.dialPct) || 0) >= 100 && c.stateLabel !== 'BLOCKED').length;
    const exitBlockedByAlreadyCrossed = exitConditions.length > 0 && (
      exitLogic === 'all'
        ? exitConditions.some(c => c.alreadyCrossed)
        : exitLogic === 'combo'
          ? (() => {
              const reqItems = exitConditions.filter(c => c.connector === 'REQ' || requiredExit.includes(c.key));
              const optItems = exitConditions.filter(c => !reqItems.includes(c));
              return reqItems.some(c => c.alreadyCrossed) || (optItems.length > 0 && !optItems.some(c => !c.alreadyCrossed && (Number(c.dialPct) || 0) >= 100) && optItems.every(c => c.alreadyCrossed));
            })()
          : exitConditions.every(c => c.alreadyCrossed)
    );
    const hasWarmingExit = exitConditions.some(c => c.stateLabel === 'WARMING');
    const hasBlockedExit = exitConditions.some(c => c.stateLabel === 'BLOCKED');
    const compositeDial = (exitBlockedByAlreadyCrossed && firedConditionsCount === 0 && !hasWarmingExit && !hasBlockedExit)
      ? { dialZone: 'crossed_stale', dialStatus: 'Already Crossed', dialOverText: 'Crossed · needs reset', isOffScale: false }
      : resolveDialZone(compositeDialPct, { insufficientData: hasWarmingExit, rejected: hasBlockedExit });

    const isProtected = isLong
      ? (slPrice >= entryPrice && entryPrice > 0)
      : (slPrice > 0 && entryPrice > 0 && slPrice <= entryPrice);

    const initialSlPrice = Number(activeTrade.initial_sl || slPrice || 0);
    const initialSlDist = Math.abs(entryPrice - initialSlPrice);
    const slDistPct = entryPrice > 0 && slPrice > 0 ? ((slPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1) : 0;
    const initialSlDistPct = entryPrice > 0 && initialSlPrice > 0 ? (Math.abs(entryPrice - initialSlPrice) / entryPrice) * 100 : 0;
    const livePnlPct = activeTrade.pnl_pct !== undefined && activeTrade.pnl_pct !== null && Number.isFinite(Number(activeTrade.pnl_pct))
      ? Number(activeTrade.pnl_pct)
      : (entryPrice > 0 && markPrice > 0 ? ((markPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1) : 0);
    const targetR = tpPrice > 0 && (initialSlDist || slDist) > 0
      ? Math.max(0.5, Math.abs(tpPrice - entryPrice) / (initialSlDist || slDist))
      : Number(tradeCfg.tp_ratio || 2.0);
    const tpDistPct = entryPrice > 0 && tpPrice > 0
      ? (Math.abs(tpPrice - entryPrice) / entryPrice) * 100
      : initialSlDistPct * targetR;

    return {
      mode: 'in_position',
      symbol,
      dir,
      markPrice,
      logicLabel: exitLogic.toUpperCase(),
      compositeProximity,
      compositeDialPct,
      firedConditionsCount,
      totalConditionsCount: exitConditions.length,
      compositeDial,
      overallStatus: activeTrade.close_blocked ? 'CLOSE BLOCKED' : (exitEst?.state === 'fired' ? 'EXIT TRIGGERED' : 'IN POSITION'),
      overallTone: activeTrade.close_blocked || exitEst?.state === 'fired' ? 'danger' : 'positive',
      positionMeta: {
        entryPrice,
        slPrice,
        initialSlPrice,
        tpPrice,
        livePnl,
        livePnlPct,
        slDistPct,
        initialSlDistPct,
        tpDistPct,
        targetR,
        currentR,
        roomToSlR,
        roomToTpR,
        positionRunway,
        isProtected,
        tpMode: tradeCfg.tp_mode || 'fixed',
        tpRatio: tradeCfg.tp_ratio || 2.0,
        trailingEnabled: Boolean(tradeCfg.trailing_stop_enabled || activeTrade.is_knife),
        trailingActive: Boolean(activeTrade.trailing_active),
        etaCandles: exitEst?.etaCandles ?? null,
        estimatedPnl: exitEst?.estimatedPnl ?? null,
      },
      conditions: exitConditions,
      antiWhipsaw: null,
      tradingMode: effectiveMode,
      tradingModeLabel: effectiveModeLabel,
      actionSummary: tpPrice > 0
        ? `EXIT AT ${exitConditions.length > 0 ? `${exitLogic.toUpperCase()} signal / ` : ''}TP ${fmtPrice(tpPrice)} or SL ${fmtPrice(slPrice)}`
        : `EXIT AT ${exitConditions.length > 0 ? `${exitLogic.toUpperCase()} signal or ` : ''}SL ${fmtPrice(slPrice)}`,
    };
  }

  // Searching / Entry Candidate evaluation
  const scanThreshold = Number(strategyConfig.scan_pct_threshold ?? 2.0);
  const scanLookback = Number(strategyConfig.scan_lookback ?? 3);
  const rawPct = Number(opp?.pct || 0);
  const movePct = Math.abs(rawPct);
  const velocityPassed = symbol !== '---' && movePct >= scanThreshold;
  const velocityProximity = scanThreshold > 0 ? Math.min(100, Math.round((movePct / scanThreshold) * 100)) : (velocityPassed ? 100 : 0);

  const allowedSide = (strategyConfig.entry_side || 'both').toLowerCase();
  const sideMatched = dir === '---' || allowedSide === 'both' || allowedSide === dir.toLowerCase();

  const signalLogic = (strategyConfig.signal_logic || 'all').toLowerCase();
  const requiredSignals = strategyConfig.required_signals || [];
  const enabledSignals = Array.isArray(strategyConfig.enabled_signals) ? strategyConfig.enabled_signals : [];
  const signalDetails = opp?.signalResult?.signals || {};

  const velocityMeter = computeConditionMeter({
    value: symbol === '---' ? NaN : movePct,
    threshold: scanThreshold,
    thresholdIsPrice: false,
    unit: '%',
    isLong: true,
    isExit: false,
    fired: velocityPassed,
    active: sideMatched,
    rejected: !sideMatched,
    insufficientData: false,
    signalKey: '__velocity__',
    proximity: velocityProximity,
  });

  const signedPctText = symbol === '---'
    ? '---'
    : `${rawPct > 0 ? '+' : rawPct < 0 ? '-' : ''}${movePct.toFixed(2)}%`;

  const liveEvalTs = !opp?.isEntrySnapshot
    ? (Math.max(Number(opp?.lastUpdate || 0), Number(lastScanTs || 0)) || undefined)
    : undefined;

  const scannerCondition = {
    key: '__velocity__',
    connector: 'GATE',
    isScannerGate: true,
    label: 'Scanner',
    timeframe: scanTf,
    paramsText: `±${scanThreshold.toFixed(2)}% · ${scanLookback}b · ${allowedSide.toUpperCase()}`,
    liveValue: symbol === '---' ? null : rawPct,
    targetValue: scanThreshold,
    unit: '%',
    thresholdIsPrice: false,
    liveText: signedPctText,
    targetText: `±${scanThreshold.toFixed(2)}%`,
    proximity: velocityProximity,
    ...velocityMeter,
    stateLabel: symbol === '---' ? 'IDLE' : !sideMatched ? 'SIDE MISMATCH' : velocityPassed ? 'PASS' : 'WATCHING',
    tone: !sideMatched ? 'danger' : velocityPassed ? 'positive' : velocityProximity >= 75 ? 'accent' : 'neutral',
    description: '',
    evaluatedAtMs: opp?.isEntrySnapshot ? opp?.snapshotCapturedAt : liveEvalTs,
  };

  const signalConditionItems = enabledSignals.map((sigKey) => {
    const s = signalDetails[sigKey] || {};
    const baseType = getBaseSignalType(sigKey);
    const isHtfBreakout = baseType === 'htf_breakout' || baseType === 'prev_day_breakout';
    const summary = getSignalParamsSummary(strategyConfig, sigKey, 'entry');
    const rawTf = strategyConfig.signal_timeframes?.[sigKey];
    const fallbackTf = (!rawTf || rawTf === 'default') ? scanTf : rawTf;
    const tf = asText(summary?.timeframe, fallbackTf) || fallbackTf;
    const paramsText = asText(summary, 'Standard') || 'Standard';
    const isIndicatorPair = sigKey.includes('dual') || sigKey.includes('_cross');

    const ladder = isHtfBreakout
      ? buildHtfLadderModel({
          sigKey,
          signalDetail: s,
          opp,
          strategyConfig,
          markPrice,
          isLong,
          isExit: false,
          nowMs,
        })
      : null;

    const closeConfirm = buildCloseConfirmationModel({
      sigKey,
      signalDetail: s,
      timeframe: tf,
      isLong,
      isExit: false,
      nowMs,
    });

    const rawEffectiveValue = (s.live_price !== undefined && s.live_price !== null && Number.isFinite(Number(s.live_price)))
      ? Number(s.live_price)
      : (s.value !== undefined && s.value !== null
          ? s.value
          : (ladder ? ladder.livePrice : undefined));
    const effectiveValue = closeConfirm && (s.fired || closeConfirm.closedAligned) && closeConfirm.closedVal !== null
      ? closeConfirm.closedVal
      : rawEffectiveValue;
    const rawEffectiveThreshold = s.threshold !== undefined && s.threshold !== null
      ? s.threshold
      : (ladder ? ladder.breakoutLevel : undefined);
    const effectiveThreshold = closeConfirm && (s.fired || closeConfirm.closedAligned) && closeConfirm.closedTarget !== null
      ? closeConfirm.closedTarget
      : (closeConfirm?.liveTarget ?? rawEffectiveThreshold);
    const effectiveThresholdIsPrice = Boolean(s.threshold_is_price || s.thresholdIsPrice || isHtfBreakout);

    let prox = Math.round(calculateProximity(
      { ...s, key: sigKey, value: effectiveValue, threshold: effectiveThreshold, threshold_is_price: effectiveThresholdIsPrice },
      effectiveValue ?? markPrice,
      0,
      isLong,
      false
    ));
    const isWarming = Boolean(s.insufficientData);
    const isRejected = Boolean(s.rejected || s.status === 'blocked' || ladder?.isOverCap);
    const isPassed = Boolean(
      !isRejected && (
        s.fired ||
        (ladder && ladder.distFromLevelPct >= 0 && (ladder.mode !== 'closed_candle_confirm' || ladder.candleConfirmState === 'closed_beyond'))
      )
    );
    const isCloseWaitPending = Boolean(
      closeConfirm && !isWarming && !isRejected && !isPassed && closeConfirm.state === 'wait_close'
    );
    const entryValNum = Number(effectiveValue);
    const entryThrNum = Number(effectiveThreshold);
    const isCrossoverOnPassedSide = Boolean(
      isCrossoverEventSignal(sigKey, s) &&
      !isPassed &&
      !isRejected &&
      !isWarming &&
      !ladder &&
      !isCloseWaitPending &&
      Number.isFinite(entryValNum) &&
      Number.isFinite(entryThrNum) &&
      (isLong ? entryValNum > entryThrNum : entryValNum < entryThrNum)
    );
    const isAlreadyCrossed = Boolean(
      symbol !== '---' &&
      !isWarming &&
      !isRejected &&
      !isPassed &&
      !ladder &&
      !isCloseWaitPending &&
      (s.status === 'stale' || isCrossoverOnPassedSide)
    );

    if (!isAlreadyCrossed && !isPassed && !isWarming && !isRejected && !isIndicatorPair && effectiveThresholdIsPrice) {
      const vNum = Number(effectiveValue ?? markPrice);
      const tNum = Number(effectiveThreshold);
      if (Number.isFinite(vNum) && Number.isFinite(tNum) && tNum > 0) {
        const distRatio = Math.abs(vNum - tNum) / tNum;
        const scaledProx = Math.round(99 / (1 + 35 * distRatio));
        prox = Math.max(0, Math.min(99, scaledProx));
      }
    }
    if (isAlreadyCrossed) {
      prox = 0;
    } else if (isCloseWaitPending) {
      prox = Math.min(98, Math.max(88, prox));
    }

    let stateLabel = 'WATCHING';
    let tone = 'neutral';
    if (symbol === '---') {
      stateLabel = 'IDLE';
    } else if (isWarming) {
      stateLabel = 'WARMING';
      tone = 'warning';
    } else if (isRejected) {
      stateLabel = 'REJECTED';
      tone = 'danger';
    } else if (isPassed) {
      stateLabel = 'PASS';
      tone = 'positive';
    } else if (isAlreadyCrossed) {
      stateLabel = 'ALREADY CROSSED';
      tone = 'warning';
    } else if (isCloseWaitPending) {
      stateLabel = 'WAIT CLOSE';
      tone = 'accent';
    } else if (ladder?.candleConfirmState === 'wicked_only' || prox >= 80) {
      stateLabel = 'NEAR';
      tone = 'accent';
    }

    let meter = computeConditionMeter({
      value: effectiveValue,
      threshold: effectiveThreshold,
      thresholdIsPrice: effectiveThresholdIsPrice,
      unit: s.unit || '',
      isLong,
      isExit: false,
      fired: isPassed,
      active: s.active !== false,
      rejected: isRejected,
      alreadyCrossed: isAlreadyCrossed,
      insufficientData: isWarming,
      signalKey: sigKey,
      proximity: prox,
      isIndicatorPair,
      referenceSpanPct: Number(opp?.sl_dist_pct) > 0
        ? Number(opp.sl_dist_pct)
        : (Number(strategyConfig.sl_distance_pct) || 1.5),
    });

    if (isCloseWaitPending) {
      const clampedPre = Math.min(98, Math.max(88, Math.round(meter.dialPct >= 100 ? 98 : meter.dialPct)));
      meter = {
        ...meter,
        dialPct: clampedPre,
        rawDialPct: clampedPre,
        meterFillPct: Math.min(49, Math.max(42, Number(meter.meterFillPct) || 46)),
        dialZone: 'near',
        dialStatus: 'Wait Close',
        dialOverText: 'Crossed · wait close',
        meterState: 'approaching',
      };
    }

    if (ladder && !isWarming) {
      const absDist = Math.abs(ladder.distFromLevelPct);
      const distFormatted = absDist >= 10 ? absDist.toFixed(1) : absDist.toFixed(2);
      const signPrefix = ladder.distFromLevelPct >= 0 ? '+' : '-';
      const ladderOverText = isRejected
        ? `${signPrefix}${distFormatted}% · ${ladder.slRejected ? 'SL > max' : 'over cap'}`
        : ladder.distFromLevelPct >= 0
          ? (ladder.candleConfirmState === 'wicked_only' && ladder.mode === 'closed_candle_confirm'
              ? `Wicked +${distFormatted}%`
              : `+${distFormatted}% past`)
          : `-${distFormatted}% to lvl`;
      meter = {
        ...meter,
        dialPct: ladder.dialPct,
        rawDialPct: ladder.rawDialPct,
        dialZone: isRejected ? 'blocked' : (ladder.zone === 'below' ? 'watching' : ladder.zone),
        dialStatus: ladder.zoneLabel,
        dialOverText: ladderOverText,
      };
    }

    const connector = signalLogic === 'any'
      ? 'OR'
      : (signalLogic === 'combo'
          ? (requiredSignals.includes(sigKey) ? 'REQ' : 'OPT')
          : 'AND');

    const macdFilter = buildMacdFilterModel({
      sigKey,
      signalDetail: s,
      strategyConfig,
      isLong,
      isExit: false,
    });
    const engulfingPattern = buildEngulfingPatternModel({
      sigKey,
      signalDetail: s,
      strategyConfig,
      isLong,
      isExit: false,
    });

    return {
      key: sigKey,
      connector,
      visualization: ladder ? 'ladder' : 'dial',
      ladder,
      closeConfirm,
      macdFilter,
      engulfingPattern,
      label: asText(s.label, formatSignalLabel(sigKey)),
      timeframe: tf,
      paramsText,
      liveValue: !isWarming && Number.isFinite(Number(effectiveValue)) ? Number(effectiveValue) : null,
      targetValue: Number.isFinite(Number(effectiveThreshold)) ? Number(effectiveThreshold) : null,
      unit: s.unit || '',
      thresholdIsPrice: effectiveThresholdIsPrice,
      liveText: isWarming ? '---' : formatCompactValue(effectiveValue, s.unit, effectiveThresholdIsPrice),
      targetText: formatCompactValue(effectiveThreshold, s.unit, effectiveThresholdIsPrice),
      proximity: prox,
      alreadyCrossed: isAlreadyCrossed,
      ...meter,
      stateLabel,
      tone,
      description: asText(s.description, ''),
      evaluatedAtMs: opp?.isEntrySnapshot
        ? (s.evaluated_at_ms || opp?.snapshotCapturedAt)
        : (Math.max(Number(s.evaluated_at_ms || 0), Number(liveEvalTs || 0)) || undefined),
    };
  });

  // Pre-trade SL Check & Cap gate condition widget (evaluated consistently for every strategy)
  const htfSignalDetail = signalDetails.htf_breakout || signalDetails.prev_day_breakout || null;
  const slCheck = evaluateSlCheck({
    opp,
    strategyConfig,
    livePrice: markPrice,
    isLong,
    isExit: false,
    signalDetail: htfSignalDetail,
    refHigh: htfSignalDetail?.ref_high,
    refLow: htfSignalDetail?.ref_low,
  });

  const slUsedRound = Math.round(slCheck.slCapUsedPct);
  const slRatioMax = pickNiceRatioMax(Math.max(150, slUsedRound));
  const slRoomAbs = Math.abs(slCheck.slCapRoomPct);
  const slRoomFmt = slRoomAbs >= 10 ? slRoomAbs.toFixed(1) : slRoomAbs.toFixed(2);
  const slCapLeftPct = Math.max(0, 100 - slUsedRound);

  const slTfLabel = slCheck.slType === 'lookback_low/high'
    ? slCheck.slLookbackTf
    : (slCheck.slType === 'engulfing_boundary'
        ? (strategyConfig.signal_timeframes?.engulfing || scanTf)
        : slCheck.slType === 'supertrend'
          ? (strategyConfig.signal_timeframes?.supertrend || scanTf)
          : scanTf);
  const slTypeShort = slCheck.slType === 'lookback_low/high'
    ? `${slCheck.slLookbackPeriod}b lookback`
    : slCheck.slType === 'pct'
      ? 'Fixed'
      : slCheck.slType.replace(/_/g, ' ');

  const slDialZone = symbol === '---'
    ? 'watching'
    : (slCheck.slRejected
        ? 'blocked'
        : (slCheck.slClamped || slCheck.slWidened ? 'warming' : 'fresh'));
  const slStateLabel = symbol === '---'
    ? 'IDLE'
    : (slCheck.slRejected
        ? 'REJECTED'
        : (slCheck.slClamped
            ? 'CLAMPED'
            : (slCheck.slWidened ? 'WIDENED' : 'PASS')));
  const slTone = symbol === '---'
    ? 'neutral'
    : (slCheck.slRejected
        ? 'danger'
        : (slCheck.slClamped || slCheck.slWidened ? 'warning' : 'positive'));

  const isFixedSl = !slCheck.applyStructuralBounds;
  const slCondition = {
    key: '__sl_check__',
    connector: 'GATE',
    isSlGate: true,
    visualization: 'dial',
    label: 'SL Check',
    timeframe: slTfLabel,
    paramsText: isFixedSl ? `${slTypeShort} · ${slCheck.slDistPct.toFixed(2)}%` : `${slTypeShort} · ${slCheck.slOobAction}`,
    liveValue: symbol === '---' ? null : slCheck.slDistPct,
    targetValue: isFixedSl ? slCheck.slDistPct : slCheck.slMaxPct,
    unit: '%',
    thresholdIsPrice: false,
    liveText: symbol === '---' ? '---' : `${slCheck.slDistPct.toFixed(2)}%`,
    targetText: isFixedSl ? 'Fixed SL' : `${slCheck.slMaxPct.toFixed(2)}% max`,
    proximity: symbol === '---' ? 0 : (isFixedSl ? 100 : Math.min(100, slUsedRound)),
    dialPct: symbol === '---' ? 0 : (isFixedSl ? 100 : Math.min(150, Math.max(0, slUsedRound))),
    rawDialPct: symbol === '---' ? 0 : (isFixedSl ? 100 : slUsedRound),
    meterFillPct: symbol === '---' ? 0 : (isFixedSl ? 100 : Math.min(100, Math.round((slUsedRound / slRatioMax) * 100))),
    dialZone: isFixedSl ? (symbol === '---' ? 'watching' : 'fresh') : slDialZone,
    dialStatus: isFixedSl ? 'Fixed SL' : (slCheck.slRejected ? 'SL Rejected' : slCheck.slClamped ? 'SL Clamped' : slCheck.slWidened ? 'Min SL Floor' : 'SL OK'),
    dialOverText: symbol === '---' ? 'IDLE' : (isFixedSl ? `${slCheck.slDistPct.toFixed(2)}% fixed` : `${slUsedRound}% of max SL`),
    dialScale: isFixedSl
      ? null
      : {
          mode: 'linear_ratio',
          invertTrack: true,
          valuePct: symbol === '---' ? 0 : slUsedRound,
          maxPct: slRatioMax,
          minLabel: '0%',
          targetLabel: 'max',
          maxLabel: `${slRatioMax}%`,
          subText: symbol === '---'
            ? `max ${slCheck.slMaxPct.toFixed(2)}% SL`
            : `${slCheck.slDistPct.toFixed(2)}% / ${slCheck.slMaxPct.toFixed(2)}%`,
          isOffScale: symbol !== '---' && slUsedRound > slRatioMax,
        },
    deltaLabel: isFixedSl ? 'Mode' : (symbol === '---' ? 'SL Bounds' : (slCheck.slExceedsMax ? 'Over max' : slCheck.slBelowMin ? (slCheck.slRejected ? 'Under min' : 'Floor') : 'Room left')),
    deltaValueText: isFixedSl
      ? 'Fixed % (bounds N/A)'
      : symbol === '---'
        ? `Min ${slCheck.slMinPct.toFixed(2)}% · Max ${slCheck.slMaxPct.toFixed(2)}%`
        : (slCheck.slRejected && slCheck.slBelowMin)
          ? `-${Math.max(0, slCheck.slMinPct - slCheck.slDistPct).toFixed(2)}% under min (${slCheck.slMinPct.toFixed(2)}%)`
          : slCheck.slRejected
            ? `+${slRoomFmt}% over max`
            : slCheck.slClamped
              ? `Clamp → ${slCheck.slMaxPct.toFixed(2)}% (+${slRoomFmt}%)`
              : slCheck.slWidened
                ? `Widen → ${slCheck.slMinPct.toFixed(2)}% min`
                : `${slRoomFmt}% (${slCapLeftPct}% left)`,
    deltaPctText: '',
    stateLabel: isFixedSl ? (symbol === '---' ? 'IDLE' : 'PASS') : slStateLabel,
    tone: isFixedSl ? (symbol === '---' ? 'neutral' : 'positive') : slTone,
    slCheck,
    description: isFixedSl
      ? `Fixed stop-loss ${slCheck.slDistPct.toFixed(2)}%`
      : `Prospective SL ${slCheck.slDistPct.toFixed(2)}% vs bounds [${slCheck.slMinPct.toFixed(2)}%..${slCheck.slMaxPct.toFixed(2)}%] (${slUsedRound}% of max SL · action: ${slCheck.slOobAction.toUpperCase()})`,
    evaluatedAtMs: opp?.isEntrySnapshot ? opp?.snapshotCapturedAt : liveEvalTs,
  };

  // Append SL Check at the end so conditions[0] stays Scanner and conditions[1] stays the first signal
  const entryConditions = [scannerCondition, ...signalConditionItems, slCondition];

  // Evaluate signal gate satisfaction and composite dial strictly by signalLogic (ALL=min, ANY=max, COMBO=min(req, max(opt)))
  const evalPool = signalConditionItems.length > 0 ? signalConditionItems : [scannerCondition];
  const firedConditionsCount = symbol === '---'
    ? 0
    : evalPool.filter(c => c.stateLabel === 'PASS').length;
  const totalConditionsCount = evalPool.length;

  let signalsLogicSatisfied = velocityPassed && sideMatched && !slCheck.slRejected;
  let rawCompositeSignalDial = Number(scannerCondition.dialPct) || 0;

  if (signalConditionItems.length > 0) {
    if (signalLogic === 'any') {
      signalsLogicSatisfied = signalsLogicSatisfied && signalConditionItems.some(c => c.stateLabel === 'PASS');
      rawCompositeSignalDial = Math.max(...signalConditionItems.map(c => Number(c.dialPct) || 0));
    } else if (signalLogic === 'combo') {
      const reqItems = signalConditionItems.filter(c => c.connector === 'REQ' || requiredSignals.includes(c.key));
      const optItems = signalConditionItems.filter(c => !reqItems.includes(c));
      const reqPassed = reqItems.every(c => c.stateLabel === 'PASS');
      const optPassed = optItems.length === 0 || optItems.some(c => c.stateLabel === 'PASS');
      signalsLogicSatisfied = signalsLogicSatisfied && reqPassed && optPassed;
      const reqMin = reqItems.length > 0 ? Math.min(...reqItems.map(c => Number(c.dialPct) || 0)) : 150;
      const optMax = optItems.length > 0 ? Math.max(...optItems.map(c => Number(c.dialPct) || 0)) : reqMin;
      rawCompositeSignalDial = Math.min(reqMin, optMax);
    } else {
      // ALL (AND gate): weakest signal determines composite readiness
      signalsLogicSatisfied = signalsLogicSatisfied && signalConditionItems.every(c => c.stateLabel === 'PASS');
      rawCompositeSignalDial = Math.min(...signalConditionItems.map(c => Number(c.dialPct) || 0));
    }
  }

  const compositeDialPct = symbol === '---'
    ? 0
    : (!velocityPassed
        ? Math.min(Number(scannerCondition.dialPct) || 0, rawCompositeSignalDial)
        : rawCompositeSignalDial);

  const rawAntiWhipsaw = evaluateAntiWhipsawStatus(symbol, strategyConfig, closedTrades, nowMs, effectiveMode);
  const strategyAwLocks = evaluateStrategyAntiWhipsawLocks(strategyConfig, closedTrades, nowMs, effectiveMode);
  const antiWhipsaw = {
    ...rawAntiWhipsaw,
    strategyLocks: strategyAwLocks,
  };
  const compositeProximity = symbol === '---'
    ? 0
    : Math.min(100, Math.max(0, compositeDialPct >= 100 ? 100 : compositeDialPct));

  const anySignalRejected = signalConditionItems.some(c => c.stateLabel === 'REJECTED' || c.stateLabel === 'BLOCKED');
  const blockedBySignals = signalLogic === 'all' && anySignalRejected;
  const blockedByAlreadyCrossed = symbol !== '---' && signalConditionItems.length > 0 && !signalsLogicSatisfied && (
    signalLogic === 'any'
      ? signalConditionItems.every(c => c.alreadyCrossed)
      : signalLogic === 'combo'
        ? (() => {
            const reqItems = signalConditionItems.filter(c => c.connector === 'REQ' || requiredSignals.includes(c.key));
            const optItems = signalConditionItems.filter(c => !reqItems.includes(c));
            return reqItems.some(c => c.alreadyCrossed) || (optItems.length > 0 && !optItems.some(c => c.stateLabel === 'PASS') && optItems.every(c => c.alreadyCrossed));
          })()
        : signalConditionItems.some(c => c.alreadyCrossed)
  );
  const hasWarmingEntry = entryConditions.some(c => c.stateLabel === 'WARMING');
  const entryCompositeRejected = symbol !== '---' && (!sideMatched || slCheck.slRejected || blockedBySignals);
  const normalizedGate = String(gateState || 'ACTIVE').toUpperCase();
  const isGateBlocked = isPaused || (normalizedGate !== 'ACTIVE' && normalizedGate !== 'OK');
  const compositeDial = (symbol !== '---' && !entryCompositeRejected && !hasWarmingEntry && blockedByAlreadyCrossed)
    ? { dialZone: 'crossed_stale', dialStatus: 'Already Crossed', dialOverText: 'Crossed · needs reset', isOffScale: false }
    : (symbol !== '---' && !entryCompositeRejected && !hasWarmingEntry && !isGateBlocked && antiWhipsaw.locked)
      ? { dialZone: 'crossed_stale', dialStatus: 'AW Locked', dialOverText: `${formatDuration(antiWhipsaw.remainingMs)} left`, isOffScale: false }
      : resolveDialZone(compositeDialPct, {
          insufficientData: symbol !== '---' && hasWarmingEntry,
          rejected: entryCompositeRejected,
        });

  let overallStatus = compositeDialPct >= 80
    ? `NEAR · ${compositeProximity}%`
    : `WATCHING · ${compositeProximity}%`;
  let overallTone = compositeDialPct >= 80 ? 'accent' : 'neutral';

  if (symbol === '---') {
    overallStatus = 'NO CANDIDATE';
    overallTone = 'dim';
  } else if (isPaused) {
    overallStatus = 'PAUSED';
    overallTone = 'warning';
  } else if (isGateBlocked) {
    overallStatus = `GATED · ${normalizedGate}`;
    overallTone = 'warning';
  } else if (!sideMatched) {
    overallStatus = 'SIDE FILTERED';
    overallTone = 'dim';
  } else if (antiWhipsaw.locked) {
    overallStatus = `WHIPSAW WAIT · ${formatDuration(antiWhipsaw.remainingMs)}`;
    overallTone = 'warning';
  } else if (hasWarmingEntry) {
    overallStatus = 'WARMING';
    overallTone = 'warning';
  } else if (slCheck.slRejected) {
    overallStatus = 'SL EXCEEDS MAX';
    overallTone = 'danger';
  } else if (blockedBySignals) {
    overallStatus = 'OVER EXPANSION CAP';
    overallTone = 'danger';
  } else if (signalsLogicSatisfied) {
    overallStatus = 'ENTRY READY';
    overallTone = 'positive';
  } else if (blockedByAlreadyCrossed) {
    overallStatus = 'CROSSED · NEEDS RESET';
    overallTone = 'warning';
  }

  const slPct = isFixedSl
    ? `${slCheck.effectiveSlDistPct.toFixed(2)}% SL (Fixed)`
    : symbol === '---'
      ? `${slCheck.slMinPct.toFixed(2)}–${slCheck.slMaxPct.toFixed(2)}% SL`
      : (slCheck.slClamped
          ? `${slCheck.slMaxPct.toFixed(2)}% SL (clamped)`
          : `${slCheck.effectiveSlDistPct.toFixed(2)}% SL (${slUsedRound}% max)`);
  const tpMode = strategyConfig.tp_mode || 'fixed';
  const liveSeq = Array.isArray(strategyConfig.live_rr_sequence)
    ? strategyConfig.live_rr_sequence.map(Number).filter(n => Number.isFinite(n) && n > 0)
    : [];
  const rrTarget = opp?.prospect_rr !== undefined && opp?.prospect_rr !== null
    ? `${opp.prospect_rr}R target`
    : ((tpMode === 'exp_rr_seq' || tpMode === 'exp_rr_seq_switch') && liveSeq.length > 0)
      ? (liveSeq.length > 1
          ? `${Math.min(...liveSeq)}–${Math.max(...liveSeq)}R ladder`
          : `${liveSeq[0]}R ladder`)
      : `${strategyConfig.tp_ratio ?? 2.0}R target`;

  return {
    mode: 'searching',
    tradingMode: effectiveMode,
    tradingModeLabel: effectiveModeLabel,
    symbol,
    dir,
    markPrice,
    logicLabel: signalLogic.toUpperCase(),
    scannerPassed: velocityPassed,
    slCheck,
    compositeProximity,
    compositeDialPct,
    firedConditionsCount,
    totalConditionsCount,
    compositeDial,
    overallStatus,
    overallTone,
    isGateBlocked,
    gateReason: isPaused ? 'Strategy is paused' : (isGateBlocked ? (gateReason || normalizedGate) : ''),
    conditions: entryConditions,
    antiWhipsaw,
    actionSummary: `ENTER ${dir === '---' ? 'POS' : dir} · ${slPct} · ${rrTarget}`,
  };
}
