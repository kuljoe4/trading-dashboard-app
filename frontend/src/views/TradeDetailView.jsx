import React, { useState, useEffect, useMemo } from 'react'
import { useTradingStore } from '../store/trading'
import {
  StatusBadge, PaperBadge, cn, CopyButton
} from '../components/ui/primitives'
import { ChevronLeft, ArrowLeft, Activity, Clock } from 'lucide-react'
import { sessionAPI } from '../api/client'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { TradeDetailContent } from '../components/trade/TradeDetailContent'
import { formatDuration } from '../lib/formatters'

const Breadcrumbs = ({ strategyLabel, symbol }) => (
  <nav className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dim mb-6">
    <button onClick={() => window.location.hash = '#/'} className="hover:text-text transition-colors">Cockpit</button>
    <span>/</span>
    <button onClick={() => window.location.hash = `#/strategy/${encodeURIComponent(strategyLabel)}`} className="hover:text-text transition-colors">{strategyLabel}</button>
    <span>/</span>
    <span className="text-text">{symbol}</span>
  </nav>
)

const TradeDetailView = ({ tradeId }) => {
  const { activeTrades, wsStatus, updateStats } = useTradingStore()
  const trade = activeTrades.find(t => t.id === tradeId || t.symbol === tradeId)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const duration = useMemo(() => {
    if (!trade?.entry_ts) return '---'
    const start = new Date(trade.entry_ts).getTime()
    return formatDuration(now - start)
  }, [trade?.entry_ts, now])

  // Lifecycle-scoped subscription contract
  useResourceFocus('trade', tradeId);

  useEffect(() => {
    if (tradeId) {
      // REST Hydration: Fetch immediate state to avoid waiting for tick
      sessionAPI.getTrade(tradeId).then(res => {
         if (res.data) {
           const currentState = useTradingStore.getState();
           // Map current active trades, replacing the hydrated one if it matches
           const nextTrades = currentState.activeTrades.map(t =>
             (t.id === res.data.id || t.symbol === res.data.symbol) ? { ...t, ...res.data, _is_full: true } : t
           );
           // If it wasn't in activeTrades yet, add it
           if (!nextTrades.some(t => t.id === res.data.id || t.symbol === res.data.symbol)) {
             nextTrades.push({ ...res.data, _is_full: true });
           }
           updateStats({ activeTrades: nextTrades });
         }
      }).catch(() => {});
    }
  }, [tradeId, updateStats]);

  const [isClosing, setIsClosing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  if (!trade) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center mb-6 text-dim/20 animate-pulse">
           <Activity size={32} />
        </div>
        <h2 className="text-xl font-bold mb-2">Trade Not Found</h2>
        <p className="text-dim text-sm max-w-xs mb-8">This position may have been closed or is being synchronized from the backend.</p>
        <button
          onClick={() => window.location.hash = '#/trades'}
          className="flex items-center gap-2 text-accent font-bold uppercase text-[11px] tracking-widest hover:underline"
        >
          <ArrowLeft size={14} /> Back to Active Trades
        </button>
      </div>
    )
  }

  const handleClose = async (symbol) => {
    setIsClosing(true)
    try {
      await sessionAPI.closeTrade(symbol)
      window.location.hash = '#/trades'
    } catch (e) {
      alert('Failed to close trade')
    } finally {
      setIsClosing(false)
    }
  }

  const isSyncing = wsStatus !== 'live' || !trade._is_full;

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Breadcrumbs strategyLabel={trade.strategy_label} symbol={trade.symbol} />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-10">
        <div className="flex items-center gap-5">
           <button
             onClick={() => window.history.back()}
             aria-label="Go back"
             className="p-3 bg-surface border border-border rounded-2xl hover:border-accent/40 text-dim hover:text-text transition-all active:scale-90"
           >
             <ChevronLeft size={20} />
           </button>
           <div>
             <div className="flex items-center gap-3 mb-1">
               <h1 className="text-3xl font-black tracking-tight">{trade.symbol}</h1>
               <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", trade.direction === 'LONG' ? 'bg-green/10 text-green border border-green/20' : 'bg-red/10 text-red border border-red/20')}>
                 {trade.direction}
               </span>
               <StatusBadge status="live" />
               <PaperBadge />
             </div>
             <div className="flex items-center gap-3 text-[11px] text-dim font-bold uppercase tracking-widest">
                <span>{trade.strategy_label}</span>
                <span className="text-dim/30">•</span>
                <span className="flex items-center gap-1.5">
                  <Clock size={12} className="text-accent" /> {duration}
                </span>
                <span className="text-dim/30">•</span>
                <span className="flex items-center gap-1.5">
                  ID: {trade.id?.substring(0, 8)}
                  <CopyButton value={trade.id} className="p-1" />
                </span>
             </div>
           </div>
        </div>
      </div>

      <TradeDetailContent 
        trade={trade}
        isSyncing={isSyncing}
        onTradeClose={handleClose}
        isClosing={isClosing}
        confirmClose={confirmClose}
        setConfirmClose={setConfirmClose}
        layout="grid"
      />
    </div>
  )
}

export default TradeDetailView
