import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ShieldCheck } from 'lucide-react'
import { fmtUSD, pnlColor } from '../lib/theme'
import { Btn, cn, CopyButton } from './ui/primitives'

const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '---'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

export const TradeDetailModal = ({ trade, isOpen, onClose, onTradeClose }) => {
  if (!trade) return null

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-surface border border-border rounded-3xl p-8 shadow-2xl z-[101] animate-in fade-in zoom-in-95">
          
          <Dialog.Title className="flex items-center justify-between mb-6">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-lg font-bold">{trade.symbol}</span>
                <CopyButton value={trade.symbol} className="opacity-70 hover:opacity-100" />
              </div>
              <span className={trade.direction === 'LONG' ? 'text-green' : 'text-red'}>{trade.direction}</span>
            </div>
            <Dialog.Close asChild>
              <Btn variant="ghost" className="!p-2"><X size={16} /></Btn>
            </Dialog.Close>
          </Dialog.Title>

          <div className="flex flex-col gap-6">
            {/* PnL Header */}
            <div className={cn("text-3xl font-bold font-mono tracking-tight", pnlColor(trade.pnl))}>
              {fmtUSD(trade.pnl)}
            </div>

            {/* Core Metrics Grid */}
            <div className="grid grid-cols-2 gap-4">
              <Metric label="Entry Price" value={price(trade.entry_price)} />
              <Metric label="Current Price" value={price(trade.current_price)} />
              <Metric label="SL Type" value={trade.sl_type === 'pct' ? 'Percentage' : 'Fixed Price'} />
              <Metric label="SL Value" value={trade.sl_price ? price(trade.sl_price) : '---'} />
            </div>

            {/* SL Adjustments (if dynamic) */}
            {trade.sl_adjustments?.length > 0 && (
              <div className="pt-4 border-t border-border/20">
                <span className="text-[11px] font-bold text-dim uppercase tracking-widest mb-3 block">SL History</span>
                <div className="flex flex-col gap-2">
                  {trade.sl_adjustments.map((adj, i) => (
                    <div key={i} className="flex justify-between text-[11px] bg-surface-lighter p-2 rounded">
                      <span className="font-mono">{price(adj.prev_sl)} → {price(adj.new_sl)}</span>
                      <span className="text-dim">{adj.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Technical Signals */}
            {trade.exit_signals_status && Object.keys(trade.exit_signals_status).length > 0 && (
              <div className="pt-4 border-t border-border/20">
                <span className="text-[11px] font-bold text-dim uppercase tracking-widest mb-3 block">Technical Signals</span>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(trade.exit_signals_status).map(([key, sig]) => (
                    <div key={key} className={cn("px-2 py-1.5 rounded text-[10px] font-bold flex items-center justify-between", sig.fired ? 'bg-green/10 text-green' : sig.active ? 'bg-amber/10 text-amber' : 'bg-surface-lighter text-dim')}>
                      <span>{sig.label}</span>
                      <span>{sig.value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Footer Action */}
            <Btn variant="danger" className="w-full mt-4" onClick={() => onTradeClose(trade.symbol)}>
              Close Position
            </Btn>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const Metric = ({ label, value }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[10px] font-bold text-dim uppercase tracking-widest">{label}</span>
    <span className="font-mono text-sm">{value}</span>
  </div>
)
