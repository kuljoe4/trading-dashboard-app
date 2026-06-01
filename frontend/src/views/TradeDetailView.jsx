import React from 'react'
import { useTradingStore } from '../store/trading'
import { pnlColor, fmtUSD, fmt } from '../lib/theme'
import {
  StatCard, SectionLabel, StatusBadge, PaperBadge,
  cn, Tooltip, CopyButton, PulseDot
} from '../components/ui/primitives'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Activity, Target, ShieldAlert, Zap, Clock, Info, ShieldCheck,
  CheckCircle2, AlertCircle, XCircle, TrendingUp, BarChart3, ArrowLeft, ExternalLink
} from 'lucide-react'
import { sessionAPI } from '../api/client'

const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'None'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

const duration = (entryTs) => {
  if (!entryTs) return '0s'
  const now = Date.now()
  const entry = new Date(entryTs).getTime()
  const diff = Math.floor((now - entry) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const Breadcrumbs = ({ strategyLabel, symbol, onBack }) => (
  <nav className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dim mb-6">
    <button onClick={() => window.location.hash = '#/'} className="hover:text-accent transition-colors">Cockpit</button>
    <span>/</span>
    <button onClick={() => window.location.hash = `#/strategy/${strategyLabel}`} className="hover:text-accent transition-colors">{strategyLabel}</button>
    <span>/</span>
    <span className="text-text">{symbol}</span>
  </nav>
)

const RRLadder = ({ trade }) => {
  const triggers = trade.live_rr_sequence || []
  const exits = trade.exit_rr_sequence || []
  const maxRR = trade.max_rr || 0
  const liveRR = trade.rr || 0
  const risk = Math.abs(trade.entry_price - trade.initial_sl)
  const activeIdx = triggers.reduce((idx, trigger, i) => maxRR >= trigger ? i : idx, -1)
  const currentExitRR = activeIdx >= 0 ? exits[activeIdx] : null
  const currentSl = currentExitRR == null
    ? trade.initial_sl
    : trade.direction === 'LONG'
      ? trade.entry_price + risk * currentExitRR
      : trade.entry_price - risk * currentExitRR
  const maxTarget = triggers[triggers.length - 1] || 1
  const livePct = Math.max(0, Math.min((liveRR / maxTarget) * 100, 100))
  const maxPct = Math.max(0, Math.min((maxRR / maxTarget) * 100, 100))
  const next = activeIdx + 1

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <SectionLabel className="mb-0">
           <Zap size={14} className="text-accent" fill="currentColor" /> Guard Ladder
        </SectionLabel>
        <div className="text-[10px] text-accent font-mono bg-accent/10 px-2 py-0.5 rounded border border-accent/20">Live Ratchet</div>
      </div>

      <div className="flex gap-4 overflow-x-auto no-scrollbar mb-8 pb-2">
        {triggers.map((trigger, i) => {
          const done = maxRR >= trigger
          const current = i === activeIdx
          return (
            <div key={`${trigger}-${i}`} className="min-w-[80px] flex-1">
              <div className={cn(
                "text-xs font-bold mb-3 text-center",
                current ? "text-accent" : done ? "text-green" : "text-dim"
              )}>{trigger}R</div>
              <div className={cn(
                "h-2 rounded-full transition-all duration-500",
                done ? (current ? "bg-accent shadow-[0_0_10px_rgba(91,111,255,0.4)]" : "bg-green") : "bg-border"
              )} />
              <div className={cn(
                "text-[10px] font-bold mt-3 uppercase tracking-widest text-center",
                done ? "text-text" : "text-dim"
              )}>
                SL {exits[i] === 0 ? 'BE' : `${exits[i]}R`}
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[10px] text-dim font-bold uppercase tracking-widest mb-1">Live RR</div>
          <div className={cn("text-xl font-mono font-bold", liveRR >= 0 ? "text-green" : "text-red")}>{fmt(liveRR, 2)}</div>
        </div>
        <div className="p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[10px] text-dim font-bold uppercase tracking-widest mb-1">Peak RR</div>
          <div className="text-xl font-mono font-bold text-accent">{fmt(maxRR, 2)}</div>
        </div>
        <div className="p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[10px] text-dim font-bold uppercase tracking-widest mb-1">Secured SL</div>
          <div className="text-xl font-mono font-bold text-text">{price(currentSl)}</div>
        </div>
      </div>
    </div>
  )
}

const ExitMonitor = ({ status, logic }) => {
  if (!status || Object.keys(status).length === 0) return null;
  const entries = Object.entries(status)

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm h-full">
      <SectionLabel className="mb-6">
        <ShieldCheck size={14} className="text-red" /> Technical Exit Signals
      </SectionLabel>

      <div className="space-y-4">
        {entries.map(([key, s]) => {
          const value = Number.isFinite(Number(s.value)) ? Number(s.value) : 0
          const threshold = Math.max(Math.abs(Number(s.threshold) || 1), 0.0001)
          const progress = s.active ? (s.insufficientData ? 0 : Math.min((Math.abs(value) / threshold) * 100, 100)) : 0

          return (
            <div key={key} className={cn(
              "p-4 rounded-xl border transition-all",
              s.fired && s.active ? "bg-red/5 border-red/30" : "bg-background/20 border-border"
            )}>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                   <div className={cn(
                     "w-8 h-8 rounded-lg flex items-center justify-center border",
                     s.fired && s.active ? "bg-red/10 border-red/20 text-red" : "bg-surface border-border text-dim"
                   )}>
                     {s.fired && s.active ? <CheckCircle2 size={16} /> : <Activity size={16} />}
                   </div>
                   <div>
                     <div className="text-sm font-bold">{s.label || key}</div>
                     <div className="text-[10px] text-dim font-bold uppercase tracking-tight">{s.description || 'Condition monitoring'}</div>
                   </div>
                </div>
                <div className="text-right">
                   <div className={cn("text-sm font-mono font-bold", s.fired && s.active ? "text-red" : "text-text")}>
                     {s.insufficientData ? 'n/a' : Number(value).toFixed(4)}{s.unit || ''}
                   </div>
                   <div className="text-[10px] text-dim font-bold uppercase tracking-widest">Limit: {s.threshold}</div>
                </div>
              </div>
              <div className="h-1.5 bg-background rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-500", s.fired && s.active ? "bg-red" : "bg-accent")}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6 p-4 bg-accent/5 border border-accent/10 rounded-xl text-[10px] text-dim font-bold uppercase tracking-widest text-center">
        Logic: {logic === 'all' ? 'All must fire' : 'Any signal triggers exit'}
      </div>
    </div>
  )
}

const TradeDetailView = ({ tradeId }) => {
  const { activeTrades, wsStatus, setFocusMode, updateStats } = useTradingStore()
  const trade = activeTrades.find(t => t.id === tradeId || t.symbol === tradeId)

  React.useEffect(() => {
    if (tradeId) {
      setFocusMode(true, tradeId, null);

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
    return () => setFocusMode(false, null, null);
  }, [tradeId, setFocusMode, updateStats]);

  const [isClosing, setIsClosing] = React.useState(false)
  const [confirmClose, setConfirmClose] = React.useState(false)

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

  const handleClose = async () => {
    setIsClosing(true)
    try {
      await sessionAPI.closeTrade(trade.symbol)
      window.location.hash = '#/trades'
    } catch (e) {
      alert('Failed to close trade')
    } finally {
      setIsClosing(false)
    }
  }

  const isSyncing = wsStatus !== 'live' || !trade._is_full;
  const isLong = trade.direction?.toUpperCase() === 'LONG'

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
               <StatusBadge status="live" />
               <PaperBadge />
             </div>
             <div className="flex items-center gap-2 text-[11px] text-dim font-bold uppercase tracking-widest">
                {trade.strategy_label} · ID: {trade.id?.substring(0, 8)}
                <CopyButton value={trade.id} className="p-1" />
             </div>
           </div>
        </div>

        <div className="flex items-center gap-4">
           <div className="text-right">
              <div className={cn("text-3xl font-mono font-bold tracking-tighter", trade.pnl >= 0 ? "text-green" : "text-red")}>
                {fmtUSD(trade.pnl)}
              </div>
              <div className="text-[11px] text-dim font-bold uppercase tracking-widest mt-1">
                Performance: <span className={trade.pnl >= 0 ? "text-green" : "text-red"}>{fmt(trade.rr || 0, 2)}R</span>
              </div>
           </div>

           <button
             onClick={() => confirmClose ? handleClose() : setConfirmClose(true)}
             disabled={isClosing}
             aria-label={isClosing ? "Closing position" : confirmClose ? "Confirm close position" : "Close position"}
             className={cn(
               "h-14 px-6 rounded-2xl font-bold uppercase text-[11px] tracking-[0.2em] transition-all flex items-center gap-3 relative overflow-hidden",
               confirmClose ? "bg-red text-white animate-pulse" : "bg-red/10 text-red border border-red/20 hover:bg-red/20"
             )}
           >
             <motion.div
               initial={false}
               animate={{
                 y: (confirmClose && !isClosing) ? -20 : 0,
                 opacity: (confirmClose && !isClosing) ? 0 : 1
               }}
               className="flex items-center"
             >
               {isClosing ? <Loader2 className="animate-spin" size={16} /> : <XCircle size={16} />}
             </motion.div>
             <span aria-live="polite">
               {isClosing ? 'Closing...' : confirmClose ? 'Confirm Close?' : 'Close Position'}
             </span>
           </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
         <StatCard label="Entry Price" value={price(trade.entry_price)} />
         <StatCard label="Current Price" value={price(trade.current_price)} color={trade.pnl >= 0 ? "text-green" : "text-red"} syncing={isSyncing} />
         <StatCard label="Active SL" value={price(trade.sl_price)} color="text-amber" />
         <StatCard label="Duration" value={duration(trade.entry_ts || trade.entry_time)} color="text-accent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         <div className="lg:col-span-2 space-y-8">
            <RRLadder trade={trade} />

            <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
              <SectionLabel className="mb-6">
                <BarChart3 size={14} className="text-accent" /> Price Action Context
              </SectionLabel>
              <div className="h-[300px] flex items-center justify-center text-dim/20">
                 {/* This is where a more detailed chart or depth view could go */}
                 <div className="flex flex-col items-center gap-4">
                    <TrendingUp size={48} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Real-time Depth Visualization</span>
                 </div>
              </div>
            </div>
         </div>

         <div className="space-y-8">
            <ExitMonitor status={trade.exit_signals_status} logic={trade.exit_signal_logic} />

            <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
              <SectionLabel className="mb-6">
                 <Info size={14} className="text-accent" /> Technical Meta
              </SectionLabel>
              <div className="space-y-4">
                 {[
                   { label: 'Direction', value: trade.direction, color: isLong ? 'text-green' : 'text-red' },
                   { label: 'Quantity', value: trade.qty },
                   { label: 'TP Mode', value: trade.tp_mode === 'exp_rr_seq' ? 'Expansion RR' : 'Fixed Ratio' },
                   { label: 'Risk Model', value: 'Fixed Fractional' },
                 ].map(item => (
                   <div key={item.label} className="flex justify-between items-center py-3 border-b border-border/40 last:border-0">
                      <span className="text-[10px] text-dim font-bold uppercase tracking-widest">{item.label}</span>
                      <span className={cn("text-xs font-bold font-mono", item.color)}>{item.value}</span>
                   </div>
                 ))}
              </div>
            </div>
         </div>
      </div>
    </div>
  )
}

export default TradeDetailView
