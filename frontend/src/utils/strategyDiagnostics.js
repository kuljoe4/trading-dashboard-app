import { price as fmtPrice } from '../lib/formatters.js';

export const SIGNAL_LABELS = {
  momentum_pct: 'Momentum',
  breakout_hl: 'Breakout H/L',
  ema_price_cross: 'EMA Cross',
  ema_dual: 'EMA Dual',
  ema_dual_cross: 'Dual EMA Cross',
  ema_close: 'EMA Close',
  ema_dual_close: 'Dual EMA Close',
  ma: 'MA Cross',
  engulfing: 'Engulfing',
  macd_impulse: 'MACD Impulse',
  macd_fade: 'MACD Fade',
  macd_pbc: 'MACD PBC',
  supertrend: 'Supertrend',
  knife_catch: 'Knife Catch',
  htf_breakout: 'HTF Breakout',
  prev_day_breakout: 'Prev-Day Breakout',
  trigger_candle_exit: 'Trigger Candle Exit',
  entry_candle_boundary: 'Trigger Candle Exit',
};

export function getBaseSignalType(signalType) {
  if (!signalType) return '';
  if (SIGNAL_LABELS[signalType]) return signalType;
  const lastUnderscore = signalType.lastIndexOf('_');
  if (lastUnderscore > 0) {
    const potentialBase = signalType.substring(0, lastUnderscore);
    if (SIGNAL_LABELS[potentialBase]) return potentialBase;
  }
  return signalType;
}

export function formatSignalLabel(signalType) {
  if (!signalType) return 'Unknown';
  if (SIGNAL_LABELS[signalType]) return SIGNAL_LABELS[signalType];
  const base = getBaseSignalType(signalType);
  if (base !== signalType && SIGNAL_LABELS[base]) {
    const suffix = signalType.substring(base.length + 1);
    return `${SIGNAL_LABELS[base]} #${suffix}`;
  }
  return signalType.replace(/_/g, ' ');
}

export function resolveSignalParamClient(params, signalType, baseSignalType, paramKey, defaultValue) {
  if (!params || typeof params !== 'object') return defaultValue;
  if (signalType === baseSignalType) {
    return params[paramKey] !== undefined ? params[paramKey] : defaultValue;
  }
  const suffix = signalType.substring(baseSignalType.length);
  const suffixedKey = `${paramKey}${suffix}`;
  if (params[suffixedKey] !== undefined) return params[suffixedKey];
  if (paramKey.startsWith(baseSignalType)) {
    const replacedKey = signalType + paramKey.substring(baseSignalType.length);
    if (params[replacedKey] !== undefined) return params[replacedKey];
  }
  return params[paramKey] !== undefined ? params[paramKey] : defaultValue;
}

export function formatSignalValue(val, unit, thresholdIsPrice) {
  if (val === undefined || val === null || Number.isNaN(Number(val))) return '---';
  const num = Number(val);
  if (thresholdIsPrice) return fmtPrice(num);
  const decimals = Math.abs(num) >= 100 ? 2 : Math.abs(num) >= 1 ? 3 : 5;
  return `${num.toFixed(decimals)}${unit || ''}`;
}

export function getSignalParamsSummary(config = {}, sigKey, purpose = 'entry') {
  const params = config.signal_params || {};
  const baseType = getBaseSignalType(sigKey);
  const scanTf = config.scan_interval || '5m';
  const rawTf = config.signal_timeframes?.[sigKey];
  let timeframe = (!rawTf || rawTf === 'default') ? scanTf : rawTf;

  const p = (key, fallback) => resolveSignalParamClient(params, sigKey, baseType, key, fallback);

  const tokens = [];

  if (baseType === 'momentum_pct') {
    tokens.push(`±${config.scan_pct_threshold ?? 2.0}% · ${config.scan_lookback ?? 3}b`);
  } else if (baseType === 'breakout_hl') {
    tokens.push(`${config.scan_lookback ?? 3}b H/L`);
  } else if (baseType === 'ma') {
    tokens.push(`MA(${p('ma_period', 20)})`);
  } else if (['ema', 'ema_cross', 'ema_price_cross', 'ema_close'].includes(baseType)) {
    const fallback = p('ema_period', 12);
    const period = purpose === 'exit'
      ? p('exit_ema_period', fallback)
      : p('entry_ema_period', fallback);
    tokens.push(`EMA(${period})`);
  } else if (['ema_dual', 'ema_dual_cross', 'ema_dual_close'].includes(baseType)) {
    const fast = purpose === 'exit'
      ? p('exit_ema_fast', p('entry_ema_fast', p('ema_fast_period', 9)))
      : p('entry_ema_fast', p('exit_ema_fast', p('ema_fast_period', 9)));
    const slow = purpose === 'exit'
      ? p('exit_ema_slow', p('entry_ema_slow', p('ema_slow_period', 21)))
      : p('entry_ema_slow', p('exit_ema_slow', p('ema_slow_period', 21)));
    tokens.push(`EMA ${fast}/${slow}`);
    const macdFilter = p('ema_dual_macd_filter', p('ema_macd_filter_enabled', false));
    if (macdFilter === true || macdFilter === 'true') {
      const mF = p('macd_fast', 12);
      const mS = p('macd_slow', 26);
      const mSig = p('macd_signal', 9);
      tokens.push(`MACD Filter(${mF}/${mS}/${mSig})`);
    }
  } else if (baseType === 'engulfing') {
    const mode = p('engulfing_mode', config.engulfing_mode || 'range');
    const lookback = p('engulfing_lookback', config.engulfing_lookback || 1);
    const streak = p('engulfing_streak', config.engulfing_streak || 1);
    const seq = p('engulfing_sequential', config.engulfing_sequential !== false);
    const timing = p('engulfing_timing', config.engulfing_timing || 'is_opportunity');
    const vol = p('engulfing_volume_confirm', config.engulfing_volume_confirm || false);
    const maxExp = Number(p('engulfing_max_expansion_pct', config.engulfing_max_expansion_pct ?? 0));
    tokens.push(`${mode}`);
    tokens.push(`W${lookback}/S${streak}${seq ? ' Seq' : ''}`);
    if (timing === 'after_opportunity') tokens.push('Next-Bar');
    if (vol === true || vol === 'true') tokens.push('Vol↑');
    if (maxExp > 0) tokens.push(`Cap ${maxExp}%`);
  } else if (['macd_impulse', 'macd_fade', 'macd_pbc'].includes(baseType)) {
    const mF = p('macd_fast', config.macd_fast || 12);
    const mS = p('macd_slow', config.macd_slow || 26);
    const mSig = p('macd_signal', config.macd_signal || 9);
    tokens.push(`MACD(${mF}/${mS}/${mSig})`);
    if (baseType === 'macd_impulse') {
      const strict = p('macd_strict_expansion', true);
      tokens.push(strict === true || strict === 'true' ? 'Strict' : 'Soft');
    }
    if (baseType === 'macd_pbc') {
      const ema = p('macd_pbc_trend_ema', config.macd_pbc_trend_ema || 50);
      const lb = p('macd_pbc_lookback', config.macd_pbc_lookback || 10);
      const mc = p('macd_pbc_max_continuation', config.macd_pbc_max_continuation || 2);
      tokens.push(`EMA(${ema}) · LB:${lb} · Cont:${mc}`);
    }
  } else if (baseType === 'supertrend') {
    const period = p('supertrend_period', 10);
    const mult = p('supertrend_multiplier', 3);
    const mode = p('supertrend_mode', 'trend');
    tokens.push(`ATR(${period})×${mult}`);
    tokens.push(mode === 'crossover' ? 'Crossover' : 'Trend');
  } else if (baseType === 'knife_catch') {
    const roc = p('knife_roc_threshold', 2.0);
    const wick = p('knife_wick_pct', 30.0);
    const lb = p('knife_lookback', 3);
    tokens.push(`ROC≥${roc}% · Wick≥${wick}% · ${lb}b`);
  } else if (baseType === 'htf_breakout' || baseType === 'prev_day_breakout') {
    const refTf = p('htf_breakout_ref_timeframe', config.htf_breakout_ref_timeframe || '1d');
    const trigRaw = p('htf_breakout_trigger_timeframe', config.htf_breakout_trigger_timeframe || '1h');
    const trigTf = (!trigRaw || trigRaw === 'default') ? scanTf : trigRaw;
    timeframe = `${refTf}→${trigTf}`;
    const mode = p('htf_breakout_mode', config.htf_breakout_mode || 'close_break');
    const refLvl = p('htf_breakout_reference_level', config.htf_breakout_reference_level || 'high_low');
    const lb = p('htf_breakout_lookback', config.htf_breakout_lookback ?? 1);
    const buf = Number(p('htf_breakout_buffer_pct', config.htf_breakout_buffer_pct ?? 0));
    const maxExp = Number(p('htf_breakout_max_expansion_pct', config.htf_breakout_max_expansion_pct ?? 0));
    const refLabel = refLvl === 'open_close_body' ? 'Body' : refLvl === 'close_only' ? 'Close' : 'H/L';
    tokens.push(`${mode} · ${refLabel}(${lb})`);
    if (buf > 0) tokens.push(`Buf +${buf}%`);
    if (maxExp > 0) tokens.push(`MaxExp≤${maxExp}%`);
  } else if (baseType === 'trigger_candle_exit' || baseType === 'entry_candle_boundary') {
    const trigRaw = p('trigger_candle_exit_timeframe', config.trigger_candle_exit_timeframe || 'default');
    if (trigRaw && trigRaw !== 'default') timeframe = trigRaw;
    const n = p('trigger_candle_exit_n', config.trigger_candle_exit_n ?? 0);
    const offset = p('trigger_candle_exit_offset_mode', config.trigger_candle_exit_offset_mode || 'prev_and_next');
    const mode = p('trigger_candle_exit_mode', config.trigger_candle_exit_mode || 'close');
    const buf = Number(p('trigger_candle_exit_buffer_pct', config.trigger_candle_exit_buffer_pct ?? 0));
    tokens.push(`${mode} · ±${n} (${offset})`);
    if (buf > 0) tokens.push(`Buf +${buf}%`);
  }

  if (purpose === 'exit') {
    const delayVal = config.exit_signal_delays?.[sigKey];
    if (delayVal !== undefined && Number(delayVal) > 0) {
      tokens.push(`Delay ${delayVal}`);
    }
    const action = config.exit_signal_actions?.[sigKey];
    if (action === 'lock_sl') {
      tokens.push('Action:Lock SL');
    } else if (action === 'close') {
      tokens.push('Action:Close');
    }
  }

  return {
    timeframe,
    paramsText: tokens.join(' · ') || 'Standard',
  };
}

export function getStrategyRulesDiagnostics({
  strategyConfig = {},
  focusedOpp = {},
  activeTrade = null,
  activeTradeCount = 0,
  totalRiskPct = 0,
  startingBal = 10000,
  effectiveGate = 'ACTIVE',
  effectiveReason = 'OK',
  isStrategyPaused = false,
}) {
  const scanTf = strategyConfig.scan_interval || '5m';
  const scanThreshold = Number(strategyConfig.scan_pct_threshold ?? 2.0);
  const scanLookback = Number(strategyConfig.scan_lookback ?? 3);
  const entrySide = (strategyConfig.entry_side || 'both').toLowerCase();
  const hasCandidate = focusedOpp && focusedOpp.symbol && focusedOpp.symbol !== '---';
  const candDir = (focusedOpp?.dir || (focusedOpp?.pct >= 0 ? 'long' : 'short')).toUpperCase();
  const sigRes = focusedOpp?.signalResult || {};
  const sigMap = sigRes.signals || {};

  // 1. Entry Rules
  const entryRules = [];

  // Direction Filter
  const sideAllowed = !hasCandidate || entrySide === 'both' || entrySide.toUpperCase() === candDir;
  entryRules.push({
    key: '_entry_side',
    label: 'Entry Side Filter',
    role: 'Gate',
    timeframe: 'All',
    paramsText: entrySide === 'both' ? 'LONG & SHORT allowed' : `${entrySide.toUpperCase()} only`,
    liveText: hasCandidate ? `Candidate: ${candDir}` : 'No candidate',
    thresholdText: entrySide.toUpperCase(),
    status: !hasCandidate ? 'waiting' : (sideAllowed ? 'allowed' : 'rejected'),
    reasonText: !hasCandidate
      ? 'Awaiting directional candidate'
      : (sideAllowed ? `${candDir} permitted by entry_side=${entrySide}` : `${candDir} rejected (entry_side=${entrySide} only)`),
  });

  // Velocity Move
  const oppPct = Math.abs(Number(focusedOpp?.pct || 0));
  const scanPassed = hasCandidate && oppPct >= scanThreshold;
  entryRules.push({
    key: '_velocity',
    label: 'Scan Velocity',
    role: 'Required',
    timeframe: scanTf,
    paramsText: `Min ±${scanThreshold}% over ${scanLookback} bars`,
    liveText: hasCandidate ? `${Number(focusedOpp.pct || 0) >= 0 ? '+' : ''}${Number(focusedOpp.pct || 0).toFixed(2)}%` : '---',
    thresholdText: `±${scanThreshold.toFixed(2)}%`,
    status: !hasCandidate ? 'waiting' : (scanPassed ? 'allowed' : 'waiting'),
    reasonText: !hasCandidate
      ? 'No pair currently above discovery filter'
      : (scanPassed ? `Velocity ${oppPct.toFixed(2)}% >= ${scanThreshold}% threshold` : `Velocity ${oppPct.toFixed(2)}% below ${scanThreshold}% threshold`),
  });

  // Configured Entry Signals
  const enabledSignals = strategyConfig.enabled_signals || [];
  const requiredSignals = strategyConfig.required_signals || [];
  const signalLogic = strategyConfig.signal_logic || 'all';

  for (const sigKey of enabledSignals) {
    const isReq = signalLogic === 'all' || (signalLogic === 'combo' && requiredSignals.includes(sigKey));
    const role = signalLogic === 'any' ? 'Optional' : (isReq ? 'Required' : 'Optional');
    const summary = getSignalParamsSummary(strategyConfig, sigKey, 'entry');
    const detail = sigMap[sigKey];

    let status = 'waiting';
    let liveText = '---';
    let thresholdText = '---';
    let reasonText = hasCandidate ? 'Awaiting candle evaluation' : 'Configured entry condition';

    if (detail) {
      liveText = detail.insufficientData ? 'Warming' : formatSignalValue(detail.value, detail.unit, detail.threshold_is_price);
      thresholdText = detail.threshold !== undefined && detail.threshold !== null
        ? formatSignalValue(detail.threshold, detail.unit, detail.threshold_is_price)
        : (detail.mode || 'Rule Match');

      if (detail.insufficientData) {
        status = 'warming';
        reasonText = detail.description || `Insufficient candles (${detail.value ?? '?'}/${detail.threshold ?? '?'})`;
      } else if (detail.rejected || detail.status === 'blocked') {
        status = 'rejected';
        reasonText = detail.description || 'Condition crossed but rejected by filter/cap';
      } else if (detail.fired && detail.active !== false) {
        status = 'allowed';
        reasonText = detail.description || 'Signal condition satisfied';
      } else {
        status = 'waiting';
        reasonText = detail.description || 'Condition not yet crossed';
      }
    }

    entryRules.push({
      key: sigKey,
      label: formatSignalLabel(sigKey),
      role,
      timeframe: summary.timeframe,
      paramsText: summary.paramsText,
      liveText,
      thresholdText,
      status,
      reasonText,
      freshnessTs: detail?.evaluated_at_ms || focusedOpp?.snapshotCapturedAt,
    });
  }

  // 2. Exit Rules & Take Profit
  const exitRules = [];
  const rawExits = [...(strategyConfig.exit_signals || [])];
  if (strategyConfig.trigger_candle_exit_enabled && !rawExits.includes('trigger_candle_exit')) {
    rawExits.push('trigger_candle_exit');
  }
  const exitLogic = strategyConfig.exit_signal_logic || 'any';
  const reqExits = strategyConfig.required_exit_signals || [];
  const activeExitMap = activeTrade?.exit_signals_status || {};

  for (const sigKey of rawExits) {
    const isReq = exitLogic === 'all' || (exitLogic === 'combo' && reqExits.includes(sigKey));
    const role = exitLogic === 'any' ? 'Trigger' : (isReq ? 'Required' : 'Optional');
    const summary = getSignalParamsSummary(strategyConfig, sigKey, 'exit');
    const liveSig = activeExitMap[sigKey];

    let status = 'configured';
    let liveText = activeTrade ? 'Watching' : 'Standby';
    let thresholdText = '---';
    let reasonText = strategyConfig.exit_signals_override_ratchet
      ? 'Overrides trailing ratchet when fired'
      : 'Evaluated on open position';

    if (liveSig) {
      liveText = liveSig.insufficientData ? 'Warming' : formatSignalValue(liveSig.value, liveSig.unit, liveSig.threshold_is_price);
      thresholdText = liveSig.threshold !== undefined && liveSig.threshold !== null
        ? formatSignalValue(liveSig.threshold, liveSig.unit, liveSig.threshold_is_price)
        : 'Signal';

      if (liveSig.fired && liveSig.active !== false) {
        status = 'allowed';
        reasonText = liveSig.description || 'Exit signal triggered';
      } else if (liveSig.rejected || liveSig.status === 'blocked') {
        status = 'rejected';
        reasonText = liveSig.description || 'Exit blocked by filter';
      } else if (Number(liveSig.remaining_delay) > 0) {
        status = 'warning';
        reasonText = `Delay timer active (${liveSig.remaining_delay}s remaining)`;
      } else {
        status = 'waiting';
        reasonText = liveSig.description || 'Monitoring open trade';
      }
    }

    exitRules.push({
      key: sigKey,
      label: formatSignalLabel(sigKey),
      role,
      timeframe: summary.timeframe,
      paramsText: summary.paramsText,
      liveText,
      thresholdText,
      status,
      reasonText,
    });
  }

  // TP / Guard Ladder Rule
  const tpMode = strategyConfig.tp_mode || 'fixed';
  const tpRatio = Number(strategyConfig.tp_ratio ?? strategyConfig.exit_rr_target ?? 2.0);
  const liveSeq = strategyConfig.live_rr_sequence || [1.0, 2.0, 4.0];
  const exitSeq = strategyConfig.exit_rr_sequence || [0.0, 1.0, 2.0];
  const ladderText = liveSeq.map((t, idx) => `${t}R→${exitSeq[idx] ?? 0}R`).join(', ');

  exitRules.push({
    key: '_tp_ladder',
    label: tpMode === 'fixed' ? 'Fixed Take Profit' : tpMode === 'exp_rr_seq_switch' ? 'Dynamic R:R Ladder' : 'Guard R:R Ladder',
    role: 'Target',
    timeframe: 'Live',
    paramsText: tpMode === 'fixed'
      ? `Target ${tpRatio}R`
      : tpMode === 'exp_rr_seq_switch'
      ? `${ladderText} (Switch @ ${strategyConfig.peak_rr_switch_threshold ?? 5.0}R ×${strategyConfig.peak_rr_switch_count ?? 1})`
      : ladderText,
    liveText: activeTrade ? `${Number(activeTrade.rr || 0).toFixed(2)}R (Peak ${Number(activeTrade.max_rr ?? activeTrade.max_rr_achieved ?? 0).toFixed(2)}R)` : `${tpRatio}R`,
    thresholdText: tpMode === 'fixed' ? `${tpRatio}R` : `${liveSeq[0] ?? 1}R+`,
    status: activeTrade ? 'waiting' : 'configured',
    reasonText: tpMode === 'fixed'
      ? `Static TP placed at ${tpRatio}R`
      : 'SL ratchets automatically at each R milestone',
  });

  // 3. Risk, SL & Gating Checks
  const riskChecks = [];

  // SL Mode & Bounds
  const slType = strategyConfig.sl_type || 'pct';
  const slDistPct = Number(strategyConfig.sl_distance_pct ?? 0.8);
  const slMinPct = Number(strategyConfig.sl_min_pct ?? 0.3);
  const slMaxPct = Number(strategyConfig.sl_max_pct ?? 3.0);
  const slOobAction = strategyConfig.sl_out_of_bounds_action || (strategyConfig.reject_entry_if_sl_exceeds_max === false ? 'clamp' : 'reject');
  const slTf = strategyConfig.sl_lookback_timeframe || scanTf;
  const slLookback = strategyConfig.sl_lookback_period ?? 5;

  const slConfigDesc = slType === 'pct'
    ? `Fixed ${slDistPct}%`
    : slType === 'lookback_low/high'
    ? `Lookback(${slLookback} on ${slTf}) · Min ${slMinPct}% / Max ${slMaxPct}%`
    : `${slType} · Fallback ${slDistPct}% · Bounds ${slMinPct}%–${slMaxPct}%`;

  const entryRefSl = activeTrade ? Number(activeTrade.initial_sl ?? activeTrade.sl_price ?? activeTrade.current_sl ?? 0) : 0;
  const rawCandSlDist = hasCandidate && focusedOpp.sl_dist_pct !== undefined && focusedOpp.sl_dist_pct !== null
    ? Number(focusedOpp.sl_dist_pct)
    : (activeTrade && Number(activeTrade.entry_price) > 0 && entryRefSl > 0)
      ? (Math.abs(Number(activeTrade.entry_price) - entryRefSl) / Number(activeTrade.entry_price)) * 100
      : null;
  const candSlDist = (rawCandSlDist !== null && Number.isFinite(rawCandSlDist)) ? rawCandSlDist : null;

  let slStatus = 'allowed';
  let slReason = `Out-of-bounds action: ${slOobAction.toUpperCase()}`;
  if (candSlDist !== null) {
    const slTag = activeTrade && Number(activeTrade.initial_sl) > 0 ? 'Initial SL' : 'Prospective SL';
    if (candSlDist > slMaxPct) {
      slStatus = slOobAction === 'reject' ? 'rejected' : 'clamped';
      slReason = slOobAction === 'reject'
        ? `${slTag} ${candSlDist.toFixed(2)}% > Max ${slMaxPct}% (Entry Rejected)`
        : `${slTag} ${candSlDist.toFixed(2)}% clamped to Max ${slMaxPct}%`;
    } else if (candSlDist < slMinPct) {
      slStatus = 'clamped';
      slReason = `${slTag} ${candSlDist.toFixed(2)}% < Min ${slMinPct}% (Widened to ${slMinPct}%)`;
    } else {
      slReason = `${slTag} ${candSlDist.toFixed(2)}% within [${slMinPct}% – ${slMaxPct}%]`;
    }
  }

  riskChecks.push({
    key: 'sl_bounds',
    label: `Stop-Loss (${slType})`,
    configuredText: slConfigDesc,
    liveText: candSlDist !== null ? `${candSlDist.toFixed(2)}%` : `${slDistPct}%`,
    status: slStatus,
    reasonText: slReason,
  });

  // Trailing & Risk Release
  const trailingOn = strategyConfig.trailing_stop_enabled === true || slType === 'trailing';
  const trailDesc = trailingOn
    ? `${strategyConfig.trailing_stop_type === 'rr' ? `${strategyConfig.trailing_stop_rr ?? 1.0}R` : `${strategyConfig.trailing_stop_distance_pct ?? 1.0}%`} · Act≥${strategyConfig.trailing_activation_rr ?? 0}R (${strategyConfig.trailing_execution_mode || 'exchange'})`
    : 'Disabled (Ratchet ladder only)';
  riskChecks.push({
    key: 'trailing',
    label: 'Trailing & Protection',
    configuredText: trailDesc,
    liveText: trailingOn ? `Buf ${strategyConfig.trailing_guard_buffer_pct ?? 0.1}%` : 'Ladder Only',
    status: 'neutral',
    reasonText: [
      strategyConfig.force_risk_release ? 'Force risk release ON' : null,
      strategyConfig.release_risk_on_est_pnl_be ? 'Est PnL BE release ON' : null,
    ].filter(Boolean).join(' · ') || 'Gapless Cancel-then-Replace SL protection',
  });

  // Sizing & Portfolio Risk Cap
  const riskPerTradePct = Number(strategyConfig.risk_pct_per_trade ?? 1.0) || 1.0;
  const safeStartingBal = Number(startingBal) || 10000;
  const riskPerTradeUsdt = (safeStartingBal * riskPerTradePct) / 100;
  const maxTotalRiskPct = Number(strategyConfig.max_total_risk_pct ?? 5.0) || 5.0;
  const safeTotalRiskPct = Number(totalRiskPct) || 0;
  const riskAtCap = safeTotalRiskPct >= maxTotalRiskPct;
  const maxOpenTrades = Number(strategyConfig.max_open_trades ?? 3) || 3;
  const singleSlotBottleneck = maxTotalRiskPct <= riskPerTradePct && maxOpenTrades > 1;
  const riskNearCap = safeTotalRiskPct >= maxTotalRiskPct * 0.8 || singleSlotBottleneck;

  riskChecks.push({
    key: 'risk_cap',
    label: 'Position & Portfolio Risk',
    configuredText: `${riskPerTradePct}%/trade ($${riskPerTradeUsdt.toFixed(2)}) · Cap ${maxTotalRiskPct}%`,
    liveText: `${safeTotalRiskPct.toFixed(1)}% / ${maxTotalRiskPct}%`,
    status: riskAtCap ? 'rejected' : riskNearCap ? 'warning' : 'allowed',
    reasonText: riskAtCap
      ? `Total active risk ${safeTotalRiskPct.toFixed(1)}% reached ${maxTotalRiskPct}% cap (new entries blocked)`
      : singleSlotBottleneck
      ? `Warning: max_total_risk_pct (${maxTotalRiskPct}%) ≤ risk_pct_per_trade (${riskPerTradePct}%), capping open trades to 1 despite max_open_trades=${maxOpenTrades}`
      : `Min-notional auto-scale: ${strategyConfig.auto_scale_min_notional !== false ? `ON (max ${strategyConfig.auto_scale_max_overshoot ?? 3}x)` : 'OFF'}${strategyConfig.risk_hardening_enabled ? ` · Hard cap ${strategyConfig.max_single_trade_risk_pct ?? 20}%` : ''}`,
  });

  // Concurrency & Anti-Whipsaw
  const tradesFull = activeTradeCount >= maxOpenTrades;
  const awDelay = strategyConfig.anti_whipsaw_candle_delay ?? 1;
  const awMaxTf = strategyConfig.anti_whipsaw_max_tf || '4h';
  const minInterval = strategyConfig.min_trade_interval_min ?? 0;

  riskChecks.push({
    key: 'concurrency_whipsaw',
    label: 'Slots & Anti-Whipsaw',
    configuredText: `Max ${maxOpenTrades} open (${strategyConfig.max_open_trades_per_symbol ?? 1}/sym) · AW ${awDelay}c (≤${awMaxTf})${minInterval > 0 ? ` · ${minInterval}m cooldown` : ''}`,
    liveText: `${activeTradeCount} / ${maxOpenTrades} Open`,
    status: tradesFull ? 'rejected' : 'allowed',
    reasonText: tradesFull
      ? `Max open trades reached (${activeTradeCount}/${maxOpenTrades})`
      : `Frequency: ${strategyConfig.max_trades_per_period ? `${strategyConfig.max_trades_per_period}/${strategyConfig.trades_period_min || 60}m` : 'Unlimited'} · 24h cap: ${strategyConfig.max_trades_24h || 'Unlimited'}`,
  });

  // Schedule, TOD & Martingale (only detail if active or noteworthy)
  const windows = strategyConfig.trading_windows || [];
  const todOn = Boolean(strategyConfig.risk_use_tod_stats);
  const martOn = Boolean(strategyConfig.martingale_enabled);
  const guardUsdt = Number(strategyConfig.total_sl_guard_usdt ?? 0);
  const slGuardTight = guardUsdt > 0 && guardUsdt < riskPerTradeUsdt;
  const shortAbsMismatch = entrySide === 'short' && strategyConfig.discovery_mode === 'abs_change_pct';
  const excludedList = Array.isArray(strategyConfig.excluded_symbols) ? strategyConfig.excluded_symbols : [];
  const typoSymbols = excludedList.filter(s => typeof s === 'string' && s.trim().toUpperCase() === 'BTW');

  const configAuditNotes = [];
  if (slGuardTight) {
    configAuditNotes.push(`Session SL Guard ($${guardUsdt}) is below single-trade risk ($${riskPerTradeUsdt.toFixed(0)})`);
  }
  if (shortAbsMismatch) {
    configAuditNotes.push(`Short strategy uses abs_change_pct (can pick gainers to short; prefer signed negative change)`);
  }
  if (typoSymbols.length > 0) {
    configAuditNotes.push(`Possible typo in excluded_symbols: "${typoSymbols.join(', ')}" (did you mean BTC?)`);
  }

  riskChecks.push({
    key: 'guards_extras',
    label: 'Session Guards & Sizing Modifiers',
    configuredText: [
      windows.length > 0 ? `${windows.length} Trading Window(s)` : '24/7 Schedule',
      todOn ? `TOD WinRate ≥ ${strategyConfig.tod_min_winrate ?? 40}%` : null,
      guardUsdt > 0 ? `Session SL Guard $${guardUsdt}` : null,
      martOn ? `Martingale ×${strategyConfig.martingale_multiplier ?? 2} (max ${strategyConfig.martingale_max_steps ?? 3})` : null,
    ].filter(Boolean).join(' · '),
    liveText: isStrategyPaused
      ? 'PAUSED'
      : (effectiveGate && effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK'
        ? effectiveGate.toUpperCase()
        : (configAuditNotes.length > 0 ? 'CHECK CONFIG' : 'ALLOWED')),
    status: isStrategyPaused
      ? 'warning'
      : (effectiveGate && effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK'
        ? 'rejected'
        : (configAuditNotes.length > 0 ? 'warning' : 'allowed')),
    reasonText: isStrategyPaused
      ? 'Strategy manually paused'
      : (effectiveGate && effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK')
        ? `Gate blocked: ${effectiveReason || effectiveGate}`
        : configAuditNotes.length > 0
          ? configAuditNotes.join(' · ')
          : `Slippage abort ≥ ${strategyConfig.slippage_abort_threshold ?? 1.5}% · All pre-trade guards clear`,
  });

  return {
    entrySide,
    entryLogic: signalLogic,
    exitLogic,
    scanTf,
    scanThreshold,
    entryRules,
    exitRules,
    riskChecks,
  };
}

export function buildStrategyNarrative({
  isStrategyPaused,
  effectiveGate,
  effectiveReason,
  gateUpdatedAt,
  timeframeDebugItems = [],
  strategyActiveTrades = [],
  bestOpp = {},
  entryMet = false,
  firedCount = 0,
  signalsCount = 0,
  strategyConfig = {},
  isStaticWatchlist = false,
  staticSymbols = [],
  lastScanTs,
  streamAgeSec,
  recentSkipEvent = null,
  formatTimeAgo,
  formatClockTime,
}) {
  if (isStrategyPaused) {
    return {
      tone: 'warning',
      headline: 'Strategy automation is paused',
      detail: 'New entries are halted while open positions continue monitoring SL ratchets and exit triggers.',
      when: gateUpdatedAt ? `Since ${formatClockTime(gateUpdatedAt)} (${formatTimeAgo(gateUpdatedAt)})` : `Stream ${streamAgeSec}s`,
    };
  }

  if (effectiveGate && effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK') {
    return {
      tone: 'danger',
      headline: `Blocked at Risk Guard (${effectiveGate.toUpperCase()})`,
      detail: effectiveReason || 'Entry orders throttled until portfolio/frequency gate clears.',
      when: gateUpdatedAt ? `Triggered ${formatClockTime(gateUpdatedAt)} (${formatTimeAgo(gateUpdatedAt)})` : `Stream ${streamAgeSec}s`,
    };
  }

  const warmingItems = timeframeDebugItems.filter(i => i.isWarming);
  if (warmingItems.length > 0 && strategyActiveTrades.length === 0) {
    const first = warmingItems[0];
    const progressSuffix = first.candles != null && first.required != null ? `: ${first.candles}/${first.required}` : '';
    return {
      tone: 'warning',
      headline: `Warming ${warmingItems.length} candle buffer${warmingItems.length > 1 ? 's' : ''} (${first.label} ${first.tf}${progressSuffix})`,
      detail: 'Historical candles are still populating; technical evaluation unlocks automatically once buffers complete.',
      when: `Stream ${streamAgeSec}s`,
    };
  }

  if (strategyActiveTrades.length > 0) {
    const syms = strategyActiveTrades.map(t => `${t.symbol} ${t.direction}`).slice(0, 3).join(', ');
    const exitCount = (strategyConfig.exit_signals || []).length + (strategyConfig.trigger_candle_exit_enabled ? 1 : 0);
    return {
      tone: 'positive',
      headline: `Managing ${strategyActiveTrades.length} active position${strategyActiveTrades.length > 1 ? 's' : ''} (${syms})`,
      detail: `Monitoring ${exitCount} exit rule${exitCount === 1 ? '' : 's'} & ${strategyConfig.sl_type || 'pct'} stop-loss protection (${strategyConfig.tp_mode === 'fixed' ? `${strategyConfig.tp_ratio ?? 2}R TP` : 'R:R ratchet ladder'}).`,
      when: `Live feed ${streamAgeSec}s`,
    };
  }

  const hasCand = bestOpp && bestOpp.symbol && bestOpp.symbol !== '---';
  if (entryMet && hasCand) {
    return {
      tone: 'positive',
      headline: `Entry criteria satisfied on ${bestOpp.symbol} (${(bestOpp.dir || 'LONG').toUpperCase()})`,
      detail: `All required signals fired (${firedCount}/${signalsCount}); passing through Stage 3 SL bounds & risk sizing.`,
      when: lastScanTs ? `Scanned ${formatTimeAgo(lastScanTs)}` : `Live ${streamAgeSec}s`,
    };
  }

  if (hasCand) {
    const sigRes = bestOpp.signalResult || {};
    const rejectedEntry = Object.entries(sigRes.signals || {}).find(([, d]) => d?.rejected || d?.status === 'blocked');
    if (rejectedEntry) {
      return {
        tone: 'warning',
        headline: `${bestOpp.symbol} signal rejected (${formatSignalLabel(rejectedEntry[0])})`,
        detail: rejectedEntry[1]?.description || 'Candidate crossed technical trigger but failed secondary filter.',
        when: lastScanTs ? `Last scan ${formatTimeAgo(lastScanTs)}` : `Live ${streamAgeSec}s`,
      };
    }

    const oppPct = Math.abs(Number(bestOpp.pct || 0));
    const thr = Number(strategyConfig.scan_pct_threshold ?? 2.0);
    const prox = Number(bestOpp.proximity ?? 0);
    const waitReason = oppPct < thr
      ? `Velocity ${oppPct.toFixed(2)}% below ±${thr}% threshold`
      : `${firedCount}/${signalsCount} entry signals fired — waiting for remaining triggers`;

    return {
      tone: 'neutral',
      headline: `Closest candidate: ${bestOpp.symbol} (${prox > 0 ? `${prox}% ready` : 'watching'})`,
      detail: waitReason,
      when: lastScanTs ? `Last scan ${formatTimeAgo(lastScanTs)}` : `Live ${streamAgeSec}s`,
    };
  }

  return {
    tone: recentSkipEvent ? 'warning' : 'neutral',
    headline: isStaticWatchlist
      ? `Monitoring ${staticSymbols.length} static symbol${staticSymbols.length === 1 ? '' : 's'} on ${strategyConfig.scan_interval || '5m'}`
      : `Scanning top ${strategyConfig.watchlist_size || 15} pairs by ${strategyConfig.discovery_mode || 'volume'} on ${strategyConfig.scan_interval || '5m'}`,
    detail: recentSkipEvent
      ? `Last candidate ${recentSkipEvent.symbol} skipped: ${recentSkipEvent.shortReason}`
      : `Waiting for ±${strategyConfig.scan_pct_threshold ?? 2.0}% velocity expansion before running ${signalsCount} entry signal${signalsCount === 1 ? '' : 's'}.`,
    when: recentSkipEvent?.timestamp
      ? `Skipped ${formatTimeAgo(recentSkipEvent.timestamp)}`
      : (lastScanTs ? `Last scan ${formatTimeAgo(lastScanTs)}` : `Live ${streamAgeSec}s`),
  };
}

const DETAIL_KEY_LABELS = {
  entryPrice: 'Entry Price',
  entry_price: 'Entry Price',
  exitPrice: 'Exit Price',
  exit_price: 'Exit Price',
  initialSl: 'Initial SL',
  initial_sl: 'Initial SL',
  currentSl: 'Active SL',
  current_sl: 'Active SL',
  sl_dist_pct: 'SL Distance',
  slDistPct: 'SL Distance',
  tp: 'Take Profit',
  tp_ratio: 'Target R:R',
  pnl: 'PnL',
  pnl_pct: 'PnL %',
  rr: 'R:R',
  exit_rr: 'Exit R:R',
  max_rr_achieved: 'Peak R:R',
  exit_reason: 'Exit Reason',
  entry_reason: 'Entry Reason',
  timeframe: 'Timeframe',
  tf: 'Timeframe',
  value: 'Live Value',
  threshold: 'Threshold',
  direction: 'Direction',
  dir: 'Direction',
  pct: '24h / Window Δ',
  proximity: 'Proximity',
  firedSignals: 'Fired Signals',
  missingSignals: 'Missing Signals',
  risk_usdt: 'Risk Exposure',
  initial_risk_usdt: 'Initial Risk',
  candles: 'Candles',
  required: 'Required',
};

const HIDDEN_DETAIL_KEYS = new Set(['id', 'tradeId', 'sessionId', 'ts_ms', '_fingerprint']);

/**
 * Formats an entry from item.details into clean human-readable label and value.
 * Returns null if the entry should be omitted (nullish, plain object, or internal ID).
 */
export function formatDiagnosticDetailEntry(key, value) {
  if (HIDDEN_DETAIL_KEYS.has(key)) return null;
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value))) return null;

  const label = DETAIL_KEY_LABELS[key] || key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).map(v => formatSignalLabel(String(v))).join(', ');
    return joined ? { label, value: joined } : null;
  }

  if (typeof value === 'boolean') {
    return { label, value: value ? 'Yes' : 'No' };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (key === 'pnl' || key === 'risk_usdt' || key === 'initial_risk_usdt') {
      return { label, value: `${value >= 0 ? '' : '-'}$${Math.abs(value).toFixed(2)}` };
    }
    if (key.endsWith('_pct') || key === 'pct' || key === 'proximity' || key === 'slDistPct') {
      return { label, value: `${value.toFixed(2)}%` };
    }
    if (key === 'rr' || key === 'exit_rr' || key === 'max_rr_achieved' || key === 'tp_ratio') {
      return { label, value: `${value >= 0 ? '+' : ''}${value.toFixed(2)}R` };
    }
    if (key.toLowerCase().includes('price') || key.toLowerCase().includes('sl') || key === 'tp') {
      return { label, value: value >= 1 ? value.toFixed(4).replace(/\.?0+$/, '') : value.toPrecision(5) };
    }
    return { label, value: Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '') };
  }

  const str = String(value).trim();
  return str ? { label, value: str } : null;
}

/**
 * Formats an array of decision log entries for clipboard export (Visible / Filtered / All).
 */
export function formatDecisionLogsForCopy(
  items = [],
  {
    strategyLabel = 'Strategy',
    scope = 'filtered',
    totalAvailable = items.length,
    filters = undefined,
  } = {},
) {
  const safeItems = Array.isArray(items) ? items : [];
  const entries = safeItems.map((item) => {
    const ms = typeof item?.timestamp === 'number'
      ? item.timestamp
      : (item?.timestamp ? new Date(item.timestamp).getTime() : NaN);
    const iso = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
    return {
      timestamp: iso,
      outcome: item?.outcome ?? 'waiting',
      stage: item?.stage ?? '',
      symbol: item?.symbol ?? '---',
      ...(item?.direction ? { direction: String(item.direction).toUpperCase() } : {}),
      title: item?.title ?? '',
      reason: item?.reason ?? '',
      ...(item?.details ? { details: item.details } : {}),
    };
  });

  return JSON.stringify(
    {
      strategy: strategyLabel,
      scope,
      count: entries.length,
      totalAvailable,
      ...(filters ? { filters } : {}),
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2,
  );
}
