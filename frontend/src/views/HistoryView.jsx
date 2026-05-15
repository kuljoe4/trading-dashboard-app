import React, { useEffect, useMemo, useState } from 'react'
import { fmtUSD, pnlColor } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { useTradingStore } from '../store/trading'
import { SectionLabel, StatCard, cn, PaperBadge } from '../components/ui/primitives'
import { motion, AnimatePresence } from 'framer-motion'
import { History as HistoryIcon, ArrowLeftRight, TrendingUp, TrendingDown, Clock, ShieldCheck, LayoutDashboard, Settings as SettingsIcon, ChevronRight, ChevronDown, Zap, BarChart3, LineChart, Target } from 'lucide-react'
import { Sidebar, BottomNav } from '../components/Navigation'
import { EquityCurve, TODPerformance } from '../components/Analytics'

const price = (value) => {
  if (value == null) return 'None'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

const SessionGroup = ({ session, trades }) => {
  const [expanded, setExpanded] = useState(false)
  const pnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0)
  const wins = trades.filter(t => (t.pnl || 0) > 0).length
  const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden mb-4 shadow-sm transition-all hover:border-border-hover">
      <div
        onClick={() => setExpanded(!expanded)}
        className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer select-none bg-surface/30"
      >
        <div className="flex items-center gap-4">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border transition-colors", expanded ? "bg-accent/10 border-accent/20" : "bg-surface border-border")}>
            {expanded ? <ChevronDown size={20} className="text-accent" /> : <ChevronRight size={20} className="text-dim" />}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold tracking-tight">Session {session.id.substring(0, 8)}</span>
              {session.paperMode && <PaperBadge />}
            </div>
            <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex items-center gap-2">
              <Clock size={10} /> {new Date(session.startTime).toLocaleDateString()} · {new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 md:gap-10">
          <div className="flex flex-col">
            <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Config</span>
            <span className="text-xs font-bold text-dim uppercase tracking-tight flex items-center gap-1.5">
              <Zap size={10} className="text-accent" />
              {session.config?.scan_interval} · {session.config?.scan_pct_threshold}% · {session.config?.risk_pct_per_trade}%
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Win Rate</span>
            <span className="text-xs font-bold font-mono">{winRate}% ({wins}/{trades.length})</span>
          </div>
          <div className="flex flex-col items-end min-w-[100px]">
            <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Session P&L</span>
            <span className={cn("text-base font-bold font-mono tracking-tighter", pnl >= 0 ? "text-green" : "text-red")}>
              {fmtUSD(pnl)}
            </span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="p-4 space-y-2 bg-background/30">
              {trades.length === 0 ? (
                <div className="py-8 text-center text-[11px] text-dim font-bold uppercase tracking-widest">No trades recorded for this session</div>
              ) : (
                trades.map((trade, i) => {
                  const isWin = (trade.pnl || 0) >= 0
                  return (
                    <div key={trade.id} className="flex items-center justify-between p-4 bg-surface border border-border/60 rounded-xl">
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-bold font-mono">{trade.symbol}</span>
                            <span className={cn("text-[8px] font-bold px-1 py-0 rounded border uppercase", trade.direction?.toLowerCase() === 'long' ? "text-green border-green/20" : "text-red border-red/20")}>
                              {trade.direction}
                            </span>
                          </div>
                          <span className="text-[9px] text-dim font-mono">{new Date(trade.entry_ts || trade.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                      <div className="flex gap-8 text-right items-center">
                        <div className="hidden sm:flex flex-col">
                          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Reason</span>
                          <span className="text-[10px] font-bold text-dim/80">{trade.exit_reason || 'Manual'}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Result</span>
                          <span className={cn("text-xs font-bold font-mono", isWin ? "text-green" : "text-red")}>
                            {fmtUSD(trade.pnl || 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const PAGE_SIZE = 5

export const HistoryView = () => {
  const { tradeHistory, updateStats, sessionSummary, sidebarCollapsed, sessionList, fetchSessions, analytics } = useTradingStore()
  const [fullAnalytics, setFullAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [visibleSessions, setVisibleSessions] = useState(PAGE_SIZE)

  const allSessionsWithTrades = useMemo(() => {
    return sessionList.map(session => ({
      ...session,
      trades: tradeHistory.filter(t => t.sessionId === session.id)
    })).sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
  }, [sessionList, tradeHistory])

  const sessionsToRender = useMemo(() => {
    return allSessionsWithTrades.slice(0, visibleSessions)
  }, [allSessionsWithTrades, visibleSessions])

  const orphans = useMemo(() => {
    const sessionIds = new Set(sessionList.map(s => s.id))
    return tradeHistory.filter(t => !t.sessionId || !sessionIds.has(t.sessionId))
  }, [sessionList, tradeHistory])

  const totalPnl = fullAnalytics?.cumulativePnL?.length ? fullAnalytics.cumulativePnL[fullAnalytics.cumulativePnL.length - 1].pnl : tradeHistory.reduce((sum, trade) => sum + (trade.pnl || 0), 0)
  const totalTrades = fullAnalytics?.totalTrades || tradeHistory.length
  const wins = fullAnalytics ? Math.round((fullAnalytics.overallWinRate / 100) * totalTrades) : tradeHistory.filter((trade) => (trade.pnl || 0) > 0).length
  const winRate = fullAnalytics ? Math.round(fullAnalytics.overallWinRate) : (tradeHistory.length ? Math.round((wins / tradeHistory.length) * 100) : 0)
  const avgPnl = totalTrades ? totalPnl / totalTrades : 0

  useEffect(() => {
    setLoading(true)
    Promise.all([
      sessionAPI.history(),
      sessionAPI.analytics(),
      fetchSessions()
    ]).then(([historyRes, analyticsRes]) => {
      updateStats({ tradeHistory: historyRes.data.trades || [] })
      setFullAnalytics(analyticsRes.data)
    }).finally(() => setLoading(false))
  }, [updateStats, fetchSessions])

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
    )}>
      <Sidebar />
      <div className="max-w-[1200px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 lg:pb-8">
        <div className="flex items-center gap-4 mb-10 bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <HistoryIcon size={24} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Trade History</h1>
            <p className="text-[11px] text-dim font-bold uppercase tracking-widest mt-1">Verified records of all closed positions</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Performance" value={fmtUSD(totalPnl)} color={totalPnl >= 0 ? "text-green" : "text-red"} />
          <StatCard label="Win Rate" value={`${winRate}%`} color="text-accent" subValue={`${wins} Wins / ${totalTrades - wins} Losses`} />
          <StatCard
            label="Max Drawdown"
            value={fullAnalytics ? fmtUSD(-fullAnalytics.maxDrawdown) : (analytics?.maxDrawdown ? fmtUSD(-analytics.maxDrawdown) : '$0.00')}
            color="text-red"
            subValue={fullAnalytics ? `${fullAnalytics.maxDrawdownPct.toFixed(1)}% Peak-to-Valley` : (analytics?.maxDrawdownPct ? `${analytics.maxDrawdownPct.toFixed(1)}%` : '0%')}
          />
          <StatCard label="Average Trade" value={fmtUSD(avgPnl)} color={avgPnl >= 0 ? "text-green" : "text-red"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-6 shadow-sm overflow-hidden relative">
             <EquityCurve data={fullAnalytics?.cumulativePnL || analytics?.cumulativePnL || []} />
          </div>
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
             <TODPerformance data={fullAnalytics?.timeOfDay || []} />
          </div>
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
          <SectionLabel className="mb-6">Session-Centric Records</SectionLabel>
          {allSessionsWithTrades.length === 0 && orphans.length === 0 ? (
            <div className="bg-surface/20 border border-border border-dashed rounded-2xl p-20 text-center">
              <div className="text-sm font-bold text-dim uppercase tracking-widest flex flex-col items-center gap-4">
                <ArrowLeftRight size={40} className="opacity-10" />
                No trade records found in this database.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {sessionsToRender.map((s, i) => (
                  <motion.div
                    layout
                    key={s.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.5) }}
                  >
                    <SessionGroup session={s} trades={s.trades} />
                  </motion.div>
                ))}

                {visibleSessions < allSessionsWithTrades.length && (
                   <motion.div
                     initial={{ opacity: 0 }}
                     animate={{ opacity: 1 }}
                     className="py-10 flex justify-center"
                   >
                      <button
                        onClick={() => setVisibleSessions(v => v + PAGE_SIZE)}
                        className="px-8 py-3 bg-surface border border-border rounded-xl text-[11px] font-bold uppercase tracking-widest text-dim hover:text-accent hover:border-accent transition-all active:scale-95 shadow-sm"
                      >
                        Load More Sessions
                      </button>
                   </motion.div>
                )}

                {orphans.length > 0 && (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <SectionLabel className="mt-10 mb-6">Uncategorized Trades</SectionLabel>
                    <div className="space-y-3">
                      {orphans.map((trade, i) => {
                        const isWin = (trade.pnl || 0) >= 0
                        return (
                          <div
                            key={trade.id || i}
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
                              <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Entry</span>
                              <span className="text-xs font-bold font-mono">{price(trade.entry_price)}</span>
                            </div>
                            <div className="hidden md:flex flex-col">
                              <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Exit</span>
                              <span className="text-xs font-bold font-mono">{price(trade.exit_price)}</span>
                            </div>
                            <div className="hidden md:flex flex-col">
                              <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Reason</span>
                              <span className="text-xs font-bold uppercase tracking-tight text-dim/80">{trade.exit_reason || 'Manual'}</span>
                            </div>
                            <div className="flex flex-col items-end min-w-[100px]">
                              <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Result</span>
                              <span className={cn("text-base font-bold font-mono tracking-tighter", isWin ? "text-green" : "text-red")}>
                                {fmtUSD(trade.pnl || 0)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
        <BottomNav />
      </div>
    </div>
  )
}
