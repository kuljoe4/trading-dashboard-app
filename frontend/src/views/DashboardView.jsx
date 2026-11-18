import React, { useEffect, useMemo, useState, lazy, Suspense, useRef } from 'react'
import { resolveStrategyConfig } from '../utils/strategyConfig.js'
import { shallow } from 'zustand/shallow'
import { pnlColor, pnlClass, fmtUSD, C, safeNum } from '../lib/theme'
import { formatDuration, calculateProximity, calculateOpportunityProximity } from '../lib/formatters'
import { calculatePerformanceMetrics } from '../lib/analytics'
import { resolveAdaptivePeriodicLimit, isClosedValidTrade, computePeriodicBuckets, computePeriodBadges } from '../utils/periodicPerformance'

const formatTimeAgo = (ts) => {
  if (!ts) return 'ago';
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(ms) || ms <= 0) return 'ago';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
};
import { useTradingStore } from '../store/trading'
import { sessionAPI, formatApiErrorMessage } from '../api/client'
import { getMarketRegimeInfo } from '../utils/marketRegime'
import { 
  StatCard, InteractiveLimitCard, SectionLabel, Btn, StatusBadge, PaperBadge, EcoBadge, DemoBadge, LiveBadge,
    ConditionWidget, PulseDot, Sparkline, PnLBars, CopyButton, cn, Tooltip, VisuallyHidden, ViewHeader, MonitoredBadge, InPosBadge
  } from '../components/ui/primitives'
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, Trash2, LayoutDashboard, History,
  Settings as SettingsIcon, Activity, Zap, ShieldCheck, Search, Filter,
  BarChart3, XCircle, Pause, Play, Edit3, RefreshCw, Leaf, DollarSign, Users, Clock, ArrowUpRight, ArrowDownRight,
  Briefcase, TrendingUp, TrendingDown, ArrowRight, AlertCircle, CheckCircle2, Info, Loader2,
  Turtle, Flame, Gauge, Wind, PauseCircle, Moon
} from 'lucide-react'
import { Drawer } from 'vaul'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar, BottomNav } from '../components/Navigation'
import { lazyWithRetry } from '../lib/lazy'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { useNow } from '../hooks/useNow'

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

  const now = useNow();

  const nextSlotSec = nextSlotTs ? Math.max(0, Math.ceil((nextSlotTs - now) / 1000)) : null;
  const waitTime = nextSlotSec !== null
    ? (nextSlotSec > 60 ? `${Math.ceil(nextSlotSec / 60)}m` : `${nextSlotSec}s`)
    : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 auto-rows-fr items-stretch gap-2.5 md:gap-3 mb-3">
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
        className="col-span-2 md:col-span-1 lg:col-span-1"
      />
    </div>
  );
});

// Lazy Load heavy components
const DecisionLog = lazyWithRetry(() => import('../components/DecisionLog').then(module => ({ default: module.DecisionLog })))
const ConfigModal = lazyWithRetry(() => import('../components/ConfigModal').then(module => ({ default: module.ConfigModal })))
const ScannerOverlay = lazyWithRetry(() => import('../components/ScannerOverlay').then(module => ({ default: module.ScannerOverlay })))
const StrategyDetailView = lazyWithRetry(() => import('./StrategyDetailView'))

// --- Observable Periodic Revenue Bar Chart (Daily, Weekly, Monthly) ---
const MonthlyRevenueChart = React.memo(({
  tradeHistory = [],
  balance = 10000,
  config = {},
  scope = 'all',
  onScopeChange,
  timeframe: controlledTimeframe,
  onTimeframeChange,
  hasSession = false,
  sessionLabel = 'This Session',
  nowTick = Date.now(),
  isLoadingHistory = false
}) => {
  const [internalTimeframe, setInternalTimeframe] = useState('7D');
  const timeframe = controlledTimeframe || internalTimeframe;
  const [selectedStrategy, setSelectedStrategy] = useState('ALL');
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [isChartExpanded, setIsChartExpanded] = useState(false);

  const activeTradingMode = config?.trading_mode || (config?.paper_mode === false ? 'live' : 'paper');

  const validTrades = useMemo(() => {
    const raw = tradeHistory || [];
    return raw.filter(t => isClosedValidTrade(t, activeTradingMode));
  }, [tradeHistory, activeTradingMode]);

  const strategyOptions = useMemo(() => {
    const labels = new Set();
    if (config?.strategy_label) labels.add(config.strategy_label);
    if (Array.isArray(config?.strategy_variants)) {
      for (const v of config.strategy_variants) {
        if (v?.strategy_label && v.enabled !== false) labels.add(v.strategy_label);
      }
    }
    for (let i = 0; i < validTrades.length; i++) {
      const label = validTrades[i]?.strategy_label || validTrades[i]?.strategyLabel;
      if (label) labels.add(label);
    }
    return Array.from(labels);
  }, [config?.strategy_label, config?.strategy_variants, validTrades]);

  const filteredHistory = useMemo(() => {
    if (selectedStrategy === 'ALL') return validTrades;
    return validTrades.filter(t => (t?.strategy_label || t?.strategyLabel || 'Momentum Strategy') === selectedStrategy);
  }, [validTrades, selectedStrategy]);

  const periodicData = useMemo(() => {
    return computePeriodicBuckets({ trades: filteredHistory, timeframe, nowTs: nowTick });
  }, [filteredHistory, timeframe, nowTick]);

  const { buckets, maxVal } = periodicData;
  // BOLT OPTIMIZATION: Fused totalRevenue & periodTradesCount calculation
  let totalRevenue = 0;
  let periodTradesCount = 0;
  for (let i = 0; i < buckets.length; i++) {
    totalRevenue += buckets[i].pnl;
    periodTradesCount += buckets[i].tradesCount;
  }

  // Period Quick Badges (Today, 7D, 30D — midnight-aligned to match bar buckets)
  const periodBadges = useMemo(() => {
    return computePeriodBadges({ trades: filteredHistory, nowTs: nowTick });
  }, [filteredHistory, nowTick]);

  const handleSelectTimeframe = (nextTf) => {
    if (typeof onTimeframeChange === 'function') {
      onTimeframeChange(nextTf);
    } else {
      setInternalTimeframe(nextTf);
    }
    setSelectedIndex(null);
  };

  const handleSelectScope = (nextScope) => {
    if (nextScope === 'session' && !hasSession) return;
    if (typeof onScopeChange === 'function') {
      onScopeChange(nextScope);
    }
    setSelectedIndex(null);
  };

  const activeScope = scope === 'session' && hasSession ? 'session' : 'all';
  const scopeText = activeScope === 'session' ? sessionLabel : 'All Sessions';

  return (
    <div className="bg-surface border border-border rounded-2xl p-3.5 sm:p-5 shadow-md shadow-black/20 flex flex-col gap-3.5 overflow-hidden w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsChartExpanded(!isChartExpanded)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setIsChartExpanded(!isChartExpanded))}
        aria-expanded={isChartExpanded}
        aria-controls="periodic-chart-content"
        className="flex items-center justify-between gap-2.5 sm:gap-4 cursor-pointer select-none group min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
      >
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
            <BarChart3 size={16} />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 min-w-0 flex-1 pr-1 sm:pr-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h3 className="text-xs sm:text-sm font-bold tracking-tight text-text truncate group-hover:text-accent transition-colors">
                Periodic Performance
              </h3>
              <span aria-hidden="true" className="text-dim/40 text-xs">·</span>
              <span className={cn(
                "text-[11px] font-medium shrink-0",
                activeScope === 'session' ? "text-accent" : "text-dim"
              )}>
                {scopeText}
              </span>
              <span aria-hidden="true" className="text-dim/40 text-xs">·</span>
              <span className="text-[11px] text-dim font-medium shrink-0 tabular-nums">
                Net <strong className={cn("font-mono font-semibold", pnlClass(totalRevenue))}>{fmtUSD(totalRevenue)}</strong>
              </span>
            </div>

            {/* Clean Midnight-Aligned Quick Period Totals */}
            <div className="flex items-center gap-2.5 font-mono text-[10px] font-semibold shrink-0 tabular-nums flex-wrap">
              <span className="text-dim">
                TODAY <span className={pnlClass(periodBadges.today)}>{fmtUSD(periodBadges.today)}</span>
              </span>
              <span aria-hidden="true" className="text-dim/30">·</span>
              <span className="text-dim">
                7D <span className={pnlClass(periodBadges.d7)}>{fmtUSD(periodBadges.d7)}</span>
              </span>
              <span aria-hidden="true" className="text-dim/30 hidden sm:inline">·</span>
              <span className="text-dim hidden sm:inline">
                30D <span className={pnlClass(periodBadges.d30)}>{fmtUSD(periodBadges.d30)}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {strategyOptions.length > 0 && (
            <select
              aria-label="Filter periodic performance by strategy"
              value={selectedStrategy}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                setSelectedStrategy(e.target.value);
                setSelectedIndex(null);
              }}
              className="hidden sm:block h-8 px-2.5 rounded-lg bg-background/70 border border-border/50 text-[10px] font-mono font-semibold text-text focus:outline-none focus:border-accent max-w-[160px] truncate cursor-pointer"
            >
              <option value="ALL">All Strategies</option>
              {strategyOptions.map(label => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          )}
          <div className={cn(
            "w-8 h-8 sm:w-7 sm:h-7 rounded-lg border border-border/50 bg-surface/60 text-dim group-hover:text-accent group-hover:border-accent/40 transition-colors flex items-center justify-center shrink-0",
            isChartExpanded && "text-accent border-accent/40 bg-accent/5 rotate-180"
          )}>
            <ChevronLeft size={14} className="-rotate-90" />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isChartExpanded && (
          <motion.div
            id="periodic-chart-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden flex flex-col gap-3 sm:gap-3.5 pt-3 border-t border-border/20"
          >
            {/* Mobile-First Controls: Scope Toggle + Strategy Filter + Adaptive Timeframe Horizon */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto min-w-0">
                {/* Clean Segmented Scope Toggle */}
                <div
                  role="group"
                  aria-label="Periodic performance scope"
                  className="grid grid-cols-2 sm:inline-flex items-center gap-1 p-1 rounded-xl bg-background/60 border border-border/50 w-full sm:w-auto min-w-0"
                >
                  <button
                    type="button"
                    aria-pressed={activeScope === 'all'}
                    onClick={(e) => { e.stopPropagation(); handleSelectScope('all'); }}
                    className={cn(
                      "min-h-[36px] sm:min-h-[30px] px-3 py-1 rounded-lg text-[11px] font-bold tracking-tight transition-colors focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer whitespace-nowrap min-w-0 truncate flex items-center justify-center",
                      activeScope === 'all'
                        ? "bg-accent text-white shadow-sm shadow-accent/20"
                        : "text-dim hover:text-text hover:bg-white/5"
                    )}
                  >
                    All Sessions
                  </button>
                  <button
                    type="button"
                    aria-pressed={activeScope === 'session'}
                    disabled={!hasSession}
                    onClick={(e) => { e.stopPropagation(); handleSelectScope('session'); }}
                    className={cn(
                      "min-h-[36px] sm:min-h-[30px] px-3 py-1 rounded-lg text-[11px] font-bold tracking-tight transition-colors focus-visible:ring-2 focus-visible:ring-accent outline-none whitespace-nowrap min-w-0 truncate flex items-center justify-center",
                      !hasSession
                        ? "text-dim/40 cursor-not-allowed"
                        : activeScope === 'session'
                          ? "bg-accent text-white shadow-sm shadow-accent/20 cursor-pointer"
                          : "text-dim hover:text-text hover:bg-white/5 cursor-pointer"
                    )}
                  >
                    {sessionLabel}
                  </button>
                </div>

                {strategyOptions.length > 0 && (
                  <select
                    aria-label="Filter periodic performance by strategy"
                    value={selectedStrategy}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setSelectedStrategy(e.target.value);
                      setSelectedIndex(null);
                    }}
                    className="sm:hidden w-full min-h-[38px] px-3 rounded-xl bg-background/70 border border-border/50 text-xs font-mono font-bold text-text focus:outline-none focus:border-accent truncate cursor-pointer"
                  >
                    <option value="ALL">All Strategies</option>
                    {strategyOptions.map(label => (
                      <option key={label} value={label}>{label}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-5 sm:inline-flex items-center gap-1 bg-background/60 border border-border/50 p-1 rounded-xl w-full sm:w-auto shrink-0">
                {[
                  { id: '7D', shortLabel: '7D', fullLabel: '7 Days' },
                  { id: '14D', shortLabel: '14D', fullLabel: '14 Days' },
                  { id: '4W', shortLabel: '4W', fullLabel: '4 Weeks' },
                  { id: '6M', shortLabel: '6M', fullLabel: '6 Months' },
                  { id: '1Y', shortLabel: '1Y', fullLabel: '1 Year' }
                ].map((tf) => (
                  <button
                    key={tf.id}
                    type="button"
                    aria-pressed={timeframe === tf.id}
                    onClick={(e) => { e.stopPropagation(); handleSelectTimeframe(tf.id); }}
                    className={cn(
                      "min-h-[36px] sm:min-h-[30px] px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-[10.5px] font-bold tracking-tight transition-colors focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center",
                      timeframe === tf.id
                        ? "bg-accent text-white shadow-sm shadow-accent/20"
                        : "text-dim hover:text-text hover:bg-white/5"
                    )}
                  >
                    <span className="hidden sm:inline">{tf.fullLabel}</span>
                    <span className="inline sm:hidden">{tf.shortLabel}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Reserved Period Detail Banner (Fixed height on mobile & desktop for 0.000 CLS on hover/select) */}
            <div className="min-h-[38px] bg-accent/5 border border-accent/20 px-3 py-2 rounded-xl h-[58px] sm:h-[42px] flex flex-col justify-center sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 text-xs font-mono overflow-hidden transition-colors">
        {(() => {
          const activeIdx = hoveredIndex !== null ? hoveredIndex : selectedIndex;
          const activeBucket = activeIdx !== null ? buckets[activeIdx] : null;

          if (!activeBucket) {
            return (
              <>
                <span className="flex items-center gap-1.5 text-dim/80 font-sans text-[11px] font-medium truncate leading-tight">
                  <Info size={12} className="text-accent/70 shrink-0" />
                  <span className="truncate">Hover or tap a bar to inspect period breakdown</span>
                </span>
                <span className="font-mono text-[10px] text-dim/75 flex items-center gap-1.5 shrink-0 tabular-nums whitespace-nowrap leading-tight">
                  {isLoadingHistory && <RefreshCw size={10} className="animate-spin text-accent shrink-0" />}
                  {buckets.length} Periods ({timeframe}) · {scopeText} · {periodTradesCount} closed
                </span>
              </>
            );
          }

          const activePct = balance > 0 ? (activeBucket.pnl / balance) * 100 : 0;

          return (
            <>
              <div className="flex items-center gap-2 min-w-0 leading-tight">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", activeBucket.pnl > 0 ? "bg-green" : activeBucket.pnl < 0 ? "bg-red" : "bg-accent")} />
                <span className="font-bold uppercase tracking-wide text-text text-[11px] truncate">
                  {activeBucket.label} <span className="text-dim font-medium">({activeBucket.subLabel})</span>
                </span>
              </div>
              <div className="flex items-center gap-2 sm:gap-2.5 text-[11px] font-medium tabular-nums whitespace-nowrap overflow-hidden leading-tight">
                <span>
                  Net <strong className={cn("font-semibold", pnlClass(activeBucket.pnl))}>{activeBucket.pnl >= 0 ? '+' : ''}{fmtUSD(activeBucket.pnl)}</strong>{' '}
                  <span className={cn("text-[10px] opacity-85", pnlClass(activeBucket.pnl))}>({activePct >= 0 ? '+' : ''}{activePct.toFixed(2)}%)</span>
                </span>
                <span aria-hidden="true" className="text-dim/35">·</span>
                <span className="text-dim">
                  Trades <strong className="text-text font-semibold">{activeBucket.tradesCount}</strong>
                </span>
                <span aria-hidden="true" className="text-dim/35">·</span>
                <span className="text-dim">
                  Win <strong className="text-text font-semibold">{activeBucket.tradesCount > 0 ? Math.round((activeBucket.winCount / activeBucket.tradesCount) * 100) : 0}%</strong>
                </span>
              </div>
            </>
          );
        })()}
            </div>

      {/* Bar Canvas Container with Responsive Scroll */}
      <div className="relative pt-3 pb-1 w-full overflow-x-auto no-scrollbar">
        {/* Background Gridlines */}
        <div className="absolute inset-x-0 top-10 bottom-10 flex flex-col justify-between pointer-events-none opacity-25">
          <div className="border-b border-dashed border-border/60 w-full" />
          <div className="border-b border-dashed border-border/60 w-full" />
          <div className="border-b border-dashed border-border/60 w-full" />
        </div>

        <div className="flex items-end justify-between h-[196px] px-0.5 sm:px-2 relative z-10 gap-1 sm:gap-2.5 min-w-[280px]">
          {buckets.map((b, idx) => {
            const isFlat = b.pnl === 0;
            const isPos = b.pnl > 0;
            const heightPct = isFlat ? 3 : Math.min(100, Math.max(8, (Math.abs(b.pnl) / maxVal) * 100));
            const isHovered = hoveredIndex === idx;
            const isSelected = selectedIndex === idx;
            const isActive = isHovered || isSelected;
            const winRate = b.tradesCount > 0 ? Math.round((b.winCount / b.tradesCount) * 100) : 0;
            const barPct = balance > 0 ? (b.pnl / balance) * 100 : 0;

            const tooltipCard = (
              <div className="flex flex-col items-center text-center py-0.5 px-1 font-mono tabular-nums">
                <span className="text-[10px] font-bold uppercase text-accent tracking-wider">{b.label} ({b.subLabel})</span>
                <span className={cn("text-xs font-bold my-0.5", pnlClass(b.pnl))}>{b.pnl >= 0 ? '+' : ''}{fmtUSD(b.pnl)} ({barPct >= 0 ? '+' : ''}{barPct.toFixed(2)}%)</span>
                <span className="text-[9px] text-dim font-medium">{b.tradesCount} trades ({winRate}% WR)</span>
              </div>
            );
            return (
              <Tooltip
                key={b.id}
                content={tooltipCard}
              >
                <div
                  className={cn(
                    "flex-1 min-w-[22px] max-w-[56px] flex flex-col items-center h-full justify-end group relative cursor-pointer rounded-xl transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none p-1",
                    isActive && "bg-white/[0.04]"
                  )}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => setSelectedIndex(prev => prev === idx ? null : idx)}
                  tabIndex={0}
                  role="region"
                  aria-label={`${b.label} (${b.subLabel}): ${fmtUSD(b.pnl)} (${barPct >= 0 ? '+' : ''}${barPct.toFixed(2)}%), ${b.tradesCount} trades, win rate ${winRate}%`}
                >
                  {/* Bar Value Annotation on Top (constant font weight & size = zero reflow on hover) */}
                  <div className={cn(
                    "text-[8px] sm:text-[9.5px] font-mono font-semibold mb-1.5 transition-opacity duration-150 leading-none truncate w-full text-center flex flex-col items-center gap-0.5 tabular-nums",
                    isActive ? "opacity-100" : "opacity-75",
                    isFlat ? "text-dim/60" : pnlClass(b.pnl)
                  )}>
                    <span className="truncate w-full">{isFlat ? '$0' : fmtUSD(b.pnl)}</span>
                    <span className="text-[7px] opacity-80 font-normal">({barPct >= 0 ? '+' : ''}{barPct.toFixed(1)}%)</span>
                  </div>

                  {/* Bar Container */}
                  <div className={cn(
                    "w-full max-w-[44px] h-[126px] flex items-end justify-center rounded-lg bg-background/40 p-1 border transition-colors duration-150",
                    isActive ? "border-accent/50 bg-background/60" : "border-border/30"
                  )}>
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${heightPct}%` }}
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                      className={cn(
                        "w-full rounded-[5px] transition-colors duration-150 relative overflow-hidden",
                        isFlat
                          ? "bg-border/60"
                          : isPos
                            ? cn("bg-gradient-to-t from-accent/85 to-green border-t border-white/25", isActive && "brightness-110")
                            : cn("bg-gradient-to-t from-red/85 to-red-400 border-t border-white/20", isActive && "brightness-110")
                      )}
                    />
                  </div>

                  {/* Label (constant font-semibold = zero horizontal glyph jitter on hover) */}
                  <div className="flex flex-col items-center mt-2 leading-tight w-full">
                    <span className={cn(
                      "text-[9px] sm:text-[11px] font-semibold uppercase tracking-wide transition-colors duration-150 font-mono truncate w-full text-center",
                      isActive ? "text-text" : "text-dim"
                    )}>
                      {b.label}
                    </span>
                    <span className="text-[7.5px] text-dim/60 font-mono hidden sm:inline truncate w-full text-center">
                      {b.subLabel}
                    </span>
                  </div>
                </div>
              </Tooltip>
            );
          })}
        </div>
      </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
MonthlyRevenueChart.displayName = 'MonthlyRevenueChart';

const preloadStrategyDetailView = () => { import('./StrategyDetailView'); };
const preloadConfigModal = () => { import('../components/ConfigModal'); };
const preloadScannerOverlay = () => { import('../components/ScannerOverlay'); };

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

  if (!apiStatus?.isBanned && !apiStatus?.isRateLimited && !apiStatus?.isGeoBlocked) return null;

  const isGeo = !!apiStatus.isGeoBlocked;
  const isBan = !!apiStatus.isBanned && !isGeo;
  const hasBanCountdown = !!apiStatus?.banUntil && timeLeft > 0;
  const cooldownEnd = apiStatus.banUntil ? new Date(apiStatus.banUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown';

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      aria-live="polite"
      className={cn(
        "p-5 rounded-2xl mb-6 flex flex-col md:flex-row items-center gap-4 shadow-xl border",
        (isBan || isGeo) ? "bg-red/20 border-red/40 shadow-red/5" : "bg-amber/20 border-amber/40 shadow-amber/5"
      )}
    >
      <div className={cn(
        "w-12 h-12 rounded-full flex items-center justify-center shrink-0 animate-pulse",
        (isBan || isGeo) ? "bg-red/20 text-red" : "bg-amber/20 text-amber"
      )}>
        <AlertCircle size={24} />
      </div>
      <div className="flex-1 text-center md:text-left">
        <h3 className={cn(
          "text-sm font-black uppercase tracking-tight mb-1",
          (isBan || isGeo) ? "text-red" : "text-amber"
        )}>
          {isGeo ? 'Binance Regional Geo-Restriction (HTTP 451)' : (isBan ? 'Binance IP Ban / Restriction' : 'Rate Limit Protection')}
        </h3>
        <p className={cn(
          "text-xs font-bold",
          (isBan || isGeo) ? "text-red/80" : "text-amber/80"
        )}>
          {apiStatus.lastErrorMessage || (isGeo ? 'Host IP is located in a jurisdiction restricted by Binance. Please configure a Proxy URL in Settings or switch to Testnet/Paper mode.' : `Automatic requests are paused to protect your account standing. Normal operations will resume shortly.`)}
        </p>
      </div>
      <div className="flex flex-col items-center md:items-end gap-1.5 shrink-0">
        <div className={cn(
          "px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border flex items-center gap-2",
          (isBan || isGeo) ? "bg-red/20 border-red/30 text-red" : "bg-amber/20 border-amber/30 text-amber"
        )}>
          <span className="w-2 h-2 rounded-full bg-current motion-safe:animate-ping" aria-hidden="true" />
          {isGeo ? 'Geo-Blocked' : (hasBanCountdown ? formatDuration(timeLeft) : (isBan ? 'Restricted' : 'Active'))}
        </div>
        {hasBanCountdown && (
          <div className="flex items-center gap-1.5 opacity-60">
            <History size={10} />
            <span className="text-[9px] font-bold uppercase tracking-tighter">Ends at {cooldownEnd}</span>
          </div>
        )}
        {(isBan || isGeo) && (
           <Btn
             onClick={async () => {
               try {
                 await sessionAPI.clearBan();
                 useTradingStore.setState(st => ({
                   apiStatus: {
                     ...st.apiStatus,
                     isBanned: false,
                     isRateLimited: false,
                     isGeoBlocked: false,
                     banUntil: null,
                     lastErrorMessage: null
                   }
                 }));
               } catch (e) {
                 console.error('Failed to clear ban:', e);
               }
             }}
             className="w-full mt-2"
             variant="outline"
             size="sm">
               Unlock
           </Btn>
        )}
      </div>
    </motion.div>
  );
};

// --- Strategy Card ---
export const StrategyCard = React.memo(({ s, config, onClick, onPause, onEdit, hideEdit, paused, isPausing, gateInfo, className, isResuming, showResumingFeedback, onMouseEnter, onEditMouseEnter, stratMetrics = null, viewMode = 'detailed' }) => {
  const analytics = useTradingStore(state => state.analytics);
  const isGated = gateInfo && ['max_trades', 'sl_guard', 'max_trades_period', 'sleeping', 'risk_pct', 'tod_risk', 'risk'].includes(gateInfo.gateState || '');
  const tradingMode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

  const storeBalance = useTradingStore(state => state.balance);
  const totalSessionPnl = useTradingStore(state => state.totalPnl || 0);

  const startingBalance = tradingMode === 'paper'
    ? (config.paper_starting_balance || 10000)
    : (tradingMode === 'testnet'
        ? (config.testnet_starting_balance && config.testnet_starting_balance !== 10000
            ? config.testnet_starting_balance
            : (storeBalance ? Math.max(1, storeBalance - totalSessionPnl) : 10000))
        : (config.live_starting_balance && config.live_starting_balance !== 10000
            ? config.live_starting_balance
            : (storeBalance ? Math.max(1, storeBalance - totalSessionPnl) : 10000)));

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
    if (isPausing) return;
    onPause(s.strategy_label);
  }, [onPause, s.strategy_label, isPausing]);

  const activeCount = s.activeTradeCount || 0;
  const isAutoAdjust = config.auto_adjust_max_trades_enabled || false;
  // BOLT OPTIMIZATION: Fused activeRisk calculation using a single-pass O(N) loop
  // Replaces .filter() and .reduce() to eliminate transient array allocations.
  const activeRisk = useTradingStore(state => {
    const trades = state.activeTrades || [];
    const stratLabel = s.strategy_label || 'Momentum Strategy';
    let risk = 0;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if ((t.strategy_label || 'Momentum Strategy') === stratLabel) {
        risk += (t.risk_usdt || 0);
      }
    }
    return risk;
  });
  const isZeroActiveRiskExpanded = isAutoAdjust && activeCount > 0 && activeRisk <= 1e-6;
  const effectiveMaxOpen = isZeroActiveRiskExpanded
    ? Math.min(config.auto_adjust_max_trades_max || 5, Math.max(config.max_open_trades || 5, activeCount) + (config.auto_adjust_max_trades_step || 1))
    : (config.max_open_trades || 5);

  const maxOpen = effectiveMaxOpen;
  const capacityPct = Math.max(0, Math.min(100, (activeCount / maxOpen) * 100));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(s.strategy_label);
    }
  };

  const activeEstPnl = safeNum(s.activeEstPnl);
  const closedPnl = safeNum(s.totalPnl) - safeNum(s.activePnl);
  const totalEstToRealize = closedPnl + activeEstPnl;

  const isCompact = viewMode === 'compact';
  const isList = viewMode === 'list';

  // Mobile-Optimized List view rendering (Prevents overlaps, clean responsive hierarchy, icon cues & color-coded PnL)
  if (isList) {
    const isPosActive = s.activePnl >= 0;
    const isPosReturn = s.totalPnl >= 0;

    return (
      <div
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={onMouseEnter}
        role="button"
        tabIndex={0}
        className={cn(
          "bg-surface border border-border/40 rounded-xl p-2.5 sm:px-3 sm:py-2 flex items-center justify-between gap-2.5 w-full shadow-sm cursor-pointer hover:border-accent/40 hover:bg-white/[0.02] transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none group relative overflow-hidden min-h-[42px]",
          className,
          isResuming && "opacity-80 border-accent/20"
        )}
        aria-label={`View details for ${s.strategy_label} strategy, active P&L ${fmtUSD(s.activePnl)}, session return ${fmtUSD(s.totalPnl)}`}
      >
        {/* Left: Color Status Dot Cue, Strategy Name & Timeframe Badge */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Tooltip content={s.sessionActive ? "Engine Status: Active" : "Engine Status: Stopped"}>
            <span className={cn(
              "w-2 h-2 rounded-full shrink-0 transition-all",
              s.sessionActive
                ? "bg-green shadow-[0_0_8px_rgba(0,229,160,0.5)] animate-pulse"
                : "bg-dim/40"
            )} />
          </Tooltip>

          <Tooltip content={`Strategy: ${s.strategy_label}`}>
            <h3 className="font-black font-mono text-xs tracking-tight uppercase text-text group-hover:text-accent transition-colors cursor-help truncate max-w-[120px] xs:max-w-[180px] sm:max-w-none">
              {s.strategy_label}
            </h3>
          </Tooltip>

          {/* Timeframe Icon Cue Badge */}
          <Tooltip content={`Timeframe scan interval: ${config.scan_interval}`}>
            <span className="text-[8px] font-mono font-black text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded uppercase shrink-0 hidden xs:flex items-center gap-1 cursor-help">
              <Zap size={9} />
              {config.scan_interval}
            </span>
          </Tooltip>

          {paused && !isResuming && (
            <Tooltip content="Strategy Engine Paused">
              <div className="p-1 rounded bg-amber/10 border border-amber/20 text-amber shrink-0 flex items-center justify-center cursor-help">
                <Pause size={10} fill="currentColor" />
              </div>
            </Tooltip>
          )}

          {isGated && !paused && !isResuming && (
            <Tooltip content={gateInfo?.gateReason || 'Gated by Risk Rules'}>
              <div className="p-1 rounded bg-amber/10 border border-amber/20 text-amber shrink-0 flex items-center justify-center cursor-help">
                <AlertCircle size={10} className="animate-pulse" />
              </div>
            </Tooltip>
          )}
        </div>

        {/* Right: Color-Coded Active PnL & Session Return Badges + Position Allocation Pill */}
        <div className="flex items-center gap-1.5 xs:gap-2 sm:gap-3 shrink-0 font-mono text-xs">
          {/* Active PnL Color-Coded Badge */}
          <Tooltip content={`Active Open P&L: ${fmtUSD(s.activePnl)} (${(() => {
            const currentAccBal = storeBalance || startingBalance;
            const activePct = currentAccBal > 0 ? (s.activePnl / currentAccBal) * 100 : 0;
            return `${activePct >= 0 ? '+' : ''}${activePct.toFixed(2)}%`;
          })()})`}>
            <div className={cn(
              "px-2 py-0.5 rounded-lg border flex items-center gap-1 font-black text-[10px] xs:text-[11px] leading-none shrink-0",
              isPosActive ? "bg-green/10 border-green/25 text-green" : "bg-red/10 border-red/25 text-red"
            )}>
              {isPosActive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
              <span>{fmtUSD(s.activePnl)}</span>
            </div>
          </Tooltip>

          {/* Session Return Color-Coded Badge */}
          <Tooltip content={`Total Session Return: ${fmtUSD(s.totalPnl)} (${sessionReturnPct.toFixed(2)}%)`}>
            <div className={cn(
              "px-2 py-0.5 rounded-lg border flex items-center gap-1 font-black text-[11px] leading-none shrink-0 hidden sm:flex",
              isPosReturn ? "bg-green/10 border-green/20 text-green/90" : "bg-red/10 border-red/20 text-red/90"
            )}>
              <span>{sessionReturnPct >= 0 ? '+' : ''}{sessionReturnPct.toFixed(1)}%</span>
            </div>
          </Tooltip>

          {/* Position Slot Capacity Pill */}
          <Tooltip content={`Active Positions: ${activeCount} out of ${maxOpen} maximum slots`}>
            <div className={cn(
              "px-1.5 sm:px-2 py-0.5 rounded-full border text-[9px] xs:text-[10px] font-black font-mono shrink-0 flex items-center gap-1",
              activeCount > 0 ? "bg-accent/15 border-accent/30 text-accent" : "bg-background/60 border-border/30 text-dim"
            )}>
              <Users size={10} />
              <span>{activeCount}/{maxOpen}</span>
            </div>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      role="button"
      tabIndex={0}
      className={cn(
        "bg-surface border border-border/40 rounded-xl flex flex-col w-full h-full shadow-sm cursor-pointer hover:border-accent/30 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none group relative overflow-hidden",
        isCompact ? "p-2.5 gap-2" : "p-3 sm:p-3.5 gap-2.5",
        className,
        isResuming && "opacity-80 border-accent/20 bg-accent/[0.01]"
      )}
      aria-label={`View details for ${s.strategy_label} strategy, active positions P&L is ${fmtUSD(s.activePnl)}, total session return is ${fmtUSD(s.totalPnl)}`}
    >
      {showResumingFeedback && (
        <div className="absolute inset-0 bg-accent/5 backdrop-blur-[1px] z-10 flex items-center justify-center pointer-events-none">
           <div className="bg-background/80 border border-accent/20 px-3 py-1 rounded-full text-[8px] font-black text-accent uppercase tracking-widest flex items-center gap-1.5 shadow-xl animate-in fade-in zoom-in duration-300">
              <RefreshCw size={10} className="animate-spin" /> Resuming Feed...
           </div>
        </div>
      )}

      {/* Card Header */}
      <div className="flex justify-between items-start gap-2.5">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={cn("font-black font-mono tracking-tight truncate uppercase leading-none text-text group-hover:text-accent transition-colors", isCompact ? "text-xs" : "text-xs sm:text-sm")}>
              {s.strategy_label}
            </h3>

            {/* Status Badges (Mode badge omitted since ViewHeader already displays Paper/Testnet/Live) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <StatusBadge status={s.sessionActive} />

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

          <div className="flex gap-1.5 items-center flex-wrap">
            <span className="bg-accent/10 text-accent border border-accent/20 text-[7.5px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 font-mono">
              {config.scan_interval} · {config.scan_pct_threshold}%
            </span>
            {config.htf_ema_cross_boost_enabled !== false && (
              <Tooltip content={`HTF EMA Cross Ranking Active: ${config.htf_ema_cross_interval || '4h'} timeframe (${config.htf_ema_fast_period || 9}/${config.htf_ema_slow_period || 21} EMAs, Boost Weight: ${config.htf_ema_cross_rr_weight || 1.5}x)`}>
                <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[7.5px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 font-mono flex items-center gap-1 cursor-help">
                  ⚡ {(config.htf_ema_cross_interval || '4h').toUpperCase()} HTF
                </span>
              </Tooltip>
            )}
            {config.tp_mode === 'exp_rr_seq_switch' && s.peakRrSwitchHits >= (config.peak_rr_switch_count || 1) && (
              <Tooltip content={`Strategy has achieved peak RR threshold ${config.peak_rr_switch_threshold}R. Using alternate switched milestone guards.`}>
                <span className="bg-blue/10 text-blue border border-blue/30 text-[7.5px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 font-mono flex items-center gap-1 cursor-help">
                  <RefreshCw size={8} className="text-blue shrink-0" />
                  SWITCHED
                </span>
              </Tooltip>
            )}
            {isZeroActiveRiskExpanded && (
              <Tooltip content={`Dynamic Capacity Expanded: All open trades risk-protected (0.00 USDT active risk). Max trades boosted to ${maxOpen} (Step +${config.auto_adjust_max_trades_step || 1}, Max ${config.auto_adjust_max_trades_max || 5}).`}>
                <span className="bg-green/10 text-green border border-green/20 text-[7.5px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 font-mono flex items-center gap-1 cursor-help">
                  ⚡ MAX {activeCount}/{maxOpen}
                </span>
              </Tooltip>
            )}
            {(() => {
              const rawHitRate = s.entryCount > 0 ? ((s.hitCount || 0) / s.entryCount) * 100 : 0;
              const hitRate = Math.min(100, Math.max(0, rawHitRate));
              const pfVal = stratMetrics ? stratMetrics.profitFactor : 0;
              const sharpeVal = stratMetrics ? stratMetrics.sharpe : 0;
              const sortinoVal = stratMetrics ? stratMetrics.sortino : 0;

              const pfText = s.entryCount > 0 ? Number(pfVal).toFixed(2) : '---';
              const sharpeText = s.entryCount > 0 ? Number(sharpeVal).toFixed(2) : '---';
              const sortinoText = s.entryCount > 0 ? Number(sortinoVal).toFixed(2) : '---';

              if (isCompact) {
                return (
                  <div className="bg-accent/10 border border-accent/25 text-accent text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 flex-wrap font-mono">
                    <span>WR: {hitRate.toFixed(0)}%</span>
                    <span>·</span>
                    <span>PF: {pfText}</span>
                  </div>
                );
              }

              return (
                <div className="bg-accent/10 border border-accent/25 text-accent text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1.5 flex-wrap font-mono">
                  <span>WR: {hitRate.toFixed(0)}% ({s.hitCount || 0}/{s.entryCount || 0})</span>
                  <span>·</span>
                  <Tooltip content="Profit Factor (Gross Wins / Gross Losses). Recommended: > 1.0 (Profitable), >= 2.0 (Strong)">
                    <span className="cursor-help focus-visible:ring-1 focus-visible:ring-accent outline-none rounded-xs" tabIndex={0} aria-label={`Profit Factor: ${pfText}. Recommended greater than 1.0`}>
                      PF: {pfText}
                    </span>
                  </Tooltip>
                  <span>·</span>
                  <Tooltip content="Sharpe Ratio (Risk-Adjusted Return). Recommended: >= 1.0 (Acceptable), >= 1.5 (Good), >= 2.0 (Excellent)">
                    <span className="cursor-help focus-visible:ring-1 focus-visible:ring-accent outline-none rounded-xs" tabIndex={0} aria-label={`Sharpe Ratio: ${sharpeText}. Recommended >= 1.0 Acceptable, >= 1.5 Good, >= 2.0 Excellent`}>
                      Sh: {sharpeText}
                    </span>
                  </Tooltip>
                  <span>·</span>
                  <Tooltip content="Sortino Ratio (Downside Risk-Adjusted Return). Recommended: >= 1.0 (Acceptable), >= 2.0 (Good), >= 3.0 (Excellent)">
                    <span className="cursor-help focus-visible:ring-1 focus-visible:ring-accent outline-none rounded-xs" tabIndex={0} aria-label={`Sortino Ratio: ${sortinoText}. Recommended >= 1.0 Acceptable, >= 2.0 Good, >= 3.0 Excellent`}>
                      So: {sortinoText}
                    </span>
                  </Tooltip>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Inline Action Buttons */}
        <div className="flex items-center gap-1 shrink-0 relative z-20">
          {!hideEdit && (
            <Tooltip content="Edit Strategy Config">
              <button
                type="button"
                onClick={handleEditClick}
                onMouseEnter={onEditMouseEnter}
                className="p-1.5 hover:bg-white/5 text-dim hover:text-accent rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer"
                aria-label="Edit Strategy"
              >
                <Edit3 size={12.5} />
              </button>
            </Tooltip>
          )}
          <Tooltip content={isPausing ? (paused ? "Resuming Strategy..." : "Pausing Strategy...") : (paused ? "Resume Strategy Engine" : "Pause Strategy Engine")}>
            <button
              type="button"
              onClick={handlePauseClick}
              disabled={isPausing}
              aria-busy={isPausing}
              aria-disabled={isPausing}
              className={cn(
                "p-1.5 rounded-lg transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none",
                isPausing ? "cursor-wait opacity-60 text-dim" : (paused ? "hover:bg-green/10 text-green cursor-pointer" : "hover:bg-amber/10 text-amber cursor-pointer")
              )}
              aria-label={isPausing ? (paused ? "Resuming Strategy Engine" : "Pausing Strategy Engine") : (paused ? "Resume Strategy Engine" : "Pause Strategy Engine")}
            >
              {isPausing ? <Loader2 size={12.5} className="animate-spin text-accent" /> : (paused ? <Play size={12.5} fill="currentColor" /> : <Pause size={12.5} fill="currentColor" />)}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Compact 3-Column Metrics + Integrated Slot Capacity Runway */}
      <div className="grid grid-cols-3 gap-2.5 items-center pt-2 border-t border-border/20 mt-auto">
        <div className="flex flex-col min-w-0">
          <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-none">Active P&amp;L</span>
          <div className="flex items-baseline gap-1 mt-1 flex-wrap">
            <span className="font-black font-mono tracking-tight leading-none text-xs sm:text-sm tabular-nums" style={{ color: pnlColor(s.activePnl) }}>
              {fmtUSD(s.activePnl)}
            </span>
            <span className="text-[8px] font-bold font-mono tabular-nums" style={{ color: pnlColor(s.activePnl) }}>
              {(() => {
                const currentAccBal = storeBalance || startingBalance;
                const activePct = currentAccBal > 0 ? (s.activePnl / currentAccBal) * 100 : 0;
                return `(${activePct >= 0 ? '+' : ''}${activePct.toFixed(2)}%)`;
              })()}
            </span>
          </div>
          {!isCompact && (activeEstPnl !== 0 || totalEstToRealize !== 0) && (
            <span className="text-[8px] text-dim/60 font-mono truncate mt-0.5">
              Est <span className="font-bold" style={{ color: pnlColor(activeEstPnl) }}>{fmtUSD(activeEstPnl)}</span> · Proj <span className="font-bold" style={{ color: pnlColor(totalEstToRealize) }}>{fmtUSD(totalEstToRealize)}</span>
            </span>
          )}
        </div>

        <div className="flex flex-col min-w-0">
          <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-none">Session Return</span>
          <div className="flex items-baseline gap-1 mt-1 flex-wrap">
            <span className="font-black font-mono tracking-tight leading-none text-xs sm:text-sm tabular-nums" style={{ color: pnlColor(s.totalPnl) }}>
              {fmtUSD(s.totalPnl)}
            </span>
            <span className="text-[8px] font-bold font-mono tabular-nums" style={{ color: pnlColor(s.totalPnl) }}>
              ({sessionReturnPct >= 0 ? '+' : ''}{sessionReturnPct.toFixed(2)}%)
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end text-right min-w-0">
          <div className="flex items-center justify-end gap-1.5 w-full">
            <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-none">Slots</span>
            <span className="font-black font-mono tracking-tight text-text/90 leading-none text-xs sm:text-sm tabular-nums">
              {activeCount}/{maxOpen}
            </span>
          </div>
          <div
            className="h-1.5 w-full max-w-[96px] bg-border/40 rounded-full overflow-hidden relative mt-1.5"
            role="progressbar"
            aria-valuenow={Math.round(capacityPct)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label={`${s.strategy_label} slot allocation capacity is at ${activeCount} out of ${maxOpen} positions`}
          >
            <div
              className={cn(
                "h-full w-full origin-left transition-transform duration-300",
                capacityPct >= 80 ? "bg-amber" : "bg-accent"
              )}
              style={{ transform: `scaleX(${Math.max(0, Math.min(1, capacityPct / 100))})` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
})

const GateBanner = React.memo(({ gateState, scannerPaused, reason, nextSlotTs, hibernating, hibernationMode, activeTradesCount = 0, showResumingFeedback, onManage }) => {
  // SRE/React: Hooks MUST be invoked unconditionally and in the same order on
  // every render. An early `return null` previously sat ABOVE these hooks, which
  // violates the Rules of Hooks and corrupts React's internal fiber (manifests as
  // the cryptic "Expected static flag was missing" crash on GateBanner mount).
  // The visibility guard is moved below the hooks.
  const config = useTradingStore(state => state.config);
  const now = useNow();

  if (!gateState && !scannerPaused && !showResumingFeedback) return null;

  const nextSlotSec = nextSlotTs ? Math.max(0, Math.ceil((nextSlotTs - now) / 1000)) : null;

  const waitTimeStr = nextSlotSec !== null
    ? (nextSlotSec > 60 ? `${Math.ceil(nextSlotSec / 60)}m` : `${nextSlotSec}s`)
    : '';

  const messages = {
    max_trades: 'Maximum open trades reached. Entry gated.',
    max_trades_period: nextSlotSec !== null ? `Maximum trades for the current period reached. Next slot in ~${Math.max(1, Math.ceil(nextSlotSec / 60))}m.` : 'Maximum trades for the current period reached. Scanner paused.',
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

// ScannerPreview renders 🔥 Fast Market Expansion banner when market activity is high (extracted to standalone component)
export { ScannerPreview } from '../components/ScannerPreview'

const ReconciliationCenter = React.memo(({ sessionActive, tradingMode, config, addAlert }) => {
  const [untrackedPositions, setUntrackedPositions] = useState([]);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState({});
  const [adoptingSymbols, setAdoptingSymbols] = useState(new Set());
  const [manualInitialSl, setManualInitialSl] = useState({});
  const [manualCurrentSl, setManualCurrentSl] = useState({});

  const strategyLabels = useMemo(() => {
    const baseLabel = config?.strategy_label || 'Momentum Strategy';
    const variantLabels = (config?.strategy_variants || [])
      .filter(v => v && v.enabled !== false)
      .map((v, i) => v.strategy_label || `Variant ${i + 1}`);
    return [baseLabel, ...variantLabels];
  }, [config]);

  const fetchUntracked = React.useCallback(async () => {
    try {
      const res = await sessionAPI.getUntrackedPositions();
      const positions = res.data.positions || [];
      setUntrackedPositions(positions);

      const slDistPct = config.sl_distance_pct || 2.0;

      // Pre-populate suggested strategy labels mapped from exchange orders history
      setSelectedStrategy(prev => {
        const next = { ...prev };
        positions.forEach(pos => {
          if (!next[pos.symbol] && pos.suggestedStrategyLabel) {
            next[pos.symbol] = pos.suggestedStrategyLabel;
          }
        });
        return next;
      });

      // Pre-populate Initial SL with smart estimations
      setManualInitialSl(prev => {
        const next = { ...prev };
        positions.forEach(pos => {
          if (next[pos.symbol] === undefined) {
            const isLong = pos.amount > 0;
            const fallbackSl = pos.entryPrice * (isLong ? (1 - slDistPct / 100) : (1 + slDistPct / 100));
            next[pos.symbol] = Number(pos.currentSl || fallbackSl).toFixed(5);
          }
        });
        return next;
      });

      // Pre-populate Current SL with smart estimations
      setManualCurrentSl(prev => {
        const next = { ...prev };
        positions.forEach(pos => {
          if (next[pos.symbol] === undefined) {
            const isLong = pos.amount > 0;
            const fallbackSl = pos.entryPrice * (isLong ? (1 - slDistPct / 100) : (1 + slDistPct / 100));
            next[pos.symbol] = Number(pos.currentSl || fallbackSl).toFixed(5);
          }
        });
        return next;
      });

    } catch (e) {
      console.error("Failed to fetch untracked positions:", e);
    }
  }, [config]);

  useEffect(() => {
    if (!showReconciliation || !sessionActive || tradingMode === 'paper') return;

    fetchUntracked();
    // Use conservative 30 seconds polling interval to protect exchange API rate weight
    const interval = setInterval(fetchUntracked, 30000);
    return () => clearInterval(interval);
  }, [showReconciliation, sessionActive, tradingMode, fetchUntracked]);

  const handleAdopt = React.useCallback(async (symbol) => {
    const chosenStrategy = selectedStrategy[symbol] || strategyLabels[0];
    const initialSl = Number(manualInitialSl[symbol]) || 0;
    const currentSl = Number(manualCurrentSl[symbol]) || 0;

    setAdoptingSymbols(prev => {
      const next = new Set(prev);
      next.add(symbol);
      return next;
    });

    try {
      await sessionAPI.adoptPosition(symbol, chosenStrategy, initialSl, currentSl);
      addAlert({
        level: 'success',
        title: 'Position Adopted',
        message: `Successfully adopted ${symbol} under strategy "${chosenStrategy}".`
      });
      await fetchUntracked();
      if (typeof useTradingStore.getState().fetchTradeHistory === 'function') useTradingStore.getState().fetchTradeHistory('all');
      if (typeof useTradingStore.getState().fetchAnalytics === 'function') useTradingStore.getState().fetchAnalytics();
    } catch (e) {
      const msg = e?.response?.data?.message || 'Failed to adopt position';
      addAlert({
        level: 'error',
        title: 'Adoption Failed',
        message: msg
      });
    } finally {
      setAdoptingSymbols(prev => {
        const next = new Set(prev);
        next.delete(symbol);
        return next;
      });
    }
  }, [selectedStrategy, strategyLabels, manualInitialSl, manualCurrentSl, addAlert, fetchUntracked]);

  if (!sessionActive || tradingMode === 'paper') return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col mb-5 lg:mb-6"
    >
      <button
        onClick={() => setShowReconciliation(!showReconciliation)}
        className="group flex items-center justify-between w-full mb-4 text-left outline-none cursor-pointer select-none"
        aria-expanded={showReconciliation}
        aria-controls="reconciliation-center-list"
        aria-label={showReconciliation ? "Collapse Reconciliation Center section" : "Expand Reconciliation Center section"}
      >
        <SectionLabel className="mb-0 flex-1 flex items-center gap-2">
          <Briefcase size={14} className="text-accent" /> Reconciliation Center
          {untrackedPositions.length > 0 && (
            <span className="bg-amber/20 border border-amber/30 text-amber text-[9px] font-black font-mono px-2 py-0.5 rounded-full motion-safe:animate-pulse">
              {untrackedPositions.length} UNTRACKED
            </span>
          )}
        </SectionLabel>
        <div className={cn(
          "p-1.5 rounded-lg border border-border/40 bg-surface/50 text-dim group-hover:text-accent group-hover:border-accent/40 transition-all",
          showReconciliation && "text-accent border-accent/40 bg-accent/5 rotate-180"
        )}>
          <ChevronLeft size={14} className="-rotate-90" />
        </div>
      </button>

      <AnimatePresence>
        {showReconciliation && (
          <motion.div
            id="reconciliation-center-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="bg-surface border border-border/40 rounded-2xl p-5 md:p-6 shadow-sm flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <div className="text-[10px] text-dim font-black uppercase tracking-widest">Exchange Reconciliation Console</div>
                <div className="text-xs font-bold text-text/80">Manage active exchange positions belonging to other instances or orphaned runs. Select the appropriate strategy configuration below to adopt and protect them.</div>
              </div>

              {untrackedPositions.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 bg-background/25 border border-dashed border-border/30 rounded-xl text-dim font-mono text-[10px] uppercase tracking-widest gap-2">
                  <CheckCircle2 size={16} className="text-green/60" />
                  All Exchange Positions Synchronized
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {untrackedPositions.map((pos) => {
                    const isLong = pos.amount > 0;
                    const directionText = isLong ? "LONG" : "SHORT";
                    const chosenStrategy = selectedStrategy[pos.symbol] || strategyLabels[0];
                    const isAdopting = adoptingSymbols.has(pos.symbol);

                    return (
                      <div
                        key={pos.symbol}
                        className="bg-background/20 border border-border/30 hover:border-accent/30 rounded-xl p-4 flex flex-col gap-4 transition-all"
                      >
                        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[9px] font-black uppercase px-2 py-0.5 rounded tracking-wider",
                                isLong ? "bg-green/10 text-green border border-green/20" : "bg-red/10 text-red border border-red/20"
                              )}>
                                {directionText}
                              </span>
                              <strong className="text-sm font-black font-mono tracking-tight">{pos.symbol.replace('USDT', '')}</strong>
                            </div>

                            <div className="grid grid-cols-3 gap-3 md:gap-4 sm:border-l sm:border-border/20 sm:pl-4">
                              <div className="flex flex-col">
                                <span className="text-[8px] text-dim font-black uppercase tracking-wider">Amount</span>
                                <span className="text-xs font-bold font-mono">{Math.abs(pos.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[8px] text-dim font-black uppercase tracking-wider">Entry Price</span>
                                <span className="text-xs font-bold font-mono">${pos.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[8px] text-dim font-black uppercase tracking-wider">Notional</span>
                                <span className="text-xs font-bold font-mono">${pos.notional.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                            <div className="flex items-center justify-end sm:justify-start">
                              {pos.startedByUs ? (
                                <span className="bg-green/10 border border-green/30 text-green text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg flex items-center gap-1.5 shadow-sm">
                                  <CheckCircle2 size={11} /> Our Instance
                                </span>
                              ) : (
                                <span className="bg-amber/15 border border-amber/35 text-amber text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg flex items-center gap-1.5 shadow-sm">
                                  <Info size={11} /> Other Instance
                                </span>
                              )}
                            </div>

                            <div className="relative">
                              <select
                                aria-label={`Select strategy variant to adopt ${pos.symbol}`}
                                value={chosenStrategy}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSelectedStrategy(prev => ({
                                    ...prev,
                                    [pos.symbol]: val
                                  }));
                                }}
                                disabled={isAdopting}
                                className="w-full sm:w-44 px-3 py-2 bg-background border border-border/50 rounded-xl text-[11px] font-black uppercase tracking-wider text-text hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all cursor-pointer"
                              >
                                {strategyLabels.map((label) => (
                                  <option key={label} value={label}>{label}</option>
                                ))}
                              </select>
                            </div>

                            <motion.button
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.98 }}
                              type="button"
                              onClick={() => handleAdopt(pos.symbol)}
                              disabled={isAdopting}
                              className={cn(
                                "px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all cursor-pointer flex items-center justify-center gap-2",
                                pos.startedByUs
                                  ? "bg-green/10 border-green/30 text-green hover:bg-green/20"
                                  : "bg-accent/15 border-accent/35 text-accent hover:bg-accent/25"
                              )}
                            >
                              {isAdopting ? (
                                <>
                                  <Loader2 size={12} className="animate-spin" /> ADOPTING...
                                </>
                              ) : (
                                <>
                                  <ShieldCheck size={12} /> ADOPT & PROTECT
                                </>
                              )}
                            </motion.button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border/20 pt-3">
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor={`initial-sl-${pos.symbol}`} className="text-[8px] font-black text-dim uppercase tracking-wider cursor-pointer">Initial Stop Loss Price</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/60 font-mono text-xs pointer-events-none">$</span>
                              <input
                                id={`initial-sl-${pos.symbol}`}
                                type="number"
                                step="any"
                                value={manualInitialSl[pos.symbol] || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setManualInitialSl(prev => ({ ...prev, [pos.symbol]: val }));
                                }}
                                disabled={isAdopting}
                                className="pl-7 pr-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                                placeholder="Enter Initial SL"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor={`current-sl-${pos.symbol}`} className="text-[8px] font-black text-dim uppercase tracking-wider cursor-pointer">Current Stop Loss Price</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/60 font-mono text-xs pointer-events-none">$</span>
                              <input
                                id={`current-sl-${pos.symbol}`}
                                type="number"
                                step="any"
                                value={manualCurrentSl[pos.symbol] || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setManualCurrentSl(prev => ({ ...prev, [pos.symbol]: val }));
                                }}
                                disabled={isAdopting}
                                className="pl-7 pr-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                                placeholder="Enter Current SL"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
ReconciliationCenter.displayName = 'ReconciliationCenter';

export function DashboardView({ initialStrategy }) {
  const [selected, setSelected] = useState(initialStrategy || null)
  const resumingRef = useRef(false)
  const [cardViewMode, setCardViewMode] = useState(() => {
    return localStorage.getItem('dashboard_card_view_mode') || 'detailed';
  });

  const handleCardViewModeChange = (mode) => {
    setCardViewMode(mode);
    localStorage.setItem('dashboard_card_view_mode', mode);
  };
  const [globalMetricsExpanded, setGlobalMetricsExpanded] = useState(() => {
    return localStorage.getItem('global_metrics_expanded') === 'true';
  })

  const toggleGlobalMetricsExpanded = () => {
    const next = !globalMetricsExpanded;
    setGlobalMetricsExpanded(next);
    try {
      localStorage.setItem('global_metrics_expanded', String(next));
    } catch (e) {}
  };

  const [showTemporalRisk, setShowTemporalRisk] = useState(false)
  const [showSessionLogs, setShowSessionLogs] = useState(false)

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
  const [pausingMap, setPausingMap] = useState({})
  const [loading, setLoading] = useState(false)
  const [scannerFocusLabel, setScannerFocusLabel] = useState(null)
  const [periodicScope, setPeriodicScope] = useState('all')
  const [periodicTimeframe, setPeriodicTimeframe] = useState('7D')
  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const {
    sessionActive, sessionPaused, pausedStrategies, strategyGateStates, strategyId, balance, totalPnl, totalRiskPct,
    totalSlUsed, totalEstPnlToRealize, activeTrades, alerts, config, setSessionActive,
    updateConfig, patchConfig, gateState, gateReason, hibernating, hibernationMode, agreementRequired,
    scannerPaused, scannerResults, sessionList, fetchSessions, wsStatus,
    updateStats, analytics, stats, lastUdsBalanceReason, lastUdsBalanceTs,
    sidebarCollapsed, variantScannerResults, variantStats, isThrottled, setThrottled, isEcoMode, entryCount, hitCount,
    healthEnabled, isSyncing, setSyncing, configSyncing, isAdaptiveTightened, apiStatus, effectivePeriodMs, isSyncingOnResume,
    nextSlotTs, fetchTradeHistory, fetchAnalytics, tradeHistory, sessionTradeHistory, sessionTradeHistoryId, tradeHistoryCounts, sessionTradeHistoryCounts
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
    scannerResults: state.scannerResults || [],
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
    stats: state.stats,
    lastUdsBalanceReason: state.lastUdsBalanceReason,
    lastUdsBalanceTs: state.lastUdsBalanceTs,
    effectivePeriodMs: state.effectivePeriodMs,
    isSyncingOnResume: state.isSyncingOnResume,
    nextSlotTs: state.nextSlotTs,
    fetchTradeHistory: state.fetchTradeHistory,
    fetchAnalytics: state.fetchAnalytics,
    tradeHistory: state.tradeHistory,
    sessionTradeHistory: state.sessionTradeHistory,
    sessionTradeHistoryId: state.sessionTradeHistoryId,
    tradeHistoryCounts: state.tradeHistoryCounts,
    sessionTradeHistoryCounts: state.sessionTradeHistoryCounts
  }), shallow)

  useEffect(() => {
    if (showConfig) {
      setModalConfig(selectedConfig || config);
    } else {
      setModalConfig(null);
    }
  }, [showConfig, selectedConfig, config]);

  const safeVariantStats = variantStats || {}
  const activeTradingMode = config?.trading_mode || (config?.paper_mode === false ? 'live' : 'paper');

  const currentStrategy = useMemo(() => ({
    sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, totalEstPnlToRealize, activeTrades, entryCount, hitCount,
    strategy_label: config.strategy_label || 'Momentum Strategy'
  }), [sessionActive, sessionPaused, strategyId, totalPnl, totalRiskPct, totalSlUsed, totalEstPnlToRealize, activeTrades, entryCount, hitCount, config.strategy_label])

  const validTradeHistory = useMemo(() => {
    const hist = tradeHistory || [];
    return hist.filter(t => isClosedValidTrade(t, activeTradingMode));
  }, [tradeHistory, activeTradingMode]);

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
    const lt = validTradeHistory.length > 0 ? validTradeHistory[0] : null;
    return { lastSession: ls, lastTrade: lt };
  }, [sessionList, validTradeHistory]);

  const effectivePeriodicSessionId = strategyId || lastSession?.id || null;

  const sessionScopedHistory = useMemo(() => {
    if (!strategyId) return [];
    if (sessionTradeHistoryId === strategyId) {
      return (sessionTradeHistory || []).filter(t => isClosedValidTrade(t, activeTradingMode));
    }
    return validTradeHistory.filter(t => (t.sessionId || t.session_id) === strategyId);
  }, [strategyId, sessionTradeHistoryId, sessionTradeHistory, validTradeHistory, activeTradingMode]);

  const periodicTradeHistory = useMemo(() => {
    if (periodicScope === 'session' && effectivePeriodicSessionId) {
      if (sessionTradeHistoryId === effectivePeriodicSessionId) {
        return sessionTradeHistory || [];
      }
      return validTradeHistory.filter(t => (t.sessionId || t.session_id) === effectivePeriodicSessionId);
    }
    return validTradeHistory;
  }, [periodicScope, effectivePeriodicSessionId, sessionTradeHistoryId, sessionTradeHistory, validTradeHistory]);

  // BOLT OPTIMIZATION: Loop-fused single-pass traversal (no intermediate array allocations)
  const { netFunding, netComm, lastFundingFee, lastRealizedFee } = useMemo(() => {
    let feeSum = stats?.totalRealizedFee || 0;
    let fundingSum = stats?.totalFundingFee || 0;
    let lastFunding = null;
    let lastFee = null;

    const hist = validTradeHistory;
    for (let i = 0; i < hist.length; i++) {
      const rf = Number(hist[i].realized_fee) || 0;
      const ff = Number(hist[i].funding_fee) || 0;
      if (rf !== 0 && lastFee === null) lastFee = rf;
      if (ff !== 0 && lastFunding === null) lastFunding = ff;
      if (stats?.totalFundingFee === undefined) fundingSum += ff;
      if (stats?.totalRealizedFee === undefined) feeSum += rf;
    }

    const active = activeTrades || [];
    for (let i = 0; i < active.length; i++) {
      const rf = Number(active[i].realized_fee) || 0;
      const ff = Number(active[i].funding_fee) || 0;
      if (rf !== 0 && lastFee === null) lastFee = rf;
      if (ff !== 0 && lastFunding === null) lastFunding = ff;
      if (stats?.totalFundingFee === undefined) fundingSum += ff;
      if (stats?.totalRealizedFee === undefined) feeSum += rf;
    }

    return { netFunding: fundingSum, netComm: feeSum, lastFundingFee: lastFunding, lastRealizedFee: lastFee };
  }, [stats?.totalFundingFee, stats?.totalRealizedFee, validTradeHistory, activeTrades]);

  const stratMetricsMap = useMemo(() => {
    const history = strategyId ? sessionScopedHistory : validTradeHistory;
    const grouped = new Map();

    for (let i = 0; i < history.length; i++) {
      const t = history[i];
      const label = t.strategy_label || t.strategyLabel || 'Momentum Strategy';
      if (!grouped.has(label)) {
        grouped.set(label, []);
      }
      grouped.get(label).push(t);
    }

    const storeBal = useTradingStore.getState().balance;
    const storeTotalPnl = useTradingStore.getState().totalPnl || 0;
    const startingBal = activeTradingMode === 'paper'
      ? (config?.paper_starting_balance || 10000)
      : (activeTradingMode === 'testnet'
          ? (config?.testnet_starting_balance && config?.testnet_starting_balance !== 10000
              ? config.testnet_starting_balance
              : (storeBal ? Math.max(1, storeBal - storeTotalPnl) : 10000))
          : (config?.live_starting_balance && config?.live_starting_balance !== 10000
              ? config.live_starting_balance
              : (storeBal ? Math.max(1, storeBal - storeTotalPnl) : 10000)));

    const map = new Map();
    for (const [label, trades] of grouped.entries()) {
      map.set(label, calculatePerformanceMetrics(trades, startingBal));
    }

    return map;
  }, [strategyId, sessionScopedHistory, validTradeHistory, activeTradingMode, config]);

  const { activePnlMap, activeRiskMap, activeEstPnlToRealizeMap, activeTradeCountsMap, totalActivePnl, peakActivePnl, minActivePnl, oldestActiveEntryTs, latestActiveUpdateTs, maxRR } = useMemo(() => {
    const strategyLabel = currentStrategy.strategy_label;
    const pnlMap = { [strategyLabel]: 0 };
    const riskMap = { [strategyLabel]: 0 };
    const estPnlMap = { [strategyLabel]: 0 };
    const countMap = { [strategyLabel]: 0 };

    const variants = config.strategy_variants || [];
    for (let i = 0; i < variants.length; i++) {
      const label = variants[i].strategy_label || 'Variant';
      pnlMap[label] = 0;
      riskMap[label] = 0;
      estPnlMap[label] = 0;
      countMap[label] = 0;
    }

    let maxRrAchieved = 0;
    let peakActivePnlSum = 0;
    let minActivePnlSum = 0;
    let oldestEntryTs = Infinity;
    let latestUpdateTs = 0;
    // BOLT OPTIMIZATION: Accumulate totalActivePnl in-loop to eliminate Object.values(pnlMap) array allocation and second pass
    let totPnl = 0;

    const trades = activeTrades || [];
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if (t) {
        const tradeLabel = t.strategy_label || strategyLabel;
        if (pnlMap[tradeLabel] === undefined) {
          pnlMap[tradeLabel] = 0;
          riskMap[tradeLabel] = 0;
          estPnlMap[tradeLabel] = 0;
          countMap[tradeLabel] = 0;
        }
        const label = tradeLabel;
        const pnlVal = safeNum(t.pnl);
        pnlMap[label] += pnlVal;
        estPnlMap[label] += safeNum(t.est_pnl_to_realize);
        countMap[label]++;
        totPnl += pnlVal;

        // Calculate risk in USDT to convert R multiples to dollar amounts if max_pnl is not directly present
        const riskUsdt = safeNum(t.risk_usdt || t.initial_risk_usdt) ||
          (t.entry_price && t.qty && t.initial_sl ? Math.abs(t.entry_price - t.initial_sl) * t.qty : 0);
        riskMap[label] += riskUsdt;

        const peakRr = Number(t.max_rr ?? t.max_rr_achieved ?? t.rr ?? 0);
        const minRr = Number(t.min_rr_achieved ?? t.min_rr ?? t.rr ?? 0);

        const tradePeakPnl = riskUsdt > 0 && peakRr > 0 ? Math.max(pnlVal, peakRr * riskUsdt) : Math.max(pnlVal, 0);
        const tradeMinPnl = riskUsdt > 0 && minRr < 0 ? Math.min(pnlVal, minRr * riskUsdt) : Math.min(pnlVal, 0);

        peakActivePnlSum += tradePeakPnl;
        minActivePnlSum += tradeMinPnl;

        if (peakRr > maxRrAchieved) {
          maxRrAchieved = peakRr;
        }

        const entryTs = t.entry_ts_ms || (t.entry_ts ? new Date(t.entry_ts).getTime() : 0) || (t.createdAt ? new Date(t.createdAt).getTime() : 0);
        if (entryTs > 0 && entryTs < oldestEntryTs) {
          oldestEntryTs = entryTs;
        }

        const updateTs = t.exit_ts_ms || (t.updated_at ? new Date(t.updated_at).getTime() : 0) || entryTs;
        if (updateTs > latestUpdateTs) {
          latestUpdateTs = updateTs;
        }
      }
    }

    return {
      activePnlMap: pnlMap,
      activeRiskMap: riskMap,
      activeEstPnlToRealizeMap: estPnlMap,
      activeTradeCountsMap: countMap,
      totalActivePnl: totPnl,
      peakActivePnl: peakActivePnlSum,
      minActivePnl: minActivePnlSum,
      oldestActiveEntryTs: oldestEntryTs !== Infinity ? oldestEntryTs : null,
      latestActiveUpdateTs: latestUpdateTs > 0 ? latestUpdateTs : null,
      maxRR: maxRrAchieved
    };
  }, [activeTrades, currentStrategy.strategy_label, config.strategy_variants]);

  const { todaysPnl, todaysPnlPct } = useMemo(() => {
    const now = new Date(nowTick);
    const startOfDayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let closedTodayPnl = 0;
    const history = validTradeHistory;
    for (let i = 0; i < history.length; i++) {
      const t = history[i];
      if (!t) continue;
      const exitTs = t.exit_ts_ms ?? (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
      if (exitTs >= startOfDayMs) {
        closedTodayPnl += Number(t.pnl || 0);
      }
    }

    const netTodayPnl = closedTodayPnl + (totalActivePnl || 0);
    const startOfDayBalance = balance - netTodayPnl;
    const pct = startOfDayBalance > 0 ? (netTodayPnl / startOfDayBalance) * 100 : 0;

    return { todaysPnl: netTodayPnl, todaysPnlPct: pct };
  }, [validTradeHistory, totalActivePnl, balance, nowTick]);

  const pendingScannerTriggers = useMemo(() => {
    let count = 0;
    const variantKeys = Object.keys(variantScannerResults || {});
    const seenSymbols = new Set();
    const thresh = config.scan_pct_threshold || 2;

    for (const key of variantKeys) {
      const opps = variantScannerResults[key] || [];
      for (const o of opps) {
        if (o && !seenSymbols.has(o.symbol) && Math.abs(o.pct || 0) >= thresh) {
          seenSymbols.add(o.symbol);
          count++;
        }
      }
    }

    return count;
  }, [variantScannerResults, config.scan_pct_threshold]);

  const monitoredSymbolsSet = useMemo(() => {
    const set = new Set();
    (config.single_symbol_configs || []).forEach(sc => {
      if (sc.enabled) set.add(sc.symbol);
    });
    return set;
  }, [config.single_symbol_configs]);

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
    if (typeof fetchSessions === 'function') fetchSessions();
    if (typeof fetchAnalytics === 'function') fetchAnalytics();

    const toggleScanner = () => setShowScanner(prev => !prev);
    window.addEventListener('toggle-scanner', toggleScanner);
    return () => window.removeEventListener('toggle-scanner', toggleScanner);
  }, [fetchSessions, fetchAnalytics, config?.paper_mode, activeTradingMode, strategyId]);

  const lastPeriodicFetchRef = React.useRef({ key: null, limit: 0 });
  const lastSessionSeedRef = React.useRef({ sid: null, limit: 0 });

  useEffect(() => {
    if (typeof fetchTradeHistory !== 'function') return;
    const isSessionScope = periodicScope === 'session' && effectivePeriodicSessionId;
    const targetSid = isSessionScope ? effectivePeriodicSessionId : 'all';
    const knownCounts = isSessionScope
      ? (sessionTradeHistoryId === effectivePeriodicSessionId ? sessionTradeHistoryCounts : null)
      : tradeHistoryCounts;

    const { limit } = resolveAdaptivePeriodicLimit(periodicTimeframe, knownCounts);
    const fetchKey = `${activeTradingMode}:${targetSid}:${periodicTimeframe}`;

    if (lastPeriodicFetchRef.current.key !== fetchKey || limit > lastPeriodicFetchRef.current.limit) {
      lastPeriodicFetchRef.current = { key: fetchKey, limit };
      fetchTradeHistory(targetSid, limit);
    }

    if (!isSessionScope && effectivePeriodicSessionId) {
      const sessCounts = sessionTradeHistoryId === effectivePeriodicSessionId ? sessionTradeHistoryCounts : null;
      const { limit: sessLimit } = resolveAdaptivePeriodicLimit(periodicTimeframe, sessCounts);
      if (lastSessionSeedRef.current.sid !== effectivePeriodicSessionId || sessLimit > lastSessionSeedRef.current.limit) {
        lastSessionSeedRef.current = { sid: effectivePeriodicSessionId, limit: sessLimit };
        fetchTradeHistory(effectivePeriodicSessionId, sessLimit);
      }
    }
  }, [fetchTradeHistory, activeTradingMode, effectivePeriodicSessionId, periodicTimeframe, periodicScope, tradeHistoryCounts, sessionTradeHistoryCounts, sessionTradeHistoryId]);

  const handlePeriodicScopeChange = React.useCallback((nextScope) => {
    const normalizedScope = nextScope === 'session' && effectivePeriodicSessionId ? 'session' : 'all';
    setPeriodicScope(normalizedScope);
  }, [effectivePeriodicSessionId]);

  const handlePeriodicTimeframeChange = React.useCallback((nextTf) => {
    setPeriodicTimeframe(nextTf);
  }, []);

  const addAlert = useTradingStore(state => state.addAlert);

  const handleConfigSave = React.useCallback(async (newConfig) => {
    setLoading(true)
    setSyncing(true)
    useTradingStore.setState({ configSyncing: true }); // Enable global sync protection
    try {
      let finalConfig = newConfig;
      const wasPresetLoaded = newConfig._presetLoaded;
      const isMergedRootConfig = newConfig._isMergedRootConfig === true;
      delete newConfig._presetLoaded;
      delete newConfig._isMergedRootConfig;

      let activeVariantIndex = editingVariantIndex;

      if (isMergedRootConfig) {
        finalConfig = newConfig;
      } else if (activeVariantIndex !== null) {
        // Fallback merge when an unmerged single-variant payload is passed
        if (Array.isArray(newConfig.strategy_variants) && newConfig.strategy_variants.length > 0 && newConfig.strategy_label === config.strategy_label) {
          finalConfig = newConfig;
        } else {
          const variants = [...(config.strategy_variants || [])];
          // Strip out top-level strategy_variants from the edited variant config to avoid recursive nesting
          const variantClean = { ...newConfig };
          delete variantClean.strategy_variants;
          const vLabel = variantClean.strategy_label || variants[activeVariantIndex]?.strategy_label || `Variant ${activeVariantIndex + 1}`;
          variants[activeVariantIndex] = { ...variantClean, strategy_label: vLabel };
          finalConfig = { ...config, strategy_variants: variants };
        }
      } else {
        // When saving base strategy, ensure variants from newConfig or existing config are strictly preserved
        if (!Array.isArray(newConfig.strategy_variants) && Array.isArray(config.strategy_variants)) {
          finalConfig = { ...newConfig, strategy_variants: config.strategy_variants };
        }
      }

      const targetStrategyId = strategyId || lastSession?.id || (sessionActive ? 'default-session' : null);
      if (isEditMode && targetStrategyId) {
        await sessionAPI.update(targetStrategyId, finalConfig)
        updateConfig(finalConfig)
        addAlert({ level: 'success', title: 'Config Updated', message: 'Strategy parameters synchronized with the engine.' });
      } else {
        if (apiStatus?.isBanned) {
          addAlert({
            level: 'error',
            title: 'Action Blocked',
            message: 'Cannot start new trading sessions while an API ban or geo-restriction is active.'
          });
          return false;
        }
        const res = await sessionAPI.start(finalConfig, finalConfig.paper_mode)
        updateConfig(finalConfig)
        setSessionActive(true, res.data.strategyId || res.data.strategy_id || res.data.sessionId || 'default-session')
        addAlert({ level: 'success', title: 'Session Started', message: `Engine active with "${finalConfig.strategy_label}".` });
      }
      setShowConfig(false)
      setIsEditMode(false)
      setEditingVariantIndex(null)
      await fetchSessions()
      return true;
    } catch (e) {
      const isNetworkError = e?.message === 'Network Error' || e?.code === 'ERR_NETWORK';
      const msg = isNetworkError
        ? 'Network Error: Failed to reach backend. Check your internet or CORS settings.'
        : formatApiErrorMessage(e, 'Failed to save config');
      addAlert({ level: 'error', title: 'Action Failed', message: msg });
      return false;
    } finally {
      setLoading(false)
      setSyncing(false)
      useTradingStore.setState({ configSyncing: false });
    }
  }, [config, isEditMode, strategyId, editingVariantIndex, updateConfig, setSessionActive, addAlert, fetchSessions, setSyncing]);

  const togglePause = React.useCallback(async (strategyLabel) => {
    const key = strategyLabel || '__session__';
    if (pausingMap[key]) {
      console.log(`[Strategy Engine] Pause toggle already in flight for key: ${key}, ignoring duplicate trigger.`);
      return;
    }

    setPausingMap(prev => ({ ...prev, [key]: true }));
    console.log(`[Strategy Engine] Dispatching pause toggle request for strategy: ${key}`);

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
      console.log(`[Strategy Engine] Successfully toggled pause state for strategy: ${key}`);
    } catch (e) {
      console.error('[Strategy Engine] Pause toggle failed:', e);
      addAlert({ level: 'error', title: 'Action Failed', message: 'Could not toggle pause state.' });
    } finally {
      setPausingMap(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [sessionPaused, pausedStrategies, addAlert, pausingMap]);

  const handleResumeLast = React.useCallback(async () => {
    if (!lastSession || resumingRef.current) return;
    if (apiStatus?.isBanned || apiStatus?.isGeoBlocked) {
      addAlert({
        level: 'error',
        title: 'Action Blocked',
        message: 'Cannot resume sessions while an API ban or geo-restriction is active.'
      });
      return;
    }
    resumingRef.current = true;
    setLoading(true);
    setSyncing(true);
    try {
      const baseCfg = lastSession.config && typeof lastSession.config === 'object' ? lastSession.config : {};
      const resolvedPaperMode = lastSession.paperMode ?? lastSession.paper_mode ?? baseCfg.paper_mode ?? true;
      const resolvedTradingMode = baseCfg.trading_mode || lastSession.tradingMode || (resolvedPaperMode === false ? 'live' : 'paper');
      const resumeConfig = {
        ...baseCfg,
        trading_mode: resolvedTradingMode,
        paper_mode: resolvedTradingMode === 'paper',
      };
      const res = await sessionAPI.start(resumeConfig, resumeConfig.paper_mode, lastSession.id);
      setSessionActive(true, res.data?.strategyId || res.data?.strategy_id || res.data?.sessionId || lastSession.id);
      const label = baseCfg.strategy_label || lastSession.strategyLabel || 'Previous Session';
      addAlert({ level: 'success', title: 'Session Resumed', message: `Restored previous session "${label}".` });
    } catch (e) {
      const status = e?.response?.status;
      const errMsg = formatApiErrorMessage(e, 'Could not restore previous session state.');
      console.error('[Resume Last] Failed to restore session:', e);
      addAlert({ level: 'error', title: 'Resume Failed', message: errMsg });
      if (status === 409 && typeof useTradingStore.getState().sync === 'function') {
        useTradingStore.getState().sync();
      }
    } finally {
      resumingRef.current = false;
      setLoading(false);
      setSyncing(false);
    }
  }, [lastSession, apiStatus?.isBanned, apiStatus?.isGeoBlocked, setSessionActive, addAlert, setSyncing]);

  const handleStop = React.useCallback(async () => {
    setLoading(true)
    setSyncing(true)
    try {
      await sessionAPI.stop()
      setSessionActive(false, null)
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('config_draft');
        sessionStorage.removeItem('loaded_preset_name');
      }
      addAlert({ level: 'info', title: 'Session Terminated', message: 'Engine stopped and all positions closed at market.' });
      await fetchSessions()
    } catch (e) {
      setSessionActive(false, null)
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('config_draft');
        sessionStorage.removeItem('loaded_preset_name');
      }
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
      const resolved = resolveStrategyConfig(config, config.strategy_variants[idx]);
      const variantConfig = {
        ...resolved,
        strategy_variants: Array.isArray(config.strategy_variants) ? config.strategy_variants : []
      };
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
    const vStats = safeVariantStats[selected];
    const stratMetric = stratMetricsMap.get(selected);
    const activeVariantsCount = (config?.strategy_variants || []).filter(v => v && v.enabled !== false).length;
    const isBaseSelected = selected === currentStrategy.strategy_label;
    const computedActivePnl = activePnlMap[selected] || 0;
    const computedRiskUsdt = activeRiskMap[selected] || 0;
    const fallbackRiskPct = vStats?.totalRiskPct ?? (balance > 0 && computedRiskUsdt > 0 ? (computedRiskUsdt / balance) * 100 : (isBaseSelected && activeVariantsCount === 0 ? totalRiskPct : 0));
    const fallbackTotalPnl = vStats?.totalPnl ?? (stratMetric ? stratMetric.totalPnl + computedActivePnl : (isBaseSelected && activeVariantsCount === 0 ? currentStrategy.totalPnl : computedActivePnl));
    const fallbackEntryCount = vStats?.entryCount ?? (stratMetric ? (stratMetric.wins + stratMetric.losses) : (isBaseSelected && activeVariantsCount === 0 ? currentStrategy.entryCount : (activeTradeCountsMap[selected] || 0)));
    const fallbackHitCount = vStats?.hitCount ?? (stratMetric ? stratMetric.wins : (isBaseSelected && activeVariantsCount === 0 ? currentStrategy.hitCount : 0));

    return {
      ...currentStrategy,
      strategy_label: selected,
      ...vStats,
      totalPnl: fallbackTotalPnl,
      entryCount: fallbackEntryCount,
      hitCount: fallbackHitCount,
      totalRiskPct: fallbackRiskPct,
      activeTradeCount: activeTradeCountsMap[selected] || vStats?.activeTradeCount || 0,
      totalEstPnlToRealize: vStats?.totalEstPnlToRealize ?? activeEstPnlToRealizeMap[selected] ?? 0,
      activePnl: computedActivePnl
    };
  }, [selected, currentStrategy, safeVariantStats, stratMetricsMap, config?.strategy_variants, activePnlMap, activeRiskMap, activeTradeCountsMap, activeEstPnlToRealizeMap, balance, totalRiskPct]);

  const tradingMode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showResumingFeedback = sessionActive && isResuming;

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300 relative overflow-x-clip",
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
          "max-w-[1600px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 lg:px-5 lg:pt-5 transition-all",
          healthEnabled ? "pb-48 sm:pb-48 md:pb-48 lg:pb-16" : "pb-36 sm:pb-36 md:pb-36 lg:pb-16"
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

        {/* Header Bar (hideMetricsNumbers avoids duplicating the 4 Global Metrics cards right below) */}
        <ViewHeader
          title="Overview"
          subTitle="Real-time strategy management & market oversight"
          sticky={true}
          hideMetricsNumbers={true}
        >
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {config.frequency_shaping_enabled && (
                  <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 border border-accent/20 rounded-xl text-[9px] font-bold text-accent uppercase tracking-widest">
                    <Activity size={10} />
                    Frequency Guard
                  </div>
                )}

                <Tooltip content={isThrottled ? "Disable Eco Mode" : "Enable Eco Mode (Power Saver)"}>
                  <button
                    onClick={() => setThrottled(!isThrottled)}
                    aria-label={isThrottled ? "Disable Eco Mode" : "Enable Eco Mode (Power Saver)"}
                    className={cn(
                      "px-2.5 py-1.5 rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer",
                      isThrottled
                        ? "bg-green/10 border-green/30 text-green shadow-[0_0_15px_rgba(0,229,160,0.1)]"
                        : "bg-surface border-border/60 text-dim hover:text-accent hover:border-accent/40"
                    )}
                  >
                    <Leaf size={13} fill={isThrottled ? "currentColor" : "none"} />
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
                      className="p-1.5 bg-red/10 border border-red/20 text-red rounded-xl hover:bg-red/20 hover:scale-95 active:scale-90 transition-all focus-visible:ring-2 focus-visible:ring-red outline-none cursor-pointer"
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
              className="bg-red/20 border border-red/40 p-3.5 rounded-xl mb-3 flex flex-col md:flex-row items-center gap-3 shadow-lg"
            >
              <div className="w-9 h-9 rounded-full bg-red/20 flex items-center justify-center text-red shrink-0 animate-pulse">
                <AlertCircle size={18} />
              </div>
              <div className="flex-1 text-center md:text-left">
                <h3 className="text-xs font-black uppercase tracking-tight text-red mb-0.5">Exchange Agreement Required</h3>
                <p className="text-[11px] font-bold text-red/80">Binance requires you to sign the TradFi-Perps agreement contract. Trading is restricted until this is completed on the Binance website.</p>
              </div>
              <a
                href="https://www.binance.com/en/futures/BTCUSDT"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-1.5 bg-red text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red/90 transition-all shadow-md active:scale-95 shrink-0"
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

        {/* Unified Portfolio & Risk Limits Strip */}
        <div className="flex flex-col gap-2.5 mb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <SectionLabel className="mb-0 flex items-center gap-1.5 whitespace-nowrap shrink-0">
                <Activity size={13} className="text-accent shrink-0" /> Global Metrics
              </SectionLabel>
              <span className="sm:hidden text-[10px] font-mono tabular-nums text-dim truncate">
                {(activeTrades || []).length}/{config.max_open_trades} Slots · Cap {Number(config.max_total_risk_pct || 5).toFixed(1)}%
              </span>
            </div>

            {/* Unified equal-height control track */}
            <div
              role="group"
              aria-label="Global metrics and risk limits controls"
              className="grid grid-cols-2 sm:inline-flex items-stretch gap-1 p-1 bg-surface/90 border border-border/60 rounded-xl w-full sm:w-auto shrink-0"
            >
              <button
                type="button"
                onClick={() => setShowTemporalRisk(!showTemporalRisk)}
                aria-expanded={showTemporalRisk}
                aria-controls="temporal-risk-grid"
                aria-label={showTemporalRisk ? "Collapse Temporal Risk section" : "Expand Temporal Risk section"}
                className={cn(
                  "h-9 sm:h-7 px-2.5 sm:px-3 rounded-lg flex items-center justify-center gap-1.5 text-[10.5px] sm:text-[10px] font-mono font-bold uppercase tracking-wider transition-all whitespace-nowrap min-w-0 shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none border",
                  showTemporalRisk
                    ? "bg-accent/15 border-accent/35 text-accent shadow-xs"
                    : "border-transparent text-dim hover:text-text hover:bg-background/60"
                )}
              >
                <ShieldCheck size={12} className="text-accent shrink-0" />
                <span className="truncate">Risk Limits</span>
                <span className="opacity-70 tabular-nums shrink-0">({config.max_open_trades})</span>
                <ChevronDown size={12} className={cn("shrink-0 transition-transform duration-200", showTemporalRisk && "rotate-180")} />
              </button>
              <button
                type="button"
                onClick={toggleGlobalMetricsExpanded}
                aria-expanded={globalMetricsExpanded}
                aria-label={globalMetricsExpanded ? "Collapse secondary global metrics" : "Expand secondary global metrics"}
                className={cn(
                  "h-9 sm:h-7 px-2.5 sm:px-3 rounded-lg flex items-center justify-center gap-1.5 text-[10.5px] sm:text-[10px] font-mono font-bold uppercase tracking-wider transition-all whitespace-nowrap min-w-0 shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none border",
                  globalMetricsExpanded
                    ? "bg-background/90 border-border/60 text-text shadow-xs"
                    : "border-transparent text-dim hover:text-text hover:bg-background/60"
                )}
              >
                <span>{globalMetricsExpanded ? "Compact" : "Expand"}</span>
                <ChevronDown size={12} className={cn("shrink-0 transition-transform duration-200", globalMetricsExpanded && "rotate-180")} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-fr items-stretch gap-2.5">
            <StatCard
              compact={!globalMetricsExpanded}
              label="Account Balance"
              value={`$${balance.toLocaleString()}`}
              tooltipText={(() => {
                const tradingMode = config?.trading_mode || (config?.paper_mode ? 'paper' : 'live');
                const startBal = tradingMode === 'paper'
                  ? (config?.paper_starting_balance || 10000)
                  : (tradingMode === 'testnet'
                      ? (config?.testnet_starting_balance && config.testnet_starting_balance !== 10000 ? config.testnet_starting_balance : Math.max(1, balance - totalPnl))
                      : (config?.live_starting_balance && config.live_starting_balance !== 10000 ? config.live_starting_balance : Math.max(1, balance - totalPnl)));
                const fundPct = balance > 0 ? (Math.abs(netFunding) / balance) * 100 : 0;
                const commPct = balance > 0 ? (Math.abs(netComm) / balance) * 100 : 0;
                const tradeTs = lastTrade?.exit_ts_ms || (lastTrade?.exit_ts ? new Date(lastTrade.exit_ts).getTime() : 0);
                const tradeTimeStr = tradeTs ? `Last Trade: ${formatTimeAgo(tradeTs)}` : 'No closed trades';
                const syncTimeStr = lastUdsBalanceTs ? `UDS Sync: ${formatTimeAgo(lastUdsBalanceTs)}` : 'Sync: Active';
                const reasonText = lastUdsBalanceReason ? `UDS Reason: ${lastUdsBalanceReason}` : 'Real-time Stream';
                return `Available Funds: $${balance.toLocaleString()} | Starting: $${startBal.toLocaleString()} | Net Funding: ${fmtUSD(-netFunding)} (${fundPct.toFixed(2)}%) | Commission: ${fmtUSD(-netComm)} (${commPct.toFixed(2)}%) | ${tradeTimeStr} | ${syncTimeStr} (${reasonText})`;
              })()}
              ariaLabel={(() => {
                if (!lastTrade) return `Account Balance: $${balance.toLocaleString()}`;
                const prevBalance = balance - (lastTrade.pnl || 0);
                const balPctChange = prevBalance > 0 ? ((lastTrade.pnl || 0) / prevBalance) * 100 : 0;
                const tradeTs = lastTrade?.exit_ts_ms || (lastTrade?.exit_ts ? new Date(lastTrade.exit_ts).getTime() : 0);
                const tradeTimeAgo = tradeTs ? formatTimeAgo(tradeTs) : '';
                return `Account Balance: $${balance.toLocaleString()}. Last trade closed ${tradeTimeAgo} with PnL ${Number(lastTrade.pnl || 0) >= 0 ? 'plus' : 'minus'} $${Math.abs(lastTrade.pnl || 0).toFixed(2)} (${Math.abs(balPctChange || 0).toFixed(2)}%).`;
              })()}
              subValue={globalMetricsExpanded ? (() => {
                const prevBalance = lastTrade ? balance - (lastTrade.pnl || 0) : balance;
                const balPctChange = prevBalance > 0 && lastTrade ? ((lastTrade.pnl || 0) / prevBalance) * 100 : 0;
                const fundPct = balance > 0 ? (Math.abs(netFunding) / balance) * 100 : 0;
                const commPct = balance > 0 ? (Math.abs(netComm) / balance) * 100 : 0;
                const tradeTs = lastTrade?.exit_ts_ms || (lastTrade?.exit_ts ? new Date(lastTrade.exit_ts).getTime() : 0) || (lastTrade?.updated_at ? new Date(lastTrade.updated_at).getTime() : 0) || (lastTrade?.entry_ts ? new Date(lastTrade.entry_ts).getTime() : 0);
                const tradeTimeAgo = tradeTs ? formatTimeAgo(tradeTs) : null;
                const udsTimeAgo = lastUdsBalanceTs ? formatTimeAgo(lastUdsBalanceTs) : null;

                return (
                  <div className="flex flex-col gap-0.5 text-[9px]">
                    {lastTrade && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {Number(lastTrade.pnl || 0) >= 0 ? <TrendingUp size={9} className="text-green" /> : <TrendingDown size={9} className="text-red" />}
                        <span className={pnlClass(lastTrade.pnl)}>
                          {fmtUSD(lastTrade.pnl)} ({balPctChange >= 0 ? '+' : ''}{Number(balPctChange).toFixed(2)}%)
                        </span>
                        {tradeTimeAgo && <span className="text-dim text-[8.5px]">· {tradeTimeAgo}</span>}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap text-[8.5px] font-mono text-dim/70">
                      <span>Fund: <span className={netFunding > 0 ? "text-red/80" : "text-green/80"}>{fmtUSD(-netFunding)} ({fundPct.toFixed(2)}%)</span></span>
                      <span>•</span>
                      <span>Fee: <span className="text-red/80">{fmtUSD(-netComm)} ({commPct.toFixed(2)}%)</span></span>
                      {lastUdsBalanceReason && (
                        <>
                          <span>•</span>
                          <span className="text-accent font-bold">{lastUdsBalanceReason} {udsTimeAgo && `(${udsTimeAgo})`}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })() : null}
            />
            <StatCard
              compact={!globalMetricsExpanded}
              label="Active P&L"
              value={`${fmtUSD(totalActivePnl)} (${(() => {
                const activePct = balance > 0 ? (totalActivePnl / balance) * 100 : 0;
                return `${activePct >= 0 ? '+' : ''}${activePct.toFixed(2)}%`;
              })()})`}
              color={pnlClass(totalActivePnl)}
              subValue={globalMetricsExpanded ? (() => {
                const modeLabel = config?.trading_mode ? (config.trading_mode === 'paper' ? 'Paper' : config.trading_mode === 'testnet' ? 'Testnet' : 'Live') : (config?.paper_mode ? 'Paper' : 'Live');
                if (!activeTrades || activeTrades.length === 0) {
                  return `Session (${modeLabel}): ${fmtUSD(totalPnl)}`;
                }
                const peakPct = balance > 0 ? (peakActivePnl / balance) * 100 : 0;
                const minPct = balance > 0 ? (minActivePnl / balance) * 100 : 0;
                return (
                  <div className="flex items-center gap-1.5 flex-wrap text-[8.5px] font-mono">
                    <span>Peak: <span className="text-green font-bold">{fmtUSD(peakActivePnl)} ({peakPct >= 0 ? '+' : ''}{peakPct.toFixed(1)}%)</span></span>
                    <span>•</span>
                    <span>Min: <span className={cn(minActivePnl < 0 ? "text-red font-bold" : "text-dim")}>{fmtUSD(minActivePnl)} ({minPct >= 0 ? '+' : ''}{minPct.toFixed(1)}%)</span></span>
                    <span>•</span>
                    <span className="text-dim">Session ({modeLabel}): {fmtUSD(totalPnl)}</span>
                  </div>
                );
              })() : null}
              syncing={isResuming}
              tooltipText="Current unrealized P&L, Peak P&L, Min P&L (MAE), and open trade durations across all active trades."
            />
            <StatCard
              compact={!globalMetricsExpanded}
              label="Live Risk"
              value={`${Number(totalRiskPct || 0).toFixed(1)}%`}
              color={totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"}
              subValue={globalMetricsExpanded ? `Cap: ${Number(config.max_total_risk_pct || 5).toFixed(1)}% · ${(activeTrades || []).length}/${config.max_open_trades || 3} Slots` : null}
              tooltipText="Combined risk percentage across all open positions relative to account equity."
            />
            <StatCard
              compact={!globalMetricsExpanded}
              label="Peak RR"
              value={`+${Number(maxRR || 0).toFixed(2)}`}
              color="text-accent"
              subValue={globalMetricsExpanded ? `${hitCount || 0}/${entryCount || 0} Hits · TP ${fmtUSD(totalEstPnlToRealize || 0)}` : null}
              tooltipText="Maximum Reward-to-Risk ratio achieved during this trading session."
            />
          </div>

          <AnimatePresence>
            {showTemporalRisk && (
              <motion.div
                id="temporal-risk-grid"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden pt-1"
              >
                <TemporalRiskGrid />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <ReconciliationCenter
          sessionActive={sessionActive}
          tradingMode={tradingMode}
          config={config}
          addAlert={addAlert}
        />

        {/* Primary Workspace: Active Strategy Cards Promoted to Top */}
        <div className="bg-surface border border-border rounded-xl p-3 sm:p-4 flex flex-col shadow-sm mb-3">
          <div className="flex items-center justify-between mb-2.5">
            <SectionLabel className="mb-0 flex items-center gap-1.5">
              <Zap size={13} className="text-accent" /> Active Strategy
            </SectionLabel>
            <div className="flex items-center bg-background/60 border border-border/40 p-0.5 rounded-lg" role="tablist" aria-label="Strategy card view mode selection">
              <button
                type="button"
                role="tab"
                aria-selected={cardViewMode === 'detailed'}
                aria-controls="active-strategy-cards-container"
                onClick={() => handleCardViewModeChange('detailed')}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                  cardViewMode === 'detailed' ? "bg-accent text-white shadow-xs" : "text-dim hover:text-text"
                )}
                aria-label="Detailed strategy cards view"
              >
                Detailed
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={cardViewMode === 'compact'}
                aria-controls="active-strategy-cards-container"
                onClick={() => handleCardViewModeChange('compact')}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                  cardViewMode === 'compact' ? "bg-accent text-white shadow-xs" : "text-dim hover:text-text"
                )}
                aria-label="Compact strategy cards view"
              >
                Compact
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={cardViewMode === 'list'}
                aria-controls="active-strategy-cards-container"
                onClick={() => handleCardViewModeChange('list')}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                  cardViewMode === 'list' ? "bg-accent text-white shadow-xs" : "text-dim hover:text-text"
                )}
                aria-label="List strategy cards view"
              >
                List
              </button>
            </div>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={cardViewMode}
              id="active-strategy-cards-container"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: "easeInOut" }}
              className={cn(
                "grid gap-2.5 sm:gap-3",
                cardViewMode === 'list' ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 auto-rows-fr items-stretch"
              )}
            >
            {sessionActive ? (
              <>
                {(() => {
                  const activeVariants = (config?.strategy_variants || []).filter(v => v && v.enabled !== false);
                  const totalCards = 1 + activeVariants.length;
                  const baseLabel = currentStrategy.strategy_label;
                  const baseMetric = stratMetricsMap.get(baseLabel);
                  const baseComputedPnl = baseMetric ? baseMetric.totalPnl + (activePnlMap[baseLabel] || 0) : (activeVariants.length > 0 ? (activePnlMap[baseLabel] || 0) : currentStrategy.totalPnl);
                  const rawBaseVariantPnl = safeVariantStats[baseLabel]?.totalPnl;
                  const baseTotalPnl = (rawBaseVariantPnl !== undefined && rawBaseVariantPnl !== null && (rawBaseVariantPnl !== 0 || baseComputedPnl === 0))
                    ? rawBaseVariantPnl
                    : baseComputedPnl;
                  const baseEntryCount = safeVariantStats[baseLabel]?.entryCount ?? (baseMetric ? (baseMetric.count ?? (baseMetric.wins + (baseMetric.losses || 0))) : (activeVariants.length > 0 ? (activeTradeCountsMap[baseLabel] || 0) : currentStrategy.entryCount));
                  const baseHitCount = safeVariantStats[baseLabel]?.hitCount ?? (baseMetric ? baseMetric.wins : (activeVariants.length > 0 ? 0 : currentStrategy.hitCount));

                  return (
                    <>
                      <StrategyCard
                        s={{
                          ...currentStrategy,
                          ...safeVariantStats[baseLabel],
                          totalPnl: baseTotalPnl,
                          entryCount: baseEntryCount,
                          hitCount: baseHitCount,
                          activePnl: activePnlMap[baseLabel] || 0,
                          activeEstPnl: activeEstPnlToRealizeMap[baseLabel] || 0,
                          activeTradeCount: activeTradeCountsMap[baseLabel] || 0,
                          totalEstPnlToRealize: safeVariantStats[baseLabel]?.totalEstPnlToRealize ?? activeEstPnlToRealizeMap[baseLabel] ?? 0,
                          peakRrSwitchHits: strategyGateStates[baseLabel]?.peakRrSwitchHits || 0
                        }}
                        scannerResults={variantScannerResults[baseLabel]}
                        config={config}
                        paused={pausedStrategies.includes(currentStrategy.strategy_label) || sessionPaused}
                        isPausing={!!pausingMap[currentStrategy.strategy_label]}
                        gateInfo={strategyGateStates[currentStrategy.strategy_label]}
                        onPause={togglePause}
                        onOpenScanner={handleOpenScanner}
                        onEdit={handleEditPrimary}
                        onClick={handleSelectPrimary}
                        onMouseEnter={preloadStrategyDetailView}
                        onEditMouseEnter={preloadConfigModal}
                        isMonitored={monitoredSymbolsSet.has(currentStrategy.strategy_label)}
                        className={cn(totalCards % 2 !== 0 && "md:col-span-2")}
                        isResuming={isResuming}
                        showResumingFeedback={showResumingFeedback}
                        stratMetrics={stratMetricsMap.get(currentStrategy.strategy_label)}
                        viewMode={cardViewMode}
                      />
                      {activeVariants.map((variant, i) => {
                        const label = variant.strategy_label || `Variant ${i + 1}`;
                        const variantConfig = { ...config, ...variant };
                        const stratMetric = stratMetricsMap.get(label);
                        const variantComputedPnl = stratMetric ? stratMetric.totalPnl + (activePnlMap[label] || 0) : (activePnlMap[label] || 0);
                        const rawVariantPnl = safeVariantStats[label]?.totalPnl;
                        const variantTotalPnl = (rawVariantPnl !== undefined && rawVariantPnl !== null && (rawVariantPnl !== 0 || variantComputedPnl === 0))
                          ? rawVariantPnl
                          : variantComputedPnl;
                        const variantEntryCount = safeVariantStats[label]?.entryCount ?? (stratMetric ? (stratMetric.count ?? (stratMetric.wins + (stratMetric.losses || 0))) : (activeTradeCountsMap[label] || 0));
                        const variantHitCount = safeVariantStats[label]?.hitCount ?? (stratMetric ? stratMetric.wins : 0);
                        return (
                          <StrategyCard
                            key={label}
                            s={{
                              ...currentStrategy,
                              strategy_label: label,
                              ...safeVariantStats[label],
                              totalPnl: variantTotalPnl,
                              entryCount: variantEntryCount,
                              hitCount: variantHitCount,
                              activePnl: activePnlMap[label] || 0,
                              activeEstPnl: activeEstPnlToRealizeMap[label] || 0,
                              activeTradeCount: activeTradeCountsMap[label] || 0,
                              totalEstPnlToRealize: safeVariantStats[label]?.totalEstPnlToRealize ?? activeEstPnlToRealizeMap[label] ?? 0,
                              peakRrSwitchHits: strategyGateStates[label]?.peakRrSwitchHits || 0
                            }}
                            scannerResults={variantScannerResults[label]}
                            config={variantConfig}
                            paused={pausedStrategies.includes(label) || sessionPaused}
                            isPausing={!!pausingMap[label]}
                            gateInfo={strategyGateStates[label]}
                            onPause={togglePause}
                            onOpenScanner={handleOpenScanner}
                            onEdit={handleEditVariant}
                            hideEdit={true}
                            onClick={handleSelectVariant}
                            onMouseEnter={preloadStrategyDetailView}
                            onEditMouseEnter={preloadConfigModal}
                            isMonitored={monitoredSymbolsSet.has(label)}
                            isResuming={isResuming}
                            showResumingFeedback={showResumingFeedback}
                            stratMetrics={stratMetricsMap.get(label)}
                            viewMode={cardViewMode}
                          />
                        );
                      })}
                    </>
                  );
                })()}
              </>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 col-span-1 md:col-span-2">
                <button
                  onClick={() => { setIsEditMode(false); setSelectedConfig(null); setEditingVariantIndex(null); setShowConfig(true); }}
                  disabled={loading || isSyncing || apiStatus?.isBanned || apiStatus?.isGeoBlocked}
                  aria-label="Create new trading strategy"
                  className={cn(
                    "bg-background border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-2.5 text-dim transition-all group min-h-[110px] w-full",
                    lastSession ? "col-span-1" : "col-span-1 md:col-span-2",
                    (loading || isSyncing || apiStatus?.isBanned || apiStatus?.isGeoBlocked) ? "opacity-30 grayscale cursor-not-allowed pointer-events-none" : "hover:text-accent hover:border-accent/40 hover:bg-accent/5"
                  )}
                >
                  <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-all shadow-xs">
                    <Plus size={16} />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    {apiStatus?.isGeoBlocked ? 'Disabled (Geo-Restricted)' : (apiStatus?.isBanned ? 'Strategy Launch Disabled (API Ban)' : 'New Strategy')}
                  </span>
                </button>

                {lastSession && (
                  <button
                    onClick={handleResumeLast}
                    disabled={loading || isSyncing || apiStatus?.isBanned || apiStatus?.isGeoBlocked}
                    aria-label={`Resume last session: ${lastSession.config?.strategy_label || lastSession.strategyLabel || 'Previous Session'}`}
                    className={cn(
                      "bg-background border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-2.5 text-dim transition-all group min-h-[110px] w-full col-span-1",
                      (loading || isSyncing || apiStatus?.isBanned || apiStatus?.isGeoBlocked) ? "opacity-30 grayscale cursor-not-allowed pointer-events-none" : "hover:text-accent hover:border-accent/40 hover:bg-accent/5"
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-all shadow-xs">
                      <History size={16} />
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-bold uppercase tracking-widest">
                        {apiStatus?.isGeoBlocked ? 'Resume Disabled (Geo-Blocked)' : (apiStatus?.isBanned ? 'Resume Disabled (API Ban)' : 'Resume Last')}
                      </span>
                      <span className="text-[8.5px] text-dim/60 font-medium uppercase mt-0.5 truncate max-w-[150px]">
                        {lastSession.config?.strategy_label || lastSession.strategyLabel || 'Previous Session'}
                      </span>
                    </div>
                  </button>
                )}
              </div>
            )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Full-Width Secondary Drawers: Periodic P&L + Collapsible Session Logs */}
        <div className="flex flex-col gap-3 w-full">
          <MonthlyRevenueChart
            tradeHistory={periodicTradeHistory}
            balance={balance}
            config={config}
            scope={periodicScope}
            onScopeChange={handlePeriodicScopeChange}
            timeframe={periodicTimeframe}
            onTimeframeChange={handlePeriodicTimeframeChange}
            hasSession={Boolean(effectivePeriodicSessionId)}
            sessionLabel={sessionActive ? 'This Session' : (lastSession ? 'Last Session' : 'Session')}
            nowTick={nowTick}
            isLoadingHistory={isSyncing}
          />

          <div className="bg-surface border border-border rounded-xl px-3 py-2.5 sm:px-3.5 shadow-sm flex flex-col gap-2.5 overflow-hidden w-full">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setShowSessionLogs(!showSessionLogs)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setShowSessionLogs(!showSessionLogs))}
              aria-expanded={showSessionLogs}
              aria-controls="dashboard-session-logs-panel"
              className="flex items-center justify-between gap-2 cursor-pointer select-none group min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Activity size={14} className="text-accent shrink-0" />
                <h3 className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-text truncate group-hover:text-accent transition-colors">
                  Session Logs
                </h3>
                <span className="text-[9px] text-dim font-mono uppercase tracking-wider">Buffer: 500</span>
              </div>
              <div className={cn(
                "p-1 rounded-md border border-border/40 bg-surface/50 text-dim group-hover:text-accent group-hover:border-accent/40 transition-all",
                showSessionLogs && "text-accent border-accent/40 bg-accent/5 rotate-180"
              )}>
                <ChevronLeft size={12} className="-rotate-90" />
              </div>
            </div>

            <AnimatePresence>
              {showSessionLogs && (
                <motion.div
                  id="dashboard-session-logs-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden pt-2 border-t border-border/20"
                >
                  <Suspense fallback={<LoadingFallback />}>
                    <DecisionLog />
                  </Suspense>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      )}

      {/* Modals & Drawers */}
        <Drawer.Root open={showConfig} onOpenChange={setShowConfig} repositionInputs={false} dismissible={false} noBodyStyles>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100]" />
            <Drawer.Content className="bg-background border-0 sm:border sm:border-border/80 flex flex-col rounded-none sm:rounded-2xl fixed inset-0 sm:inset-auto sm:left-1/2 sm:-translate-x-1/2 sm:top-1/2 sm:-translate-y-1/2 z-[101] focus:outline-none shadow-2xl w-full max-w-full sm:max-w-3xl lg:max-w-4xl h-[100dvh] sm:h-[88dvh] max-h-none sm:max-h-[88vh] overflow-hidden">
              <VisuallyHidden>
                <Drawer.Title>Configuration</Drawer.Title>
                <Drawer.Description>Form to configure trading strategy parameters</Drawer.Description>
              </VisuallyHidden>
              <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                <Suspense fallback={<LoadingFallback />}>
                  {modalConfig && (
                    <ConfigModal
                      key={isEditMode ? `edit-${strategyId || selectedConfig?.id || 'session'}-${editingVariantIndex ?? 'base'}` : 'new'}
                      initialConfig={modalConfig}
                      baseConfig={config}
                      initialEditingVariantIndex={editingVariantIndex}
                      onSave={handleConfigSave}
                      onClose={() => { setShowConfig(false); setIsEditMode(false); setSelectedConfig(null); setEditingVariantIndex(null); }}
                      isEdit={isEditMode}
                      loading={loading}
                    />
                  )}
                </Suspense>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>

        <Drawer.Root open={showScanner} onOpenChange={setShowScanner} repositionInputs={false} noBodyStyles>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100]" />
            <Drawer.Content className="bg-background border border-border/80 flex flex-col rounded-t-[28px] sm:rounded-2xl fixed inset-x-0 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 z-[101] focus:outline-none shadow-2xl w-full max-w-full sm:max-w-4xl lg:max-w-5xl h-[90vh] sm:h-[85vh] max-h-[92vh] sm:max-h-[88vh] overflow-hidden my-auto">
              <div className="p-2 bg-background rounded-t-[28px] sm:hidden flex flex-col items-center shrink-0 border-b border-border/20">
                <div className="w-10 h-1 bg-border/60 rounded-full" />
                <VisuallyHidden>
                  <Drawer.Title>Scanner</Drawer.Title>
                  <Drawer.Description>View live market scanner opportunities</Drawer.Description>
                </VisuallyHidden>
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
