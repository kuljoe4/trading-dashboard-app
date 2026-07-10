import { createWithEqualityFn } from 'zustand/traditional'
import { sessionAPI, normalizeUrl } from '../api/client'
import { CONFIG_LIMITS, ENGINE_CONSTANTS } from '../constants/configLimits'

const toNumber = (v, f = 0) => { const p = Number(v); return Number.isFinite(p) ? p : f; }
const MAX_LOG_LINES = 500;
const DEFAULT_LOG_FILTERS = { info: true, warn: true, error: true };

const getObjectSource = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export const normalizeOpportunity = (o = {}) => {
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
          insufficientData: !!s.insufficientData
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

  return res;
}

const normalizeTrade = (t = {}, pt = null) => {
  if (!t || typeof t !== 'object') return null;
  const p = pt || {};

  // BOLT: Parse signal status from compressed JSON if present in tick
  let sigStatus = t.exit_signals_status;
  if (!sigStatus && t._sig_json) {
    try { sigStatus = JSON.parse(t._sig_json); } catch (e) {}
  }

  const f = `${t.pnl}:${t.rr}:${t.current_price}:${t.sl_price}`;
  if (p._fingerprint === f && !t._delta && !t._thin && !t._sig_json) return p;
  if (t._delta || t._thin) {
    return {
      ...p, ...t,
      pnl: t.pnl !== undefined ? toNumber(t.pnl) : p.pnl,
      rr: t.rr !== undefined ? toNumber(t.rr) : p.rr,
      current_price: t.current_price !== undefined ? toNumber(t.current_price) : p.current_price,
      sl_price: t.sl_price !== undefined ? toNumber(t.sl_price) : p.sl_price,
      max_rr: t.max_rr !== undefined ? toNumber(t.max_rr) : p.max_rr,
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
      is_reconciliation: t.is_reconciliation ?? p.is_reconciliation
    };
  }
  const ep = toNumber(t.entry_price ?? t.entry ?? p.entry_price);
  return { ...t, symbol: t.symbol ?? p.symbol ?? '---', strategy_label: t.strategy_label ?? p.strategy_label ?? 'Momentum Strategy', direction: (t.direction ?? t.side ?? p.direction ?? '').toString().toUpperCase(), entry_price: ep, current_price: toNumber(t.current_price ?? t.current ?? p.current_price ?? t.exit_price ?? ep, ep), sl_price: toNumber(t.sl_price ?? t.current_sl ?? t.sl ?? t.initial_sl ?? p.sl_price), initial_sl: toNumber(t.initial_sl ?? t.sl_price ?? t.sl ?? p.initial_sl), tp_price: t.tp_price == null && t.tp == null ? p.tp_price ?? null : toNumber(t.tp_price ?? t.tp), pnl: t.pnl !== undefined ? toNumber(t.pnl) : p.pnl ?? 0, rr: (t.rr !== undefined) ? toNumber(t.rr) : p.rr ?? 0, max_rr: (t.max_rr !== undefined) ? toNumber(t.max_rr) : p.max_rr ?? 0, live_rr_sequence: t.live_rr_sequence || p.live_rr_sequence || [], exit_rr_sequence: t.exit_rr_sequence || p.exit_rr_sequence || [], tp_mode: t.tp_mode || p.tp_mode || (t.tp_price == null && t.tp == null ? 'exp_rr_seq' : 'fixed'), tp_ratio: (t.tp_ratio !== undefined) ? toNumber(t.tp_ratio, 2) : p.tp_ratio ?? 0, sl_adjustments: t.sl_adjustments || p.sl_adjustments || [], exit_reason: t.exit_reason ?? p.exit_reason, exit_price: t.exit_price == null ? (p.exit_price == null ? undefined : toNumber(p.exit_price)) : toNumber(t.exit_price), paper_mode: t.paper_mode ?? p.paper_mode ?? true, qty: toNumber(t.qty ?? t.quantity ?? p.qty ?? 0), max_rr_achieved: toNumber(t.max_rr_achieved ?? t.max_rr ?? p.max_rr_achieved ?? 0), exit_signals_status: sigStatus || p.exit_signals_status || {}, strategy_config: t.strategy_config || p.strategy_config, _fingerprint: f };
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
  enabled_signals: ['momentum_pct'],
  signal_logic: 'all',
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
  live_starting_balance: CONFIG_LIMITS.LIVE_STARTING_BALANCE_DEFAULT,
  hot_loop_interval_ms: CONFIG_LIMITS.HOT_LOOP_DEFAULT,
  main_loop_interval_ms: CONFIG_LIMITS.MAIN_LOOP_DEFAULT,
  slippage_warning_threshold: CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT || 0.001,
  auto_scale_min_notional: true,
  hibernation_mode: 'adaptive',
  debug_mode: false,
  scanner_weights: {
    momentum: 0.5,
    volatility: 0.3,
    trend: 0.2
  },
};

export const useTradingStore = createWithEqualityFn((set, get) => ({
  sessionActive: false, sessionPaused: false, strategyId: null, balance: 10000, totalPnl: 0, totalRiskPct: 0, totalSlUsed: 0,
  activeTrades: [], logs: [], logFilters: DEFAULT_LOG_FILTERS, scannerResults: [], variantScannerResults: {}, variantStats: {}, activeWindows: [], tradeHistory: [], lifetimeAnalytics: null,
  gateState: null, gateReason: null, hibernating: false, hibernationMode: 'adaptive', isAdaptiveTightened: false, agreementRequired: false, scannerPaused: false, lastScanTs: 0, wsStatus: 'offline', sessionList: [], monitoring: null, isEcoMode: false, analytics: null,
  apiStatus: { isBanned: false, isRateLimited: false, banUntil: null, lastErrorMessage: null },
  tradesInPeriod: undefined, maxTradesPeriod: undefined, tradesIn24h: undefined, maxTrades24h: undefined,
  effectivePeriodMs: undefined, jitterFactor: undefined,
  entryCount: 0, hitCount: 0,
  alerts: [],
  isSyncing: false, configSyncing: false,
  debugToolsEnabled: localStorage.getItem('debug_tools_enabled') === 'true',
  rateLimit: { used_weight_1m: 0, limit: ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT, used_pct: 0 },
  rateLimitLastSync: new Date().toISOString(),
  config: defaultConfig,
  sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true', 
  healthEnabled: localStorage.getItem('health_enabled') !== 'false',
  streamingEnabled: localStorage.getItem('streaming_enabled') !== 'false',
  isThrottled: false, entryCount: 0, hitCount: 0,

  addAlert: (alert) => {
     const now = Date.now();
     const id = Math.random().toString(36).substring(2, 11);
     const newAlert = { id, ts: now, level: 'info', ...alert };
     let targetId = id;

     set(st => {
       const existing = st.alerts.find(a => a.title === newAlert.title && a.message === newAlert.message && (now - a.ts < 5000));
       if (existing) {
          targetId = existing.id;
          return { alerts: st.alerts.map(a => a.id === existing.id ? { ...a, ts: now, count: (a.count || 1) + 1 } : a) };
       }
       return { alerts: [newAlert, ...st.alerts].slice(0, 10) };
     });

     // BOLT-PERF: Move side effects out of the updater function for better maintainability and pure state transitions.
     setTimeout(() => {
       set(st => ({
         alerts: st.alerts.filter(a => a.id !== targetId || (Date.now() - a.ts < 10000))
       }));
     }, 10000);
  },
  
  _subscriptions: { trades: new Map(), strategies: new Map(), globalTrades: 0, scanner: 0 },
  _focusTimer: null,
  registerInterest: (type, id) => {
    const subs = { ...get()._subscriptions };
    if (type === 'trade') subs.trades.set(id, (subs.trades.get(id) || 0) + 1);
    else if (type === 'strategy') subs.strategies.set(id, (subs.strategies.get(id) || 0) + 1);
    else if (type === 'global_trades') subs.globalTrades++;
    else if (type === 'scanner') subs.scanner++;
    set({ _subscriptions: subs });
    get()._syncFocusToBackend();
  },
  unregisterInterest: (type, id) => {
    const subs = { ...get()._subscriptions };
    if (type === 'trade') { const count = (subs.trades.get(id) || 0) - 1; if (count <= 0) subs.trades.delete(id); else subs.trades.set(id, count); }
    else if (type === 'strategy') { const count = (subs.strategies.get(id) || 0) - 1; if (count <= 0) subs.strategies.delete(id); else subs.strategies.set(id, count); }
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
      if (ws?.readyState === WebSocket.OPEN) {
        if (subs.trades.size > 0) ws.send(JSON.stringify({ type: 'set_focus_mode', enabled: true, tradeId: Array.from(subs.trades.keys())[0] }));
        else if (subs.strategies.size > 0) ws.send(JSON.stringify({ type: 'set_focus_mode', enabled: true, strategyLabel: Array.from(subs.strategies.keys())[0] }));
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
      if (res.data.running) {
        st.setSessionActive(true, res.data.strategyId || res.data.strategy_id);
      }
      set({
        balance: res.data.balance ?? st.balance,
        totalPnl: res.data.totalPnl ?? st.totalPnl,
        totalRiskPct: res.data.totalRiskPct ?? st.totalRiskPct,
        totalSlUsed: res.data.totalSlUsed ?? 0,
        activeTrades: res.data.activeTrades || [],
        variantStats: res.data.variant_stats || {},
        isAdaptiveTightened: res.data.isAdaptiveTightened ?? st.isAdaptiveTightened,
        scannerResults: res.data.scannerResults || [],
        activeWindows: res.data.activeWindows || [],
        tradeHistory: res.data.history || [],
        config: res.data.config ? deepMerge(st.config, res.data.config) : st.config,
        rateLimitLastSync: res.data.rateLimit ? new Date().toISOString() : st.rateLimitLastSync,
      });
    } catch (e) {
      if (e.code === 'ERR_CANCELED') return;
      console.error("Manual sync failed", e);
    }
  },
  setThrottled: (t) => {
    set({ isThrottled: t });
    const ws = get().ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_active', active: !t }));
    } else if (!t && get().sessionActive) {
      // If we are unthrottling (coming back) and WS is dead, reconnect immediately
      get().connectWS();
    }
  },
  setFocusMode: (f, tid = null, s = null) => { const ws = get().ws; if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'set_focus_mode', enabled: f, tradeId: tid, strategyLabel: s })); },
  setSessionActive: (a, id) => {
    const wasActive = get().sessionActive;
    set({ sessionActive: a, strategyId: id });

    if (a) {
      get().connectWS();
    } else {
      get().disconnectWS();
      // Proactively clear ephemeral state on termination
      set({
        activeTrades: [],
        scannerResults: [],
        variantScannerResults: {},
        variantStats: {},
        gateState: null,
        gateReason: null,
        hibernating: false,
        totalRiskPct: 0,
        totalSlUsed: 0
      });
      // Fetch fresh history and analytics after termination
      if (wasActive) {
        get().sync();
        get().fetchTradeHistory();
        get().fetchSessions();
      }
    }
  },
  fetchSessions: async () => { set({ isSyncing: true }); try { const r = await sessionAPI.list(); set({ sessionList: r.data }); } catch (e) {} finally { set({ isSyncing: false }); } },
  fetchLifetimeAnalytics: async (m = 'paper') => { set({ isSyncing: true }); try { const r = await sessionAPI.getLifetimeAnalytics(m); set({ lifetimeAnalytics: r.data }); } catch (e) {} finally { set({ isSyncing: false }); } },
  fetchTradeHistory: async (sid = 'all') => { set({ isSyncing: true }); try { const r = await sessionAPI.history(sid); set({ tradeHistory: r.data.trades || [] }); } catch (e) {} finally { set({ isSyncing: false }); } },
  updateStats: (s) => set((st) => ({ ...st, ...s })),
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

  updateConfig: (c) => {
    console.log('[Config Trace] updateConfig called with:', c);
    if (c.trading_mode) {
      localStorage.setItem('global_trading_mode', c.trading_mode);
    }
    set((st) => ({ config: deepMerge(st.config, c) }));
  },

  patchConfig: async (patch) => {
    const st = get();
    console.log('[Config Trace] patchConfig initiating:', patch);
    const newConfig = deepMerge(st.config, patch);

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
    // DEPLOY-04: Force wss:// protocol for WebSockets if VITE_WS_URL is provided with incorrect protocol
    let u = normalizeUrl(import.meta.env.VITE_WS_URL, 'wss') || `${window.location.protocol === 'https:' ? 'wss://' : 'ws://'}${window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.hostname + (window.location.port ? ':' + window.location.port : '')}/session/ws`;
    if (u && !u.includes('/session/ws')) u = u.replace(/\/$/, '') + '/session/ws';
    const ak = localStorage.getItem('MOMENTUM_ADMIN_API_KEY') || import.meta.env.VITE_ADMIN_API_KEY;
    // SENTINEL: Use sub-protocol for auth instead of query parameter to prevent credential leakage in logs
    const ws = new WebSocket(u, ak || []);
    ws.onopen = () => { set({ wsStatus: 'live', reconnectAttempts: 0 }); ws.send(JSON.stringify({ type: 'set_active', active: !get().isThrottled })); };
    let lsu = 0;
    ws.onmessage = (e) => {
      if (get().isThrottled) return;
      const d = JSON.parse(e.data);
      if (d.type === 'status' || d.type === 'session') {
        set((st) => {
          const stop = d.status === 'stopped' || d.running === false;
          let nt = st.activeTrades; if (stop) nt = []; else if (d.activeTrades) { const m = new Map(st.activeTrades.map(t => [t.symbol, t])); nt = d.activeTrades.map(t => normalizeTrade(t, m.get(t.symbol))).filter(Boolean); }

          // BOLT: Smart history merging to prevent flickering or data loss.
          // We only update history if the backend provides a non-empty list.
          // This allows session-specific updates without wiping global history.
          let nextHistory = st.tradeHistory;
          if (d.history && Array.isArray(d.history) && d.history.length > 0) {
            const incoming = d.history.map(t => normalizeTrade(t)).filter(Boolean);
            const m = new Map(st.tradeHistory.map(t => [t.id, t]));
            incoming.forEach(t => m.set(t.id, t));
            nextHistory = Array.from(m.values()).sort((a, b) => new Date(b.exit_ts || b.createdAt).getTime() - new Date(a.exit_ts || a.createdAt).getTime());
          }

          // BOLT: Prevent flickering during config sync
          const nextConfig = d.config ? (st.configSyncing ? st.config : deepMerge(st.config, d.config)) : st.config;

          return { sessionActive: d.running ?? d.status === 'started', sessionPaused: d.paused ?? st.sessionPaused, strategyId: d.strategyId || st.strategyId, balance: d.balance ?? st.balance, totalPnl: d.totalPnl ?? d.total_pnl ?? st.totalPnl, totalRiskPct: d.totalRiskPct ?? st.totalRiskPct, totalSlUsed: d.totalSlUsed ?? st.totalSlUsed, entryCount: d.stats?.entryCount ?? st.entryCount, hitCount: d.stats?.hitCount ?? st.hitCount, activeTrades: nt, logs: (d.logLines?.map(normalizeLog) || st.logs).filter(Boolean), scannerResults: (d.scannerResults?.map(normalizeOpportunity) || st.scannerResults).filter(Boolean), activeWindows: d.activeWindows?.map(w => ({...w})) || st.activeWindows, tradeHistory: nextHistory, gateState: d.gateState ?? st.gateState, hibernating: d.hibernating ?? st.hibernating, hibernationMode: d.hibernation_mode ?? st.hibernationMode, isAdaptiveTightened: d.isAdaptiveTightened ?? st.isAdaptiveTightened, agreementRequired: d.agreementRequired ?? st.agreementRequired, scannerPaused: d.scannerPaused ?? st.scannerPaused, lastScanTs: d.last_scan_ts ?? st.lastScanTs, config: nextConfig, tradesInPeriod: d.tradesInPeriod, maxTradesPeriod: d.maxTradesPeriod, tradesIn24h: d.tradesIn24h, maxTrades24h: d.maxTrades24h, effectivePeriodMs: d.effectivePeriodMs, jitterFactor: d.jitterFactor, apiStatus: d.apiStatus || st.apiStatus };
        });
      } else if (d.type === 'tick') {
        set((st) => {
          let nt = st.activeTrades; if (d.trades && Array.isArray(d.trades)) { const m = new Map(st.activeTrades.map(t => [t.id, t])); d.trades.forEach(t => { const p = m.get(t.id); const n = normalizeTrade(t, p); if (n) m.set(t.id, n); }); if (d._heartbeat) { const ids = new Set(d.trades.map(t => t.id)); for (const id of m.keys()) if (!ids.has(id)) m.delete(id); } nt = Array.from(m.values()); }

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

          return {
            balance: d.balance ?? st.balance, totalPnl: d.total_pnl ?? st.totalPnl, totalRiskPct: d.total_risk_pct ?? st.totalRiskPct, totalSlUsed: d.total_sl_used ?? st.totalSlUsed, entryCount: d.stats?.entryCount ?? st.entryCount, hitCount: d.stats?.hitCount ?? st.hitCount, activeTrades: nt, variantStats: d.variant_stats || st.variantStats, activeWindows: d.activeWindows || st.activeWindows, gateState: d.gateState ?? st.gateState, hibernating: d.hibernating ?? st.hibernating, hibernationMode: d.hibernation_mode ?? st.hibernationMode, isAdaptiveTightened: d.isAdaptiveTightened ?? st.isAdaptiveTightened, agreementRequired: d.agreementRequired ?? st.agreementRequired, gateReason: d.reason || st.gateReason, sessionPaused: d.paused ?? st.sessionPaused, scannerPaused: d.scannerPaused ?? st.scannerPaused, lastScanTs: d.last_scan_ts ?? st.lastScanTs, rateLimit: d.rateLimit || st.rateLimit, rateLimitLastSync: d.rateLimit ? new Date().toISOString() : st.rateLimitLastSync, monitoring: d.monitoring || st.monitoring, isEcoMode: d.isEcoMode ?? st.isEcoMode, analytics: d.analytics || st.analytics,
            config: nextConfig,
            tradesInPeriod: d.tradesInPeriod, maxTradesPeriod: d.maxTradesPeriod, tradesIn24h: d.tradesIn24h, maxTrades24h: d.maxTrades24h,
            effectivePeriodMs: d.effectivePeriodMs, jitterFactor: d.jitterFactor,
            apiStatus: d.apiStatus || st.apiStatus
          };
        });
      } else if (d.type === 'log') set(st => {
        const n = normalizeLog(d);
        if (!n) return st;
        return { logs: [n, ...st.logs].slice(0, MAX_LOG_LINES) };
      });
      else if (d.type === 'scanner') {
        const now = Date.now(); if (now - lsu < 200) return; lsu = now;
        set(st => {
          // BOLT OPTIMIZATION: Use Map for O(1) lookup during normalization to achieve O(N+M) complexity.
          const prevMap = new Map(st.scannerResults.map(r => [r.symbol, r]));
          return {
            scannerResults: (d.opportunities || []).map(o => {
              const n = normalizeOpportunity(o);
              if (!n) return null;
              const p = prevMap.get(n.symbol);
              if (!p) return n;

              // BOLT: Aggressive data retention. Preserve telemetry and breakdowns across gated updates.
              return {
                ...n,
                history: (n.history && n.history.length > 0) ? n.history : p.history,
                ohlc_history: (n.ohlc_history && n.ohlc_history.length > 0) ? n.ohlc_history : p.ohlc_history,
                score_breakdown: n.score_breakdown || p.score_breakdown,
                signalResult: n.signalResult || p.signalResult
              };
            }).filter(Boolean),
            variantScannerResults: d.variant_opportunities ? d.variant_opportunities.reduce((acc, v) => {
              const prevOppMap = new Map((st.variantScannerResults[v.strategy_label] || []).map(r => [r.symbol, r]));
              acc[v.strategy_label] = v.opportunities.map(o => {
                const n = normalizeOpportunity(o);
                if (!n) return null;
                const p = prevOppMap.get(n.symbol);
                if (!p) return n;
                return {
                  ...n,
                  history: (n.history && n.history.length > 0) ? n.history : p.history,
                  ohlc_history: (n.ohlc_history && n.ohlc_history.length > 0) ? n.ohlc_history : p.ohlc_history,
                  score_breakdown: n.score_breakdown || p.score_breakdown,
                  signalResult: n.signalResult || p.signalResult
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
        set(st => ({ activeTrades: d.event === 'closed' ? st.activeTrades.filter(x => x.symbol !== d.symbol) : (t ? [...st.activeTrades, t] : st.activeTrades), tradeHistory: d.event === 'closed' && t ? [t, ...st.tradeHistory].slice(0, 50) : st.tradeHistory, entryCount: d.stats?.entryCount ?? st.entryCount, hitCount: d.stats?.hitCount ?? st.hitCount }));
      } else if (d.type === 'gate') set(st => ({ gateState: d.gateState, gateReason: d.reason, hibernating: d.hibernating ?? st.hibernating, isAdaptiveTightened: d.isAdaptiveTightened ?? st.isAdaptiveTightened, scannerPaused: d.scannerPaused }));
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
}))
