import React, { useState, useEffect, useMemo, memo } from 'react'
import { 
  ShieldCheck, Clock, ArrowUpRight, ArrowDownRight, Activity, Zap, 
  Info, ShieldAlert, CheckCircle2, BarChart3, TrendingUp, XCircle, Loader2, Trash2, ArrowRight
} from 'lucide-react'
import { fmtUSD, pnlColor, pnlClass, fmt } from '../../lib/theme'
import { price, formatDuration, calculateProximity } from '../../lib/formatters'
import { StatCard, SectionLabel, cn, CopyButton, Tooltip, PulseDot, Btn } from '../ui/primitives'
import { SignalGauge } from '../ui/SignalGauge'
import { motion, AnimatePresence } from 'framer-motion'
import { ConfirmationModal } from '../ConfirmationModal'

const Metric = memo(({ label, value }) => (
  <div className="flex flex-col gap-1.5 group/metric">
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-black text-dim uppercase tracking-[0.2em]">{label}</span>
    </div>
    <span className="font-mono text-sm font-bold text-text/90">{value}</span>
  </div>
))
Metric.displayName = 'Metric'

const RRLadder = memo(({ trade }) => {
  const triggers = trade.live_rr_sequence || []
  const exits = trade.exit_rr_sequence || []
  const maxRR = trade.max_rr || 0
  const liveRR = trade.rr || 0
  const risk = Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price))
  const activeIdx = triggers.reduce((idx, trigger, i) => maxRR >= trigger ? i : idx, -1)

  // Use authoritative current_sl if available, otherwise fall back to ladder recompute
  const currentSl = trade.sl_price || (activeIdx >= 0 ?
    (trade.direction === 'LONG' ? trade.entry_price + risk * exits[activeIdx] : trade.entry_price - risk * exits[activeIdx]) :
    (trade.initial_sl || trade.sl_price))

  const getEstPnl = (price) => {
    if (!price || !trade.entry_price || !trade.qty) return 0
    return (price - trade.entry_price) * trade.qty * (trade.direction === 'LONG' ? 1 : -1)
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-3 md:p-5 shadow-sm">
      <div className="flex justify-between items-center mb-3 md:mb-5">
        <div className="flex items-center gap-2">
          <SectionLabel className="mb-0">
             <Zap size={14} className="text-accent" fill="currentColor" /> Guard Ladder
          </SectionLabel>
        </div>
        <div className="flex items-center gap-2">
          {trade.strategy_config?.trailing_stop_enabled && (
            <div className="text-[10px] text-purple-400 font-mono bg-purple-400/10 px-2 py-0.5 rounded border border-purple-400/20 flex items-center gap-1">
              <Activity size={10} /> Trailing
            </div>
          )}
          <div className="text-[10px] text-accent font-mono bg-accent/10 px-2 py-0.5 rounded border border-accent/20">Live Ratchet</div>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto no-scrollbar mb-3 md:mb-8 pb-2">
        {(triggers || []).map((trigger, i) => {
          const done = maxRR >= trigger
          const current = i === activeIdx
          return (
            <div key={`${trigger}-${i}`} className="min-w-[60px] md:min-w-[80px] flex-1">
              <div className={cn(
                "text-[10px] md:text-xs font-bold mb-1.5 md:mb-3 text-center",
                current ? "text-accent" : done ? "text-green" : "text-dim"
              )}>{trigger}R</div>
              <div className={cn(
                "h-1.5 md:h-2 rounded-full transition-all duration-500",
                done ? (current ? "bg-accent shadow-[0_0_10px_rgba(91,111,255,0.4)]" : "bg-green") : "bg-border"
              )} />
              <div className={cn(
                "text-[9px] md:text-[10px] font-bold mt-1.5 md:mt-3 uppercase tracking-widest text-center flex flex-col",
                done ? "text-text" : "text-dim"
              )}>
                <span>SL {exits[i] === 0 ? 'BE' : `${exits[i]}R`}</span>
                <span className={cn("text-[8px] font-mono", done ? pnlClass(getEstPnl(trade.direction === 'LONG' ? trade.entry_price + risk * exits[i] : trade.entry_price - risk * exits[i])) : "opacity-40")}>
                  {fmtUSD(getEstPnl(trade.direction === 'LONG' ? trade.entry_price + risk * exits[i] : trade.entry_price - risk * exits[i]))}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-6">
        <div className="p-2 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[8px] md:text-[10px] text-dim font-bold uppercase tracking-widest mb-0.5 md:mb-1">Live RR</div>
          <div className={cn("text-sm md:text-xl font-mono font-bold", liveRR >= 0 ? "text-green" : "text-red")}>{fmt(liveRR, 2)}</div>
        </div>
        <div className="p-2 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[8px] md:text-[10px] text-dim font-bold uppercase tracking-widest mb-0.5 md:mb-1">Peak RR</div>
          <div className="text-sm md:text-xl font-mono font-bold text-accent">{fmt(maxRR, 2)}</div>
        </div>
        <div className="p-2 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[8px] md:text-[10px] text-dim font-bold uppercase tracking-widest mb-0.5 md:mb-1">Secured SL</div>
          <div className="text-sm md:text-xl font-mono font-bold text-text flex flex-col leading-tight">
            <span>{price(currentSl)}</span>
            <span className={cn("text-[7px] md:text-[10px]", pnlClass(getEstPnl(currentSl)))}>
              {fmtUSD(getEstPnl(currentSl))}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
})

const ExitMonitor = memo(({ status, logic, trade }) => {
  if (!status || Object.keys(status).length === 0) return null;
  const mark = Number(trade.current_price || trade.mark_price || 0)
  const isLong = trade.direction === 'LONG'
  const entryPrice = Number(trade.entry_price || 0)
  const qty = Number(trade.qty || 0)
  const riskUsdt = Number(trade.risk_usdt ?? trade.initial_risk_usdt ?? 0)

  // Sort entries by proximity (triggerProgress descending)
  const entries = useMemo(() => {
    return Object.entries(status || {}).map(([key, s]) => {
      const progress = calculateProximity(s, mark, entryPrice);
      return [key, { ...s, progress }];
    }).sort((a, b) => b[1].progress - a[1].progress);
  }, [status, mark, isLong, entryPrice]);

  const satisfiedCount = entries.filter(([_, s]) => s.fired && s.active).length
  const totalCount = entries.length
  const allFired = satisfiedCount === totalCount
  const criteriaMet = logic === 'all' ? allFired : satisfiedCount > 0;

  return (
    <div className="bg-surface border border-border rounded-2xl p-3 md:p-5 shadow-sm flex flex-col">
      <div className="flex items-center justify-between mb-2 md:mb-5">
        <div className="flex flex-col gap-0.5">
          <SectionLabel className={cn("mb-0 flex items-center gap-1.5", criteriaMet ? "text-red" : satisfiedCount > 0 ? "text-amber" : "text-dim")}>
            {criteriaMet ? <Zap size={11} className="fill-red" /> : satisfiedCount > 0 ? <Activity size={11} /> : <ShieldCheck size={11} />}
            <span className="md:inline hidden">{criteriaMet ? 'Ready to Exit' : satisfiedCount > 0 ? 'Risk Building' : 'Watching'}</span>
            <span className="md:hidden inline">{criteriaMet ? 'EXIT' : satisfiedCount > 0 ? 'RISK' : 'WAIT'}</span>
          </SectionLabel>
          <div className="text-[7px] md:text-[8px] text-dim font-bold uppercase tracking-widest opacity-60">
            {logic === 'all' ? 'Match All' : 'Match Any'}
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
           <div className="flex -space-x-1">
              {entries.map(([key, s]) => (
                 <div key={key} className={cn(
                   "w-2 h-2 md:w-3 md:h-3 rounded-full border border-surface transition-all duration-500",
                   s.fired && s.active ? "bg-green shadow-lg shadow-green/20" : "bg-dim/20"
                 )} />
              ))}
           </div>
           <span className={cn("text-[9px] md:text-[10px] font-black uppercase tracking-tighter", satisfiedCount > 0 ? (allFired ? "text-red" : "text-amber") : "text-dim")}>
              {satisfiedCount}/{totalCount}
           </span>
        </div>
      </div>

      <div className="space-y-1.5 md:space-y-4 flex-1">
        {entries.map(([key, s]) => {
          const isFired = s.fired && s.active
          const threshold = Number(s.threshold) || 0

          // Estimated PnL at trigger
          const estPnl = s.threshold_is_price
            ? (threshold - entryPrice) * qty * (isLong ? 1 : -1)
            : null;
          const estRr = (estPnl !== null && riskUsdt > 0) ? (estPnl / riskUsdt) : null;

          return (
            <div key={key} className="space-y-1 md:space-y-3">
              <div className="flex justify-between items-center text-[9px] md:text-[10px] font-black uppercase tracking-widest">
                <div className="flex items-center gap-1.5 md:gap-2">
                  <span className={isFired ? "text-red" : s.fired ? "text-amber" : "text-dim"}>{s.label || key}</span>
                  {s.insufficientData ? (
                    <span className="text-dim bg-background/50 border border-border/40 px-1 rounded flex items-center gap-1 scale-90 md:scale-100">
                      Collecting
                    </span>
                  ) : s.remaining_delay > 0 && !isFired && (
                    <span className="text-amber bg-amber/10 px-1 rounded flex items-center gap-1 scale-90 md:scale-100">
                      <Clock size={8} /> {Math.ceil(s.remaining_delay)}s
                    </span>
                  )}
                  <span className={cn(
                    "md:hidden inline text-[8px] font-mono",
                    isFired ? "text-red" : s.fired ? "text-amber" : "text-accent"
                  )}>{s.insufficientData ? '---' : `${Number(s.progress || 0).toFixed(0)}%`}</span>
                </div>
                <div className="md:flex hidden items-center gap-2 font-mono">
                  <span className="text-dim/60">Mark: {price(mark)}</span>
                  <ArrowRight size={10} className="text-dim/40" />
                  <span className={isFired ? "text-red" : "text-text"}>{price(threshold)}</span>
                </div>
              </div>

              {/* Enhanced Proximity Bar (SignalGauge Style) */}
              <div className="space-y-0.5 md:space-y-1.5">
                <div className="h-1.5 md:h-2 bg-background/80 rounded-full overflow-hidden relative border border-white/5 shadow-inner">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${s.progress}%` }}
                    transition={{ type: "spring", stiffness: 40, damping: 20 }}
                    className={cn(
                      "absolute top-0 left-0 h-full rounded-full transition-colors duration-700",
                      isFired ? "bg-red shadow-[0_0_8px_rgba(255,68,102,0.4)]" : s.fired ? "bg-amber" : "bg-accent"
                    )}
                  />
                </div>

                <div className="flex justify-between items-center px-0.5 md:px-1">
                   <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-[7.5px] md:text-[9px] text-dim uppercase font-bold md:inline hidden">
                        {s.insufficientData ? 'Collecting' : `${Number(s.progress || 0).toFixed(1)}% Proxy`}
                      </span>
                      <span className="text-[7.5px] md:text-[9px] text-dim/60">{price(mark)}</span>
                      <ArrowRight size={8} className="text-dim/20" />
                      <span className={cn("text-[7.5px] md:text-[9px]", isFired ? "text-red" : "text-text/80")}>{price(threshold)}</span>
                   </div>
                   {estPnl !== null && (
                      <div className={cn(
                        "text-[8px] md:text-[9px] font-mono font-black",
                        estPnl >= 0 ? "text-green" : "text-red"
                      )}>
                        {estPnl >= 0 ? '+' : ''}{fmtUSD(estPnl)} ({Number(estRr || 0).toFixed(1)}R)
                      </div>
                   )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 md:mt-6 flex items-center gap-2 md:gap-3 p-2.5 md:p-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
        <Info size={10} className="text-dim shrink-0" />
        <p className="text-[7px] md:text-[8px] text-dim font-bold uppercase tracking-widest leading-normal">
          {logic === 'all'
            ? 'All technical conditions must be satisfied simultaneously to trigger an automated exit.'
            : 'Any single technical signal reaching its threshold will trigger an immediate trade liquidation.'}
        </p>
      </div>
    </div>
  )
})

export const TradeDetailContent = memo(({ trade, isSyncing, onTradeClose, isClosing, confirmClose, setConfirmClose, layout = "grid" }) => {
  const { isLong, pnlPct, progress, entry, mark, sl, initialSl, tp, qtyFormatted, riskFormatted, slDistPct = 0, slInitialDistPct = 0, enhancedExitSignals } = useMemo(() => {
    if (!trade) return {
      isLong: true, pnlPct: 0, progress: 50, entry: 0, mark: 0, sl: 0, initialSl: 0, tp: 0,
      qtyFormatted: '0.0000', riskFormatted: '$0.00', slDistPct: 0, slInitialDistPct: 0, enhancedExitSignals: {}
    }
    const isLong = trade.direction === 'LONG'
    const entry = Number(trade.entry_price || 0)
    const mark = Number(trade.current_price || trade.mark_price || 0)
    const sl = Number(trade.sl_price || 0)
    const initialSl = Number(trade.initial_sl || trade.sl_price || 0)
    const tp = Number(trade.tp_price || trade.tp || 0)

    const pnlPct = mark > 0 ? (trade.pnl_pct ?? (entry ? ((mark - entry) / entry) * 100 * (isLong ? 1 : -1) : 0)) : 0

    let progress = 50
    if (entry && mark && sl) {
      if (tp) {
        const totalRange = isLong ? (tp - sl) : (sl - tp)
        const currentFromSl = isLong ? (mark - sl) : (sl - mark)
        progress = Math.max(0, Math.min(100, (currentFromSl / totalRange) * 100))
      } else {
        const currentRR = Number(trade.rr || 0)
        if (currentRR < 0) {
           const distToSl = Math.abs(entry - sl)
           const distToMark = Math.abs(entry - mark)
           progress = Math.max(0, 50 - (distToMark / distToSl) * 50)
        } else {
           progress = Math.min(100, 50 + (currentRR / 3) * 50)
        }
      }
    }

    const qtyVal = Number(trade.qty)
    const qtyFormatted = Number.isFinite(qtyVal) ? qtyVal.toFixed(4) : '0.0000'
    const riskFormatted = fmtUSD(trade.risk_usdt || 0)

    const slDistPct = mark ? (Math.abs(mark - sl) / mark) * 100 : 0
    const slInitialDistPct = entry ? (Math.abs(entry - initialSl) / entry) * 100 : 0

    // Enhanced Exit Signals with proximity
    const exitSignals = trade.exit_signals_status || {}
    const enhancedExitSignals = Object.entries(exitSignals).reduce((acc, [key, s]) => {
      const distPct = calculateProximity(s, mark, entry);

      acc[key] = {
        ...s,
        distPct,
        label: (s.label || key).replace(/price/gi, '').trim(),
        unit: (s.unit || '').replace(/price/gi, '').trim()
      }
      return acc
    }, {})

    return { isLong, pnlPct, progress, entry, mark, sl, initialSl, tp, qtyFormatted, riskFormatted, slDistPct, slInitialDistPct, enhancedExitSignals }
  }, [trade])

  if (!trade) return null

  return (
    <div className="flex flex-col gap-3 md:gap-6">
      {/* PnL Hero Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 md:gap-6">
        <div className="relative group flex-1">
          <div className="absolute -inset-1 bg-gradient-to-r from-accent/20 to-purple/20 rounded-xl md:rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-1000" />
            <div className="relative bg-white/[0.03] border border-white/[0.05] rounded-xl md:rounded-2xl py-2 md:py-4 px-3 md:px-6 flex flex-col items-center text-center shadow-inner overflow-hidden">
              <div className="absolute top-0 right-0 p-2 md:p-4 opacity-10">
                <Activity size={24} className="md:w-12 md:h-12" />
            </div>
              <div className="flex items-center gap-2 mb-0.5 md:mb-1">
                <span className="text-[7px] md:text-[9px] font-black text-dim uppercase tracking-[0.2em]">
                {trade.exit_ts ? 'Realized P&L' : 'Live Return'}
              </span>
                <div className={cn("text-base md:text-2xl lg:text-3xl font-black font-mono tracking-tighter", pnlClass(trade.pnl))}>
                {fmtUSD(trade.pnl)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={cn("px-2 py-0.5 md:px-4 md:py-1.5 rounded-full text-[8px] md:text-xs font-black font-mono shadow-sm", trade.pnl >= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red")}>
                ROI: {Number(pnlPct || 0) >= 0 ? '+' : ''}{Number(pnlPct || 0).toFixed(2)}% · {fmt(trade.rr || 0, 2)}R
              </div>
              {trade.is_reconciliation && (
                <div className="bg-amber/10 text-amber border border-amber/20 px-2 py-0.5 md:px-4 md:py-1.5 rounded-full text-[8px] md:text-xs font-black uppercase tracking-widest shadow-sm flex items-center gap-1.5">
                  <Activity size={12} className="md:size-3" /> Reconciled
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Price Runway */}
      <div className="space-y-1.5 md:space-y-2">
        <div className="flex justify-between items-end">
          <div className="flex flex-col gap-0.5">
            <span className={cn(
              "text-[8px] md:text-[9px] font-black uppercase tracking-widest flex items-center gap-1",
              trade.strategy_config?.trailing_stop_enabled ? "text-purple-400 animate-pulse font-extrabold" : "text-red"
            )}>
              <ShieldAlert size={8} /> {trade.strategy_config?.trailing_stop_enabled ? 'Trailing SL' : 'SL'}
            </span>
            <span className="font-mono text-[9px] md:text-[10px] font-bold text-dim leading-none">{price(sl)}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[8px] md:text-[9px] font-black text-green uppercase tracking-widest flex items-center gap-1">
              TP <Zap size={8} fill="currentColor" />
            </span>
            <span className="font-mono text-[9px] md:text-[10px] font-bold text-dim leading-none">{tp ? price(tp) : 'TRAILED'}</span>
          </div>
        </div>

        <div className="h-2 w-full bg-border/20 rounded-full overflow-hidden relative shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
          <div className="absolute inset-0 bg-gradient-to-r from-red/5 via-transparent to-green/5 opacity-50" />
          <div className="absolute top-0 bottom-0 w-1 bg-white/20 z-10 blur-[1px]" style={{ left: '50%' }} />
          <div
            className={cn(
              "h-full transition-all duration-1000 ease-out relative",
              trade.pnl >= 0 ? "bg-green/80" : "bg-red/80"
            )}
            style={{ width: `${progress}%` }}
          >
             <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.1)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.1)_50%,rgba(255,255,255,0.1)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[move-stripe_1s_linear_infinite]" />
          </div>
        </div>

        <div className="flex justify-center scale-90">
          <div className="bg-surface border border-border/50 px-1.5 py-0.2 rounded-md">
            <span className="text-[8px] font-black text-dim uppercase tracking-widest">Entry: </span>
            <span className="font-mono text-[9px] font-bold text-text/80">{price(entry)}</span>
          </div>
        </div>
      </div>

      {/* Primary Metrics Grid */}
       <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
         <StatCard label="Mark" value={price(mark)} color={pnlClass(trade.pnl)} syncing={isSyncing} compact />
         <StatCard label="Size" value={qtyFormatted} subValue={trade.symbol.replace('USDT', '')} color="text-text" compact />
         <StatCard label="Risk" value={riskFormatted} color="text-red" compact />
         <StatCard label="Entry" value={price(entry)} color="text-dim" compact />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-5">
         <div className="lg:col-span-2 space-y-3 md:space-y-4">
            <RRLadder trade={trade} />

            {(trade.sl_adjustments || []).length > 0 && (
              <div className="bg-surface border border-border rounded-2xl p-3 md:p-5 shadow-sm">
                <SectionLabel className="mb-3 md:mb-5">
                  <ShieldCheck size={14} className="text-accent" /> Risk Mitigation Log
                </SectionLabel>
                <div className="space-y-2">
                  {(trade.sl_adjustments || []).slice(-3).reverse().map((adj, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] bg-white/[0.02] border border-white/[0.05] p-3 md:p-4 rounded-2xl group/adj hover:border-accent/30 transition-colors">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-text/90">{price(adj.prev_sl)}</span>
                          <span className="text-dim/30">→</span>
                          <span className="font-mono font-bold text-accent">{price(adj.new_sl)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <span className="text-dim/60 text-[9px] uppercase tracking-[0.1em]">{adj.reason}</span>
                           {adj.adaptive && (
                              <span className="bg-amber/10 text-amber px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-tighter flex items-center gap-1 border border-amber/20">
                                 <Activity size={8} /> Adaptive
                              </span>
                           )}
                        </div>
                      </div>
                      {i === 0 && (
                        <div className="flex flex-col items-end gap-1">
                          <span className="bg-accent/10 text-accent px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter">Current SL</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
         </div>

         <div className="space-y-3 md:space-y-4">
            <ExitMonitor status={enhancedExitSignals} logic={trade.exit_signal_logic} trade={trade} />

            <div className="bg-surface border border-border rounded-2xl p-3 md:p-5 shadow-sm">
              <SectionLabel className="mb-3 md:mb-5">
                 <Info size={14} className="text-accent" /> Technical Meta
              </SectionLabel>
              <div className="space-y-1 md:space-y-3.5">
                 {[
                   { label: 'TP Mode', value: trade.tp_mode === 'exp_rr_seq' ? 'Expansion RR' : 'Fixed Ratio' },
                    { label: 'Commission', value: fmtUSD(-(trade.realized_fee || 0)), color: 'text-red/70' },
                    { label: 'Funding Fee', value: fmtUSD(-(trade.funding_fee || 0)), color: trade.funding_fee > 0 ? 'text-red/70' : 'text-green/70' },
                   { label: 'ROI from Entry', value: `${pnlPct.toFixed(2)}%`, color: pnlPct >= 0 ? 'text-green' : 'text-red' },
                   { label: 'Stop Distance (Live)', value: `${slDistPct.toFixed(2)}%` },
                   trade.strategy_config?.trailing_stop_enabled && {
                     label: 'Trailing Stop',
                     value: `${trade.strategy_config.trailing_stop_distance_pct}%`,
                     color: 'text-purple-400'
                   },
                   { label: 'Initial SL Dist', value: `${slInitialDistPct.toFixed(2)}%` },
                   { label: 'Max Entry Risk', value: fmtUSD(trade.initial_risk_usdt || trade.risk_usdt || 0) },
                   {
                     label: 'Daily Δ at Entry',
                     value: `${(trade.entry_daily_change_pct || 0) > 0 ? '▲' : (trade.entry_daily_change_pct || 0) < 0 ? '▼' : ''} ${Number(Math.abs(trade.entry_daily_change_pct || 0)).toFixed(2)}%`,
                     color: pnlClass(trade.entry_daily_change_pct)
                   },
                   trade.exit_ts && {
                     label: 'Exit Signal',
                     tooltip: trade.exit_signal_reason,
                     value: (() => {
                        const type = trade.exit_signal_type?.replace(/_/g, ' ') || (trade.exit_reason || 'Manual');
                        const reason = trade.exit_signal_reason || '';
                        if (type === 'STOP LOSS' || type === 'SL HIT' || type === 'TRAILING STOP') {
                          if (reason.includes('INITIAL_SL')) return 'Initial Stop Loss';
                          if (reason.includes('RR_sequence_milestone_0')) return 'Breakeven SL';
                          if (reason.includes('RR_sequence_milestone')) {
                            const match = reason.match(/milestone_(\d+)/);
                            return match ? `Ratchet SL (M${match[1]})` : 'Ratchet SL';
                          }
                          if (type === 'TRAILING STOP') return 'Trailing Stop';
                          return 'Stop Loss';
                        }
                        if (type === 'EXCHANGE MANUAL') return 'Exchange Manual';
                        if (type === 'EXCHANGE FILL') return 'Exchange Fill';
                        if (type === 'EXCHANGE SYNC') return 'Exchange Sync';
                        return type;
                     })(),
                     color: 'text-accent'
                   }
                 ].filter(Boolean).map(item => (
                   <div key={item.label} className="flex justify-between items-center py-1 md:py-2.5 border-b border-border/40 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] md:text-[10px] text-dim font-bold uppercase tracking-widest">{item.label}</span>
                      </div>
                      {item.tooltip ? (
                        <Tooltip content={item.tooltip}>
                          <span className={cn("text-xs font-bold font-mono cursor-help border-b border-dotted border-white/10", item.color)}>{item.value}</span>
                        </Tooltip>
                      ) : (
                        <span className={cn("text-xs font-bold font-mono", item.color)}>{item.value}</span>
                      )}
                   </div>
                 ))}
              </div>
            </div>
         </div>
      </div>

      <div className="mt-3 md:mt-5 pt-4 border-t border-border/40">
        <SectionLabel className="mb-2.5 text-red">Danger Zone</SectionLabel>
        <div className="bg-red/5 border border-red/10 rounded-2xl p-4 md:p-5 flex flex-col md:flex-row items-center justify-between gap-4 transition-all hover:bg-red/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red/10 flex items-center justify-center text-red shrink-0">
              <ShieldAlert size={20} />
            </div>
            <div className="flex flex-col">
              <h3 className="text-xs font-bold uppercase tracking-tight text-red">Force Liquidation</h3>
              <p className="text-[9px] text-dim font-medium uppercase mt-0.5">Immediately close this position at current market price. This ignores all strategy logic.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 w-full md:w-auto min-w-[180px]">
            {trade.close_blocked && (
               <div className="bg-red/10 border border-red/20 rounded-xl p-2.5 flex flex-col gap-0.5 items-center text-center animate-pulse mb-1.5">
                  <span className="text-[9px] font-black text-red uppercase tracking-widest flex items-center gap-1">
                     <ShieldAlert size={10} /> Liquidation Blocked
                  </span>
                  <span className="text-[7.5px] text-red/60 font-bold uppercase leading-tight">
                     Max retries exceeded. Manual intervention on Binance is required.
                  </span>
               </div>
            )}
            {!trade.close_blocked && trade.close_attempts > 0 && (
               <div className="bg-amber/10 border border-amber/20 rounded-xl p-1.5 flex items-center justify-center gap-1.5 mb-1.5">
                  <Loader2 className="animate-spin text-amber" size={9} />
                  <span className="text-[7.5px] font-black text-amber uppercase tracking-widest">
                     Closure Retry {trade.close_attempts}/5
                  </span>
               </div>
            )}
            <Btn
              variant="danger"
              onClick={() => setConfirmClose(true)}
              disabled={isClosing}
              loading={isClosing}
              className="w-full h-10 py-1 text-[11px] uppercase tracking-widest font-black"
            >
              <Trash2 size={14} /> Force Close
            </Btn>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          onTradeClose(trade.symbol);
        }}
        title="Force Liquidation?"
        message={`Are you sure you want to immediately close your ${trade.symbol} ${trade.direction} position at market price? This bypasses all exit signals and risk guards.`}
        confirmText="Confirm Liquidation"
        variant="danger"
        loading={isClosing}
      />
    </div>
  )
})
TradeDetailContent.displayName = 'TradeDetailContent'
