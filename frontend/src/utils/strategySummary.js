/**
 * Pure formatters for strategy Stop Loss (sl_type) and Profit/Exit (tp_mode + trailing)
 * summaries so preset cards, save dialogs, diffs, and dashboards never assume fixed SL/TP.
 */

const fmtNum = (val, fallback = 0) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return String(fallback);
  return String(Number(n.toFixed(2)));
};

const formatRrList = (seq, fallback = [1, 2, 4]) => {
  const list = Array.isArray(seq) && seq.length > 0 ? seq : fallback;
  return list.map((v) => fmtNum(v)).join('/');
};

export function formatStopLossDescriptor(cfg = {}) {
  const slType = cfg?.sl_type || 'pct';
  const tf = cfg?.sl_lookback_timeframe || cfg?.scan_interval || '1m';
  const period = cfg?.sl_lookback_period ?? 20;
  const hasMin = cfg?.sl_min_pct !== undefined && cfg?.sl_min_pct !== null && cfg?.sl_min_pct !== '';
  const hasMax = cfg?.sl_max_pct !== undefined && cfg?.sl_max_pct !== null && cfg?.sl_max_pct !== '';
  const boundsText = hasMin && hasMax
    ? `${fmtNum(cfg.sl_min_pct)}–${fmtNum(cfg.sl_max_pct)}%`
    : hasMax
      ? `≤${fmtNum(cfg.sl_max_pct)}%`
      : hasMin
        ? `≥${fmtNum(cfg.sl_min_pct)}%`
        : null;

  if (slType === 'lookback_low/high') {
    const periodLabel = Number(period) === 0 ? `0c ${tf}` : `${period}c ${tf}`;
    return {
      type: slType,
      shortLabel: 'H/L SL',
      fullLabel: 'High/Low Stop',
      valueText: boundsText || periodLabel,
      compactText: boundsText ? `H/L ${boundsText}` : `H/L ${periodLabel}`,
      fullText: boundsText
        ? `H/L ${periodLabel} (${boundsText})`
        : `High/Low (${periodLabel})`,
    };
  }

  if (slType === 'streak_extreme') {
    const periodLabel = Number(period) === 0 ? `0c ${tf}` : `${period}c ${tf}`;
    return {
      type: slType,
      shortLabel: 'Streak SL',
      fullLabel: 'Streak Extreme',
      valueText: boundsText || periodLabel,
      compactText: boundsText ? `Streak ${boundsText}` : `Streak ${periodLabel}`,
      fullText: boundsText
        ? `Streak ${periodLabel} (${boundsText})`
        : `Streak Extreme (${periodLabel})`,
    };
  }

  if (slType === 'supertrend') {
    return {
      type: slType,
      shortLabel: 'ST SL',
      fullLabel: 'Supertrend Line',
      valueText: boundsText ? `${boundsText} ${tf}` : tf,
      compactText: boundsText ? `ST ${boundsText}` : `ST ${tf}`,
      fullText: boundsText
        ? `Supertrend ${tf} (${boundsText})`
        : `Supertrend Line (${tf})`,
    };
  }

  if (slType === 'trailing') {
    const dist = cfg?.trailing_stop_type === 'rr'
      ? `${fmtNum(cfg?.trailing_stop_rr ?? 1)}R`
      : `${fmtNum(cfg?.trailing_stop_distance_pct ?? 1)}%`;
    return {
      type: slType,
      shortLabel: 'Trail SL',
      fullLabel: 'Trailing Stop',
      valueText: dist,
      compactText: `Trail ${dist}`,
      fullText: `Trailing ${dist}`,
    };
  }

  const dist = fmtNum(cfg?.sl_distance_pct ?? 0.8);
  return {
    type: 'pct',
    shortLabel: 'Fixed SL',
    fullLabel: 'Fixed Percentage',
    valueText: `${dist}%`,
    compactText: `Fixed ${dist}%`,
    fullText: `Fixed ${dist}%`,
  };
}

export function formatTakeProfitDescriptor(cfg = {}) {
  const tpMode = cfg?.tp_mode || 'fixed';
  const trailingOn = cfg?.trailing_stop_enabled === true;
  const trailSuffix = trailingOn
    ? (cfg?.trailing_stop_type === 'rr'
        ? ` +${fmtNum(cfg?.trailing_stop_rr ?? 1)}R Tr`
        : ` +${fmtNum(cfg?.trailing_stop_distance_pct ?? 1)}% Tr`)
    : '';
  const shortTrail = trailingOn ? ' +Tr' : '';

  if (tpMode === 'none') {
    return {
      mode: 'none',
      shortLabel: trailingOn ? 'Trailing' : 'Signal Exit',
      fullLabel: trailingOn ? 'Trailing Stop Only' : 'Signal Exit Only',
      valueText: trailingOn ? (cfg?.trailing_stop_type === 'rr' ? `${fmtNum(cfg?.trailing_stop_rr ?? 1)}R Tr` : `${fmtNum(cfg?.trailing_stop_distance_pct ?? 1)}% Tr`) : 'Signals',
      compactText: trailingOn ? `Trail${shortTrail}` : 'Signal Exit',
      fullText: trailingOn ? `Trailing Stop${trailSuffix}` : 'Signal / SL Only',
      trailingOn,
    };
  }

  if (tpMode === 'exp_rr_seq') {
    const triggers = formatRrList(cfg?.live_rr_sequence, [1, 2, 4]);
    const liveSeq = Array.isArray(cfg?.live_rr_sequence) && cfg.live_rr_sequence.length > 0 ? cfg.live_rr_sequence : [1, 2, 4];
    const exitSeq = Array.isArray(cfg?.exit_rr_sequence) && cfg.exit_rr_sequence.length > 0 ? cfg.exit_rr_sequence : [0, 1, 2];
    const pairs = liveSeq.map((v, i) => `${fmtNum(v)}R→${fmtNum(exitSeq[i] ?? 0)}R`).join(', ');
    return {
      mode: tpMode,
      shortLabel: trailingOn ? 'Ladder+Tr' : 'RR Ladder',
      fullLabel: 'Dynamic RR Milestone',
      valueText: `${triggers}R${shortTrail}`,
      compactText: `Seq ${triggers}R${shortTrail}`,
      fullText: `RR Ladder (${pairs})${trailSuffix}`,
      trailingOn,
    };
  }

  if (tpMode === 'exp_rr_seq_switch') {
    const triggers = formatRrList(cfg?.live_rr_sequence, [1, 2, 4]);
    const threshold = fmtNum(cfg?.peak_rr_switch_threshold ?? 2);
    const count = cfg?.peak_rr_switch_count ?? 1;
    return {
      mode: tpMode,
      shortLabel: trailingOn ? 'Adapt+Tr' : 'Adaptive RR',
      fullLabel: 'Dynamic RR Switch',
      valueText: `${triggers}R⇄${shortTrail}`,
      compactText: `Sw ${triggers}R${shortTrail}`,
      fullText: `Adaptive RR (${triggers}R, sw @${threshold}R ×${count})${trailSuffix}`,
      trailingOn,
    };
  }

  const ratio = fmtNum(cfg?.tp_ratio ?? 2.0);
  return {
    mode: 'fixed',
    shortLabel: trailingOn ? 'TP+Trail' : 'Fixed TP',
    fullLabel: 'Fixed Ratio',
    valueText: `${ratio}R${shortTrail}`,
    compactText: `Fixed ${ratio}R${shortTrail}`,
    fullText: `Fixed ${ratio}R${trailSuffix}`,
    trailingOn,
  };
}
