import React, { useState } from 'react'
import { pnlColor, fmtUSD, fmt, C } from '../lib/theme'
import { PulseDot, PaperBadge, ConditionWidget, cn } from './ui/primitives'
import { Info, TrendingUp, ShieldAlert, Target, Activity, Zap, XCircle, ShieldCheck, Clock } from 'lucide-react'
import { sessionAPI } from '../api/client'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '../store/trading'

const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'None'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

const timeSince = (entryTs) => {
  if (!entryTs) return 'Just now'
  const now = Date.now()
  const entry = new Date(entryTs).getTime()
  const diff = Math.floor((now - entry) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  const hours = Math.floor(diff / 3600)
  const mins = Math.floor((diff % 3600) / 60)
  return `${hours}h ${mins}m ago`
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

const Pill = ({ children, className }) => (
  <span className={cn(
    "inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] font-bold tracking-wider uppercase whitespace-nowrap",
    className
  )}>
    {children}
  </span>
)

const RRLadder = React.memo(({ trade }) => {
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
    <div className="bg-accent/5 border border-accent/20 rounded-2xl p-5 mt-5 shadow-[0_0_20px_rgba(91,111,255,0.03)]">
      <div className="flex justify-between items-center mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Zap size={14} className="text-accent" fill="currentColor" />
          </div>
          <span className="text-[11px] text-accent font-bold tracking-widest uppercase">Guard Ladder</span>
        </div>
        <div className="text-[9px] text-dim font-bold uppercase tracking-widest opacity-60 px-2 py-0.5 bg-surface border border-border rounded-md">Live Ratchet</div>
      </div>

      <div className="flex gap-2.5 overflow-x-auto no-scrollbar mb-6 pb-2">
        {triggers.map((trigger, i) => {
          const done = maxRR >= trigger
          const current = i === activeIdx
          return (
            <div key={`${trigger}-${i}`} className="min-w-[70px] flex-1">
              <div className={cn(
                "text-[10px] font-bold mb-2 text-center",
                current ? "text-accent" : done ? "text-green" : "text-dim"
              )}>{trigger}R</div>
              <div className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                done ? (current ? "bg-accent shadow-[0_0_8px_rgba(91,111,255,0.4)]" : "bg-green") : "bg-border"
              )} />
              <div className={cn(
                "text-[9px] font-bold mt-2 uppercase tracking-tighter text-center",
                done ? "text-text" : "text-dim"
              )}>
                SL {exits[i] === 0 ? 'BE' : `${exits[i]}R`}
              </div>
            </div>
          )
        })}
      </div>

      <div className="relative h-2 flex items-center mb-8 px-1">
        <div className="absolute inset-x-1 h-2 bg-border rounded-full" />
        <div className="absolute left-1 h-2 bg-green/20 rounded-full transition-all duration-700" style={{ width: `calc(${maxPct}% - 8px)` }} />
        <div className="absolute left-1 h-2 bg-accent/40 rounded-full transition-all duration-500" style={{ width: `calc(${livePct}% - 8px)` }} />
        <div
          className="absolute w-4 h-4 rounded-full bg-accent border-2 border-surface shadow-[0_0_15px_rgba(91,111,255,0.4)] z-10 transition-all duration-500"
          style={{ left: `calc(${livePct}% - 8px)`, transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 bg-surface/50 p-3 rounded-xl border border-border/50">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Live RR</span>
          <strong className={cn("text-[13px] font-mono", liveRR >= 0 ? "text-green" : "text-red")}>{fmt(liveRR, 2)}</strong>
        </div>
        <div className="flex flex-col gap-1 text-center">
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Peak RR</span>
          <strong className="text-[13px] font-mono text-accent">{fmt(maxRR, 2)}</strong>
        </div>
        <div className="flex flex-col gap-1 text-right">
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Active SL</span>
          <strong className={cn("text-[13px] font-mono", activeIdx >= 0 ? "text-green" : "text-dim")}>{price(currentSl)}</strong>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-accent/10 flex items-center gap-2">
        <Info size={12} className="text-dim shrink-0" />
        <div className="text-[10px] text-dim font-bold uppercase tracking-tight">
          {next < triggers.length
            ? <>Next ratchet at <span className="text-accent font-bold">{triggers[next]}R</span></>
            : <span className="text-green font-bold">Max level secured</span>}
        </div>
      </div>
    </div>
  )
})

const ExitMonitor = React.memo(({ status, logic }) => {
  if (!status || Object.keys(status).length === 0) return null;

  return (
    <div className="bg-red/5 border border-red/20 rounded-2xl p-5 mt-5 shadow-[0_0_20px_rgba(255,68,102,0.03)]">
      <div className="flex justify-between items-center mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-red/10 border border-red/20 flex items-center justify-center">
            <ShieldCheck size={14} className="text-red" fill="currentColor" />
          </div>
          <span className="text-[11px] text-red font-bold tracking-widest uppercase">Exit Protection</span>
        </div>
        <div className="text-[9px] text-dim font-bold uppercase tracking-widest opacity-60 px-2 py-0.5 bg-surface border border-border rounded-md">
          Logic: {logic === 'all' ? 'Require All' : 'Allow Any'}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(status).map(([key, s]) => {
          const label = key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
          return (
            <ConditionWidget
              key={key}
              label={label}
              value={s.active ? s.value : s.remaining_delay}
              threshold={s.active ? s.threshold : 0}
              unit={s.active ? s.unit : "s"}
              satisfied={s.fired && s.active}
              sublabel={s.active ? (s.fired ? "Signal Firing" : s.description || "Monitoring...") : `Activating in ${Math.round(s.remaining_delay)}s`}
            />
          );
        })}
      </div>
    </div>
  );
});

export const ActiveTradeBar = React.memo(({ trade, compact = false, initialExpanded = false }) => {
  const config = useTradingStore((state) => state.config)

  const [isClosing, setIsClosing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(initialExpanded)

  const handleClose = async () => {
    setIsClosing(true)
    try {
      await sessionAPI.closeTrade(trade.symbol)
    } catch (error) {
      console.error('Failed to close trade:', error)
      alert(`Error closing trade: ${error.message}`)
    } finally {
      setIsClosing(false)
    }
  }

  if (!trade) return (
    <div className="h-[460px] flex items-center justify-center rounded-2xl border border-border border-dashed bg-surface/20">
      <div className="text-[11px] font-bold text-dim uppercase tracking-widest flex flex-col items-center gap-4 animate-pulse">
        <Activity size={32} className="opacity-10" />
        No active position
      </div>
    </div>
  )

  const direction = trade.direction?.toUpperCase()
  const isLong = direction === 'LONG'
  const isExpRR = trade.tp_mode === 'exp_rr_seq'
  const strategyLabel = trade.strategyLabel || 'Default'
  const slDist = trade.entry_price ? ((Math.abs(trade.entry_price - trade.sl_price) / trade.entry_price) * 100).toFixed(2) : '0.00'
  const pctChange = trade.entry_price && trade.current_price
    ? ((trade.current_price - trade.entry_price) / trade.entry_price * 100).toFixed(2)
    : '0.00'
  const risk = Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price))
  const fixedTarget = trade.tp_price
  const runwayEnd = fixedTarget ?? (isLong ? trade.entry_price + risk * 4 : trade.entry_price - risk * 4)
  const range = Math.abs(runwayEnd - trade.sl_price)
  const progress = range > 0
    ? Math.max(0, Math.min(100, (Math.abs(trade.current_price - trade.sl_price) / range) * 100))
    : 50
  const entryTime = trade.entry_ts || trade.entry_time
  const isWinning = trade.pnl >= 0

  return (
    <div className={cn(
      "rounded-2xl border p-6 transition-all duration-500 shadow-sm",
      isWinning ? "bg-green/5 border-green/20 shadow-green/5" : "bg-red/5 border-red/20 shadow-red/5"
    )}>
      <div className="flex flex-col sm:flex-row justify-between gap-5 mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <PulseDot color={isWinning ? "bg-green" : "bg-red"} />
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono tracking-tight">{trade.symbol}</span>
              {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
                <ShieldCheck size={16} className="text-accent" />
              )}
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-accent/10 text-accent uppercase tracking-widest border border-accent/20">
                {strategyLabel}
              </span>
            </div>
            {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
              <span className="text-[9px] font-bold text-accent uppercase tracking-tighter -mt-0.5">Monitored Symbol</span>
            )}
          </div>
          <Pill className={isLong ? "text-green bg-green/10 border-green/20" : "text-red bg-red/10 border-red/20"}>
            {direction}
          </Pill>
          <Pill className={isExpRR ? "text-accent bg-accent/10 border-accent/20" : "text-green bg-green/10 border-green/20"}>
            {isExpRR ? 'EXP RR' : `FIXED ${trade.tp_ratio}R`}
          </Pill>
          {trade.paper_mode && <PaperBadge />}
        </div>
        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center shrink-0 min-w-[150px]">
          {trade.pnl !== undefined ? (
            <div className={cn("text-2xl sm:text-3xl font-bold font-mono tracking-tighter truncate w-full text-right", isWinning ? "text-green" : "text-red")}>
              {fmtUSD(trade.pnl)}
            </div>
          ) : (
            <div className="h-8 w-32 bg-border/20 rounded animate-pulse mb-1" />
          )}
          <div className="text-[11px] text-dim font-bold uppercase tracking-widest mt-1 truncate w-full text-right">
            Performance: <span className={isWinning ? "text-green" : "text-red"}>{fmt(trade.rr || 0, 2)}R</span>
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6 p-3 bg-surface/30 rounded-xl border border-border/30">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Entry</span>
          <span className="text-sm font-bold font-mono">{price(trade.entry_price)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Current</span>
          <span className="text-sm font-bold font-mono">{price(trade.current_price)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest">% Change</span>
          <span className={cn("text-sm font-bold font-mono", Number(pctChange) >= 0 ? "text-green" : "text-red")}>
            {Number(pctChange) >= 0 ? '+' : ''}{pctChange}%
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest">SL Dist</span>
          <span className="text-sm font-bold font-mono text-amber">{slDist}%</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Duration</span>
          <span className="text-sm font-bold font-mono text-accent">{duration(entryTime)}</span>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-4 gap-6 mb-8 p-5 bg-surface/50 rounded-2xl border border-border/50">
              {[
                ['ENTRY', price(trade.entry_price), <Activity size={14} className="text-dim" />],
                ['CURRENT', price(trade.current_price), <TrendingUp size={14} className="text-accent" />],
                ['QTY', trade.qty != null ? `${trade.qty}` : '---', <Target size={14} className="text-dim" />],
                ['OPENED', entryTime ? new Date(entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---', <Clock size={14} className="text-accent" />],
              ].map(([k, v, icon]) => (
                <div key={k} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-[10px] text-dim font-bold tracking-widest uppercase">{k}</span>
                  </div>
                  <div className="text-[14px] text-text font-bold font-mono tracking-tight">{v}</div>
                </div>
              ))}
            </div>

            <div className="space-y-4 px-1 relative mb-8">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-1">
                <span className="text-red flex items-center gap-2">
                  <ShieldAlert size={14} />
                  STOP LOSS: {price(trade.sl_price)}
                </span>
                <span className={cn("flex items-center gap-2", fixedTarget == null ? "text-accent" : "text-green")}>
                  <Target size={14} />
                  {fixedTarget == null ? 'RUNWAY ACTIVE' : `TARGET: ${price(fixedTarget)}`}
                </span>
              </div>

              <div className="h-3 bg-border rounded-full relative overflow-hidden shadow-inner">
                <div className="absolute inset-0 bg-gradient-to-r from-red/10 via-background/0 to-green/10" />
                <div
                  className={cn("absolute h-full transition-all duration-1000 ease-out", isWinning ? "bg-green/40 shadow-[0_0_15px_rgba(0,229,160,0.4)]" : "bg-red/40")}
                  style={{ width: `${progress ?? 0}%` }}
                />
              </div>

              <div className="relative h-4 -mt-7 mb-4">
                <div
                  className={cn(
                    "absolute w-5 h-5 rounded-full border-2 border-surface shadow-xl z-20 transition-all duration-500 ease-out",
                    isWinning ? "bg-green" : "bg-red"
                  )}
                  style={{ left: `${progress ?? 0}%`, transform: 'translateX(-50%)' }}
                />
              </div>

              <div className="flex justify-between text-[9px] text-dim font-bold uppercase tracking-tighter opacity-50 px-0.5">
                <span>{slDist}% RISK</span>
                <span>POTENTIAL TARGET</span>
              </div>
              <div className="flex justify-between text-[9px] text-dim font-bold uppercase tracking-tighter mt-0.5 px-0.5">
                <span>Opened: {entryTime ? new Date(entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---'}</span>
                <span>Duration: <span className="font-bold text-accent">{duration(entryTime)}</span></span>
              </div>
              <div className="flex justify-between text-[9px] text-dim font-bold uppercase tracking-tighter mt-0.5 px-0.5">
                <span>Time Ago: <span className="font-bold text-text">{timeSince(entryTime)}</span></span>
                <span>SL Distance: <span className="font-bold text-amber">{slDist}%</span></span>
              </div>
              <div className="flex justify-between text-[9px] text-dim font-bold uppercase tracking-tighter mt-1 px-0.5">
                <span>Entry → Current: <span className={cn("font-bold", Number(pctChange) >= 0 ? "text-green" : "text-red")}>{Number(pctChange) >= 0 ? '+' : ''}{pctChange}%</span></span>
                <span>SL Distance: <span className="font-bold text-amber">{slDist}%</span></span>
              </div>
            </div>

            {isExpRR && <RRLadder trade={trade} />}

            <ExitMonitor status={trade.exit_signals_status} logic={trade.exit_signal_logic} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 px-4 py-3 bg-surface border border-border hover:border-accent/40 text-text rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2"
        >
          {isExpanded ? 'Hide Details' : 'View Details'}
        </button>
        <button
          onClick={handleClose}
          disabled={isClosing}
          className="flex-1 px-4 py-3 bg-red hover:bg-red/80 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <XCircle size={16} />
          {isClosing ? 'Closing...' : 'Close Position'}
        </button>
      </div>
    </div>
  )
})
