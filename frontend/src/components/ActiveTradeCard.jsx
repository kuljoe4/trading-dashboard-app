import React, { useState, useEffect } from 'react'
import { cn, Tooltip, CopyButton } from './ui/primitives'
import { fmtUSD, pnlColor, pnlClass, safeNum } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { ShieldCheck } from 'lucide-react'
import { motion } from 'framer-motion'

export const ActiveTradeCard = ({ trade, config, onTradeClose, onClick }) => {
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

  if (entry && mark && sl) {
    if (tp) {
      const totalRange = Math.abs(tp - sl)
      const distFromSl = Math.abs(mark - sl)
      progress = Math.max(0, Math.min(100, (distFromSl / totalRange) * 100))
      entryMarkPos = Math.max(0, Math.min(100, (Math.abs(entry - sl) / totalRange) * 100))
    } else {
      // Without TP, we use a reference of 3R profit for the 100% mark
      const distToSl = Math.abs(entry - sl)
      const targetProfitPrice = isLong ? (entry + distToSl * 3) : (entry - distToSl * 3)
      const totalRange = Math.abs(targetProfitPrice - sl)

      progress = Math.max(0, Math.min(100, (Math.abs(mark - sl) / totalRange) * 100))
      entryMarkPos = (Math.abs(entry - sl) / totalRange) * 100
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
      className="bg-surface border border-border/40 rounded-2xl p-4 md:p-5 flex flex-col gap-4 w-full shadow-sm cursor-pointer hover:border-accent/30 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98]"
      aria-label={`View details for ${trade.symbol} ${trade.direction} trade, ${fmtUSD(trade.net_pnl)} Net Return, ${Number(trade.rr || 0).toFixed(2)} RR`}
    >
      <div className="flex items-center justify-between gap-3 min-w-0 group">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 whitespace-nowrap overflow-hidden">
            <span className="text-sm md:text-base font-black font-mono tracking-tight shrink-0">{trade.symbol || '---'}</span>
            <CopyButton value={trade.symbol} tooltip="Copy Symbol" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 -ml-1.5 scale-75" />
            <span className={cn("text-[9px] md:text-xs font-black px-1.5 py-0.5 rounded border uppercase shrink-0", isLong ? 'text-green border-green/20 bg-green/5' : 'text-red border-red/20 bg-red/5')}>
              {isLong ? '▲' : '▼'} {trade.direction || '---'}
            </span>
          </div>
          {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
            <div className="flex items-center gap-1 whitespace-nowrap overflow-hidden">
              <ShieldCheck size={10} className="text-accent shrink-0" />
              <span className="text-[9px] font-black text-accent uppercase tracking-widest opacity-80 truncate">Monitored</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-6 shrink-0">
          <div className="flex flex-col items-end">
            <span className="text-[7px] font-black text-dim uppercase tracking-[0.2em] mb-1 opacity-60">Market Gain</span>
            <div className={cn(
              "text-xs md:text-sm font-black font-mono tracking-tighter",
              trade.market_pnl != null && !isNaN(Number(trade.market_pnl)) ? pnlClass(trade.market_pnl) : 'text-dim'
            )}>
              {trade.market_pnl != null && !isNaN(Number(trade.market_pnl)) ? fmtUSD(trade.market_pnl) : '$0.00'}
            </div>
          </div>

          <div className="w-px h-8 bg-border/40" />

          <div className="flex flex-col items-end min-w-[100px] relative">
            <span className="text-[7px] font-black text-dim uppercase tracking-[0.2em] mb-1 opacity-60 flex items-center gap-1">
              Net Return <Info size={8} className="text-dim/40" />
            </span>
            <div className={cn(
              "px-3 py-1.5 rounded-xl border font-black font-mono tracking-tighter leading-none transition-all duration-300",
              trade.net_pnl > 0 ? "bg-green/5 border-green/20 text-green shadow-[0_0_15px_rgba(0,229,160,0.05)]" :
              trade.net_pnl < 0 ? "bg-red/5 border-red/20 text-red shadow-[0_0_15px_rgba(255,68,102,0.05)]" :
              "bg-surface border-border text-dim"
            )}>
              <Tooltip content={
                <div className="flex flex-col gap-2 p-2 min-w-[160px]">
                  <div className="text-[10px] font-black uppercase tracking-widest border-b border-white/10 pb-2 mb-1">Position Cost Breakdown</div>
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-dim text-[9px] font-bold uppercase tracking-tight">Market Gain</span>
                    <span className={cn("font-mono font-bold text-[11px]", (trade.market_pnl || 0) >= 0 ? "text-green" : "text-red")}>{fmtUSD(trade.market_pnl || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-dim text-[9px] font-bold uppercase tracking-tight">Open Fee</span>
                    <span className="text-red/80 font-mono font-bold text-[11px]">-{fmtUSD(trade.realized_fee || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-dim text-[9px] font-bold uppercase tracking-tight">Funding</span>
                    <span className={cn("font-mono font-bold text-[11px]", (trade.funding_fee || 0) > 0 ? "text-red/80" : "text-green/80")}>
                      {(trade.funding_fee || 0) > 0 ? '-' : '+'}{fmtUSD(Math.abs(trade.funding_fee || 0))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-4 border-t border-white/10 pt-2 mt-1">
                    <span className="text-white text-[10px] font-black uppercase tracking-widest">Net Total</span>
                    <span className={cn("font-mono font-black text-[12px]", (trade.net_pnl || 0) >= 0 ? "text-green" : "text-red")}>{fmtUSD(trade.net_pnl || 0)}</span>
                  </div>
                </div>
              }>
                <button
                   className="text-base md:text-lg lg:text-xl focus:outline-none focus:ring-2 focus:ring-accent/50 rounded transition-all active:scale-95"
                   tabIndex={0}
                   aria-label={`Net Return: ${fmtUSD(trade.net_pnl)}, hover for breakdown`}
                >
                  {trade.net_pnl != null && !isNaN(Number(trade.net_pnl)) ? fmtUSD(trade.net_pnl) : '$0.00'}
                </button>
              </Tooltip>
            </div>
            <div className="mt-1.5">
               <span className="text-[10px] md:text-[11px] font-black font-mono text-dim/60 uppercase tracking-widest">
                 {Number(trade.rr || 0).toFixed(2)}R
               </span>
            </div>
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
          aria-label={`Trade progress from SL to TP: ${Math.round(progress)}%`}
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
            <Tooltip content="Stop Loss: The price at which the position will be automatically closed to limit losses.">
              <span className="text-red/60 cursor-help border-b border-dotted border-red/20 focus-visible:ring-1 focus-visible:ring-red outline-none" tabIndex={0} role="button">SL</span>
            </Tooltip>
            <span className="text-[8px] opacity-40">{entry ? ((Math.abs(entry - sl) / entry) * 100).toFixed(1) : 0}%</span>
          </div>
          <span className="text-text/20">Entry</span>
          <div className="flex flex-col items-end">
            <Tooltip content={tp ? "Take Profit: The target price at which the position will be automatically closed to secure gains." : "Expansion RR Target: The engine will dynamically trail the stop loss towards this 3R milestone."}>
              <span className="text-green/60 cursor-help border-b border-dotted border-green/20 focus-visible:ring-1 focus-visible:ring-green outline-none" tabIndex={0} role="button">{tp ? 'TP' : '3R'}</span>
            </Tooltip>
            <span className="text-[8px] opacity-40">{tp && entry ? ((Math.abs(tp - entry) / entry) * 100).toFixed(1) : '---'}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

