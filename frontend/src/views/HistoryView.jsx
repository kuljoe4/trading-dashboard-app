import React, { useEffect, useMemo, useState } from 'react'
import { fmtUSD, pnlColor, pnlClass, safeNum } from '../lib/theme'
import { getExpectancyStatus, getSharpeStatus, getSortinoStatus, calculatePerformanceMetrics } from '../lib/analytics'
import { sessionAPI } from '../api/client'
import { useTradingStore } from '../store/trading'
import { SectionLabel, StatCard, cn, PaperBadge, Tooltip, CopyButton, ViewHeader } from '../components/ui/primitives'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { formatDuration } from '../lib/formatters'
import { motion, AnimatePresence } from 'framer-motion'
import { History as HistoryIcon, ArrowLeftRight, TrendingUp, TrendingDown, Clock, ShieldCheck, LayoutDashboard, Settings as SettingsIcon, ChevronRight, ChevronDown, Zap, BarChart3, LineChart, Target, Trash2, Search, XCircle, Info } from 'lucide-react'

import { Sidebar, BottomNav } from '../components/Navigation'
// Lazy load heavy analytics components
const EquityCurve = React.lazy(() => import('../components/Analytics').then(m => ({ default: m.EquityCurve })))
const TODPerformance = React.lazy(() => import('../components/Analytics').then(m => ({ default: m.TODPerformance })))

const price = (value) => {
  if (value == null) return 'None'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

const strategyLabel = (item = {}) => item.strategy_label || item.strategyLabel || item.config?.strategy_label || item.strategy_config?.strategy_label || 'Momentum Strategy'

const buildCurve = (trades = []) => {
  let pnl = 0
  return [...trades].reverse().map((trade) => {
    pnl += safeNum(trade.pnl)
    return { ts: trade.exit_ts || trade.entry_ts || trade.createdAt, pnl }
  })
}

const TradeItem = React.memo(({ trade, session = {}, showStrategy = true }) => {
  const pnl = safeNum(trade.pnl)
  const durationMs = trade.exit_ts && trade.entry_ts ? new Date(trade.exit_ts).getTime() - new Date(trade.entry_ts).getTime() : 0
  const durationStr = durationMs ? (durationMs / 60000).toFixed(1) + 'm' : 'N/A'
  const isLong = trade.direction?.toLowerCase() === 'long'

  return (
    <div className="flex flex-col gap-3 p-4 bg-surface border border-border/40 rounded-xl hover:border-accent/10 transition-all group/trade shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-black font-mono tracking-tight shrink-0">{trade.symbol}</span>
            <CopyButton value={trade.symbol} className="opacity-0 group-hover/trade:opacity-100 focus-visible:opacity-100 -ml-1 scale-75" />
            <span className={cn("text-[8px] font-black px-1.5 py-0.5 rounded border uppercase shrink-0", isLong ? "text-green border-green/20 bg-green/5" : "text-red border-red/20 bg-red/5")}>
              {trade.direction}
            </span>
            {showStrategy && (
              <a href={`#/history?session=${trade.sessionId || session?.id}`} className="text-[8px] font-black px-1.5 py-0.5 rounded border border-accent/20 bg-accent/5 text-accent uppercase truncate max-w-[100px]">
                {strategyLabel(trade)}
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 text-dim">
            <span className="text-[9px] font-bold font-mono tracking-tighter">{new Date(trade.entry_ts || trade.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-[9px] opacity-20">|</span>
            <Tooltip content={
              <div className="flex flex-col gap-1 text-[10px]">
                <div>Entry: {new Date(trade.entry_ts || trade.createdAt).toLocaleString()}</div>
                <div>Exit: {trade.exit_ts ? new Date(trade.exit_ts).toLocaleString() : 'Open'}</div>
              </div>
            }>
              <span className="text-[9px] font-bold font-mono flex items-center gap-1 cursor-help">
                <Clock size={10} /> {durationStr}
              </span>
            </Tooltip>
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className={cn("text-base font-black font-mono tracking-tighter", pnlClass(pnl))}>
              {fmtUSD(pnl)}
            </span>
          </div>
          {(trade.realized_fee > 0 || trade.funding_fee !== 0) && (
            <Tooltip content={
              <div className="flex flex-col gap-1 text-[10px]">
                 <div className="flex justify-between gap-4"><span>Commission:</span> <span>-{fmtUSD(trade.realized_fee || 0)}</span></div>
                 <div className="flex justify-between gap-4"><span>Funding:</span> <span>{trade.funding_fee > 0 ? '-' : '+'}{fmtUSD(Math.abs(trade.funding_fee || 0))}</span></div>
              </div>
            }>
              <span className="text-[8px] text-dim/40 font-bold font-mono cursor-help border-b border-dotted border-dim/10 mt-0.5">
                -{fmtUSD(safeNum(trade.realized_fee) + safeNum(trade.funding_fee))}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-3 border-t border-border/5 justify-start">
        <div className="flex flex-col items-start min-w-[120px] max-w-[160px]">
          <span className="text-[7px] text-dim font-black uppercase tracking-widest mb-0.5">Execution</span>
          <span className="text-[9px] font-black text-text/70 font-mono truncate w-full">{price(trade.entry_price)} → {price(trade.exit_price)}</span>
        </div>
        <div className="flex flex-col items-start min-w-[60px]">
          <span className="text-[7px] text-dim font-black uppercase tracking-widest mb-0.5">Quantity</span>
          <span className="text-[9px] font-black text-text/70 font-mono">{Number(trade.qty || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex flex-col items-start min-w-[70px]">
          <span className="text-[7px] text-dim font-black uppercase tracking-widest mb-0.5">Peak</span>
          <span className="text-[9px] font-black text-accent font-mono">+{Number(trade.max_rr_achieved || 0).toFixed(2)}R</span>
        </div>
        <div className="flex flex-col items-start min-w-[80px]">
          <span className="text-[7px] text-dim font-black uppercase tracking-widest mb-0.5">Market Context</span>
          <span className={cn("text-[9px] font-black font-mono", pnlClass(trade.entry_daily_change_pct))}>
            {(trade.entry_daily_change_pct || 0) > 0 ? '▲' : (trade.entry_daily_change_pct || 0) < 0 ? '▼' : ''} {Math.abs(trade.entry_daily_change_pct || 0).toFixed(2)}%
          </span>
        </div>
        <div className="flex flex-col items-start min-w-[80px] max-w-[120px]">
          <span className="text-[7px] text-dim font-black uppercase tracking-widest mb-0.5">Exit</span>
          <Tooltip content={
            <div className="flex flex-col gap-1 max-w-[200px]">
              <span className="font-bold text-[10px] uppercase">{trade.exit_signal_type?.replace(/_/g, ' ') || trade.exit_reason || 'Manual'}</span>
              {trade.exit_signal_reason && (
                <span className="text-[9px] opacity-80 leading-relaxed italic border-t border-white/10 pt-1 mt-1">
                  {trade.exit_signal_reason}
                </span>
              )}
            </div>
          }>
            <span className="text-[8px] font-black text-text/60 uppercase truncate w-full leading-tight cursor-help border-b border-dotted border-white/10 pb-0.5">
              {trade.exit_signal_type ? trade.exit_signal_type.replace(/_/g, ' ') : (trade.exit_reason || 'Manual')}
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})

const SessionGroup = React.memo(({ session, trades }) => {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams((window.location.hash.split('?')[1] || '').split('#')[0])
    if (params.get('session') === session.id) {
      setExpanded(true)
    }
  }, [session.id])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setExpanded(!expanded);
    }
  }

  const duration = useMemo(() => {
    if (!session.startTime) return '---'
    const end = session.endTime ? new Date(session.endTime).getTime() : Date.now()
    const start = new Date(session.startTime).getTime()
    return formatDuration(end - start)
  }, [session.startTime, session.endTime])

  const metrics = useMemo(() => {
    const m = calculatePerformanceMetrics(trades);
    const losses = trades.length - m.wins;
    const avgWin = m.wins > 0 ? m.grossProfit / m.wins : 0;
    const avgLoss = losses > 0 ? m.grossLoss / losses : 0;
    const winLossRatio = avgLoss > 0 ? (avgWin / avgLoss) : 0;
    const winLossRatioStr = avgLoss > 0 ? winLossRatio.toFixed(2) : '∞';
    const startingBalance = Number(session.balance) - Number(session.totalPnl);
    const pnlPct = startingBalance > 0 ? (m.totalPnl / startingBalance) * 100 : 0;

    return {
      ...m,
      winLossRatio,
      winLossRatioStr,
      pnlPct,
      expectancyStatus: getExpectancyStatus(m.winRate / 100, winLossRatio),
      sharpeStatus: getSharpeStatus(m.sharpe),
      sortinoStatus: getSortinoStatus(m.sortino),
      curve: buildCurve(trades)
    };
  }, [trades, session.balance, session.totalPnl]);

  const { wins, winRate, winLossRatioStr, expectancyStatus, totalPnl: pnl, curve } = metrics;
  const label = strategyLabel(session);

  return (
    <div id={`session-${session.id}`} className="bg-surface border border-border rounded-2xl overflow-hidden mb-8 lg:mb-12 shadow-sm transition-all hover:border-border-hover scroll-mt-8">
      <div
        onClick={() => setExpanded(!expanded)}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-6 cursor-pointer select-none bg-surface/30 group focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none"
      >
        {/* Left: Strategy Info */}
        <div className="flex items-center gap-5">
          <div className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-300",
            expanded ? "bg-accent/10 border-accent/20 scale-105" : "bg-surface border-border group-hover:border-accent/30"
          )}>
            {expanded ? <ChevronDown size={24} className="text-accent" /> : <ChevronRight size={24} className="text-dim" />}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <a href={`#/history?session=${session.id}`} onClick={(e) => e.stopPropagation()} className="text-lg font-bold tracking-tight hover:text-accent transition-colors">
                {label}
              </a>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-dim font-mono bg-background/50 px-2 py-0.5 rounded border border-border/50">#{session.id.substring(0, 8)}</span>
                <CopyButton value={session.id} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
              </div>
              {session.paperMode && <PaperBadge />}
            </div>
            <div className="text-[11px] text-dim font-bold uppercase tracking-[0.1em] flex items-center gap-3">
              <span className="flex items-center gap-1.5"><Clock size={12} className="text-accent" /> {new Date(session.startTime).toLocaleDateString()}</span>
              <span className="w-1 h-1 rounded-full bg-dim/30" />
              <span>{new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="w-1 h-1 rounded-full bg-dim/30" />
              <span className="text-accent">{duration}</span>
            </div>
          </div>
        </div>

        {/* Center/Right: Metrics Grid */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6 xl:gap-12 xl:ml-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 xl:gap-12">
            <div className="flex flex-col">
              <span className="text-[10px] text-dim font-black uppercase tracking-[0.15em] mb-1.5 opacity-60">Interval</span>
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <Zap size={10} className="text-accent" />
                {session.config?.scan_interval}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-dim font-black uppercase tracking-[0.15em] mb-1.5 opacity-60">Win Rate</span>
              <span className="text-xs font-bold font-mono text-text">{winRate}% <span className="text-[10px] opacity-40 font-bold ml-1">({wins}/{trades.length})</span></span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-dim font-black uppercase tracking-[0.15em] mb-1.5 opacity-60">Ratio</span>
              <span className="text-xs font-bold font-mono text-accent">{winLossRatioStr}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-dim font-black uppercase tracking-[0.15em] mb-1.5 opacity-60">Expectancy</span>
              <Tooltip content="Expected value per trade based on historical performance">
                <span className={cn("text-xs font-bold flex items-center gap-1.5", expectancyStatus.color)}>
                  <expectancyStatus.icon size={12} aria-hidden="true" />
                  {Number(expectancyStatus.expectancy).toFixed(2)}
                </span>
              </Tooltip>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-dim font-black uppercase tracking-[0.15em] mb-1.5 opacity-60">Net P&L</span>
              <span className={cn("text-lg font-bold font-mono tracking-tighter leading-none", pnlClass(pnl))}>
                {fmtUSD(pnl)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/10"
          >
            <div className="p-4 space-y-3 bg-background/20">
              {curve.length >= 2 && (
                <div className="bg-surface/40 border border-border/10 rounded-xl p-6 mb-6 shadow-inner overflow-hidden">
                  <EquityCurve data={curve} height={200} />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trades.length === 0 ? (
                  <div className="col-span-full py-12 text-center text-[11px] text-dim font-black uppercase tracking-[0.2em] opacity-40">No trades recorded for this session</div>
                ) : (
                  trades.map((trade) => (
                    <TradeItem key={trade.id || `trade-${trade.entry_ts}-${trade.symbol || 'unknown'}`} trade={trade} session={session} showStrategy={false} />
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
)

const PAGE_SIZE = 10

export const HistoryView = () => {
  const { tradeHistory, updateStats, sessionSummary, sidebarCollapsed, sessionList, fetchSessions, analytics, lifetimeAnalytics, fetchLifetimeAnalytics, healthEnabled, isSyncing, fetchTradeHistory } = useTradingStore()
  const [fullAnalytics, setFullAnalytics] = useState(null)
  const [lifetimeMode, setLifetimeMode] = useState(localStorage.getItem('history_trade_mode') || 'paper')
  const [loading, setLoading] = useState(true)
  const [visibleSessions, setVisibleSessions] = useState(PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
    const term = search.toLowerCase().trim()
    return allSessionsWithTrades
      .filter(s => {
        // Mode filter
        const sessionMode = s.paperMode ? 'paper' : (s.config?.trading_mode || 'live');
        if (sessionMode !== lifetimeMode) return false;

        // Search filter
        if (!term) return true;
        const label = strategyLabel(s).toLowerCase();
        const matchesLabel = label.includes(term);
        const matchesSymbol = s.trades?.some(t => t.symbol?.toLowerCase().includes(term));
        const matchesId = s.id.toLowerCase().includes(term);
        return matchesLabel || matchesSymbol || matchesId;
      })
      .slice(0, visibleSessions);
  }, [allSessionsWithTrades, visibleSessions, lifetimeMode, search]);

  const orphans = useMemo(() => {
    const sessionIds = new Set(sessionList.map(s => s.id))
    // Only show orphans that are not already matched to sessions in allSessionsWithTrades
    // Actually allSessionsWithTrades already includes trades matched to existing sessions.
    // Orphans are trades whose sessionId is missing or not in our session list.
    return tradeHistory.filter(t => !t.sessionId || !sessionIds.has(t.sessionId))
  }, [sessionList, tradeHistory])

  const [deletingOrphans, setDeletingOrphans] = useState(false)
  const [orphansExpanded, setOrphansExpanded] = useState(false)

  const handleDeleteOrphans = async () => {
    setDeletingOrphans(true)
    try {
      updateStats({ isSyncing: true })
      await sessionAPI.deleteOrphans()
      // Refresh history and analytics
      const [historyRes, _] = await Promise.all([
        sessionAPI.history(),
        fetchLifetimeAnalytics(lifetimeMode)
      ])
      updateStats({ tradeHistory: historyRes.data.trades || [] })
      setShowDeleteConfirm(false)
    } catch (e) {
      alert('Failed to delete standalone records')
    } finally {
      setDeletingOrphans(false)
      updateStats({ isSyncing: false })
    }
  }

  const currentAnalytics = lifetimeAnalytics

  const totalPnl = currentAnalytics?.cumulativePnL?.length ? safeNum(currentAnalytics.cumulativePnL[currentAnalytics.cumulativePnL.length - 1].pnl) : 0
  const totalTrades = currentAnalytics?.totalTrades || 0
  const wins = currentAnalytics ? Math.round((safeNum(currentAnalytics.overallWinRate) / 100) * totalTrades) : 0
  const winRate = currentAnalytics ? Math.round(currentAnalytics.overallWinRate) : 0
  const avgPnl = totalTrades ? totalPnl / totalTrades : 0

  const lifetimeExpectancyStatus = useMemo(() => {
    return getExpectancyStatus(winRate / 100, currentAnalytics?.avgWinLossRatio || 0);
  }, [winRate, currentAnalytics?.avgWinLossRatio]);

  const sharpeStatus = useMemo(() => getSharpeStatus(currentAnalytics?.sharpeRatio), [currentAnalytics?.sharpeRatio]);
  const sortinoStatus = useMemo(() => getSortinoStatus(currentAnalytics?.sortinoRatio), [currentAnalytics?.sortinoRatio]);

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchTradeHistory(),
      sessionAPI.analytics(),
      fetchLifetimeAnalytics(lifetimeMode),
      fetchSessions()
    ]).then(([_, analyticsRes]) => {
      setFullAnalytics(analyticsRes.data)
    }).finally(() => {
      setLoading(false)
    })
  }, [updateStats, fetchSessions, fetchLifetimeAnalytics, lifetimeMode, fetchTradeHistory])

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
      "min-h-screen transition-all duration-300 no-scrollbar",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
    )}>
      <React.Suspense fallback={null}>
      <Sidebar />
      <div className={cn(
        "max-w-[1200px] mx-auto p-4 md:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500 lg:pb-10 transition-all",
        healthEnabled ? "pb-48" : "pb-32"
      )}>
        <ViewHeader
          icon={HistoryIcon}
          title="Trade History"
          subTitle="Verified records of all closed positions"
          backAction={() => window.location.hash = '#/'}
        >
          <div className="flex items-center gap-3 self-end sm:self-auto">
             <div className="relative group hidden sm:block">
               <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
               <input
                 type="text"
                 placeholder="Search history..."
                 value={search}
                 onChange={(e) => setSearch(e.target.value)}
                 className="bg-surface border border-border rounded-xl pl-9 pr-8 py-2 text-[11px] font-bold focus:border-accent outline-none transition-all w-[180px] lg:w-[240px]"
               />
               {search && (
                 <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors">
                   <XCircle size={14} />
                 </button>
               )}
             </div>
             <span className="text-[9px] text-dim font-bold uppercase tracking-widest bg-background/50 px-2 py-1 rounded border border-border/50 whitespace-nowrap">
               Latest 200 Trades
             </span>
          </div>
        </ViewHeader>

        {/* Mobile Search */}
        <div className="sm:hidden relative group mb-6">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
          <input
            type="text"
            placeholder="Search history..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface border border-border rounded-xl pl-9 pr-8 py-3 text-xs font-bold focus:border-accent outline-none transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors">
              <XCircle size={16} />
            </button>
          )}
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-8">
          <div className="flex items-center gap-2 p-1 bg-surface border border-border rounded-xl w-fit">
            {['paper', 'testnet', 'live'].map(m => (
              <button
                key={m}
                onClick={() => {
                  setLifetimeMode(m);
                  localStorage.setItem('history_trade_mode', m);
                }}
                className={cn(
                  "px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                  lifetimeMode === m ? "bg-accent text-white shadow-lg shadow-accent/20" : "text-dim hover:text-text"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4 mb-8 lg:mb-12">
          <StatCard
            label="Total Performance"
            value={fmtUSD(totalPnl)}
            color={pnlClass(totalPnl)}
            subValue={
              <span className={cn("flex items-center gap-1", pnlClass(currentAnalytics?.overallPnlPct))}>
                <span className="text-[0.8em] opacity-80">{(currentAnalytics?.overallPnlPct || 0) > 0 ? '▴' : (currentAnalytics?.overallPnlPct || 0) < 0 ? '▾' : ''}</span>
                {Math.abs(currentAnalytics?.overallPnlPct || 0).toFixed(2)}% Performance
              </span>
            }
          />
          <StatCard label="Win Rate" value={`${winRate}%`} color="text-accent" subValue={`${wins}W / ${totalTrades - wins}L`} />
          <StatCard
            label="Max Drawdown"
            value={currentAnalytics ? fmtUSD(-currentAnalytics.maxDrawdown) : '$0.00'}
            color="text-red"
            subValue={currentAnalytics ? `${Number(currentAnalytics.maxDrawdownPct || 0).toFixed(1)}% Peak` : '0%'}
          />
          <StatCard label="Avg Win" value={fmtUSD(currentAnalytics?.avgWin || 0)} color="text-green" />
          <StatCard label="Avg Loss" value={fmtUSD(-(currentAnalytics?.avgLoss || 0))} color="text-red" />
          <StatCard
            label="W/L Ratio"
            value={Number(currentAnalytics?.avgWinLossRatio || 0).toFixed(2)}
            color="text-accent"
            subValue={
              <div className="flex flex-col gap-0.5">
                <span className={cn("flex items-center gap-1", lifetimeExpectancyStatus.color)}>
                  <lifetimeExpectancyStatus.icon size={10} />
                  {Number(lifetimeExpectancyStatus.expectancy).toFixed(2)} Expectancy
                </span>
                <span className={cn("text-[8px] font-black uppercase tracking-tight", lifetimeExpectancyStatus.color)}>
                  {lifetimeExpectancyStatus.label} Status
                </span>
              </div>
            }
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 gap-y-4 mb-8 lg:mb-12">
          <StatCard
            label="Sharpe Ratio"
            value={Number(currentAnalytics?.sharpeRatio || 0).toFixed(2)}
            color="text-accent"
            subValue={
              <Tooltip content={
                <div className="flex flex-col gap-2">
                  <span className="font-bold">{sharpeStatus.description}</span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
                    {sharpeStatus.tiers.map(t => <span key={t.label}>{t.label}: {t.range}</span>)}
                  </div>
                </div>
              }>
                <span className={cn("flex items-center gap-1 cursor-pointer", sharpeStatus.color)}>
                  <sharpeStatus.icon size={10} />
                  {sharpeStatus.label}
                  <Info size={10} className="opacity-50" />
                </span>
              </Tooltip>
            }
          />
          <StatCard
            label="Sortino Ratio"
            value={Number(currentAnalytics?.sortinoRatio || 0).toFixed(2)}
            color="text-accent"
            subValue={
              <Tooltip content={
                <div className="flex flex-col gap-2">
                  <span className="font-bold">{sortinoStatus.description}</span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
                    {sortinoStatus.tiers.map(t => <span key={t.label}>{t.label}: {t.range}</span>)}
                  </div>
                </div>
              }>
                <span className={cn("flex items-center gap-1 cursor-pointer", sortinoStatus.color)}>
                  <sortinoStatus.icon size={10} />
                  {sortinoStatus.label}
                  <Info size={10} className="opacity-50" />
                </span>
              </Tooltip>
            }
          />
          <StatCard label="Profit Factor" value={Number(currentAnalytics?.profitFactor || 0).toFixed(2)} color="text-accent" />
          <StatCard
            label="Expectancy"
            value={Number(lifetimeExpectancyStatus.expectancy).toFixed(2)}
            color={lifetimeExpectancyStatus.color}
            subValue={
              <Tooltip content={
                <div className="flex flex-col gap-2">
                  <span className="font-bold">{lifetimeExpectancyStatus.description}</span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
                    {lifetimeExpectancyStatus.tiers.map(t => <span key={t.label}>{t.label}: {t.range}</span>)}
                  </div>
                </div>
              }>
                <span className="flex items-center gap-1 cursor-pointer">
                  {lifetimeExpectancyStatus.label}
                  <Info size={10} className="opacity-50" />
                </span>
              </Tooltip>
            }
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 lg:mb-10"
        >
          <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-5 md:p-8 shadow-sm overflow-hidden relative">
             <EquityCurve data={currentAnalytics?.cumulativePnL || []} />
          </div>
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
             <TODPerformance data={currentAnalytics?.timeOfDay || []} />
          </div>
        </motion.div>

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
                Last session ended with <span className={cn("font-bold", pnlClass(sessionSummary.totalPnl))}>{fmtUSD(sessionSummary.totalPnl)}</span> across <span className="font-bold text-text">{sessionSummary.tradeCount}</span> positions.
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
                    className="mt-12 bg-surface/30 border border-border rounded-2xl overflow-hidden"
                  >
                    <div
                      onClick={() => setOrphansExpanded(!orphansExpanded)}
                      className="p-5 flex items-center justify-between cursor-pointer hover:bg-surface/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border transition-colors", orphansExpanded ? "bg-accent/10 border-accent/20" : "bg-surface border-border")}>
                          {orphansExpanded ? <ChevronDown size={20} className="text-accent" /> : <ChevronRight size={20} className="text-dim" />}
                        </div>
                        <div>
                          <div className="text-sm font-bold tracking-tight uppercase">Standalone Records</div>
                          <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex items-center gap-2 mt-1">
                            <ArrowLeftRight size={10} /> {orphans.length} trades without a valid session
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                        disabled={deletingOrphans}
                        className="px-4 py-2 bg-red/10 border border-red/20 text-red rounded-lg text-[10px] font-bold hover:bg-red/20 transition-all uppercase tracking-widest flex items-center gap-2 active:scale-95"
                      >
                        {deletingOrphans ? (
                          <div className="w-3 h-3 border-2 border-red border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                        Clear All
                      </button>
                    </div>

                    <AnimatePresence>
                      {orphansExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t border-border/40"
                        >
                          <div className="p-4 space-y-3 bg-background/30">
                            {orphans.map((trade) => (
                              <TradeItem key={trade.id || `trade-${trade.entry_ts}-${trade.symbol || 'unknown'}`} trade={trade} />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
        <BottomNav />
      </div>
      </React.Suspense>
    </div>
  )
}
