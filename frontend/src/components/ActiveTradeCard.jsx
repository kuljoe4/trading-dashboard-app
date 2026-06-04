import React, { useState, useEffect } from 'react'
import { fmtUSD, pnlColor } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { ShieldCheck, AlertCircle } from 'lucide-react'

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

export const ActiveTradeCard = ({ trade, config, onTradeClose }) => {
  const [isClosing, setIsClosing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [error, setError] = useState(null)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    if (confirmClose) {
      const timer = setTimeout(() => setConfirmClose(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [confirmClose])

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  const handleClose = async (e) => {
    e.stopPropagation()
    setConfirmClose(false)
    setIsClosing(true)
    try {
      await sessionAPI.closeTrade(trade.symbol)
      if (onTradeClose) {
        onTradeClose(trade.symbol)
      }
    } catch (error) {
      console.error('Failed to close trade:', error)
      setError(error.message)
    } finally {
      setIsClosing(false)
    }
  }

  const entryTime = trade.entry_ts || trade.entry_time
  const pctChange = trade.entry_price && trade.current_price
    ? Number((trade.current_price - trade.entry_price) / trade.entry_price * 100).toFixed(2)
    : null
  const slDist = trade.entry_price && trade.sl_price
    ? Number((Math.abs(trade.entry_price - trade.sl_price) / trade.entry_price) * 100).toFixed(2)
    : trade.sl_dist != null ? trade.sl_dist : null

  return (
    <div
      onClick={() => setIsExpanded(!isExpanded)}
      className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 w-full flex-1 shadow-sm cursor-pointer hover:border-accent/40 transition-all"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span>{trade.symbol || '---'}</span>
              <span className={trade.direction === 'LONG' ? 'text-green' : 'text-red'}>{trade.direction || '---'}</span>
            </div>
            {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
              <div className="flex items-center gap-1 mt-0.5">
                <ShieldCheck size={10} className="text-accent" />
                <span className="text-[9px] font-bold text-accent uppercase tracking-tighter">Monitored Symbol</span>
              </div>
            )}
          </div>
        </div>
        <div className={`text-lg font-bold ${trade.pnl != null && !isNaN(Number(trade.pnl)) ? pnlColor(trade.pnl) : 'text-dim'}`}>
          {trade.pnl != null && !isNaN(Number(trade.pnl)) ? fmtUSD(trade.pnl) : '$0.00'}
        </div>
      </div>
      
      {isExpanded && (
        <div className="flex flex-col gap-4 text-xs text-dim border-t border-border/20 pt-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Entry</span>
              <span className="text-text font-medium">{trade.entry_price != null ? price(trade.entry_price) : 'None'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Current</span>
              <span className="text-text font-medium">{trade.current_price != null ? price(trade.current_price) : 'None'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">% Change</span>
              <span className={`font-medium ${pctChange != null ? (pctChange >= 0 ? 'text-green' : 'text-red') : ''}`}>
                {pctChange != null ? `${pctChange >= 0 ? '+' : ''}${pctChange}%` : '0.00%'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">SL Dist</span>
              <span className="text-amber font-medium">{slDist != null ? `${slDist}%` : '0.00%'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Opened</span>
              <span className="text-text font-medium">{entryTime ? new Date(entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em]">Duration</span>
              <span className="text-text font-medium">{duration(entryTime)}</span>
            </div>
          </div>

          {/* New Sections */}
          {trade.sl_adjustments?.length > 0 && (
            <div className="pt-2 border-t border-border/20">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em] mb-2 block">SL Adjustments</span>
              <div className="flex flex-wrap gap-2">
                {trade.sl_adjustments.map((adj, i) => (
                  <div key={i} className="px-2 py-1 bg-surface-lighter rounded text-[10px] text-text">
                    {price(adj.prev_sl)} → {price(adj.new_sl)} ({adj.reason})
                  </div>
                ))}
              </div>
            </div>
          )}

          {trade.exit_signals_status && Object.keys(trade.exit_signals_status).length > 0 && (
            <div className="pt-2 border-t border-border/20">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em] mb-2 block">Technical Signals</span>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(trade.exit_signals_status).map(([key, sig]) => (
                  <div key={key} className={`flex items-center justify-between px-2 py-1 rounded text-[10px] ${sig.fired ? 'bg-green/10 text-green' : sig.active ? 'bg-amber/10 text-amber' : 'bg-surface-lighter text-dim'}`}>
                    <span>{sig.label}</span>
                    <span>{sig.value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {trade.live_rr_sequence?.length > 0 && (
            <div className="pt-2 border-t border-border/20">
              <span className="font-semibold text-[11px] uppercase tracking-[0.15em] mb-2 block">RR Ladder</span>
              <div className="flex gap-1">
                {trade.live_rr_sequence.map((rr, i) => (
                  <div key={i} className={`px-2 py-1 rounded text-[10px] ${i <= trade.rr_sequence_index ? 'bg-accent text-white' : 'bg-surface-lighter text-dim'}`}>
                    {rr}R
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-red text-[10px] font-bold uppercase tracking-widest animate-in fade-in slide-in-from-top-1" aria-live="polite">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
      <button
        onClick={handleClose}
        disabled={isClosing}
        aria-label={isClosing ? "Closing position" : error ? `Error: ${error}` : confirmClose ? "Confirm close position" : "Close position"}
        className={`mt-4 px-4 py-3 bg-red hover:bg-red/80 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-all ${confirmClose ? 'animate-pulse ring-2 ring-red ring-offset-2 ring-offset-surface' : ''}`}
      >
        <span aria-live="polite">
          {isClosing ? 'Closing...' : confirmClose ? 'Confirm?' : 'Close Position'}
        </span>
      </button>
    </div>
  )
}

