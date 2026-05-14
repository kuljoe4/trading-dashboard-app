import React, { useEffect, useMemo, useState } from 'react'
import { pnlColor, fmtUSD, C } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { sessionAPI } from '../api/client'
import { DecisionLog } from '../components/DecisionLog'
import { ActiveTradeBar } from '../components/ActiveTradeBar'
import { ConfigModal } from '../components/ConfigModal'
import { SystemHealth } from '../components/SystemHealth'
import { ScannerOverlay } from '../components/ScannerOverlay'
import * as Dialog from '@radix-ui/react-dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { 
  StatCard, SectionLabel, Btn, StatusBadge, PaperBadge, 
  ConditionWidget, PulseDot, Sparkline, PnLBars, cn
} from '../components/ui/primitives'
import {
  ChevronLeft, Plus, Trash2, LayoutDashboard, History,
  Settings as SettingsIcon, Activity, Zap, ShieldCheck,
  BarChart3, XCircle, Pause, Play, Edit3
} from 'lucide-react'
import { Drawer } from 'vaul'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar, BottomNav } from '../components/Navigation'

// --- Strategy Card ---
const StrategyCard = ({ s, config, onClick, onPause, onEdit, paused }) => {
  const slPct = Math.min(((s.totalSlUsed / config.total_sl_guard_usdt) * 100) || 0, 100);

  return (
    <motion.div
      layout
      onClick={onClick}
      className="bg-surface border border-border rounded-2xl p-6 cursor-pointer transition-all hover:border-accent/40 relative group shadow-sm hover:shadow-accent/5 h-full"
    >
      {paused && (
        <div className="absolute inset-0 bg-background/40 backdrop-blur-[1px] rounded-2xl z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-amber/10 border border-amber/20 text-amber px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-2xl">
            <Pause size={12} fill="currentColor" /> Session Paused
          </div>
        </div>
      )}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <StatusBadge status={s.sessionActive} />
            {config.paper_mode && <PaperBadge />}
          </div>
          <div className="text-[17px] font-bold">Momentum Strategy</div>
          <div className="text-[11px] text-dim mt-1.5 font-bold uppercase tracking-wider flex items-center gap-2">
            <Zap size={12} className="text-accent" />
            {config.scan_interval} · {config.scan_pct_threshold}% threshold
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex gap-2 mb-2 relative z-20">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-2 bg-surface border border-border rounded-lg hover:border-accent/40 hover:text-accent transition-all active:scale-95"
              title="Edit Config"
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onPause(); }}
              className={cn(
                "p-2 border rounded-lg transition-all active:scale-95",
                paused ? "bg-green/10 border-green/20 text-green hover:bg-green/20" : "bg-amber/10 border-amber/20 text-amber hover:bg-amber/20"
              )}
              title={paused ? "Resume Session" : "Pause Session"}
            >
              {paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
            </button>
          </div>
          <div className="text-2xl font-bold font-mono" style={{ color: pnlColor(s.totalPnl) }}>
            {fmtUSD(s.totalPnl)}
          </div>
          <div className="text-[10px] text-dim font-bold uppercase tracking-widest mt-1">
            {s.logs.filter(l => l.msg.includes('Entry')).length} ENTRIES
          </div>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex justify-between text-[10px] text-dim font-bold tracking-widest mb-2 uppercase">
          <span className="flex items-center gap-1.5"><ShieldCheck size={12} /> SL GUARD</span>
          <span className={slPct > 70 ? "text-red" : "text-dim"}>${s.totalSlUsed.toFixed(0)} / ${config.total_sl_guard_usdt}</span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div
            className={cn("h-full transition-all duration-700", slPct > 70 ? "bg-red" : "bg-accent shadow-[0_0_8px_rgba(91,111,255,0.4)]")}
            style={{ width: `${slPct}%` }}
          />
        </div>
      </div>
    </motion.div>
  );
}

const RateLimitStrip = ({ rateLimit }) => {
  const used = rateLimit?.used_weight_1m || 0
  const limit = rateLimit?.limit || 1200
  const pct = Math.min((used / limit) * 100, 100)
  const colorClass = pct >= 90 ? 'bg-red' : pct >= 70 ? 'bg-amber' : 'bg-green'
  const textColorClass = pct >= 90 ? 'text-red' : pct >= 70 ? 'text-amber' : 'text-green'

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 p-4 bg-surface/50 border border-border rounded-xl mb-6">
      <span className="text-[10px] text-dim font-bold tracking-widest uppercase flex items-center gap-2">
        <Activity size={12} /> API WEIGHT
      </span>
      <div className="flex-1 flex items-center gap-4">
        <strong className={cn("text-xs font-mono min-w-[70px]", textColorClass)}>{used}/{limit}</strong>
        <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            className={cn("h-full transition-all duration-500", colorClass)}
          />
        </div>
      </div>
      <em className={cn("text-[10px] font-bold tracking-widest uppercase text-right", textColorClass)}>
        {pct >= 90 ? 'CRITICAL' : pct >= 70 ? 'WARNING' : 'STABLE'}
      </em>
    </div>
  )
}

const GateBanner = ({ gateState, scannerPaused }) => {
  if (!gateState && !scannerPaused) return null
  const messages = {
    max_trades: 'Maximum open trades reached. Entry gated.',
    max_trades_period: 'Maximum trades for the current period reached. Scanner paused.',
    sl_guard: 'Session Stop-Loss Guard reached. All entries blocked.',
    risk_pct: 'Total risk limit reached. Entries restricted.',
    risk: 'Risk gate active. Monitoring only.',
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "p-4 rounded-xl mb-6 text-xs font-bold border flex items-center gap-3",
        scannerPaused ? "bg-red/10 border-red/20 text-red" : "bg-amber/10 border-amber/20 text-amber"
      )}
    >
      <XCircle size={16} className={scannerPaused ? "animate-pulse" : ""} />
      {messages[gateState] || 'Risk gate active.'}
    </motion.div>
  )
}

const ScannerPreview = ({ scannerResults, config, onOpen }) => {
  const threshold = config.scan_pct_threshold || 2
  const top = scannerResults.slice(0, 5)
  // Pre-allocate 5 slots to prevent layout shift
  const placeholders = Array.from({ length: Math.max(0, 5 - top.length) })

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden mb-8 shadow-sm h-[385px] flex flex-col">
      <div className="p-5 border-b border-border flex justify-between items-center bg-surface/30 shrink-0">
        <SectionLabel className="mb-0">
          <Zap size={14} className="text-accent" /> Live Scanner
        </SectionLabel>
        <button className="text-[11px] font-bold text-accent hover:text-accent/80 transition-colors uppercase tracking-widest" onClick={onOpen}>Open Full</button>
      </div>
      <div className="flex-1">
        {top.length === 0 && placeholders.length === 5 ? (
          <div className="h-full flex items-center justify-center text-dim text-[11px] font-bold uppercase tracking-widest bg-surface/10 animate-pulse">
            Waiting for market data...
          </div>
        ) : (
          <>
            <AnimatePresence mode="popLayout">
              {top.map((opp, i) => {
                const passing = Math.abs(opp.pct) >= threshold
                const isLong = opp.pct >= 0
                const colorClass = isLong ? "text-green" : "text-red"
                const isLast = i === top.length - 1 && placeholders.length === 0;
                return (
                  <motion.div
                    key={opp.symbol}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      "flex items-center gap-4 p-4 transition-colors hover:bg-white/5 h-[64px]",
                      !isLast && "border-b border-border/40",
                      !passing && "opacity-60"
                    )}
                  >
                    <span className="text-[10px] text-dim font-mono w-4">#{i + 1}</span>
                    <strong className="text-xs font-mono w-16">{opp.symbol.replace('USDT', '')}</strong>
                    <div className="flex-1 flex justify-center h-8">
                      <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={48} height={20} />
                    </div>
                    <em className={cn("text-xs font-bold font-mono w-16 text-right", colorClass)}>
                      {opp.pct >= 0 ? '+' : ''}{opp.pct.toFixed(2)}%
                    </em>
                    <b className={cn("text-[10px] font-bold w-12 text-right uppercase tracking-wider", passing ? "text-green" : "text-dim")}>
                      {passing ? 'PASS' : 'WAIT'}
                    </b>
                  </motion.div>
                )
              })}
            </AnimatePresence>
            {placeholders.map((_, i) => (
              <div key={`placeholder-${i}`} className={cn(
                "h-[64px] flex items-center px-4 opacity-10 grayscale",
                i !== placeholders.length - 1 && "border-b border-border/40"
              )}>
                <div className="w-4 h-2 bg-dim rounded-full mr-4" />
                <div className="w-16 h-3 bg-dim rounded-full mr-4" />
                <div className="flex-1" />
                <div className="w-16 h-3 bg-dim rounded-full mr-4" />
                <div className="w-12 h-2 bg-dim rounded-full" />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// --- Detail View ---
const StrategyDetailView = ({ s, onBack }) => {
  const { config, scannerResults, healthEnabled, monitoring } = useTradingStore()
  const bestOpp = scannerResults[0] || { symbol: '---', pct: 0, dir: '---' }
  const scanMet = Math.abs(bestOpp.pct) >= config.scan_pct_threshold
  const entryMet = scanMet && s.activeTrades.length > 0

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center gap-5 mb-10">
        <button
          onClick={onBack}
          aria-label="Go back to cockpit"
          className="p-2.5 hover:bg-surface border border-border rounded-xl transition-all active:scale-90 group"
        >
          <ChevronLeft size={20} className="text-dim group-hover:text-text" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold">Strategy Console</span>
            <StatusBadge status={s.sessionActive} />
            {config.paper_mode && <PaperBadge />}
          </div>
          <div className="text-[11px] text-dim mt-1.5 font-bold uppercase tracking-widest flex items-center gap-2">
            <Activity size={12} /> Loop Monitoring · {s.strategyId?.substring(0, 8)}
          </div>
        </div>
      </div>

      {healthEnabled && <SystemHealth monitoring={monitoring} />}

      {/* Summary Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Total P&L" value={fmtUSD(s.totalPnl)} color={s.totalPnl >= 0 ? "text-green" : "text-red"} />
        <StatCard label="Hit Count" value={s.logs.filter(l => l.msg.includes('Entry')).length.toString()} color="text-accent" />
        <StatCard label="SL Budget" value={`$${s.totalSlUsed.toFixed(0)} / $${config.total_sl_guard_usdt}`} color={s.totalSlUsed > config.total_sl_guard_usdt * 0.7 ? "text-amber" : "text-text"} />
        <StatCard label="Active Risk" value={`${s.totalRiskPct.toFixed(1)}%`} color={s.totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
      </div>

      {/* Condition Widgets */}
      <div className="mb-10">
        <SectionLabel>Automation Gating</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <ConditionWidget
            label={`Scanner: % Move (${config.scan_interval})`}
            value={bestOpp.pct}
            threshold={config.scan_pct_threshold}
            satisfied={scanMet}
            sublabel={`Top Opp: ${bestOpp.symbol} ${bestOpp.dir.toUpperCase()}`}
          />
          <ConditionWidget
            label="Entry Authorization"
            value={entryMet ? config.scan_pct_threshold + 0.3 : config.scan_pct_threshold - 0.5}
            threshold={config.scan_pct_threshold}
            unit=" conf"
            satisfied={entryMet}
            sublabel="Waiting for structural signal"
          />
        </div>
      </div>

      {/* Active Position */}
      <div className="mb-10">
        <SectionLabel>Tactical Overview</SectionLabel>
        <ActiveTradeBar trade={s.activeTrades[0]} />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col h-[450px] shadow-sm">
          <SectionLabel className="mb-4">
            <Activity size={14} className="text-accent" /> Intelligence Log
          </SectionLabel>
          <div className="flex-1 overflow-hidden">
            <DecisionLog />
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col h-[450px] shadow-sm">
          <SectionLabel className="mb-4">
            <BarChart3 size={14} className="text-accent" /> Equity Performance
          </SectionLabel>
          <div className="flex-1 flex flex-col justify-center">
            <PnLBars trades={s.activeTrades} />
            <div className="mt-10 text-[10px] text-dim font-bold text-center uppercase tracking-widest opacity-40">
              Live Equity Curve Tracking
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardView() {
  const [selected, setSelected] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  
  const {
    sessionActive, sessionPaused, strategyId, balance, totalPnl, totalRiskPct,
    totalSlUsed, activeTrades, logs, config, healthEnabled, setSessionActive,
    updateConfig, scannerResults, activeWindows, gateState,
    scannerPaused, rateLimit, monitoring, sessionList, fetchSessions, wsStatus,
    sidebarCollapsed
  } = useTradingStore(state => ({
    sessionActive: state.sessionActive,
    sessionPaused: state.sessionPaused,
    strategyId: state.strategyId,
    balance: state.balance,
    totalPnl: state.totalPnl,
    totalRiskPct: state.totalRiskPct,
    totalSlUsed: state.totalSlUsed,
    activeTrades: state.activeTrades,
    logs: state.logs,
    config: state.config,
    healthEnabled: state.healthEnabled,
    setSessionActive: state.setSessionActive,
    updateConfig: state.updateConfig,
    scannerResults: state.scannerResults,
    activeWindows: state.activeWindows,
    gateState: state.gateState,
    scannerPaused: state.scannerPaused,
    rateLimit: state.rateLimit,
    monitoring: state.monitoring,
    sessionList: state.sessionList,
    fetchSessions: state.fetchSessions,
    wsStatus: state.wsStatus,
    sidebarCollapsed: state.sidebarCollapsed
  }))

  const { updateStats } = useTradingStore()

  const [loading, setLoading] = useState(false)

  const currentStrategy = useMemo(() => ({
    sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, activeTrades, logs
  }), [sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, activeTrades, logs])

  const maxRR = useMemo(() => activeTrades.reduce((max, trade) => Math.max(max, trade.max_rr || 0), 0), [activeTrades])

  useEffect(() => {
    sessionAPI.rateLimit()
      .then((res) => updateStats({ rateLimit: res.data }))
      .catch((e) => console.error('RateLimit fetch failed:', e))
    
    fetchSessions();

    const openScanner = () => setShowScanner(true);
    window.addEventListener('open-scanner', openScanner);
    return () => window.removeEventListener('open-scanner', openScanner);
  }, []);

  async function handleConfigSave(newConfig) {
    setLoading(true)
    setShowConfig(false)
    try {
      if (isEditMode && strategyId) {
        await sessionAPI.update(strategyId, newConfig)
        updateConfig(newConfig)
      } else {
        updateConfig(newConfig)
        const res = await sessionAPI.start(newConfig, newConfig.paper_mode)
        setSessionActive(true, res.data.strategyId || res.data.strategy_id)
      }
      await fetchSessions()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to save config')
    } finally {
      setLoading(false)
      setIsEditMode(false)
    }
  }

  async function togglePause() {
    try {
      await sessionAPI.pause(!sessionPaused)
    } catch (e) {
      console.error('Pause toggle failed:', e)
    }
  }

  async function handleStop() {
    setLoading(true)
    try {
      await sessionAPI.stop()
      setSessionActive(false, null)
      await fetchSessions()
    } catch (e) {
      setSessionActive(false, null)
      await fetchSessions()
    } finally {
      setLoading(false)
    }
  }

  if (selected) {
    return (
      <div className={cn(
        "pb-32 transition-all duration-300",
        sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
      )}>
        <Sidebar selected={selected} />
        <StrategyDetailView s={currentStrategy} onBack={() => setSelected(null)} />
        <BottomNav selected={selected} />
      </div>
    )
  }

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]",
      config.paper_mode ? "shadow-[inset_0_0_100px_rgba(245,166,35,0.05)] border-amber/10" : ""
    )}>
      <Sidebar selected={selected} />
      <div className="max-w-[1400px] mx-auto p-4 md:p-8 pb-32 lg:pb-8">

        {/* Header Bar */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 mb-10 bg-surface border border-border rounded-2xl p-6 shadow-sm"
        >
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-xl font-bold tracking-tight">Operator Cockpit</span>
                {config.paper_mode && <PaperBadge />}
              </div>
              <div className="flex items-center gap-3 lg:hidden">
                <span className={cn("text-[10px] font-bold font-mono tracking-widest uppercase", wsStatus === 'live' ? "text-green" : "text-amber")}>
                  {wsStatus === 'live' ? 'Connected' : 'Reconnecting'}
                </span>
                <PulseDot color={wsStatus === 'live' ? "bg-green" : "bg-amber"} />
              </div>
              <div className="hidden lg:block text-[11px] text-dim font-bold uppercase tracking-widest">
                Real-time strategy management & market oversight
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            {!sessionActive ? (
              <Btn variant="success" onClick={() => { setIsEditMode(false); setShowConfig(true); }} disabled={loading} className="flex-1 sm:flex-none">
                <Plus size={16} className="mr-2" /> New Session
              </Btn>
            ) : (
              <Btn variant="danger" onClick={handleStop} disabled={loading} className="flex-1 sm:flex-none">
                <XCircle size={16} className="mr-2" /> Terminate Session
              </Btn>
            )}
          </div>
        </motion.div>

        <RateLimitStrip rateLimit={rateLimit} />
        {healthEnabled && <SystemHealth monitoring={monitoring} />}
        <GateBanner gateState={gateState} scannerPaused={scannerPaused} />

        {/* Global Metrics */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10"
        >
          <StatCard label="Account Balance" value={`$${balance.toLocaleString()}`} />
          <StatCard label="Session P&L" value={fmtUSD(totalPnl)} color={totalPnl >= 0 ? "text-green" : "text-red"} />
          <StatCard label="Live Risk" value={`${totalRiskPct.toFixed(1)}%`} color={totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
          <StatCard label="Peak RR" value={`+${maxRR.toFixed(2)}`} color="text-accent" />
        </motion.div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-10">

          {/* Left Workspace */}
          <div className="space-y-10">
            <motion.div
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <SectionLabel>Active Strategy</SectionLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {sessionActive ? (
                  <StrategyCard
                    s={currentStrategy}
                    config={config}
                    paused={sessionPaused}
                    onPause={togglePause}
                    onEdit={() => { setIsEditMode(true); setShowConfig(true); }}
                    onClick={() => setSelected(true)}
                  />
                ) : (
                  <button
                    onClick={() => { setIsEditMode(false); setShowConfig(true); }}
                    className="bg-background border-2 border-dashed border-border rounded-2xl p-10 flex flex-col items-center justify-center gap-4 text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all group h-[256px]"
                  >
                    <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-all shadow-sm">
                      <Plus size={24} />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest">Configure Strategy</span>
                  </button>
                )}

                {sessionList
                  .filter(s => s.id !== strategyId)
                  .slice(0, 1)
                  .map(s => (
                  <div key={s.id} className="bg-surface/40 border border-border/60 rounded-2xl p-6 flex flex-col gap-6 opacity-80 h-[256px]">
                     <div className="flex justify-between items-start">
                      <div>
                        <div className="text-[10px] text-dim font-bold tracking-widest uppercase mb-2">Previous Session</div>
                        <div className="text-base font-bold">{s.config?.scan_interval} Momentum</div>
                      </div>
                      <div className="text-right">
                        <div className={cn("text-xl font-bold font-mono", s.totalPnl >= 0 ? "text-green" : "text-red")}>
                          {fmtUSD(s.totalPnl)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-auto pt-5 border-t border-border/20 flex justify-between items-center">
                      <span className="text-[10px] text-dim font-bold font-mono">ID: {s.id.substring(0, 8)}</span>
                      <button
                        onClick={async () => { if(confirm('Delete?')) { setLoading(true); await sessionAPI.delete(s.id); await fetchSessions(); setLoading(false); }}}
                        aria-label="Delete session history"
                        className="text-dim hover:text-red transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              <SectionLabel>Current Position</SectionLabel>
              <div className="space-y-5">
                {activeTrades.length === 0 ? (
                  <div className="bg-surface/20 border border-border border-dashed rounded-2xl p-16 text-center">
                    <div className="text-sm font-bold text-dim uppercase tracking-widest flex flex-col items-center gap-4">
                      <Zap size={32} className="opacity-20" />
                      {sessionActive ? 'Scanner engaged. Watching for momentum...' : 'Initialize a strategy to start monitoring.'}
                    </div>
                  </div>
                ) : (
                  <AnimatePresence>
                    {activeTrades.map((trade) => (
                      <motion.div
                        key={trade.id || trade.symbol}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                      >
                        <ActiveTradeBar trade={trade} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </motion.div>
          </div>

          {/* Right Workspace (Context) */}
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="space-y-10"
          >
            {/* ScannerPreview removed */}

            <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col h-[450px] shadow-sm">
              <SectionLabel className="mb-4">
                <Activity size={14} className="text-accent" /> Session Logs
              </SectionLabel>
              <div className="flex-1 overflow-hidden">
                <DecisionLog />
              </div>
            </div>
          </motion.div>
        </div>

        {/* Modals & Drawers */}
        <Drawer.Root open={showConfig} onOpenChange={setShowConfig}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
            <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[32px] h-[90vh] fixed bottom-0 left-0 right-0 z-50 focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:max-w-[800px] lg:mx-auto">
              <div className="p-4 bg-background border-b border-border rounded-t-[32px] flex flex-col items-center shrink-0">
                <div className="w-12 h-1.5 bg-border rounded-full mb-4" />
                <VisuallyHidden>
                  <Drawer.Title>Configuration</Drawer.Title>
                  <Drawer.Description>Form to configure trading strategy parameters</Drawer.Description>
                </VisuallyHidden>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ConfigModal initialConfig={config} onSave={handleConfigSave} onClose={() => setShowConfig(false)} isEdit={isEditMode} />
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        <Drawer.Root open={showScanner} onOpenChange={setShowScanner}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
            <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[32px] h-[90vh] fixed bottom-0 left-0 right-0 z-50 focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:max-w-[1000px] lg:mx-auto">
              <div className="p-4 bg-background border-b border-border rounded-t-[32px] flex flex-col items-center shrink-0">
                <div className="w-12 h-1.5 bg-border rounded-full mb-4" />
                <VisuallyHidden>
                  <Drawer.Title>Scanner</Drawer.Title>
                  <Drawer.Description>View live market scanner opportunities</Drawer.Description>
                </VisuallyHidden>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ScannerOverlay onClose={() => setShowScanner(false)} />
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        {/* Mobile Floating Controls */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowScanner(true)}
          className="lg:hidden fixed bottom-24 right-6 w-16 h-16 rounded-full bg-accent text-white shadow-2xl flex items-center justify-center z-40 animate-in fade-in zoom-in duration-500"
        >
          <Zap size={28} />
        </motion.button>

        <BottomNav selected={selected} />
      </div>
    </div>
  )
}
