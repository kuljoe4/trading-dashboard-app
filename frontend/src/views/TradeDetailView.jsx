import React, { useState, useEffect, useMemo } from 'react'
import { useTradingStore } from '../store/trading'
import {
  StatusBadge, PaperBadge, cn, CopyButton, ViewHeader
} from '../components/ui/primitives'
import { ChevronLeft, ArrowLeft, Activity, Clock } from 'lucide-react'
import { sessionAPI } from '../api/client'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { TradeDetailContent } from '../components/trade/TradeDetailContent'
import { formatDuration } from '../lib/formatters'
import { ConfirmationModal } from '../components/ConfirmationModal'

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
      updateStats({ alerts: [{ id: Date.now(), level: 'error', title: 'Close Failed', message: 'Could not send liquidation order to the exchange.' }] });
    } finally {
      setIsClosing(false)
    }
  }

  const isSyncing = wsStatus !== 'live' || !trade._is_full;

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ViewHeader
        title={trade.symbol}
        subTitle={`${trade.strategy_label} · ${duration}`}
        backAction={() => window.history.back()}
      >
        <div className="flex items-center gap-3">
          <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", trade.direction === 'LONG' ? 'bg-green/10 text-green border border-green/20' : 'bg-red/10 text-red border border-red/20')}>
            {trade.direction}
          </span>
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-dim font-bold font-mono">
            ID: {trade.id?.substring(0, 8)}
            <CopyButton value={trade.id} className="p-1" />
          </div>
        </div>
      </ViewHeader>

      <TradeDetailContent 
        trade={trade}
        isSyncing={isSyncing}
        onTradeClose={handleClose}
        isClosing={isClosing}
        confirmClose={confirmClose}
        setConfirmClose={setConfirmClose}
        layout="grid"
      />

      <ConfirmationModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => handleClose(trade.symbol)}
        title={`Liquidate ${trade.symbol}?`}
        message="This will immediately close the position at market price. This action is irreversible."
        confirmText="Confirm Liquidation"
        loading={isClosing}
      />
    </div>
  )
}

export default TradeDetailView
