import { createWithEqualityFn } from 'zustand/traditional'
import { sessionAPI } from '../api/client'
import { CONFIG_LIMITS, ENGINE_CONSTANTS } from '../constants/configLimits'

const toNumber = (v, f = 0) => { const p = Number(v); return Number.isFinite(p) ? p : f; }
const MAX_LOG_LINES = 500;
const DEFAULT_LOG_FILTERS = { info: true, warn: true, error: true };

const normalizeOpportunity = (o = {}) => {
  const m = toNumber(o.pct ?? o.momentum ?? o.percent_change);
  const d = (o.dir ?? o.direction ?? (m >= 0 ? 'long' : 'short')).toString().toLowerCase();
  return { ...o, symbol: o.symbol ?? '---', pct: m, momentum: m, dir: d, direction: d, vol: toNumber(o.vol ?? o.volume ?? o.volume_usdt ?? o.volume_24h), score: toNumber(o.score), price: toNumber(o.price) };
}

const normalizeTrade = (t = {}, pt = null) => {
  if (!t || typeof t !== 'object') return null;
  const p = pt || {};
  const f = `${t.pnl}:${t.rr}:${t.current_price}:${t.sl_price}`;
  if (p._fingerprint === f && !t._delta && !t._thin) return p;
  if (t._delta || t._thin) {
    return { ...p, ...t, pnl: t.pnl !== undefined ? toNumber(t.pnl) : p.pnl, rr: t.rr !== undefined ? toNumber(t.rr) : p.rr, current_price: t.current_price !== undefined ? toNumber(t.current_price) : p.current_price, sl_price: t.sl_price !== undefined ? toNumber(t.sl_price) : p.sl_price, max_rr: t.max_rr !== undefined ? toNumber(t.max_rr) : p.max_rr, exit_signals_status: t.exit_signals_status || p.exit_signals_status || {}, strategy_config: t.strategy_config || p.strategy_config, live_rr_sequence: t.live_rr_sequence || p.live_rr_sequence, exit_rr_sequence: t.exit_rr_sequence || p.exit_rr_sequence, sl_adjustments: t.sl_adjustments || p.sl_adjustments, exit_signal_logic: t.exit_signal_logic || p.exit_signal_logic, tp_mode: t.tp_mode || p.tp_mode, tp_ratio: t.tp_ratio !== undefined ? toNumber(t.tp_ratio) : p.tp_ratio };
  }
  const ep = toNumber(t.entry_price ?? t.entry ?? p.entry_price);
  return { ...t, symbol: t.symbol ?? p.symbol ?? '---', strategy_label: t.strategy_label ?? p.strategy_label ?? 'Momentum Strategy', direction: (t.direction ?? t.side ?? p.direction ?? '').toString().toUpperCase(), entry_price: ep, current_price: toNumber(t.current_price ?? t.current ?? p.current_price ?? t.exit_price ?? ep, ep), sl_price: toNumber(t.sl_price ?? t.current_sl ?? t.sl ?? t.initial_sl ?? p.sl_price), initial_sl: toNumber(t.initial_sl ?? t.sl_price ?? t.sl ?? p.initial_sl), tp_price: t.tp_price == null && t.tp == null ? p.tp_price ?? null : toNumber(t.tp_price ?? t.tp), pnl: t.pnl !== undefined ? toNumber(t.pnl) : p.pnl ?? 0, rr: (t.rr !== undefined) ? toNumber(t.rr) : p.rr ?? 0, max_rr: (t.max_rr !== undefined) ? toNumber(t.max_rr) : p.max_rr ?? 0, live_rr_sequence: t.live_rr_sequence || p.live_rr_sequence || [], exit_rr_sequence: t.exit_rr_sequence || p.exit_rr_sequence || [], tp_mode: t.tp_mode || p.tp_mode || (t.tp_price == null && t.tp == null ? 'exp_rr_seq' : 'fixed'), tp_ratio: (t.tp_ratio !== undefined) ? toNumber(t.tp_ratio, 2) : p.tp_ratio ?? 0, sl_adjustments: t.sl_adjustments || p.sl_adjustments || [], exit_reason: t.exit_reason ?? p.exit_reason, exit_price: t.exit_price == null ? (p.exit_price == null ? undefined : toNumber(p.exit_price)) : toNumber(t.exit_price), paper_mode: t.paper_mode ?? p.paper_mode ?? true, qty: toNumber(t.qty ?? t.quantity ?? p.qty ?? 0), max_rr_achieved: toNumber(t.max_rr_achieved ?? t.max_rr ?? p.max_rr_achieved ?? 0), exit_signals_status: t.exit_signals_status || p.exit_signals_status || {}, strategy_config: t.strategy_config || p.strategy_config, _fingerprint: f };
}

const normalizeLog = (l = {}) => {
  const lv = (l.level || l.lv || 'info').toString().toLowerCase();
  const m = (l.msg || l.message || '').toString().trim();
  return { ...l, id: l.id || Math.random().toString(36).substring(2, 15), ts: l.ts || l.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), level: ['info', 'warn', 'error'].includes(lv) ? lv : 'info', msg: m };
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
  paper_starting_balance: CONFIG_LIMITS.PAPER_STARTING_BALANCE_DEFAULT,
  live_starting_balance: CONFIG_LIMITS.LIVE_STARTING_BALANCE_DEFAULT,
  hot_loop_interval_ms: CONFIG_LIMITS.HOT_LOOP_DEFAULT,
  main_loop_interval_ms: CONFIG_LIMITS.MAIN_LOOP_DEFAULT,
  debug_mode: false,
};

export const useTradingStore = createWithEqualityFn((set, get) => ({
  sessionActive: false, sessionPaused: false, strategyId: null, balance: 10000, totalPnl: 0, totalRiskPct: 0, totalSlUsed: 0,
  activeTrades: [], logs: [], logFilters: DEFAULT_LOG_FILTERS, scannerResults: [], variantScannerResults: {}, variantStats: {}, activeWindows: [], tradeHistory: [], lifetimeAnalytics: null,
  gateState: null, gateReason: null, hibernating: false, scannerPaused: false, wsStatus: 'offline', sessionList: [], monitoring: null, isEcoMode: false, analytics: null,
  isSyncing: false,
  rateLimit: { used_weight_1m: 0, limit: ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT, used_pct: 0 }, config: defaultConfig,
  sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true', 
  healthEnabled: localStorage.getItem('health_enabled') !== 'false',
  streamingEnabled: localStorage.getItem('streaming_enabled') !== 'false',
  isThrottled: false, entryCount: 0, hitCount: 0,
  
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
  toggleLogFilter: (level) => set((st) => ({ logFilters: { ...st.logFilters, [level]: !st.logFilters[level] } })),
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
        scannerResults: res.data.scannerResults || [],
        activeWindows: res.data.activeWindows || [],
        tradeHistory: res.data.history || [],
        config: res.data.config ? { ...st.config, ...res.data.config } : st.config,
      });
    } catch (e) {
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
  updateConfig: (c) => {
    if (c.trading_mode) {
      localStorage.setItem('global_trading_mode', c.trading_mode);
    }
    set((st) => ({ config: { ...st.config, ...c } }));
  },
  
  ws: null, reconnectAttempts: 0,
  connectWS: () => {
    if (get().ws) return;
    set({ wsStatus: 'connecting' });
    let u = import.meta.env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss://' : 'ws://'}${window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.hostname + (window.location.port ? ':' + window.location.port : '')}/session/ws`;
    if (u && !u.includes('/session/ws')) u = u.replace(/\/$/, '') + '/session/ws';
    const ak = localStorage.getItem('MOMENTUM_ADMIN_API_KEY') || import.meta.env.VITE_ADMIN_API_KEY;
    if (ak) u += (u.includes('?') ? '&' : '?') + `token=${encodeURIComponent(ak)}`;
    const ws = new WebSocket(u);
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
          if (d.history && d.history.length > 0) {
            const incoming = d.history.map(t => normalizeTrade(t)).filter(Boolean);
            const m = new Map(st.tradeHistory.map(t => [t.id, t]));
            incoming.forEach(t => m.set(t.id, t));
            nextHistory = Array.from(m.values()).sort((a, b) => new Date(b.exit_ts || b.createdAt).getTime() - new Date(a.exit_ts || a.createdAt).getTime());
          }

          return { sessionActive: d.running ?? d.status === 'started', sessionPaused: d.paused ?? st.sessionPaused, strategyId: d.strategyId || st.strategyId, balance: d.balance ?? st.balance, totalPnl: d.totalPnl ?? d.total_pnl ?? st.totalPnl, totalRiskPct: d.totalRiskPct ?? st.totalRiskPct, totalSlUsed: d.totalSlUsed ?? st.totalSlUsed, entryCount: d.stats?.entryCount ?? st.entryCount, hitCount: d.stats?.hitCount ?? st.hitCount, activeTrades: nt, scannerResults: d.scannerResults?.map(normalizeOpportunity) || st.scannerResults, activeWindows: d.activeWindows?.map(w => ({...w})) || st.activeWindows, tradeHistory: nextHistory, gateState: d.gateState ?? st.gateState, scannerPaused: d.scannerPaused ?? st.scannerPaused, config: d.config ? { ...st.config, ...d.config } : st.config };
        });
      } else if (d.type === 'tick') {
        set((st) => {
          let nt = st.activeTrades; if (d.trades) { const m = new Map(st.activeTrades.map(t => [t.id, t])); d.trades.forEach(t => { const p = m.get(t.id); const n = normalizeTrade(t, p); if (n) m.set(t.id, n); }); if (d._heartbeat) { const ids = new Set(d.trades.map(t => t.id)); for (const id of m.keys()) if (!ids.has(id)) m.delete(id); } nt = Array.from(m.values()); }
          return { balance: d.balance ?? st.balance, totalPnl: d.total_pnl ?? st.totalPnl, totalRiskPct: d.total_risk_pct ?? st.totalRiskPct, totalSlUsed: d.total_sl_used ?? st.totalSlUsed, entryCount: d.stats?.entryCount ?? st.entryCount, hitCount: d.stats?.hitCount ?? st.hitCount, activeTrades: nt, variantStats: d.variant_stats || st.variantStats, activeWindows: d.activeWindows || st.activeWindows, gateState: d.gateState ?? st.gateState, hibernating: d.hibernating ?? st.hibernating, gateReason: d.reason || st.gateReason, sessionPaused: d.paused ?? st.sessionPaused, scannerPaused: d.scannerPaused ?? st.scannerPaused, rateLimit: d.rateLimit || st.rateLimit, monitoring: d.monitoring || st.monitoring, isEcoMode: d.isEcoMode ?? st.isEcoMode, analytics: d.analytics || st.analytics };
        });
      } else if (d.type === 'log') set(st => ({ logs: [normalizeLog(d), ...st.logs].slice(0, MAX_LOG_LINES) }));
      else if (d.type === 'scanner') {
        const now = Date.now(); if (now - lsu < 200) return; lsu = now;
        set(st => ({ scannerResults: (d.opportunities || []).map(o => { const n = normalizeOpportunity(o); const p = st.scannerResults.find(x => x.symbol === n.symbol); return p ? { ...n, history: n.history ?? p.history, signalResult: n.signalResult ?? p.signalResult } : n; }), variantScannerResults: d.variant_opportunities ? d.variant_opportunities.reduce((acc, v) => { acc[v.strategy_label] = v.opportunities.map(normalizeOpportunity); return acc; }, {}) : st.variantScannerResults, activeWindows: d.activeWindows || st.activeWindows }));
      } else if (d.type === 'trade_event') {
        const t = d.trade ? normalizeTrade(d.trade) : null;
        set(st => ({ activeTrades: d.event === 'closed' ? st.activeTrades.filter(x => x.symbol !== d.symbol) : (t ? [...st.activeTrades, t] : st.activeTrades), tradeHistory: d.event === 'closed' && t ? [t, ...st.tradeHistory].slice(0, 50) : st.tradeHistory, entryCount: d.stats?.entryCount ?? st.entryCount, hitCount: d.stats?.hitCount ?? st.hitCount }));
      } else if (d.type === 'gate') set(st => ({ gateState: d.gateState, gateReason: d.reason, hibernating: d.hibernating ?? st.hibernating, scannerPaused: d.scannerPaused }));
    };
    ws.onclose = () => { set({ ws: null, wsStatus: 'offline' }); if (get().sessionActive) { const att = get().reconnectAttempts; const del = Math.min(1000 * Math.pow(2, att), 30000); set({ reconnectAttempts: att + 1 }); setTimeout(() => get().connectWS(), del); } };
    set({ ws });
  },
  disconnectWS: () => { if (get().ws) { get().ws.close(); set({ ws: null, wsStatus: 'offline' }); } },
}))
