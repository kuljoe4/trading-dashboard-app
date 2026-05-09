import { create } from 'zustand'

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
  config: {
    paper_mode: true,
    max_total_risk_pct: 5,
    total_sl_guard_usdt: 200,
    scan_interval: '5m',
    scan_pct_threshold: 2.0,
    scan_lookback: 3,
  },
  
  setSessionActive: (active, id) => {
    set({ sessionActive: active, strategyId: id })
    if (active) {
      get().connectWS()
    } else {
      get().disconnectWS()
    }
  },

  updateStats: (stats) => set((state) => ({ ...state, ...stats })),
  updateConfig: (newConfig) => set((state) => ({ config: { ...state.config, ...newConfig } })),

  ws: null,
  connectWS: () => {
    if (get().ws) return
    
    const ws = new WebSocket(import.meta.env.VITE_WS_URL || 'ws://localhost:3000/session/ws')
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      if (data.type === 'status') {
        set({
          sessionActive: data.running,
          strategyId: data.strategyId || null,
          balance: data.balance ?? get().balance,
          totalPnl: data.totalPnl ?? get().totalPnl,
          activeTrades: data.activeTrades || get().activeTrades,
          logs: data.logLines || get().logs,
        })
      } else if (data.type === 'tick') {
        set({
          balance: data.balance,
          totalPnl: data.total_pnl,
          totalRiskPct: data.total_risk_pct,
          totalSlUsed: data.total_sl_used,
          activeTrades: data.trades
        })
      } else if (data.type === 'log') {
        set((state) => ({ logs: [data, ...state.logs].slice(0, 100) }))
      } else if (data.type === 'scanner') {
        set({ scannerResults: data.opportunities })
      } else if (data.type === 'trade_event') {
        // Handle trade events if needed
      }
    }

    ws.onclose = () => {
      set({ ws: null })
      if (get().sessionActive) {
        setTimeout(() => get().connectWS(), 2000)
      }
    }

    set({ ws })
  },

  disconnectWS: () => {
    if (get().ws) {
      get().ws.close()
      set({ ws: null })
    }
  }
}))
