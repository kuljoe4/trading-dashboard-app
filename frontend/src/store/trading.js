import { create } from 'zustand'
import { sessionAPI } from '../api/client'

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

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
    qty: trade.qty ?? trade.quantity ?? prev.qty ?? 0,
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
  max_total_risk_pct: 5,
  total_sl_guard_usdt: 200,
  scan_interval: '5m',
  scan_pct_threshold: 2.0,
  scan_lookback: 3,
  scan_min_volume_usdt: 500000,
  scan_mode: 'interval',
  scan_window_duration_sec: 90,
  scan_check_interval_sec: 5,
  entry_side: 'both',
  watchlist_size: 50,
  enabled_signals: ['momentum_pct'],
  signal_logic: 'all',
  tp_mode: 'fixed',
  tp_ratio: 2,
  live_rr_sequence: [1, 2, 4],
  exit_rr_sequence: [0, 1, 2],
  sl_type: 'pct',
  sl_distance_pct: 0.8,
  sl_lookback_timeframe: '5m',
  sl_lookback_period: 5,
  sl_min_pct: 0.3,
  sl_max_pct: 3,
  risk_pct_per_trade: 1,
  max_open_trades: 5,
  paper_starting_balance: 10000,
  live_starting_balance: 10000,
}

export const useTradingStore = create((set, get) => ({
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
  activeWindows: [],
  tradeHistory: [],
  gateState: null,
  scannerPaused: false,
  wsStatus: 'offline',
  sessionList: [],
  monitoring: null,
  rateLimit: {
    used_weight_1m: 0,
    limit: 1200,
    used_pct: 0,
  },
  sessionSummary: null,
  config: defaultConfig,
  logFilters: loadLogFilters(),
  
  // UX Settings
  healthEnabled: localStorage.getItem('health_enabled') !== 'false',
  streamingEnabled: localStorage.getItem('streaming_enabled') !== 'false',
  sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true',

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    localStorage.setItem('sidebar_collapsed', next)
    set({ sidebarCollapsed: next })
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
    if (state.logs.length > 0 && state.logs[0].level === normalized.level && state.logs[0].msg === normalized.msg) return {}
    return { logs: [normalized, ...state.logs].slice(0, 100) }
  }),

  ws: null,
  connectWS: () => {
    if (get().ws) return
    set({ wsStatus: 'connecting' })

    const wsUrl = import.meta.env.VITE_WS_URL || (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + (window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.hostname + (window.location.port ? ':' + window.location.port : '')) + '/session/ws'
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      set({ wsStatus: 'live' })
      // Send current health preference on open
      ws.send(JSON.stringify({ type: 'set_monitoring', enabled: get().healthEnabled }))
      ws.send(JSON.stringify({ type: 'set_log_filters', filters: get().logFilters }))
    }

    // Throttled scanner update to prevent React choking on high-freq updates
    let lastScannerUpdate = 0;
    const SCANNER_THROTTLE_MS = 200;

    ws.onmessage = (event) => {
      if (!get().streamingEnabled) return;
      const data = JSON.parse(event.data)

      if (data.type === 'status') {
        set((state) => {
          const stopped = data.running === false
          return {
            sessionActive: data.running,
            sessionPaused: data.paused ?? state.sessionPaused,
            strategyId: data.strategyId || state.strategyId,
            balance: data.balance ?? state.balance,
            totalPnl: (data.totalPnl !== undefined && data.totalPnl !== null) ? toNumber(data.totalPnl) : state.totalPnl,
            totalRiskPct: data.totalRiskPct ?? state.totalRiskPct,
            totalSlUsed: data.totalSlUsed ?? state.totalSlUsed,
            activeTrades: stopped ? [] : (data.activeTrades?.map(t => {
              const prev = state.activeTrades.find(p => p.symbol === t.symbol);
              return normalizeTrade(t, prev);
            }).filter(Boolean) || state.activeTrades),
            logs: data.logLines ? uniqueLogs(data.logLines).slice(0, 100) : state.logs,
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
          return {
            sessionActive: data.running ?? data.status === 'started',
            sessionPaused: data.paused ?? false,
            balance: data.balance ?? state.balance,
            config: data.config ? { ...state.config, ...data.config } : state.config,
            activeTrades: stopped ? [] : (data.activeTrades?.map(t => {
              const prev = state.activeTrades.find(p => p.symbol === t.symbol);
              return normalizeTrade(t, prev);
            }).filter(Boolean) || state.activeTrades),            scannerResults: data.scannerResults?.map(normalizeOpportunity) || state.scannerResults,
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
        set((state) => ({
          balance: data.balance ?? state.balance,
          totalPnl: (data.total_pnl !== undefined && data.total_pnl !== null) ? toNumber(data.total_pnl) : state.totalPnl,
          totalRiskPct: data.total_risk_pct ?? state.totalRiskPct,
          totalSlUsed: data.total_sl_used ?? state.totalSlUsed,
          activeTrades: data.trades ? (data.trades || []).map(t => {
            const prev = state.activeTrades.find(p => p.symbol === t.symbol);
            return normalizeTrade(t, prev);
          }).filter(Boolean) : state.activeTrades,
          activeWindows: data.activeWindows ? (data.activeWindows || []).map(normalizeWindow) : state.activeWindows,
          gateState: data.gateState !== undefined ? data.gateState : state.gateState,
          sessionPaused: data.paused !== undefined ? data.paused : state.sessionPaused,
          scannerPaused: data.scannerPaused !== undefined ? data.scannerPaused : state.scannerPaused,
          rateLimit: data.rateLimit || state.rateLimit,
          monitoring: data.monitoring || state.monitoring,
          config: data.config ? { ...state.config, ...data.config } : state.config,
        }))
      } else if (data.type === 'log') {
        get().addLog(data)
      } else if (data.type === 'scanner') {
        const now = Date.now();
        if (now - lastScannerUpdate >= SCANNER_THROTTLE_MS) {
          set({
            scannerResults: (data.opportunities || []).map(normalizeOpportunity),
            activeWindows: (data.activeWindows || []).map(normalizeWindow),
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
          tradeHistory: data.event === 'closed' && trade ? [trade, ...state.tradeHistory].slice(0, 50) : state.tradeHistory,
        }))
      } else if (data.type === 'gate') {
        set((state) => ({
          gateState: data.gateState,
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
