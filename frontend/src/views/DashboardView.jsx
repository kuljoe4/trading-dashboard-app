import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { shallow } from 'zustand/shallow'
import { pnlColor, pnlClass, fmtUSD, C, safeNum } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { sessionAPI } from '../api/client'
import { 
  StatCard, InteractiveLimitCard, SectionLabel, Btn, StatusBadge, PaperBadge, EcoBadge, DemoBadge, LiveBadge,
    ConditionWidget, PulseDot, Sparkline, PnLBars, CopyButton, cn, Tooltip, VisuallyHidden, ViewHeader
  } from '../components/ui/primitives'
import {
  ChevronLeft, Plus, Trash2, LayoutDashboard, History,
  Settings as SettingsIcon, Activity, Zap, ShieldCheck,
  BarChart3, XCircle, Pause, Play, Edit3, RefreshCw, Leaf,
  Briefcase, TrendingUp, ArrowRight
} from 'lucide-react'
import { Drawer } from 'vaul'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar, BottomNav } from '../components/Navigation'

const TemporalRiskGrid = React.memo(() => {
  const { config, gateState, gateReason, isAdaptiveTightened, configSyncing, patchConfig, tradesInPeriod, maxTradesPeriod, tradesIn24h, maxTrades24h } = useTradingStore(state => ({
    config: state.config,
    gateState: state.gateState,
    gateReason: state.gateReason,
    isAdaptiveTightened: state.isAdaptiveTightened,
    configSyncing: state.configSyncing,
    patchConfig: state.patchConfig,
    tradesInPeriod: state.tradesInPeriod,
    maxTradesPeriod: state.maxTradesPeriod,
    tradesIn24h: state.tradesIn24h,
    maxTrades24h: state.maxTrades24h
  }), shallow);

  const timeMatch = gateReason?.match(/~(\d+)(m|h)/);
  const waitTime = timeMatch ? `${timeMatch[1]}${timeMatch[2]}` : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mb-8 lg:mb-10">
      <InteractiveLimitCard
        label="Period Limit"
        subValue={gateState === 'max_trades_period' ? `Wait ~${waitTime}` : (isAdaptiveTightened ? 'x0.5 Applied' : (tradesInPeriod !== undefined ? `${Math.max(0, (maxTradesPeriod || config.max_trades_per_period) - tradesInPeriod)} Remaining` : null))}
        tooltip="Maximum trades allowed within the sliding period window."
        value={config.max_trades_per_period || 0}
        min={0}
        max={100}
        onIncrement={() => patchConfig({ max_trades_per_period: (config.max_trades_per_period || 0) + 1 })}
        onDecrement={() => patchConfig({ max_trades_per_period: Math.max(0, (config.max_trades_per_period || 0) - 1) })}
        syncing={configSyncing}
        usagePct={tradesInPeriod !== undefined ? (tradesInPeriod / (maxTradesPeriod || config.max_trades_per_period || 1)) * 100 : undefined}
      />

      <InteractiveLimitCard
        label="Window"
        subValue="Sliding"
        tooltip="Duration of the sliding window for frequency limits."
        value={config.trades_period_min || 60}
        unit="m"
        min={1}
        max={1440}
        onIncrement={() => patchConfig({ trades_period_min: (config.trades_period_min || 60) + 5 })}
        onDecrement={() => patchConfig({ trades_period_min: Math.max(1, (config.trades_period_min || 60) - 5) })}
        syncing={configSyncing}
      />

      <InteractiveLimitCard
        label="24h Limit"
        subValue={gateReason?.includes('24h limit') ? `Wait ~${waitTime}` : (tradesIn24h !== undefined ? `${Math.max(0, (maxTrades24h || config.max_trades_24h) - tradesIn24h)} Remaining` : (config.frequency_shaping_enabled ? 'Rolling' : 'Inactive'))}
        tooltip="Total trade entry quota for a rolling 24-hour period."
        value={config.max_trades_24h || 0}
        min={0}
        max={500}
        onIncrement={() => patchConfig({ max_trades_24h: (config.max_trades_24h || 0) + 5 })}
        onDecrement={() => patchConfig({ max_trades_24h: Math.max(0, (config.max_trades_24h || 0) - 5) })}
        syncing={configSyncing}
        disabled={config.frequency_shaping_enabled === false}
        usagePct={tradesIn24h !== undefined ? (tradesIn24h / (maxTrades24h || config.max_trades_24h || 1)) * 100 : undefined}
      />

      <InteractiveLimitCard
        label="Spacing"
        tooltip="Minimum interval required between any two trade entries. Tightens adaptively when TOD integration is active."
        value={config.min_trade_interval_min || 0}
        unit="m"
        min={0}
        max={1440}
        onIncrement={() => patchConfig({ min_trade_interval_min: (config.min_trade_interval_min || 0) + 1 })}
        onDecrement={() => patchConfig({ min_trade_interval_min: Math.max(0, (config.min_trade_interval_min || 0) - 1) })}
        syncing={configSyncing}
        disabled={config.frequency_shaping_enabled === false}
        indicator={config.frequency_tod_integration && isAdaptiveTightened ? 'amber' : null}
        subValue={gateReason?.includes('Trade spacing') ? `Wait ~${waitTime}` : (isAdaptiveTightened ? `x2 Applied` : null)}
      />

      <InteractiveLimitCard
        label="Jitter"
        subValue={config.trades_jitter_pct > 0 ? 'Randomized' : 'Fixed'}
        tooltip="Randomized variation added to the period window to prevent execution stampedes."
        value={config.trades_jitter_pct || 0}
        unit="%"
        min={0}
        max={100}
        onIncrement={() => patchConfig({ trades_jitter_pct: (config.trades_jitter_pct || 0) + 5 })}
        onDecrement={() => patchConfig({ trades_jitter_pct: Math.max(0, (config.trades_jitter_pct || 0) - 5) })}
        syncing={configSyncing}
        disabled={config.frequency_shaping_enabled === false}
      />
    </div>
  );
});

// Lazy Load heavy components
const DecisionLog = lazy(() => import('../components/DecisionLog').then(module => ({ default: module.DecisionLog })))
const ConfigModal = lazy(() => import('../components/ConfigModal').then(module => ({ default: module.ConfigModal })))
const ScannerOverlay = lazy(() => import('../components/ScannerOverlay').then(module => ({ default: module.ScannerOverlay })))
import { ConfirmationModal } from '../components/ConfirmationModal'
const StrategyDetailView = lazy(() => import('./StrategyDetailView'))

const LoadingFallback = () => (
  <div className="flex items-center justify-center p-20">
    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
)

// --- Strategy Card ---
const StrategyCard = React.memo(({ s, config, onClick, onPause, onEdit, paused, scannerResults, onOpenScanner, className }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const slPct = Math.min(((s.totalSlUsed / config.total_sl_guard_usdt) * 100) || 0, 100);
  const tradingMode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <motion.div
      layout
      whileHover={{ scale: 1.01 }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      className={cn(
        "bg-surface border border-border/40 rounded-2xl p-5 md:p-6 cursor-pointer transition-all relative group shadow-sm h-full focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-w-0",
        tradingMode === 'paper' ? "hover:border-amber/30 hover:shadow-amber/5" :
        tradingMode === 'testnet' ? "hover:border-purple/30 hover:shadow-purple/5" :
        "hover:border-green/30 hover:shadow-green/5",
        className
      )}
    >
      {paused && (
        <div className="absolute inset-0 bg-background/40 backdrop-blur-[1px] rounded-2xl z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-amber/10 border border-amber/20 text-amber px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-2xl">
            <Pause size={12} fill="currentColor" /> Session Paused
          </div>
        </div>
      )}
        <div className="flex justify-between items-start mb-5 md:mb-6 min-w-0 gap-3" aria-live="polite">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2.5 md:mb-3 flex-wrap">
            <StatusBadge status={s.sessionActive} />
            <div className="flex items-center gap-1.5 scale-90 origin-left">
              {tradingMode === 'paper' && <PaperBadge />}
              {tradingMode === 'testnet' && <DemoBadge />}
              {tradingMode === 'live' && <LiveBadge />}
            </div>
          </div>
          <div className="text-sm md:text-lg font-black tracking-tight truncate uppercase">{s.strategy_label}</div>
          <div className="text-[9px] md:text-[10px] text-dim mt-1.5 font-black uppercase tracking-widest flex flex-col gap-1 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0 whitespace-nowrap">
              <Zap size={10} className={cn("text-accent shrink-0", config.global_scanner_enabled === false && "text-dim")} />
              <span className={cn("truncate", config.global_scanner_enabled === false && "line-through decoration-red/40 decoration-2")}>
                {config.scan_interval} · {config.scan_pct_threshold}%
              </span>
            </div>
            {(config.single_symbol_configs || []).filter(sc => sc.enabled).length > 0 && (
              <div className="flex items-center gap-2 whitespace-nowrap overflow-hidden">
                <ShieldCheck size={12} className="text-accent shrink-0" />
                <span className="truncate">{config.single_symbol_configs.filter(sc => sc.enabled).length} Symbol Monitors Active</span>
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
                  "p-2 bg-surface border border-border rounded-lg transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-accent outline-none",
                  isExpanded ? "text-accent border-accent/40" : "hover:border-accent/40 hover:text-accent"
                )}
              >
                <Activity size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Edit Config">
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                className="p-2 bg-surface border border-border rounded-lg hover:border-accent/40 hover:text-accent transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-accent outline-none"
                aria-label="Edit strategy configuration"
              >
                <Edit3 size={14} />
              </button>
            </Tooltip>
            <Tooltip content={paused ? "Resume Session" : "Pause Session"}>
              <button
                onClick={(e) => { e.stopPropagation(); onPause(); }}
                className={cn(
                  "p-2 border rounded-lg transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-accent outline-none",
                  paused ? "bg-green/10 border-green/20 text-green hover:bg-green/20" : "bg-amber/10 border-amber/20 text-amber hover:bg-amber/20"
                )}
                aria-label={paused ? "Resume strategy session" : "Pause strategy session"}
              >
                {paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
              </button>
            </Tooltip>
          </div>
          <div className="text-lg md:text-xl lg:text-2xl font-black font-mono tracking-tighter" style={{ color: pnlColor(s.activePnl) }}>
            {fmtUSD(s.activePnl)}
          </div>
          <div className="text-[9px] md:text-[10px] text-dim font-black uppercase tracking-widest mt-1.5 flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="opacity-40">Session:</span>
              <span style={{ color: pnlColor(s.totalPnl) }}>{fmtUSD(s.totalPnl)}</span>
            </div>
            <div className="opacity-60">{s.entryCount} ENT · {s.hitCount} HIT</div>
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
              <ScannerPreview scannerResults={scannerResults || []} config={config} onOpen={(e) => { e.stopPropagation(); onOpenScanner(); }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
})

const GateBanner = ({ gateState, scannerPaused, reason, hibernating, activeTradesCount }) => {
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
        (hibernating || isGatedIdle) && "bg-accent/5 border-accent/20 text-accent/80"
      )}
    >
      <div className="flex items-center gap-3">
        {hibernating ? <Zap size={16} className="text-accent animate-pulse opacity-50" /> : gateState === 'sleeping' ? <Pause size={16} className="animate-pulse" /> : <XCircle size={16} className={scannerPaused ? "animate-pulse" : ""} />}
        <span className="uppercase tracking-widest">{messages[gateState] || 'Risk gate active.'}</span>
        {hibernating ? (
           <Tooltip content="Deep Sleep (Hibernation) Active: All market data connections closed to save maximum CPU/Memory. Engine will wake up automatically when limit expires.">
            <div className="ml-auto bg-accent/20 px-2 py-0.5 rounded text-[10px] flex items-center gap-1.5 border border-accent/40 text-accent">
              <Zap size={10} fill="currentColor" /> DEEP SLEEP
            </div>
          </Tooltip>
        ) : isGatedIdle && (
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
        <div className="flex flex-col">
          <SectionLabel className="mb-0">
            <Zap size={14} className="text-accent" /> Live Scanner
          </SectionLabel>
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest mt-0.5">Top 5 Opportunities</span>
        </div>
        <button className="text-[11px] font-bold text-accent hover:text-accent/80 transition-colors uppercase tracking-widest" aria-label="View all scanner results" onClick={onOpen}>Open Full</button>
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
                      "flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/5 h-[56px] group",
                      !isLast && "border-b border-border/40",
                      !passing && "opacity-60"
                    )}
                  >
                    <span className="text-[10px] text-dim font-mono w-4">#{i + 1}</span>
                    <strong className="text-xs font-mono w-16">{opp.symbol.replace('USDT', '')}</strong>
                    <CopyButton value={opp.symbol} tooltip="Copy Symbol" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 -ml-2" />
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
                "h-[56px] flex items-center px-4 opacity-10 grayscale",
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

export function DashboardView({ initialStrategy }) {
  const [selected, setSelected] = useState(initialStrategy || null)
  const [showConfig, setShowConfig] = useState(false)
  const [modalConfig, setModalConfig] = useState(null)
  const [showScanner, setShowScanner] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedConfig, setSelectedConfig] = useState(null)
  const [editingVariantIndex, setEditingVariantIndex] = useState(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState(null)

  const {
    sessionActive, sessionPaused, strategyId, balance, totalPnl, totalRiskPct,
    totalSlUsed, activeTrades, config, setSessionActive,
    updateConfig, patchConfig, gateState, gateReason, hibernating,
    scannerPaused, sessionList, fetchSessions, wsStatus,
    sidebarCollapsed, variantScannerResults, variantStats, isThrottled, setThrottled, isEcoMode, entryCount, hitCount,
    healthEnabled, isSyncing, setSyncing, configSyncing, isAdaptiveTightened
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
    patchConfig: state.patchConfig,
    gateState: state.gateState,
    gateReason: state.gateReason,
    hibernating: state.hibernating,
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
    hitCount: state.hitCount,
    healthEnabled: state.healthEnabled,
    isSyncing: state.isSyncing,
    setSyncing: state.setSyncing,
    configSyncing: state.configSyncing,
    isAdaptiveTightened: state.isAdaptiveTightened
  }), shallow)

  useEffect(() => {
    if (showConfig) {
      setModalConfig(selectedConfig || config);
    } else {
      setModalConfig(null);
    }
  }, [showConfig, selectedConfig, config]);

  const safeVariantStats = variantStats || {}

  const currentStrategy = useMemo(() => ({
    sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, activeTrades, entryCount, hitCount,
    strategy_label: config.strategy_label || 'Momentum Strategy'
  }), [sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, activeTrades, entryCount, hitCount, config.strategy_label])

  const activePnlMap = useMemo(() => {
    const map = { [currentStrategy.strategy_label]: 0 };
    (config.strategy_variants || []).forEach(v => {
      const label = v.strategy_label || 'Variant';
      map[label] = 0;
    });
    activeTrades.forEach(t => {
      if (t && map[t.strategy_label] !== undefined) {
        map[t.strategy_label] += safeNum(t.pnl);
      }
    });
    return map;
  }, [activeTrades, currentStrategy.strategy_label, config.strategy_variants]);

  const totalActivePnl = useMemo(() =>
    Object.values(activePnlMap).reduce((acc, val) => acc + val, 0)
  , [activePnlMap]);


  const { updateStats } = useTradingStore(state => ({
    updateStats: state.updateStats
  }), shallow)

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let timer;
    if (confirmStop) {
      timer = setTimeout(() => setConfirmStop(false), 3000);
    }
    return () => clearTimeout(timer);
  }, [confirmStop]);

  const maxRR = useMemo(() => activeTrades.reduce((max, trade) => Math.max(max, trade.max_rr || 0), 0), [activeTrades])

  useEffect(() => {
    // Legacy support for scanner-only focus if not handled by hook
    if (showScanner) {
       useTradingStore.getState().registerInterest('scanner');
       return () => useTradingStore.getState().unregisterInterest('scanner');
    }
  }, [showScanner]);
  useEffect(() => {
    fetchSessions();

    const toggleScanner = () => setShowScanner(prev => !prev);
    window.addEventListener('toggle-scanner', toggleScanner);
    return () => window.removeEventListener('toggle-scanner', toggleScanner);
  }, []);

  async function handleConfigSave(newConfig) {
    setLoading(true)
    setSyncing(true)
    useTradingStore.setState({ configSyncing: true }); // Enable global sync protection
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
      setSyncing(false)
      useTradingStore.setState({ configSyncing: false });
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
    setSyncing(true);
    try {
      const res = await sessionAPI.start(last.config, last.paperMode, last.id);
      setSessionActive(true, res.data.strategyId || res.data.strategy_id);
    } catch (e) {
      alert('Failed to resume session');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  async function handleStop() {
    setLoading(true)
    setSyncing(true)
    try {
      await sessionAPI.stop()
      setSessionActive(false, null)
      await fetchSessions()
    } catch (e) {
      setSessionActive(false, null)
      await fetchSessions()
    } finally {
      setLoading(false)
      setSyncing(false)
      setConfirmStop(false)
    }
  }

  async function handleDeleteSession() {
    if (!sessionToDelete) return
    setLoading(true)
    setSyncing(true)
    try {
      await sessionAPI.delete(sessionToDelete)
      await fetchSessions()
    } catch (e) {
      alert('Failed to delete session')
    } finally {
      setLoading(false)
      setSyncing(false)
      setSessionToDelete(null)
    }
  }

  if (selected) {
    const strategyData = {
      ...currentStrategy,
      strategy_label: selected,
      ...safeVariantStats[selected],
      activePnl: activePnlMap[selected] || 0
    };

    return (
      <div className={cn(
        "transition-all duration-300",
        healthEnabled ? "pb-48 lg:pb-8" : "pb-32 lg:pb-8",
        sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
      )}>
        <Sidebar selected={selected} />
        <Suspense fallback={<LoadingFallback />}>
          <StrategyDetailView s={strategyData} onBack={() => setSelected(null)} />
        </Suspense>
        <BottomNav selected={selected} />
      </div>
    )
  }

  const tradingMode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300 relative",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]",
      tradingMode === 'paper' ? "shadow-[inset_0_0_100px_rgba(245,166,35,0.05)] border-amber/10" :
      tradingMode === 'testnet' ? "shadow-[inset_0_0_100px_rgba(168,85,247,0.05)] border-purple/10" :
      "shadow-[inset_0_0_100px_rgba(34,197,94,0.05)] border-green/10"
    )}>
      {/* Audit Item 40: Persistent Paper Mode Indicator */}
      {tradingMode === 'paper' && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-amber z-[100] shadow-[0_2px_10px_rgba(245,166,35,0.5)]" />
      )}
      <Sidebar selected={selected} />
      <div className={cn(
        "max-w-[1600px] mx-auto p-4 md:p-10 lg:pb-10 transition-all",
        healthEnabled ? "pb-48" : "pb-32"
      )}>

        <ConfirmationModal
          isOpen={confirmStop}
          onClose={() => setConfirmStop(false)}
          onConfirm={handleStop}
          title="Terminate Trading Session?"
          message="This will immediately close all open positions at market price and stop the engine. This action cannot be undone."
          confirmText="Terminate Everything"
          loading={loading}
        />

        <ConfirmationModal
          isOpen={!!sessionToDelete}
          onClose={() => setSessionToDelete(null)}
          onConfirm={handleDeleteSession}
          title="Delete Session History?"
          message="This will permanently remove this session's records from your history. This action cannot be undone."
          confirmText="Delete Permanently"
          loading={loading}
        />

        {/* Header Bar */}
        <ViewHeader
          title="Operator Cockpit"
          subTitle="Real-time strategy management & market oversight"
          sticky={true}
        >
          <div className="flex gap-3">
            {config.frequency_shaping_enabled && (
              <Tooltip content="Adaptive Frequency Shaping is ACTIVE. Limits will automatically tighten if TOD performance drops.">
                <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/20 rounded-xl text-[10px] font-bold text-accent uppercase tracking-widest animate-in fade-in zoom-in duration-500">
                  <Activity size={12} />
                  Frequency Guard
                </div>
              </Tooltip>
            )}

            <Tooltip content={isThrottled ? "Disable Eco Mode" : "Enable Eco Mode (Power Saver)"}>
              <button
                onClick={() => setThrottled(!isThrottled)}
                className={cn(
                  "p-3 rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-accent outline-none",
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

            {sessionActive && (
              <Btn
                variant="danger"
                onClick={() => setConfirmStop(true)}
                disabled={loading}
                className="flex-1 sm:flex-none"
                aria-label="Immediately stop all trading and close positions"
              >
                <XCircle size={16} className="mr-2" /> Terminate Session
              </Btn>
            )}
          </div>
        </ViewHeader>

        <div aria-live="polite">
          <GateBanner
            gateState={gateState}
            scannerPaused={scannerPaused}
            reason={gateReason}
            hibernating={hibernating}
            activeTradesCount={activeTrades.length}
          />
        </div>

        {/* Global Metrics & Temporal Risk - Prioritized (UX-001) */}
        <div className="flex flex-col gap-10 lg:gap-14 mb-8 lg:mb-10">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <SectionLabel className="mb-4">
              <Activity size={14} className="text-accent" /> Global Metrics
            </SectionLabel>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 gap-y-4">
              <StatCard label="Account Balance" value={`$${balance.toLocaleString()}`} tooltipText="Total available funds in the trading account." />
              <StatCard
                label="Active P&L"
                value={fmtUSD(totalActivePnl)}
                color={pnlClass(totalActivePnl)}
                subValue={`Total: ${fmtUSD(totalPnl)}`}
                syncing={wsStatus !== 'live'}
                tooltipText="Current P&L from open trades vs. total session performance."
              />
              <StatCard
                label="Live Risk"
                value={`${Number(totalRiskPct || 0).toFixed(1)}%`}
                color={totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"}
                tooltipText="Combined risk percentage across all open positions relative to account equity."
              />
              <StatCard
                label="Peak RR"
                value={`+${Number(maxRR || 0).toFixed(2)}`}
                color="text-accent"
                tooltipText="Maximum Reward-to-Risk ratio achieved during this trading session."
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <SectionLabel className="mb-4">
              <ShieldCheck size={14} className="text-accent" /> Temporal Risk & Limits
            </SectionLabel>
            <TemporalRiskGrid />
          </motion.div>
        </div>


        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 items-start gap-6">

          {/* Left Workspace */}
          <div className="flex flex-col gap-6 lg:gap-10 no-scrollbar overflow-hidden">
            <motion.div
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <SectionLabel>Active Strategy</SectionLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {sessionActive ? (
                  <>
                    {(() => {
                      const activeVariants = (config.strategy_variants || []).filter(v => v.enabled !== false);
                      const totalCards = 1 + activeVariants.length;
                      return (
                        <>
                          <StrategyCard
                            s={{
                              ...currentStrategy,
                              ...safeVariantStats[currentStrategy.strategy_label],
                              activePnl: activePnlMap[currentStrategy.strategy_label] || 0
                            }}
                            scannerResults={variantScannerResults[currentStrategy.strategy_label]}
                            config={config}
                            paused={sessionPaused}
                            onPause={togglePause}
                            onOpenScanner={() => setShowScanner(true)}
                            onEdit={() => { setIsEditMode(true); setSelectedConfig(config); setEditingVariantIndex(null); setShowConfig(true); }}
                            onClick={() => setSelected(currentStrategy.strategy_label)}
                            className={cn(totalCards % 2 !== 0 && "md:col-span-2")}
                          />
                          {activeVariants.map((variant, i) => {
                            const label = variant.strategy_label || `Variant ${i + 1}`;
                            const variantConfig = { ...config, ...variant };
                            return (
                              <StrategyCard
                                key={i}
                                s={{
                                  ...currentStrategy,
                                  strategy_label: label,
                                  ...safeVariantStats[label],
                                  activePnl: activePnlMap[label] || 0
                                }}
                                scannerResults={variantScannerResults[label]}
                                config={variantConfig}
                                paused={sessionPaused}
                                onPause={togglePause}
                                onOpenScanner={() => setShowScanner(true)}
                                onEdit={() => { setIsEditMode(true); setSelectedConfig(variantConfig); setEditingVariantIndex(i); setShowConfig(true); }}
                                onClick={() => setSelected(label)}
                              />
                            );
                          })}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <button
                    onClick={() => { setIsEditMode(false); setSelectedConfig(null); setEditingVariantIndex(null); setShowConfig(true); }}
                    disabled={loading || isSyncing}
                    aria-label="Create new trading session"
                    className={cn(
                      "bg-background border-2 border-dashed border-border rounded-2xl p-6 flex flex-col items-center justify-center gap-4 text-dim transition-all group min-h-[200px] col-span-1 md:col-span-2 w-full",
                      (loading || isSyncing) ? "opacity-30 grayscale cursor-not-allowed pointer-events-none" : "hover:text-accent hover:border-accent/40 hover:bg-accent/5"
                    )}
                  >
                    <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-all shadow-sm">
                      <Plus size={20} />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest">Configure Strategy</span>
                  </button>
                )}

              </div>
            </motion.div>
          </div>

          {/* Right Workspace (Context) - Properly outside the Left Workspace div to use the xl grid column */}
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex flex-col gap-6 lg:gap-10"
          >
            <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col shadow-sm">
              <SectionLabel className="mb-4">
                <Activity size={14} className="text-accent" /> Session Logs
              </SectionLabel>
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<LoadingFallback />}>
                  <DecisionLog />
                </Suspense>
              </div>
              <div className="mt-2 text-[10px] text-dim font-bold uppercase tracking-widest text-center border-t border-border/20 pt-2">
                Log Buffer: Latest 500 events
              </div>
            </div>
          </motion.div>
        </div>

      {/* Modals & Drawers */}
        <Drawer.Root open={showConfig} onOpenChange={setShowConfig}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" />
            <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[32px] h-full max-h-[96%] fixed bottom-0 left-0 right-0 z-[101] focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:max-w-[800px] lg:mx-auto">
              <div className="p-2 bg-background rounded-t-[32px] flex flex-col items-center shrink-0">
                <div className="w-12 h-1.5 bg-border rounded-full mb-2" />
                <VisuallyHidden>
                  <Drawer.Title>Configuration</Drawer.Title>
                  <Drawer.Description>Form to configure trading strategy parameters</Drawer.Description>
                </VisuallyHidden>
              </div>
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<LoadingFallback />}>
                  {modalConfig && (
                    <ConfigModal
                      key={isEditMode ? (selectedConfig?.id || strategyId || 'edit') : 'new'}
                      initialConfig={modalConfig}
                      onSave={handleConfigSave}
                      onClose={() => setShowConfig(false)}
                      isEdit={isEditMode}
                    />
                  )}
                </Suspense>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        <Drawer.Root open={showScanner} onOpenChange={setShowScanner}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" />
            <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[32px] h-full max-h-[96%] fixed bottom-0 left-0 right-0 z-[101] focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:max-w-[1000px] lg:mx-auto">
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
        <div className="lg:hidden fixed bottom-24 right-6 flex flex-col gap-4 z-[100]">
          <Tooltip content="Open Market Scanner" side="left">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowScanner(true)}
              aria-label="Open Market Scanner"
              className="w-10 h-10 rounded-full bg-accent text-white shadow-2xl flex items-center justify-center animate-in fade-in zoom-in duration-500"
            >
              <Zap size={20} />
            </motion.button>
          </Tooltip>
        </div>

        <BottomNav selected={selected} />
      </div>
    </div>
  )
}
