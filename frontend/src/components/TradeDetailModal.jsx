import React, { useState, useEffect, useMemo, memo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ShieldCheck, Clock, ArrowUpRight, ArrowDownRight, Activity, Zap, Info, ShieldAlert } from 'lucide-react'
import { fmtUSD, pnlColor } from '../lib/theme'
import { Btn, cn, CopyButton, Tooltip, VisuallyHidden } from './ui/primitives'

/**
 * Performance-optimized price formatter.
 */
const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '---'
  const n = Number(value)
  if (n >= 100) return `$${n.toFixed(2)}`
  return `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

/**
 * Human-readable duration formatter.
 */
const formatDuration = (ms) => {
  if (ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)

  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

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

export const TradeDetailModal = memo(({ trade, isOpen, onClose, onTradeClose }) => {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!isOpen) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isOpen])

  const duration = useMemo(() => {
    if (!trade?.entry_ts) return '---'
    const start = new Date(trade.entry_ts).getTime()
    return formatDuration(now - start)
  }, [trade?.entry_ts, now])

  const { isLong, pnlPct, progress, entry, mark, sl, tp, qtyFormatted, riskFormatted } = useMemo(() => {
    if (!trade) return {}
    const isLong = trade.direction === 'LONG'
    const entry = Number(trade.entry_price || 0)
    const mark = Number(trade.current_price || trade.mark_price || 0)
    const sl = Number(trade.sl_price || 0)
    const tp = Number(trade.tp_price || trade.tp || 0)

    const pnlPct = trade.pnl_pct ?? (entry ? ((mark - entry) / entry) * 100 * (isLong ? 1 : -1) : 0)

    let progress = 50
    if (entry && mark && sl && tp) {
      const totalRange = isLong ? (tp - sl) : (sl - tp)
      const currentFromSl = isLong ? (mark - sl) : (sl - mark)
      progress = Math.max(0, Math.min(100, (currentFromSl / totalRange) * 100))
    }

    const qtyVal = Number(trade.qty)
    const qtyFormatted = Number.isFinite(qtyVal) ? qtyVal.toFixed(4) : '0.0000'
    const riskFormatted = fmtUSD(trade.risk_usdt || 0)

    return { isLong, pnlPct, progress, entry, mark, sl, tp, qtyFormatted, riskFormatted }
  }, [trade?.direction, trade?.entry_price, trade?.current_price, trade?.mark_price, trade?.sl_price, trade?.tp_price, trade?.tp, trade?.pnl_pct, trade?.qty, trade?.risk_usdt])

  if (!trade) return null

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] animate-in fade-in duration-300" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[90vh] overflow-y-auto no-scrollbar bg-surface/95 border border-border/50 rounded-[2.5rem] p-8 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl z-[101] animate-in fade-in zoom-in-95 duration-300 focus:outline-none">
          <VisuallyHidden>
            <Dialog.Description>
              Detailed view of the active trade for {trade.symbol}, including P&L, duration, and exit signals.
            </Dialog.Description>
          </VisuallyHidden>
          <Dialog.Title className="flex items-center justify-between mb-8 sticky -top-8 bg-surface/10 backdrop-blur-sm z-20 pb-4 pt-4">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-14 h-14 rounded-3xl flex items-center justify-center shadow-2xl transition-transform duration-500 hover:scale-105",
                isLong ? "bg-green/10 text-green shadow-green/20" : "bg-red/10 text-red shadow-red/20"
              )}>
                {isLong ? <ArrowUpRight size={28} /> : <ArrowDownRight size={28} />}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black tracking-tighter">{trade.symbol}</span>
                  <CopyButton value={trade.symbol} className="opacity-40 hover:opacity-100" />
                </div>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]">
                  <span className={cn("px-2 py-0.5 rounded-full", isLong ? 'bg-green/10 text-green' : 'bg-red/10 text-red')}>
                    {trade.direction}
                  </span>
                  <span className="text-dim/30">•</span>
                  <span className="text-dim flex items-center gap-1.5">
                    <Clock size={12} className="text-accent" /> {duration}
                  </span>
                </div>
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="p-3 hover:bg-white/5 rounded-2xl transition-all text-dim hover:text-text active:scale-90" aria-label="Close details">
                <X size={20} />
              </button>
            </Dialog.Close>
          </Dialog.Title>

          <div className="flex flex-col gap-10">
            {/* PnL Hero Section */}
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-accent/20 to-purple/20 rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-1000" />
              <div className="relative bg-white/[0.03] border border-white/[0.05] rounded-[2rem] p-8 flex flex-col items-center text-center shadow-inner overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Activity size={80} />
                </div>
                <span className="text-[11px] font-black text-dim uppercase tracking-[0.3em] mb-3">Unrealized Performance</span>
                <div className={cn("text-5xl font-black font-mono tracking-tighter mb-2", pnlColor(trade.pnl))}>
                  {fmtUSD(trade.pnl)}
                </div>
                <div className={cn("px-4 py-1.5 rounded-full text-xs font-black font-mono shadow-sm", trade.pnl >= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red")}>
                  {pnlPct >= 0 ? '▲' : '▼'} {Math.abs(pnlPct).toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Price Runway */}
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black text-red uppercase tracking-widest flex items-center gap-1">
                    <ShieldAlert size={10} /> Stop Loss
                  </span>
                  <span className="font-mono text-xs font-bold text-dim">{price(sl)}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] font-black text-green uppercase tracking-widest flex items-center gap-1">
                    Take Profit <Zap size={10} fill="currentColor" />
                  </span>
                  <span className="font-mono text-xs font-bold text-dim">{tp ? price(tp) : 'TRAILED'}</span>
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
                <div className="bg-surface-lighter px-3 py-1 rounded-lg border border-border/50">
                  <span className="text-[10px] font-black text-dim uppercase tracking-widest">Entry: </span>
                  <span className="font-mono text-[11px] font-bold text-text/80">{price(entry)}</span>
                </div>
              </div>
            </div>

            {/* Core Metrics Grid */}
            <div className="grid grid-cols-2 gap-y-8 gap-x-6">
              <Metric label="Current Mark" value={price(trade.current_price)} tooltip="The latest market price from the exchange feed." />
              <Metric label="Position Qty" value={`${qtyFormatted} ${trade.symbol.replace('USDT', '')}`} tooltip="The total amount of asset currently held in this position." />
              <Metric label="Equity At Risk" value={riskFormatted} tooltip="Total capital currently exposed based on the entry price and SL distance." />
              <Metric label="Initial Stop" value={price(trade.initial_sl)} tooltip="The original stop-loss price set at the moment of entry." />
            </div>

            {/* Signals & Adjustments */}
            {(trade.sl_adjustments?.length > 0 || (trade.exit_signals_status && Object.keys(trade.exit_signals_status).length > 0)) && (
              <div className="space-y-6 pt-8 border-t border-border/20">
                {trade.exit_signals_status && Object.keys(trade.exit_signals_status).length > 0 && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-500">
                    <div className="flex items-center justify-between mb-4">
                       <span className="text-[10px] font-black text-dim uppercase tracking-[0.2em] flex items-center gap-2">
                        <Activity size={14} className="text-accent" /> Active Exit Signals
                      </span>
                      <span className="text-[9px] font-bold text-dim/40 uppercase">OR LOGIC</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(trade.exit_signals_status).map(([key, sig]) => (
                        <div key={key} className={cn(
                          "px-4 py-3 rounded-2xl text-[10px] font-bold flex flex-col gap-1 border transition-all duration-300",
                          sig.fired ? 'bg-green/10 border-green/30 text-green shadow-[0_0_15px_rgba(0,229,160,0.1)]' :
                          sig.active ? 'bg-amber/10 border-amber/30 text-amber' :
                          'bg-white/[0.02] border-border/40 text-dim'
                        )}>
                          <span className="uppercase tracking-widest opacity-60">{sig.label}</span>
                          <span className="font-mono text-sm">{Number(sig.value || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {trade.sl_adjustments?.length > 0 && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-700">
                    <span className="text-[10px] font-black text-dim uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                      <ShieldCheck size={14} className="text-accent" /> Risk Mitigation Log
                    </span>
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
            )}
            
            {/* Footer Action */}
            <div className="flex gap-4 pt-6">
              <button
                onClick={onClose}
                className="flex-1 py-4 px-6 rounded-2xl bg-white/5 border border-white/5 text-[11px] font-black uppercase tracking-[0.2em] text-dim hover:text-text hover:bg-white/10 transition-all active:scale-95"
              >
                Dismiss
              </button>
              <button
                onClick={() => onTradeClose(trade.symbol)}
                className="flex-[1.5] py-4 px-6 rounded-2xl bg-red/10 border border-red/20 text-[11px] font-black uppercase tracking-[0.2em] text-red hover:bg-red/20 shadow-lg shadow-red/5 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <ShieldAlert size={16} /> Force Liquidation
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})
TradeDetailModal.displayName = 'TradeDetailModal'
