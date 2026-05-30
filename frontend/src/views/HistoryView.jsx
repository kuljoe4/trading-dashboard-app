import React, { useEffect, useMemo, useState } from 'react'
import { fmtUSD, pnlColor } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { useTradingStore } from '../store/trading'
import { SectionLabel, StatCard, cn, PaperBadge, Tooltip } from '../components/ui/primitives'
import { motion, AnimatePresence } from 'framer-motion'
import { History as HistoryIcon, ArrowLeftRight, TrendingUp, TrendingDown, Clock, ShieldCheck, LayoutDashboard, Settings as SettingsIcon, ChevronRight, ChevronDown, Zap, BarChart3, LineChart, Target } from 'lucide-react'
import { Sidebar, BottomNav } from '../components/Navigation'
import { EquityCurve, TODPerformance } from '../components/Analytics'

const price = (value) => {
  if (value == null) return 'None'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

const strategyLabel = (item = {}) => item.strategy_label || item.strategyLabel || item.config?.strategy_label || 'Momentum Strategy'

const buildCurve = (trades = []) => {
  let pnl = 0
  return [...trades].reverse().map((trade) => {
    pnl += Number(trade.pnl || 0)
    return { ts: trade.exit_ts || trade.entry_ts || trade.createdAt, pnl }
  })
}

const TradeItem = React.memo(({ trade, session = {} }) => {
  const isWin = (trade.pnl || 0) >= 0
  const durationMs = trade.exit_ts && trade.entry_ts ? new Date(trade.exit_ts).getTime() - new Date(trade.entry_ts).getTime() : 0
  const durationStr = durationMs ? (durationMs / 60000).toFixed(1) + 'm' : 'N/A'

  return (
    <div className="flex items-center justify-between p-4 bg-surface border border-border/60 rounded-xl hover:border-border-hover transition-colors group/trade">
      <div className="flex items-center gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-bold font-mono">{trade.symbol}</span>
            <a href={`#/history?session=${trade.sessionId || session?.id}`} className="text-[8px] font-bold px-1.5 py-0.5 rounded border border-accent/20 bg-accent/10 text-accent uppercase">
              {strategyLabel(trade)}
            </a>
            <span className={cn("text-[8px] font-bold px-1 py-0 rounded border uppercase", trade.direction?.toLowerCase() === 'long' ? "text-green border-green/20" : "text-red border-red/20")}>
              {trade.direction}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-dim font-mono">{new Date(trade.entry_ts || trade.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-[9px] text-dim/40 font-mono">·</span>
            <Tooltip content={
              <div className="flex flex-col gap-1">
                <div>Entry: {new Date(trade.entry_ts || trade.createdAt).toLocaleString()}</div>
                <div>Exit: {trade.exit_ts ? new Date(trade.exit_ts).toLocaleString() : 'Open'}</div>
              </div>
            }>
              <span className="text-[9px] text-dim font-mono flex items-center gap-1 cursor-help">
                <Clock size={8} /> {durationStr}
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="flex gap-6 md:gap-10 text-right items-center">
        <div className="hidden xl:flex flex-col">
          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Entry/Exit</span>
          <span className="text-[10px] font-bold text-dim font-mono">{price(trade.entry_price)} → {price(trade.exit_price)}</span>
        </div>
        <div className="hidden md:flex flex-col">
          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Size</span>
          <span className="text-[10px] font-bold text-dim font-mono">{Number(trade.qty || 0).toFixed(2)}</span>
        </div>
        <div className="hidden sm:flex flex-col">
          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Max RR</span>
          <span className="text-[10px] font-bold text-accent font-mono">{Number(trade.max_rr_achieved || 0).toFixed(2)}R</span>
        </div>
        <div className="hidden sm:flex flex-col">
          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Trigger</span>
          <span className="text-[10px] font-bold text-dim/80 uppercase">
            {trade.exit_signal_type ? (
              <span className="flex flex-col items-end">
                <span className="text-accent">{trade.exit_signal_type.replace(/_/g, ' ')}</span>
                <span className="text-[8px] text-dim/60 normal-case">{trade.exit_reason || trade.exit_signal_reason}</span>
              </span>
            ) : (
              trade.exit_reason || 'Manual'
            )}
          </span>
        </div>
        <div className="flex flex-col min-w-[70px]">
          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Result</span>
          <span className={cn("text-xs font-bold font-mono", isWin ? "text-green" : "text-red")}>
            {fmtUSD(trade.pnl || 0)}
          </span>
        </div>
      </div>
    </div>
  )
})

const SessionGroup = React.memo(({ session, trades, colorDrawdown }) => {
  const [expanded, setExpanded] = useState(false)

  // BOLT: Use persisted session aggregates for the overview to ensure visibility even after restart
  const tradeCount = session.tradeCount ?? trades.length
  const winCount = session.winCount ?? trades.filter(t => (t.pnl || 0) > 0).length
  const pnl = session.totalPnl != null ? Number(session.totalPnl) : trades.reduce((sum, t) => sum + (t.pnl || 0), 0)

  const winRate = tradeCount ? Math.round((winCount / tradeCount) * 100) : 0
  const curve = useMemo(() => buildCurve(trades), [trades])
  const label = strategyLabel(session)

  const avgWin = winCount > 0 ? trades.filter(t => (t.pnl || 0) > 0).reduce((sum, t) => sum + (t.pnl || 0), 0) / winCount : 0
  const losses = tradeCount - winCount
  const avgLoss = losses > 0 ? Math.abs(trades.filter(t => (t.pnl || 0) < 0).reduce((sum, t) => sum + (t.pnl || 0), 0)) / losses : 0
  const winLossRatio = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '∞'

  return (
    <div id={`session-${session.id}`} className="bg-surface border border-border rounded-2xl overflow-hidden mb-4 shadow-sm transition-all hover:border-border-hover scroll-mt-8">
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
              <a href={`#/history?session=${session.id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-bold tracking-tight hover:text-accent transition-colors">
                {label}
              </a>
              <span className="text-[10px] text-dim font-mono">#{session.id.substring(0, 8)}</span>
              {session.paperMode && <PaperBadge />}
            </div>
            <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex items-center gap-2">
              <Clock size={10} /> {new Date(session.startTime).toLocaleDateString()} · {new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 md:gap-10">
          <div className="hidden lg:block w-44">
            <EquityCurve data={curve} height={54} colorDrawdown={colorDrawdown} />
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Config</span>
            <span className="text-xs font-bold text-dim uppercase tracking-tight flex items-center gap-1.5">
              <Zap size={10} className="text-accent" />
              {session.config?.scan_interval} · {session.config?.scan_pct_threshold}% · {session.config?.risk_pct_per_trade}%
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">Win Rate</span>
            <span className="text-xs font-bold font-mono">{winRate}% ({winCount}/{tradeCount})</span>
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-[9px] text-dim font-bold uppercase tracking-widest mb-1">W/L Ratio</span>
            <span className="text-xs font-bold font-mono text-accent">{winLossRatio}</span>
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
              {curve.length >= 2 && (
                <div className="bg-surface border border-border/60 rounded-xl p-4 mb-3">
                  <EquityCurve data={curve} height={150} colorDrawdown={colorDrawdown} />
                </div>
              )}
              {trades.length === 0 ? (
                <div className="py-8 text-center text-[11px] text-dim font-bold uppercase tracking-widest">No trades recorded for this session</div>
              ) : (
                trades.map((trade) => (
                  <TradeItem key={trade.id || `trade-${trade.entry_ts}-${trade.symbol || 'unknown'}`} trade={trade} session={session} />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
)

const PAGE_SIZE = 5

export const HistoryView = () => {
  const { tradeHistory, updateStats, sessionSummary, sidebarCollapsed, sessionList, fetchSessions, analytics, lifetimeAnalytics, fetchLifetimeAnalytics } = useTradingStore()
  const [fullAnalytics, setFullAnalytics] = useState(null)
  const [isLifetime, setIsLifetime] = useState(false)
  const [lifetimeMode, setLifetimeMode] = useState('paper')
  const [loading, setLoading] = useState(true)
  const [visibleSessions, setVisibleSessions] = useState(PAGE_SIZE)
  const [colorDrawdown, setColorDrawdown] = useState(true)

  const allSessionsWithTrades = useMemo(() => {
    // BOLT: Optimize O(N*M) join to O(N+M) using a lookup object
    const tradesBySession = tradeHistory.reduce((acc, t) => {
      if (!t.sessionId) return acc;
      if (!acc[t.sessionId]) acc[t.sessionId] = [];
      acc[t.sessionId].push(t);
      return acc;
    }, {});

    return sessionList.map(session => ({
      ...session,
      trades: tradesBySession[session.id] || []
    })).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
  }, [sessionList, tradeHistory])

  const sessionsToRender = useMemo(() => {
    return allSessionsWithTrades.slice(0, visibleSessions)
  }, [allSessionsWithTrades, visibleSessions])

  const orphans = useMemo(() => {
    const sessionIds = new Set(sessionList.map(s => s.id))
    return tradeHistory.filter(t => !t.sessionId || !sessionIds.has(t.sessionId))
  }, [sessionList, tradeHistory])

  const currentAnalytics = isLifetime ? lifetimeAnalytics : fullAnalytics

  const totalPnl = currentAnalytics?.cumulativePnL?.length ? currentAnalytics.cumulativePnL[currentAnalytics.cumulativePnL.length - 1].pnl : (isLifetime ? 0 : tradeHistory.reduce((sum, trade) => sum + (trade.pnl || 0), 0))
  const totalTrades = currentAnalytics?.totalTrades || (isLifetime ? 0 : tradeHistory.length)
  const wins = currentAnalytics ? Math.round((currentAnalytics.overallWinRate / 100) * totalTrades) : tradeHistory.filter((trade) => (trade.pnl || 0) > 0).length
  const winRate = currentAnalytics ? Math.round(currentAnalytics.overallWinRate) : (tradeHistory.length ? Math.round((wins / tradeHistory.length) * 100) : 0)
  const avgPnl = totalTrades ? totalPnl / totalTrades : 0

  useEffect(() => {
    setLoading(true)
    Promise.all([
      sessionAPI.history(),
      sessionAPI.analytics(),
      fetchLifetimeAnalytics(lifetimeMode),
      fetchSessions()
    ]).then(([historyRes, analyticsRes]) => {
      updateStats({ tradeHistory: historyRes.data.trades || [] })
      setFullAnalytics(analyticsRes.data)
    }).finally(() => setLoading(false))
  }, [updateStats, fetchSessions, fetchLifetimeAnalytics, lifetimeMode])

  useEffect(() => {
    if (loading) return
    const params = new URLSearchParams((window.location.hash.split('?')[1] || '').split('#')[0])
    const sessionId = params.get('session')
    if (sessionId) {
      document.getElementById(`session-${sessionId}`)?.scrollIntoView({ behavior: 'auto', block: 'start' })
    }
  }, [loading, sessionsToRender.length])

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

        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-8">
          <div className="flex items-center gap-2 p-1 bg-surface border border-border rounded-xl w-fit">
            <button
              onClick={() => setIsLifetime(false)}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                !isLifetime ? "bg-accent text-white shadow-lg shadow-accent/20" : "text-dim hover:text-text"
              )}
            >
              Current Session
            </button>
            <button
              onClick={() => setIsLifetime(true)}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                isLifetime ? "bg-accent text-white shadow-lg shadow-accent/20" : "text-dim hover:text-text"
              )}
            >
              Lifetime Performance
            </button>
          </div>

          <AnimatePresence>
            {isLifetime && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex items-center gap-2 p-1 bg-surface border border-border rounded-xl w-fit"
              >
                {['paper', 'testnet', 'live'].map(m => (
                  <button
                    key={m}
                    onClick={() => setLifetimeMode(m)}
                    className={cn(
                      "px-3 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all",
                      lifetimeMode === m ? "bg-surface-lighter border border-accent/20 text-accent" : "text-dim hover:text-text"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <StatCard label="Total Performance" value={fmtUSD(totalPnl)} color={totalPnl >= 0 ? "text-green" : "text-red"} />
          <StatCard label="Win Rate" value={`${winRate}%`} color="text-accent" subValue={`${wins} Wins / ${totalTrades - wins} Losses`} />
          <StatCard
            label="Max Drawdown"
            value={currentAnalytics ? fmtUSD(-currentAnalytics.maxDrawdown) : '$0.00'}
            color="text-red"
            subValue={currentAnalytics ? `${Number(currentAnalytics.maxDrawdownPct || 0).toFixed(1)}% Peak-to-Valley` : '0%'}
          />
          <StatCard label="Avg Win" value={fmtUSD(currentAnalytics?.avgWin || 0)} color="text-green" />
          <StatCard label="Avg Loss" value={fmtUSD(-(currentAnalytics?.avgLoss || 0))} color="text-red" />
          <StatCard label="W/L Ratio" value={Number(currentAnalytics?.avgWinLossRatio || 0).toFixed(2)} color="text-accent" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-6 shadow-sm overflow-hidden relative">
             <div className="flex items-center justify-end mb-2">
               <button
                 onClick={() => setColorDrawdown(v => !v)}
                 className={cn(
                   "px-3 py-1.5 rounded-md border text-[9px] font-bold uppercase tracking-widest transition-colors",
                   colorDrawdown ? "border-red/30 bg-red/10 text-red" : "border-border text-dim hover:text-accent"
                 )}
               >
                 Drawdown Colors
               </button>
             </div>
             <EquityCurve data={currentAnalytics?.cumulativePnL || []} colorDrawdown={colorDrawdown} />
          </div>
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
             <TODPerformance data={currentAnalytics?.timeOfDay || []} />
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
                    <SessionGroup session={s} trades={s.trades} colorDrawdown={colorDrawdown} />
                  </motion.div>
                ))}

                {visibleSessions < allSessionsWithTrades.length && (
                   <motion.div
                     key="load-more-btn"
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
                      {orphans.map((trade) => (
                        <TradeItem key={trade.id || `trade-${trade.entry_ts}-${trade.symbol || 'unknown'}`} trade={trade} />
                      ))}
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
