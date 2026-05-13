import React from 'react'
import { pnlColor, fmtUSD, fmt, C } from '../lib/theme'
import { PulseDot, PaperBadge, cn } from './ui/primitives'
import { Info, TrendingUp, ShieldAlert, Target, Activity, Zap } from 'lucide-react'

const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'None'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
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

export const ActiveTradeBar = React.memo(({ trade, compact = false }) => {
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
  const slDist = trade.entry_price ? ((Math.abs(trade.entry_price - trade.sl_price) / trade.entry_price) * 100).toFixed(2) : '0.00'
  const risk = Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price))
  const fixedTarget = trade.tp_price
  const runwayEnd = fixedTarget ?? (isLong ? trade.entry_price + risk * 4 : trade.entry_price - risk * 4)
  const range = Math.abs(runwayEnd - trade.sl_price)
  const progress = range > 0
    ? Math.max(0, Math.min(100, (Math.abs(trade.current_price - trade.sl_price) / range) * 100))
    : 50

  const isWinning = trade.pnl >= 0

  return (
    <div className={cn(
      "rounded-2xl border p-6 transition-all duration-500 shadow-sm",
      isWinning ? "bg-green/5 border-green/20 shadow-green/5" : "bg-red/5 border-red/20 shadow-red/5"
    )}>
      <div className="flex flex-col sm:flex-row justify-between gap-5 mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <PulseDot color={isWinning ? "bg-green" : "bg-red"} />
          <span className="text-xl font-bold font-mono tracking-tight">{trade.symbol}</span>
          <Pill className={isLong ? "text-green bg-green/10 border-green/20" : "text-red bg-red/10 border-red/20"}>
            {direction}
          </Pill>
          <Pill className={isExpRR ? "text-accent bg-accent/10 border-accent/20" : "text-green bg-green/10 border-green/20"}>
            {isExpRR ? 'EXP RR' : `FIXED ${trade.tp_ratio}R`}
          </Pill>
          {trade.paper_mode && <PaperBadge />}
        </div>
        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center shrink-0">
          <div className={cn("text-3xl font-bold font-mono tracking-tighter", isWinning ? "text-green" : "text-red")}>
            {trade.pnl > 0 ? '+' : ''}{fmtUSD(trade.pnl)}
          </div>
          <div className="text-[11px] text-dim font-bold uppercase tracking-widest mt-1">
            Performance: <span className={isWinning ? "text-green" : "text-red"}>{fmt(trade.rr || 0, 2)}R</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8 p-5 bg-surface/50 rounded-2xl border border-border/50">
        {[
          ['ENTRY', price(trade.entry_price), <Activity size={14} className="text-dim" />],
          ['CURRENT', price(trade.current_price), <TrendingUp size={14} className="text-accent" />],
          ['QTY', `${trade.qty}`, <Target size={14} className="text-dim" />],
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

      <div className="space-y-4 px-1 relative">
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
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="relative h-4 -mt-7 mb-4">
           <div
            className={cn(
              "absolute w-5 h-5 rounded-full border-2 border-surface shadow-xl z-20 transition-all duration-500 ease-out",
              isWinning ? "bg-green" : "bg-red"
            )}
            style={{ left: `${progress}%`, transform: 'translateX(-50%)' }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-dim font-bold uppercase tracking-tighter opacity-50 px-0.5">
           <span>{slDist}% RISK</span>
           <span>POTENTIAL TARGET</span>
        </div>
      </div>

      {isExpRR && <RRLadder trade={trade} />}
    </div>
  )
})
