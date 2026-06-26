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
      className="bg-surface border border-border/40 rounded-2xl p-4 md:p-5 flex flex-col gap-4 w-full shadow-sm cursor-pointer hover:border-accent/30 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98] group"
      aria-label={`View details for ${trade.symbol} ${trade.direction} trade, ${fmtUSD(trade.pnl)} P&L, ${Number(trade.rr || 0).toFixed(2)} RR`}
    >
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 whitespace-nowrap overflow-hidden">
            <span className="text-sm md:text-base font-black font-mono tracking-tight shrink-0">{trade.symbol || '---'}</span>
            <CopyButton value={trade.symbol} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity scale-75 -ml-1" />
            <span className={cn("text-[9px] md:text-xs font-black px-1.5 py-0.5 rounded border uppercase shrink-0", isLong ? 'text-green border-green/20 bg-green/5' : 'text-red border-red/20 bg-red/5')}>
              {isLong ? '▲' : '▼'} {trade.direction || '---'}
            </span>
            {trade.is_reconciliation && (
              <Tooltip content="Reconciled Trade: This trade was automatically imported from the exchange or resumed after a system restart.">
                <span className="bg-amber/10 text-amber border border-amber/20 text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter cursor-help">
                  Recon
                </span>
              </Tooltip>
            )}
          </div>
          {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
            <Tooltip content="Manual Monitor Active: This symbol is being explicitly tracked regardless of global scanner state.">
              <div className="flex items-center gap-1 whitespace-nowrap overflow-hidden">
                <ShieldCheck size={10} className="text-accent shrink-0" />
                <span className="text-[9px] font-black text-accent uppercase tracking-widest opacity-80 truncate">Monitored</span>
              </div>
            </Tooltip>
          )}
        </div>

        <div className="flex flex-col items-end shrink-0 min-w-[80px]">
          <div className={cn(
            "text-base md:text-lg lg:text-xl font-black font-mono tracking-tighter leading-none mb-1",
            trade.pnl != null && !isNaN(Number(trade.pnl)) ? pnlClass(trade.pnl) : 'text-dim'
          )}>
            {trade.pnl != null && !isNaN(Number(trade.pnl)) ? fmtUSD(trade.pnl) : '$0.00'}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] md:text-[11px] font-black font-mono text-dim/60 uppercase tracking-widest">
              {Number(trade.rr || 0).toFixed(2)}R
            </span>
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
            <Tooltip content="Stop Loss distance from entry price.">
              <span className="text-red/60 cursor-help border-b border-dotted border-red/20">SL</span>
            </Tooltip>
            <span className="text-[8px] opacity-40">{entry ? ((Math.abs(entry - sl) / entry) * 100).toFixed(1) : 0}%</span>
          </div>
          <span className="text-text/20">Entry</span>
          <div className="flex flex-col items-end">
            <Tooltip content="Target Profit distance from entry price.">
              <span className="text-green/60 cursor-help border-b border-dotted border-green/20">{tp ? 'TP' : '3R'}</span>
            </Tooltip>
            <span className="text-[8px] opacity-40">{tp && entry ? ((Math.abs(tp - entry) / entry) * 100).toFixed(1) : '---'}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

