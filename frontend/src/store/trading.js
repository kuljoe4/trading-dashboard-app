import { createWithEqualityFn } from 'zustand/traditional'
import { sessionAPI } from '../api/client'
import { CONFIG_LIMITS } from '../constants/configLimits'

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const MAX_LOG_LINES = 500

const DEFAULT_LOG_FILTERS = {
  info: true,
  warn: true,
  error: true,
}

const loadLogFilters = () => {
  try {
    const stored = localStorage.getItem('log_filters')
    return stored ? JSON.parse(stored) : DEFAULT_LOG_FILTERS
  } catch (e) {
    return DEFAULT_LOG_FILTERS
  }
}

const saveLogFilters = (filters) => {
  try {
    localStorage.setItem('log_filters', JSON.stringify(filters))
  } catch (e) {
    // ignore storage errors
  }
}

const normalizeOpportunity = (opp = {}) => {
  const momentum = toNumber(opp.pct ?? opp.momentum ?? opp.percent_change)
  const direction = (opp.dir ?? opp.direction ?? (momentum >= 0 ? 'long' : 'short')).toString().toLowerCase()

  return {
    ...opp,
    symbol: opp.symbol ?? '---',
    pct: momentum,
    momentum,
    dir: direction,
    direction,
    vol: toNumber(opp.vol ?? opp.volume ?? opp.volume_usdt ?? opp.volume_24h),
    score: toNumber(opp.score),
    price: toNumber(opp.price),
  }
}

const normalizeTrade = (trade = {}, prevTrade = null) => {
  if (!trade || typeof trade !== 'object') return null;

  const prev = prevTrade || {};

  // If this is a delta or thin update, merge it with previous state to preserve all known values
  if (trade._delta || trade._thin) {
    return {
      ...prev,
      ...trade,
      pnl: trade.pnl !== undefined ? toNumber(trade.pnl) : prev.pnl,
      rr: trade.rr !== undefined ? toNumber(trade.rr) : prev.rr,
      current_price: trade.current_price !== undefined ? toNumber(trade.current_price) : prev.current_price,
      sl_price: trade.sl_price !== undefined ? toNumber(trade.sl_price) : prev.sl_price,
      max_rr: trade.max_rr !== undefined ? toNumber(trade.max_rr) : prev.max_rr,
      // Preserve complex fields if missing in the update
      exit_signals_status: trade.exit_signals_status || prev.exit_signals_status || {},
      strategy_config: trade.strategy_config || prev.strategy_config,
      live_rr_sequence: trade.live_rr_sequence || prev.live_rr_sequence,
      exit_rr_sequence: trade.exit_rr_sequence || prev.exit_rr_sequence,
      sl_adjustments: trade.sl_adjustments || prev.sl_adjustments,
      exit_signal_logic: trade.exit_signal_logic || prev.exit_signal_logic,
      tp_mode: trade.tp_mode || prev.tp_mode,
      tp_ratio: trade.tp_ratio !== undefined ? toNumber(trade.tp_ratio) : prev.tp_ratio,
      // Flag to indicate this trade has full details cached
      _is_full: prev._is_full || !trade._thin
    };
  }

  // Preserve existing values when websocket data is partial to avoid flicker
  const entry_price = toNumber(trade.entry_price ?? trade.entry ?? prev.entry_price);
  const current_price = toNumber(
    trade.current_price ?? trade.current ?? prev.current_price ?? trade.exit_price ?? entry_price,
    entry_price,
  );
  const sl_price = toNumber(trade.sl_price ?? trade.current_sl ?? trade.sl ?? trade.initial_sl ?? prev.sl_price);
  const initial_sl = toNumber(trade.initial_sl ?? trade.sl_price ?? trade.sl ?? prev.initial_sl);

  let pnl = prev.pnl ?? 0;
  if (trade.pnl !== undefined && trade.pnl !== null) {
    pnl = toNumber(trade.pnl);
  }

  return {
    ...trade,
    symbol: trade.symbol ?? prev.symbol ?? '---',
    strategy_label: trade.strategy_label ?? prev.strategy_label ?? 'Momentum Strategy',
    direction: (trade.direction ?? trade.side ?? prev.direction ?? '').toString().toUpperCase(),
    entry_price,
    current_price,
    sl_price,
    initial_sl,
    tp_price: trade.tp_price == null && trade.tp == null ? prev.tp_price ?? null : toNumber(trade.tp_price ?? trade.tp),
    pnl,
    rr: (trade.rr !== undefined && trade.rr !== null) ? toNumber(trade.rr) : prev.rr ?? 0,
    max_rr: (trade.max_rr !== undefined && trade.max_rr !== null) ? toNumber(trade.max_rr) : prev.max_rr ?? 0,
    live_rr_sequence: trade.live_rr_sequence || prev.live_rr_sequence || [],
    exit_rr_sequence: trade.exit_rr_sequence || prev.exit_rr_sequence || [],
    tp_mode: trade.tp_mode || prev.tp_mode || (trade.tp_price == null && trade.tp == null ? 'exp_rr_seq' : 'fixed'),
    tp_ratio: (trade.tp_ratio !== undefined && trade.tp_ratio !== null) ? toNumber(trade.tp_ratio, 2) : prev.tp_ratio ?? 0,
    sl_type: trade.sl_type ?? prev.sl_type,
    sl_adjustments: trade.sl_adjustments || prev.sl_adjustments || [],
    exit_reason: trade.exit_reason ?? prev.exit_reason,
    exit_price: trade.exit_price == null ? (prev.exit_price == null ? undefined : toNumber(prev.exit_price)) : toNumber(trade.exit_price),
    paper_mode: trade.paper_mode ?? prev.paper_mode ?? true,
    qty: toNumber(trade.qty ?? trade.quantity ?? prev.qty ?? 0),
    max_rr_achieved: toNumber(trade.max_rr_achieved ?? trade.max_rr ?? prev.max_rr_achieved ?? 0),
    exit_signals_status: trade.exit_signals_status || prev.exit_signals_status || {},
    strategy_config: trade.strategy_config || prev.strategy_config,
  };
}

const normalizeLog = (log = {}) => {
  const level = (log.level || log.lv || 'info').toString().toLowerCase()
  const msg = (log.msg || log.message || '').toString().trim()

  return {
    ...log,
    id: log.id || Math.random().toString(36).substring(2, 15),
    ts: log.ts || log.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    level: ['info', 'warn', 'error'].includes(level) ? level : 'info',
    msg,
  }
}

const uniqueLogs = (logs = []) => {
  const seen = new Set()
  return logs.filter((log) => {
    const normalized = normalizeLog(log)
    const key = `${normalized.level}::${normalized.msg}::${normalized.ts}`
    if (seen.has(key) || !normalized.msg) return false
    seen.add(key)
    return true
  })
}

const normalizeWindow = (window = {}) => ({
  ...window,
  symbol: window.symbol || '---',
  direction: (window.direction || window.dir || 'long').toString().toLowerCase(),
  pct_change: toNumber(window.pct_change ?? window.pct),
  remaining_ms: toNumber(window.remaining_ms),
  checks: toNumber(window.checks),
  entries: toNumber(window.entries),
})

const defaultConfig = {
  paper_mode: true,
  strategy_label: 'Momentum Strategy',
  strategy_variants: [],
  max_total_risk_pct: CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT,
  total_sl_guard_usdt: 200,
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
  tp_ratio: 2,
  live_rr_sequence: [1, 2, 4],
  exit_rr_sequence: [0, 1, 2],
  sl_type: 'pct',
  sl_distance_pct: CONFIG_LIMITS.SL_DISTANCE_DEFAULT,
  sl_lookback_timeframe: '5m',
  sl_lookback_period: 5,
  sl_min_pct: 0.3,
  sl_max_pct: 3,
  risk_pct_per_trade: CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT,
  max_open_trades: 5,
  paper_starting_balance: 10000,
  live_starting_balance: 10000,
  hot_loop_interval_ms: CONFIG_LIMITS.HOT_LOOP_DEFAULT,
  main_loop_interval_ms: CONFIG_LIMITS.MAIN_LOOP_DEFAULT,
  debug_mode: false,
}

export const useTradingStore = createWithEqualityFn((set, get) => ({
  sessionActive: false,
  sessionPaused: false,
  strategyId: null,
  balance: 10000,
  totalPnl: 0,
  totalRiskPct: 0,
  totalSlUsed: 0,
  activeTrades: [],
  logs: [],
  scannerResults: [],
  variantScannerResults: {},
  variantStats: {},
  activeWindows: [],
  tradeHistory: [],
  lifetimeAnalytics: null,
  gateState: null,
  gateReason: null,
  hibernating: false,
  scannerPaused: false,
  wsStatus: 'offline',
  sessionList: [],
  monitoring: null,
    isEcoMode: false,
  analytics: null,
  rateLimit: {
    used_weight_1m: 0,
    limit: 1200,
    used_pct: 0,
  },
  sessionSummary: null,
  config: defaultConfig,
  logFilters: loadLogFilters(),
  
  // Resource Focus Subscriptions
  // Contract: components register interest in resources.
  // Focus mode is sent to backend only when the aggregate interest changes,
  // debounced to handle navigation handoffs.
  _subscriptions: {
    trades: new Map(), // tradeId -> count
    strategies: new Map(), // strategyLabel -> count
    globalTrades: 0, // global trades view interest count
    scanner: 0, // scanner interest count
  },
  _focusTimer: null,

  registerInterest: (type, id) => {
    const subs = { ...get()._subscriptions };
    if (type === 'trade') subs.trades.set(id, (subs.trades.get(id) || 0) + 1);
    if (type === 'strategy') subs.strategies.set(id, (subs.strategies.get(id) || 0) + 1);
    if (type === 'global_trades') subs.globalTrades++;
    if (type === 'scanner') subs.scanner++;

    set({ _subscriptions: subs });
    get()._syncFocusToBackend();
  },

  unregisterInterest: (type, id) => {
    const subs = { ...get()._subscriptions };
    if (type === 'trade') {
       const count = (subs.trades.get(id) || 0) - 1;
       if (count <= 0) subs.trades.delete(id); else subs.trades.set(id, count);
    }
    if (type === 'strategy') {
       const count = (subs.strategies.get(id) || 0) - 1;
       if (count <= 0) subs.strategies.delete(id); else subs.strategies.set(id, count);
    }
    if (type === 'global_trades') subs.globalTrades = Math.max(0, subs.globalTrades - 1);
    if (type === 'scanner') subs.scanner = Math.max(0, subs.scanner - 1);

    set({ _subscriptions: subs });
    get()._syncFocusToBackend();
  },

  _syncFocusToBackend: () => {
    if (get()._focusTimer) clearTimeout(get()._focusTimer);

    // 100ms debounce bridges the gap between old component unmount and new component mount
    const timer = setTimeout(() => {
       const { _subscriptions, ws } = get();
       if (!ws || ws.readyState !== WebSocket.OPEN) return;

       // Determine aggregate focus
       const focusEnabled = _subscriptions.trades.size > 0 || _subscriptions.strategies.size > 0 || _subscriptions.globalTrades > 0 || _subscriptions.scanner > 0;

       let tradeId = null;
       if (_subscriptions.trades.size > 0) {
          tradeId = Array.from(_subscriptions.trades.keys())[0];
       } else if (_subscriptions.globalTrades > 0) {
          tradeId = 'all';
       }

       let strategyLabel = null;
       if (_subscriptions.strategies.size > 0) {
          strategyLabel = Array.from(_subscriptions.strategies.keys())[0];
       }

       ws.send(JSON.stringify({
         type: 'set_focus_mode',
         enabled: focusEnabled,
         tradeId,
         strategyLabel
       }));
    }, 100);

    set({ _focusTimer: timer });
  },

  // UX Settings
  healthEnabled: localStorage.getItem('health_enabled') !== 'false',
  streamingEnabled: localStorage.getItem('streaming_enabled') !== 'false',
  debugToolsEnabled: new URLSearchParams(window.location.search).get('debug') === 'true',
  sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true',
  isThrottled: false,
  entryCount: 0,
  hitCount: 0,

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    localStorage.setItem('sidebar_collapsed', next)
    set({ sidebarCollapsed: next })
  },
  
  setThrottled: (isThrottled) => {
    set({ isThrottled })
    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_active', active: !isThrottled }))
    }
  },

  setHealthEnabled: (enabled) => {
    localStorage.setItem('health_enabled', enabled)
    set({ healthEnabled: enabled })
    
    // Signal preference to backend if WS is open
    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_monitoring', enabled }))
    }
  },
  
  setStreamingEnabled: (enabled) => {
    localStorage.setItem('streaming_enabled', enabled)
    set({ streamingEnabled: enabled })
  },

  setFocusMode: (focused, tradeId = null, strategyLabel = null) => {
    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'set_focus_mode',
        enabled: focused,
        tradeId,
        strategyLabel
      }))
    }
  },

  setSessionActive: (active, id) => {
    set({ sessionActive: active, strategyId: id })
    if (active) {
      get().connectWS()
    } else {
      get().disconnectWS()
    }
  },

  clearSessionState: (summary = null) => set({
    sessionActive: false,
    sessionPaused: false,
    strategyId: null,
    activeTrades: [],
    scannerResults: [],
    activeWindows: [],
    gateState: null,
    scannerPaused: false,
    monitoring: null,
    rateLimit: { used_weight_1m: 0, limit: 1200, used_pct: 0 },
    sessionSummary: summary,
  }),

  fetchSessions: async () => {
    try {
      const res = await sessionAPI.list()
      set({ sessionList: res.data })
    } catch (e) {
      console.error('tradingStore: fetchSessions error:', e);
    }
  },

  fetchLifetimeAnalytics: async (mode = 'paper') => {
    try {
      const res = await sessionAPI.getLifetimeAnalytics(mode)
      set({ lifetimeAnalytics: res.data })
    } catch (e) {
      console.error('tradingStore: fetchLifetimeAnalytics error:', e);
    }
  },

  resetPaperBalance: async () => {
    try {
      await sessionAPI.resetPaperBalance()
      await get().fetchLifetimeAnalytics()
      return true
    } catch (e) {
      console.error('tradingStore: resetPaperBalance error:', e);
      return false
    }
  },

  updateStats: (stats) => set((state) => ({ ...state, ...stats })),
  updateConfig: (newConfig) => set((state) => ({ config: { ...state.config, ...newConfig } })),
  toggleLogFilter: (level) => set((state) => {
    const next = { ...state.logFilters, [level]: !state.logFilters[level] }
    saveLogFilters(next)
    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_log_filters', filters: next }))
    }
    return { logFilters: next }
  }),
  addLog: (log) => set((state) => {
    const normalized = normalizeLog(log)
    if (!normalized.msg) return {}
    // Avoid exact duplicates back-to-back
    if (state.logs.length > 0 && state.logs[0].level === normalized.level && state.logs[0].msg === normalized.msg) return {}
    return { logs: [normalized, ...state.logs].slice(0, MAX_LOG_LINES) }
  }),

  mergeLogs: (incomingLogs) => set((state) => {
    if (!incomingLogs || incomingLogs.length === 0) return {}

    // Create a set of existing log IDs to prevent duplicates
    const existingIds = new Set(state.logs.map(l => l.id))
    const newLogs = incomingLogs
      .map(normalizeLog)
      .filter(l => l.msg && !existingIds.has(l.id))

    if (newLogs.length === 0) return {}

    // Incoming status logs are already newest-first; avoid a no-op sort and cap memory.
    return { logs: uniqueLogs([...newLogs, ...state.logs]).slice(0, MAX_LOG_LINES) }
  }),

  ws: null,
  connectWS: () => {
    if (get().ws) return
    set({ wsStatus: 'connecting' })

    let wsUrl = import.meta.env.VITE_WS_URL;
    
    if (wsUrl) {
      // Ensure the URL ends with /session/ws
      if (!wsUrl.endsWith('/session/ws')) {
        wsUrl = wsUrl.replace(/\/$/, '') + '/session/ws';
      }
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      const host = window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.hostname + (window.location.port ? ':' + window.location.port : '');
      wsUrl = `${protocol}${host}/session/ws`;
    }

    // Security: Inject API key as token if configured
    const adminKey = import.meta.env.VITE_ADMIN_API_KEY;
    if (adminKey) {
      wsUrl += (wsUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(adminKey)}`;
    }

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      set({ wsStatus: 'live' })
      // Send current health preference on open
      ws.send(JSON.stringify({ type: 'set_monitoring', enabled: get().healthEnabled }))
      ws.send(JSON.stringify({ type: 'set_log_filters', filters: get().logFilters }))
      ws.send(JSON.stringify({ type: 'set_active', active: !get().isThrottled }))
    }

    // Throttled scanner update to prevent React choking on high-freq updates
    let lastScannerUpdate = 0;
    const SCANNER_THROTTLE_MS = 200;

    ws.onmessage = (event) => {
      if (!get().streamingEnabled || get().isThrottled) return;
      const data = JSON.parse(event.data)

      if (data.type === 'status') {
        // First merge logs to ensure persistence
        if (data.logLines) {
          get().mergeLogs(data.logLines)
        }

        set((state) => {
          const stopped = data.running === false
          let nextTrades = state.activeTrades;

          if (stopped) {
            nextTrades = [];
          } else if (data.activeTrades) {
              // If we are in focus mode and receive a status update that is thin,
              // we must be careful not to overwrite our rich local state.
              const prevMap = new Map(state.activeTrades.map(t => [t.id || t.symbol, t]));
              nextTrades = data.activeTrades.map(t => normalizeTrade(t, prevMap.get(t.id || t.symbol))).filter(Boolean);
          }

          return {
            sessionActive: data.running,
            sessionPaused: data.paused ?? state.sessionPaused,
            strategyId: data.strategyId || state.strategyId,
            balance: data.balance ?? state.balance,
            totalPnl: (data.totalPnl !== undefined && data.totalPnl !== null) ? toNumber(data.totalPnl) : state.totalPnl,
            totalRiskPct: data.totalRiskPct ?? state.totalRiskPct,
            totalSlUsed: data.totalSlUsed ?? state.totalSlUsed,
            entryCount: data.stats?.entryCount ?? state.entryCount,
            hitCount: data.stats?.hitCount ?? state.hitCount,
            activeTrades: nextTrades,
            // Logs are handled via mergeLogs above
            scannerResults: data.scannerResults?.map(normalizeOpportunity) || state.scannerResults,
            activeWindows: data.activeWindows?.map(normalizeWindow) || state.activeWindows,
            tradeHistory: data.history?.map(t => {
               const prev = state.tradeHistory.find(p => p.symbol === t.symbol);
               return normalizeTrade(t, prev);
            }).filter(Boolean) || state.tradeHistory,
            gateState: data.gateState ?? state.gateState,
            scannerPaused: data.scannerPaused ?? state.scannerPaused,
            config: data.config ? { ...state.config, ...data.config } : state.config,
          }
        })
      } else if (data.type === 'session') {
        set((state) => {
          const stopped = data.status === 'stopped'
          let nextTrades = state.activeTrades;
          if (stopped) {
            nextTrades = [];
          } else if (data.activeTrades) {
            const prevMap = new Map(state.activeTrades.map(t => [t.symbol, t]));
            nextTrades = data.activeTrades.map(t => normalizeTrade(t, prevMap.get(t.symbol))).filter(Boolean);
          }

          return {
            sessionActive: data.running ?? data.status === 'started',
            sessionPaused: data.paused ?? false,
            balance: data.balance ?? state.balance,
            config: data.config ? { ...state.config, ...data.config } : state.config,
            activeTrades: nextTrades,
            scannerResults: data.scannerResults?.map(normalizeOpportunity) || state.scannerResults,
            activeWindows: data.activeWindows?.map(normalizeWindow) || state.activeWindows,
            tradeHistory: data.history?.map(t => {
              const prev = state.tradeHistory.find(p => p.symbol === t.symbol);
              return normalizeTrade(t, prev);
            }).filter(Boolean) || state.tradeHistory,
            gateState: data.gateState ?? state.gateState,
            scannerPaused: data.scannerPaused ?? state.scannerPaused,
            sessionSummary: stopped
              ? {
                  endedAt: new Date().toISOString(),
                  totalPnl: state.totalPnl,
                  tradeCount: state.tradeHistory.length,
                  reason: 'stopped',
                }
              : null,
          }
        })
      } else if (data.type === 'tick') {
        set((state) => {
          let nextTrades = state.activeTrades;
          let tradesChanged = false;

          if (data.trades) {
            const tradeMap = new Map(state.activeTrades.map(t => [t.id || t.symbol, t]));

            data.trades.forEach(t => {
               const key = t.id || t.symbol;
               const prev = tradeMap.get(key);
               const normalized = normalizeTrade(t, prev);
               if (normalized) {
                 tradeMap.set(key, normalized);
                 tradesChanged = true;
               }
            });

            if (data._heartbeat) {
               const incomingIds = new Set(data.trades.map(t => t.id));
               for (const id of tradeMap.keys()) {
                 if (!incomingIds.has(id)) {
                   tradeMap.delete(id);
                   tradesChanged = true;
                 }
               }
            }

            if (tradesChanged) {
              nextTrades = Array.from(tradeMap.values());
            }
          }

          return {
            balance: data.balance ?? state.balance,
            totalPnl: (data.total_pnl !== undefined && data.total_pnl !== null) ? toNumber(data.total_pnl) : state.totalPnl,
            totalRiskPct: data.total_risk_pct ?? state.totalRiskPct,
            totalSlUsed: data.total_sl_used ?? state.totalSlUsed,
            entryCount: data.stats?.entryCount ?? state.entryCount,
            hitCount: data.stats?.hitCount ?? state.hitCount,
            activeTrades: nextTrades,
            variantStats: data.variant_stats || state.variantStats,
            activeWindows: data.activeWindows ? (data.activeWindows || []).map(normalizeWindow) : state.activeWindows,
            gateState: data.gateState !== undefined ? data.gateState : state.gateState,
            hibernating: data.hibernating !== undefined ? data.hibernating : state.hibernating,
            gateReason: data.reason || state.gateReason,
            sessionPaused: data.paused !== undefined ? data.paused : state.sessionPaused,
            scannerPaused: data.scannerPaused !== undefined ? data.scannerPaused : state.scannerPaused,
            rateLimit: data.rateLimit || state.rateLimit,
            monitoring: data.monitoring || state.monitoring,
            isEcoMode: data.isEcoMode !== undefined ? data.isEcoMode : state.isEcoMode,
            analytics: data.analytics ? { ...state.analytics, ...data.analytics } : state.analytics,
            config: data.config ? { ...state.config, ...data.config } : state.config,
          };
        })
      } else if (data.type === 'log') {
        get().addLog(data)
      } else if (data.type === 'scanner') {
        const now = Date.now();
        if (now - lastScannerUpdate >= SCANNER_THROTTLE_MS) {
          const variantResults = {};
          if (data.variant_opportunities) {
            data.variant_opportunities.forEach(v => {
               variantResults[v.strategy_label] = (v.opportunities || []).map(normalizeOpportunity);
            });
          }

          set((state) => {
            const nextResults = (data.opportunities || []).map(o => {
              const normalized = normalizeOpportunity(o);
              const prev = state.scannerResults.find(p => p.symbol === normalized.symbol);
              if (prev) {
                if (normalized.history === undefined) normalized.history = prev.history;
                if (normalized.signalResult === undefined) normalized.signalResult = prev.signalResult;
              }
              return normalized;
            });

            const nextVariantResults = {};
            Object.keys(variantResults).forEach(label => {
              nextVariantResults[label] = variantResults[label].map(o => {
                const prev = state.variantScannerResults[label]?.find(p => p.symbol === o.symbol);
                if (prev) {
                  if (o.history === undefined) o.history = prev.history;
                  if (o.signalResult === undefined) o.signalResult = prev.signalResult;
                }
                return o;
              });
            });

            return {
              scannerResults: nextResults,
              variantScannerResults: nextVariantResults,
              activeWindows: (data.activeWindows || []).map(normalizeWindow),
            };
          })
          lastScannerUpdate = now;
        }
      } else if (data.type === 'session_terminated') {
        const currentState = get()
        get().addLog({ level: 'warn', msg: 'Session terminated, clearing active positions.' })
        get().clearSessionState({
          endedAt: new Date().toISOString(),
          totalPnl: currentState.totalPnl,
          tradeCount: currentState.tradeHistory.length,
          reason: data.reason || 'terminated',
        })
      } else if (data.type === 'trade_event') {
        const trade = data.trade ? normalizeTrade(data.trade) : null
        get().addLog({ level: 'info', msg: `${data.symbol}: ${data.event} ${data.reason || ''}` })
        set((state) => ({
          activeTrades: data.event === 'closed'
            ? state.activeTrades.filter((t) => t.symbol !== data.symbol)
            : (trade ? [...state.activeTrades, trade] : state.activeTrades),
          tradeHistory: data.event === 'closed' && trade
            ? [trade, ...state.tradeHistory].slice(0, 50)
            : state.tradeHistory,
          entryCount: data.stats?.entryCount ?? state.entryCount,
          hitCount: data.stats?.hitCount ?? state.hitCount,
          analytics: data.analytics ? { ...state.analytics, ...data.analytics } : state.analytics,
        }))
      } else if (data.type === 'gate') {
        set((state) => ({
          gateState: data.gateState,
          gateReason: data.reason,
          hibernating: data.hibernating ?? state.hibernating,
          scannerPaused: data.scannerPaused,
        }))
        get().addLog({ level: 'warn', msg: data.reason || 'Risk gate active' })
      }
    }

    ws.onclose = () => {
      set({ ws: null, wsStatus: 'offline' })
      if (get().sessionActive) {
        setTimeout(() => get().connectWS(), 2000)
      }
    }

    ws.onerror = () => set({ wsStatus: 'failed' })

    set({ ws })
  },

  disconnectWS: () => {
    if (get().ws) {
      get().ws.close()
      set({ ws: null, wsStatus: 'offline' })
    }
  },
}))
