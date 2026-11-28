import { formatDuration } from '../lib/formatters.js';

export function resolveTradingMode(source = null, explicitMode = null) {
  const rawExplicit = typeof explicitMode === 'string' ? explicitMode.trim().toLowerCase() : '';
  if (rawExplicit === 'live' || rawExplicit === 'paper' || rawExplicit === 'testnet') {
    return rawExplicit;
  }
  if (!source || typeof source !== 'object') return null;
  const rawMode = typeof (source.trading_mode ?? source.tradingMode) === 'string'
    ? String(source.trading_mode ?? source.tradingMode).trim().toLowerCase()
    : '';
  if (rawMode === 'live' || rawMode === 'paper' || rawMode === 'testnet') {
    return rawMode;
  }
  if (typeof source.paper_mode === 'boolean') {
    return source.paper_mode ? 'paper' : 'live';
  }
  if (typeof source.paperMode === 'boolean') {
    return source.paperMode ? 'paper' : 'live';
  }
  return null;
}

export function formatTradingModeLabel(mode) {
  const m = resolveTradingMode(null, mode);
  if (m === 'live') return 'Live';
  if (m === 'paper') return 'Paper';
  if (m === 'testnet') return 'Testnet';
  return '';
}

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

function parseExplicitAntiWhipsawTimeframes(strategyConfig = {}) {
  const raw = strategyConfig.anti_whipsaw_timeframes;
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map(s => String(s).trim()).filter(Boolean)));
  }
  if (typeof raw === 'string') {
    return Array.from(new Set(raw.split(',').map(s => s.trim()).filter(Boolean)));
  }
  return [];
}

export function resolveAntiWhipsawTimeframes(strategyConfig = {}) {
  const explicit = parseExplicitAntiWhipsawTimeframes(strategyConfig);
  if (explicit.length > 0) {
    return explicit;
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

function tradeMatchesMode(trade, targetMode) {
  if (!targetMode) return true;
  const tradeMode = resolveTradingMode(trade);
  if (!tradeMode) return true;
  return tradeMode === targetMode;
}

function buildAwMetadata(strategyConfig = {}, explicitMode = null) {
  const candleDelay = Math.max(0, Number(strategyConfig.anti_whipsaw_candle_delay ?? 1));
  const tfDelayMin = Math.max(0, Number(strategyConfig.anti_whipsaw_tf_delay_min ?? 0));
  const perStrategy = strategyConfig.anti_whipsaw_per_strategy !== false;
  const allowKnife = !!strategyConfig.anti_whipsaw_allow_knife;
  const strategyLabel = strategyConfig.strategy_label || 'Momentum Strategy';
  const explicit = parseExplicitAntiWhipsawTimeframes(strategyConfig);
  const explicitTimeframes = explicit.length > 0;
  const maxTf = strategyConfig.anti_whipsaw_max_tf || '4h';
  const timeframes = resolveAntiWhipsawTimeframes(strategyConfig);
  const scanTf = strategyConfig.scan_interval || '1m';
  const maxResolvedTfMs = timeframes.reduce((m, tf) => Math.max(m, timeframeToMs(tf)), 0);
  const disabled = candleDelay === 0 && tfDelayMin === 0;
  const engaged = !disabled;
  const maxPotentialLockMs = disabled
    ? 0
    : Math.max(tfDelayMin * 60 * 1000, candleDelay > 0 ? candleDelay * maxResolvedTfMs : 0);
  const hasSlowLockoutRisk = !disabled && candleDelay > 0 && !explicitTimeframes
    && timeframeToMs(scanTf) <= 15 * 60 * 1000
    && maxResolvedTfMs >= 60 * 60 * 1000;
  const scopeLabel = perStrategy ? 'Per-strategy' : 'Account-wide';
  const tradingMode = resolveTradingMode(strategyConfig, explicitMode);
  const tradingModeLabel = formatTradingModeLabel(tradingMode);

  return {
    candleDelay,
    tfDelayMin,
    perStrategy,
    allowKnife,
    strategyLabel,
    explicitTimeframes,
    maxTf,
    timeframes,
    scanTf,
    disabled,
    engaged,
    maxPotentialLockMs,
    hasSlowLockoutRisk,
    scopeLabel,
    tradingMode,
    tradingModeLabel,
  };
}

/**
 * Evaluates live Anti-Whipsaw re-entry readiness for a symbol and strategy config
 * using already-synced tradeHistory (strictly isolated to the active trading mode)
 * without triggering any API requests.
 */
export function evaluateAntiWhipsawStatus(symbol, strategyConfig = {}, closedTrades = [], nowMs = Date.now(), explicitMode = null) {
  const meta = buildAwMetadata(strategyConfig, explicitMode);
  const {
    candleDelay,
    tfDelayMin,
    perStrategy,
    allowKnife,
    strategyLabel,
    explicitTimeframes,
    maxTf,
    timeframes,
    disabled,
    engaged,
    maxPotentialLockMs,
    hasSlowLockoutRisk,
    scopeLabel,
    tradingMode,
    tradingModeLabel,
  } = meta;

  if (disabled) {
    return {
      status: 'disabled',
      statusLabel: 'DISABLED',
      disabled: true,
      engaged: false,
      locked: false,
      tradingMode,
      tradingModeLabel,
      timeframes,
      explicitTimeframes,
      maxTf,
      candleDelay,
      tfDelayMin,
      perStrategy,
      scopeLabel,
      allowKnife,
      maxPotentialLockMs: 0,
      hasSlowLockoutRisk: false,
      remainingMs: 0,
      expiresAtMs: 0,
      summary: 'Disabled (0c / 0m · re-entry unrestricted)',
    };
  }

  if (!symbol || symbol === '---' || !Array.isArray(closedTrades) || closedTrades.length === 0) {
    return {
      status: 'clear',
      statusLabel: 'READY',
      disabled: false,
      engaged,
      locked: false,
      tradingMode,
      tradingModeLabel,
      timeframes,
      explicitTimeframes,
      maxTf,
      candleDelay,
      tfDelayMin,
      perStrategy,
      scopeLabel,
      allowKnife,
      maxPotentialLockMs,
      hasSlowLockoutRisk,
      remainingMs: 0,
      expiresAtMs: 0,
      summary: `Ready (${candleDelay}c${tfDelayMin > 0 ? ` + ${tfDelayMin}m` : ''} on ${timeframes.join(', ')})`,
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
    if (!tradeMatchesMode(t, tradingMode)) continue;
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
      statusLabel: 'LOCKED',
      disabled: false,
      engaged,
      locked: true,
      tradingMode,
      tradingModeLabel,
      timeframes,
      explicitTimeframes,
      maxTf,
      candleDelay,
      tfDelayMin,
      perStrategy,
      scopeLabel,
      allowKnife,
      lastTradeWasKnife,
      blockingTf,
      blockingReason,
      maxPotentialLockMs,
      hasSlowLockoutRisk,
      remainingMs: longestRemainingMs,
      expiresAtMs: nowMs + longestRemainingMs,
      summary: `${blockingReason} · ${formatDuration(longestRemainingMs)} left`,
    };
  }

  return {
    status: 'clear',
    statusLabel: 'CLEAR',
    disabled: false,
    engaged,
    locked: false,
    tradingMode,
    tradingModeLabel,
    timeframes,
    explicitTimeframes,
    maxTf,
    candleDelay,
    tfDelayMin,
    perStrategy,
    scopeLabel,
    allowKnife,
    maxPotentialLockMs,
    hasSlowLockoutRisk,
    remainingMs: 0,
    expiresAtMs: 0,
    summary: `Clear (${candleDelay}c${tfDelayMin > 0 ? ` + ${tfDelayMin}m` : ''} on ${timeframes.join(', ')})`,
  };
}

/**
 * Summarizes live Anti-Whipsaw locks across all recently closed trades in scope
 * for the strategy (strictly isolated to the strategy's trading mode).
 */
export function evaluateStrategyAntiWhipsawLocks(strategyConfig = {}, closedTrades = [], nowMs = Date.now(), explicitMode = null) {
  const meta = buildAwMetadata(strategyConfig, explicitMode);
  const {
    candleDelay,
    tfDelayMin,
    perStrategy,
    allowKnife,
    strategyLabel,
    explicitTimeframes,
    maxTf,
    timeframes,
    disabled,
    engaged,
    maxPotentialLockMs,
    hasSlowLockoutRisk,
    scopeLabel,
    tradingMode,
    tradingModeLabel,
  } = meta;

  if (disabled) {
    return {
      status: 'disabled',
      statusLabel: 'DISABLED',
      disabled: true,
      engaged: false,
      tradingMode,
      tradingModeLabel,
      lockedCount: 0,
      locks: [],
      timeframes,
      explicitTimeframes,
      maxTf,
      candleDelay,
      tfDelayMin,
      perStrategy,
      scopeLabel,
      allowKnife,
      maxPotentialLockMs: 0,
      hasSlowLockoutRisk: false,
    };
  }

  const candidateSymbols = new Set();
  if (Array.isArray(closedTrades) && closedTrades.length > 0) {
    const cutoffMs = maxPotentialLockMs > 0 ? nowMs - maxPotentialLockMs - 60_000 : 0;
    for (let i = 0; i < closedTrades.length; i++) {
      const t = closedTrades[i];
      if (!t || !t.symbol) continue;
      const status = t.status;
      if (status === 'ENTRY_FAILED' || status === 'CANCELLED' || status === 'REJECTED' || t.is_reconciliation) continue;
      if (!tradeMatchesMode(t, tradingMode)) continue;
      if (perStrategy && t.strategy_label && t.strategy_label !== strategyLabel) continue;
      const relevantTs = Math.max(
        toMs(t.entry_ts || t.opened_at || t.created_at),
        toMs(t.exit_ts || t.closed_at),
      );
      if (relevantTs <= 0 || relevantTs < cutoffMs) continue;
      candidateSymbols.add(t.symbol);
    }
  }

  const locks = [];
  for (const sym of candidateSymbols) {
    const res = evaluateAntiWhipsawStatus(sym, strategyConfig, closedTrades, nowMs, tradingMode);
    if (res.locked) {
      locks.push({ symbol: sym, ...res });
    }
  }
  locks.sort((a, b) => (b.remainingMs || 0) - (a.remainingMs || 0));

  return {
    status: locks.length > 0 ? 'locked' : 'clear',
    statusLabel: locks.length > 0 ? 'LOCKED' : 'CLEAR',
    disabled: false,
    engaged,
    tradingMode,
    tradingModeLabel,
    lockedCount: locks.length,
    locks,
    timeframes,
    explicitTimeframes,
    maxTf,
    candleDelay,
    tfDelayMin,
    perStrategy,
    scopeLabel,
    allowKnife,
    maxPotentialLockMs,
    hasSlowLockoutRisk,
  };
}

/**
 * Evaluates Anti-Whipsaw engagement & lock state for the counterpart engine mode
 * (e.g. Paper when viewing Live, Live when viewing Paper) from cached/persisted snapshot data.
 */
export function evaluateCounterpartModeAntiWhipsaw({
  counterpartSnapshot = null,
  strategyLabel = 'Momentum Strategy',
  symbol = '---',
  nowMs = Date.now(),
  resolveVariantConfig = null,
} = {}) {
  const mode = counterpartSnapshot?.mode || null;
  const modeLabel = formatTradingModeLabel(mode) || 'Other';

  if (!counterpartSnapshot || !counterpartSnapshot.config) {
    return {
      mode,
      modeLabel,
      configured: false,
      sessionActive: false,
      synced: false,
      engaged: false,
      disabled: false,
      locked: false,
      symbolLocked: false,
      lockedCount: 0,
      remainingMs: 0,
      blockingSymbol: null,
      blockingReason: '',
      timeframes: [],
      candleDelay: 0,
      tfDelayMin: 0,
      statusText: 'Not synced',
    };
  }

  const baseCfg = counterpartSnapshot.config;
  let resolvedCfg = null;
  if (!strategyLabel || strategyLabel === baseCfg.strategy_label) {
    resolvedCfg = baseCfg;
  } else {
    const variant = Array.isArray(baseCfg.strategy_variants)
      ? baseCfg.strategy_variants.find(v => v && v.strategy_label === strategyLabel)
      : null;
    if (variant) {
      resolvedCfg = typeof resolveVariantConfig === 'function'
        ? resolveVariantConfig(baseCfg, variant)
        : { ...baseCfg, ...variant };
    }
  }

  if (!resolvedCfg) {
    return {
      mode,
      modeLabel,
      configured: false,
      sessionActive: Boolean(counterpartSnapshot.sessionActive),
      synced: Boolean(counterpartSnapshot.initialStatusLoaded || counterpartSnapshot.source === 'live_cache'),
      engaged: false,
      disabled: false,
      locked: false,
      symbolLocked: false,
      lockedCount: 0,
      remainingMs: 0,
      blockingSymbol: null,
      blockingReason: '',
      timeframes: [],
      candleDelay: 0,
      tfDelayMin: 0,
      statusText: 'Not in mode',
    };
  }

  const effectiveCfg = {
    ...resolvedCfg,
    ...(mode ? { trading_mode: mode, paper_mode: mode === 'paper' } : {}),
  };
  const sessionActive = Boolean(counterpartSnapshot.sessionActive);
  const synced = Boolean(counterpartSnapshot.initialStatusLoaded || counterpartSnapshot.source === 'live_cache');

  let modeTrades = [];
  if (sessionActive) {
    if (Array.isArray(counterpartSnapshot.sessionTradeHistory) && counterpartSnapshot.sessionTradeHistory.length > 0) {
      modeTrades = counterpartSnapshot.sessionTradeHistory;
    } else if (counterpartSnapshot.strategyId && Array.isArray(counterpartSnapshot.tradeHistory)) {
      modeTrades = counterpartSnapshot.tradeHistory.filter(
        t => (t?.sessionId || t?.session_id) === counterpartSnapshot.strategyId
      );
    }
  }

  const symStatus = evaluateAntiWhipsawStatus(symbol, effectiveCfg, modeTrades, nowMs, mode);
  const locks = evaluateStrategyAntiWhipsawLocks(effectiveCfg, modeTrades, nowMs, mode);
  const topLock = locks.locks[0] || null;
  const anyLocked = Boolean(symStatus.locked || locks.lockedCount > 0);
  const remainingMs = symStatus.locked ? symStatus.remainingMs : (topLock?.remainingMs || 0);
  const blockingSymbol = symStatus.locked ? symbol : (topLock?.symbol || null);
  const blockingReason = symStatus.locked ? symStatus.blockingReason : (topLock?.blockingReason || '');

  const ruleBrief = symStatus.disabled
    ? '0c / 0m'
    : `${symStatus.candleDelay}c${symStatus.tfDelayMin > 0 ? `+${symStatus.tfDelayMin}m` : ''} on ${symStatus.timeframes.join(', ')}`;

  let statusText;
  if (symStatus.disabled) {
    statusText = 'Disabled (0c / 0m)';
  } else if (anyLocked) {
    const symShort = blockingSymbol ? blockingSymbol.replace('USDT', '') : '';
    statusText = `Engaged · Locked${symShort ? ` ${symShort}` : ''} (${formatDuration(remainingMs)} left)`;
  } else if (!sessionActive) {
    statusText = `Engaged (${ruleBrief} · Standby)`;
  } else if (!synced) {
    statusText = `Engaged (${ruleBrief} · Active)`;
  } else {
    statusText = `Engaged (${ruleBrief} · Clear)`;
  }

  return {
    mode,
    modeLabel,
    configured: true,
    sessionActive,
    synced,
    engaged: !symStatus.disabled,
    disabled: symStatus.disabled,
    locked: anyLocked,
    symbolLocked: Boolean(symStatus.locked),
    lockedCount: locks.lockedCount,
    remainingMs,
    blockingSymbol,
    blockingReason,
    timeframes: symStatus.timeframes,
    candleDelay: symStatus.candleDelay,
    tfDelayMin: symStatus.tfDelayMin,
    summary: symStatus.summary,
    statusText,
  };
}
