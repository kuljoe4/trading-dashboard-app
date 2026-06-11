import React, { useState, useEffect, useMemo, memo } from 'react'
import { 
  ShieldCheck, Clock, ArrowUpRight, ArrowDownRight, Activity, Zap, 
  Info, ShieldAlert, CheckCircle2, BarChart3, TrendingUp, XCircle, Loader2
} from 'lucide-react'
import { fmtUSD, pnlColor, pnlClass, fmt } from '../../lib/theme'
import { price, formatDuration } from '../../lib/formatters'
import { StatCard, SectionLabel, cn, CopyButton, Tooltip, PulseDot } from '../ui/primitives'
import { motion, AnimatePresence } from 'framer-motion'

const Metric = memo(({ label, value, tooltip }) => (
  <div className="flex flex-col gap-1.5 group/metric">
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-black text-dim uppercase tracking-[0.2em]">{label}</span>
      {tooltip && (
        <Tooltip content={tooltip}>
          <Info size={10} className="text-dim/40 cursor-help" />
        </Tooltip>
      )}
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
  const currentExitRR = activeIdx >= 0 ? exits[activeIdx] : null
  const currentSl = currentExitRR == null
    ? (trade.initial_sl || trade.sl_price)
    : trade.direction === 'LONG'
      ? trade.entry_price + risk * currentExitRR
      : trade.entry_price - risk * currentExitRR
  
  return (
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <SectionLabel className="mb-0">
             <Zap size={14} className="text-accent" fill="currentColor" /> Guard Ladder
          </SectionLabel>
          <Tooltip content="Incremental profit milestones that automatically adjust your stop loss to lock in gains.">
            <Info size={12} className="text-dim/40 cursor-help" />
          </Tooltip>
        </div>
        <Tooltip content="Live Ratchet: The engine proactively trails your stop loss as these milestones are hit.">
          <div className="text-[10px] text-accent font-mono bg-accent/10 px-2 py-0.5 rounded border border-accent/20 cursor-help">Live Ratchet</div>
        </Tooltip>
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
    <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <SectionLabel className="mb-0">
          <ShieldCheck size={14} className="text-red" /> Technical Exit Signals
        </SectionLabel>
        <div className="px-2 py-0.5 rounded bg-background/50 border border-border/50 text-[8px] font-black text-dim uppercase tracking-widest">
          {logic === 'all' ? 'Consensus' : 'Any'}
        </div>
      </div>

      <div className="space-y-3 flex-1">
        {entries.map(([key, s]) => {
          const value = Number.isFinite(Number(s.value)) ? Number(s.value) : 0
          const threshold = Math.max(Math.abs(Number(s.threshold) || 1), 0.0001)
          const isFired = s.fired && s.active
          const isDelayed = s.remaining_delay > 0
          const progress = s.insufficientData ? 0 : Math.min((Math.abs(value) / threshold) * 100, 100)

          return (
            <div key={key} className={cn(
              "group relative overflow-hidden p-3 md:p-4 rounded-xl border transition-all duration-300",
              isFired ? "bg-red/5 border-red/30 shadow-[0_0_15px_rgba(255,68,102,0.05)]" : "bg-background/20 border-border hover:border-accent/30",
              isDelayed && !isFired && "opacity-80"
            )}>
              {isFired && (
                <div className="absolute top-0 right-0 p-1">
                   <PulseDot color="bg-red" />
                </div>
              )}

              <div className="flex justify-between items-center mb-3 gap-2">
                <div className="flex items-center gap-2 md:gap-3 min-w-0">
                   <div className={cn(
                     "w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center border transition-colors shrink-0",
                     isFired ? "bg-red text-white border-red/20 shadow-lg shadow-red/20" : "bg-surface border-border text-dim group-hover:text-accent group-hover:border-accent/20"
                   )}>
                     {isFired ? <Zap size={16} className="md:size-[18px]" fill="currentColor" /> : <Activity size={16} className="md:size-[18px]" />}
                   </div>
                   <div className="flex flex-col min-w-0">
                     <div className="flex items-center gap-1.5">
                       <span className="text-[10px] md:text-xs font-black uppercase tracking-tight truncate">{s.label || key}</span>
                       {isDelayed && !isFired && (
                         <div className="flex items-center gap-1 text-amber text-[7px] font-black uppercase tracking-tighter">
                            <Clock size={8} /> {s.remaining_delay}s
                         </div>
                       )}
                     </div>
                     <span className="text-[8px] md:text-[9px] text-dim font-bold truncate uppercase opacity-60 tracking-tighter">
                       {isDelayed && !isFired ? 'Waiting for warm-up...' : (s.description || 'Monitoring')}
                     </span>
                   </div>
                </div>

                <div className="flex flex-col items-end shrink-0">
                   <div className={cn("text-xs md:text-sm font-mono font-black tracking-tighter", isFired ? "text-red" : "text-text")}>
                     {s.insufficientData ? 'N/A' : Number(value).toFixed(value >= 100 ? 2 : 4)}
                     <span className="text-[9px] md:text-[10px] ml-0.5 opacity-40 font-bold">{s.unit}</span>
                   </div>
                   <div className="text-[7px] md:text-[8px] text-dim font-black uppercase tracking-widest opacity-40">
                     Target: {s.threshold}
                   </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center px-0.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[7px] font-black text-dim uppercase tracking-widest">Signal Activation</span>
                    <Tooltip content="Proximity to technical trigger threshold. 100% means the signal is fully active.">
                      <Info size={8} className="text-dim/40 cursor-help" />
                    </Tooltip>
                  </div>
                  <span className={cn("text-[8px] md:text-[9px] font-black font-mono", isFired ? "text-red" : "text-accent")}>
                    {s.distPct ? Math.min(100, s.distPct).toFixed(1) : '0.0'}%
                  </span>
                </div>
                <div className="h-1.5 bg-background/50 rounded-full overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ type: "spring", stiffness: 60, damping: 25 }}
                    className={cn(
                      "absolute top-0 left-0 h-full rounded-full",
                      isFired
                        ? "bg-gradient-to-r from-red to-orange shadow-[0_0_12px_rgba(255,68,102,0.4)]"
                        : isDelayed
                          ? "bg-amber/40"
                          : "bg-gradient-to-r from-accent to-purple shadow-[0_0_12px_rgba(91,111,255,0.4)]"
                    )}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl">
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
  const { isLong, pnlPct, progress, entry, mark, sl, tp, qtyFormatted, riskFormatted, slDistPct = 0, slFromEntry = 0, enhancedExitSignals } = useMemo(() => {
    if (!trade) return {}
    const isLong = trade.direction === 'LONG'
    const entry = Number(trade.entry_price || 0)
    const mark = Number(trade.current_price || trade.mark_price || 0)
    const sl = Number(trade.sl_price || 0)
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

    const slDistPct = entry ? (Math.abs(mark - sl) / entry) * 100 : 0
    const slFromEntry = entry ? (Math.abs(entry - sl) / entry) * 100 : 0

    // Enhanced Exit Signals with proximity
    const exitSignals = trade.exit_signals_status || {}
    const enhancedExitSignals = Object.entries(exitSignals).reduce((acc, [key, s]) => {
      const value = Number(s.value) || 0
      const threshold = Number(s.threshold) || 1

      // Proximity should represent how "filled" the condition is.
      // If value is 0 and threshold is 10, distPct should be 0.
      // If value is 10 and threshold is 10, distPct should be 100.
      const rawDistPct = threshold !== 0 ? (Math.abs(value) / Math.abs(threshold)) * 100 : 0
      const distPct = Math.min(100, Math.max(0, rawDistPct))

      acc[key] = {
        ...s,
        distPct,
        label: (s.label || key).replace(/price/gi, '').trim(),
        unit: (s.unit || '').replace(/price/gi, '').trim()
      }
      return acc
    }, {})

    return { isLong, pnlPct, progress, entry, mark, sl, tp, qtyFormatted, riskFormatted, slDistPct, slFromEntry, enhancedExitSignals }
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
              <span className="text-[7px] md:text-[10px] font-black text-dim uppercase tracking-[0.2em]">Performance</span>
              <div className={cn("text-lg md:text-4xl font-black font-mono tracking-tighter", pnlClass(trade.pnl))}>
                {fmtUSD(trade.pnl)}
              </div>
            </div>
            <div className={cn("px-2 py-0.5 md:px-4 md:py-1.5 rounded-full text-[8px] md:text-xs font-black font-mono shadow-sm", trade.pnl >= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red")}>
              {pnlPct >= 0 ? '▲' : '▼'} {Math.abs(pnlPct).toFixed(2)}% · {fmt(trade.rr || 0, 2)}R
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 min-w-[200px]">
          <button
            onClick={() => confirmClose ? onTradeClose(trade.symbol) : setConfirmClose(true)}
            disabled={isClosing}
            aria-label={isClosing ? "Closing position" : confirmClose ? "Confirm close position" : "Close position"}
            className={cn(
              "h-12 md:h-16 px-6 rounded-xl md:rounded-2xl font-bold uppercase text-[10px] md:text-[11px] tracking-[0.2em] transition-all flex items-center justify-center gap-3 relative overflow-hidden",
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
            <span aria-live="polite" className="font-black">
              {isClosing ? 'Closing...' : confirmClose ? 'Confirm Close?' : 'Force Liquidation'}
            </span>
          </button>
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
            <ExitMonitor status={enhancedExitSignals} logic={trade.exit_signal_logic} />

            <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
              <SectionLabel className="mb-6">
                 <Info size={14} className="text-accent" /> Technical Meta
              </SectionLabel>
              <div className="space-y-4">
                 {[
                   { label: 'TP Mode', value: trade.tp_mode === 'exp_rr_seq' ? 'Expansion RR' : 'Fixed Ratio' },
                    { label: 'Commission', value: fmtUSD(-(trade.realized_fee || 0)), color: 'text-red/70' },
                    { label: 'Funding Fee', value: fmtUSD(-(trade.funding_fee || 0)), color: trade.funding_fee > 0 ? 'text-red/70' : 'text-green/70' },
                   { label: 'Stop Distance (Live)', value: `${slDistPct.toFixed(2)}%`, tooltip: 'Current percentage distance from market price to stop loss' },
                   { label: 'Max Entry Risk', value: `${slFromEntry.toFixed(2)}%`, tooltip: 'Initial percentage risk calculated at time of entry' },
                 ].map(item => (
                   <div key={item.label} className="flex justify-between items-center py-3 border-b border-border/40 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-dim font-bold uppercase tracking-widest">{item.label}</span>
                        {item.tooltip && (
                          <Tooltip content={item.tooltip}>
                            <Info size={10} className="text-dim/40 cursor-help" />
                          </Tooltip>
                        )}
                      </div>
                      <span className={cn("text-xs font-bold font-mono", item.color)}>{item.value}</span>
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
                        <span className="text-dim/60 text-[9px] uppercase tracking-[0.1em]">{adj.reason}</span>
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
    </div>
  )
})
TradeDetailContent.displayName = 'TradeDetailContent'
