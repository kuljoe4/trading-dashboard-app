import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { shallow } from 'zustand/shallow'
import { pnlColor, pnlClass, fmtUSD, C, safeNum } from '../lib/theme'
import { formatDuration } from '../lib/formatters'
import { useTradingStore } from '../store/trading'
import { sessionAPI } from '../api/client'
import { 
  StatCard, InteractiveLimitCard, SectionLabel, Btn, StatusBadge, PaperBadge, EcoBadge, DemoBadge, LiveBadge,
    ConditionWidget, PulseDot, Sparkline, PnLBars, CopyButton, cn, Tooltip, VisuallyHidden, ViewHeader, MonitoredBadge, InPosBadge
  } from '../components/ui/primitives'
import {
  ChevronLeft, ChevronRight, Plus, Trash2, LayoutDashboard, History,
  Settings as SettingsIcon, Activity, Zap, ShieldCheck,
  BarChart3, XCircle, Pause, Play, Edit3, RefreshCw, Leaf,
  Briefcase, TrendingUp, TrendingDown, ArrowRight, AlertCircle, CheckCircle2, Info, Loader2
} from 'lucide-react'
import { Drawer } from 'vaul'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar, BottomNav } from '../components/Navigation'
import { lazyWithRetry } from '../lib/lazy'
import { ConfirmationModal } from '../components/ConfirmationModal'

const TemporalRiskGrid = React.memo(() => {
  const { config, gateState, gateReason, isAdaptiveTightened, configSyncing, patchConfig, tradesInPeriod, maxTradesPeriod, tradesIn24h, maxTrades24h, effectivePeriodMs, nextSlotTs } = useTradingStore(state => ({
    config: state.config,
    gateState: state.gateState,
    gateReason: state.gateReason,
    isAdaptiveTightened: state.isAdaptiveTightened,
    configSyncing: state.configSyncing,
    patchConfig: state.patchConfig,
    tradesInPeriod: state.tradesInPeriod,
    maxTradesPeriod: state.maxTradesPeriod,
    tradesIn24h: state.tradesIn24h,
    maxTrades24h: state.maxTrades24h,
    effectivePeriodMs: state.effectivePeriodMs,
    nextSlotTs: state.nextSlotTs
  }), shallow);

  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!nextSlotTs) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [nextSlotTs]);

  const nextSlotSec = nextSlotTs ? Math.max(0, Math.ceil((nextSlotTs - now) / 1000)) : null;
  const waitTime = nextSlotSec !== null
    ? (nextSlotSec > 60 ? `${Math.ceil(nextSlotSec / 60)}m` : `${nextSlotSec}s`)
    : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mb-8 lg:mb-10">
      <InteractiveLimitCard
        label="Period Limit"
        subValue={tradesInPeriod !== undefined ? `${Math.max(0, (maxTradesPeriod || config.max_trades_per_period) - tradesInPeriod)} Remaining${isAdaptiveTightened ? ' (x0.5)' : ''}` : (isAdaptiveTightened ? 'x0.5 Applied' : null)}
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
        subValue={effectivePeriodMs ? `Effective: ${Math.round(effectivePeriodMs / 60000)}m` : "Sliding"}
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
        subValue={tradesIn24h !== undefined ? `${Math.max(0, (maxTrades24h || config.max_trades_24h) - tradesIn24h)} Remaining` : (config.max_trades_24h > 0 ? 'Rolling' : 'Inactive')}
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
        subValue={config.trades_jitter_pct > 0 ? (config.trades_jitter_market_aware ? 'Market-Aware' : 'Randomized') : 'Fixed'}
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
const DecisionLog = lazyWithRetry(() => import('../components/DecisionLog').then(module => ({ default: module.DecisionLog })))
const ConfigModal = lazyWithRetry(() => import('../components/ConfigModal').then(module => ({ default: module.ConfigModal })))
const ScannerOverlay = lazyWithRetry(() => import('../components/ScannerOverlay').then(module => ({ default: module.ScannerOverlay })))
const EquityCurve = lazyWithRetry(() => import('../components/Analytics').then(module => ({ default: module.EquityCurve })))
const StrategyDetailView = lazyWithRetry(() => import('./StrategyDetailView'))

const LoadingFallback = () => (
  <div className="flex items-center justify-center p-20">
    <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
)

const BanBanner = ({ apiStatus }) => {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!apiStatus?.banUntil) return;

    const update = () => {
      const until = new Date(apiStatus.banUntil).getTime();
      const remaining = until - Date.now();
      setTimeLeft(Math.max(0, remaining));
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [apiStatus?.banUntil]);

  // BOLT: The local timer (timeLeft) is the source of truth for the cooldown.
  // We hide the banner if the time has passed, even if the backend hasn't updated its status bit yet.
  if (timeLeft <= 0) return null;
  if (!apiStatus?.isBanned && !apiStatus?.isRateLimited) return null;

  const isBan = apiStatus.isBanned;
  const cooldownEnd = apiStatus.banUntil ? new Date(apiStatus.banUntil).toLocaleTimeString() : 'unknown';

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      aria-live="polite"
      className={cn(
        "p-5 rounded-2xl mb-6 flex flex-col md:flex-row items-center gap-4 shadow-xl border",
        isBan ? "bg-red/20 border-red/40 shadow-red/5" : "bg-amber/20 border-amber/40 shadow-amber/5"
      )}
    >
      <div className={cn(
        "w-12 h-12 rounded-full flex items-center justify-center shrink-0 animate-pulse",
        isBan ? "bg-red/20 text-red" : "bg-amber/20 text-amber"
      )}>
        <AlertCircle size={24} />
      </div>
      <div className="flex-1 text-center md:text-left">
        <h3 className={cn(
          "text-sm font-black uppercase tracking-tight mb-1",
          isBan ? "text-red" : "text-amber"
        )}>
          {isBan ? 'Binance IP Ban' : 'Rate Limit Protection'}
        </h3>
        <p className={cn(
          "text-xs font-bold",
          isBan ? "text-red/80" : "text-amber/80"
        )}>
          {apiStatus.lastErrorMessage || `Automatic requests are paused to protect your account standing. Normal operations will resume shortly.`}
        </p>
      </div>
      <div className="flex flex-col items-center md:items-end gap-1.5 shrink-0">
        <div className={cn(
          "px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border flex items-center gap-2",
          isBan ? "bg-red/20 border-red/30 text-red" : "bg-amber/20 border-amber/30 text-amber"
        )}>
          <span className="w-2 h-2 rounded-full bg-current motion-safe:animate-ping" aria-hidden="true" />
          {timeLeft > 0 ? formatDuration(timeLeft) : 'Expiring...'}
        </div>
        <div className="flex items-center gap-1.5 opacity-60">
          <History size={10} />
          <span className="text-[9px] font-bold uppercase tracking-tighter">Ends at {cooldownEnd}</span>
        </div>
      </div>
    </motion.div>
  );
};

// --- Strategy Card ---
export const StrategyCard = React.memo(({ s, config, onClick, onPause, onEdit, paused, gateInfo, className, isResuming, showResumingFeedback }) => {
  const isGated = gateInfo && ['max_trades', 'sl_guard', 'max_trades_period', 'sleeping', 'risk_pct', 'tod_risk', 'risk'].includes(gateInfo.gateState || '');
  const tradingMode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

  const startingBalance = tradingMode === 'paper'
    ? (config.paper_starting_balance || 10000)
    : (tradingMode === 'testnet'
        ? (config.testnet_starting_balance || 10000)
        : (config.live_starting_balance || 10000));

  const sessionReturnPct = startingBalance > 0 ? (s.totalPnl / startingBalance) * 100 : 0;

  const handleCardClick = React.useCallback((e) => {
    onClick(s.strategy_label);
  }, [onClick, s.strategy_label]);

  const handleEditClick = React.useCallback((e) => {
    e.stopPropagation();
    onEdit(s.strategy_label);
  }, [onEdit, s.strategy_label]);

  const handlePauseClick = React.useCallback((e) => {
    e.stopPropagation();
    onPause(s.strategy_label);
  }, [onPause, s.strategy_label]);

  return (
    <motion.div
      whileHover={{ scale: 1.005 }}
      onClick={handleCardClick}
      className={cn(
        "bg-[#161B26] p-4 rounded-2xl transition-all relative flex flex-col justify-between shadow-sm hover:shadow-md cursor-pointer group min-w-0 overflow-hidden",
        className
      )}
    >
      {/* Card Header */}
      <div className="flex justify-between items-center gap-3 pb-3 border-b border-border/10 mb-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h3 className="text-sm font-black tracking-tight uppercase truncate text-text group-hover:text-accent transition-colors leading-none">
            {s.strategy_label}
          </h3>

          {/* Inline minimalist status dots */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={s.sessionActive} />
            {tradingMode === 'paper' && <PaperBadge />}
            {tradingMode === 'testnet' && <DemoBadge />}
            {tradingMode === 'live' && !s.sessionActive && <LiveBadge />}

            {paused && !isResuming && (
              <span className="text-[8.5px] font-black uppercase text-amber flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-amber" /> Paused
              </span>
            )}
            {isGated && !paused && !isResuming && (
              <Tooltip content={gateInfo.gateReason || 'Gated by Risk Rules'}>
                <span className="text-[8.5px] font-black uppercase text-amber flex items-center gap-1 cursor-help">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse shrink-0" />
                  {gateInfo.gateState === 'sleeping' ? 'SLEEPING' : 'GATED'}
                </span>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Inline Action Buttons (Edit and Play/Pause) */}
        <div className="flex items-center gap-1 shrink-0 relative z-20">
          <Tooltip content="Edit Strategy Config">
            <button
              type="button"
              onClick={handleEditClick}
              className="p-1.5 hover:bg-white/5 text-dim hover:text-accent rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer"
              aria-label="Edit Strategy"
            >
              <Edit3 size={12.5} />
            </button>
          </Tooltip>
          <Tooltip content={paused ? "Resume Strategy Engine" : "Pause Strategy Engine"}>
            <button
              type="button"
              onClick={handlePauseClick}
              className={cn(
                "p-1.5 rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer",
                paused ? "hover:bg-green/10 text-green" : "hover:bg-amber/10 text-amber"
              )}
              aria-label={paused ? "Resume Strategy Engine" : "Pause Strategy Engine"}
            >
              {paused ? <Play size={12.5} fill="currentColor" /> : <Pause size={12.5} fill="currentColor" />}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 3-Column Performance Metrics Row */}
      <div className="grid grid-cols-3 gap-3 py-1 items-center">
        <div className="flex flex-col gap-0.5">
          <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-none">Active P&L</span>
          <span className="text-sm sm:text-base font-black font-mono tracking-tighter leading-none mt-1" style={{ color: pnlColor(s.activePnl) }}>
            {fmtUSD(s.activePnl)}
          </span>
          <span className="text-[8px] text-dim/50 font-bold uppercase tracking-wider mt-0.5">
            Est: {fmtUSD(s.totalEstPnlToRealize)}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-none">Session Return</span>
          <span className="text-sm sm:text-base font-black font-mono tracking-tighter leading-none mt-1" style={{ color: pnlColor(s.totalPnl) }}>
            {fmtUSD(s.totalPnl)}
          </span>
          <span className="text-[8px] text-dim/50 font-bold uppercase tracking-wider mt-0.5" style={{ color: pnlColor(s.totalPnl) }}>
            {sessionReturnPct >= 0 ? '+' : ''}{sessionReturnPct.toFixed(2)}%
          </span>
        </div>

        <div className="flex flex-col gap-0.5 items-end text-right">
          <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-none">Active / Hits</span>
          <span className="text-sm sm:text-base font-black font-mono tracking-tighter text-text/90 leading-none mt-1">
            {s.activeTradeCount || 0} Positions
          </span>
          <span className="text-[8px] text-dim/50 font-bold uppercase tracking-wider mt-0.5">
            {s.entryCount} Entries · {s.hitCount} Hits
          </span>
        </div>
      </div>

      {/* Bottom Tag Row with details */}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/5 text-[9px] text-dim font-bold uppercase tracking-wider leading-none">
        <span>{config.scan_interval} · {config.scan_pct_threshold}% Move Threshold</span>
        <span className="text-[8px] bg-white/5 border border-white/5 px-1.5 py-0.5 rounded text-accent">
          Open Cockpit
        </span>
      </div>
    </motion.div>
  );
})

const GateBanner = React.memo(({ gateState, scannerPaused, reason, nextSlotTs, hibernating, hibernationMode, activeTradesCount = 0, showResumingFeedback, onManage }) => {
  // SRE/React: Hooks MUST be invoked unconditionally and in the same order on
  // every render. An early `return null` previously sat ABOVE these hooks, which
  // violates the Rules of Hooks and corrupts React's internal fiber (manifests as
  // the cryptic "Expected static flag was missing" crash on GateBanner mount).
  // The visibility guard is moved below the hooks.
  const config = useTradingStore(state => state.config);
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (gateState !== 'max_trades_period' || !nextSlotTs) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [gateState, nextSlotTs]);

  if (!gateState && !scannerPaused && !showResumingFeedback) return null;

  const nextSlotSec = nextSlotTs ? Math.max(0, Math.ceil((nextSlotTs - now) / 1000)) : null;

  const waitTimeStr = nextSlotSec !== null
    ? (nextSlotSec > 60 ? `${Math.ceil(nextSlotSec / 60)}m` : `${nextSlotSec}s`)
    : '';

  const messages = {
    max_trades: 'Maximum open trades reached. Entry gated.',
    max_trades_period: nextSlotSec !== null ? `Maximum trades for the current period reached. Next slot: ${nextSlotSec} sec.` : 'Maximum trades for the current period reached. Scanner paused.',
    sl_guard: 'Session Stop-Loss Guard reached. All entries blocked.',
    risk_pct: 'Total risk limit reached. Entries restricted.',
    tod_risk: 'Historical performance risk for this hour. Entries blocked.',
    sleeping: 'Engine idling outside trading windows.',
    risk: 'Risk gate active. Monitoring only.',
  }

  const isGatedIdle = (gateState === 'sleeping' || gateState === 'max_trades_period' || gateState === 'sl_guard') && activeTradesCount === 0;

  // Visual Cue Styling
  const bannerStyle = cn(
    "p-4 rounded-xl mb-6 text-xs font-bold border flex flex-col gap-2.5 shadow-sm transition-all duration-300 relative overflow-hidden",
    showResumingFeedback ? "bg-accent/10 border-accent/30 text-accent shadow-[0_0_15px_rgba(91,111,255,0.1)]" :
    scannerPaused ? "bg-red/10 border-red/20 text-red shadow-[0_0_15px_rgba(239,68,68,0.1)]" :
    (gateState === 'sl_guard') ? "bg-red/5 border-red/20 text-red shadow-[0_0_12px_rgba(239,68,68,0.05)]" :
    "bg-amber/10 border-amber/20 text-amber shadow-[0_0_12px_rgba(245,166,35,0.05)]",
    (!showResumingFeedback && (hibernating || isGatedIdle)) && "bg-slate-500/10 border-slate-500/20 text-slate-400"
  );

  const totalPeriodSec = Math.max(1, (config?.trades_period_min || 60) * 60);
  const progressPct = nextSlotSec !== null ? Math.min(100, Math.max(0, (nextSlotSec / totalPeriodSec) * 100)) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={bannerStyle}
    >
      <div className="flex items-center gap-3">
        {showResumingFeedback ? (
          <RefreshCw size={16} className="animate-spin text-accent" />
        ) : hibernating ? (
          <Zap size={16} className={cn("animate-pulse", hibernationMode === 'light' ? "text-accent" : "text-amber")} />
        ) : gateState === 'sleeping' ? (
          <Pause size={16} className="text-slate-400" />
        ) : scannerPaused ? (
          <XCircle size={16} className="text-red animate-pulse" />
        ) : (
          <PulseDot color="bg-amber" />
        )}
        <span className="uppercase tracking-widest flex-1">
          {showResumingFeedback ? 'Resuming Data Feed...' : hibernating ? (hibernationMode === 'light' ? 'Light Sleep Active' : 'Deep Sleep Active') : (messages[gateState] || 'Risk gate active.')}
        </span>
        {hibernating ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onManage) onManage();
            }}
            className={cn(
              "ml-auto px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border shrink-0 flex items-center gap-1.5 cursor-pointer transition-all hover:scale-95 active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
              hibernationMode === 'light' ? "bg-accent/10 border-accent/30 text-accent hover:bg-accent/20" : "bg-amber/15 border-amber/35 text-amber hover:bg-amber/25"
            )}
            title="Configure Hibernation & Sleep parameters in Settings"
          >
            <SettingsIcon size={10} /> MANAGE
          </button>
        ) : isGatedIdle && (
          <Tooltip content="Resource Suppression Active: Market feed and scanner are throttled to save CPU/Memory while idle.">
            <div className="ml-auto bg-accent/10 px-2 py-0.5 rounded text-[10px] flex items-center gap-1.5 border border-accent/20 shrink-0">
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

      {/* Dynamic Micro-Progress Timeline Bar for Period Release Countdown */}
      {nextSlotSec !== null && nextSlotSec > 0 && (
        <div className="flex items-center gap-3 mt-1.5">
          <div className="flex-1 bg-border/20 h-1.5 rounded-full overflow-hidden relative border border-white/5">
            <motion.div
              initial={{ width: '100%' }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 1, ease: 'linear' }}
              className="h-full bg-amber shadow-[0_0_8px_rgba(245,166,35,0.4)]"
            />
          </div>
          <span className="px-2 py-0.5 rounded bg-amber/20 border border-amber/35 text-[9px] font-black font-mono text-amber shrink-0 animate-pulse">
            {waitTimeStr}
          </span>
        </div>
      )}
    </motion.div>
  )
})
GateBanner.displayName = 'GateBanner'

export const ScannerPreview = React.memo(({ scannerResults, config, onOpen }) => {
  const { activeTrades } = useTradingStore(state => ({ activeTrades: state.activeTrades || [] }), shallow);
  const threshold = config.scan_pct_threshold || 2
  const top = (scannerResults || []).slice(0, 5)
  // Pre-allocate 5 slots to prevent layout shift
  const placeholders = Array.from({ length: Math.max(0, 5 - top.length) })

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden mb-8 shadow-sm h-[395px] flex flex-col">
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
          <div className="h-full flex flex-col items-center justify-center text-dim text-[11px] font-bold uppercase tracking-widest bg-surface/10 animate-pulse gap-2">
            <RefreshCw size={16} className="animate-spin opacity-40" />
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
                    <CopyButton value={opp.symbol} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 -ml-2" />
                    <div className="flex-1 flex justify-center h-8">
                      <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={48} height={20} />
                    </div>
                    <div className="flex flex-col items-end w-16 h-[26px] justify-center">
                      <em className={cn("text-xs font-bold font-mono text-right leading-none", colorClass)}>
                        {opp.pct >= 0 ? '+' : ''}{Number(opp.pct || 0).toFixed(2)}%
                      </em>
                      {(activeTrades || []).some(t => t.symbol === opp.symbol) && (
                        <InPosBadge className="opacity-60 scale-90 origin-right mt-0.5" />
                      )}
                    </div>
                    <div className="w-12 flex justify-end">
                      {passing ? (
                        opp.signalResult?.allFired ? (
                          <b className="text-[10px] font-black text-green uppercase tracking-wider">TRIGGERED</b>
                        ) : (
                          <b className="text-[10px] font-black text-amber uppercase tracking-wider">PENDING</b>
                        )
                      ) : (
                        <b className="text-[10px] font-bold text-dim uppercase tracking-wider">WAITING</b>
                      )}
                    </div>
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
})
ScannerPreview.displayName = 'ScannerPreview'

export function DashboardView({ initialStrategy }) {
  const [selected, setSelected] = useState(initialStrategy || null)
  const [showTemporalRisk, setShowTemporalRisk] = useState(false)

  useEffect(() => {
    setSelected(initialStrategy || null);
  }, [initialStrategy]);
  const [showConfig, setShowConfig] = useState(false)
  const [modalConfig, setModalConfig] = useState(null)
  const [showScanner, setShowScanner] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [selectedConfig, setSelectedConfig] = useState(null)
  const [editingVariantIndex, setEditingVariantIndex] = useState(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState(null)

  const {
    sessionActive, sessionPaused, pausedStrategies, strategyGateStates, strategyId, balance, totalPnl, totalRiskPct,
    totalSlUsed, totalEstPnlToRealize, activeTrades, alerts, config, setSessionActive,
    updateConfig, patchConfig, gateState, gateReason, hibernating, hibernationMode, agreementRequired,
    scannerPaused, sessionList, fetchSessions, wsStatus,
    updateStats, analytics,
    sidebarCollapsed, variantScannerResults, variantStats, isThrottled, setThrottled, isEcoMode, entryCount, hitCount,
    healthEnabled, isSyncing, setSyncing, configSyncing, isAdaptiveTightened, apiStatus, effectivePeriodMs, isSyncingOnResume,
    nextSlotTs, fetchTradeHistory, fetchLifetimeAnalytics, fetchAnalytics, tradeHistory
  } = useTradingStore(state => ({
    sessionActive: state.sessionActive,
    sessionPaused: state.sessionPaused,
    pausedStrategies: state.pausedStrategies || [],
    strategyGateStates: state.strategyGateStates || {},
    strategyId: state.strategyId,
    balance: state.balance,
    totalPnl: state.totalPnl,
    totalRiskPct: state.totalRiskPct,
    totalSlUsed: state.totalSlUsed,
    totalEstPnlToRealize: state.totalEstPnlToRealize,
    activeTrades: state.activeTrades,
    config: state.config,
    setSessionActive: state.setSessionActive,
    updateConfig: state.updateConfig,
    patchConfig: state.patchConfig,
    gateState: state.gateState,
    gateReason: state.gateReason,
    hibernating: state.hibernating,
    hibernationMode: state.hibernationMode,
    agreementRequired: state.agreementRequired,
    scannerPaused: state.scannerPaused,
    alerts: state.alerts,
    updateStats: state.updateStats,
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
    isAdaptiveTightened: state.isAdaptiveTightened,
    apiStatus: state.apiStatus,
    analytics: state.analytics,
    effectivePeriodMs: state.effectivePeriodMs,
    isSyncingOnResume: state.isSyncingOnResume,
    nextSlotTs: state.nextSlotTs,
    fetchTradeHistory: state.fetchTradeHistory,
    fetchLifetimeAnalytics: state.fetchLifetimeAnalytics,
    fetchAnalytics: state.fetchAnalytics,
    tradeHistory: state.tradeHistory
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
    sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, totalEstPnlToRealize, activeTrades, entryCount, hitCount,
    strategy_label: config.strategy_label || 'Momentum Strategy'
  }), [sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, totalEstPnlToRealize, activeTrades, entryCount, hitCount, config.strategy_label])

  const { lastSession, lastTrade } = useMemo(() => {
    // BOLT OPTIMIZATION: Use O(N) single-pass lookup to find the most recent session instead of sorting,
    // avoiding O(N log N) sorting overhead and array allocations.
    let ls = null;
    if (sessionList && sessionList.length > 0) {
      let maxTime = -Infinity;
      for (let i = 0; i < sessionList.length; i++) {
        const s = sessionList[i];
        if (!s) continue;
        const sTime = s.startTimeMs ?? (s.startTime ? new Date(s.startTime).getTime() : 0);
        if (sTime > maxTime) {
          maxTime = sTime;
          ls = s;
        }
      }
    }
    const lt = (tradeHistory && tradeHistory.length > 0) ? tradeHistory[0] : null;
    return { lastSession: ls, lastTrade: lt };
  }, [sessionList, tradeHistory]);

  const activePnlMap = useMemo(() => {
    const map = { [currentStrategy.strategy_label]: 0 };
    (config.strategy_variants || []).forEach(v => {
      const label = v.strategy_label || 'Variant';
      map[label] = 0;
    });
    (activeTrades || []).forEach(t => {
      if (t && map[t.strategy_label] !== undefined) {
        map[t.strategy_label] += safeNum(t.pnl);
      }
    });
    return map;
  }, [activeTrades, currentStrategy.strategy_label, config.strategy_variants]);

  const activeTradeCountsMap = useMemo(() => {
    const map = { [currentStrategy.strategy_label]: 0 };
    (config.strategy_variants || []).forEach(v => {
      const label = v.strategy_label || 'Variant';
      map[label] = 0;
    });
    (activeTrades || []).forEach(t => {
      if (t && map[t.strategy_label] !== undefined) {
        map[t.strategy_label]++;
      }
    });
    return map;
  }, [activeTrades, currentStrategy.strategy_label, config.strategy_variants]);

  const totalActivePnl = useMemo(() =>
    Object.values(activePnlMap || {}).reduce((acc, val) => acc + val, 0)
  , [activePnlMap]);

  const maxRR = useMemo(() => (activeTrades || []).reduce((max, trade) => Math.max(max, trade.max_rr || 0), 0), [activeTrades])

  const monitoredSymbolsSet = useMemo(() => {
    const set = new Set();
    (config.single_symbol_configs || []).forEach(sc => {
      if (sc.enabled) set.add(sc.symbol);
    });
    return set;
  }, [config.single_symbol_configs]);


  const [loading, setLoading] = useState(false)
  const [showInsights, setShowInsights] = useState(false)

  const correlationData = useMemo(() => {
    const list = tradeHistory || [];
    const buckets = [
      { label: '< 5m', min: 0, max: 5 * 60 * 1000, grossWin: 0, grossLoss: 0, count: 0 },
      { label: '5m - 30m', min: 5 * 60 * 1000, max: 30 * 60 * 1000, grossWin: 0, grossLoss: 0, count: 0 },
      { label: '> 30m', min: 30 * 60 * 1000, max: Infinity, grossWin: 0, grossLoss: 0, count: 0 }
    ];

    list.forEach(t => {
      if (!t.entry_ts || !t.exit_ts) return;
      const entry = new Date(t.entry_ts).getTime();
      const exit = new Date(t.exit_ts).getTime();
      const duration = exit - entry;
      if (duration < 0) return;

      const bucket = buckets.find(b => duration >= b.min && duration < b.max);
      if (bucket) {
        const pnl = Number(t.pnl || 0);
        if (pnl > 0) bucket.grossWin += pnl;
        else if (pnl < 0) bucket.grossLoss += Math.abs(pnl);
        bucket.count++;
      }
    });

    return buckets.map(b => {
      const pfVal = b.grossLoss > 0 ? (b.grossWin / b.grossLoss) : (b.grossWin > 0 ? b.grossWin : 0);
      return {
        label: b.label,
        profitFactor: Number(Number(pfVal).toFixed(2)),
        count: b.count,
        avgDurationText: b.label
      };
    });
  }, [tradeHistory]);

  useEffect(() => {
    let timer;
    if (confirmStop) {
      timer = setTimeout(() => setConfirmStop(false), 3000);
    }
    return () => clearTimeout(timer);
  }, [confirmStop]);

  useEffect(() => {
    // Legacy support for scanner-only focus if not handled by hook
    if (showScanner) {
       useTradingStore.getState().registerInterest('scanner');
       return () => useTradingStore.getState().unregisterInterest('scanner');
    }
  }, [showScanner]);
  useEffect(() => {
    fetchSessions();
    fetchTradeHistory();
    fetchAnalytics();
    fetchLifetimeAnalytics(config?.paper_mode ? 'paper' : 'live');

    const toggleScanner = () => setShowScanner(prev => !prev);
    window.addEventListener('toggle-scanner', toggleScanner);
    return () => window.removeEventListener('toggle-scanner', toggleScanner);
  }, [fetchSessions, fetchTradeHistory, fetchAnalytics, fetchLifetimeAnalytics, config?.paper_mode]);

  const addAlert = useTradingStore(state => state.addAlert);

  const handleConfigSave = React.useCallback(async (newConfig) => {
    setLoading(true)
    setSyncing(true)
    useTradingStore.setState({ configSyncing: true }); // Enable global sync protection
    try {
      let finalConfig = newConfig;
      const wasPresetLoaded = newConfig._presetLoaded;
      delete newConfig._presetLoaded;

      let activeVariantIndex = editingVariantIndex;
      if (wasPresetLoaded) {
        activeVariantIndex = null;
      }

      if (activeVariantIndex !== null) {
        const variants = [...(config.strategy_variants || [])];
        variants[activeVariantIndex] = { ...newConfig, strategy_label: newConfig.strategy_label };
        finalConfig = { ...config, strategy_variants: variants };
      }

      if (isEditMode && strategyId) {
        await sessionAPI.update(strategyId, finalConfig)
        updateConfig(finalConfig)
        addAlert({ level: 'success', title: 'Config Updated', message: 'Strategy parameters synchronized with the engine.' });
      } else {
        updateConfig(finalConfig)
        const res = await sessionAPI.start(finalConfig, finalConfig.paper_mode)
        setSessionActive(true, res.data.strategyId || res.data.strategy_id)
        addAlert({ level: 'success', title: 'Session Started', message: `Engine active with "${finalConfig.strategy_label}".` });
      }
      setShowConfig(false)
      await fetchSessions()
    } catch (e) {
      const isNetworkError = e.message === 'Network Error' || e.code === 'ERR_NETWORK';
      const msg = isNetworkError
        ? 'Network Error: Failed to reach backend. Check your internet or CORS settings.'
        : (e?.response?.data?.detail || e?.response?.data?.message || 'Failed to save config');
      addAlert({ level: 'error', title: 'Action Failed', message: msg });
    } finally {
      setLoading(false)
      setSyncing(false)
      useTradingStore.setState({ configSyncing: false });
      setIsEditMode(false)
      setEditingVariantIndex(null)
    }
  }, [config, isEditMode, strategyId, editingVariantIndex, updateConfig, setSessionActive, addAlert, fetchSessions, setSyncing]);

  const togglePause = React.useCallback(async (strategyLabel) => {
    try {
      const isTargetPaused = strategyLabel
        ? pausedStrategies.includes(strategyLabel)
        : sessionPaused;

      await sessionAPI.pause(!isTargetPaused, strategyLabel);

      const label = strategyLabel || 'Session';
      addAlert({
        level: 'info',
        title: isTargetPaused ? `${label} Resumed` : `${label} Paused`,
        message: isTargetPaused
          ? `Engine is now actively scanning for opportunities on ${label.toLowerCase()}.`
          : `Scanning and entry logic suspended for ${label.toLowerCase()}.`
      });
    } catch (e) {
      console.error('Pause toggle failed:', e);
      addAlert({ level: 'error', title: 'Action Failed', message: 'Could not toggle pause state.' });
    }
  }, [sessionPaused, pausedStrategies, addAlert]);

  const handleResumeLast = React.useCallback(async () => {
    if (!lastSession) return;
    setLoading(true);
    setSyncing(true);
    try {
      const res = await sessionAPI.start(lastSession.config, lastSession.paperMode, lastSession.id);
      setSessionActive(true, res.data.strategyId || res.data.strategy_id);
      addAlert({ level: 'success', title: 'Session Resumed', message: `Restored previous session "${lastSession.config.strategy_label}".` });
    } catch (e) {
      addAlert({ level: 'error', title: 'Resume Failed', message: 'Could not restore previous session state.' });
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [lastSession, setSessionActive, addAlert, setSyncing]);

  const handleStop = React.useCallback(async () => {
    setLoading(true)
    setSyncing(true)
    try {
      await sessionAPI.stop()
      setSessionActive(false, null)
      addAlert({ level: 'info', title: 'Session Terminated', message: 'Engine stopped and all positions closed at market.' });
      await fetchSessions()
    } catch (e) {
      setSessionActive(false, null)
      addAlert({ level: 'warn', title: 'Session Stopped', message: 'Engine halted, but some cleanup tasks might have failed.' });
      await fetchSessions()
    } finally {
      setLoading(false)
      setSyncing(false)
      setConfirmStop(false)
    }
  }, [setSessionActive, addAlert, fetchSessions, setSyncing]);

  const handleDeleteSession = React.useCallback(async () => {
    if (!sessionToDelete) return
    setLoading(true)
    setSyncing(true)
    try {
      await sessionAPI.delete(sessionToDelete)
      addAlert({
        level: 'success',
        title: 'Session Deleted',
        message: 'The session history has been permanently removed.'
      });
      await fetchSessions()
    } catch (e) {
      addAlert({
        level: 'error',
        title: 'Delete Failed',
        message: 'Could not remove session records from the database.'
      });
    } finally {
      setLoading(false)
      setSyncing(false)
      setSessionToDelete(null)
    }
  }, [sessionToDelete, addAlert, fetchSessions, setSyncing]);

  const [scannerFocusLabel, setScannerFocusLabel] = useState(null)
  const handleOpenScanner = React.useCallback((label) => {
    setScannerFocusLabel(typeof label === 'string' ? label : null);
    setShowScanner(true);
  }, []);
  const handleEditPrimary = React.useCallback(() => { setIsEditMode(true); setSelectedConfig(config); setEditingVariantIndex(null); setShowConfig(true); }, [config]);
  const handleSelectPrimary = React.useCallback(() => {
    window.location.hash = `#/strategy/${encodeURIComponent(currentStrategy.strategy_label)}`;
  }, [currentStrategy.strategy_label]);

  const handleEditVariant = React.useCallback((label) => {
    const idx = config.strategy_variants?.findIndex(v => v.strategy_label === label);
    if (idx !== -1) {
      const variantConfig = { ...config, ...config.strategy_variants[idx] };
      setIsEditMode(true);
      setSelectedConfig(variantConfig);
      setEditingVariantIndex(idx);
      setShowConfig(true);
    }
  }, [config]);

  const handleSelectVariant = React.useCallback((label) => {
    window.location.hash = `#/strategy/${encodeURIComponent(label)}`;
  }, []);

  const strategyData = useMemo(() => {
    if (!selected) return null;
    return {
      ...currentStrategy,
      strategy_label: selected,
      ...safeVariantStats[selected],
      activePnl: activePnlMap[selected] || 0
    };
  }, [selected, currentStrategy, safeVariantStats, activePnlMap]);

  const tradingMode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showResumingFeedback = sessionActive && isResuming;

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

      {selected ? (
        <Suspense fallback={<LoadingFallback />}>
          <StrategyDetailView
            s={strategyData}
            onBack={() => { window.location.hash = '#/'; }}
            onEdit={strategyData?.strategy_label === config.strategy_label ? handleEditPrimary : () => handleEditVariant(strategyData?.strategy_label)}
            onPause={togglePause}
            onOpenScanner={handleOpenScanner}
          />
        </Suspense>
      ) : (
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
          <div className="flex gap-1.5 sm:gap-2">
            {config.frequency_shaping_enabled && (
              <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 border border-accent/20 rounded-xl text-[9px] font-bold text-accent uppercase tracking-widest animate-in fade-in zoom-in duration-500">
                <Activity size={10} />
                Frequency Guard
              </div>
            )}

            <Tooltip content={isThrottled ? "Disable Eco Mode" : "Enable Eco Mode (Power Saver)"}>
              <button
                onClick={() => setThrottled(!isThrottled)}
                aria-label={isThrottled ? "Disable Eco Mode" : "Enable Eco Mode (Power Saver)"}
                className={cn(
                  "px-3 py-2 rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent outline-none",
                  isThrottled
                    ? "bg-green/10 border-green/30 text-green shadow-[0_0_15px_rgba(0,229,160,0.1)]"
                    : "bg-surface border-border text-dim hover:text-accent hover:border-accent/40"
                )}
              >
                <Leaf size={14} fill={isThrottled ? "currentColor" : "none"} />
                <span className="hidden md:inline text-[9px] font-bold uppercase tracking-widest">
                  {isThrottled ? "Eco Active" : "Eco Mode"}
                </span>
              </button>
            </Tooltip>

            {sessionActive && (
              <Tooltip content="Terminate Session (Close All Positions)">
                <button
                  type="button"
                  onClick={() => setConfirmStop(true)}
                  disabled={loading}
                  className="p-2.5 bg-red/10 border border-red/20 text-red rounded-xl hover:bg-red/20 hover:scale-95 active:scale-90 transition-all focus-visible:ring-2 focus-visible:ring-red outline-none cursor-pointer"
                  aria-label="Terminate Session"
                >
                  <XCircle size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        </ViewHeader>

        <div aria-live="polite">
          <BanBanner apiStatus={apiStatus} />
          {agreementRequired && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red/20 border border-red/40 p-5 rounded-2xl mb-6 flex flex-col md:flex-row items-center gap-4 shadow-xl"
            >
              <div className="w-12 h-12 rounded-full bg-red/20 flex items-center justify-center text-red shrink-0 animate-pulse">
                <AlertCircle size={24} />
              </div>
              <div className="flex-1 text-center md:text-left">
                <h3 className="text-sm font-black uppercase tracking-tight text-red mb-1">Exchange Agreement Required</h3>
                <p className="text-xs font-bold text-red/80">Binance requires you to sign the TradFi-Perps agreement contract. Trading is restricted until this is completed on the Binance website.</p>
              </div>
              <a
                href="https://www.binance.com/en/futures/BTCUSDT"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-2.5 bg-red text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red/90 transition-all shadow-lg active:scale-95 shrink-0"
              >
                Go to Binance
              </a>
            </motion.div>
          )}

          <GateBanner
            gateState={gateState}
            scannerPaused={scannerPaused}
            reason={gateReason}
            nextSlotTs={nextSlotTs}
            hibernating={hibernating}
            hibernationMode={hibernationMode}
            activeTradesCount={activeTrades.length}
            showResumingFeedback={showResumingFeedback}
            onManage={handleEditPrimary}
          />
        </div>

        {/* Global Metrics & Temporal Risk - Prioritized (UX-001) */}
        <div className="flex flex-col gap-5 lg:gap-6 mb-5 lg:mb-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <SectionLabel className="mb-4">
              <Activity size={14} className="text-accent" /> Global Metrics
            </SectionLabel>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 gap-y-4">
              <StatCard
                label="Account Balance"
                value={`$${balance.toLocaleString()}`}
                tooltipText="Total available funds in the trading account."
                ariaLabel={(() => {
                  if (!lastTrade) return undefined;
                  const prevBalance = balance - (lastTrade.pnl || 0);
                  const balPctChange = prevBalance > 0 ? ((lastTrade.pnl || 0) / prevBalance) * 100 : 0;
                  return `Account Balance: $${balance.toLocaleString()}. Last trade profit and loss was ${Number(lastTrade.pnl || 0) >= 0 ? 'plus' : 'minus'} $${Math.abs(lastTrade.pnl || 0).toFixed(2)}, representing a ${balPctChange >= 0 ? 'positive' : 'negative'} ${Math.abs(balPctChange || 0).toFixed(2)} percent change of account balance.`;
                })()}
                subValue={(() => {
                  if (!lastTrade) return null;
                  const prevBalance = balance - (lastTrade.pnl || 0);
                  const balPctChange = prevBalance > 0 ? ((lastTrade.pnl || 0) / prevBalance) * 100 : 0;
                  return (
                    <div className="flex items-center gap-1">
                      {Number(lastTrade.pnl || 0) >= 0 ? <TrendingUp size={10} className="text-green" /> : <TrendingDown size={10} className="text-red" />}
                      <span className={pnlClass(lastTrade.pnl)}>
                        {fmtUSD(lastTrade.pnl)} ({balPctChange >= 0 ? '+' : ''}{Number(balPctChange).toFixed(2)}%) Last
                      </span>
                    </div>
                  );
                })()}
              />
              <StatCard
                label="Active P&L"
                value={fmtUSD(totalActivePnl)}
                color={pnlClass(totalActivePnl)}
                subValue={`Total (${config?.trading_mode ? (config.trading_mode === 'paper' ? 'Paper' : config.trading_mode === 'testnet' ? 'Testnet' : 'Live') : (config?.paper_mode ? 'Paper' : 'Live')}): ${fmtUSD(totalPnl)}`}
                syncing={isResuming}
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
            className="flex flex-col"
          >
            <button
              onClick={() => setShowTemporalRisk(!showTemporalRisk)}
              className="group flex items-center justify-between w-full mb-4 text-left outline-none"
              aria-expanded={showTemporalRisk}
              aria-controls="temporal-risk-grid"
            >
              <SectionLabel className="mb-0 flex-1">
                <ShieldCheck size={14} className="text-accent" /> Temporal Risk & Limits
              </SectionLabel>
              <div className={cn(
                "p-1.5 rounded-lg border border-border/40 bg-surface/50 text-dim group-hover:text-accent group-hover:border-accent/40 transition-all",
                showTemporalRisk && "text-accent border-accent/40 bg-accent/5 rotate-180"
              )}>
                <ChevronLeft size={14} className="-rotate-90" />
              </div>
            </button>
            <AnimatePresence>
              {showTemporalRisk && (
                <motion.div
                  id="temporal-risk-grid"
                  initial={{ height: 0, opacity: 0, marginTop: 0 }}
                  animate={{ height: 'auto', opacity: 1, marginTop: 0 }}
                  exit={{ height: 0, opacity: 0, marginTop: 0 }}
                  transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                  className="overflow-hidden"
                >
                  <TemporalRiskGrid />
                </motion.div>
              )}
            </AnimatePresence>
            {!showTemporalRisk && (
              <div className="flex gap-2 -mt-2 mb-4 animate-in fade-in slide-in-from-left-2 duration-500">
                 {config.frequency_shaping_enabled && <div className="px-2 py-0.5 rounded bg-accent/5 border border-accent/10 text-[8px] font-black uppercase tracking-widest text-accent/60">Frequency Guard Active</div>}
                 <div className="px-2 py-0.5 rounded bg-surface border border-border/40 text-[8px] font-black uppercase tracking-widest text-dim/60">{config.max_open_trades} Max Trades</div>
              </div>
            )}
          </motion.div>
        </div>


        {/* ROI Trends & Insights - Collapsible */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mb-5 lg:mb-6 flex flex-col"
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => setShowInsights(!showInsights)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowInsights(!showInsights);
              }
            }}
            className="group flex items-center justify-between w-full mb-4 text-left outline-none cursor-pointer select-none"
            aria-expanded={showInsights}
            aria-controls="performance-insights-grid"
          >
            <SectionLabel className="mb-0 flex-1">
              <TrendingUp size={14} className="text-accent" /> Performance Insights
            </SectionLabel>
            <div className="flex items-center gap-3 shrink-0">
               <button
                 type="button"
                 onClick={(e) => { e.stopPropagation(); window.location.hash = '#/history'; }}
                 className="hidden sm:flex text-[10px] font-black uppercase tracking-widest text-accent hover:text-accent/80 transition-colors items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded px-1"
               >
                 View Full Analytics <ChevronRight size={12} />
               </button>
               <span className="hidden sm:inline text-[9px] text-dim font-black uppercase tracking-widest bg-background/50 px-2 py-1 rounded border border-border/50">
                  {analytics?.cumulativePnL?.length ? `As of ${new Date(analytics.cumulativePnL[analytics.cumulativePnL.length - 1].ts).toLocaleTimeString()}` : 'Updated Live'}
               </span>
               <div className={cn(
                 "p-1.5 rounded-lg border border-border/40 bg-surface/50 text-dim group-hover:text-accent group-hover:border-accent/40 transition-all",
                 showInsights && "text-accent border-accent/40 bg-accent/5 rotate-180"
               )}>
                 <ChevronLeft size={14} className="-rotate-90" />
               </div>
            </div>
          </div>

          <AnimatePresence>
            {showInsights && (
              <motion.div
                id="performance-insights-grid"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Equity Story & Duration Correlation */}
                  <div className="lg:col-span-2 bg-surface border border-border/40 rounded-2xl p-5 md:p-6 shadow-sm flex flex-col gap-6">

                    <div className="flex justify-between items-start gap-4">
                      <div className="flex flex-col gap-1">
                        <div className="text-[10px] text-dim font-black uppercase tracking-widest">Equity Narrative</div>
                        <div className="text-xs font-bold text-text">Performance Curve & Hold Time Correlation</div>
                      </div>
                      <div className="flex gap-4 shrink-0">
                         <div className="flex flex-col items-end">
                            <span className="text-[9px] text-dim font-black uppercase tracking-widest">7D ROI</span>
                            <span className={cn("text-xs font-bold font-mono", analytics?.roiTrends ? pnlClass(analytics.roiTrends.sevenDay) : "text-dim")}>
                              {analytics?.roiTrends ? `${analytics.roiTrends.sevenDay >= 0 ? '+' : ''}${analytics.roiTrends.sevenDay}%` : '---'}
                            </span>
                         </div>
                         <div className="flex flex-col items-end">
                            <span className="text-[9px] text-dim font-black uppercase tracking-widest">4W ROI</span>
                            <span className={cn("text-xs font-bold font-mono", analytics?.roiTrends ? pnlClass(analytics.roiTrends.fourWeek) : "text-dim")}>
                              {analytics?.roiTrends ? `${analytics.roiTrends.fourWeek >= 0 ? '+' : ''}${analytics.roiTrends.fourWeek}%` : '---'}
                            </span>
                         </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch flex-1">
                      {/* Equity Curve */}
                      <div className="flex flex-col justify-between h-full min-h-[140px] bg-background/20 rounded-xl p-4 border border-border/20">
                        <span className="text-[10px] text-dim font-black uppercase tracking-widest mb-2">Growth Curve</span>
                        <div className="h-[80px] w-full overflow-hidden">
                          <Suspense fallback={<div className="h-full w-full bg-surface/10 animate-pulse" />}>
                            <EquityCurve data={analytics?.cumulativePnL || []} height={80} hideAxes={true} />
                          </Suspense>
                        </div>
                      </div>

                      {/* Duration Correlation Chart */}
                      <div className="flex flex-col justify-between h-full min-h-[140px] bg-background/20 rounded-xl p-4 border border-border/20">
                        <span className="text-[10px] text-dim font-black uppercase tracking-widest mb-2">Duration Correlation (Profit Factor)</span>
                        <div className="flex items-end justify-between h-[80px] pt-1 px-1">
                          {correlationData.map((d) => {
                            const pct = Math.min(100, (d.profitFactor / 3) * 100);
                            const colorClass = d.profitFactor >= 2.0 ? 'bg-green shadow-[0_0_12px_rgba(34,197,94,0.3)]' :
                                               d.profitFactor >= 1.0 ? 'bg-accent shadow-[0_0_12px_rgba(0,229,160,0.3)]' :
                                               d.profitFactor > 0 ? 'bg-red-400' : 'bg-dim/40';
                            return (
                              <div key={d.label} className="flex flex-col items-center gap-1 flex-1 group relative">
                                <Tooltip content={`Profit Factor: ${d.profitFactor} (${d.count} trades)`}>
                                  <div className="w-8 flex flex-col items-center justify-end h-[50px]">
                                    <motion.div
                                      initial={{ height: 0 }}
                                      animate={{ height: `${Math.max(4, pct)}%` }}
                                      className={cn("w-3 rounded-t-sm transition-all", colorClass)}
                                    />
                                  </div>
                                </Tooltip>
                                <span className="text-[8px] text-dim font-black uppercase tracking-tight leading-none">{d.label}</span>
                                <span className="text-[9px] font-mono font-bold leading-none mt-1 whitespace-nowrap">{d.profitFactor} PF</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Risk-Width Initial SL Distance Insights */}
                    {analytics?.riskWidthBuckets && analytics.riskWidthBuckets.length > 0 && (
                      <div className="border-t border-border/20 pt-4 flex flex-col gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-dim font-black uppercase tracking-widest">Initial SL Distance Insights</span>
                          <span className="text-[9px] text-dim/60 font-bold uppercase tracking-wide">Performance and average hold time based on stop loss width</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                          {analytics.riskWidthBuckets.map((b) => {
                            const durationSeconds = Math.round(b.avgDurationMs / 1000);
                            const durationMinutes = Math.floor(durationSeconds / 60);
                            const durationHrs = Math.floor(durationMinutes / 60);
                            const durationFormatted = durationHrs > 0
                              ? `${durationHrs}h ${durationMinutes % 60}m`
                              : durationMinutes > 0
                                ? `${durationMinutes}m ${durationSeconds % 60}s`
                                : `${durationSeconds}s`;

                            const winRatePct = Math.round(b.winRate);
                            const pfColor = b.profitFactor >= 2.0 ? 'text-green' :
                                            b.profitFactor >= 1.0 ? 'text-accent' :
                                            b.tradesCount > 0 ? 'text-red' : 'text-dim';

                            const barColor = b.profitFactor >= 1.0 ? 'bg-green' : 'bg-red';

                            return (
                              <div
                                key={b.label}
                                tabIndex={0}
                                className="bg-background/25 border border-border/20 rounded-xl p-3.5 flex flex-col gap-2 hover:border-accent/30 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                                aria-label={`${b.label} risk bucket. ${b.tradesCount} trades, profit factor is ${b.profitFactor}, average hold time is ${durationFormatted}, win rate is ${winRatePct}%`}
                              >
                                <div className="flex justify-between items-start">
                                  <span className="text-[10px] font-black uppercase tracking-wider text-text/80">{b.label}</span>
                                  <span className="text-[9px] font-mono text-dim font-bold">{b.tradesCount} Trades</span>
                                </div>

                                <div className="flex items-baseline justify-between">
                                  <div className="flex flex-col">
                                    <span className="text-[8px] text-dim font-black uppercase tracking-widest">Profit Factor</span>
                                    <span className={cn("text-xs font-black font-mono leading-none mt-1.5", pfColor)}>
                                      {b.profitFactor.toFixed(2)} PF
                                    </span>
                                  </div>
                                  <div className="flex flex-col items-end">
                                    <span className="text-[8px] text-dim font-black uppercase tracking-widest">Avg Duration</span>
                                    <span className="text-xs font-bold font-mono text-text/90 leading-none mt-1.5">
                                      {durationFormatted}
                                    </span>
                                  </div>
                                </div>

                                {/* Win Rate Progress Bar */}
                                <div className="space-y-1 mt-1">
                                  <div className="flex justify-between text-[8px] text-dim/60 font-bold font-mono">
                                    <span>WIN RATE</span>
                                    <span>{winRatePct}%</span>
                                  </div>
                                  <div className="h-1 bg-border/20 rounded-full overflow-hidden relative">
                                    <div
                                      className={cn("h-full rounded-full transition-all duration-700", barColor)}
                                      style={{ width: `${winRatePct}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Right Column: Key Stats Grid */}
                  <div className="grid grid-cols-2 gap-3 md:gap-4">
                     <div className="flex flex-col gap-3">
                        <StatCard
                          label="Returns"
                          value={analytics ? `${Number(analytics.overallWinRate || 0).toFixed(1)}%` : '---'}
                          subValue="Win Rate"
                          tooltipText="Percentage of closed trades that resulted in a profit."
                        />
                        <StatCard
                          label="Max DD"
                          value={analytics ? `${Number(analytics.maxDrawdownPct || 0).toFixed(1)}%` : '---'}
                          color="text-red"
                          subValue="Drawdown"
                          tooltipText="Maximum observed peak-to-trough decline in equity."
                        />
                     </div>
                     <div className="flex flex-col gap-3">
                        <StatCard
                          label="Risk Edge"
                          value={analytics ? Number(analytics.profitFactor || 0).toFixed(2) : '---'}
                          subValue="Profit Factor"
                          tooltipText="Ratio of gross profit to gross loss. > 1.0 is profitable."
                        />
                        <StatCard
                          label="Efficiency"
                          value={analytics ? Number(analytics.sharpeRatio || 0).toFixed(2) : '---'}
                          subValue="Sharpe Ratio"
                          tooltipText="Risk-adjusted return. Higher is better."
                        />
                     </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Main Grid - Un-nested to full width */}
        <div className="grid grid-cols-1 items-start gap-6 w-full">

          {/* Left Workspace */}
          <div className="flex flex-col gap-6 lg:gap-10 no-scrollbar w-full">
            <motion.div
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="bg-surface border border-border rounded-2xl p-6 flex flex-col shadow-sm"
            >
              <SectionLabel className="mb-4 flex items-center gap-2">
                <Zap size={14} className="text-accent" /> Active Strategy
              </SectionLabel>
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
                              activePnl: activePnlMap[currentStrategy.strategy_label] || 0,
                              activeTradeCount: activeTradeCountsMap[currentStrategy.strategy_label] || 0
                            }}
                            scannerResults={variantScannerResults[currentStrategy.strategy_label]}
                            config={config}
                            paused={pausedStrategies.includes(currentStrategy.strategy_label) || sessionPaused}
                            gateInfo={strategyGateStates[currentStrategy.strategy_label]}
                            onPause={togglePause}
                            onOpenScanner={handleOpenScanner}
                            onEdit={handleEditPrimary}
                            onClick={handleSelectPrimary}
                            isMonitored={monitoredSymbolsSet.has(currentStrategy.strategy_label)}
                            className={cn(totalCards % 2 !== 0 && "md:col-span-2")}
                            isResuming={isResuming}
                            showResumingFeedback={showResumingFeedback}
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
                                  activePnl: activePnlMap[label] || 0,
                                  activeTradeCount: activeTradeCountsMap[label] || 0
                                }}
                                scannerResults={variantScannerResults[label]}
                                config={variantConfig}
                                paused={pausedStrategies.includes(label) || sessionPaused}
                                gateInfo={strategyGateStates[label]}
                                onPause={togglePause}
                                onOpenScanner={handleOpenScanner}
                                onEdit={handleEditVariant}
                                onClick={handleSelectVariant}
                                isMonitored={monitoredSymbolsSet.has(label)}
                                isResuming={isResuming}
                                showResumingFeedback={showResumingFeedback}
                              />
                            );
                          })}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 col-span-1 md:col-span-2">
                    <button
                      onClick={() => { setIsEditMode(false); setSelectedConfig(null); setEditingVariantIndex(null); setShowConfig(true); }}
                      disabled={loading || isSyncing}
                      aria-label="Create new trading strategy"
                      className={cn(
                        "bg-background border-2 border-dashed border-border rounded-2xl p-6 flex flex-col items-center justify-center gap-4 text-dim transition-all group min-h-[200px] w-full",
                        lastSession ? "col-span-1" : "col-span-1 md:col-span-2",
                        (loading || isSyncing) ? "opacity-30 grayscale cursor-not-allowed pointer-events-none" : "hover:text-accent hover:border-accent/40 hover:bg-accent/5"
                      )}
                    >
                      <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-all shadow-sm">
                        <Plus size={20} />
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-widest">New Strategy</span>
                    </button>

                    {lastSession && (
                      <button
                        onClick={handleResumeLast}
                        disabled={loading || isSyncing}
                        aria-label={`Resume last session: ${lastSession.config.strategy_label}`}
                        className={cn(
                          "bg-background border-2 border-dashed border-border rounded-2xl p-6 flex flex-col items-center justify-center gap-4 text-dim transition-all group min-h-[200px] w-full col-span-1",
                          (loading || isSyncing) ? "opacity-30 grayscale cursor-not-allowed pointer-events-none" : "hover:text-accent hover:border-accent/40 hover:bg-accent/5"
                        )}
                      >
                        <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-all shadow-sm">
                          <History size={20} />
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[11px] font-bold uppercase tracking-widest">Resume Last</span>
                          <span className="text-[9px] text-dim/60 font-medium uppercase mt-1 truncate max-w-[150px]">
                            {lastSession.config.strategy_label}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                )}

              </div>
            </motion.div>
          </div>

          {/* Right Workspace (Context) - Properly outside the Left Workspace div to use the xl grid column */}
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="flex flex-col gap-6 lg:gap-10 w-full"
          >
            <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col shadow-sm w-full">
              <SectionLabel className="mb-4">
                <Activity size={14} className="text-accent" /> Session Logs
              </SectionLabel>
              <div className="flex-1 overflow-y-auto">
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
      </div>
      )}

      {/* Modals & Drawers */}
        <Drawer.Root open={showConfig} onOpenChange={setShowConfig} repositionInputs={false}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" />
            <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[32px] fixed inset-x-0 bottom-0 top-[4dvh] z-[101] focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:max-w-[800px] lg:mx-auto h-auto">
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
                      loading={loading}
                    />
                  )}
                </Suspense>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        <Drawer.Root open={showScanner} onOpenChange={setShowScanner} repositionInputs={false}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]" />
            <Drawer.Content className="bg-background border-t border-border flex flex-col rounded-t-[32px] fixed inset-x-0 bottom-0 top-[4dvh] z-[101] focus:outline-none shadow-[0_-20px_50px_rgba(0,0,0,0.5)] lg:max-w-[1000px] lg:mx-auto h-auto">
              <div className="p-2 bg-background rounded-t-[32px] flex flex-col items-center shrink-0">
                <div className="w-12 h-1.5 bg-border rounded-full mb-2" />
                <VisuallyHidden>
                  <Drawer.Title>Scanner</Drawer.Title>
                  <Drawer.Description>View live market scanner opportunities</Drawer.Description>
                </VisuallyHidden>
              </div>
              <div className="flex-1 min-h-0">
                <Suspense fallback={<LoadingFallback />}>
                  {showScanner && <ScannerOverlay onClose={() => setShowScanner(false)} selectedStrategyLabel={scannerFocusLabel || selected} />}
                </Suspense>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        {/* Mobile Floating Controls */}
        <div className="lg:hidden fixed bottom-24 right-6 flex flex-col gap-4 z-[100]">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowScanner(true)}
            aria-label="Open Market Scanner"
            className="w-10 h-10 rounded-full bg-accent text-white shadow-2xl flex items-center justify-center animate-in fade-in zoom-in duration-500"
          >
            <Zap size={20} />
          </motion.button>
        </div>

        <BottomNav selected={selected} />
    </div>
  )
}
