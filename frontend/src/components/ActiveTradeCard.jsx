import React, { useState } from 'react'
import { fmtUSD, pnlColor } from '../lib/theme'
import { sessionAPI } from '../api/client'

const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '---'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

const timeSince = (entryTs) => {
  if (!entryTs) return 'Just now'
  const now = Date.now()
  const entry = new Date(entryTs).getTime()
  const diff = Math.floor((now - entry) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  const hours = Math.floor(diff / 3600)
  const mins = Math.floor((diff % 3600) / 60)
  return `${hours}h ${mins}m ago`
}

const duration = (entryTs) => {
  if (!entryTs) return '0s'
  const now = Date.now()
  const entry = new Date(entryTs).getTime()
  const diff = Math.floor((now - entry) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

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

  const entryTime = trade.entry_ts || trade.entry_time
  const pctChange = trade.entry_price && trade.current_price
    ? ((trade.current_price - trade.entry_price) / trade.entry_price * 100).toFixed(2)
    : null
  const slDist = trade.entry_price && trade.sl_price
    ? ((Math.abs(trade.entry_price - trade.sl_price) / trade.entry_price) * 100).toFixed(2)
    : null

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 w-full flex-1 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <span>{trade.symbol || '---'}</span>
          <span className={trade.direction === 'LONG' ? 'text-green' : 'text-red'}>{trade.direction || '---'}</span>
        </div>
        <div className={`text-lg font-bold ${trade.pnl != null ? pnlColor(trade.pnl) : 'text-dim'}`}>
          {trade.pnl != null ? fmtUSD(trade.pnl) : '---'}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-dim">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Entry</span>
          <span>{trade.entry_price != null ? price(trade.entry_price) : '---'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Current</span>
          <span>{trade.current_price != null ? price(trade.current_price) : '---'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">% Change</span>
          <span className={pctChange != null ? (pctChange >= 0 ? 'text-green font-bold' : 'text-red font-bold') : ''}>
            {pctChange != null ? `${pctChange >= 0 ? '+' : ''}${pctChange}%` : '---'}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">SL Dist</span>
          <span className="text-amber font-bold">{slDist != null ? `${slDist}%` : '---'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Opened</span>
          <span>{entryTime ? new Date(entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Duration</span>
          <span>{duration(entryTime)}</span>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Time Ago</span>
          <span>{timeSince(entryTime)}</span>
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
