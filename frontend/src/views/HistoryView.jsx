import React, { useEffect } from 'react'
import { fmtUSD, pnlColor } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { useTradingStore } from '../store/trading'
import { SectionLabel, StatCard, cn } from '../components/ui/primitives'
import { motion, AnimatePresence } from 'framer-motion'
import { History as HistoryIcon, ArrowLeftRight, TrendingUp, TrendingDown, Clock, ShieldCheck } from 'lucide-react'

const price = (value) => {
  if (value == null) return 'None'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

export const HistoryView = () => {
  const { tradeHistory, updateStats, sessionSummary } = useTradingStore()
  const totalPnl = tradeHistory.reduce((sum, trade) => sum + (trade.pnl || 0), 0)
  const wins = tradeHistory.filter((trade) => (trade.pnl || 0) > 0).length
  const winRate = tradeHistory.length ? Math.round((wins / tradeHistory.length) * 100) : 0
  const avgPnl = tradeHistory.length ? totalPnl / tradeHistory.length : 0

  useEffect(() => {
    sessionAPI.history()
      .then((res) => updateStats({ tradeHistory: res.data.trades || [] }))
      .catch(() => {})
  }, [updateStats])

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4 mb-10">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <HistoryIcon size={24} className="text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Trade History</h1>
          <p className="text-[11px] text-dim font-bold uppercase tracking-widest mt-1">Verified records of all closed positions</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Total Performance" value={fmtUSD(totalPnl)} color={totalPnl >= 0 ? "text-green" : "text-red"} />
        <StatCard label="Win Rate" value={`${winRate}%`} color="text-accent" subValue={`${wins} Wins / ${tradeHistory.length - wins} Losses`} />
        <StatCard label="Average Trade" value={fmtUSD(avgPnl)} color={avgPnl >= 0 ? "text-green" : "text-red"} />
        <StatCard label="Record Count" value={tradeHistory.length.toString()} color="text-text" />
      </div>

      {sessionSummary && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-2xl mb-10 bg-accent/5 border border-accent/20 flex items-center gap-4 shadow-sm"
        >
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
            <Clock size={20} className="text-accent" />
          </div>
          <div>
            <div className="text-[11px] text-accent font-bold uppercase tracking-widest mb-0.5">Session Summary</div>
            <div className="text-sm font-medium">
              Last session ended with <span className={cn("font-bold", sessionSummary.totalPnl >= 0 ? "text-green" : "text-red")}>{fmtUSD(sessionSummary.totalPnl)}</span> across <span className="font-bold text-text">{sessionSummary.tradeCount}</span> positions.
            </div>
          </div>
        </motion.div>
      )}

      <div>
        <SectionLabel className="mb-6">Closed Positions</SectionLabel>
        {tradeHistory.length === 0 ? (
          <div className="bg-surface/20 border border-border border-dashed rounded-2xl p-20 text-center">
            <div className="text-sm font-bold text-dim uppercase tracking-widest flex flex-col items-center gap-4">
              <ArrowLeftRight size={40} className="opacity-10" />
              No trade records found in this database.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {tradeHistory.map((trade, i) => {
                const isWin = (trade.pnl || 0) >= 0
                return (
                  <motion.div
                    layout
                    key={`${trade.id || trade.symbol}-${i}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="grid grid-cols-2 md:grid-cols-5 items-center gap-4 p-5 bg-surface border border-border rounded-2xl hover:border-border-hover transition-colors shadow-sm group"
                  >
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold font-mono tracking-tight">{trade.symbol}</span>
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase", trade.direction?.toLowerCase() === 'long' ? "text-green border-green/20 bg-green/5" : "text-red border-red/20 bg-red/5")}>
                          {trade.direction}
                        </span>
                      </div>
                      <span className="text-[10px] text-dim font-mono font-medium">{trade.id?.substring(0, 8)}</span>
                    </div>

                    <div className="hidden md:flex flex-col">
                      <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5">
                        <TrendingUp size={10} /> Entry
                      </span>
                      <span className="text-xs font-bold font-mono">{price(trade.entry_price)}</span>
                    </div>

                    <div className="hidden md:flex flex-col">
                      <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5">
                        <TrendingDown size={10} /> Exit
                      </span>
                      <span className="text-xs font-bold font-mono">{price(trade.exit_price)}</span>
                    </div>

                    <div className="hidden md:flex flex-col">
                      <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5">
                        <ShieldCheck size={10} /> Exit Reason
                      </span>
                      <span className="text-xs font-bold uppercase tracking-tight text-dim/80">{trade.exit_reason || 'Manual'}</span>
                    </div>

                    <div className="flex flex-col items-end">
                      <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Result</span>
                      <span className={cn("text-base font-bold font-mono tracking-tighter", isWin ? "text-green" : "text-red")}>
                        {isWin ? '+' : ''}{fmtUSD(trade.pnl || 0)}
                      </span>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
