import React, { useState, useEffect } from 'react'
import { fmtUSD, pnlColor } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { ShieldCheck } from 'lucide-react'

export const ActiveTradeCard = ({ trade, config, onTradeClose, onClick }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${trade.symbol} ${trade.direction} trade`}
      className="bg-surface border border-border rounded-2xl p-5 flex items-center justify-between w-full shadow-sm cursor-pointer hover:border-accent/40 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm font-bold">
          <span>{trade.symbol || '---'}</span>
          <span className={trade.direction === 'LONG' ? 'text-green' : 'text-red'}>{trade.direction || '---'}</span>
        </div>
        {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
          <div className="flex items-center gap-1 mt-0.5">
            <ShieldCheck size={10} className="text-accent" />
            <span className="text-[9px] font-bold text-accent uppercase tracking-tighter">Monitored</span>
          </div>
        )}
      </div>
      
      <div className={`text-lg font-bold ${trade.pnl != null && !isNaN(Number(trade.pnl)) ? pnlColor(trade.pnl) : 'text-dim'}`}>
        {trade.pnl != null && !isNaN(Number(trade.pnl)) ? fmtUSD(trade.pnl) : '$0.00'}
      </div>
    </div>
  )
}

