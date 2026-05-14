import React, { useState } from 'react'
import { C, fmtUSD, pnlColor } from '../lib/theme'
import { sessionAPI } from '../api/client'

export const ActiveTradeCard = ({ trade, onTradeClose }) => {
  const [isClosing, setIsClosing] = useState(false)

  const handleClose = async () => {
    setIsClosing(true)
    try {
      await sessionAPI.closeTrade(trade.symbol)
      if (onTradeClose) {
        onTradeClose(trade.symbol)
      }
    } catch (error) {
      console.error('Failed to close trade:', error)
      alert(`Error closing trade: ${error.message}`)
    } finally {
      setIsClosing(false)
    }
  }

  return (
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
      <button
        onClick={handleClose}
        disabled={isClosing}
        className="mt-2 px-4 py-2 bg-red hover:bg-red/80 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors"
      >
        {isClosing ? 'Closing...' : 'Close Position'}
      </button>
    </div>
)
