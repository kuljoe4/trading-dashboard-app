import { price as fmtPrice, calculateProximity, formatDuration } from '../lib/formatters.js';
import { formatSignalLabel, getSignalParamsSummary, resolveSignalParamClient, getBaseSignalType } from './strategyDiagnostics.js';

export function timeframeToMs(tf) {
  if (!tf || typeof tf !== 'string') return 60 * 1000;
  const match = tf.trim().match(/^(\d+)([mhdwM])$/);
  if (!match) return 60 * 1000;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'm') return num * 60 * 1000;
  if (unit === 'h') return num * 60 * 60 * 1000;
  if (unit === 'd') return num * 24 * 60 * 60 * 1000;
  if (unit === 'w') return num * 7 * 24 * 60 * 60 * 1000;
  if (unit === 'M') return num * 30 * 24 * 60 * 60 * 1000;
  return 60 * 1000;
}

export function resolveAntiWhipsawTimeframes(strategyConfig = {}) {
  const explicit = Array.isArray(strategyConfig.anti_whipsaw_timeframes)
    ? strategyConfig.anti_whipsaw_timeframes.map(s => String(s).trim()).filter(Boolean)
    : (typeof strategyConfig.anti_whipsaw_timeframes === 'string'
        ? strategyConfig.anti_whipsaw_timeframes.split(',').map(s => s.trim()).filter(Boolean)
        : []);

  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }

  const out = new Set();
  const scanTf = strategyConfig.scan_interval || '1m';
  out.add(scanTf);

  const maxTf = strategyConfig.anti_whipsaw_max_tf || '4h';
  const maxTfMs = maxTf === 'none' ? Infinity : timeframeToMs(maxTf);
  const enabled = strategyConfig.enabled_signals || [];
  for (let i = 0; i < enabled.length; i++) {
    const tf = strategyConfig.signal_timeframes?.[enabled[i]];
    if (tf && tf !== 'default' && timeframeToMs(tf) <= maxTfMs) {
      out.add(tf);
    }
  }
  return Array.from(out);
}

function toMs(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val < 1e11 ? val * 1000 : val;
  if (val instanceof Date) return val.getTime();
  const parsed = Date.parse(String(val));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Evaluates live Anti-Whipsaw re-entry readiness for a symbol and strategy config
 * using already-synced tradeHistory without triggering any API requests.
 */
export function evaluateAntiWhipsawStatus(symbol, strategyConfig = {}, closedTrades = [], nowMs = Date.now()) {
  const candleDelay = Math.max(0, Number(strategyConfig.anti_whipsaw_candle_delay ?? 1));
  const tfDelayMin = Math.max(0, Number(strategyConfig.anti_whipsaw_tf_delay_min ?? 0));
  const perStrategy = strategyConfig.anti_whipsaw_per_strategy !== false;
  const strategyLabel = strategyConfig.strategy_label || 'Momentum Strategy';
  const timeframes = resolveAntiWhipsawTimeframes(strategyConfig);

  if (candleDelay === 0 && tfDelayMin === 0) {
    return {
      status: 'clear',
      disabled: true,
      locked: false,
      timeframes,
      candleDelay,
      tfDelayMin,
      perStrategy,
      allowKnife: !!strategyConfig.anti_whipsaw_allow_knife,
      remainingMs: 0,
      summary: 'Disabled (0c / 0m)',
    };
  }

  if (!symbol || symbol === '---' || !Array.isArray(closedTrades) || closedTrades.length === 0) {
    return {
      status: 'clear',
      disabled: false,
      locked: false,
      timeframes,
      candleDelay,
      tfDelayMin,
      perStrategy,
      allowKnife: !!strategyConfig.anti_whipsaw_allow_knife,
      remainingMs: 0,
      summary: `Ready (${candleDelay}c${tfDelayMin > 0 ? ` / ${tfDelayMin}m` : ''} on ${timeframes.join(', ')})`,
    };
  }

  const tfDelayMs = tfDelayMin * 60 * 1000;
  let longestRemainingMs = 0;
  let blockingTf = null;
  let blockingReason = '';
  let lastTradeWasKnife = false;

  for (let i = 0; i < closedTrades.length; i++) {
    const t = closedTrades[i];
    if (!t || t.symbol !== symbol) continue;
    const status = t.status;
    if (status === 'ENTRY_FAILED' || status === 'CANCELLED' || status === 'REJECTED' || t.is_reconciliation) continue;
    if (perStrategy && t.strategy_label && t.strategy_label !== strategyLabel) continue;

    const entryTs = toMs(t.entry_ts || t.opened_at || t.created_at);
    const exitTs = toMs(t.exit_ts || t.closed_at);
    const relevantTs = Math.max(entryTs, exitTs);
    if (relevantTs <= 0) continue;

    if (tfDelayMs > 0) {
      const timeRem = relevantTs + tfDelayMs - nowMs;
      if (timeRem > longestRemainingMs) {
        longestRemainingMs = timeRem;
        blockingTf = timeframes[0] || strategyConfig.scan_interval || '1m';
        blockingReason = `Time delay (${tfDelayMin}m)`;
        lastTradeWasKnife = !!t.is_knife;
      }
    }

    if (candleDelay > 0) {
      for (let j = 0; j < timeframes.length; j++) {
        const tf = timeframes[j];
        const tfMs = timeframeToMs(tf);
        const currentCandleStart = Math.floor(nowMs / tfMs) * tfMs;
        const gateStart = currentCandleStart - (candleDelay - 1) * tfMs;
        if ((entryTs > 0 && entryTs >= gateStart) || (exitTs > 0 && exitTs >= gateStart)) {
          const candlesElapsed = Math.floor((currentCandleStart - Math.floor(relevantTs / tfMs) * tfMs) / tfMs);
          const remainingCandles = Math.max(1, candleDelay - candlesElapsed);
          const candleCloseTs = currentCandleStart + remainingCandles * tfMs;
          const candleRem = Math.max(0, candleCloseTs - nowMs);
          if (candleRem >= longestRemainingMs) {
            longestRemainingMs = candleRem;
            blockingTf = tf;
            blockingReason = `${candleDelay}c on ${tf}`;
            lastTradeWasKnife = !!t.is_knife;
          }
        }
      }
    }
  }

  if (longestRemainingMs > 0) {
    return {
      status: 'locked',
      disabled: false,
      locked: true,
      timeframes,
      candleDelay,
      tfDelayMin,
      perStrategy,
      allowKnife: !!strategyConfig.anti_whipsaw_allow_knife,
      lastTradeWasKnife,
      blockingTf,
      remainingMs: longestRemainingMs,
      summary: `${blockingReason} · ${formatDuration(longestRemainingMs)} left`,
    };
  }

  return {
    status: 'clear',
    disabled: false,
    locked: false,
    timeframes,
    candleDelay,
    tfDelayMin,
    perStrategy,
    allowKnife: !!strategyConfig.anti_whipsaw_allow_knife,
    remainingMs: 0,
    summary: `Clear (${candleDelay}c${tfDelayMin > 0 ? ` + ${tfDelayMin}m` : ''} on ${timeframes.join(', ')})`,
  };
}

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

function asText(val, fallback = '') {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object' && typeof val.paramsText === 'string') return val.paramsText;
  return fallback;
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
 * Builds structured spatial level-ladder telemetry for HTF Breakout (`htf_breakout` / `prev_day_breakout`).
 * Zone cutoffs scale directly from `htf_breakout_max_expansion_pct` (Fresh 0-25% of cap, Stale 25-60%, Late 60-100%, Rejected >100%).
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

  const effectiveMaxExpPct = configuredMaxExpPct > 0 ? configuredMaxExpPct : 2.0;
  const hasHardCap = configuredMaxExpPct > 0;
  const explicitCap = Number(signalDetail.expansion_cap ?? NaN);
  const expansionCap = Number.isFinite(explicitCap) && explicitCap > 0
    ? explicitCap
    : (wantUpper
        ? refHigh * (1 + effectiveMaxExpPct / 100)
        : refLow * (1 - effectiveMaxExpPct / 100));

  // Signed % distance from breakout level (>0 means price has crossed beyond breakoutLevel in target direction)
  const distFromLevelPct = breakoutLevel > 0
    ? (wantUpper
        ? ((livePriceNum - breakoutLevel) / breakoutLevel) * 100
        : ((breakoutLevel - livePriceNum) / breakoutLevel) * 100)
    : 0;

  const capSpanPct = breakoutLevel > 0
    ? Math.max(0.05, Math.abs(((expansionCap - breakoutLevel) / breakoutLevel) * 100))
    : effectiveMaxExpPct;

  const capUsedPct = distFromLevelPct <= 0
    ? 0
    : (distFromLevelPct / capSpanPct) * 100;
  const capRoomPct = distFromLevelPct <= 0
    ? capSpanPct
    : capSpanPct - distFromLevelPct;

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

  // Trigger candle close countdown
  const tfMs = timeframeToMs(trigTf);
  const countdownMs = signalDetail.trig_close_countdown_ms !== undefined
    ? Number(signalDetail.trig_close_countdown_ms)
    : (tfMs > 0 ? Math.max(0, tfMs - (nowMs % tfMs)) : 0);
  const countdownMin = Math.max(1, Math.ceil(countdownMs / 60000));
  const countdownText = countdownMs >= 3600000
    ? `${trigTf} close in ${Math.floor(countdownMs / 3600000)}h ${Math.ceil((countdownMs % 3600000) / 60000)}m`
    : `${trigTf} close in ${countdownMin}m`;

  const isOverCap = (hasHardCap && capUsedPct > 100) || Boolean(signalDetail.rejected);
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
    zoneLabel = 'Late · near cap';
  }

  // Equivalent 0..150 dialPct so composite dial math & zone badges stay aligned
  let dialPct = 0;
  let rawDialPct = 0;
  if (distFromLevelPct < 0) {
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
    // Map capUsedPct: 0..25% -> 100..105 (Fresh), 25..60% -> 105..115 (Stale), 60..100% -> 115..150 (Late), >100% -> >150
    if (capUsedPct <= 25) {
      rawDialPct = Math.round(100 + (capUsedPct / 25) * 5);
    } else if (capUsedPct <= 60) {
      rawDialPct = Math.round(105 + ((capUsedPct - 25) / 35) * 10);
    } else {
      rawDialPct = Math.round(115 + ((capUsedPct - 60) / 40) * 35);
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
    hasHardCap,
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
    candleConfirmState,
    countdownMs,
    countdownText,
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
  insufficientData = false,
  signalKey = '',
  proximity = 0,
  isIndicatorPair = false,
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
      dialZone: 'warming',
      dialStatus: 'Warming',
      dialOverText: 'Warming',
    };
  }

  const val = value === undefined || value === null || value === '' ? NaN : Number(value);
  const thr = threshold === undefined || threshold === null || threshold === '' ? NaN : Number(threshold);
  const hasNumeric = Number.isFinite(val) && Number.isFinite(thr);

  if (!hasNumeric) {
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
    if (signedDelta >= 0) {
      rawRatio = 1 + Math.max(0, (pctDelta || 0) / 2.0);
    } else if (Number.isFinite(pctDelta)) {
      rawRatio = 1 / (1 + Math.abs(pctDelta) * 0.45);
    } else {
      rawRatio = safeProx / 100;
    }
    void isIndicatorPair;
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

  if (signedDelta >= 0 && (fired || safeProx >= 95 || signalKey === '__velocity__')) {
    const overshoot = Number.isFinite(pctDelta)
      ? (thresholdIsPrice ? Math.min(1, Math.max(0, pctDelta / 2.5)) : Math.min(1, Math.max(0, pctDelta / 100)))
      : 0.25;
    meterFillPct = Math.min(100, Math.max(fired ? 78 : 75, Math.round(75 + overshoot * 25)));

    let rawOvershoot = 3;
    if (Number.isFinite(pctDelta)) {
      // Price levels scale 10x (0.5% price move past = +5% Fresh, 1.5% = +15% Stale/Late); direct % metrics map 1:1
      const scaled = thresholdIsPrice ? pctDelta * 10 : pctDelta;
      rawOvershoot = Math.max(fired && scaled > 0 ? 1 : 0, Math.floor(scaled + 1e-9));
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

  const meterState = rejected
    ? 'blocked'
    : (signedDelta >= 0 && meterFillPct >= 75)
      ? 'exceeded'
      : safeProx <= 0 && signedDelta < 0
        ? 'diverging'
        : 'approaching';

  const deltaValueText = formatSignedDeltaValue(signedDelta, unit, thresholdIsPrice);
  const deltaPctText = Number.isFinite(pctDelta) ? formatSignedPct(pctDelta) : '';

  let meterReadout = '';
  if (deltaValueText && deltaPctText) {
    meterReadout = signedDelta >= 0
      ? `${deltaValueText} (${deltaPctText}) past`
      : `${deltaValueText} (${deltaPctText}) to target`;
  } else if (deltaValueText) {
    meterReadout = `${deltaValueText} ${signedDelta >= 0 ? 'past' : 'to'} 0`;
  } else {
    meterReadout = `${safeProx}%`;
  }

  const zoneInfo = resolveDialZone(dialPct, { rejected, rawDialPct });

  void isExceeded;
  return {
    meterFillPct,
    targetTickPct: 75,
    meterState,
    signedDelta,
    pctDelta: Number.isFinite(pctDelta) ? pctDelta : null,
    deltaValueText,
    deltaPctText,
    meterReadout,
    dialPct,
    rawDialPct,
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
  } else if (zone === 'stale' && dialDelta > 0) {
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
}) {
  const symbol = activeTrade?.symbol || opp?.symbol || '---';
  const scanTf = strategyConfig.scan_interval || '5m';
  const dirRaw = activeTrade?.direction || opp?.dir || opp?.direction || (opp?.pct !== undefined ? (opp.pct >= 0 ? 'LONG' : 'SHORT') : '---');
  const dir = typeof dirRaw === 'string' && dirRaw !== '---' ? dirRaw.toUpperCase() : '---';
  const isLong = dir !== 'SHORT';
  const markPrice = Number(activeTrade?.current_price || activeTrade?.mark_price || opp?.close || opp?.price || 0);

  if (activeTrade) {
    const tradeCfg = { ...strategyConfig, ...(activeTrade.strategy_config || {}) };
    const exitLogic = (tradeCfg.exit_signal_logic || 'any').toLowerCase();
    const requiredExit = tradeCfg.exit_required_signals || tradeCfg.required_signals || [];
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

    // Visual price runway positions (SL -> Entry -> Live -> TP) scaled in favorable R space
    let positionRunway = null;
    if (entryPrice > 0 && slPrice > 0 && markPrice > 0) {
      const targetR = tpPrice > 0 && slDist > 0
        ? Math.max(1, Math.abs(tpPrice - entryPrice) / slDist)
        : Number(tradeCfg.tp_ratio || 2.0);
      const minR = -1.1;
      const maxR = Math.max(targetR * 1.08, currentR + 0.25, 2.0);
      const span = Math.max(1, maxR - minR);
      const toPct = (rVal) => Math.max(2, Math.min(98, Math.round(((rVal - minR) / span) * 100)));
      const slR = slDist > 0 ? (isLong ? (slPrice - entryPrice) / slDist : (entryPrice - slPrice) / slDist) : -1;
      positionRunway = {
        slPct: toPct(slR),
        entryPct: toPct(0),
        livePct: toPct(currentR),
        tpPct: tpPrice > 0 ? toPct(targetR) : null,
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
      const proximity = (est && typeof est.proximity === 'number')
        ? Math.round(est.proximity)
        : Math.round(calculateProximity({ ...s, key: sigKey }, markPrice, entryPrice, isLong, true));

      const isTriggered = Boolean((s.fired && s.active) || est?.state === 'fired');
      const isDelayed = Number(s.remaining_delay || 0) > 0 && !isTriggered;

      let stateLabel = 'WATCHING';
      let tone = 'neutral';
      if (s.insufficientData) {
        stateLabel = 'WARMING';
        tone = 'warning';
      } else if (isTriggered) {
        stateLabel = 'TRIGGERED';
        tone = 'danger';
      } else if (est?.state === 'blocked') {
        stateLabel = 'BLOCKED';
        tone = 'danger';
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

      const meter = computeConditionMeter({
        value: s.value,
        threshold: s.threshold,
        thresholdIsPrice: Boolean(s.threshold_is_price || s.thresholdIsPrice),
        unit: s.unit || '',
        isLong,
        isExit: true,
        fired: Boolean(s.fired),
        active: s.active !== false,
        rejected: Boolean(s.rejected || est?.state === 'blocked'),
        insufficientData: Boolean(s.insufficientData),
        signalKey: sigKey,
        proximity,
        isIndicatorPair: sigKey.includes('dual') || sigKey.includes('_cross'),
      });

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

      return {
        key: sigKey,
        connector,
        label: asText(s.label, formatSignalLabel(sigKey)),
        timeframe: tf,
        paramsText,
        macdFilter,
        liveValue: !s.insufficientData && Number.isFinite(Number(s.value)) ? Number(s.value) : null,
        targetValue: Number.isFinite(Number(s.threshold)) ? Number(s.threshold) : null,
        unit: s.unit || '',
        thresholdIsPrice: Boolean(s.threshold_is_price || s.thresholdIsPrice),
        liveText: s.insufficientData ? '---' : formatCompactValue(s.value, s.unit, s.threshold_is_price),
        targetText: formatCompactValue(s.threshold, s.unit, s.threshold_is_price),
        proximity,
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
    const firedConditionsCount = exitConditions.filter(c => (Number(c.dialPct) || 0) >= 100 && c.stateLabel !== 'BLOCKED').length;
    const compositeDial = resolveDialZone(compositeDialPct);

    const isProtected = isLong
      ? (slPrice >= entryPrice && entryPrice > 0)
      : (slPrice > 0 && entryPrice > 0 && slPrice <= entryPrice);

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
        tpPrice,
        livePnl,
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

    const effectiveValue = s.value !== undefined && s.value !== null
      ? s.value
      : (ladder ? ladder.livePrice : undefined);
    const effectiveThreshold = s.threshold !== undefined && s.threshold !== null
      ? s.threshold
      : (ladder ? ladder.breakoutLevel : undefined);
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

    if (!isPassed && !isWarming && !isRejected && !isIndicatorPair && effectiveThresholdIsPrice) {
      const vNum = Number(effectiveValue ?? markPrice);
      const tNum = Number(effectiveThreshold);
      if (Number.isFinite(vNum) && Number.isFinite(tNum) && tNum > 0) {
        const distRatio = Math.abs(vNum - tNum) / tNum;
        const scaledProx = Math.round(99 / (1 + 35 * distRatio));
        prox = Math.max(0, Math.min(99, scaledProx));
      }
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
      insufficientData: isWarming,
      signalKey: sigKey,
      proximity: prox,
      isIndicatorPair,
    });

    if (ladder && !isWarming) {
      const absDist = Math.abs(ladder.distFromLevelPct);
      const distFormatted = absDist >= 10 ? absDist.toFixed(1) : absDist.toFixed(2);
      const ladderOverText = isRejected
        ? `+${distFormatted}% · over cap`
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

    return {
      key: sigKey,
      connector,
      visualization: ladder ? 'ladder' : 'dial',
      ladder,
      macdFilter,
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
      ...meter,
      stateLabel,
      tone,
      description: asText(s.description, ''),
      evaluatedAtMs: opp?.isEntrySnapshot
        ? (s.evaluated_at_ms || opp?.snapshotCapturedAt)
        : (Math.max(Number(s.evaluated_at_ms || 0), Number(liveEvalTs || 0)) || undefined),
    };
  });

  const entryConditions = [scannerCondition, ...signalConditionItems];

  // Evaluate signal gate satisfaction and composite dial strictly by signalLogic (ALL=min, ANY=max, COMBO=min(req, max(opt)))
  const evalPool = signalConditionItems.length > 0 ? signalConditionItems : [scannerCondition];
  const firedConditionsCount = symbol === '---'
    ? 0
    : evalPool.filter(c => c.stateLabel === 'PASS').length;
  const totalConditionsCount = evalPool.length;

  let signalsLogicSatisfied = velocityPassed && sideMatched;
  let rawCompositeSignalDial = Number(scannerCondition.dialPct) || 0;

  if (signalConditionItems.length > 0) {
    if (signalLogic === 'any') {
      signalsLogicSatisfied = velocityPassed && sideMatched && signalConditionItems.some(c => c.stateLabel === 'PASS');
      rawCompositeSignalDial = Math.max(...signalConditionItems.map(c => Number(c.dialPct) || 0));
    } else if (signalLogic === 'combo') {
      const reqItems = signalConditionItems.filter(c => c.connector === 'REQ' || requiredSignals.includes(c.key));
      const optItems = signalConditionItems.filter(c => !reqItems.includes(c));
      const reqPassed = reqItems.every(c => c.stateLabel === 'PASS');
      const optPassed = optItems.length === 0 || optItems.some(c => c.stateLabel === 'PASS');
      signalsLogicSatisfied = velocityPassed && sideMatched && reqPassed && optPassed;
      const reqMin = reqItems.length > 0 ? Math.min(...reqItems.map(c => Number(c.dialPct) || 0)) : 150;
      const optMax = optItems.length > 0 ? Math.max(...optItems.map(c => Number(c.dialPct) || 0)) : reqMin;
      rawCompositeSignalDial = Math.min(reqMin, optMax);
    } else {
      // ALL (AND gate): weakest signal determines composite readiness
      signalsLogicSatisfied = velocityPassed && sideMatched && signalConditionItems.every(c => c.stateLabel === 'PASS');
      rawCompositeSignalDial = Math.min(...signalConditionItems.map(c => Number(c.dialPct) || 0));
    }
  }

  const compositeDialPct = symbol === '---'
    ? 0
    : (!velocityPassed
        ? Math.min(Number(scannerCondition.dialPct) || 0, rawCompositeSignalDial)
        : rawCompositeSignalDial);

  const antiWhipsaw = evaluateAntiWhipsawStatus(symbol, strategyConfig, closedTrades, nowMs);
  const compositeProximity = symbol === '---'
    ? 0
    : Math.min(100, Math.max(0, compositeDialPct >= 100 ? 100 : compositeDialPct));

  const anyRejected = signalConditionItems.some(c => c.stateLabel === 'REJECTED' || c.stateLabel === 'BLOCKED');
  const compositeDial = resolveDialZone(compositeDialPct, {
    insufficientData: entryConditions.some(c => c.stateLabel === 'WARMING'),
    rejected: !sideMatched || (signalLogic === 'all' && anyRejected),
  });

  const normalizedGate = String(gateState || 'ACTIVE').toUpperCase();
  const isGateBlocked = isPaused || (normalizedGate !== 'ACTIVE' && normalizedGate !== 'OK');

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
  } else if (entryConditions.some(c => c.stateLabel === 'WARMING')) {
    overallStatus = 'WARMING';
    overallTone = 'warning';
  } else if (signalLogic === 'all' && anyRejected) {
    overallStatus = 'OVER EXPANSION CAP';
    overallTone = 'danger';
  } else if (signalsLogicSatisfied) {
    overallStatus = 'ENTRY READY';
    overallTone = 'positive';
  }

  const slPct = opp?.sl_dist_pct !== undefined && opp?.sl_dist_pct !== null
    ? `${Number(opp.sl_dist_pct).toFixed(2)}% SL`
    : `${strategyConfig.sl_distance_pct ?? 1.0}% SL (${strategyConfig.sl_type || 'pct'})`;
  const rrTarget = opp?.prospect_rr !== undefined && opp?.prospect_rr !== null
    ? `${opp.prospect_rr}R target`
    : `${strategyConfig.tp_ratio ?? 2.0}R target`;

  return {
    mode: 'searching',
    symbol,
    dir,
    markPrice,
    logicLabel: signalLogic.toUpperCase(),
    scannerPassed: velocityPassed,
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
