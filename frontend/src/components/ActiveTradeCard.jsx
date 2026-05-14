import React from 'react'
import { C, fmtUSD, pnlColor } from '../lib/theme'

export const ActiveTradeCard = ({ trade }) => (
  <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 w-full flex-1 shadow-sm">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
        <span>{trade.symbol || '---'}</span>
        <span className={trade.direction === 'LONG' ? 'text-green' : 'text-red'}>{trade.direction || '---'}</span>
      </div>
      <div className={`text-lg font-bold ${pnlColor(trade.pnl)}`}>
        {fmtUSD(trade.pnl)}
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-dim">
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Entry</span>
        <span>{fmtUSD(trade.entry_price)}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Qty</span>
        <span>{trade.qty}</span>
      </div>
    </div>
  </div>
)
