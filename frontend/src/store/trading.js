import { createWithEqualityFn } from 'zustand/traditional'
import { persist, createJSONStorage } from 'zustand/middleware'
import { sessionAPI, normalizeUrl } from '../api/client.js'
import { CONFIG_LIMITS, ENGINE_CONSTANTS } from '../constants/configLimits.js'
import { applyTheme } from '../lib/theme.js'

const toNumber = (v, f = 0) => { const p = Number(v); return Number.isFinite(p) ? p : f; }
const MAX_LOG_LINES = 500;
const DEFAULT_LOG_FILTERS = { info: true, warn: true, error: true };

// Anti-flicker metric resolver: prevents transient 0/null/undefined payloads from zero-resetting active store values
const resolveNonZeroMetric = (nextVal, currentVal, isResuming = false) => {
  if (nextVal !== undefined && nextVal !== null) {
    const num = toNumber(nextVal);
    if (num !== 0 || !isResuming || currentVal === 0) return num;
    return currentVal;
  }
  return currentVal ?? 0;
};

const getObjectSource = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export const normalizeOpportunity = (o = {}, prev = null) => {
  if (!o || typeof o !== 'object') return null;
  const source = getObjectSource(o);
  const m = toNumber(source.pct ?? source.momentum ?? source.percent_change);
  const rawDir = source.dir ?? source.direction ?? (m >= 0 ? 'long' : 'short');
  const d = String(rawDir ?? (m >= 0 ? 'long' : 'short')).toLowerCase();

  // SEC: Strict property picking and input sanitization to harden against prototype pollution or malformed WebSocket payloads.
  const res = {
    symbol: String(source.symbol ?? '---').replace(/[^A-Z0-9]/gi, '').substring(0, 20),
    pct: m,
    momentum: m,
    dir: d,
    direction: d,
    vol: toNumber(source.vol ?? source.volume ?? source.volume_usdt ?? source.volume_24h),
    score: toNumber(source.score),
    price: toNumber(source.price),
    volume_rank: source.volume_rank ? parseInt(String(source.volume_rank), 10) : undefined,
    history: Array.isArray(source.history) ? source.history.map(v => toNumber(v)) : undefined,
    ohlc_history: Array.isArray(source.ohlc_history) ? source.ohlc_history.map(c => {
      const candle = getObjectSource(c);
      return {
        time: toNumber(candle.time ?? candle.t),
        open: toNumber(candle.open ?? candle.o),
        high: toNumber(candle.high ?? candle.h),
        low: toNumber(candle.low ?? candle.l),
        close: toNumber(candle.close ?? candle.c),
        volume: toNumber(candle.volume ?? candle.q)
      };
    }) : undefined,
    score_breakdown: source.score_breakdown && typeof source.score_breakdown === 'object' ? {
      momentum: toNumber(source.score_breakdown.momentum),
      volatility: toNumber(source.score_breakdown.volatility),
      trend: toNumber(source.score_breakdown.trend)
    } : undefined,
    lastUpdate: source.last_update ?? source.ts ?? Date.now(),
    signalResult: source.signalResult && typeof source.signalResult === 'object' ? {
      allFired: !!source.signalResult.allFired,
      firedSignals: Array.isArray(source.signalResult.firedSignals) ? source.signalResult.firedSignals.map(s => String(s)) : [],
      signals: (source.signalResult.signals || source.signalResult.details) && typeof (source.signalResult.signals || source.signalResult.details) === 'object' ? Object.entries(source.signalResult.signals || source.signalResult.details).reduce((acc, [key, s]) => {
        acc[key] = {
          ...s,
          label: String(s.label || key),
          value: toNumber(s.value),
          threshold: toNumber(s.threshold),
          unit: String(s.unit || ''),
          fired: !!s.fired,
          active: s.active !== false,
          remaining_delay: toNumber(s.remaining_delay),
          config_delay: toNumber(s.config_delay),
            insufficientData: !!s.insufficientData,
            streak_start_ts: s.streak_start_ts ? toNumber(s.streak_start_ts) : undefined,
            streak_end_ts: s.streak_end_ts ? toNumber(s.streak_end_ts) : undefined,
            slPrice: s.slPrice ? toNumber(s.slPrice) : undefined,
            pattern_low: s.pattern_low ? toNumber(s.pattern_low) : undefined,
            pattern_high: s.pattern_high ? toNumber(s.pattern_high) : undefined,
            body_low: s.body_low ? toNumber(s.body_low) : undefined,
            body_high: s.body_high ? toNumber(s.body_high) : undefined
        };
        return acc;
      }, {}) : {},
      reason: String(source.signalResult.reason || '').substring(0, 200)
    } : undefined
  };

  // DEBUG: Track state inconsistencies where logic says "satisfied" but data shows 0 signals
  if (res.signalResult?.allFired && res.signalResult.firedSignals.length === 0) {
    console.warn(`[Normalization Warning] ${res.symbol}: Condition satisfied but firedSignals is empty. Check backend signal detail resolution.`);
  }

  // BOLT OPTIMIZATION: fingerprint-gated reference reuse.
  // Scanner broadcasts arrive more frequently than trade ticks, and the previous implementation
  // allocated a brand-new object on every broadcast, defeating React.memo on ScannerRow. We now
  // compute a cheap fingerprint over the display-relevant fields and reuse the previous object
  // reference when nothing meaningful changed, so unchanged rows skip re-rendering.
  // history/ohlc_history/score_breakdown/signalResult are intentionally NOT in the fingerprint:
  // they are slow-changing telemetry retained from the previous object when the new payload omits
  // them (gated/partial updates), exactly like normalizeTrade's _fingerprint retention.
  const sig = res.signalResult;
  const sigDigest = sig ? `${sig.allFired ? 1 : 0}|${(sig.firedSignals || []).join(',')}|${sig.reason}` : '';
  const sb = res.score_breakdown;
  const sbDigest = sb ? `${sb.momentum}:${sb.volatility}:${sb.trend}` : '';
  const f = `${res.symbol}:${res.pct}:${res.momentum}:${res.dir}:${res.vol}:${res.score}:${res.price}:${res.volume_rank}:${sbDigest}:${sigDigest}`;
  if (prev && prev._fingerprint === f && !o._delta && !o._thin) {
    return prev;
  }

  res._fingerprint = f;
  if (prev) {
    if (!res.history || res.history.length === 0) res.history = prev.history;
    if (!res.ohlc_history || res.ohlc_history.length === 0) res.ohlc_history = prev.ohlc_history;
    if (!res.score_breakdown) res.score_breakdown = prev.score_breakdown;
    if (!res.signalResult) res.signalResult = prev.signalResult;
  }
  return res;
}

export const normalizeTrade = (t = {}, pt = null, isResuming = false) => {
  if (!t || typeof t !== 'object') return null;
  const p = pt || {};

  // BOLT: Parse signal status from compressed JSON if present in tick
  let sigStatus = t.exit_signals_status;
  if (!sigStatus && t._sig_json) {
    try { sigStatus = JSON.parse(t._sig_json); } catch (e) {}
  }

  const f = `${t.pnl}:${t.rr}:${t.current_price}:${t.sl_price}:${t.close_blocked}:${t.illiquid_blocked}:${t.qty}:${t.max_rr_achieved}`;
  if (p._fingerprint === f && !t._delta && !t._thin && !t._sig_json) return p;
  if (t._delta || t._thin) {
    const ep = toNumber(t.entry_price ?? p.entry_price);
    const cp = toNumber(t.current_price ?? p.current_price ?? ep, ep);
    const isLong = (t.direction ?? p.direction ?? '').toString().toUpperCase() === 'LONG';
    const calculatedPnlPct = ep > 0 ? ((cp - ep) / ep) * 100 * (isLong ? 1 : -1) : 0;

    // BOLT OPTIMIZATION: Pre-calculate exit_ts_ms and entry_ts_ms to avoid redundant parsing inside sort comparators and analytics.
    const exit_ts = t.exit_ts ?? p.exit_ts;
    const entry_ts = t.entry_ts ?? p.entry_ts;
    const createdAt = t.createdAt ?? p.createdAt;
    const exit_ts_ms = exit_ts ? new Date(exit_ts).getTime() : (createdAt ? new Date(createdAt).getTime() : 0);
    const entry_ts_ms = entry_ts ? new Date(entry_ts).getTime() : (createdAt ? new Date(createdAt).getTime() : 0);

    const rawPnl = t.pnl !== undefined ? toNumber(t.pnl) : p.pnl;
    const pnl = resolveNonZeroMetric(rawPnl, p.pnl, isResuming);

    const rawRr = t.rr !== undefined ? toNumber(t.rr) : p.rr;
    const rr = resolveNonZeroMetric(rawRr, p.rr, isResuming);

    const rawMaxRr = (t.max_rr !== undefined && t.max_rr !== null) ? toNumber(t.max_rr) : (t.max_rr_achieved !== undefined ? toNumber(t.max_rr_achieved) : p.max_rr);
    const max_rr = resolveNonZeroMetric(rawMaxRr, p.max_rr, isResuming);

    const rawMaxRrAchieved = (t.max_rr_achieved !== undefined && t.max_rr_achieved !== null) ? toNumber(t.max_rr_achieved) : (t.max_rr !== undefined ? toNumber(t.max_rr) : p.max_rr_achieved);
    const max_rr_achieved = resolveNonZeroMetric(rawMaxRrAchieved, p.max_rr_achieved, isResuming);

    const rawEstPnl = t.est_pnl_to_realize !== undefined ? toNumber(t.est_pnl_to_realize) : p.est_pnl_to_realize;
    const est_pnl_to_realize = resolveNonZeroMetric(rawEstPnl, p.est_pnl_to_realize, isResuming);

    const rawExitRr = t.exit_rr !== undefined ? toNumber(t.exit_rr) : p.exit_rr;
    const exit_rr = resolveNonZeroMetric(rawExitRr, p.exit_rr, isResuming);

    const rawMinRr = t.min_rr_achieved !== undefined ? toNumber(t.min_rr_achieved) : p.min_rr_achieved;
    const min_rr_achieved = resolveNonZeroMetric(rawMinRr, p.min_rr_achieved, isResuming);

    return {
      ...p, ...t,
      pnl,
      pnl_pct: t.pnl_pct !== undefined ? toNumber(t.pnl_pct) : (p.pnl_pct !== undefined ? toNumber(p.pnl_pct) : calculatedPnlPct),
      rr,
      current_price: t.current_price !== undefined ? toNumber(t.current_price) : p.current_price,
      sl_price: t.sl_price !== undefined ? toNumber(t.sl_price) : p.sl_price,
      max_rr,
      max_rr_achieved,
      est_pnl_to_realize,
      est_pnl_source: t.est_pnl_source !== undefined ? t.est_pnl_source : p.est_pnl_source,
      exit_rr,
      min_rr_achieved,
      entry_price: t.entry_price !== undefined ? toNumber(t.entry_price) : p.entry_price,
      qty: t.qty !== undefined ? toNumber(t.qty) : p.qty,
      exit_signals_status: sigStatus || p.exit_signals_status || {},
      strategy_config: t.strategy_config || p.strategy_config,
      live_rr_sequence: t.live_rr_sequence || p.live_rr_sequence,
      exit_rr_sequence: t.exit_rr_sequence || p.exit_rr_sequence,
      sl_adjustments: t.sl_adjustments || p.sl_adjustments,
      exit_signal_logic: t.exit_signal_logic || p.exit_signal_logic,
      tp_mode: t.tp_mode || p.tp_mode,
      tp_ratio: t.tp_ratio !== undefined ? toNumber(t.tp_ratio) : p.tp_ratio,
      mark_price: t.mark_price !== undefined ? toNumber(t.mark_price) : p.mark_price,
      last_price: t.last_price !== undefined ? toNumber(t.last_price) : p.last_price,
      realized_fee: t.realized_fee !== undefined ? toNumber(t.realized_fee) : p.realized_fee,
      funding_fee: t.funding_fee !== undefined ? toNumber(t.funding_fee) : p.funding_fee,
      is_reconciliation: t.is_reconciliation ?? p.is_reconciliation,
      exit_ts_ms,
      entry_ts_ms
    };
  }
  const ep = toNumber(t.entry_price ?? t.entry ?? p.entry_price);
  const cp = toNumber(t.current_price ?? t.current ?? p.current_price ?? t.exit_price ?? ep, ep);
  const isLong = (t.direction ?? t.side ?? p.direction ?? '').toString().toUpperCase() === 'LONG';
  const calculatedPnlPct = ep > 0 ? ((cp - ep) / ep) * 100 * (isLong ? 1 : -1) : 0;
  const pnlPct = t.pnl_pct !== undefined ? toNumber(t.pnl_pct) : (p.pnl_pct !== undefined ? toNumber(p.pnl_pct) : calculatedPnlPct);

  // BOLT OPTIMIZATION: Pre-calculate exit_ts_ms and entry_ts_ms to avoid redundant parsing inside sort comparators and analytics.
  const exit_ts = t.exit_ts ?? p.exit_ts;
  const entry_ts = t.entry_ts ?? p.entry_ts;
  const createdAt = t.createdAt ?? p.createdAt;
  const exit_ts_ms = exit_ts ? new Date(exit_ts).getTime() : (createdAt ? new Date(createdAt).getTime() : 0);
  const entry_ts_ms = entry_ts ? new Date(entry_ts).getTime() : (createdAt ? new Date(createdAt).getTime() : 0);

  const rawPnl = t.pnl !== undefined ? toNumber(t.pnl) : p.pnl ?? 0;
  const pnl = resolveNonZeroMetric(rawPnl, p.pnl ?? 0, isResuming);

  const rawRr = t.rr !== undefined ? toNumber(t.rr) : p.rr ?? 0;
  const rr = resolveNonZeroMetric(rawRr, p.rr ?? 0, isResuming);

  const maxRrVal = toNumber(t.max_rr ?? t.max_rr_achieved ?? p.max_rr ?? p.max_rr_achieved ?? 0);
  const max_rr = resolveNonZeroMetric(maxRrVal, p.max_rr ?? p.max_rr_achieved ?? 0, isResuming);

  const rawEstPnl = t.est_pnl_to_realize !== undefined ? toNumber(t.est_pnl_to_realize) : p.est_pnl_to_realize ?? 0;
  const est_pnl_to_realize = resolveNonZeroMetric(rawEstPnl, p.est_pnl_to_realize ?? 0, isResuming);

  const rawExitRr = t.exit_rr !== undefined ? toNumber(t.exit_rr) : p.exit_rr ?? 0;
  const exit_rr = resolveNonZeroMetric(rawExitRr, p.exit_rr ?? 0, isResuming);

  const rawMinRr = t.min_rr_achieved !== undefined ? toNumber(t.min_rr_achieved) : p.min_rr_achieved ?? 0;
  const min_rr_achieved = resolveNonZeroMetric(rawMinRr, p.min_rr_achieved ?? 0, isResuming);

  return { ...t, symbol: t.symbol ?? p.symbol ?? '---', strategy_label: t.strategy_label ?? p.strategy_label ?? 'Momentum Strategy', direction: (t.direction ?? t.side ?? p.direction ?? '').toString().toUpperCase(), entry_price: ep, current_price: cp, sl_price: toNumber(t.sl_price ?? t.current_sl ?? t.sl ?? t.initial_sl ?? p.sl_price), initial_sl: toNumber(t.initial_sl ?? t.sl_price ?? t.sl ?? p.initial_sl), tp_price: t.tp_price == null && t.tp == null ? p.tp_price ?? null : toNumber(t.tp_price ?? t.tp), pnl, pnl_pct: pnlPct, rr, max_rr, est_pnl_to_realize, est_pnl_source: t.est_pnl_source ?? p.est_pnl_source ?? 'sl', exit_rr, min_rr_achieved, live_rr_sequence: t.live_rr_sequence || p.live_rr_sequence || [], exit_rr_sequence: t.exit_rr_sequence || p.exit_rr_sequence || [], tp_mode: t.tp_mode || p.tp_mode || (t.tp_price == null && t.tp == null ? 'exp_rr_seq' : 'fixed'), tp_ratio: (t.tp_ratio !== undefined) ? toNumber(t.tp_ratio, 2) : p.tp_ratio ?? 0, sl_adjustments: t.sl_adjustments || p.sl_adjustments || [], exit_reason: t.exit_reason ?? p.exit_reason, exit_price: t.exit_price == null ? (p.exit_price == null ? undefined : toNumber(p.exit_price)) : toNumber(t.exit_price), paper_mode: t.paper_mode ?? p.paper_mode ?? true, qty: toNumber(t.qty ?? t.quantity ?? p.qty ?? 0), max_rr_achieved: max_rr, exit_signals_status: sigStatus || p.exit_signals_status || {}, strategy_config: t.strategy_config || p.strategy_config, _fingerprint: f, exit_ts_ms, entry_ts_ms };
}

const deepMerge = (target, source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return source;

  const output = { ...target };
  Object.keys(source).forEach(key => {
    if (source[key] instanceof Object && !Array.isArray(source[key]) && key in target) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  });
  return output;
};

export const resolveVariantConfig = (config, strategyLabel) => {
  if (!config) return {};
  if (!strategyLabel) return config;
  const idx = config.strategy_variants?.findIndex(v => v.strategy_label === strategyLabel);
  return (idx !== -1 && idx !== undefined)
    ? { ...config, ...config.strategy_variants[idx] }
    : config;
};

export const normalizeLog = (l = {}) => {
  if (!l || typeof l !== 'object') return null;
  const source = getObjectSource(l);
  const lv = (source.level ?? source.lv ?? 'info').toString().toLowerCase();
  const m = (source.msg ?? source.message ?? '').toString().trim();
  return {
    ...source,
    id: source.id || Math.random().toString(36).substring(2, 15),
    ts: source.ts || source.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    level: ['info', 'warn', 'error'].includes(lv) ? lv : 'info',
    msg: m
  };
}

const defaultConfig = {
  paper_mode: true,
  strategy_label: 'Momentum Strategy',
  strategy_variants: [],
  max_total_risk_pct: CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT,
  total_sl_guard_usdt: CONFIG_LIMITS.TOTAL_SL_GUARD_DEFAULT,
  scan_interval: '5m',
  scan_pct_threshold: 2.0,
  scan_lookback: 3,
  scan_min_volume_usdt: 500000,
  scan_mode: 'interval',
  scan_window_duration_sec: 90,
  scan_check_interval_sec: 5,
  entry_side: 'both',
  watchlist_size: CONFIG_LIMITS.WATCHLIST_DEFAULT,
  watchlist_offset: 0,
  discovery_mode: 'volume',
  enabled_signals: ['momentum_pct'],
  signal_logic: 'all',
  required_signals: [],
  tp_mode: 'fixed',
  tp_ratio: CONFIG_LIMITS.TP_RATIO_DEFAULT,
  live_rr_sequence: [1, 2, 4],
  exit_rr_sequence: [0, 1, 2],
  sl_type: 'pct',
  sl_distance_pct: CONFIG_LIMITS.SL_DISTANCE_DEFAULT,
  sl_lookback_timeframe: '5m',
  sl_lookback_period: 5,
  sl_min_pct: 0.3,
  sl_max_pct: 3,
  trading_mode: localStorage.getItem('global_trading_mode') || 'paper',
  risk_pct_per_trade: CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT,
  max_open_trades: CONFIG_LIMITS.MAX_OPEN_TRADES_DEFAULT,
  max_trades_per_period: 10,
  trades_period_min: 60,
  max_trades_24h: CONFIG_LIMITS.MAX_TRADES_24H_DEFAULT,
  min_trade_interval_min: CONFIG_LIMITS.MIN_TRADE_INTERVAL_DEFAULT,
  trades_jitter_pct: CONFIG_LIMITS.TRADES_JITTER_DEFAULT,
  frequency_shaping_enabled: false,
  frequency_tod_integration: false,
  paper_starting_balance: CONFIG_LIMITS.PAPER_STARTING_BALANCE_DEFAULT,
  testnet_starting_balance: 10000.0,
  live_starting_balance: CONFIG_LIMITS.LIVE_STARTING_BALANCE_DEFAULT,
  hot_loop_interval_ms: CONFIG_LIMITS.HOT_LOOP_DEFAULT,
  main_loop_interval_ms: CONFIG_LIMITS.MAIN_LOOP_DEFAULT,
  slippage_warning_threshold: CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT || 0.001,
  auto_scale_min_notional: true,
  hibernation_mode: 'adaptive',
  debug_mode: typeof localStorage !== 'undefined' && localStorage.getItem('global_debug_mode') === 'true',
  smart_watchlist_enabled: false,
  smart_watchlist_sensitivity: 0.7,
  trailing_stop_enabled: false,
  trailing_stop_distance_pct: 1.0,
  release_risk_on_est_pnl_be: false,
  scanner_weights: {
    momentum: 0.5,
    volatility: 0.3,
    trend: 0.2
  },
  sl_out_of_bounds_action: 'clamp',
};

export const useTradingStore = createWithEqualityFn(persist((set, get) => ({
  sessionActive: false, sessionPaused: false, pausedStrategies: [], strategyGateStates: {}, strategyId: null, balance: 10000, totalPnl: 0, totalRiskPct: 0, totalSlUsed: 0, totalEstPnlToRealize: 0,
  activeTrades: [], logs: [], logFilters: DEFAULT_LOG_FILTERS, scannerResults: [], variantScannerResults: {}, variantStats: {}, activeWindows: [], tradeHistory: [], lifetimeAnalytics: null,
  gateState: null, gateReason: null, nextSlotTs: null, hibernating: false, hibernationMode: 'adaptive', isAdaptiveTightened: false, agreementRequired: false, scannerPaused: false, lastScanTs: 0, lastAuthoritativeUpdateTs: 0, wsStatus: 'offline', sessionList: [], monitoring: null, isEcoMode: false, analytics: null,
  apiStatus: { isBanned: false, isRateLimited: false, banUntil: null, lastErrorMessage: null },
  tradesInPeriod: undefined, maxTradesPeriod: undefined, tradesIn24h: undefined, maxTrades24h: undefined,
  effectivePeriodMs: undefined, jitterFactor: undefined,
  entryCount: 0, hitCount: 0,
  alerts: [],
  isSyncing: false, isSyncingOnResume: false, configSyncing: false,
  debugToolsEnabled: localStorage.getItem('debug_tools_enabled') === 'true',
  rateLimit: { used_weight_1m: 0, limit: ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT, used_pct: 0 },
  rateLimitLastSync: new Date().toISOString(),
  config: defaultConfig,
  sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true', 
  healthEnabled: localStorage.getItem('health_enabled') !== 'false',
  streamingEnabled: localStorage.getItem('streaming_enabled') !== 'false',
  isThrottled: false, entryCount: 0, hitCount: 0,
  theme: 'default',
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
  },

  addAlert: (alert) => {
     const now = Date.now();
     const id = Math.random().toString(36).substring(2, 11);
     const newAlert = { id, ts: now, level: 'info', ...alert };

     set(st => {
       const alerts = st.alerts || [];
       const existing = alerts.find(a => a.title === newAlert.title && a.message === newAlert.message && (now - a.ts < 5000));
       if (existing) {
          return { alerts: alerts.map(a => a.id === existing.id ? { ...a, ts: now, count: (a.count || 1) + 1 } : a) };
       }
       return { alerts: [newAlert, ...alerts].slice(0, 10) };
     });
  },

  removeAlert: (targetId) => {
    set(st => ({
      alerts: (st.alerts || []).filter(a => a.id !== targetId)
    }));
  },
  
  _subscriptions: { trades: new Map(), strategies: new Map(), scannerSymbols: new Map(), globalTrades: 0, scanner: 0 },
  _focusTimer: null,
  registerInterest: (type, id) => {
    const subs = { ...get()._subscriptions };
    if (type === 'trade') subs.trades.set(id, (subs.trades.get(id) || 0) + 1);
    else if (type === 'strategy') subs.strategies.set(id, (subs.strategies.get(id) || 0) + 1);
    else if (type === 'scanner_symbol') subs.scannerSymbols.set(id, (subs.scannerSymbols.get(id) || 0) + 1);
    else if (type === 'global_trades') subs.globalTrades++;
    else if (type === 'scanner') subs.scanner++;
    set({ _subscriptions: subs });
    get()._syncFocusToBackend();
  },
  unregisterInterest: (type, id) => {
    const subs = { ...get()._subscriptions };
    if (type === 'trade') { const count = (subs.trades.get(id) || 0) - 1; if (count <= 0) subs.trades.delete(id); else subs.trades.set(id, count); }
    else if (type === 'strategy') { const count = (subs.strategies.get(id) || 0) - 1; if (count <= 0) subs.strategies.delete(id); else subs.strategies.set(id, count); }
    else if (type === 'scanner_symbol') { const count = (subs.scannerSymbols.get(id) || 0) - 1; if (count <= 0) subs.scannerSymbols.delete(id); else subs.scannerSymbols.set(id, count); }
    else if (type === 'global_trades') subs.globalTrades = Math.max(0, subs.globalTrades - 1);
    else if (type === 'scanner') subs.scanner = Math.max(0, subs.scanner - 1);
    set({ _subscriptions: subs });
    get()._syncFocusToBackend();
  },
  _syncFocusToBackend: () => {
    if (get()._focusTimer) clearTimeout(get()._focusTimer);
    set({ _focusTimer: setTimeout(() => {
      const subs = get()._subscriptions;
      const ws = get().ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (subs.trades.size > 0) ws.send(JSON.stringify({ type: 'set_focus_mode', enabled: true, tradeId: Array.from(subs.trades.keys())[0] }));
        else if (subs.strategies.size > 0) ws.send(JSON.stringify({ type: 'set_focus_mode', enabled: true, strategyLabel: Array.from(subs.strategies.keys())[0] }));
        else if (subs.scannerSymbols.size > 0) ws.send(JSON.stringify({ type: 'set_focus_mode', enabled: false, scannerSymbol: Array.from(subs.scannerSymbols.keys())[0] }));
        else if (subs.globalTrades > 0 || subs.scanner > 0) ws.send(JSON.stringify({ type: 'set_focus_mode', enabled: false }));
      }
    }, 100) });
  },
  
  toggleSidebar: () => { const n = !get().sidebarCollapsed; localStorage.setItem('sidebar_collapsed', n); set({ sidebarCollapsed: n }); },
  setHealthEnabled: (e) => { localStorage.setItem('health_enabled', e); set({ healthEnabled: e }); },
  setStreamingEnabled: (e) => { localStorage.setItem('streaming_enabled', e); set({ streamingEnabled: e }); },
  toggleLogFilter: (level) => set((st) => {
    const safeFilters = st.logFilters && typeof st.logFilters === 'object' ? st.logFilters : DEFAULT_LOG_FILTERS;
    return { logFilters: { ...safeFilters, [level]: !safeFilters[level] } };
  }),
  setSyncing: (s) => set({ isSyncing: s }),
  sync: async () => {
    try {
      const res = await sessionAPI.status();
      const st = get();
      const running = !!res.data.running;

      if (running) {
        st.setSessionActive(true, res.data.strategyId || res.data.strategy_id);
      } else if (st.sessionActive) {
        // BOLT: Defensive Termination Guard.
        // If we think we're running but the backend says no, we only stop locally
        // if we are NOT currently in a 'Resuming' window.
        // This prevents the UI from wiping during the backend's boot reconciliation.
        const isResuming = st.isThrottled || st.wsStatus !== 'live' || st.isSyncingOnResume;
        if (!isResuming) {
           st.setSessionActive(false, null);
        }
      }

      // BOLT: Centralize merge logic via updateStats
      get().updateStats({
        sessionActive: running,
        balance: res.data.balance,
        totalPnl: res.data.totalPnl ?? res.data.total_pnl,
        totalRiskPct: res.data.totalRiskPct,
        totalSlUsed: res.data.totalSlUsed,
        activeTrades: res.data.activeTrades,
        variantStats: res.data.variant_stats,
        isAdaptiveTightened: res.data.isAdaptiveTightened,
        nextSlotTs: res.data.nextSlotTs,
        scannerResults: res.data.scannerResults,
        activeWindows: res.data.activeWindows,
        tradeHistory: res.data.history,
        config: res.data.config,
        pausedStrategies: res.data.paused_strategies,
        strategyGateStates: res.data.strategy_gate_states,
        rateLimitLastSync: res.data.rateLimit ? new Date().toISOString() : undefined,
      });
      // SRE: Proactively fetch analytics to keep Performance Insights populated
      get().fetchAnalytics();
    } catch (e) {
      if (e.code === 'ERR_CANCELED') return;
      console.error("Manual sync failed", e);
    }
  },
  setThrottled: (t) => {
    const wasThrottled = get().isThrottled;
    const isSyncingOnResume = wasThrottled && !t && get().sessionActive;
    console.log(`[Store] setThrottled: ${wasThrottled} -> ${t}. isSyncingOnResume will be: ${isSyncingOnResume}`);
    set({
      isThrottled: t,
      isSyncingOnResume
    });

    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_active', active: !t }));
    } else if (!t && get().sessionActive) {
      // If we are unthrottling (coming back) and WS is dead, reconnect immediately
      get().connectWS();
    }
  },
  setFocusMode: (f, tid = null, s = null, scannerSymbol = null) => { const ws = get().ws; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'set_focus_mode', enabled: f, tradeId: tid, strategyLabel: s, scannerSymbol })); },
  setSessionActive: (a, id) => {
    const wasActive = get().sessionActive;
    set({ sessionActive: a, strategyId: id });

    if (a) {
      get().connectWS();
    } else {
      get().disconnectWS();
      // Clear active config drafts and loaded preset names from storage when deactivating/closing a session
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('config_draft');
        sessionStorage.removeItem('loaded_preset_name');
      }
      // Proactively clear ephemeral state on termination and reset session config back to defaultConfig to prevent stale settings/variants bleeding
      set({
        config: defaultConfig,
        activeTrades: [],
        scannerResults: [],
        variantScannerResults: {},
        variantStats: {},
        gateState: null,
        gateReason: null,
        hibernating: false,
        totalRiskPct: 0,
        totalSlUsed: 0,
        isSyncingOnResume: false,
        sessionPaused: false,
        pausedStrategies: [],
        strategyGateStates: {}
      });
      // Fetch fresh history and analytics after termination
      if (wasActive) {
        get().sync();
        get().fetchTradeHistory();
        get().fetchSessions();
        get().fetchAnalytics();
      }
    }
  },
  fetchSessions: async () => { set({ isSyncing: true }); try { const r = await sessionAPI.list(); const sessions = (r.data || []).map(s => ({ ...s, startTimeMs: s.startTime ? new Date(s.startTime).getTime() : 0 })); set({ sessionList: sessions }); } catch (e) {} finally { set({ isSyncing: false }); } },
  fetchLifetimeAnalytics: async (m = 'paper') => { set({ isSyncing: true }); try { const r = await sessionAPI.getLifetimeAnalytics(m); set({ lifetimeAnalytics: r.data }); } catch (e) {} finally { set({ isSyncing: false }); } },
  fetchAnalytics: async () => { set({ isSyncing: true }); try { const r = await sessionAPI.analytics(); set({ analytics: r.data }); } catch (e) {} finally { set({ isSyncing: false }); } },
  fetchTradeHistory: async (sid = 'all') => { set({ isSyncing: true }); try { const r = await sessionAPI.history(sid); set({ tradeHistory: r.data.trades || [] }); } catch (e) {} finally { set({ isSyncing: false }); } },
  updateStats: (updates) => set((st) => {
    // BOLT: Session Stickiness Logic.
    // We defensively protect the session state and critical metrics during 'Resuming' windows.
    // This handles the '0-then-catchup' bug when returning to a backgrounded tab/desktop.
    const age = Date.now() - (st.lastAuthoritativeUpdateTs || 0);
    const isResuming = st.isThrottled || st.wsStatus !== 'live' || st.isSyncingOnResume || (age > 15000 && st.sessionActive);
    const sessionCurrentlyActive = st.sessionActive;

    // SEC: Defensive Merge Pattern. Never overwrite store keys with undefined.
    const merged = { ...st };
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) merged[key] = value;
    });

    // Handle key variations
    const nextPnl = updates.totalPnl ?? updates.total_pnl;
    if (nextPnl !== undefined) merged.totalPnl = nextPnl;

    const currentActiveTrades = Array.isArray(st.activeTrades) ? st.activeTrades : [];
    const currentScannerResults = Array.isArray(st.scannerResults) ? st.scannerResults : [];
    const currentTradeHistory = Array.isArray(st.tradeHistory) ? st.tradeHistory : [];

    // BOLT: Anti-Flicker & Metric Retention Guard across all updates.
    // Prevent metrics (P&L, balance, risk, SL used) from dropping to 0 or resetting
    // when backend emits transient zero/null/uninitialized state during reconnection or tab un-throttling.
    if (sessionCurrentlyActive && updates.status !== 'stopped' && updates.running !== false) {
       merged.totalPnl = resolveNonZeroMetric(nextPnl, st.totalPnl, isResuming);
       merged.balance = resolveNonZeroMetric(updates.balance, st.balance, isResuming);
       merged.totalRiskPct = resolveNonZeroMetric(updates.totalRiskPct, st.totalRiskPct, isResuming);
       merged.totalSlUsed = resolveNonZeroMetric(updates.totalSlUsed, st.totalSlUsed, isResuming);
    }

    if (isResuming && sessionCurrentlyActive) {
       // 1. Session Persistence Guard: ignore sessionActive: false unless backend explicitly says 'stopped'
       if (updates.sessionActive === false && updates.status !== 'stopped' && updates.running !== false) {
          merged.sessionActive = true;
       }

       // 2. Collection Persistence: hold trades/scanner results until non-empty data arrives
       if (Array.isArray(updates.activeTrades)) {
         if (updates.activeTrades.length > 0 || currentActiveTrades.length === 0) {
           merged.activeTrades = updates.activeTrades.map(t => normalizeTrade(t, currentActiveTrades.find(x => x.symbol === t.symbol), isResuming)).filter(Boolean);
         } else {
           merged.activeTrades = currentActiveTrades;
         }
       } else if (currentActiveTrades.length > 0) {
         merged.activeTrades = currentActiveTrades;
       }

       if (Array.isArray(updates.scannerResults)) {
         if (updates.scannerResults.length > 0 || currentScannerResults.length === 0) {
           merged.scannerResults = updates.scannerResults.map(o => normalizeOpportunity(o)).filter(Boolean);
         } else {
           merged.scannerResults = currentScannerResults;
         }
       } else if (currentScannerResults.length > 0) {
         merged.scannerResults = currentScannerResults;
       }

       if (Array.isArray(updates.tradeHistory)) {
         merged.tradeHistory = updates.tradeHistory.map(t => normalizeTrade(t, null, isResuming)).filter(Boolean);
       } else if (currentTradeHistory.length > 0) {
         merged.tradeHistory = currentTradeHistory;
       }
    } else {
       // Normal merge with normalization when NOT in resumption window
       if (Array.isArray(updates.activeTrades)) merged.activeTrades = updates.activeTrades.map(t => normalizeTrade(t, currentActiveTrades.find(x => x.symbol === t.symbol), false)).filter(Boolean);
       if (Array.isArray(updates.scannerResults)) merged.scannerResults = updates.scannerResults.map(o => normalizeOpportunity(o)).filter(Boolean);
       if (Array.isArray(updates.tradeHistory)) merged.tradeHistory = updates.tradeHistory.map(t => normalizeTrade(t, null, false)).filter(Boolean);
    }

    if (updates.config) merged.config = deepMerge(st.config, updates.config);

    merged.lastAuthoritativeUpdateTs = Date.now();

    return merged;
  }),
  resetPaperBalance: async () => {
    try {
      const res = await sessionAPI.resetPaperBalance();
      set({ balance: res.data.balance });
      get().addAlert({ level: 'success', title: 'Balance Reset', message: 'Paper trading balance has been reset to default.' });
    } catch (e) {
      console.error('Failed to reset paper balance:', e);
      get().addAlert({ level: 'error', title: 'Reset Failed', message: 'Could not reset paper balance.' });
    }
  },

  updateActiveTradeConfig: async (tradeId, payload) => {
    try {
      const res = await sessionAPI.updateTradeConfig(tradeId, payload);
      if (res.data && res.data.trade) {
        const updatedTrade = normalizeTrade(res.data.trade);
        set(st => ({
          activeTrades: (st.activeTrades || []).map(t =>
            (t.id === updatedTrade.id || t.symbol === updatedTrade.symbol) ? { ...t, ...updatedTrade } : t
          )
        }));
        get().addAlert({ level: 'success', title: 'Configuration Saved', message: `Successfully updated exit parameters for ${updatedTrade.symbol}.` });
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed to update active trade config:', e);
      const errMsg = e?.response?.data?.message || e.message || 'Could not save parameters.';
      get().addAlert({ level: 'error', title: 'Save Failed', message: errMsg });
      throw e;
    }
  },

  updateConfig: (c) => {
    console.log('[Config Trace] updateConfig called with:', c);
    if (c.trading_mode) {
      localStorage.setItem('global_trading_mode', c.trading_mode);
    }
    if (c.debug_mode !== undefined && typeof localStorage !== 'undefined') {
      localStorage.setItem('global_debug_mode', String(c.debug_mode));
    }
    set((st) => ({ config: deepMerge(st.config, c) }));
  },

  patchConfig: async (patch) => {
    const st = get();
    console.log('[Config Trace] patchConfig initiating:', patch);
    if (patch.debug_mode !== undefined && typeof localStorage !== 'undefined') {
      localStorage.setItem('global_debug_mode', String(patch.debug_mode));
    }
    const newConfig = deepMerge(st.config, patch);

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('config_draft', JSON.stringify(newConfig));
      }
    } catch (e) {}

    // Update local state immediately for instant feedback
    set({ config: newConfig, configSyncing: true });

    // Sync to backend if session is active
    if (st.sessionActive && st.strategyId) {
      try {
        console.log('[Config Trace] Syncing patch to backend...');
        const res = await sessionAPI.update(st.strategyId, patch);
        console.log('[Config Trace] Sync successful:', res.data);
      } catch (e) {
        console.error("[Store] Failed to patch config on backend", e);
      } finally {
        set({ configSyncing: false });
      }
    } else {
      set({ configSyncing: false });
    }
  },
  
  ws: null, reconnectAttempts: 0,
  connectWS: () => {
    if (get().ws) return;
    set({ wsStatus: 'connecting' });
    // DEPLOY-04: Match the WebSocket protocol to the page protocol.
    // Use wss:// on HTTPS pages and ws:// on HTTP (dev) pages. Forcing wss://
    // unconditionally breaks local dev where the Vite server is plain HTTP,
    // causing "can't establish a connection to wss://localhost:3000".
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let u = normalizeUrl(import.meta.env.VITE_WS_URL, wsProto) || `${wsProto}://${window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.hostname + (window.location.port ? ':' + window.location.port : '')}/session/ws`;
    if (u && !u.includes('/session/ws')) u = u.replace(/\/$/, '') + '/session/ws';
    const ak = localStorage.getItem('MOMENTUM_ADMIN_API_KEY') || import.meta.env.VITE_ADMIN_API_KEY;
    // SENTINEL: Use sub-protocol for auth instead of query parameter to prevent credential leakage in logs
    const ws = new WebSocket(u, ak || []);
    ws.onopen = () => {
      const sessionActive = get().sessionActive;
      set({
        wsStatus: 'live',
        reconnectAttempts: 0,
        isSyncingOnResume: sessionActive // Start sync feedback on reconnect if session is active
      });
      ws.send(JSON.stringify({ type: 'set_active', active: !get().isThrottled }));
    };
    let lsu = 0;
    ws.onmessage = (e) => {
      if (get().isThrottled) return;
      const nowTs = Date.now();
      const d = JSON.parse(e.data);

      if (d.type === 'status' || d.type === 'session') {
        if (get().isSyncingOnResume) {
          console.log(`[Store] Received status/session update. Clearing isSyncingOnResume.`);
        }
        set((st) => {
          const stop = d.status === 'stopped' || d.running === false;
          const isResuming = st.isSyncingOnResume;
          const currentActiveTrades = Array.isArray(st.activeTrades) ? st.activeTrades : [];
          const currentTradeHistory = Array.isArray(st.tradeHistory) ? st.tradeHistory : [];

          let nt = currentActiveTrades;
          if (stop) nt = [];
          else if (Array.isArray(d.activeTrades)) {
            if (d.activeTrades.length > 0) {
              const m = new Map(currentActiveTrades.map(t => [t.symbol, t]));
              nt = d.activeTrades.map(t => normalizeTrade(t, m.get(t.symbol), isResuming)).filter(Boolean);
            } else if (!isResuming) {
              // Authoritative clear when not in resumption window
              nt = [];
            }
          }

          // BOLT: Smart history merging to prevent flickering or data loss.
          // We only update history if the backend provides a non-empty list.
          // This allows session-specific updates without wiping global history.
          let nextHistory = currentTradeHistory;
          if (d.history && Array.isArray(d.history) && d.history.length > 0) {
            const incoming = d.history.map(t => normalizeTrade(t, null, isResuming)).filter(Boolean);
            const m = new Map(currentTradeHistory.map(t => [t.id, t]));
            incoming.forEach(t => m.set(t.id, t));
            nextHistory = Array.from(m.values()).sort((a, b) => (b.exit_ts_ms || 0) - (a.exit_ts_ms || 0));
          }

          // BOLT: Prevent flickering during config sync
          const nextConfig = d.config ? (st.configSyncing ? st.config : deepMerge(st.config, d.config)) : st.config;

          const nextActiveSession = d.running ?? d.status === 'started';
          const nextPnl = d.totalPnl ?? d.total_pnl;

          return {
            lastAuthoritativeUpdateTs: nowTs,
            sessionActive: nextActiveSession,
            sessionPaused: d.paused ?? st.sessionPaused,
            pausedStrategies: d.paused_strategies ?? st.pausedStrategies ?? [],
            strategyGateStates: d.strategy_gate_states ?? st.strategyGateStates ?? {},
            strategyId: d.strategyId || st.strategyId,
            balance: resolveNonZeroMetric(d.balance, st.balance, isResuming),
            totalPnl: resolveNonZeroMetric(nextPnl, st.totalPnl, isResuming),
            totalRiskPct: resolveNonZeroMetric(d.totalRiskPct, st.totalRiskPct, isResuming),
            totalSlUsed: resolveNonZeroMetric(d.totalSlUsed, st.totalSlUsed, isResuming),
            entryCount: d.stats?.entryCount ?? st.entryCount,
            hitCount: d.stats?.hitCount ?? st.hitCount,
            activeTrades: nt,
            logs: (d.logLines?.map(normalizeLog) || st.logs || []).filter(Boolean),
            scannerResults: (d.scannerResults?.map(normalizeOpportunity) || st.scannerResults || []).filter(Boolean),
            activeWindows: d.activeWindows?.map(w => ({...w})) || st.activeWindows || [],
            tradeHistory: nextHistory,
            gateState: d.gateState ?? st.gateState,
            nextSlotTs: d.nextSlotTs ?? st.nextSlotTs,
            hibernating: d.hibernating ?? st.hibernating,
            hibernationMode: d.hibernation_mode ?? st.hibernationMode,
            isAdaptiveTightened: d.isAdaptiveTightened ?? st.isAdaptiveTightened,
            agreementRequired: d.agreementRequired ?? st.agreementRequired,
            scannerPaused: d.scannerPaused ?? st.scannerPaused,
            lastScanTs: d.last_scan_ts ?? st.lastScanTs,
            config: nextConfig,
            tradesInPeriod: d.tradesInPeriod,
            maxTradesPeriod: d.maxTradesPeriod,
            tradesIn24h: d.tradesIn24h,
            maxTrades24h: d.maxTrades24h,
            effectivePeriodMs: d.effectivePeriodMs,
            jitterFactor: d.jitterFactor,
            apiStatus: d.apiStatus || st.apiStatus,
            isSyncingOnResume: false
          };
        });
      } else if (d.type === 'tick') {
        if (get().isSyncingOnResume) {
          console.log(`[Store] Received tick. Clearing isSyncingOnResume.`);
        }
        set((st) => {
          const isResuming = st.isSyncingOnResume;
          const currentActiveTrades = Array.isArray(st.activeTrades) ? st.activeTrades : [];
          let nt = currentActiveTrades;
          if (Array.isArray(d.trades)) {
            if (d.trades.length > 0) {
              const m = new Map(currentActiveTrades.map(t => [t.id, t]));
              d.trades.forEach(t => { const p = m.get(t.id); const n = normalizeTrade(t, p, isResuming); if (n) m.set(t.id, n); });
              if (d._heartbeat) { const ids = new Set(d.trades.map(t => t.id)); for (const id of m.keys()) if (!ids.has(id)) m.delete(id); }
              nt = Array.from(m.values());
            } else if (!isResuming) {
              // Authoritative clear when not in resumption window
              nt = [];
            }
          }

          // BOLT: Prevent flickering during config sync. If local state is in-flight, ignore config updates from ticks.
          let nextConfig = st.config;
          if (d.config) {
            if (st.configSyncing) {
              console.log('[Config Trace] Ignoring incoming config tick (sync in progress)');
              nextConfig = st.config;
            } else {
              nextConfig = deepMerge(st.config, d.config);
            }
          }

          const nextPnl = d.total_pnl;

          return {
            lastAuthoritativeUpdateTs: nowTs,
            balance: resolveNonZeroMetric(d.balance, st.balance, isResuming),
            totalPnl: resolveNonZeroMetric(nextPnl, st.totalPnl, isResuming),
            totalRiskPct: resolveNonZeroMetric(d.total_risk_pct, st.totalRiskPct, isResuming),
            totalSlUsed: resolveNonZeroMetric(d.total_sl_used, st.totalSlUsed, isResuming),
            totalEstPnlToRealize: resolveNonZeroMetric(d.total_est_pnl_to_realize, st.totalEstPnlToRealize, isResuming),
            entryCount: d.stats?.entryCount ?? st.entryCount, hitCount: d.stats?.hitCount ?? st.hitCount, activeTrades: nt, variantStats: d.variant_stats || st.variantStats, activeWindows: d.activeWindows || st.activeWindows, gateState: d.gateState ?? st.gateState, nextSlotTs: d.nextSlotTs ?? st.nextSlotTs, hibernating: d.hibernating ?? st.hibernating, hibernationMode: d.hibernation_mode ?? st.hibernationMode, isAdaptiveTightened: d.isAdaptiveTightened ?? st.isAdaptiveTightened, agreementRequired: d.agreementRequired ?? st.agreementRequired, gateReason: d.reason || st.gateReason, sessionPaused: d.paused ?? st.sessionPaused, pausedStrategies: d.paused_strategies ?? st.pausedStrategies ?? [], strategyGateStates: d.strategy_gate_states ?? st.strategyGateStates ?? {}, scannerPaused: d.scannerPaused ?? st.scannerPaused, lastScanTs: d.last_scan_ts ?? st.lastScanTs, rateLimit: d.rateLimit || st.rateLimit, rateLimitLastSync: d.rateLimit ? new Date().toISOString() : st.rateLimitLastSync, monitoring: d.monitoring || st.monitoring, isEcoMode: d.isEcoMode ?? st.isEcoMode, analytics: d.analytics || st.analytics,
            config: nextConfig,
            tradesInPeriod: d.tradesInPeriod, maxTradesPeriod: d.maxTradesPeriod, tradesIn24h: d.tradesIn24h, maxTrades24h: d.maxTrades24h,
            effectivePeriodMs: d.effectivePeriodMs, jitterFactor: d.jitterFactor,
            apiStatus: d.apiStatus || st.apiStatus,
            isSyncingOnResume: false
          };
        });
      } else if (d.type === 'log') set(st => {
        const n = normalizeLog(d);
        if (!n) return st;
        const logs = st.logs || [];
        return { lastAuthoritativeUpdateTs: nowTs, logs: [n, ...logs].slice(0, MAX_LOG_LINES) };
      });
      else if (d.type === 'scanner') {
        if (nowTs - lsu < 200) return; lsu = nowTs;
        set(st => {
          const currentScannerResults = Array.isArray(st.scannerResults) ? st.scannerResults : [];
          // BOLT OPTIMIZATION: Use Map for O(1) lookup during normalization to achieve O(N+M) complexity.
          const prevMap = new Map(currentScannerResults.map(r => [r.symbol, r]));
          return {
            lastAuthoritativeUpdateTs: nowTs,
            scannerResults: (d.opportunities || []).map(o => {
              const sym = String(o.symbol || '').replace(/[^A-Z0-9]/gi, '').substring(0, 20);
              const p = prevMap.get(sym);
              const n = normalizeOpportunity(o, p);
              if (!n) return null;
              if (n === p) return p; // unchanged: reuse previous reference so React.memo bails out

              // BOLT: Aggressive data retention. Preserve telemetry and breakdowns across gated updates.
              return {
                ...n,
                history: (n.history && n.history.length > 0) ? n.history : p?.history,
                ohlc_history: (n.ohlc_history && n.ohlc_history.length > 0) ? n.ohlc_history : p?.ohlc_history,
                score_breakdown: n.score_breakdown || p?.score_breakdown,
                signalResult: n.signalResult || p?.signalResult
              };
            }).filter(Boolean),
            variantScannerResults: d.variant_opportunities ? d.variant_opportunities.reduce((acc, v) => {
              const prevOppMap = new Map((st.variantScannerResults[v.strategy_label] || []).map(r => [r.symbol, r]));
              acc[v.strategy_label] = v.opportunities.map(o => {
                const sym = String(o.symbol || '').replace(/[^A-Z0-9]/gi, '').substring(0, 20);
                const p = prevOppMap.get(sym);
                const n = normalizeOpportunity(o, p);
                if (!n) return null;
                if (n === p) return p; // unchanged: reuse previous reference so React.memo bails out
                return {
                  ...n,
                  history: (n.history && n.history.length > 0) ? n.history : p?.history,
                  ohlc_history: (n.ohlc_history && n.ohlc_history.length > 0) ? n.ohlc_history : p?.ohlc_history,
                  score_breakdown: n.score_breakdown || p?.score_breakdown,
                  signalResult: n.signalResult || p?.signalResult
                };
              }).filter(Boolean);
              return acc;
            }, {}) : st.variantScannerResults,
            activeWindows: d.activeWindows || st.activeWindows,
            hibernating: d.hibernating ?? st.hibernating,
            lastScanTs: d.last_scan_ts ?? st.lastScanTs
          };
        });
      } else if (d.type === 'trade_event') {
        const t = d.trade ? normalizeTrade(d.trade) : null;
        set(st => {
          let nextActive = st.activeTrades;
          if (d.event === 'closed') {
            nextActive = st.activeTrades.filter(x => x.symbol !== d.symbol && x.id !== d.id);
          } else if (t) {
            // BOLT: Prevent "Multiples" Ghost Trades. Ensure only one trade per symbol exists in the store.
            // This hardening ensures that even if backend sends redundant 'opened' events during retries,
            // the UI only renders the most recent authoritative trade.
            nextActive = [...st.activeTrades.filter(x => x.symbol !== t.symbol), t];
          }

          const tradeHistory = st.tradeHistory || [];
          let updatedHistory = tradeHistory;
          if (d.event === 'closed') {
            const closedTradeObj = t || (d.trade ? normalizeTrade(d.trade) : null) || {
              symbol: d.symbol,
              pnl: d.pnl ?? 0,
              exit_reason: d.reason || 'Closed',
              exit_ts: Date.now()
            };
            if (d.reason && closedTradeObj) {
              closedTradeObj.exit_reason = d.reason;
            }
            updatedHistory = [closedTradeObj, ...tradeHistory.filter(x => x.id !== closedTradeObj.id)].slice(0, 50);
          }
          return {
            lastAuthoritativeUpdateTs: nowTs,
            activeTrades: nextActive,
            tradeHistory: updatedHistory,
            entryCount: d.stats?.entryCount ?? st.entryCount,
            hitCount: d.stats?.hitCount ?? st.hitCount
          };
        });
      } else if (d.type === 'gate') {
        set(st => ({
          lastAuthoritativeUpdateTs: nowTs,
          gateState: d.gateState, gateReason: d.reason, nextSlotTs: d.nextSlotTs ?? st.nextSlotTs, hibernating: d.hibernating ?? st.hibernating, isAdaptiveTightened: d.isAdaptiveTightened ?? st.isAdaptiveTightened, scannerPaused: d.scannerPaused
        }));
      }
      else if (d.type === 'api_status') set({ apiStatus: d });
      else if (d.type === 'alert') {
        get().addAlert(d);
      }
      else if (d.type === 'session_terminated') get().setSessionActive(false, null);
    };
    ws.onclose = () => { set({ ws: null, wsStatus: 'offline' }); if (get().sessionActive) { const att = get().reconnectAttempts; const del = Math.min(1000 * Math.pow(2, att), 30000); set({ reconnectAttempts: att + 1 }); setTimeout(() => get().connectWS(), del); } };
    set({ ws });
  },
  disconnectWS: () => { if (get().ws) { get().ws.close(); set({ ws: null, wsStatus: 'offline' }); } },
}), {
  name: 'momentum_trading_store',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    // Whitelist only essential data to keep storage size under control and avoid stale session control bits.
    // WISP OPTIMIZATION: Removed heavy static API response keys `tradeHistory`, `lifetimeAnalytics`, and `analytics` from persistence.
    // This completely eliminates high-frequency synchronous serialization and blocking disk writes to `localStorage` on every WebSocket
    // tick, log line, or ticker broadcast. They are fetched cleanly on demand upon page load and view mounting.
    sessionActive: state.sessionActive,
    strategyId: state.strategyId,
    balance: state.balance,
    totalPnl: state.totalPnl,
    activeTrades: state.activeTrades,
    totalRiskPct: state.totalRiskPct,
    totalSlUsed: state.totalSlUsed,
    config: state.config,
    variantStats: state.variantStats,
    lastScanTs: state.lastScanTs,
    lastAuthoritativeUpdateTs: state.lastAuthoritativeUpdateTs,
    theme: state.theme
  }),
  version: 1,
  onRehydrateStorage: () => (state) => {
    // BOLT: Defensive reset of ephemeral flags on resume
    if (state) {
      state.isThrottled = false;
      // Start in resuming state if session was active to trigger anti-flicker
      state.isSyncingOnResume = !!state.sessionActive;
      state.wsStatus = 'offline';
      state.ws = null;

      // Apply theme on load
      applyTheme(state.theme || 'default');

      // Force collections to arrays to avoid TypeError: B is undefined
      state.activeTrades = Array.isArray(state.activeTrades) ? state.activeTrades : [];
      state.scannerResults = Array.isArray(state.scannerResults) ? state.scannerResults : [];
      state.variantScannerResults = state.variantScannerResults && typeof state.variantScannerResults === 'object' ? state.variantScannerResults : {};
      state.tradeHistory = Array.isArray(state.tradeHistory) ? state.tradeHistory : [];
      state.logs = Array.isArray(state.logs) ? state.logs : [];
      state.alerts = Array.isArray(state.alerts) ? state.alerts : [];

      // BOLT: If last update was long ago, force a sync window even if not explicit
      const age = Date.now() - (state.lastAuthoritativeUpdateTs || 0);
      if (age > 15000 && state.sessionActive) {
         state.isSyncingOnResume = true;
      }
    }
  }
}))
