import React, { useState, useEffect } from 'react'
import { cn, Tooltip, CopyButton, MonitoredBadge } from './ui/primitives'
import { fmtUSD, pnlColor, pnlClass, safeNum } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { ShieldCheck, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'

export const ActiveTradeCard = React.memo(({ trade, config, onTradeClose, onClick, isResuming, showResumingFeedback }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  const entry = Number(trade.entry_price || 0)
  const mark = Number(trade.mark_price || trade.last_price || 0)
  const sl = Number(trade.sl_price || 0)
  const tp = Number(trade.tp_price || 0)
  const isLong = trade.direction === 'LONG'

  // BOLT: Direction-aware Price Runway.
  // We orient the runway so SL is always 0% and TP (or 3R) is 100%.
  // Entry point is dynamically calculated.
  let progress = 50
  let entryMarkPos = 50

  let ariaText = `Trade status for ${trade.symbol}`
  if (entry && mark && sl) {
    const pnlLabel = Number(trade.pnl || 0) >= 0 ? 'profit' : 'loss'
    const rrValue = Number(trade.rr || 0).toFixed(2)

    if (tp) {
      const totalRange = Math.abs(tp - sl)
      const distFromSl = Math.abs(mark - sl)
      progress = Math.max(0, Math.min(100, (distFromSl / totalRange) * 100))
      entryMarkPos = Math.max(0, Math.min(100, (Math.abs(entry - sl) / totalRange) * 100))
      ariaText = `${trade.symbol} ${trade.direction}: ${rrValue}R ${pnlLabel}. Price is ${Math.round(progress)}% of the way from Stop Loss to Take Profit.`
    } else {
      // Without TP, we use a reference of 3R profit for the 100% mark
      const distToSl = Math.abs(entry - sl)
      const targetProfitPrice = isLong ? (entry + distToSl * 3) : (entry - distToSl * 3)
      const totalRange = Math.abs(targetProfitPrice - sl)

      progress = Math.max(0, Math.min(100, (Math.abs(mark - sl) / totalRange) * 100))
      entryMarkPos = (Math.abs(entry - sl) / totalRange) * 100
      ariaText = `${trade.symbol} ${trade.direction}: ${rrValue}R ${pnlLabel}. Price is ${Math.round(progress)}% of the way from Stop Loss to 3R target.`
    }
  }

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      className={cn(
        "bg-surface border border-border/40 rounded-2xl p-4 md:p-5 flex flex-col gap-4 w-full shadow-sm cursor-pointer hover:border-accent/30 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98] group relative overflow-hidden",
        isResuming && "opacity-80 border-accent/20 bg-accent/[0.01]"
      )}
      aria-label={`View details for ${trade.symbol} ${trade.direction} trade, P&L is ${fmtUSD(trade.pnl)}, live risk-to-reward is ${Number(trade.rr || 0).toFixed(2)}R, peak risk-to-reward is ${Number(trade.max_rr || trade.rr || 0).toFixed(2)}R`}
    >
      {showResumingFeedback && (
        <div className="absolute inset-0 bg-accent/5 backdrop-blur-[1px] z-10 flex items-center justify-center pointer-events-none">
           <div className="bg-background/80 border border-accent/20 px-3 py-1 rounded-full text-[8px] font-black text-accent uppercase tracking-widest flex items-center gap-1.5 shadow-xl animate-in fade-in zoom-in duration-300">
              <RefreshCw size={10} className="animate-spin" /> Resuming Feed...
           </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm md:text-base font-black font-mono tracking-tight shrink-0">{trade.symbol || '---'}</span>
            <CopyButton value={trade.symbol} className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 transition-opacity scale-75 -ml-1" />
            <span className={cn("text-[9px] md:text-xs font-black px-1.5 py-0.5 rounded border uppercase shrink-0", isLong ? 'text-green border-green/20 bg-green/5' : 'text-red border-red/20 bg-red/5')}>
              {isLong ? '▲' : '▼'} {trade.direction || '---'}
            </span>
            {trade.is_reconciliation && (
              <span className="bg-amber text-black border border-amber text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">
                Recon
              </span>
            )}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
              <MonitoredBadge className="opacity-80" />
            )}
            {trade.strategy_config?.trailing_stop_enabled && (
              <span className="bg-purple-400/10 border border-purple-400/25 text-purple-400 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.15)]">
                Trailing Active
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0 min-w-[80px]">
          <Tooltip content="Live P&L including commission and funding">
            <div className={cn(
              "text-base md:text-lg lg:text-xl font-black font-mono tracking-tighter leading-none mb-1 cursor-help border-b border-dotted border-white/5",
              trade.pnl != null && !isNaN(Number(trade.pnl)) ? pnlClass(trade.pnl) : 'text-dim'
            )}>
              {trade.pnl != null && !isNaN(Number(trade.pnl)) ? fmtUSD(trade.pnl) : '$0.00'}
            </div>
          </Tooltip>
          <div className="flex items-center gap-2">
            <Tooltip content={`Current RR: ${Number(trade.rr || 0).toFixed(2)}R | Peak RR: ${Number(trade.max_rr || trade.rr || 0).toFixed(2)}R`}>
              <span
                className="text-[10px] md:text-[11px] font-black font-mono text-dim uppercase tracking-widest cursor-help flex items-center gap-1"
                aria-label={`Live risk-to-reward is ${Number(trade.rr || 0).toFixed(2)}R, Peak risk-to-reward is ${Number(trade.max_rr || trade.rr || 0).toFixed(2)}R`}
              >
                {Number(trade.rr || 0).toFixed(2)}R <span className="text-[9px] text-accent/80 font-black tracking-normal" aria-hidden="true">(Peak: {Number(trade.max_rr || trade.rr || 0).toFixed(2)}R)</span>
              </span>
            </Tooltip>
            {(trade.realized_fee > 0 || trade.funding_fee !== 0) && (
              <Tooltip content={`Commission: -${fmtUSD(trade.realized_fee || 0)} | Funding: ${trade.funding_fee > 0 ? '-' : '+'}${fmtUSD(Math.abs(trade.funding_fee || 0))}`}>
                <div className="text-[8px] md:text-[9px] font-black font-mono text-red/40 uppercase tracking-tighter cursor-help border-b border-dotted border-red/10">
                  -{fmtUSD(safeNum(trade.realized_fee) + safeNum(trade.funding_fee))}
                </div>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {/* Mini Price Runway */}
      <div className="flex flex-col gap-2">
        <div
          className="h-1.5 w-full bg-border/40 rounded-full overflow-hidden relative"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuetext={ariaText}
        >
          {/* Entry Point Marker */}
          <div
            className="absolute top-0 bottom-0 w-px bg-white/40 z-20"
            style={{ left: `${entryMarkPos}%` }}
            aria-hidden="true"
          />
          {/* Progress Bar */}
          <div
            className={cn(
              "h-full transition-all duration-500 shadow-[0_0_10px_rgba(0,0,0,0.2)]",
              trade.pnl >= 0 ? "bg-green" : "bg-red"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] font-bold text-dim uppercase tracking-widest font-mono">
          <div className="flex flex-col items-start">
            <span className="text-red/60">SL</span>
            <span className="text-[8px] opacity-40">{entry ? Number((Math.abs(entry - sl) / entry) * 100).toFixed(1) : 0}%</span>
          </div>
          <span className="text-text/20">Entry</span>
          <div className="flex flex-col items-end">
            <span className="text-green/60">{tp ? 'TP' : '3R'}</span>
            <span className="text-[8px] opacity-40">{tp && entry ? Number((Math.abs(tp - entry) / entry) * 100).toFixed(1) : '---'}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
})

