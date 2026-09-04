import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { shallow } from 'zustand/shallow'
import { pnlColor, pnlClass, fmtUSD, C, safeNum } from '../lib/theme'
import { formatDuration, calculateProximity } from '../lib/formatters'
import { calculatePerformanceMetrics } from '../lib/analytics'

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
import { sessionAPI } from '../api/client'
import { 
  StatCard, InteractiveLimitCard, SectionLabel, Btn, StatusBadge, PaperBadge, EcoBadge, DemoBadge, LiveBadge,
    ConditionWidget, PulseDot, Sparkline, PnLBars, CopyButton, cn, Tooltip, VisuallyHidden, ViewHeader, MonitoredBadge, InPosBadge
  } from '../components/ui/primitives'
import {
  ChevronLeft, ChevronRight, Plus, Trash2, LayoutDashboard, History,
  Settings as SettingsIcon, Activity, Zap, ShieldCheck, Search, Filter,
  BarChart3, XCircle, Pause, Play, Edit3, RefreshCw, Leaf, DollarSign, Users, Clock, ArrowUpRight, ArrowDownRight,
  Briefcase, TrendingUp, TrendingDown, ArrowRight, AlertCircle, CheckCircle2, Info, Loader2
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

// --- Custom Reference Design KPI Card ---
const ReferenceKPICard = React.memo(({ title, value, changePct, isPositive, icon: Icon, iconBg = "bg-accent/15 text-accent", subtext }) => {
  return (
    <div className="bg-surface border border-border/40 rounded-2xl p-5 shadow-sm hover:border-accent/30 transition-all flex flex-col justify-between min-h-[110px] relative overflow-hidden group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-dim">{title}</span>
          <h3 className="text-xl md:text-2xl font-black font-mono tracking-tight text-text leading-tight">{value}</h3>
        </div>
        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-inner transition-transform group-hover:scale-110", iconBg)}>
          <Icon size={20} />
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/10">
        <div className="flex items-center gap-1">
          <span className={cn(
            "text-[10px] font-black font-mono px-2 py-0.5 rounded-full flex items-center gap-0.5",
            isPositive
              ? "bg-green/15 text-green border border-green/20"
              : "bg-red/15 text-red border border-red/20"
          )}>
            {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {isPositive ? '+' : ''}{changePct}%
          </span>
          <span className="text-[9px] font-bold text-dim/70 uppercase tracking-wider ml-1">vs last period</span>
        </div>
        {subtext && <span className="text-[9px] font-mono font-bold text-dim/60 truncate max-w-[120px]">{subtext}</span>}
      </div>
    </div>
  );
});
ReferenceKPICard.displayName = 'ReferenceKPICard';

// --- Recent Transactions List Component ---
const RecentTransactionsList = React.memo(({ tradeHistory = [], activeTrades = [], onOpenScanner }) => {
  const [isRecentExpanded, setIsRecentExpanded] = useState(false);

  const allTransactions = useMemo(() => {
    const list = [];

    // Map active trades as 'Open'
    (activeTrades || []).forEach(t => {
      list.push({
        id: t.id || t.symbol,
        symbol: t.symbol,
        type: t.direction || (t.amount > 0 ? 'LONG' : 'SHORT'),
        amount: safeNum(t.pnl),
        notional: safeNum(t.notional || t.entry_price * (t.qty || 1)),
        status: 'Open',
        timestamp: t.entry_ts_ms || Date.now(),
        isKnife: t.is_knife
      });
    });

    // Map closed trade history as 'Closed'
    (tradeHistory || []).slice(0, 8).forEach(t => {
      const pnl = safeNum(t.pnl);
      list.push({
        id: t.id || `${t.symbol}-${t.exit_ts}`,
        symbol: t.symbol,
        type: t.direction || 'CLOSED',
        amount: pnl,
        notional: safeNum(t.notional || t.exit_price * (t.qty || 1)),
        status: 'Closed',
        timestamp: t.exit_ts_ms ?? (t.exit_ts ? new Date(t.exit_ts).getTime() : Date.now()),
        isKnife: t.is_knife
      });
    });

    return list.sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);
  }, [tradeHistory, activeTrades]);

  return (
    <div className="bg-surface border border-border/40 rounded-2xl p-4 sm:p-5 md:p-6 shadow-sm flex flex-col gap-3 sm:gap-4 overflow-hidden w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsRecentExpanded(!isRecentExpanded)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setIsRecentExpanded(!isRecentExpanded))}
        aria-expanded={isRecentExpanded}
        aria-controls="recent-transactions-content"
        className="flex items-center justify-between cursor-pointer select-none group min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
            <History size={16} />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <h3 className="text-xs sm:text-sm md:text-base font-black uppercase tracking-tight text-text truncate group-hover:text-accent transition-colors">
              Recent Transactions
            </h3>
            <span className="text-[10px] text-dim font-bold uppercase tracking-widest truncate">Live Execution Feed ({allTransactions.length})</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); window.location.hash = '#/history'; }}
            className="text-[10px] font-black text-accent hover:text-accent/80 uppercase tracking-widest transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1"
          >
            See All
          </button>
          <div className={cn(
            "p-1.5 rounded-lg border border-border/40 bg-surface/50 text-dim group-hover:text-accent group-hover:border-accent/40 transition-all",
            isRecentExpanded && "text-accent border-accent/40 bg-accent/5 rotate-180"
          )}>
            <ChevronLeft size={14} className="-rotate-90" />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isRecentExpanded && (
          <motion.div
            id="recent-transactions-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden pt-2 border-t border-border/20 space-y-2.5"
          >
        {allTransactions.length === 0 ? (
          <div className="p-8 text-center text-dim font-mono text-[10px] uppercase tracking-widest border border-dashed border-border/30 rounded-xl">
            No Recent Transactions Recorded
          </div>
        ) : (
          allTransactions.map((tx) => {
            const isClosed = tx.status === 'Closed';
            const isOpen = tx.status === 'Open';

            return (
              <div
                key={tx.id}
                className="flex items-center justify-between p-3 rounded-xl bg-background/30 hover:bg-white/5 border border-border/20 transition-all group"
              >
                {/* Symbol Avatar & Info */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center font-black text-xs font-mono shrink-0 shadow-inner border border-white/5",
                    tx.amount >= 0 ? "bg-accent/10 text-accent" : "bg-red/10 text-red"
                  )}>
                    {tx.symbol.substring(0, 3)}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black font-mono uppercase truncate text-text group-hover:text-accent transition-colors">
                        {tx.symbol.replace('USDT', '')}
                      </span>
                      {tx.isKnife && (
                        <span className="text-[8px] bg-red/20 text-red border border-red/30 font-black px-1.5 py-0.2 rounded uppercase">🗡️ Knife</span>
                      )}
                    </div>
                    <span className="text-[9px] text-dim font-bold font-mono">
                      {formatTimeAgo(tx.timestamp)} · {tx.type}
                    </span>
                  </div>
                </div>

                {/* Amount & Status Badge */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex flex-col items-end">
                    <span className={cn("text-xs font-mono font-black", pnlClass(tx.amount))}>
                      {tx.amount >= 0 ? '+' : ''}{fmtUSD(tx.amount)}
                    </span>
                    <span className="text-[8px] font-mono text-dim/60">
                      ${tx.notional.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Status Badge Matching Domain Terminology */}
                  <span className={cn(
                    "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border flex items-center gap-1.5 shrink-0",
                    isClosed && "bg-green/10 border-green/30 text-green",
                    isOpen && "bg-amber/10 border-amber/30 text-amber animate-pulse"
                  )}>
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      isClosed && "bg-green",
                      isOpen && "bg-amber"
                    )} />
                    {tx.status}
                  </span>
                </div>
              </div>
            );
          })
        )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
RecentTransactionsList.displayName = 'RecentTransactionsList';

// --- Observable Periodic Revenue Bar Chart (Daily, Weekly, Monthly) ---
const MonthlyRevenueChart = React.memo(({ tradeHistory = [] }) => {
  const [timeframe, setTimeframe] = useState('7D'); // '7D' (Daily), '4W' (Weekly), '6M' (Monthly), '1Y' (Monthly)
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [isChartExpanded, setIsChartExpanded] = useState(false);

  const periodicData = useMemo(() => {
    const trades = tradeHistory || [];
    const now = new Date();
    const buckets = [];

    if (timeframe === '7D' || timeframe === '14D') {
      const numDays = timeframe === '7D' ? 7 : 14;
      for (let i = numDays - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        buckets.push({
          id: dateKey,
          label,
          subLabel: d.toLocaleDateString([], { weekday: 'short' }),
          startMs: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
          endMs: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1,
          pnl: 0,
          tradesCount: 0,
          winCount: 0
        });
      }
    } else if (timeframe === '4W' || timeframe === '8W') {
      const numWeeks = timeframe === '4W' ? 4 : 8;
      for (let i = numWeeks - 1; i >= 0; i--) {
        const start = new Date(now);
        start.setDate(now.getDate() - (now.getDay() + i * 7));
        start.setHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);

        const label = `W${numWeeks - i}`;
        const subLabel = `${start.getDate()} ${start.toLocaleDateString([], { month: 'short' })}`;

        buckets.push({
          id: `week-${i}`,
          label,
          subLabel,
          startMs: start.getTime(),
          endMs: end.getTime(),
          pnl: 0,
          tradesCount: 0,
          winCount: 0
        });
      }
    } else {
      // Monthly: '3M', '6M', '1Y'
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const numMonths = timeframe === '3M' ? 3 : timeframe === '1Y' ? 12 : 6;

      for (let i = numMonths - 1; i >= 0; i--) {
        const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const last = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
        buckets.push({
          id: `month-${first.getFullYear()}-${first.getMonth()}`,
          label: monthNames[first.getMonth()],
          subLabel: String(first.getFullYear()),
          startMs: first.getTime(),
          endMs: last.getTime(),
          pnl: 0,
          tradesCount: 0,
          winCount: 0
        });
      }
    }

    // Populate trade metrics in buckets
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if (!t) continue;
      const ts = t.exit_ts_ms ?? (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
      if (!ts) continue;

      for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b];
        if (ts >= bucket.startMs && ts <= bucket.endMs) {
          const pnl = Number(t.pnl || 0);
          bucket.pnl += pnl;
          bucket.tradesCount++;
          if (pnl > 0) bucket.winCount++;
          break;
        }
      }
    }

    // Determine scale bounds
    let maxVal = 0;
    for (let i = 0; i < buckets.length; i++) {
      const absVal = Math.abs(buckets[i].pnl);
      if (absVal > maxVal) maxVal = absVal;
    }
    if (maxVal === 0) maxVal = 500; // baseline scale

    return { buckets, maxVal };
  }, [tradeHistory, timeframe]);

  const { buckets, maxVal } = periodicData;
  const totalRevenue = buckets.reduce((acc, m) => acc + m.pnl, 0);

  // Period Quick Badges (Today, 7D, 30D)
  const periodBadges = useMemo(() => {
    const trades = tradeHistory || [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = now.getTime() - (30 * 24 * 60 * 60 * 1000);

    let today = 0;
    let d7 = 0;
    let d30 = 0;

    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if (!t) continue;
      const ts = t.exit_ts_ms ?? (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
      if (!ts) continue;

      const pnl = Number(t.pnl || 0);
      if (ts >= todayStart) today += pnl;
      if (ts >= sevenDaysAgo) d7 += pnl;
      if (ts >= thirtyDaysAgo) d30 += pnl;
    }

    return { today, d7, d30 };
  }, [tradeHistory]);

  return (
    <div className="bg-surface border border-border/40 rounded-2xl p-4 sm:p-5 md:p-6 shadow-sm flex flex-col gap-3 sm:gap-4 overflow-hidden w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsChartExpanded(!isChartExpanded)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setIsChartExpanded(!isChartExpanded))}
        aria-expanded={isChartExpanded}
        aria-controls="periodic-chart-content"
        className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 cursor-pointer select-none group min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
            <BarChart3 size={16} />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <h3 className="text-xs sm:text-sm md:text-base font-black uppercase tracking-tight text-text truncate group-hover:text-accent transition-colors">
              Periodic Performance
            </h3>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <span className="text-[10px] text-dim font-bold uppercase tracking-widest shrink-0">
                Net P&L: <span className={pnlClass(totalRevenue)}>{fmtUSD(totalRevenue)}</span>
              </span>

              {/* Quick Period Badges */}
              <div className="flex items-center gap-1 sm:gap-1.5 font-mono text-[8.5px] xs:text-[9px] font-bold uppercase flex-wrap">
                <span className={cn("px-1.5 sm:px-2 py-0.5 rounded border leading-none shrink-0", periodBadges.today >= 0 ? "bg-green/10 border-green/30 text-green" : "bg-red/10 border-red/30 text-red")}>
                  Today: {fmtUSD(periodBadges.today)}
                </span>
                <span className={cn("px-1.5 sm:px-2 py-0.5 rounded border leading-none shrink-0", periodBadges.d7 >= 0 ? "bg-green/10 border-green/30 text-green" : "bg-red/10 border-red/30 text-red")}>
                  7D: {fmtUSD(periodBadges.d7)}
                </span>
                <span className={cn("px-1.5 sm:px-2 py-0.5 rounded border leading-none shrink-0", periodBadges.d30 >= 0 ? "bg-green/10 border-green/30 text-green" : "bg-red/10 border-red/30 text-red")}>
                  30D: {fmtUSD(periodBadges.d30)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className={cn(
            "p-1.5 rounded-lg border border-border/40 bg-surface/50 text-dim group-hover:text-accent group-hover:border-accent/40 transition-all",
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
            className="overflow-hidden space-y-4 pt-2 border-t border-border/20"
          >
            {/* Multi-Horizon Granularity Controls */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[9px] text-dim font-black uppercase tracking-widest">Timeframe Horizon:</span>
              <div className="flex items-center gap-1 sm:gap-1.5 bg-background/50 border border-border/40 p-1 rounded-xl overflow-x-auto no-scrollbar shrink-0">
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
                    onClick={(e) => { e.stopPropagation(); setTimeframe(tf.id); }}
                    className={cn(
                      "px-2 sm:px-2.5 py-1 rounded-lg text-[9px] sm:text-[9.5px] font-black uppercase tracking-wider transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer whitespace-nowrap shrink-0",
                      timeframe === tf.id
                        ? "bg-accent text-white shadow-md shadow-accent/20"
                        : "text-dim hover:text-text hover:bg-white/5"
                    )}
                  >
                    <span className="hidden sm:inline">{tf.fullLabel}</span>
                    <span className="inline sm:hidden">{tf.shortLabel}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Active Selected Period Detail Banner */}
            <AnimatePresence>
        {(() => {
          const activeIdx = hoveredIndex !== null ? hoveredIndex : selectedIndex;
          if (activeIdx === null || !buckets[activeIdx]) return null;
          const activeBucket = buckets[activeIdx];

          return (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-accent/10 border border-accent/25 px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-xs font-mono flex-wrap"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <span className="font-black uppercase tracking-wider text-accent">
                  {activeBucket.label} ({activeBucket.subLabel})
                </span>
              </div>
              <div className="flex items-center gap-3 font-bold flex-wrap">
                <span>
                  Net P&L: <span className={pnlClass(activeBucket.pnl)}>{activeBucket.pnl >= 0 ? '+' : ''}{fmtUSD(activeBucket.pnl)}</span>
                </span>
                <span className="text-dim/60">•</span>
                <span className="text-dim">
                  Trades: <strong className="text-text">{activeBucket.tradesCount}</strong>
                </span>
                <span className="text-dim/60">•</span>
                <span className="text-dim">
                  Win Rate: <strong className="text-text">{activeBucket.tradesCount > 0 ? Math.round((activeBucket.winCount / activeBucket.tradesCount) * 100) : 0}%</strong>
                </span>
              </div>
            </motion.div>
          );
        })()}
            </AnimatePresence>

      {/* Bar Canvas Container with Responsive Scroll */}
      <div className="relative pt-4 pb-2 w-full overflow-x-auto no-scrollbar">
        {/* Background Gridlines */}
        <div className="absolute inset-x-0 top-4 bottom-8 flex flex-col justify-between pointer-events-none opacity-20">
          <div className="border-b border-dashed border-border/60 w-full" />
          <div className="border-b border-dashed border-border/60 w-full" />
          <div className="border-b border-dashed border-border/60 w-full" />
        </div>

        <div className="flex items-end justify-between h-[180px] px-0.5 sm:px-3 relative z-10 gap-1 xs:gap-1.5 sm:gap-3 min-w-[280px]">
          {buckets.map((b, idx) => {
            const isPos = b.pnl >= 0;
            const heightPct = Math.min(100, Math.max(8, (Math.abs(b.pnl) / maxVal) * 100));
            const isHovered = hoveredIndex === idx;
            const winRate = b.tradesCount > 0 ? Math.round((b.winCount / b.tradesCount) * 100) : 0;

            const tooltipCard = (
              <div className="flex flex-col items-center text-center py-0.5 px-1 font-mono">
                <span className="text-[10px] font-black uppercase text-accent tracking-wider">{b.label} ({b.subLabel})</span>
                <span className={cn("text-xs font-bold my-0.5", pnlClass(b.pnl))}>{b.pnl >= 0 ? '+' : ''}{fmtUSD(b.pnl)}</span>
                <span className="text-[9px] text-dim font-bold">{b.tradesCount} trades ({winRate}% WR)</span>
              </div>
            );

            return (
              <Tooltip
                key={b.id}
                content={tooltipCard}
              >
                <div
                  className={cn(
                    "flex-1 min-w-[20px] max-w-[56px] flex flex-col items-center h-full justify-end group relative cursor-pointer rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none p-0.5",
                    isHovered && "bg-white/[0.04]"
                  )}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => setSelectedIndex(prev => prev === idx ? null : idx)}
                  tabIndex={0}
                  role="region"
                  aria-label={`${b.label} (${b.subLabel}): ${fmtUSD(b.pnl)}, ${b.tradesCount} trades, win rate ${winRate}%`}
                >
                  {/* Bar Value Annotation on Top */}
                  <div className={cn(
                    "text-[7.5px] xs:text-[8.5px] sm:text-[9.5px] font-mono font-black mb-1.5 transition-all leading-none truncate w-full text-center",
                    isHovered ? "opacity-100 scale-110 text-accent font-bold" : "opacity-75 text-dim",
                    pnlClass(b.pnl)
                  )}>
                    {b.pnl === 0 ? '$0' : fmtUSD(b.pnl)}
                  </div>

                  {/* Bar Container */}
                  <div className="w-full max-w-[48px] h-[130px] flex items-end justify-center rounded-xl bg-background/30 p-0.5 sm:p-1 border border-border/20 group-hover:border-accent/40 transition-all">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${heightPct}%` }}
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                      className={cn(
                        "w-full rounded-lg transition-all duration-300 relative overflow-hidden",
                        isPos
                          ? "bg-gradient-to-t from-accent/80 via-accent to-green shadow-[0_0_15px_rgba(91,111,255,0.2)]"
                          : "bg-gradient-to-t from-red/80 via-red to-red-400 shadow-[0_0_15px_rgba(255,68,102,0.2)]",
                        isHovered && "brightness-125 scale-x-105"
                      )}
                    >
                      <div className="absolute inset-x-0 top-0 h-1 bg-white/40" />
                    </motion.div>
                  </div>

                  {/* Label */}
                  <div className="flex flex-col items-center mt-2 leading-tight w-full">
                    <span className={cn(
                      "text-[8.5px] xs:text-[9.5px] sm:text-xs font-bold uppercase tracking-wider transition-colors font-mono truncate w-full text-center",
                      isHovered ? "text-accent font-black" : "text-dim"
                    )}>
                      {b.label}
                    </span>
                    <span className="text-[7px] xs:text-[7.5px] text-dim/60 font-mono hidden xs:inline truncate w-full text-center">
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

  const hasBanTime = !!apiStatus?.banUntil;
  if (hasBanTime && timeLeft <= 0) return null;
  if (!apiStatus?.isBanned && !apiStatus?.isRateLimited) return null;

  const isBan = apiStatus.isBanned;
  const cooldownEnd = apiStatus.banUntil ? new Date(apiStatus.banUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown';

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
          {hasBanTime ? formatDuration(timeLeft) : 'Active'}
        </div>
        {hasBanTime && (
          <div className="flex items-center gap-1.5 opacity-60">
            <History size={10} />
            <span className="text-[9px] font-bold uppercase tracking-tighter">Ends at {cooldownEnd}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// --- Strategy Card ---
export const StrategyCard = React.memo(({ s, config, onClick, onPause, onEdit, paused, isPausing, gateInfo, className, isResuming, showResumingFeedback, onMouseEnter, onEditMouseEnter, stratMetrics = null, viewMode = 'detailed' }) => {
  const analytics = useTradingStore(state => state.analytics);
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
    if (isPausing) return;
    onPause(s.strategy_label);
  }, [onPause, s.strategy_label, isPausing]);

  const activeCount = s.activeTradeCount || 0;
  const maxOpen = config.max_open_trades || 5;
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

  // Ultra-compact single-row List view rendering (High-density, controls omitted, icon cues & color-coded PnL)
  if (isList) {
    const isPosActive = s.activePnl >= 0;
    const isPosReturn = s.totalPnl >= 0;

    return (
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={onMouseEnter}
        role="button"
        tabIndex={0}
        className={cn(
          "bg-surface border border-border/40 rounded-xl px-3 py-1.5 flex items-center justify-between gap-2.5 w-full shadow-sm cursor-pointer hover:border-accent/40 hover:bg-white/[0.02] transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none group relative overflow-hidden min-h-[38px]",
          className,
          isResuming && "opacity-80 border-accent/20"
        )}
        aria-label={`View details for ${s.strategy_label} strategy, active P&L ${fmtUSD(s.activePnl)}, session return ${fmtUSD(s.totalPnl)}`}
      >
        {/* Left: Indicator Pulse & Strategy Name */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <StatusBadge status={s.sessionActive} />
          <h3 className="font-black font-mono text-xs tracking-tight truncate uppercase text-text group-hover:text-accent transition-colors">
            {s.strategy_label}
          </h3>

          {/* Timeframe Icon Cue Badge */}
          <span className="text-[8px] font-mono font-black text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.2 rounded uppercase shrink-0 flex items-center gap-1">
            <Zap size={9} />
            {config.scan_interval}
          </span>

          {paused && !isResuming && (
            <span className="text-[8px] font-black uppercase text-amber bg-amber/10 border border-amber/20 px-1.5 py-0.2 rounded shrink-0">
              PAUSED
            </span>
          )}
        </div>

        {/* Right: Color-Coded Active PnL & Session Return Badges + Position Allocation Pill */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 font-mono text-xs">
          {/* Active PnL Color-Coded Badge */}
          <Tooltip content={`Active Open P&L: ${fmtUSD(s.activePnl)}`}>
            <div className={cn(
              "px-2 py-0.5 rounded-lg border flex items-center gap-1 font-black text-[11px] leading-none shrink-0",
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
              "px-2 py-0.5 rounded-full border text-[10px] font-black font-mono shrink-0 flex items-center gap-1",
              activeCount > 0 ? "bg-accent/15 border-accent/30 text-accent" : "bg-background/60 border-border/30 text-dim"
            )}>
              <Users size={10} />
              <span>{activeCount}/{maxOpen}</span>
            </div>
          </Tooltip>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      role="button"
      tabIndex={0}
      className={cn(
        "bg-surface border border-border/40 rounded-2xl flex flex-col w-full shadow-sm cursor-pointer hover:border-accent/30 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none group relative overflow-hidden",
        isCompact ? "p-3 gap-2.5" : "p-4 md:p-5 gap-4",
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
      <div className="flex justify-between items-start gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={cn("font-black font-mono tracking-tight truncate uppercase leading-none text-text group-hover:text-accent transition-colors", isCompact ? "text-xs sm:text-sm" : "text-sm md:text-base")}>
              {s.strategy_label}
            </h3>

            {/* Status Badges */}
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

          <div className="flex gap-2 items-center flex-wrap">
            <span className="bg-accent/10 text-accent border border-accent/20 text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 font-mono">
              {config.scan_interval} · {config.scan_pct_threshold}% Move
            </span>
            {(() => {
              const hitRate = s.entryCount > 0 ? ((s.hitCount || 0) / s.entryCount) * 100 : 0;
              const baselineWr = typeof analytics?.overallWinRate === 'number' ? analytics.overallWinRate : 50;
              const hitRateRatio = baselineWr > 0 ? hitRate / baselineWr : 1.0;
              const pfVal = stratMetrics ? stratMetrics.profitFactor : 0;
              const sharpeVal = stratMetrics ? stratMetrics.sharpe : 0;
              const sortinoVal = stratMetrics ? stratMetrics.sortino : 0;

              const pfText = s.entryCount > 0 ? Number(pfVal).toFixed(2) : '---';
              const sharpeText = s.entryCount > 0 ? Number(sharpeVal).toFixed(2) : '---';
              const sortinoText = s.entryCount > 0 ? Number(sortinoVal).toFixed(2) : '---';

              if (isCompact) {
                return (
                  <div className="bg-accent/10 border border-accent/25 text-accent text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 flex-wrap font-mono">
                    <span>HR: {hitRate.toFixed(0)}%</span>
                    <span>·</span>
                    <span>PF: {pfText}</span>
                  </div>
                );
              }

              return (
                <div className="bg-accent/10 border border-accent/25 text-accent text-[8px] md:text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1.5 flex-wrap font-mono">
                  <span>Hit Rate: {hitRate.toFixed(0)}% ({s.hitCount || 0}/{s.entryCount || 0})</span>
                  <span>·</span>
                  <span>Ratio: {hitRateRatio.toFixed(2)}x</span>
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

        {/* Action buttons and performance metrics aligned to the right */}
        <div className="flex flex-col items-end shrink-0 min-w-[80px] gap-2">
          {/* Inline Action Buttons */}
          <div className="flex items-center gap-1 relative z-20">
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
      </div>

      {/* Modern Metrics Row */}
      <div className={cn("grid grid-cols-3 gap-3 items-stretch border-t border-b border-border/10", isCompact ? "py-2" : "py-3")}>
        <div className={cn("flex flex-col justify-between h-full", isCompact ? "min-h-[50px]" : "min-h-[72px]")}>
          <div className="flex flex-col">
            <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-[1.2] flex items-start">Active P&L</span>
            <span className={cn("font-black font-mono tracking-tighter leading-none mt-1", isCompact ? "text-xs sm:text-sm" : "text-xs sm:text-sm md:text-base")} style={{ color: pnlColor(s.activePnl) }}>
              {fmtUSD(s.activePnl)}
            </span>
          </div>
          {!isCompact && (
            <div className="flex flex-col mt-1 gap-0.5 leading-none">
              <span className="text-[8px] text-dim/50 font-black uppercase tracking-widest leading-none">
                <span className="hidden xs:inline">Est. Target: </span>
                <span className="xs:hidden inline">Est: </span>
                <span className="font-bold" style={{ color: pnlColor(activeEstPnl) }}>≈{fmtUSD(activeEstPnl)}</span>
              </span>
              <span className="text-[8px] text-dim/50 font-black uppercase tracking-widest leading-none">
                <span className="hidden xs:inline">Projected: </span>
                <span className="xs:hidden inline">Proj: </span>
                <span className="font-bold" style={{ color: pnlColor(totalEstToRealize) }}>≈{fmtUSD(totalEstToRealize)}</span>
              </span>
            </div>
          )}
        </div>

        <div className={cn("flex flex-col justify-between h-full", isCompact ? "min-h-[50px]" : "min-h-[72px]")}>
          <div className="flex flex-col">
            <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-[1.2] flex items-start">Session Return</span>
            <span className={cn("font-black font-mono tracking-tighter leading-none mt-1", isCompact ? "text-xs sm:text-sm" : "text-xs sm:text-sm md:text-base")} style={{ color: pnlColor(s.totalPnl) }}>
              {fmtUSD(s.totalPnl)}
            </span>
          </div>
          <span className="text-[8px] text-dim/50 font-bold uppercase tracking-wider mt-1 truncate animate-pulse" style={{ color: pnlColor(s.totalPnl) }}>
            {sessionReturnPct >= 0 ? '+' : ''}{sessionReturnPct.toFixed(2)}%
          </span>
        </div>

        <div className={cn("flex flex-col justify-between items-end text-right h-full", isCompact ? "min-h-[50px]" : "min-h-[72px]")}>
          <div className="flex flex-col items-end">
            <span className="text-[8px] text-dim font-black uppercase tracking-widest leading-[1.2] flex items-start justify-end text-right w-full">Positions</span>
            <span className={cn("font-black font-mono tracking-tighter text-text/90 leading-none mt-1", isCompact ? "text-xs sm:text-sm" : "text-xs sm:text-sm md:text-base")}>
              {activeCount} / {maxOpen}
            </span>
          </div>
          <span className="text-[8px] text-dim/50 font-bold uppercase tracking-wider mt-1 truncate">
            Alloc Slots
          </span>
        </div>
      </div>

      {/* Position Slot Capacity Runway */}
      <div className="flex flex-col gap-1.5">
        <div
          className="h-1.5 w-full bg-border/40 rounded-full overflow-hidden relative"
          role="progressbar"
          aria-valuenow={Math.round(capacityPct)}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label={`${s.strategy_label} slot allocation capacity is at ${activeCount} out of ${maxOpen} positions`}
        >
          <div
            className={cn(
              "h-full transition-all duration-500 shadow-[0_0_10px_rgba(0,0,0,0.2)]",
              capacityPct >= 80 ? "bg-amber" : "bg-accent"
            )}
            style={{ width: `${capacityPct}%` }}
          />
        </div>
        {!isCompact && (
          <div className="flex justify-between items-center text-[9px] font-bold text-dim uppercase tracking-wider leading-none">
            <span>Capacity: {activeCount} Active</span>
            <span className="text-[8px] bg-white/5 border border-white/5 px-1.5 py-0.5 rounded text-accent">
              Open Cockpit
            </span>
          </div>
        )}
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

export const ScannerPreview = React.memo(({ scannerResults, config, onOpen }) => {
  const { activeTrades } = useTradingStore(state => ({ activeTrades: state.activeTrades || [] }), shallow);
  const threshold = config.scan_pct_threshold || 2
  const top = (scannerResults || []).slice(0, 5)
  // Pre-allocate 5 slots to prevent layout shift
  const placeholders = Array.from({ length: Math.max(0, 5 - top.length) })

  const weights = config?.scanner_weights || { momentum: 0.5, volatility: 0.3, trend: 0.2 };
  const momW = Math.round((weights.momentum ?? 0.5) * 100);
  const volW = Math.round((weights.volatility ?? 0.3) * 100);
  const trendW = Math.round((weights.trend ?? 0.2) * 100);
  const enabledSigs = config?.enabled_signals || [];

  const getOppProximity = (opp) => {
    if (opp.signalResult?.allFired) return 100;
    const isLong = opp.pct >= 0;
    const velocityProgress = Math.min(100, (Math.abs(opp.pct || 0) / threshold) * 100);

    let sigSum = velocityProgress;
    let count = 1;

    if (opp.signalResult?.signals) {
      for (const sigKey of enabledSigs) {
        const s = opp.signalResult.signals[sigKey];
        if (s) {
          const prox = calculateProximity(s, opp.close || s.value || 0, 0, isLong, false);
          sigSum += prox;
          count++;
        }
      }
    }

    return Math.round(count > 0 ? sigSum / count : 0);
  };

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden mb-8 shadow-sm h-[395px] flex flex-col text-left">
      <div className="p-5 border-b border-border flex justify-between items-center bg-surface/30 shrink-0">
        <div className="flex flex-col">
          <SectionLabel className="mb-0">
            <Zap size={14} className="text-accent" /> Live Scanner
          </SectionLabel>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] text-dim font-bold uppercase tracking-widest">Top 5 Opportunities</span>
            <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.2 rounded">
              Weights {momW}:{volW}:{trendW}
            </span>
          </div>
        </div>
        <button
          className="text-[11px] font-bold text-accent hover:text-accent/80 transition-colors uppercase tracking-widest cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded"
          aria-label="View all scanner results"
          onClick={onOpen}
          onMouseEnter={preloadScannerOverlay}
        >
          Open Full
        </button>
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
                    <div className="w-16 flex flex-col items-end justify-center gap-0.5">
                      {passing ? (
                        opp.signalResult?.allFired ? (
                          <b className="text-[10px] font-black text-green uppercase tracking-wider">TRIGGERED</b>
                        ) : (
                          <b className="text-[10px] font-black text-amber uppercase tracking-wider">PENDING</b>
                        )
                      ) : (
                        <b className="text-[10px] font-bold text-dim uppercase tracking-wider">WAITING</b>
                      )}
                      <div className="w-12 h-1 bg-background/80 rounded-full overflow-hidden border border-white/5 mt-0.5" title={`Proximity: ${getOppProximity(opp)}%`}>
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            opp.signalResult?.allFired ? "bg-green" : passing ? "bg-amber" : "bg-dim/40"
                          )}
                          style={{ width: `${getOppProximity(opp)}%` }}
                        />
                      </div>
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

const ReconciliationCenter = React.memo(({ sessionActive, tradingMode, config, addAlert }) => {
  const [untrackedPositions, setUntrackedPositions] = useState([]);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState({});
  const [adoptingSymbols, setAdoptingSymbols] = useState(new Set());
  const [manualInitialSl, setManualInitialSl] = useState({});
  const [manualCurrentSl, setManualCurrentSl] = useState({});

  const strategyLabels = useMemo(() => {
    const baseLabel = config.strategy_label || 'Momentum Strategy';
    const variantLabels = (config.strategy_variants || [])
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
      useTradingStore.getState().fetchTradeHistory('all');
      useTradingStore.getState().fetchAnalytics();
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
                            <label className="text-[8px] font-black text-dim uppercase tracking-wider">Initial Stop Loss Price</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/60 font-mono text-xs">$</span>
                              <input
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
                            <label className="text-[8px] font-black text-dim uppercase tracking-wider">Current Stop Loss Price</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/60 font-mono text-xs">$</span>
                              <input
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
  const [cardViewMode, setCardViewMode] = useState('detailed') // 'detailed' | 'compact'
  const [showTemporalRisk, setShowTemporalRisk] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterActive, setFilterActive] = useState(false)

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

  const {
    sessionActive, sessionPaused, pausedStrategies, strategyGateStates, strategyId, balance, totalPnl, totalRiskPct,
    totalSlUsed, totalEstPnlToRealize, activeTrades, alerts, config, setSessionActive,
    updateConfig, patchConfig, gateState, gateReason, hibernating, hibernationMode, agreementRequired,
    scannerPaused, sessionList, fetchSessions, wsStatus,
    updateStats, analytics, stats, lastUdsBalanceReason, lastUdsBalanceTs,
    sidebarCollapsed, variantScannerResults, variantStats, isThrottled, setThrottled, isEcoMode, entryCount, hitCount,
    healthEnabled, isSyncing, setSyncing, configSyncing, isAdaptiveTightened, apiStatus, effectivePeriodMs, isSyncingOnResume,
    nextSlotTs, fetchTradeHistory, fetchAnalytics, tradeHistory
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
    stats: state.stats,
    lastUdsBalanceReason: state.lastUdsBalanceReason,
    lastUdsBalanceTs: state.lastUdsBalanceTs,
    effectivePeriodMs: state.effectivePeriodMs,
    isSyncingOnResume: state.isSyncingOnResume,
    nextSlotTs: state.nextSlotTs,
    fetchTradeHistory: state.fetchTradeHistory,
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

  // BOLT OPTIMIZATION: Loop-fused single-pass traversal (no intermediate array allocations)
  // Combines activePnlMap, activeEstPnlToRealizeMap, activeTradeCountsMap, totalActivePnl, and maxRR
  // to avoid redundant iterations and eliminate callback closure allocations on high-frequency ticks.
  const { netFunding, netComm } = useMemo(() => {
    if (stats?.totalFundingFee !== undefined && stats?.totalFundingFee !== 0 &&
        stats?.totalRealizedFee !== undefined && stats?.totalRealizedFee !== 0) {
      return { netFunding: stats.totalFundingFee, netComm: stats.totalRealizedFee };
    }

    let feeSum = stats?.totalRealizedFee || 0;
    let fundingSum = stats?.totalFundingFee || 0;

    const hist = tradeHistory || [];
    for (let i = 0; i < hist.length; i++) {
      feeSum += Number(hist[i].realized_fee) || 0;
      fundingSum += Number(hist[i].funding_fee) || 0;
    }

    const active = activeTrades || [];
    for (let i = 0; i < active.length; i++) {
      feeSum += Number(active[i].realized_fee) || 0;
      fundingSum += Number(active[i].funding_fee) || 0;
    }

    return { netFunding: fundingSum, netComm: feeSum };
  }, [stats?.totalFundingFee, stats?.totalRealizedFee, tradeHistory, activeTrades]);

  const stratMetricsMap = useMemo(() => {
    const history = tradeHistory || [];
    const grouped = new Map();

    for (let i = 0; i < history.length; i++) {
      const t = history[i];
      const label = t.strategy_label || t.strategyLabel || 'Momentum Strategy';
      if (!grouped.has(label)) {
        grouped.set(label, []);
      }
      grouped.get(label).push(t);
    }

    const tradingMode = config?.trading_mode || (config?.paper_mode ? 'paper' : 'live');
    const startingBal = tradingMode === 'paper'
      ? (config?.paper_starting_balance || 10000)
      : (tradingMode === 'testnet'
          ? (config?.testnet_starting_balance || 10000)
          : (config?.live_starting_balance || 10000));

    const map = new Map();
    for (const [label, trades] of grouped.entries()) {
      map.set(label, calculatePerformanceMetrics(trades, startingBal));
    }

    return map;
  }, [tradeHistory, config]);

  const { activePnlMap, activeEstPnlToRealizeMap, activeTradeCountsMap, totalActivePnl, maxRR } = useMemo(() => {
    const strategyLabel = currentStrategy.strategy_label;
    const pnlMap = { [strategyLabel]: 0 };
    const estPnlMap = { [strategyLabel]: 0 };
    const countMap = { [strategyLabel]: 0 };

    const variants = config.strategy_variants || [];
    for (let i = 0; i < variants.length; i++) {
      const label = variants[i].strategy_label || 'Variant';
      pnlMap[label] = 0;
      estPnlMap[label] = 0;
      countMap[label] = 0;
    }

    let maxRrAchieved = 0;
    const trades = activeTrades || [];
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      if (t) {
        const label = pnlMap[t.strategy_label] !== undefined ? t.strategy_label : strategyLabel;
        const pnlVal = safeNum(t.pnl);
        pnlMap[label] += pnlVal;
        estPnlMap[label] += safeNum(t.est_pnl_to_realize);
        countMap[label]++;

        const rrVal = Number(t.max_rr ?? t.max_rr_achieved ?? 0);
        if (rrVal > maxRrAchieved) {
          maxRrAchieved = rrVal;
        }
      }
    }

    // Sum the group totals to match original addition sequence and avoid float precision drift
    const pnlValues = Object.values(pnlMap);
    let totPnl = 0;
    for (let i = 0; i < pnlValues.length; i++) {
      totPnl += pnlValues[i];
    }

    return {
      activePnlMap: pnlMap,
      activeEstPnlToRealizeMap: estPnlMap,
      activeTradeCountsMap: countMap,
      totalActivePnl: totPnl,
      maxRR: maxRrAchieved
    };
  }, [activeTrades, currentStrategy.strategy_label, config.strategy_variants]);

  const { todaysPnl, todaysPnlPct } = useMemo(() => {
    const now = new Date();
    const startOfDayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let closedTodayPnl = 0;
    const history = tradeHistory || [];
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
  }, [tradeHistory, totalActivePnl, balance]);

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


  const [loading, setLoading] = useState(false)
  const [showInsights, setShowInsights] = useState(false)

  const correlationData = useMemo(() => {
    // BOLT OPTIMIZATION: Loop-fused single-pass traversal over tradeHistory with O(1) direct branch-based
    // bucket sorting, utilizing pre-calculated numeric entry/exit milliseconds (t.entry_ts_ms, t.exit_ts_ms).
    // This completely avoids instantiating redundant Date objects and invoking nested .find() per trade.
    const list = tradeHistory || [];
    const buckets = [
      { label: '< 5m', min: 0, max: 5 * 60 * 1000, grossWin: 0, grossLoss: 0, count: 0 },
      { label: '5m - 30m', min: 5 * 60 * 1000, max: 30 * 60 * 1000, grossWin: 0, grossLoss: 0, count: 0 },
      { label: '> 30m', min: 30 * 60 * 1000, max: Infinity, grossWin: 0, grossLoss: 0, count: 0 }
    ];

    const len = list.length;
    for (let i = 0; i < len; i++) {
      const t = list[i];
      if (!t) continue;

      const entry = t.entry_ts_ms ?? (t.entry_ts ? new Date(t.entry_ts).getTime() : 0);
      const exit = t.exit_ts_ms ?? (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
      if (!entry || !exit) continue;

      const duration = exit - entry;
      if (duration < 0) continue;

      let bucket = null;
      if (duration < 5 * 60 * 1000) {
        bucket = buckets[0];
      } else if (duration < 30 * 60 * 1000) {
        bucket = buckets[1];
      } else {
        bucket = buckets[2];
      }

      if (bucket) {
        const pnl = Number(t.pnl || 0);
        if (pnl > 0) bucket.grossWin += pnl;
        else if (pnl < 0) bucket.grossLoss += Math.abs(pnl);
        bucket.count++;
      }
    }

    const bLen = buckets.length;
    const result = new Array(bLen);
    for (let i = 0; i < bLen; i++) {
      const b = buckets[i];
      const pfVal = b.grossLoss > 0 ? (b.grossWin / b.grossLoss) : (b.grossWin > 0 ? b.grossWin : 0);
      result[i] = {
        label: b.label,
        profitFactor: Number(Number(pfVal).toFixed(2)),
        count: b.count,
        avgDurationText: b.label
      };
    }

    return result;
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
    fetchTradeHistory(strategyId || 'all');
    fetchAnalytics();

    const toggleScanner = () => setShowScanner(prev => !prev);
    window.addEventListener('toggle-scanner', toggleScanner);
    return () => window.removeEventListener('toggle-scanner', toggleScanner);
  }, [fetchSessions, fetchTradeHistory, fetchAnalytics, config?.paper_mode, strategyId]);

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
          title="Overview"
          subTitle="Real-time strategy management & market oversight"
          sticky={true}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input Bar matching design */}
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-dim pointer-events-none" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-surface border border-border/60 hover:border-accent/40 focus:border-accent text-xs font-semibold rounded-xl text-text placeholder-dim focus-visible:ring-2 focus-visible:ring-accent outline-none transition-all w-36 sm:w-48"
                aria-label="Search dashboard"
              />
            </div>

            {/* Filter Toggle Button */}
            <Tooltip content={filterActive ? "Filters Active" : "Toggle Filters"}>
              <button
                type="button"
                onClick={() => setFilterActive(!filterActive)}
                aria-label="Toggle dashboard filter"
                className={cn(
                  "p-2 rounded-xl border transition-all active:scale-95 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer",
                  filterActive
                    ? "bg-accent/15 border-accent/40 text-accent shadow-[0_0_15px_rgba(91,111,255,0.15)]"
                    : "bg-surface border-border/60 text-dim hover:text-text hover:border-accent/40"
                )}
              >
                <Filter size={14} />
                <span className="hidden md:inline text-[9px] font-black uppercase tracking-widest">
                  Filter
                </span>
              </button>
            </Tooltip>

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
                  "px-3 py-2 rounded-xl border transition-all active:scale-95 flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent outline-none cursor-pointer",
                  isThrottled
                    ? "bg-green/10 border-green/30 text-green shadow-[0_0_15px_rgba(0,229,160,0.1)]"
                    : "bg-surface border-border/60 text-dim hover:text-accent hover:border-accent/40"
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
                  className="p-2 bg-red/10 border border-red/20 text-red rounded-xl hover:bg-red/20 hover:scale-95 active:scale-90 transition-all focus-visible:ring-2 focus-visible:ring-red outline-none cursor-pointer"
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
                tooltipText={(() => {
                  const startBal = (config?.trading_mode === 'paper' ? config?.paper_starting_balance : config?.live_starting_balance) || 10000;
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
                subValue={(() => {
                  const prevBalance = lastTrade ? balance - (lastTrade.pnl || 0) : balance;
                  const balPctChange = prevBalance > 0 && lastTrade ? ((lastTrade.pnl || 0) / prevBalance) * 100 : 0;
                  const fundPct = balance > 0 ? (Math.abs(netFunding) / balance) * 100 : 0;
                  const commPct = balance > 0 ? (Math.abs(netComm) / balance) * 100 : 0;
                  const tradeTs = lastTrade?.exit_ts_ms || (lastTrade?.exit_ts ? new Date(lastTrade.exit_ts).getTime() : 0) || (lastTrade?.updated_at ? new Date(lastTrade.updated_at).getTime() : 0) || (lastTrade?.entry_ts ? new Date(lastTrade.entry_ts).getTime() : 0);
                  const tradeTimeAgo = tradeTs ? formatTimeAgo(tradeTs) : null;
                  const udsTimeAgo = lastUdsBalanceTs ? formatTimeAgo(lastUdsBalanceTs) : null;

                  return (
                    <div className="flex flex-col gap-1 text-[10px]">
                      {lastTrade && (
                        <div className="flex items-center gap-1 flex-wrap">
                          {Number(lastTrade.pnl || 0) >= 0 ? <TrendingUp size={10} className="text-green" /> : <TrendingDown size={10} className="text-red" />}
                          <span className={pnlClass(lastTrade.pnl)}>
                            {fmtUSD(lastTrade.pnl)} ({balPctChange >= 0 ? '+' : ''}{Number(balPctChange).toFixed(2)}%)
                          </span>
                          {tradeTimeAgo && (
                            <span className="text-dim text-[9px] font-medium" title="Time since last closed trade">
                              · Trade {tradeTimeAgo}
                            </span>
                          )}
                        </div>
                      )}
                      {!lastTrade && udsTimeAgo && (
                        <div className="flex items-center gap-1 flex-wrap text-dim text-[9px] font-medium" title="Time since last UDS balance update">
                          <span>UDS Sync {udsTimeAgo}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap text-[9px] font-mono text-dim/70">
                        <span>Fund: <span className={netFunding > 0 ? "text-red/80" : "text-green/80"}>{fmtUSD(-netFunding)} <span className="opacity-80">({fundPct.toFixed(2)}%)</span></span></span>
                        <span>•</span>
                        <span>Fee: <span className="text-red/80">{fmtUSD(-netComm)} <span className="opacity-80">({commPct.toFixed(2)}%)</span></span></span>
                        {lastUdsBalanceReason && (
                          <>
                            <span>•</span>
                            <span className="text-accent font-black bg-accent/10 px-1 py-0.2 rounded text-[8px] uppercase" title={udsTimeAgo ? `Balance event ${udsTimeAgo}` : 'Latest balance event'}>
                              ⚡ {lastUdsBalanceReason} {udsTimeAgo && <span className="text-dim font-normal font-sans ml-0.5">({udsTimeAgo})</span>}
                            </span>
                          </>
                        )}
                      </div>
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

        <ReconciliationCenter
          sessionActive={sessionActive}
          tradingMode={tradingMode}
          config={config}
          addAlert={addAlert}
        />


        {/* KPI Metric Cards (Matching reference design Total Revenue, Active Users, Pending Orders layout) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5 lg:mb-6"
        >
          <ReferenceKPICard
            title="Account Equity"
            value={`$${(balance || 0).toLocaleString()}`}
            changePct={todaysPnlPct.toFixed(1)}
            isPositive={todaysPnl >= 0}
            icon={DollarSign}
            iconBg="bg-accent/15 text-accent"
            subtext={`Today's P&L: ${fmtUSD(todaysPnl)}`}
          />
          <ReferenceKPICard
            title="Active Positions"
            value={`${activeTrades.length} / ${config.max_open_trades || 5}`}
            changePct={((activeTrades.length / (config.max_open_trades || 5)) * 100).toFixed(1)}
            isPositive={activeTrades.length > 0}
            icon={Users}
            iconBg="bg-green/15 text-green"
            subtext={`Risk: ${Number(totalRiskPct || 0).toFixed(1)}%`}
          />
          <ReferenceKPICard
            title="Pending Orders"
            value={`${pendingScannerTriggers}`}
            changePct={pendingScannerTriggers > 0 ? (pendingScannerTriggers).toFixed(1) : "0.0"}
            isPositive={pendingScannerTriggers > 0}
            icon={Clock}
            iconBg="bg-amber/15 text-amber"
            subtext="Scanner Triggers"
          />
        </motion.div>

        {/* Monthly Revenue Bar Chart (Observable Analytics) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mb-5 lg:mb-6"
        >
          <MonthlyRevenueChart tradeHistory={tradeHistory} />
        </motion.div>

        {/* Recent Transactions List (Matching reference design) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="mb-5 lg:mb-6"
        >
          <RecentTransactionsList
            tradeHistory={tradeHistory}
            activeTrades={activeTrades}
            onOpenScanner={handleOpenScanner}
          />
        </motion.div>

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
                  {analytics?.cumulativePnL?.length ? `As of ${new Date(analytics.cumulativePnL[analytics.cumulativePnL.length - 1].ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Updated Live'}
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
                            const durationMinutes = Math.floor(b.avgDurationMs / 60000);
                            const durationHrs = Math.floor(durationMinutes / 60);
                            const durationFormatted = durationHrs > 0
                              ? `${durationHrs}h ${durationMinutes % 60}m`
                              : `${durationMinutes}m`;

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
              <div className="flex items-center justify-between mb-4">
                <SectionLabel className="mb-0 flex items-center gap-2">
                  <Zap size={14} className="text-accent" /> Active Strategy
                </SectionLabel>
                <div className="flex items-center bg-background/60 border border-border/40 p-0.5 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setCardViewMode('detailed')}
                    className={cn(
                      "px-2 sm:px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                      cardViewMode === 'detailed' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text"
                    )}
                    aria-label="Detailed strategy cards view"
                  >
                    Detailed
                  </button>
                  <button
                    type="button"
                    onClick={() => setCardViewMode('compact')}
                    className={cn(
                      "px-2 sm:px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                      cardViewMode === 'compact' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text"
                    )}
                    aria-label="Compact strategy cards view"
                  >
                    Compact
                  </button>
                  <button
                    type="button"
                    onClick={() => setCardViewMode('list')}
                    className={cn(
                      "px-2 sm:px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                      cardViewMode === 'list' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text"
                    )}
                    aria-label="List strategy cards view"
                  >
                    List
                  </button>
                </div>
              </div>
              <div className={cn(
                "grid gap-3 sm:gap-4",
                cardViewMode === 'list' ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
              )}>
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
                              totalPnl: safeVariantStats[currentStrategy.strategy_label]?.totalPnl ?? (stratMetricsMap.get(currentStrategy.strategy_label)?.totalPnl ?? currentStrategy.totalPnl),
                              activePnl: activePnlMap[currentStrategy.strategy_label] || 0,
                              activeEstPnl: activeEstPnlToRealizeMap[currentStrategy.strategy_label] || 0,
                              activeTradeCount: activeTradeCountsMap[currentStrategy.strategy_label] || 0,
                              totalEstPnlToRealize: safeVariantStats[currentStrategy.strategy_label]?.totalEstPnlToRealize ?? activeEstPnlToRealizeMap[currentStrategy.strategy_label] ?? 0
                            }}
                            scannerResults={variantScannerResults[currentStrategy.strategy_label]}
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
                            const variantTotalPnl = safeVariantStats[label]?.totalPnl ?? (stratMetric ? stratMetric.totalPnl + (activePnlMap[label] || 0) : (activePnlMap[label] || 0));
                            return (
                              <StrategyCard
                                key={label}
                                s={{
                                  ...currentStrategy,
                                  strategy_label: label,
                                  ...safeVariantStats[label],
                                  totalPnl: variantTotalPnl,
                                  activePnl: activePnlMap[label] || 0,
                                  activeEstPnl: activeEstPnlToRealizeMap[label] || 0,
                                  activeTradeCount: activeTradeCountsMap[label] || 0,
                                  totalEstPnlToRealize: safeVariantStats[label]?.totalEstPnlToRealize ?? activeEstPnlToRealizeMap[label] ?? 0
                                }}
                                scannerResults={variantScannerResults[label]}
                                config={variantConfig}
                                paused={pausedStrategies.includes(label) || sessionPaused}
                                isPausing={!!pausingMap[label]}
                                gateInfo={strategyGateStates[label]}
                                onPause={togglePause}
                                onOpenScanner={handleOpenScanner}
                                onEdit={handleEditVariant}
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
