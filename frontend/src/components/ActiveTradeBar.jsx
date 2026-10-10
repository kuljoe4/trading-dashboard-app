import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { fmtUSD, pnlColor, pnlClass, C, safeNum } from '../lib/theme'
import { ArrowLeftRight, ChevronRight, XCircle } from 'lucide-react'
import { cn, Btn, Tooltip } from './ui/primitives'
import { sessionAPI } from '../api/client'
import { ConfirmationModal } from './ConfirmationModal'

import { RefreshCw } from 'lucide-react'

export const ActiveTradeBar = React.memo(() => {
  const { activeTrades, sessionActive, isThrottled, wsStatus, isSyncingOnResume } = useTradingStore(state => ({
    activeTrades: state.activeTrades,
    sessionActive: state.sessionActive,
    isThrottled: state.isThrottled,
    wsStatus: state.wsStatus,
    isSyncingOnResume: state.isSyncingOnResume
  }))
  const [closingSymbol, setClosingSymbol] = React.useState(null)

  if (!sessionActive || activeTrades.length === 0) return null

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = sessionActive && isResuming

  // BOLT OPTIMIZATION: Fused totalPnl calculation using a single-pass O(N) loop
  // Replaces .reduce() to eliminate transient array allocations and callback closures.
  let totalPnl = 0;
  const trades = activeTrades || [];
  for (let i = 0; i < trades.length; i++) {
    totalPnl += safeNum(trades[i].pnl);
  }

  const getEstSlPnl = (t) => {
    const sl = Number(t.sl_price || 0)
    const entry = Number(t.entry_price || 0)
    const qty = Number(t.qty || 0)
    if (!sl || !entry || !qty) return 0
    return (sl - entry) * qty * (t.direction === 'LONG' ? 1 : -1)
  }

  const handleClose = async () => {
    if (!closingSymbol) return
    try {
      await sessionAPI.closeTrade(closingSymbol)
      setClosingSymbol(null)
    } catch (e) {
      console.error('Failed to close trade:', e)
      setClosingSymbol(null)
    }
  }

  return (
    <motion.div
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[45] w-[95%] max-w-[800px]"
    >
      <div className={cn(
        "bg-surface/95 backdrop-blur-xl border border-border rounded-xl p-3 sm:p-4 shadow-xl flex items-center justify-between gap-4 sm:gap-6 transition-colors duration-500 overflow-hidden relative",
        showResumingFeedback ? "border-accent/30 shadow-[0_0_30px_rgba(79,70,229,0.1)]" : "border-border"
      )}>
        {showResumingFeedback && (
           <div className="absolute inset-0 bg-accent/[0.03] animate-pulse pointer-events-none" />
        )}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <div className={cn(
            "w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center transition-colors shrink-0",
            showResumingFeedback ? "bg-accent text-white animate-pulse" : "bg-accent/15 text-accent"
          )}>
            {showResumingFeedback ? <RefreshCw size={18} className="animate-spin" /> : <ArrowLeftRight size={18} />}
          </div>
          <div>
            <div className="text-[9.5px] text-dim font-bold uppercase tracking-wider flex items-center gap-1.5">
               {showResumingFeedback ? 'Resuming Feed...' : 'Active Positions'}
            </div>
            <div className={cn("text-xs sm:text-sm font-bold font-mono tabular-nums flex items-center gap-2 transition-all", showResumingFeedback && "opacity-40 blur-[1px]")}>
              {activeTrades.length} Trades · <span style={{ color: pnlColor(totalPnl) }}>{fmtUSD(totalPnl)}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-x-auto no-scrollbar flex gap-2" role="list">
          {(activeTrades || []).map(t => {
            const slPnl = getEstSlPnl(t)
            return (
              <div key={t.symbol} className="flex flex-col gap-1" role="listitem">
                <Tooltip content={`Click to liquidate ${t.symbol} position`}>
                  <button
                    type="button"
                    onClick={() => setClosingSymbol(t.symbol)}
                    aria-label={`Close ${t.symbol} ${t.direction || ''} position (${fmtUSD(t.pnl)})`}
                    className={cn(
                      "px-3 py-1.5 rounded-lg border text-[10px] font-bold font-mono transition-all flex items-center gap-2 shrink-0 focus-visible:ring-2 focus-visible:ring-red outline-none bg-surface-elevated border-border hover:border-red/40 cursor-pointer"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {t.is_reconciliation && <div className="w-1.5 h-1.5 rounded-full bg-amber shadow-[0_0_5px_rgba(245,166,35,0.5)]" />}
                      {t.symbol.replace('USDT', '')}
                    </div>
                    <span style={{ color: pnlColor(t.pnl) }}>
                      {fmtUSD(t.pnl)}
                    </span>
                  </button>
                </Tooltip>
                <div className="flex items-center justify-center px-1">
                  <Tooltip content={`Estimated Stop Loss PnL: ${fmtUSD(slPnl)}`}>
                    <span
                      tabIndex={0}
                      aria-label={`Estimated Stop Loss PnL for ${t.symbol}: ${fmtUSD(slPnl)}`}
                      className={cn("text-[8px] font-mono font-bold uppercase tracking-tighter opacity-60 cursor-help focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none rounded-sm px-0.5", pnlClass(slPnl))}
                    >
                      SL: {fmtUSD(slPnl)}
                    </span>
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!closingSymbol}
        onClose={() => setClosingSymbol(null)}
        onConfirm={handleClose}
        title="Confirm Liquidation"
        message={`Are you sure you want to immediately close your ${closingSymbol} position at market price?`}
        variant="danger"
        confirmText="Confirm"
      />
    </motion.div>
  )
}
