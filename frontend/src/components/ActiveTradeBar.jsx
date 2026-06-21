import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { fmtUSD, pnlColor, pnlClass, C, safeNum } from '../lib/theme'
import { ArrowLeftRight, ChevronRight, XCircle } from 'lucide-react'
import { cn, Btn } from './ui/primitives'
import { sessionAPI } from '../api/client'

export const ActiveTradeBar = () => {
  const activeTrades = useTradingStore(state => state.activeTrades)
  const sessionActive = useTradingStore(state => state.sessionActive)
  const [closing, setClosing] = React.useState(null)

  if (!sessionActive || activeTrades.length === 0) return null

  const totalPnl = activeTrades.reduce((sum, t) => sum + safeNum(t.pnl), 0)

  const getEstSlPnl = (t) => {
    const sl = Number(t.sl_price || 0)
    const entry = Number(t.entry_price || 0)
    const qty = Number(t.qty || 0)
    if (!sl || !entry || !qty) return 0
    return (sl - entry) * qty * (t.direction === 'LONG' ? 1 : -1)
  }

  const handleClose = async (symbol) => {
    if (closing === symbol) {
      try {
        await sessionAPI.closeTrade(symbol)
        setClosing(null)
      } catch (e) {
        setClosing(null)
      }
    } else {
      setClosing(symbol)
      // Audit Item 44: Feedback on cancel
      setTimeout(() => {
        setClosing(prev => {
          if (prev === symbol) return 'CANCELLED';
          return prev;
        });
        setTimeout(() => setClosing(null), 1000);
      }, 3000);
    }
  }

  return (
    <motion.div
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[45] w-[95%] max-w-[800px]"
    >
      <div className="bg-surface/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent">
            <ArrowLeftRight size={20} />
          </div>
          <div>
            <div className="text-[10px] text-dim font-bold uppercase tracking-widest">Active Positions</div>
            <div className="text-sm font-bold flex items-center gap-2">
              {activeTrades.length} Trades · <span style={{ color: pnlColor(totalPnl) }}>{fmtUSD(totalPnl)}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-x-auto no-scrollbar flex gap-2" role="list">
          {activeTrades.map(t => {
            const slPnl = getEstSlPnl(t)
            return (
              <div key={t.symbol} className="flex flex-col gap-1">
                <button
                  onClick={() => handleClose(t.symbol)}
                  role="listitem"
                  aria-label={closing === t.symbol ? `Confirm closing ${t.symbol} position` : `Close ${t.symbol} position`}
                  className={cn(
                    "px-3 py-2 rounded-xl border text-[10px] font-bold font-mono transition-all flex items-center gap-2 shrink-0 focus-visible:ring-2 focus-visible:ring-red outline-none",
                    closing === t.symbol ? "bg-red border-red text-white scale-95" :
                    closing === 'CANCELLED' ? "bg-amber/20 border-amber/40 text-amber" :
                    "bg-white/5 border-white/10 hover:bg-white/10 hover:border-red/40"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {t.is_reconciliation && <div className="w-1.5 h-1.5 rounded-full bg-amber shadow-[0_0_5px_rgba(245,166,35,0.5)]" />}
                    {t.symbol.replace('USDT', '')}
                  </div>
                  <span style={{ color: closing === t.symbol ? 'white' : pnlColor(t.pnl) }}>
                    {closing === t.symbol ? 'CONFIRM' : closing === 'CANCELLED' ? 'CANCELLED' : fmtUSD(t.pnl)}
                  </span>
                </button>
                <div className="flex items-center justify-center px-1">
                   <span className={cn("text-[8px] font-mono font-bold uppercase tracking-tighter opacity-60", pnlClass(slPnl))}>
                     SL: {fmtUSD(slPnl)}
                   </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
