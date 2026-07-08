import React, { useState, useEffect, useMemo, memo } from 'react'
import { 
  ShieldCheck, Clock, ArrowUpRight, ArrowDownRight, Activity, Zap, 
  Info, ShieldAlert, CheckCircle2, BarChart3, TrendingUp, XCircle, Loader2, Trash2
} from 'lucide-react'
import { fmtUSD, pnlColor, pnlClass, fmt } from '../../lib/theme'
import { price, formatDuration } from '../../lib/formatters'
import { StatCard, SectionLabel, cn, CopyButton, Tooltip, PulseDot, Btn } from '../ui/primitives'
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

const RRLadder = ({ trade }) => {
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
    <div className="bg-surface border border-border rounded-2xl p-4 md:p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4 md:mb-6">
        <div className="flex items-center gap-2">
          <SectionLabel className="mb-0">
             <Zap size={14} className="text-accent" fill="currentColor" /> Guard Ladder
          </SectionLabel>
        </div>
        <div className="text-[10px] text-accent font-mono bg-accent/10 px-2 py-0.5 rounded border border-accent/20">Live Ratchet</div>
      </div>

      <div className="flex gap-4 overflow-x-auto no-scrollbar mb-4 md:mb-8 pb-2">
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
                "text-[10px] font-bold mt-3 uppercase tracking-widest text-center flex flex-col",
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6">
        <div className="p-3 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[10px] text-dim font-bold uppercase tracking-widest mb-1">Live RR</div>
          <div className={cn("text-xl font-mono font-bold", liveRR >= 0 ? "text-green" : "text-red")}>{fmt(liveRR, 2)}</div>
        </div>
        <div className="p-3 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[10px] text-dim font-bold uppercase tracking-widest mb-1">Peak RR</div>
          <div className="text-xl font-mono font-bold text-accent">{fmt(maxRR, 2)}</div>
        </div>
        <div className="p-3 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[10px] text-dim font-bold uppercase tracking-widest mb-1">Secured SL</div>
          <div className="text-xl font-mono font-bold text-text flex flex-col">
            <span>{price(currentSl)}</span>
            <span className={cn("text-[10px]", pnlClass(getEstPnl(currentSl)))}>
              Est. {fmtUSD(getEstPnl(currentSl))}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

const ExitMonitor = ({ status, logic, trade }) => {
  if (!status || Object.keys(status).length === 0) return null;
  const entries = Object.entries(status)
  const mark = Number(trade.current_price || trade.mark_price || 0)
  const isLong = trade.direction === 'LONG'
  const entryPrice = Number(trade.entry_price || 0)
  const qty = Number(trade.qty || 0)
  const riskUsdt = Number(trade.risk_usdt || trade.initial_risk_usdt || 0)

  const allFired = entries.every(([_, s]) => s.fired && s.active)

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 md:p-6 shadow-sm flex flex-col">
      <div className="flex items-center justify-between mb-4 md:mb-8">
        <div className="flex flex-col gap-1">
          <SectionLabel className="mb-0">
            <ShieldCheck size={14} className="text-red" /> Technical Exit Signals
          </SectionLabel>
          <div className="text-[8px] text-dim font-bold uppercase tracking-widest opacity-60">
            Logic: {logic === 'all' ? 'All-Conditions Consensus' : 'Any-Condition Trigger'}
          </div>
        </div>
        {logic === 'all' && (
           <div className="flex items-center gap-3">
              <div className="flex -space-x-1.5">
                 {entries.map(([key, s]) => (
                    <div key={key} className={cn(
                      "w-4 h-4 rounded-full border-2 border-surface flex items-center justify-center transition-all duration-500",
                      s.fired && s.active ? "bg-green text-white scale-110 shadow-lg shadow-green/20" : "bg-dim/20 text-dim/40"
                    )}>
                       {s.fired && s.active ? <CheckCircle2 size={10} /> : <div className="w-1 h-1 rounded-full bg-current" />}
                    </div>
                 ))}
              </div>
              <span className={cn("text-[9px] font-black uppercase tracking-tighter", allFired ? "text-green" : "text-dim")}>
                 {entries.filter(([_, s]) => s.fired && s.active).length}/{entries.length} Satisfied
              </span>
           </div>
        )}
      </div>

      <div className="space-y-4 md:space-y-6 flex-1">
        {entries.map(([key, s]) => {
          const value = Number.isFinite(Number(s.value)) ? Number(s.value) : 0
          const threshold = Math.max(Math.abs(Number(s.threshold) || 1), 0.0001)
          const isFired = s.fired && s.active
          const isDelayed = s.remaining_delay > 0

          // BOLT: Clarity Overhaul. "Progress" now means distance to THRESHOLD.
          // Once THRESHOLD is met, we show "CRITERIA MET" and change color.
          // If logic='all' and some are not hit, we show "AWAITING CONSENSUS".
          let triggerProgress = 0;
          if (!s.insufficientData) {
             if (s.fired && s.active) {
                triggerProgress = 100;
             } else if (s.threshold_is_price) {
             // BOLT: Direction-aware proximity math.
             // 0% = Entry Price, 100% = Threshold.
             // If price moves past threshold, it stays at 100% (fired).
             // If price moves back past entry, it stays at 0%.
             const totalDist = isLong ? (threshold - entryPrice) : (entryPrice - threshold);
             const progressDist = isLong ? (mark - entryPrice) : (entryPrice - mark);

                if (totalDist > 0) {
                   triggerProgress = Math.max(0, Math.min(100, (progressDist / totalDist) * 100));
                } else if (s.fired) {
                   triggerProgress = 100;
                }
             } else {
                triggerProgress = Math.max(0, Math.min(100, (Math.abs(value) / threshold) * 100));
             }
          }

          const estExitPrice = s.threshold_is_price ? threshold : null
          const estPnl = (estExitPrice && entryPrice && qty)
            ? (estExitPrice - entryPrice) * qty * (isLong ? 1 : -1)
            : null

          return (
            <div key={key} className={cn(
              "group relative overflow-hidden p-4 md:p-6 rounded-2xl md:rounded-[2rem] border transition-all duration-700",
              isFired ? "bg-red/5 border-red/40 shadow-[0_0_40px_rgba(255,68,102,0.15)]" : s.fired ? "bg-amber/5 border-amber/30" : "bg-background/30 border-border/80 hover:border-accent/50 hover:bg-background/50",
              isDelayed && !isFired && "opacity-80"
            )}>
              {isFired && (
                <div className="absolute top-5 right-5">
                   <PulseDot color="bg-red" />
                </div>
              )}

              <div className="flex flex-col gap-4 md:gap-6">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex items-center gap-3 md:gap-4 min-w-0">
                     <div className={cn(
                       "w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-[1.25rem] flex items-center justify-center border transition-all duration-700 shrink-0",
                       isFired ? "bg-red text-white border-red/30 shadow-2xl shadow-red/20 scale-105" : s.fired ? "bg-amber text-white border-amber/20 shadow-xl shadow-amber/20" : "bg-surface border-border/80 text-dim group-hover:text-accent group-hover:border-accent/40 group-hover:scale-110"
                     )}>
                       {isFired ? <Zap size={20} className="md:size-7" fill="currentColor" /> : <Activity size={20} className="md:size-7" />}
                     </div>
                     <div className="flex flex-col min-w-0">
                       <div className="flex items-center gap-2">
                         <span className="text-[12px] md:text-[16px] font-black uppercase tracking-tight truncate">{s.label || key}</span>
                         {isDelayed && !isFired && (
                           <div className="relative group/delay overflow-hidden flex items-center gap-1.5 text-amber bg-amber/10 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter border border-amber/20">
                              <div className="absolute inset-0 bg-amber/20 origin-left" style={{ width: `${(s.remaining_delay / (s.config_delay || s.remaining_delay)) * 100}%` }} />
                              <Clock size={12} className="relative z-10" />
                              <span className="relative z-10">{Math.ceil(s.remaining_delay)}s</span>
                           </div>
                         )}
                       </div>
                       <span className="text-[10px] md:text-[11px] text-dim font-bold truncate uppercase opacity-80 tracking-tight mt-0.5 md:mt-1">
                         {isFired ? 'Consolidated signal fired' : isDelayed && !isFired ? 'Waiting for warmup period...' : s.fired ? 'Threshold met - Awaiting consensus' : 'Monitoring live threshold'}
                       </span>
                     </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0 gap-1.5 md:gap-2.5">
                     <div className={cn("text-base md:text-2xl font-mono font-black tracking-tighter leading-none", isFired ? "text-red" : s.fired ? "text-amber" : "text-text")}>
                       {s.insufficientData ? '---' : Number(value).toFixed(value >= 100 ? 2 : 4)}
                       <span className="text-[10px] md:text-[14px] ml-1 opacity-40 font-bold">{s.unit}</span>
                     </div>
                     <div className={cn(
                        "text-[9px] md:text-[10px] font-black uppercase tracking-widest px-2 md:px-3 py-1 md:py-1.5 rounded-lg md:rounded-xl border flex items-center gap-2 transition-all duration-500",
                        isFired ? "bg-red text-white border-red/20 shadow-lg shadow-red/20" : s.fired ? "bg-amber/20 text-amber border-amber/30" : "bg-accent/10 text-accent border-accent/20"
                     )}>
                       {s.insufficientData ? 'Collecting' : isFired ? 'TRIGGER FIRED' : s.fired ? 'CRITERIA MET' : 'AWAITING LEVEL'}
                     </div>
                  </div>
                </div>

                <div className="space-y-4 md:space-y-5">
                  {/* Unified Trigger Progress Gauge */}
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-end px-1">
                       <span className="text-[9px] md:text-[10px] font-black text-dim uppercase tracking-[0.2em]">Signal Convergence</span>
                       <span className={cn("text-[11px] md:text-[12px] font-mono font-black", s.fired ? "text-green" : "text-text/80")}>{s.insufficientData ? '0.0' : triggerProgress.toFixed(1)}%</span>
                    </div>
                    <div className="h-3 md:h-4 bg-background/80 rounded-full overflow-hidden relative shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)] border border-white/5">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${triggerProgress}%` }}
                        transition={{ type: "spring", stiffness: 40, damping: 20 }}
                        className={cn(
                          "absolute top-0 left-0 h-full rounded-full transition-colors duration-700",
                          isFired ? "bg-red shadow-[0_0_30px_rgba(255,68,102,0.6)]" : s.fired ? "bg-amber" : "bg-accent"
                        )}
                      >
                         <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.2)_50%,rgba(255,255,255,0.2)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] opacity-50 animate-[move-stripe_1s_linear_infinite]" />
                      </motion.div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-x-4 md:gap-x-8 gap-y-3 md:gap-y-4 text-[10px] md:text-[11px] font-black uppercase tracking-widest text-dim/60 border-t border-border/40 pt-4 md:pt-5">
                   <div className="flex items-center gap-2.5">
                      <span className="opacity-40">Target Level:</span>
                      <span className="text-text/80 font-mono tracking-tight text-[11px] md:text-[12px]">{s.threshold} {s.unit}</span>
                   </div>

                   <div className="flex items-center gap-4 md:gap-8">
                      {estExitPrice && mark > 0 && (
                         <div className="flex items-center gap-2.5">
                            <span className="opacity-40">Distance:</span>
                            <span className="font-mono text-accent text-[11px] md:text-[12px]">
                              {Math.abs(((mark - estExitPrice) / mark) * 100).toFixed(2)}%
                            </span>
                         </div>
                      )}
                      {(estPnl !== null || s.threshold_is_price) && (
                         <div className="flex items-center gap-2.5">
                            <span className="opacity-40">Est. PnL:</span>
                            <span className={cn("font-mono text-[11px] md:text-[12px]", estPnl != null ? pnlClass(estPnl) : "text-dim")}>
                               {estPnl != null ? fmtUSD(estPnl) : '---'}
                            </span>
                         </div>
                      )}
                      {(estPnl !== null || s.threshold_is_price) && riskUsdt > 0 && (
                         <div className="flex items-center gap-2.5">
                            <span className="opacity-40">Est. RR:</span>
                            <span className="font-mono text-text/80 text-[11px] md:text-[12px]">
                               {estPnl != null ? (estPnl / riskUsdt).toFixed(2) : '---'}R
                            </span>
                         </div>
                      )}
                   </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 md:mt-6 flex items-center gap-3 p-3 md:p-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
        <Info size={12} className="text-dim" />
        <p className="text-[8px] text-dim font-bold uppercase tracking-widest leading-relaxed">
          {logic === 'all'
            ? 'All technical conditions must be satisfied simultaneously to trigger an automated exit.'
            : 'Any single technical signal reaching its threshold will trigger an immediate trade liquidation.'}
        </p>
      </div>
    </div>
  )
}

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

    const pnlPct = trade.pnl_pct ?? (entry ? ((mark - entry) / entry) * 100 * (isLong ? 1 : -1) : 0)

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
      const value = Number(s.value) || 0
      const threshold = Number(s.threshold) || 1

      // Proximity should represent how "filled" the condition is.
      // If value is 0 and threshold is 10, distPct should be 0.
      // If value is 10 and threshold is 10, distPct should be 100.
      const rawDistPct = threshold !== 0 ? (Math.abs(value) / Math.abs(threshold)) * 100 : 0
      const distPct = s.insufficientData ? 0 : Math.min(100, Math.max(0, rawDistPct))

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
          <div className="relative bg-white/[0.03] border border-white/[0.05] rounded-xl md:rounded-[2rem] p-3 md:p-8 flex flex-col items-center text-center shadow-inner overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Activity size={32} className="md:w-20 md:h-20" />
            </div>
            <div className="flex items-center gap-2 mb-1 md:mb-2">
              <span className="text-[7px] md:text-[10px] font-black text-dim uppercase tracking-[0.2em]">
                {trade.exit_ts ? 'Realized P&L' : 'Live Return'}
              </span>
              <div className={cn("text-lg md:text-4xl font-black font-mono tracking-tighter", pnlClass(trade.pnl))}>
                {fmtUSD(trade.pnl)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={cn("px-2 py-0.5 md:px-4 md:py-1.5 rounded-full text-[8px] md:text-xs font-black font-mono shadow-sm", trade.pnl >= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red")}>
                ROI: {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}% · {fmt(trade.rr || 0, 2)}R
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
      <div className="space-y-2 md:space-y-4">
        <div className="flex justify-between items-end">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-black text-red uppercase tracking-widest flex items-center gap-1">
              <ShieldAlert size={8} /> SL
            </span>
            <span className="font-mono text-[10px] font-bold text-dim">{price(sl)}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[9px] font-black text-green uppercase tracking-widest flex items-center gap-1">
              TP <Zap size={8} fill="currentColor" />
            </span>
            <span className="font-mono text-[10px] font-bold text-dim">{tp ? price(tp) : 'TRAILED'}</span>
          </div>
        </div>

        <div className="h-4 w-full bg-border/20 rounded-full overflow-hidden relative shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]">
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

        <div className="flex justify-center">
          <div className="bg-surface border border-border/50 px-2 py-0.5 rounded-lg">
            <span className="text-[9px] font-black text-dim uppercase tracking-widest">Entry: </span>
            <span className="font-mono text-[10px] font-bold text-text/80">{price(entry)}</span>
          </div>
        </div>
      </div>

      {/* Primary Metrics Grid */}
       <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
         <StatCard label="Mark" value={price(mark)} color={pnlClass(trade.pnl)} syncing={isSyncing} />
         <StatCard label="Size" value={qtyFormatted} subValue={trade.symbol.replace('USDT', '')} color="text-text" />
         <StatCard label="Risk" value={riskFormatted} color="text-red" />
         <StatCard label="Entry" value={price(entry)} color="text-dim" />
      </div>

      <div className={cn("grid gap-4 md:gap-8", layout === "grid" ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1")}>
         <div className={cn(layout === "grid" ? "lg:col-span-2 space-y-4 md:space-y-8" : "space-y-4 md:space-y-8")}>
            <RRLadder trade={trade} />
         </div>

         <div className="space-y-4 md:space-y-8">
            <ExitMonitor status={enhancedExitSignals} logic={trade.exit_signal_logic} trade={trade} />

            <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
              <SectionLabel className="mb-6">
                 <Info size={14} className="text-accent" /> Technical Meta
              </SectionLabel>
              <div className="space-y-4">
                 {[
                   { label: 'TP Mode', value: trade.tp_mode === 'exp_rr_seq' ? 'Expansion RR' : 'Fixed Ratio' },
                    { label: 'Commission', value: fmtUSD(-(trade.realized_fee || 0)), color: 'text-red/70' },
                    { label: 'Funding Fee', value: fmtUSD(-(trade.funding_fee || 0)), color: trade.funding_fee > 0 ? 'text-red/70' : 'text-green/70' },
                   { label: 'ROI from Entry', value: `${pnlPct.toFixed(2)}%`, color: pnlPct >= 0 ? 'text-green' : 'text-red' },
                   { label: 'Stop Distance (Live)', value: `${slDistPct.toFixed(2)}%` },
                   { label: 'Initial SL Dist', value: `${slInitialDistPct.toFixed(2)}%` },
                   { label: 'Max Entry Risk', value: fmtUSD(trade.initial_risk_usdt || trade.risk_usdt || 0) },
                   {
                     label: 'Daily Δ at Entry',
                     value: `${(trade.entry_daily_change_pct || 0) > 0 ? '▲' : (trade.entry_daily_change_pct || 0) < 0 ? '▼' : ''} ${Math.abs(trade.entry_daily_change_pct || 0).toFixed(2)}%`,
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
                   <div key={item.label} className="flex justify-between items-center py-3 border-b border-border/40 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">{item.label}</span>
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

            {trade.sl_adjustments?.length > 0 && (
              <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
                <SectionLabel className="mb-6">
                  <ShieldCheck size={14} className="text-accent" /> Risk Mitigation Log
                </SectionLabel>
                <div className="space-y-2">
                  {trade.sl_adjustments.slice(-3).reverse().map((adj, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl group/adj hover:border-accent/30 transition-colors">
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
      </div>

      <div className="mt-4 md:mt-8 pt-6 border-t border-border/40">
        <SectionLabel className="mb-4 text-red">Danger Zone</SectionLabel>
        <div className="bg-red/5 border border-red/10 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 transition-all hover:bg-red/10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-red/10 flex items-center justify-center text-red shrink-0">
              <ShieldAlert size={24} />
            </div>
            <div className="flex flex-col">
              <h3 className="text-sm font-bold uppercase tracking-tight text-red">Force Liquidation</h3>
              <p className="text-[10px] text-dim font-medium uppercase mt-1">Immediately close this position at current market price. This ignores all strategy logic.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full md:w-auto min-w-[200px]">
            {trade.close_blocked && (
               <div className="bg-red/10 border border-red/20 rounded-xl p-3 flex flex-col gap-1 items-center text-center animate-pulse mb-2">
                  <span className="text-[10px] font-black text-red uppercase tracking-widest flex items-center gap-1">
                     <ShieldAlert size={12} /> Liquidation Blocked
                  </span>
                  <span className="text-[8px] text-red/60 font-bold uppercase leading-tight">
                     Max retries exceeded. Manual intervention on Binance is required.
                  </span>
               </div>
            )}
            {!trade.close_blocked && trade.close_attempts > 0 && (
               <div className="bg-amber/10 border border-amber/20 rounded-xl p-2 flex items-center justify-center gap-2 mb-2">
                  <Loader2 className="animate-spin text-amber" size={10} />
                  <span className="text-[8px] font-black text-amber uppercase tracking-widest">
                     Closure Retry {trade.close_attempts}/5
                  </span>
               </div>
            )}
            <Btn
              variant="danger"
              onClick={() => setConfirmClose(true)}
              disabled={isClosing}
              loading={isClosing}
              className="w-full h-12 uppercase tracking-widest font-black"
            >
              <Trash2 size={16} /> Force Close
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
