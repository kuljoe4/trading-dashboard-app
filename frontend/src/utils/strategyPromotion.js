import { CONFIG_LIMITS } from '../constants/configLimits.js';
import { resolveStrategyConfig } from './strategyConfig.js';
import { isClosedValidTrade, getTradeExitMs } from './periodicPerformance.js';
import { formatStopLossDescriptor, formatTakeProfitDescriptor } from './strategySummary.js';

export const PAST_WEEK_WINDOW_DAYS = 7;

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

export function roundRiskPct(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}

export function formatRiskPct(value) {
  const rounded = roundRiskPct(value, 0);
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${Number(rounded.toFixed(2))}%`;
}

/**
 * Computes doubled `risk_pct_per_trade` and `max_total_risk_pct` for a strategy
 * while strictly upholding backend & CONFIG_LIMITS invariants:
 *  - risk_pct_per_trade in [0.01, 100.0]
 *  - max_total_risk_pct in [0.1, 100.0]
 *  - risk_pct_per_trade <= max_total_risk_pct
 */
export function computeDoubledRiskPlan(strategyCfg = {}) {
  const rawRisk = Number(strategyCfg?.risk_pct_per_trade);
  const rawMax = Number(strategyCfg?.max_total_risk_pct);

  const baselineRisk = Number.isFinite(rawRisk) && rawRisk > 0
    ? rawRisk
    : CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT;
  const baselineMax = Number.isFinite(rawMax) && rawMax > 0
    ? rawMax
    : CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT;

  const currentMaxTotalRisk = clamp(
    roundRiskPct(Math.max(baselineMax, baselineRisk), CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT),
    CONFIG_LIMITS.MAX_TOTAL_RISK_MIN,
    CONFIG_LIMITS.MAX_TOTAL_RISK_MAX
  );
  const currentRiskPerTrade = clamp(
    roundRiskPct(Math.min(baselineRisk, currentMaxTotalRisk), CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT),
    CONFIG_LIMITS.RISK_PER_TRADE_MIN,
    currentMaxTotalRisk
  );

  const uncappedNextMax = roundRiskPct(currentMaxTotalRisk * 2, currentMaxTotalRisk);
  const nextMaxTotalRisk = clamp(
    uncappedNextMax,
    CONFIG_LIMITS.MAX_TOTAL_RISK_MIN,
    CONFIG_LIMITS.MAX_TOTAL_RISK_MAX
  );

  const uncappedNextRisk = roundRiskPct(currentRiskPerTrade * 2, currentRiskPerTrade);
  const nextRiskPerTrade = clamp(
    Math.min(uncappedNextRisk, nextMaxTotalRisk),
    CONFIG_LIMITS.RISK_PER_TRADE_MIN,
    nextMaxTotalRisk
  );

  const maxRiskClampedByCap = uncappedNextMax > CONFIG_LIMITS.MAX_TOTAL_RISK_MAX;
  const riskClampedByCap = uncappedNextRisk > nextMaxTotalRisk;
  const canPromote =
    nextRiskPerTrade > currentRiskPerTrade || nextMaxTotalRisk > currentMaxTotalRisk;

  const riskHardeningEnabled = strategyCfg?.risk_hardening_enabled === true;
  const rawSingleCap = Number(strategyCfg?.max_single_trade_risk_pct);
  const maxSingleTradeRiskPct = Number.isFinite(rawSingleCap) && rawSingleCap > 0
    ? rawSingleCap
    : 20.0;
  const hardCapWarning = riskHardeningEnabled && nextRiskPerTrade > maxSingleTradeRiskPct;

  const currentConcurrentSlots = currentRiskPerTrade > 0
    ? Math.floor((currentMaxTotalRisk + 1e-6) / currentRiskPerTrade)
    : 0;
  const nextConcurrentSlots = nextRiskPerTrade > 0
    ? Math.floor((nextMaxTotalRisk + 1e-6) / nextRiskPerTrade)
    : 0;

  return {
    currentRiskPerTrade,
    currentMaxTotalRisk,
    nextRiskPerTrade,
    nextMaxTotalRisk,
    riskClampedByCap,
    maxRiskClampedByCap,
    canPromote,
    isAtMaxCap: !canPromote,
    riskHardeningEnabled,
    maxSingleTradeRiskPct,
    hardCapWarning,
    currentConcurrentSlots,
    nextConcurrentSlots,
  };
}

function getNormalizedConfigMode(cfg = {}) {
  if (cfg?.trading_mode) return String(cfg.trading_mode).toLowerCase();
  if (typeof cfg?.paper_mode === 'boolean') return cfg.paper_mode ? 'paper' : 'live';
  return 'paper';
}

function getNormalizedSessionMode(session = {}) {
  if (session?.tradingMode) return String(session.tradingMode).toLowerCase();
  if (session?.config?.trading_mode) return String(session.config.trading_mode).toLowerCase();
  if (typeof session?.paperMode === 'boolean') return session.paperMode ? 'paper' : 'live';
  return 'paper';
}

/**
 * Resolves the effective configuration and ownership metadata for a given strategy label
 * across active base config, active variants (inherited via resolveStrategyConfig), saved presets,
 * historical session snapshots, and trade records.
 */
export function resolveStrategyTargetConfig({
  strategyLabel,
  mode = null,
  activeConfig = {},
  presets = [],
  sessions = [],
  trades = [],
} = {}) {
  const label = String(strategyLabel || '').trim() || 'Momentum Strategy';
  const normLabel = label.toLowerCase();
  const normMode = mode && mode !== 'all' ? String(mode).toLowerCase() : null;

  const activeMode = getNormalizedConfigMode(activeConfig);
  const matchesActiveMode = !normMode || activeMode === normMode;

  const rawBaseLabel = String(activeConfig?.strategy_label || '').trim();
  const baseLabelNorm = rawBaseLabel.toLowerCase();
  const isBaseLabelMatch =
    (baseLabelNorm && baseLabelNorm === normLabel) ||
    (!rawBaseLabel && normLabel === 'momentum strategy');
  const isActiveBase = matchesActiveMode && isBaseLabelMatch;

  const variants = Array.isArray(activeConfig?.strategy_variants) ? activeConfig.strategy_variants : [];
  const rawVariantIndex = !isBaseLabelMatch
    ? variants.findIndex((v) => String(v?.strategy_label || '').trim().toLowerCase() === normLabel)
    : -1;
  const variantIndex = matchesActiveMode ? rawVariantIndex : -1;
  const isActiveVariant = variantIndex !== -1;

  const safePresets = Array.isArray(presets) ? presets.filter((p) => p && typeof p.name === 'string') : [];
  let matchedPreset = safePresets.find((p) => p.name.trim().toLowerCase() === normLabel) || null;
  if (!matchedPreset) {
    matchedPreset = safePresets.find((p) => {
      const pLabel = String(p.config?.strategy_label || '').trim().toLowerCase();
      if (pLabel !== normLabel) return false;
      return !normMode || getNormalizedConfigMode(p.config) === normMode;
    }) || safePresets.find((p) => String(p.config?.strategy_label || '').trim().toLowerCase() === normLabel) || null;
  }

  let matchedSession = null;
  let matchedSessionResolvedConfig = null;
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  for (let i = 0; i < safeSessions.length; i++) {
    const s = safeSessions[i];
    if (!s || !s.config) continue;
    if (normMode && getNormalizedSessionMode(s) !== normMode) continue;
    const sBaseLabel = String(s.strategy_label || s.strategyLabel || s.config?.strategy_label || '').trim().toLowerCase();
    if (sBaseLabel === normLabel) {
      matchedSession = s;
      matchedSessionResolvedConfig = s.config;
      break;
    }
    const sVariants = Array.isArray(s.config?.strategy_variants) ? s.config.strategy_variants : [];
    const sVariant = sVariants.find((v) => String(v?.strategy_label || '').trim().toLowerCase() === normLabel);
    if (sVariant) {
      matchedSession = s;
      matchedSessionResolvedConfig = {
        ...resolveStrategyConfig(s.config, sVariant),
        strategy_label: sVariant.strategy_label || label,
        strategy_variants: [],
      };
      break;
    }
  }

  let matchedTradeConfig = null;
  const safeTrades = Array.isArray(trades) ? trades : [];
  for (let i = 0; i < safeTrades.length; i++) {
    const t = safeTrades[i];
    if (!t || !t.strategy_config || typeof t.strategy_config !== 'object') continue;
    const tLabel = String(t.strategy_label || t.strategyLabel || t.strategy_config?.strategy_label || '').trim().toLowerCase();
    if (tLabel === normLabel) {
      matchedTradeConfig = t.strategy_config;
      break;
    }
  }

  let effectiveConfig;
  let configSource = 'fallback';
  if (isActiveBase) {
    effectiveConfig = activeConfig;
    configSource = 'active_base';
  } else if (isActiveVariant) {
    effectiveConfig = {
      ...resolveStrategyConfig(activeConfig, variants[variantIndex]),
      strategy_label: variants[variantIndex]?.strategy_label || label,
      strategy_variants: [],
    };
    configSource = 'active_variant';
  } else if (matchedPreset?.config) {
    effectiveConfig = matchedPreset.config;
    configSource = 'preset';
  } else if (matchedSessionResolvedConfig) {
    effectiveConfig = matchedSessionResolvedConfig;
    configSource = 'session';
  } else if (matchedTradeConfig) {
    effectiveConfig = matchedTradeConfig;
    configSource = 'trade';
  } else {
    effectiveConfig = {
      strategy_label: label,
      trading_mode: normMode || activeMode || 'paper',
      paper_mode: (normMode || activeMode || 'paper') === 'paper',
      risk_pct_per_trade: CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT,
      max_total_risk_pct: CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT,
    };
  }

  return {
    effectiveConfig,
    configSource,
    locationFlags: {
      isActiveBase,
      isActiveVariant,
      isActive: isActiveBase || isActiveVariant,
      variantIndex,
      activeConfigMode: activeMode,
      matchesActiveMode,
      matchedPreset,
      hasPreset: !!matchedPreset,
      matchedSession,
      targetMode: normMode || getNormalizedConfigMode(effectiveConfig),
    },
  };
}

/**
 * Aggregates closed, valid trades over the past N days (default 7 days) per strategy label,
 * attaching resolved strategy configs, SL/TP descriptors, and doubled-risk promotion plans.
 */
export function aggregatePastWeekStrategies({
  trades = [],
  sessions = [],
  activeConfig = {},
  presets = [],
  mode = 'paper',
  windowDays = PAST_WEEK_WINDOW_DAYS,
  nowTs = Date.now(),
} = {}) {
  const safeTrades = Array.isArray(trades) ? trades : [];
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const modeFilter = mode && mode !== 'all' ? String(mode).toLowerCase() : null;
  const windowMs = Math.max(1, Number(windowDays) || PAST_WEEK_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const windowStartMs = nowTs - windowMs;

  const sessionMap = new Map();
  for (let i = 0; i < safeSessions.length; i++) {
    const s = safeSessions[i];
    if (s?.id) sessionMap.set(s.id, s);
  }

  const buckets = new Map();
  let total7dPnl = 0;
  let total7dTrades = 0;

  for (let i = 0; i < safeTrades.length; i++) {
    const t = safeTrades[i];
    if (!isClosedValidTrade(t, modeFilter)) continue;

    const exitMs = getTradeExitMs(t);
    if (!exitMs || exitMs < windowStartMs) continue;

    const session = sessionMap.get(t.sessionId || t.session_id);
    const label = String(
      t.strategy_label ||
      t.strategyLabel ||
      t.strategy_config?.strategy_label ||
      session?.strategy_label ||
      session?.strategyLabel ||
      session?.config?.strategy_label ||
      'Momentum Strategy'
    ).trim() || 'Momentum Strategy';

    const pnl = Number(t.pnl || 0);
    if (!Number.isFinite(pnl)) continue;

    let entry = buckets.get(label);
    if (!entry) {
      entry = {
        strategyLabel: label,
        tradesCount: 0,
        wins: 0,
        losses: 0,
        scratches: 0,
        netPnl: 0,
        grossProfit: 0,
        grossLoss: 0,
        rrSum: 0,
        rrCount: 0,
        lastTradeTs: 0,
        trades: [],
      };
      buckets.set(label, entry);
    }

    entry.tradesCount += 1;
    entry.netPnl += pnl;
    if (pnl > 0) {
      entry.wins += 1;
      entry.grossProfit += pnl;
    } else if (pnl < 0) {
      entry.losses += 1;
      entry.grossLoss += Math.abs(pnl);
    } else {
      entry.scratches += 1;
    }

    const rrVal = Number(t.exit_rr ?? t.rr);
    if (Number.isFinite(rrVal)) {
      entry.rrSum += rrVal;
      entry.rrCount += 1;
    }
    if (exitMs > entry.lastTradeTs) {
      entry.lastTradeTs = exitMs;
    }
    entry.trades.push(t);

    total7dPnl += pnl;
    total7dTrades += 1;
  }

  const strategies = [];
  for (const entry of buckets.values()) {
    const winRate = entry.tradesCount > 0 ? (entry.wins / entry.tradesCount) * 100 : 0;
    const profitFactor = entry.grossLoss > 0
      ? entry.grossProfit / entry.grossLoss
      : (entry.grossProfit > 0 ? 99.99 : 0);
    const avgPnl = entry.tradesCount > 0 ? entry.netPnl / entry.tradesCount : 0;
    const avgR = entry.rrCount > 0 ? entry.rrSum / entry.rrCount : null;

    const resolved = resolveStrategyTargetConfig({
      strategyLabel: entry.strategyLabel,
      mode: modeFilter,
      activeConfig,
      presets,
      sessions: safeSessions,
      trades: entry.trades,
    });

    const riskPlan = computeDoubledRiskPlan(resolved.effectiveConfig);
    const slDesc = formatStopLossDescriptor(resolved.effectiveConfig);
    const tpDesc = formatTakeProfitDescriptor(resolved.effectiveConfig);

    strategies.push({
      strategyLabel: entry.strategyLabel,
      tradesCount: entry.tradesCount,
      wins: entry.wins,
      losses: entry.losses,
      scratches: entry.scratches,
      winRate,
      netPnl: entry.netPnl,
      grossProfit: entry.grossProfit,
      grossLoss: entry.grossLoss,
      profitFactor,
      avgPnl,
      avgR,
      lastTradeTs: entry.lastTradeTs,
      qualifiesForPromotion: entry.netPnl > 0,
      effectiveConfig: resolved.effectiveConfig,
      configSource: resolved.configSource,
      locationFlags: resolved.locationFlags,
      riskPlan,
      slDesc,
      tpDesc,
    });
  }

  strategies.sort((a, b) => {
    if (b.netPnl !== a.netPnl) return b.netPnl - a.netPnl;
    if (b.profitFactor !== a.profitFactor) return b.profitFactor - a.profitFactor;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.tradesCount !== a.tradesCount) return b.tradesCount - a.tradesCount;
    return a.strategyLabel.localeCompare(b.strategyLabel);
  });

  const ranked = strategies.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  return {
    strategies: ranked,
    summary: {
      totalStrategies: ranked.length,
      profitableCount: ranked.filter((s) => s.qualifiesForPromotion).length,
      total7dPnl,
      total7dTrades,
      windowStartMs,
      windowEndMs: nowTs,
    },
  };
}

export function applyDoubledRiskToConfig(cfg = {}, riskPlan) {
  const plan = riskPlan || computeDoubledRiskPlan(cfg);
  return {
    ...(cfg && typeof cfg === 'object' ? cfg : {}),
    risk_pct_per_trade: plan.nextRiskPerTrade,
    max_total_risk_pct: plan.nextMaxTotalRisk,
  };
}

function sanitizeStandaloneConfig(cfg = {}, strategyLabel) {
  const clone = { ...(cfg && typeof cfg === 'object' ? cfg : {}) };
  delete clone.paused;
  delete clone.paused_strategies;
  delete clone.__flattened;
  if (strategyLabel) clone.strategy_label = strategyLabel;
  clone.strategy_variants = [];
  return clone;
}

/**
 * Builds an immutable patch + merged config update for the active Zustand/session config
 * when promoting a strategy (active base, active variant, or optionally activating an inactive one).
 */
export function buildActiveConfigPromotionUpdate({
  activeConfig = {},
  strategyLabel,
  riskPlan,
  fallbackConfig = null,
  activateIfInactive = false,
  activationMode = 'variant', // 'variant' | 'base'
} = {}) {
  const label = String(strategyLabel || '').trim() || 'Momentum Strategy';
  const normLabel = label.toLowerCase();
  const plan = riskPlan || computeDoubledRiskPlan(fallbackConfig || activeConfig);
  const rawBaseLabel = String(activeConfig?.strategy_label || '').trim();
  const baseLabelNorm = rawBaseLabel.toLowerCase();
  const isBaseMatch =
    (baseLabelNorm && baseLabelNorm === normLabel) ||
    (!rawBaseLabel && normLabel === 'momentum strategy');

  if (isBaseMatch) {
    const patch = {
      risk_pct_per_trade: plan.nextRiskPerTrade,
      max_total_risk_pct: plan.nextMaxTotalRisk,
    };
    return {
      updatedConfig: { ...activeConfig, ...patch },
      patch,
      appliedAs: 'base',
      variantIndex: -1,
      cappedVariants: false,
    };
  }

  const currentVariants = Array.isArray(activeConfig?.strategy_variants)
    ? activeConfig.strategy_variants.filter(Boolean)
    : [];
  const variantIdx = currentVariants.findIndex(
    (v) => String(v?.strategy_label || '').trim().toLowerCase() === normLabel
  );

  if (variantIdx !== -1) {
    const resolvedVariantBase = resolveStrategyConfig(activeConfig, currentVariants[variantIdx]);
    const nextVariant = {
      ...currentVariants[variantIdx],
      ...applyDoubledRiskToConfig(resolvedVariantBase, plan),
      strategy_label: currentVariants[variantIndexName(currentVariants, variantIdx)]?.strategy_label || label,
      strategy_variants: [],
    };
    const nextVariants = currentVariants.map((v, idx) => (idx === variantIdx ? nextVariant : v));
    const patch = { strategy_variants: nextVariants };
    return {
      updatedConfig: { ...activeConfig, strategy_variants: nextVariants },
      patch,
      appliedAs: 'variant',
      variantIndex: variantIdx,
      cappedVariants: false,
    };
  }

  if (!activateIfInactive) {
    return {
      updatedConfig: activeConfig,
      patch: null,
      appliedAs: 'none',
      variantIndex: -1,
      cappedVariants: false,
    };
  }

  const source = fallbackConfig || activeConfig;
  const promotedStandalone = applyDoubledRiskToConfig(
    sanitizeStandaloneConfig(source, label),
    plan
  );

  if (activationMode === 'base') {
    const remainingVariants = currentVariants.filter(
      (v) => String(v?.strategy_label || '').trim().toLowerCase() !== normLabel
    );
    const updatedConfig = {
      ...activeConfig,
      ...promotedStandalone,
      strategy_label: label,
      strategy_variants: remainingVariants,
    };
    delete updatedConfig.paused;
    delete updatedConfig.paused_strategies;
    return {
      updatedConfig,
      patch: updatedConfig,
      appliedAs: 'activated_base',
      variantIndex: -1,
      cappedVariants: false,
    };
  }

  if (currentVariants.length >= CONFIG_LIMITS.MAX_VARIANTS) {
    return {
      updatedConfig: activeConfig,
      patch: null,
      appliedAs: 'none',
      variantIndex: -1,
      cappedVariants: true,
    };
  }

  const nextVariants = [...currentVariants, promotedStandalone];
  const patch = { strategy_variants: nextVariants };
  return {
    updatedConfig: { ...activeConfig, strategy_variants: nextVariants },
    patch,
    appliedAs: 'activated_variant',
    variantIndex: nextVariants.length - 1,
    cappedVariants: false,
  };
}

function variantIndexName(list, idx) {
  return idx >= 0 && idx < list.length ? idx : 0;
}

/**
 * Builds a clean preset payload ready for `presetsAPI.save(name, payload, { overwrite: true })`.
 * Preserves existing preset structure/variants when updating an existing preset, and strips
 * nested variants when promoting a standalone strategy or active variant into a preset.
 */
export function buildPromotedPresetPayload({
  preset = null,
  fallbackConfig = {},
  strategyLabel,
  riskPlan,
} = {}) {
  const label = String(preset?.name || strategyLabel || fallbackConfig?.strategy_label || 'Promoted Strategy').trim();
  const baseSource = preset?.config && typeof preset.config === 'object'
    ? preset.config
    : fallbackConfig;
  const plan = riskPlan || computeDoubledRiskPlan(baseSource);

  const nextPayload = applyDoubledRiskToConfig(baseSource, plan);
  delete nextPayload.paused;
  delete nextPayload.paused_strategies;
  delete nextPayload.__flattened;
  nextPayload.strategy_label = label;

  if (preset?.config && Array.isArray(preset.config.strategy_variants)) {
    nextPayload.strategy_variants = preset.config.strategy_variants
      .filter(Boolean)
      .map((v) => sanitizeStandaloneConfig(v, v.strategy_label || 'Variant'));
  } else {
    nextPayload.strategy_variants = [];
  }

  return {
    name: label,
    payload: nextPayload,
    isExistingPreset: !!preset,
  };
}
