export const STRATEGY_NAME_CHAR_LIMITS = {
  COMPACT: 20,
  STANDARD: 28,
  MAX: 50,
};

const GENERIC_LABELS = new Set([
  '',
  'momentum strategy',
  'base strategy',
  'new strategy',
  'custom strategy',
  'default strategy',
  'strategy',
  'variant',
  'promoted strategy',
]);

export function isGenericStrategyName(name) {
  if (!name || typeof name !== 'string') return true;
  const trimmed = name.trim().toLowerCase();
  if (GENERIC_LABELS.has(trimmed)) return true;
  if (/^variant\s*#?\d*$/i.test(trimmed)) return true;
  return false;
}

export function sanitizeStrategyLabel(raw, maxLen = STRATEGY_NAME_CHAR_LIMITS.MAX) {
  if (raw === undefined || raw === null) return '';
  const limit = Math.max(8, Math.min(Number(maxLen) || STRATEGY_NAME_CHAR_LIMITS.MAX, STRATEGY_NAME_CHAR_LIMITS.MAX));
  // Allowed by backend SessionConfig: /^[a-zA-Z0-9 _\-\.\/\(\)%:]+$/
  const cleaned = String(raw)
    .replace(/[^a-zA-Z0-9 _\-\.\/\(\)%:]/g, '')
    .replace(/\s+/g, ' ');
  if (cleaned.length <= limit) return cleaned;
  return cleaned.slice(0, limit).trimEnd();
}

export function truncateToCharLimit(text, maxLen = STRATEGY_NAME_CHAR_LIMITS.STANDARD) {
  const cleaned = sanitizeStrategyLabel(text, STRATEGY_NAME_CHAR_LIMITS.MAX).trim();
  const limit = Math.max(8, Math.min(Number(maxLen) || STRATEGY_NAME_CHAR_LIMITS.STANDARD, STRATEGY_NAME_CHAR_LIMITS.MAX));
  if (cleaned.length <= limit) return cleaned;

  // Prefer trimming at the last space boundary if it keeps at least 65% of the limit
  const sliced = cleaned.slice(0, limit);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace >= Math.floor(limit * 0.65)) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced.trim();
}

function readParam(cfg, key, fallback) {
  if (!cfg || typeof cfg !== 'object') return fallback;
  const flatKey = `signal_params_${key}`;
  if (cfg[flatKey] !== undefined && cfg[flatKey] !== null && cfg[flatKey] !== '') {
    return cfg[flatKey];
  }
  if (cfg.signal_params && typeof cfg.signal_params === 'object' && cfg.signal_params[key] !== undefined && cfg.signal_params[key] !== '') {
    return cfg.signal_params[key];
  }
  if (cfg[key] !== undefined && cfg[key] !== null && cfg[key] !== '') {
    return cfg[key];
  }
  return fallback;
}

export function getWatchlistScopeDescriptor(cfg = {}) {
  const staticSymbols = Array.isArray(cfg.symbols) ? cfg.symbols : [];
  const isGlobalOff = cfg.global_scanner_enabled === false;
  const isPureStatic = isGlobalOff || (staticSymbols.length > 0 && !cfg.watchlist_auto_rotate);
  const watchlistSize = Number(cfg.watchlist_size ?? 15);
  const watchlistOffset = Number(cfg.watchlist_offset ?? 0);
  const maxStatic = Number(cfg.watchlist_max_symbols ?? 0);
  const discoveryMode = String(cfg.discovery_mode || 'volume').toLowerCase();
  const entrySide = String(cfg.entry_side || 'both').toLowerCase();

  if (isPureStatic) {
    const isSoloStatic = maxStatic === 1 || staticSymbols.length === 1;
    const coinLabel = staticSymbols[0] ? staticSymbols[0].replace(/USDT$/i, '') : '1 Pair';
    if (isSoloStatic) {
      return {
        mode: 'static_solo',
        isSolo: true,
        isStatic: true,
        badge: `Solo Static · ${coinLabel}`,
        shortTag: staticSymbols[0] ? coinLabel : 'Solo',
        title: 'Single Pinned Symbol (Static Solo)',
        subtitle: 'Monitors strictly 1 pinned pair without global market rotation.',
      };
    }
    return {
      mode: 'static_multi',
      isSolo: false,
      isStatic: true,
      badge: `Static Whitelist (${staticSymbols.length})`,
      shortTag: `Static ${staticSymbols.length}`,
      title: 'Static Watchlist Whitelist',
      subtitle: `Monitors ${staticSymbols.length || 0} manually selected pairs.`,
    };
  }

  if (watchlistSize === 1) {
    const rankNum = watchlistOffset + 1;
    let leaderType = 'Volume Leader';
    let shortPrefix = rankNum === 1 ? 'Top' : `Top#${rankNum}`;
    if (discoveryMode === 'loss_pct' || discoveryMode === 'losers' || (discoveryMode === 'change_pct' && entrySide === 'short')) {
      leaderType = `24h Loser #${rankNum}`;
      shortPrefix = rankNum === 1 ? 'Bottom' : `Btm#${rankNum}`;
    } else if (discoveryMode === 'change_pct') {
      leaderType = `24h Gainer #${rankNum}`;
      shortPrefix = rankNum === 1 ? 'Top' : `Top#${rankNum}`;
    } else if (discoveryMode === 'abs_change_pct') {
      leaderType = `24h Mover #${rankNum}`;
      shortPrefix = rankNum === 1 ? 'Mover' : `Mov#${rankNum}`;
    }

    return {
      mode: 'dynamic_solo',
      isSolo: true,
      isStatic: false,
      rankNum,
      leaderType,
      badge: `Solo #${rankNum} · ${leaderType}`,
      shortTag: shortPrefix,
      title: `Single Watchlist Leader (${leaderType})`,
      subtitle: 'Pinned 1-symbol scanner · 15s leaderboard refresh · Top-3 stream pre-warm.',
    };
  }

  let poolDesc = 'Volume';
  if (discoveryMode === 'change_pct') poolDesc = 'Gainers';
  else if (discoveryMode === 'loss_pct' || discoveryMode === 'losers') poolDesc = 'Losers';
  else if (discoveryMode === 'abs_change_pct') poolDesc = 'Movers';

  return {
    mode: 'dynamic_multi',
    isSolo: false,
    isStatic: false,
    badge: `Multi-Pair · Top ${watchlistSize} ${poolDesc}`,
    shortTag: `Top ${watchlistSize}`,
    title: `Multi-Pair Dynamic Watchlist (${watchlistSize} Pairs)`,
    subtitle: `Scans top ${watchlistSize} ${poolDesc.toLowerCase()} candidates concurrently.`,
  };
}

export function generateSmartStrategyName(cfg = {}, options = {}) {
  const maxLen = Math.max(
    10,
    Math.min(Number(options.maxLen) || STRATEGY_NAME_CHAR_LIMITS.STANDARD, STRATEGY_NAME_CHAR_LIMITS.MAX),
  );
  const style = options.style || 'standard'; // 'standard' | 'compact' | 'detailed'

  const scope = getWatchlistScopeDescriptor(cfg);
  const sigs = Array.isArray(cfg.enabled_signals) ? cfg.enabled_signals : [];
  const scanTf = String(cfg.scan_interval || '5m');
  const discoveryMode = String(cfg.discovery_mode || 'volume').toLowerCase();
  const entrySide = String(cfg.entry_side || 'both').toLowerCase();

  const tokens = [];

  // 1. Scope / Leader Prefix
  if (scope.mode === 'static_solo' && Array.isArray(cfg.symbols) && cfg.symbols[0]) {
    tokens.push(cfg.symbols[0].replace(/USDT$/i, ''));
  } else if (scope.mode === 'dynamic_solo') {
    const rankSuffix = scope.rankNum > 1 ? `${scope.rankNum}` : '';
    if (discoveryMode === 'loss_pct' || discoveryMode === 'losers' || entrySide === 'short') {
      tokens.push(style === 'compact' ? `Btm${rankSuffix}` : `Bottom${rankSuffix ? ' ' + rankSuffix : ''}`);
    } else if (discoveryMode === 'change_pct' || entrySide === 'long') {
      tokens.push(`Top${rankSuffix}`);
    } else if (discoveryMode === 'abs_change_pct') {
      tokens.push(`Solo${rankSuffix}`);
    } else {
      tokens.push(`TopVol${rankSuffix}`);
    }
  } else if (scope.mode === 'dynamic_multi' && style === 'detailed') {
    if (discoveryMode === 'change_pct') tokens.push(`Gain${cfg.watchlist_size || 15}`);
    else if (discoveryMode === 'loss_pct') tokens.push(`Loss${cfg.watchlist_size || 15}`);
  }

  // 2. Signal Tokens
  let includedTf = false;
  const hasHtfBreakout = sigs.some((s) => s.startsWith('htf_breakout') || s.startsWith('prev_day_breakout'));
  const hasEmaDual = sigs.some((s) => s.startsWith('ema_dual'));
  const hasSingleEma = sigs.some((s) => ['ema', 'ema_close', 'ema_cross', 'ema_price_cross'].some((b) => s === b || s.startsWith(`${b}_`)));
  const hasEngulfing = sigs.some((s) => s.startsWith('engulfing'));
  const hasSupertrend = sigs.some((s) => s.startsWith('supertrend'));
  const hasMacd = sigs.some((s) => s.startsWith('macd'));
  const hasKnife = sigs.some((s) => s.startsWith('knife_catch'));
  const hasBreakoutHl = sigs.some((s) => s.startsWith('breakout_hl'));

  if (hasHtfBreakout) {
    const refTf = String(readParam(cfg, 'htf_breakout_ref_timeframe', '1d')).toUpperCase();
    const refLevel = String(readParam(cfg, 'htf_breakout_reference_level', 'high_low'));
    const lvlToken = refLevel === 'open_close_body' ? 'Body' : refLevel === 'close_only' ? 'Cls' : 'hl';
    if (scope.mode === 'dynamic_solo') {
      tokens.push(lvlToken, refTf.toLowerCase());
    } else {
      tokens.push(refTf, lvlToken);
    }
    includedTf = true;
  }

  if (hasEmaDual) {
    const fast = readParam(cfg, 'entry_ema_fast', 9);
    const slow = readParam(cfg, 'entry_ema_slow', 21);
    if (style === 'compact') {
      tokens.push(`${fast}/${slow}E`);
    } else {
      tokens.push(`${fast} ${slow} ema`);
    }
  } else if (hasSingleEma) {
    const period = readParam(cfg, 'entry_ema_period', readParam(cfg, 'ema_period', 12));
    tokens.push(`EMA${period}`);
  }

  if (hasSupertrend) {
    const stPeriod = readParam(cfg, 'supertrend_period', 10);
    const stMult = readParam(cfg, 'supertrend_multiplier', 3);
    tokens.push(style === 'compact' ? 'ST' : `ST ${stPeriod}/${stMult}`);
  }

  if (hasEngulfing) {
    const streak = Number(readParam(cfg, 'engulfing_streak', 1));
    tokens.push(streak > 1 ? `Eng${streak}x` : 'Eng');
  }

  if (hasMacd) {
    const isPbc = sigs.some((s) => s.startsWith('macd_pbc'));
    tokens.push(isPbc ? 'MACD PBC' : 'MACD');
  }

  if (hasKnife) {
    tokens.push('Knife');
  }

  if (hasBreakoutHl && !hasHtfBreakout) {
    tokens.push(`Brk${cfg.scan_lookback || 3}`);
  }

  if (tokens.length === 0 || (sigs.length === 1 && sigs[0] === 'momentum_pct')) {
    tokens.push('Mom', `${cfg.scan_pct_threshold || 1}%`);
  }

  // 3. Timeframe or Risk/RR Suffix
  if (!includedTf || style === 'detailed') {
    tokens.push(scanTf);
  }

  if (style === 'detailed') {
    if (entrySide === 'long' && !tokens[0]?.toLowerCase().startsWith('top')) tokens.push('L');
    else if (entrySide === 'short' && !tokens[0]?.toLowerCase().startsWith('bottom') && !tokens[0]?.toLowerCase().startsWith('btm')) tokens.push('S');

    const tpRatio =
      cfg.tp_mode === 'exp_rr_seq' && Array.isArray(cfg.live_rr_sequence) && cfg.live_rr_sequence.length > 0
        ? cfg.live_rr_sequence[cfg.live_rr_sequence.length - 1]
        : cfg.tp_ratio;
    if (tpRatio) {
      tokens.push(`${tpRatio}R`);
    }
  }

  let candidate = tokens.filter(Boolean).join(' ');

  // If still over maxLen, progressively compact common phrases before truncating
  if (candidate.length > maxLen) {
    candidate = candidate
      .replace(/\bBottom\b/gi, 'Btm')
      .replace(/(\d+)\s+(\d+)\s+ema\b/gi, '$1/$2E')
      .replace(/\bEMA\s*/gi, 'E')
      .replace(/\bMACD PBC\b/gi, 'MPBC');
  }

  return truncateToCharLimit(candidate, maxLen);
}

export function generateSmartNameSuggestions(cfg = {}, maxLen = STRATEGY_NAME_CHAR_LIMITS.STANDARD) {
  const standard = generateSmartStrategyName(cfg, { maxLen, style: 'standard' });
  const compact = generateSmartStrategyName(cfg, {
    maxLen: Math.min(maxLen, STRATEGY_NAME_CHAR_LIMITS.COMPACT),
    style: 'compact',
  });
  const detailed = generateSmartStrategyName(cfg, { maxLen, style: 'detailed' });

  const unique = [];
  const seen = new Set();

  [
    { id: 'standard', label: 'Smart Default', value: standard },
    { id: 'compact', label: 'Compact', value: compact },
    { id: 'detailed', label: 'Detailed', value: detailed },
  ].forEach((item) => {
    if (item.value && !seen.has(item.value.toLowerCase())) {
      seen.add(item.value.toLowerCase());
      unique.push(item);
    }
  });

  return unique;
}
