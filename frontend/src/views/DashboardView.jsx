import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { shallow } from 'zustand/shallow'
import { pnlColor, fmtUSD, C } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { sessionAPI } from '../api/client'
import { 
  StatCard, SectionLabel, Btn, StatusBadge, PaperBadge, EcoBadge, DemoBadge, LiveBadge,
    ConditionWidget, PulseDot, Sparkline, PnLBars, CopyButton, cn, Tooltip, VisuallyHidden
  } from '../components/ui/primitives'
import {
  ChevronLeft, Plus, Trash2, LayoutDashboard, History,
  Settings as SettingsIcon, Activity, Zap, ShieldCheck,
  BarChart3, XCircle, Pause, Play, Edit3, RefreshCw, Leaf
} from 'lucide-react'
import { Drawer } from 'vaul'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar, BottomNav } from '../components/Navigation'

// Lazy Load heavy components
const DecisionLog = lazy(() => import('../components/DecisionLog').then(module => ({ default: module.DecisionLog })))
const ConfigModal = lazy(() => import('../components/ConfigModal').then(module => ({ default: module.ConfigModal })))
const ScannerOverlay = lazy(() => import('../components/ScannerOverlay').then(module => ({ default: module.ScannerOverlay })))
const StrategyDetailView = lazy(() => import('./StrategyDetailView'))

const LoadingFallback = () => (
  <div className="flex items-center justify-center p-20">
    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
)

// --- Strategy Card ---
const StrategyCard = React.memo(({ s, config, onClick, onPause, onEdit, paused, scannerResults }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const slPct = Math.min(((s.totalSlUsed / config.total_sl_guard_usdt) * 100) || 0, 100);
  const tradingMode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

  return (
    <motion.div
      layout
      onClick={onClick}
      className={cn(
        "bg-surface border border-border rounded-2xl p-6 cursor-pointer transition-all relative group shadow-sm h-full",
        tradingMode === 'paper' ? "hover:border-amber/40 hover:shadow-amber/5" :
        tradingMode === 'testnet' ? "hover:border-purple/40 hover:shadow-purple/5" :
        "hover:border-green/40 hover:shadow-green/5"
      )}
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
            {tradingMode === 'paper' && <PaperBadge />}
            {tradingMode === 'testnet' && <DemoBadge />}
            {tradingMode === 'live' && <LiveBadge />}
          </div>
          <div className="text-[17px] font-bold">{s.strategy_label}</div>
          <div className="text-[11px] text-dim mt-1.5 font-bold uppercase tracking-wider flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Zap size={12} className={cn("text-accent", config.global_scanner_enabled === false && "text-dim")} />
              <span className={cn(config.global_scanner_enabled === false && "line-through decoration-red/40 decoration-2")}>
                {config.scan_interval} · {config.scan_pct_threshold}% threshold
              </span>
            </div>
            {(config.single_symbol_configs || []).filter(sc => sc.enabled).length > 0 && (
              <div className="flex items-center gap-2">
                <ShieldCheck size={12} className="text-accent" />
                <span>{config.single_symbol_configs.filter(sc => sc.enabled).length} Symbol Monitors Active</span>
              </div>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex gap-2 mb-2 relative z-20">
            <Tooltip content={isExpanded ? "Hide Details" : "Show Details"}>
              <button
                onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                aria-label={isExpanded ? "Hide strategy details" : "Show strategy details"}
                aria-expanded={isExpanded}
                className={cn(
                  "p-2 bg-surface border border-border rounded-lg transition-all active:scale-95",
                  isExpanded ? "text-accent border-accent/40" : "hover:border-accent/40 hover:text-accent"
                )}
              >
                <Activity size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Edit Config">
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="p-2 bg-surface border border-border rounded-lg hover:border-accent/40 hover:text-accent transition-all active:scale-95"
                aria-label="Edit strategy configuration"
              >
                <Edit3 size={14} />
              </button>
            </Tooltip>
            <Tooltip content={paused ? "Resume Session" : "Pause Session"}>
              <button
                onClick={(e) => { e.stopPropagation(); onPause(); }}
                className={cn(
                  "p-2 border rounded-lg transition-all active:scale-95",
                  paused ? "bg-green/10 border-green/20 text-green hover:bg-green/20" : "bg-amber/10 border-amber/20 text-amber hover:bg-amber/20"
                )}
                aria-label={paused ? "Resume strategy session" : "Pause strategy session"}
              >
                {paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
              </button>
            </Tooltip>
          </div>
          <div className="text-2xl font-bold font-mono" style={{ color: pnlColor(s.totalPnl) }}>
            {fmtUSD(s.totalPnl)}
          </div>
          <div className="text-[10px] text-dim font-bold uppercase tracking-widest mt-1">
            {s.entryCount} ENTRIES · {s.hitCount} HITS
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-2 mt-4 pt-4 border-t border-border/20">
              <div className="flex justify-between text-[10px] text-dim font-bold tracking-widest mb-2 uppercase">
                <span className="flex items-center gap-1.5"><ShieldCheck size={12} /> SL GUARD</span>
                <span className={slPct > 70 ? "text-red" : "text-dim"}>${Number(s.totalSlUsed || 0).toFixed(0)} / ${config.total_sl_guard_usdt}</span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden mb-4">
                <div
                  className={cn(
                    "h-full transition-all duration-700",
                    slPct > 70 ? "bg-red" :
                    tradingMode === 'paper' ? "bg-amber shadow-[0_0_8px_rgba(245,166,35,0.4)]" :
                    tradingMode === 'testnet' ? "bg-purple shadow-[0_0_8px_rgba(168,85,247,0.4)]" :
                    "bg-green shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                  )}
                  style={{ width: `${slPct}%` }}
                />
              </div>
              <ScannerPreview scannerResults={scannerResults || []} config={config} onOpen={(e) => { e.stopPropagation(); setShowScanner(true); }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
})

const GateBanner = ({ gateState, scannerPaused, reason, activeTradesCount }) => {
  if (!gateState && !scannerPaused) return null

  const messages = {
    max_trades: 'Maximum open trades reached. Entry gated.',
    max_trades_period: 'Maximum trades for the current period reached. Scanner paused.',
    sl_guard: 'Session Stop-Loss Guard reached. All entries blocked.',
    risk_pct: 'Total risk limit reached. Entries restricted.',
    tod_risk: 'Historical performance risk for this hour. Entries blocked.',
    sleeping: 'Engine idling outside trading windows.',
    risk: 'Risk gate active. Monitoring only.',
  }

  const isGatedIdle = (gateState === 'sleeping' || gateState === 'max_trades_period' || gateState === 'sl_guard') && activeTradesCount === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "p-4 rounded-xl mb-6 text-xs font-bold border flex flex-col gap-2 shadow-sm transition-colors",
        scannerPaused ? "bg-red/10 border-red/20 text-red" : "bg-amber/10 border-amber/20 text-amber",
        isGatedIdle && "bg-accent/5 border-accent/20 text-accent/80"
      )}
    >
      <div className="flex items-center gap-3">
        {gateState === 'sleeping' ? <Pause size={16} className="animate-pulse" /> : <XCircle size={16} className={scannerPaused ? "animate-pulse" : ""} />}
        <span className="uppercase tracking-widest">{messages[gateState] || 'Risk gate active.'}</span>
        {isGatedIdle && (
          <Tooltip content="Resource Suppression Active: Market feed and scanner are throttled to save CPU/Memory while idle.">
            <div className="ml-auto bg-accent/10 px-2 py-0.5 rounded text-[10px] flex items-center gap-1.5 border border-accent/20">
              <Leaf size={10} /> RESOURCE SAVER
            </div>
          </Tooltip>
        )}
      </div>
      {reason && reason !== 'OK' && (
        <div className="pl-7 opacity-80 font-mono text-[10px] tracking-tight">
          Backend: {reason}
        </div>
      )}
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
                      {opp.pct >= 0 ? '+' : ''}{Number(opp.pct || 0).toFixed(2)}%
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

export function DashboardView() {
  const [selected, setSelected] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedConfig, setSelectedConfig] = useState(null)
  const [editingVariantIndex, setEditingVariantIndex] = useState(null)
  const [confirmStop, setConfirmStop] = useState(false)

  const {
    sessionActive, sessionPaused, strategyId, balance, totalPnl, totalRiskPct,
    totalSlUsed, activeTrades, config, setSessionActive,
    updateConfig, gateState, gateReason,
    scannerPaused, sessionList, fetchSessions, wsStatus,
    sidebarCollapsed, variantScannerResults, variantStats, isThrottled, setThrottled, isEcoMode, entryCount, hitCount
  } = useTradingStore(state => ({
    sessionActive: state.sessionActive,
    sessionPaused: state.sessionPaused,
    strategyId: state.strategyId,
    balance: state.balance,
    totalPnl: state.totalPnl,
    totalRiskPct: state.totalRiskPct,
    totalSlUsed: state.totalSlUsed,
    activeTrades: state.activeTrades,
    config: state.config,
    setSessionActive: state.setSessionActive,
    updateConfig: state.updateConfig,
    gateState: state.gateState,
    gateReason: state.gateReason,
    scannerPaused: state.scannerPaused,
    sessionList: state.sessionList,
    fetchSessions: state.fetchSessions,
    wsStatus: state.wsStatus,
    sidebarCollapsed: state.sidebarCollapsed,
    variantScannerResults: state.variantScannerResults,
    variantStats: state.variantStats,
    isThrottled: state.isThrottled,
    setThrottled: state.setThrottled,
    isEcoMode: state.isEcoMode,
    entryCount: state.entryCount,
    hitCount: state.hitCount
  }), shallow)

  const safeVariantStats = variantStats || {}


  const { updateStats, setFocusMode } = useTradingStore(state => ({
    updateStats: state.updateStats,
    setFocusMode: state.setFocusMode
  }), shallow)

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let timer;
    if (confirmStop) {
      timer = setTimeout(() => setConfirmStop(false), 3000);
    }
    return () => clearTimeout(timer);
  }, [confirmStop]);

  const currentStrategy = useMemo(() => ({
    sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, activeTrades, entryCount, hitCount,
    strategy_label: config.strategy_label || 'Momentum Strategy'
  }), [sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, activeTrades, entryCount, hitCount, config.strategy_label])

  const maxRR = useMemo(() => activeTrades.reduce((max, trade) => Math.max(max, trade.max_rr || 0), 0), [activeTrades])

  useEffect(() => {
    // When a specific strategy is selected (StrategyDetailView) or scanner is open, 
    // set focus mode to receive heavy updates.
    const strategyLabel = typeof selected === "string" ? selected : null;
    setFocusMode(!!selected || showScanner, null, strategyLabel);
  }, [selected, showScanner, setFocusMode, currentStrategy.strategy_label]);
  useEffect(() => {
    fetchSessions();

    const toggleScanner = () => setShowScanner(prev => !prev);
    window.addEventListener('toggle-scanner', toggleScanner);
    return () => window.removeEventListener('toggle-scanner', toggleScanner);
  }, []);

  async function handleConfigSave(newConfig) {
    setLoading(true)
    setShowConfig(false)
    try {
      let finalConfig = newConfig;
      if (editingVariantIndex !== null) {
        const variants = [...(config.strategy_variants || [])];
        variants[editingVariantIndex] = { ...newConfig, strategy_label: newConfig.strategy_label };
        finalConfig = { ...config, strategy_variants: variants };
      }

      if (isEditMode && strategyId) {
        await sessionAPI.update(strategyId, finalConfig)
        updateConfig(finalConfig)
      } else {
        updateConfig(finalConfig)
        const res = await sessionAPI.start(finalConfig, finalConfig.paper_mode)
        setSessionActive(true, res.data.strategyId || res.data.strategy_id)
      }
      await fetchSessions()
    } catch (e) {
      const isNetworkError = e.message === 'Network Error' || e.code === 'ERR_NETWORK';
      const msg = isNetworkError
        ? 'Network Error: Failed to reach backend. Check your internet or CORS settings.'
        : (e?.response?.data?.detail || e?.response?.data?.message || 'Failed to save config');
      alert(msg)
    } finally {
      setLoading(false)
      setIsEditMode(false)
      setEditingVariantIndex(null)
    }
  }

  async function togglePause() {
    try {
      await sessionAPI.pause(!sessionPaused)
    } catch (e) {
      console.error('Pause toggle failed:', e)
    }
  }

  async function handleResumeLast() {
    if (sessionList.length === 0) return;
    const last = sessionList[0];
    setLoading(true);
    try {
      const res = await sessionAPI.start(last.config, last.paperMode, last.id);
      setSessionActive(true, res.data.strategyId || res.data.strategy_id);
    } catch (e) {
      alert('Failed to resume session');
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    if (!confirmStop) {
      setConfirmStop(true)
      return
    }

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
      setConfirmStop(false)
    }
  }

  if (selected) {
    return (
      <div className={cn(
        "pb-32 transition-all duration-300",
        sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
      )}>
        <Sidebar selected={selected} />
        <Suspense fallback={<LoadingFallback />}>
          <StrategyDetailView s={currentStrategy} onBack={() => setSelected(null)} />
        </Suspense>
        <BottomNav selected={selected} />
      </div>
    )
  }

  const tradingMode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]",
      tradingMode === 'paper' ? "shadow-[inset_0_0_100px_rgba(245,166,35,0.05)] border-amber/10" :
      tradingMode === 'testnet' ? "shadow-[inset_0_0_100px_rgba(168,85,247,0.05)] border-purple/10" :
      "shadow-[inset_0_0_100px_rgba(34,197,94,0.05)] border-green/10"
    )}>
      <Sidebar selected={selected} />
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-10">
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
                {tradingMode === 'paper' && <PaperBadge />}
                {tradingMode === 'testnet' && <DemoBadge />}
                {tradingMode === 'live' && <LiveBadge />}
                {(isThrottled || isEcoMode) && <EcoBadge />}
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

          <div className="flex gap-3">
            <Tooltip content={isThrottled ? "Disable Eco Mode" : "Enable Eco Mode (Power Saver)"}>
              <button
                onClick={() => setThrottled(!isThrottled)}
                className={cn(
                  "p-3 rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-2",
                  isThrottled
                    ? "bg-green/10 border-green/30 text-green shadow-[0_0_15px_rgba(0,229,160,0.1)]"
                    : "bg-surface border-border text-dim hover:text-accent hover:border-accent/40"
                )}
              >
                <Leaf size={18} fill={isThrottled ? "currentColor" : "none"} />
                <span className="hidden md:inline text-[10px] font-bold uppercase tracking-widest">
                  {isThrottled ? "Eco Active" : "Eco Mode"}
                </span>
              </button>
            </Tooltip>

            {!sessionActive ? (
              <Btn variant="success" onClick={() => { setIsEditMode(false); setSelectedConfig(null); setEditingVariantIndex(null); setShowConfig(true); }} disabled={loading} className="flex-1 sm:flex-none">
                <Plus size={16} className="mr-2" /> New Session
              </Btn>
            ) : (
              <Btn
                variant="danger"
                onClick={handleStop}
                disabled={loading}
                aria-label={loading ? "Terminating session" : confirmStop ? "Confirm terminate session" : "Terminate session"}
                className={cn(
                  "flex-1 sm:flex-none transition-all duration-300 relative overflow-hidden",
                  confirmStop && "bg-red/80 animate-pulse"
                )}
              >
                <motion.div
                  initial={false}
                  animate={{ y: confirmStop ? -20 : 0, opacity: confirmStop ? 0 : 1 }}
                  className="flex items-center"
                >
                  <XCircle size={16} className="mr-2" />
                </motion.div>
                <span aria-live="polite" className="relative">
                  {loading ? 'Terminating...' : confirmStop ? 'Confirm Stop?' : 'Terminate Session'}
                </span>
              </Btn>
            )}
          </div>
        </motion.div>

        <GateBanner
          gateState={gateState}
          scannerPaused={scannerPaused}
          reason={gateReason}
          activeTradesCount={activeTrades.length}
        />

        {/* Global Metrics */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10"
        >
          <StatCard label="Account Balance" value={`$${balance.toLocaleString()}`} />
          <StatCard
            label="Session P&L"
            value={fmtUSD(totalPnl)}
            color={totalPnl >= 0 ? "text-green" : "text-red"}
            subValue={wsStatus !== 'live' ? "Synchronizing..." : undefined}
            syncing={wsStatus !== 'live'}
          />
          <StatCard label="Live Risk" value={`${Number(totalRiskPct || 0).toFixed(1)}%`} color={totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
          <StatCard label="Peak RR" value={`+${Number(maxRR || 0).toFixed(2)}`} color="text-accent" />
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
                  <>
                    <StrategyCard
                      s={{
                        ...currentStrategy,
                        ...safeVariantStats[currentStrategy.strategy_label]
                      }}
                      scannerResults={variantScannerResults[currentStrategy.strategy_label]}
                      config={config}
                      paused={sessionPaused}
                      onPause={togglePause}
                      onEdit={() => { setIsEditMode(true); setSelectedConfig(config); setEditingVariantIndex(null); setShowConfig(true); }}
                      onClick={() => setSelected(currentStrategy.strategy_label)}
                    />
                    {(config.strategy_variants || []).filter(v => v.enabled !== false).map((variant, i) => {
                      const label = variant.strategy_label || `Variant ${i + 1}`;
                      const variantConfig = { ...config, ...variant };
                      return (
                        <StrategyCard
                          key={i}
                          s={{
                            ...currentStrategy,
                            strategy_label: label,
                            ...safeVariantStats[label]
                          }}
                          scannerResults={variantScannerResults[label]}
                          config={variantConfig}
                          paused={sessionPaused}
                          onPause={togglePause}
                          onEdit={() => { setIsEditMode(true); setSelectedConfig(variantConfig); setEditingVariantIndex(i); setShowConfig(true); }}
                          onClick={() => setSelected(label)}
                        />
                      );
                    })}                  </>
                ) : (
                  <button
                    onClick={() => { setIsEditMode(false); setSelectedConfig(null); setEditingVariantIndex(null); setShowConfig(true); }}
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
                  <div key={s.id} className="bg-surface/40 border border-border/60 rounded-2xl p-6 flex flex-col gap-6 opacity-90 h-[256px] relative group/prev">
                    {!sessionActive && (
                      <div className="absolute inset-0 bg-accent/5 backdrop-blur-[1px] rounded-2xl z-10 flex items-center justify-center opacity-0 group-hover/prev:opacity-100 transition-opacity">
                        <button
                          onClick={handleResumeLast}
                          disabled={loading}
                          className="bg-accent text-white px-6 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-xl active:scale-95 transition-transform"
                        >
                          <RefreshCw size={14} className={cn(loading && "animate-spin")} /> Resume Session
                        </button>
                      </div>
                    )}
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-[10px] text-dim font-bold tracking-widest uppercase mb-2">Previous Session</div>
                        <div className="text-base font-bold">{s.config?.strategy_label || 'Momentum Strategy'}</div>
                        <div className="text-[10px] text-dim font-bold uppercase mt-1 tracking-tight">
                          {s.config?.scan_interval} · {s.config?.scan_pct_threshold}% threshold
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={cn("text-xl font-bold font-mono", s.totalPnl >= 0 ? "text-green" : "text-red")}>
                          {fmtUSD(s.totalPnl)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-auto pt-5 border-t border-border/20 flex justify-between items-center relative z-20">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-dim font-bold font-mono">ID: {s.id.substring(0, 8)}</span>
                        <CopyButton value={s.id} className="p-1" />
                      </div>
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

            {/* Right Workspace (Context) */}
            <motion.div
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="space-y-10">
              <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col h-[450px] shadow-sm">
                <SectionLabel className="mb-4">
                  <Activity size={14} className="text-accent" /> Session Logs
                </SectionLabel>
                <div className="flex-1 overflow-hidden">
                  <Suspense fallback={<LoadingFallback />}>
                    <DecisionLog />
                  </Suspense>
                </div>
              </div>
            </motion.div>
        </div>
          </div>

        {/* Modals & Drawers */}
        <Drawer.Root open={showConfig} onOpenChange={setShowConfig}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
            <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[32px] h-full max-h-[96%] fixed bottom-0 left-0 right-0 z-50 focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:max-w-[800px] lg:mx-auto">
              <div className="p-2 bg-background rounded-t-[32px] flex flex-col items-center shrink-0">
                <div className="w-12 h-1.5 bg-border rounded-full mb-2" />
                <VisuallyHidden>
                  <Drawer.Title>Configuration</Drawer.Title>
                  <Drawer.Description>Form to configure trading strategy parameters</Drawer.Description>
                </VisuallyHidden>
              </div>
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<LoadingFallback />}>
                  <ConfigModal
                    key={isEditMode ? (selectedConfig?.id || strategyId) : 'new'}
                    initialConfig={selectedConfig || config}
                    onSave={handleConfigSave}
                    onClose={() => setShowConfig(false)}
                    isEdit={isEditMode}
                  />
                </Suspense>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        <Drawer.Root open={showScanner} onOpenChange={setShowScanner}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
            <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[32px] h-full max-h-[96%] fixed bottom-0 left-0 right-0 z-50 focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:max-w-[1000px] lg:mx-auto">
              <div className="p-2 bg-background rounded-t-[32px] flex flex-col items-center shrink-0">
                <div className="w-12 h-1.5 bg-border rounded-full mb-2" />
                <VisuallyHidden>
                  <Drawer.Title>Scanner</Drawer.Title>
                  <Drawer.Description>View live market scanner opportunities</Drawer.Description>
                </VisuallyHidden>
              </div>
              <div className="flex-1 overflow-y-auto">
                <Suspense fallback={<LoadingFallback />}>
                  {showScanner && <ScannerOverlay onClose={() => setShowScanner(false)} />}
                </Suspense>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        {/* Mobile Floating Controls */}
        <Tooltip content="Open Market Scanner" side="left">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowScanner(true)}
            aria-label="Open Market Scanner"
            className="lg:hidden fixed bottom-24 right-6 w-16 h-16 rounded-full bg-accent text-white shadow-2xl flex items-center justify-center z-40 animate-in fade-in zoom-in duration-500"
          >
            <Zap size={28} />
          </motion.button>
        </Tooltip>

        <BottomNav selected={selected} />
      </div>
    </div>
  </div>
  )
}
