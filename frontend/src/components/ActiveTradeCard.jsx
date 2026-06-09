import React, { useState, useEffect } from 'react'
import { cn, Tooltip } from './ui/primitives'
import { fmtUSD, pnlColor, safeNum } from '../lib/theme'
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

  // Calculate progress relative to SL and TP
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

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 w-full shadow-sm cursor-pointer hover:border-accent/40 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none active:scale-[0.98]"
      aria-label={`View details for ${trade.symbol} ${trade.direction} trade, ${fmtUSD(trade.pnl)} P&L, ${Number(trade.rr || 0).toFixed(2)} RR`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5 text-xs md:text-sm font-bold">
            <span className="font-mono truncate">{trade.symbol || '---'}</span>
            <span className={cn("text-[9px] md:text-xs", isLong ? 'text-green' : 'text-red')}>{trade.direction || '---'}</span>
          </div>
          {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
            <div className="flex items-center gap-1">
              <ShieldCheck size={8} className="text-accent" />
              <span className="text-[8px] font-bold text-accent uppercase tracking-tighter">Monitored</span>
            </div>
          )}
        </div>

        <div className="flex flex-row md:flex-col items-center md:items-end gap-2 md:gap-0.5">
          <div className={cn(
            "text-xs md:text-lg font-bold font-mono",
            trade.pnl != null && !isNaN(Number(trade.pnl)) ? pnlColor(trade.pnl) : 'text-dim'
          )}>
            {trade.pnl != null && !isNaN(Number(trade.pnl)) ? fmtUSD(trade.pnl) : '$0.00'}
          </div>
          <div className="text-[8px] md:text-[10px] font-bold font-mono text-dim uppercase tracking-wider bg-white/5 md:bg-transparent px-1.5 py-0.5 md:p-0 rounded md:rounded-none">
            {Number(trade.rr || 0).toFixed(2)}R
          </div>
          {(trade.realized_fee > 0 || trade.funding_fee !== 0) && (
            <Tooltip content={`Commission: -${fmtUSD(trade.realized_fee || 0)} | Funding: ${trade.funding_fee > 0 ? '-' : '+'}${fmtUSD(Math.abs(trade.funding_fee || 0))}`}>
              <div className="text-[7px] md:text-[8px] font-bold font-mono text-red/50 uppercase tracking-tighter cursor-help border-b border-dotted border-red/20">
                -{fmtUSD(safeNum(trade.realized_fee) + safeNum(trade.funding_fee))} Fees
              </div>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Mini Price Runway */}
      <div className="space-y-1.5">
        <div
          className="h-1.5 w-full bg-border rounded-full overflow-hidden relative"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label={`Trade progress from SL to TP: ${Math.round(progress)}%`}
        >
          {/* Entry Point Marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-text/30 z-10"
            style={{ left: '50%' }}
            aria-hidden="true"
          />
          {/* Progress Bar */}
          <div
            className={cn(
              "h-full transition-all duration-500",
              trade.pnl >= 0 ? "bg-green" : "bg-red"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[9px] font-bold text-dim uppercase tracking-widest font-mono">
          <div className="flex flex-col">
            <span>{isLong ? 'SL' : 'TP'}</span>
            <span className="text-[8px] opacity-60">{entry ? ((Math.abs(mark - sl) / entry) * 100).toFixed(1) : 0}%</span>
          </div>
          <span className="text-text/40">Entry</span>
          <span>{isLong ? 'TP' : 'SL'}</span>
        </div>
      </div>
    </motion.div>
  )
}

