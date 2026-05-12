import { create } from 'zustand'
import { sessionAPI } from '../api/client'

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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

const normalizeTrade = (trade = {}) => ({
  ...trade,
  symbol: trade.symbol ?? '---',
  direction: (trade.direction ?? trade.side ?? '').toString().toUpperCase(),
  entry_price: toNumber(trade.entry_price ?? trade.entry),
  current_price: toNumber(trade.current_price ?? trade.current ?? trade.exit_price ?? trade.entry_price ?? trade.entry),
  sl_price: toNumber(trade.sl_price ?? trade.current_sl ?? trade.sl ?? trade.initial_sl),
  initial_sl: toNumber(trade.initial_sl ?? trade.sl_price ?? trade.sl),
  tp_price: trade.tp_price == null && trade.tp == null ? null : toNumber(trade.tp_price ?? trade.tp),
  pnl: toNumber(trade.pnl ?? trade.live_pnl),
  rr: toNumber(trade.rr ?? trade.live_rr),
  max_rr: toNumber(trade.max_rr ?? trade.max_rr_achieved),
  live_rr_sequence: trade.live_rr_sequence || [],
  exit_rr_sequence: trade.exit_rr_sequence || [],
  tp_mode: trade.tp_mode || (trade.tp_price == null && trade.tp == null ? 'exp_rr_seq' : 'fixed'),
  tp_ratio: toNumber(trade.tp_ratio, 2),
  sl_type: trade.sl_type,
  sl_adjustments: trade.sl_adjustments || [],
  exit_reason: trade.exit_reason,
  exit_price: trade.exit_price == null ? undefined : toNumber(trade.exit_price),
  paper_mode: trade.paper_mode ?? true,
  qty: trade.qty ?? trade.quantity ?? 0,
})

const normalizeLog = (log = {}) => ({
  ...log,
  id: log.id || Math.random().toString(36).substring(2, 15),
  ts: log.ts || log.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  level: log.level || log.lv || 'info',
  msg: log.msg || log.message || '',
})

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

  setSessionActive: (active, id) => {
    set({ sessionActive: active, strategyId: id })
    if (active) {
      get().connectWS()
    } else {
      get().disconnectWS()
    }
  },

  fetchSessions: async () => {
    try {
      const res = await sessionAPI.list()
      console.log('tradingStore: fetchSessions response:', res.data);
      set({ sessionList: res.data })
    } catch (e) {
      console.error('tradingStore: fetchSessions error:', e);
    }
  },

  updateStats: (stats) => set((state) => ({ ...state, ...stats })),
  updateConfig: (newConfig) => set((state) => ({ config: { ...state.config, ...newConfig } })),

  ws: null,
  connectWS: () => {
    if (get().ws) return
    set({ wsStatus: 'connecting' })

    const wsUrl = import.meta.env.VITE_WS_URL || (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + (window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.hostname + (window.location.port ? ':' + window.location.port : '')) + '/session/ws'
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => set({ wsStatus: 'live' })

    // Throttled scanner update to prevent React choking on high-freq updates
    let lastScannerUpdate = 0;
    const SCANNER_THROTTLE_MS = 200;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'status') {
        set((state) => ({
          sessionActive: data.running,
          strategyId: data.strategyId || state.strategyId,
          balance: data.balance ?? state.balance,
          totalPnl: data.totalPnl ?? state.totalPnl,
          totalRiskPct: data.totalRiskPct ?? state.totalRiskPct,
          totalSlUsed: data.totalSlUsed ?? state.totalSlUsed,
          activeTrades: data.activeTrades?.map(normalizeTrade) || state.activeTrades,
          logs: data.logLines?.map(normalizeLog) || state.logs,
          scannerResults: data.scannerResults?.map(normalizeOpportunity) || state.scannerResults,
          activeWindows: data.activeWindows?.map(normalizeWindow) || state.activeWindows,
          tradeHistory: data.history?.map(normalizeTrade) || state.tradeHistory,
          gateState: data.gateState ?? state.gateState,
          scannerPaused: data.scannerPaused ?? state.scannerPaused,
          config: data.config ? { ...state.config, ...data.config } : state.config,
        }))
      } else if (data.type === 'session') {
        set((state) => {
          const stopped = data.status === 'stopped'
          return {
            sessionActive: data.running ?? data.status === 'started',
            balance: data.balance ?? state.balance,
            config: data.config ? { ...state.config, ...data.config } : state.config,
            activeTrades: data.activeTrades?.map(normalizeTrade) || state.activeTrades,
            scannerResults: data.scannerResults?.map(normalizeOpportunity) || state.scannerResults,
            activeWindows: data.activeWindows?.map(normalizeWindow) || state.activeWindows,
            tradeHistory: data.history?.map(normalizeTrade) || state.tradeHistory,
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
        set({
          balance: data.balance,
          totalPnl: data.total_pnl,
          totalRiskPct: data.total_risk_pct,
          totalSlUsed: data.total_sl_used,
          activeTrades: (data.trades || []).map(normalizeTrade),
          activeWindows: (data.activeWindows || []).map(normalizeWindow),
          gateState: data.gateState ?? null,
          scannerPaused: data.scannerPaused ?? false,
          rateLimit: data.rateLimit || get().rateLimit,
          monitoring: data.monitoring || get().monitoring,
        })
      } else if (data.type === 'log') {
        set((state) => ({ logs: [normalizeLog(data), ...state.logs].slice(0, 100) }))
      } else if (data.type === 'scanner') {
        const now = Date.now();
        if (now - lastScannerUpdate >= SCANNER_THROTTLE_MS) {
          set({
            scannerResults: (data.opportunities || []).map(normalizeOpportunity),
            activeWindows: (data.activeWindows || []).map(normalizeWindow),
          })
          lastScannerUpdate = now;
        }
      } else if (data.type === 'trade_event') {
        const trade = data.trade ? normalizeTrade(data.trade) : null
        set((state) => ({
          logs: [normalizeLog({ level: 'info', msg: `${data.symbol}: ${data.event} ${data.reason || ''}` }), ...state.logs].slice(0, 100),
          tradeHistory: data.event === 'closed' && trade ? [trade, ...state.tradeHistory].slice(0, 50) : state.tradeHistory,
        }))
      } else if (data.type === 'gate') {
        set((state) => ({
          gateState: data.gateState,
          scannerPaused: data.scannerPaused,
          logs: [normalizeLog({ level: 'warn', msg: data.reason || 'Risk gate active' }), ...state.logs].slice(0, 100),
        }))
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
