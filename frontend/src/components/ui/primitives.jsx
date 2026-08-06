import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from "./utils"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { CheckCircle2, AlertCircle, AlertTriangle, Loader2, Zap, Copy, ChevronLeft, Plus, Minus, Lock, Unlock, Info, RefreshCw, ShieldCheck, Activity, X } from 'lucide-react'
import { Sparkline as SparklineChart, CandlestickChart as CandlestickChartBase } from '../DataCharts'
import { useTradingStore } from '../../store/trading'
import { useTooltipContext, Tooltip } from './tooltip'

// --- Pulse dot ---
export const PulseDot = React.memo(({ color = "bg-green" }) => (
  <span className="relative inline-flex items-center justify-center w-3 h-3">
    <span className={cn(
      "absolute w-3 h-3 rounded-full opacity-40 animate-ping",
      color
    )} />
    <span className={cn(
      "w-2 h-2 rounded-full flex-shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.5)]",
      color
    )} />
  </span>
))

// --- Alert Radar Ripple ---
export const AlertRipple = React.memo(({ level = "info" }) => {
  const colorMap = {
    error: {
      shadow: "shadow-[0_0_25px_rgba(255,68,102,0.6)]",
      border: "border-red/40",
      bg: "bg-red/5"
    },
    warn: {
      shadow: "shadow-[0_0_25px_rgba(245,166,35,0.6)]",
      border: "border-amber/40",
      bg: "bg-amber/5"
    },
    warning: {
      shadow: "shadow-[0_0_25px_rgba(245,166,35,0.6)]",
      border: "border-amber/40",
      bg: "bg-amber/5"
    },
    success: {
      shadow: "shadow-[0_0_25px_rgba(0,229,160,0.6)]",
      border: "border-green/40",
      bg: "bg-green/5"
    },
    info: {
      shadow: "shadow-[0_0_25px_rgba(91,111,255,0.6)]",
      border: "border-accent/40",
      bg: "bg-accent/5"
    }
  }

  const activeColor = colorMap[level] || colorMap.info;

  return (
    <motion.div
      initial={{ scale: 0.98, opacity: 0.8 }}
      animate={{
        scale: [0.98, 1.025, 1.05],
        opacity: [0.8, 0.4, 0]
      }}
      transition={{
        duration: 1.2,
        ease: "easeOut"
      }}
      className={cn(
        "absolute inset-0 rounded-full border pointer-events-none z-0",
        activeColor.border,
        activeColor.bg,
        activeColor.shadow
      )}
    />
  )
})
AlertRipple.displayName = 'AlertRipple'

// --- Interactive Limit Card ---
export const InteractiveLimitCard = React.memo(({ label, value, unit = "", onIncrement, onDecrement, min = 0, max = 1000, step = 1, syncing, disabled, indicator, tooltip, subValue, usagePct }) => {
  const [isLocked, setIsLocked] = React.useState(true);
  const timerRef = React.useRef(null);

  const handleAction = (action) => {
    if (isLocked) {
      setIsLocked(false);
    } else {
      action();
    }

    // Reset auto-lock timer
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsLocked(true), 5000);
  };

  const handleKeyDown = (e) => {
    if (isLocked) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsLocked(false);
      }
      return;
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); handleAction(onIncrement); }
    if (e.key === 'ArrowDown') { e.preventDefault(); handleAction(onDecrement); }
    if (e.key === 'Escape') { e.preventDefault(); setIsLocked(true); }
  };

  return (
    <div
      className={cn(
        "bg-surface border p-3 md:p-4 lg:p-5 rounded-2xl shadow-sm transition-all group relative overflow-hidden flex flex-col items-start min-h-[64px] md:min-h-[80px] lg:min-h-[100px] min-w-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
        isLocked ? "border-border/60" : "border-accent/40 bg-accent/[0.02] shadow-[0_0_20px_rgba(91,111,255,0.05)]",
        disabled && "opacity-40 grayscale pointer-events-none",
        usagePct >= 90 && "border-red/40 bg-red/[0.02] shadow-[0_0_20px_rgba(255,68,102,0.1)] animate-pulse-slow",
        usagePct >= 70 && usagePct < 90 && "border-amber/40 bg-amber/[0.02] shadow-[0_0_20px_rgba(245,166,35,0.05)]",
        subValue?.includes('Wait') && "border-amber/40 bg-amber/[0.01] animate-pulse-slow"
      )}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="spinbutton"
      aria-label={`${label} (${isLocked ? 'Locked' : 'Unlocked'})`}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-busy={syncing}
    >
      {syncing && (
        <div className="absolute inset-0 bg-accent/5 animate-pulse pointer-events-none" />
      )}
      <div className="flex flex-col gap-0.5 w-full relative z-10">
        <div className="flex items-start w-full min-h-[2rem] md:min-h-[2.25rem]">
          <div className="flex items-center gap-2 flex-grow overflow-hidden mr-1">
            <div className={cn(
              "text-[9px] md:text-[10px] text-dim tracking-[0.15em] uppercase font-black leading-[1.1] hover:text-dim/80 transition-colors"
            )}>{label}</div>
            {indicator === 'amber' && (
              <div className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse shrink-0" />
            )}
          </div>
          <Tooltip content={isLocked ? "Unlock Controls" : "Lock Controls"}>
            <button
              onClick={(e) => { e.stopPropagation(); setIsLocked(!isLocked); }}
              className={cn("p-1 rounded-md transition-colors shrink-0 mt-0.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none", isLocked ? "text-dim/40 hover:text-dim" : "text-accent")}
              aria-label={isLocked ? "Unlock controls" : "Lock controls"}
            >
              {isLocked ? <Lock size={10} /> : <Unlock size={10} />}
            </button>
          </Tooltip>
        </div>
        <div className="flex items-center w-full gap-2">
          <div className="flex flex-col flex-grow min-w-0">
            <div className={cn(
              "text-sm md:text-base lg:text-xl font-black font-mono tracking-tighter transition-all duration-500 truncate",
              isLocked ? "text-dim/60" : "text-text",
              syncing && "opacity-40 blur-[1px]"
            )}>
              {value}{unit}
            </div>
            {subValue && (
              <div className="text-[8px] font-black text-dim uppercase tracking-wider mt-0.5 truncate">{subValue}</div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); handleAction(onDecrement); }}
              disabled={!isLocked && value <= min}
              className={cn(
                "w-11 h-11 rounded-lg border flex items-center justify-center transition-all active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                isLocked
                  ? "bg-transparent border-transparent text-dim/20"
                  : "bg-background border-border text-dim hover:text-text hover:border-accent/40 shadow-sm"
              )}
              aria-label={isLocked ? "Tap to unlock" : `Decrease ${label}`}
            >
              <Minus size={22} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleAction(onIncrement); }}
              disabled={!isLocked && value >= max}
              className={cn(
                "w-11 h-11 rounded-lg border flex items-center justify-center transition-all active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                isLocked
                  ? "bg-transparent border-transparent text-dim/20"
                  : "bg-background border-border text-dim hover:text-text hover:border-accent/40 shadow-sm"
              )}
              aria-label={isLocked ? "Tap to unlock" : `Increase ${label}`}
            >
              <Plus size={22} />
            </button>
          </div>
        </div>
      </div>
      {usagePct !== undefined && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-border/20">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(usagePct, 100)}%` }}
            className={cn(
              "h-full transition-all duration-1000",
              usagePct >= 90 ? "bg-red" : usagePct >= 70 ? "bg-amber" : "bg-accent"
            )}
          />
        </div>
      )}
    </div>
  );
})

// --- Stat Card ---
export const StatCard = React.memo(({ label, value, color = "text-text", subValue, syncing, tooltipText, compact, ariaLabel }) => {
  // BOLT: Clean up double-negative visuals: if value starts with '-', don't show negative arrow in label/icon.
  const sanitizedValue = typeof value === 'string' && (value.includes('▼') || value.includes('▲') || value.includes('▾') || value.includes('▴')) && value.includes('-')
    ? value.replace('-', '') // Remove the minus if an arrow is already present
    : value;

  const content = (
    <div
      className={cn(
        "bg-surface border border-border/60 rounded-xl md:rounded-2xl shadow-sm hover:border-accent/30 hover:bg-white/[0.01] transition-all group relative overflow-hidden flex flex-col items-start min-w-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none focus-visible:border-accent/30 focus-visible:bg-white/[0.01]",
        compact
          ? "p-2 md:p-2.5 min-h-[48px] md:min-h-[56px] lg:min-h-[64px]"
          : "p-3 md:p-4 lg:p-5 min-h-[64px] md:min-h-[80px] lg:min-h-[100px]"
      )}
      role="region"
      aria-label={ariaLabel || `${label}: ${value}${tooltipText ? '. ' + tooltipText : ''}`}
      aria-busy={syncing}
      tabIndex={tooltipText ? 0 : undefined}
    >
      {syncing && (
        <div className="absolute inset-0 bg-accent/5 animate-pulse pointer-events-none" aria-label="Syncing data..." />
      )}
      <div className={cn("flex flex-col w-full", compact ? "gap-0" : "gap-0.5")}>
        <div className={cn("flex items-start gap-1.5", compact ? "min-h-[1.25rem]" : "min-h-[2rem] md:min-h-[2.25rem]")}>
            <div className={cn("text-dim tracking-[0.15em] uppercase font-black leading-[1.1] flex-1", compact ? "text-[8px] md:text-[9px]" : "text-[9px] md:text-[10px]")} aria-hidden="true">{label}</div>
            {tooltipText && <Info size={compact ? 8 : 10} className="text-dim/30 group-hover:text-accent group-focus-visible:text-accent transition-colors" />}
        </div>
        <div className="flex flex-col">
          <div className={cn(
            "font-black font-mono tracking-tighter transition-all duration-500 truncate leading-none",
            color,
            compact ? "text-xs md:text-sm lg:text-base" : "text-sm md:text-base lg:text-xl",
            syncing && "opacity-40 blur-[1px]"
          )}>{sanitizedValue}</div>
          {subValue && (
            <div className={cn(
              "text-dim font-mono font-black uppercase flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0",
              compact ? "text-[7px] md:text-[7.5px] mt-0.5" : "text-[8px] md:text-[9px] mt-0.5",
              syncing && "text-accent/60 animate-pulse"
            )}>
              {syncing && <Loader2 size={compact ? 6 : 8} className="animate-spin shrink-0" aria-hidden="true" />}
              <span className="truncate whitespace-normal sm:whitespace-nowrap min-w-0 w-full">{subValue}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (tooltipText) {
    return <Tooltip content={tooltipText}>{content}</Tooltip>;
  }

  return content;
})

// --- Section Label ---
export const SectionLabel = ({ children, className }) => (
  <div className={cn("text-[11px] text-dim tracking-widest mb-3 uppercase font-bold flex items-center gap-2", className)}>
    {children}
  </div>
)

// --- Button ---
export const Btn = React.forwardRef(({ children, variant = "primary", onClick, className, disabled, loading, icon: Icon, ...props }, ref) => {
  const variants = {
    success: "bg-green/10 text-green border border-green/20 hover:bg-green/20 shadow-[0_0_15px_rgba(0,229,160,0.1)]",
    danger: "bg-red/10 text-red border border-red/20 hover:bg-red/20 shadow-[0_0_15px_rgba(255,68,102,0.1)]",
    primary: "bg-accent text-white hover:bg-accent/90 shadow-[0_0_20px_rgba(91,111,255,0.2)]",
    ghost: "bg-transparent text-dim hover:text-text hover:bg-surface border border-border"
  }

  return (
    <button
      ref={ref}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "px-5 py-2.5 rounded-xl font-bold text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
        variants[variant],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon && <Icon size={16} />}
      {children}
    </button>
  )
})
Btn.displayName = 'Btn'

// --- Status Badge ---
export const StatusBadge = ({ status }) => {
  const active = status === true || status === 'live'
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-widest transition-all",
      active ? "text-green" : "text-dim"
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", active ? "bg-green animate-pulse" : "bg-dim/40")} />
      {active ? "Active" : "Stopped"}
    </span>
  )
}

// --- Mode Badges ---
export const PaperBadge = () => (
  <span className="inline-flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-widest text-amber">
    <span className="w-1.5 h-1.5 rounded-full bg-amber shrink-0" />
    Paper
  </span>
)

export const EcoBadge = () => {
  const { wsStatus, isThrottled, isSyncingOnResume, sessionActive, isEcoMode } = useTradingStore(state => ({
    wsStatus: state.wsStatus,
    isThrottled: state.isThrottled,
    isSyncingOnResume: state.isSyncingOnResume,
    sessionActive: state.sessionActive,
    isEcoMode: state.isEcoMode
  }));

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showResumingFeedback = sessionActive && isResuming;
  const isEco = isThrottled || isEcoMode;

  if (!showResumingFeedback && !isEco) return null;

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-widest transition-colors",
      showResumingFeedback ? "text-accent" : "text-green"
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", showResumingFeedback ? "bg-accent animate-spin" : "bg-green animate-pulse")} />
      {showResumingFeedback ? 'Resuming' : 'Eco'}
    </span>
  );
}

export const DemoBadge = () => (
  <span className="inline-flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-widest text-purple">
    <span className="w-1.5 h-1.5 rounded-full bg-purple shrink-0" />
    Demo
  </span>
)

export const LiveBadge = () => (
  <span className="inline-flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-widest text-green">
    <span className="w-1.5 h-1.5 rounded-full bg-green shrink-0 animate-pulse" />
    Live
  </span>
)

export const MonitoredBadge = React.memo(({ className, label = "Monitored" }) => (
  <div className={cn("flex items-center gap-1.5 whitespace-nowrap overflow-hidden", className)}>
    <ShieldCheck size={12} className="text-accent shrink-0" />
    <span className="text-[8px] md:text-[9px] font-black text-accent uppercase tracking-widest truncate">{label}</span>
  </div>
))
MonitoredBadge.displayName = 'MonitoredBadge'

export const InPosBadge = React.memo(({ className, label = "In Pos" }) => (
  <div className={cn("flex items-center gap-1 whitespace-nowrap overflow-hidden", className)}>
     <Zap size={10} className="text-green fill-green/20 shrink-0" />
     <span className="text-[8px] font-black text-green uppercase tracking-tighter truncate">{label}</span>
  </div>
))
InPosBadge.displayName = 'InPosBadge'

export const SmartCandidateBadge = React.memo(({ className, label = "Predictive" }) => (
  <div className={cn("flex items-center gap-1.5 whitespace-nowrap overflow-hidden", className)}>
    <Activity size={10} className="text-purple-400 shrink-0" />
    <span className="text-[8px] md:text-[9px] font-black text-purple-400 uppercase tracking-widest truncate">{label}</span>
  </div>
))
SmartCandidateBadge.displayName = 'SmartCandidateBadge'

// --- Condition Widget ---
export const ConditionWidget = React.memo(({ label, value, threshold, unit = "%", satisfied, sublabel }) => {
  const isCount = unit.includes('/') || unit.includes('signals');
  const absThreshold = Math.max(Math.abs(threshold), 0.0001);
  const pct = isCount
    ? (threshold !== 0 ? Math.min((value / threshold) * 100, 100) : 100)
    : (threshold !== 0
        ? Math.min((Math.abs(value) / (absThreshold * 1.5)) * 100, 100)
        : Math.min(value > 0 ? 100 : 0, 100));
  const colorClass = satisfied ? "bg-green" : "bg-amber";
  const textColorClass = satisfied ? "text-green" : "text-amber";
  const borderColorClass = satisfied ? "border-green/30 shadow-[0_0_15px_rgba(0,229,160,0.05)]" : "border-border";
  const formattedValue = Number.isFinite(value)
    ? `${!isCount && value > 0 ? "+" : ""}${isCount ? Math.round(value) : Number(value).toFixed(2)}${unit}`
    : `N/A ${unit}`;

  const thresholdText = threshold !== 0
    ? `${isCount ? "" : "≥ "}${isCount ? Math.round(threshold) : threshold}${unit}`
    : "Trigger: 0";

  const ariaText = `${label}: ${formattedValue}. Threshold is ${thresholdText}. ${satisfied ? 'Condition satisfied' : 'Awaiting signal'}. ${sublabel || ''}`;

  return (
    <div
      className={cn(
        "flex-1 bg-surface border rounded-2xl p-5 md:p-6 transition-all duration-500 flex flex-col",
        borderColorClass
      )}
      role="region"
      aria-label={ariaText}
    >
      <div className="flex justify-between items-start gap-4 min-h-[1.5rem] mb-4 md:mb-6">
        <div className="text-[10px] md:text-[11px] text-dim tracking-[0.15em] uppercase font-bold shrink-0 whitespace-nowrap">{label}</div>
        <div className="text-[10px] text-dim font-bold uppercase tracking-[0.15em] whitespace-nowrap text-right">THRESHOLD: {thresholdText}</div>
      </div>

      <div className="flex flex-col items-start mb-4">
          <div className={cn("text-xl md:text-base lg:text-2xl font-bold font-mono tracking-tight truncate w-full", textColorClass)}>
            {formattedValue}
          </div>
          {sublabel && <div className="text-[11px] text-dim mt-1 font-bold uppercase tracking-tight truncate w-full">{sublabel}</div>}
      </div>

      <ProgressPrimitive.Root
        className="h-1.5 bg-border rounded-full overflow-hidden"
        value={pct}
        aria-label={`${label} progress: ${Math.round(pct)}%`}
      >
        <ProgressPrimitive.Indicator
          className={cn("h-full transition-all duration-700 ease-out", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </ProgressPrimitive.Root>

      <div className="mt-4 flex items-center gap-2">
        {satisfied ? (
          <CheckCircle2 size={14} className="text-green" />
        ) : (
          <AlertCircle size={14} className="text-amber" />
        )}
        <span className={cn("text-[11px] font-bold uppercase tracking-[0.15em]", textColorClass)}>
          {satisfied ? "Condition satisfied" : "Awaiting signal…"}
        </span>
      </div>
    </div>
  );
})

// --- P&L Bars ---
export const PnLBars = React.memo(({ trades }) => {
  const safeTrades = Array.isArray(trades) ? trades : [];
  if (safeTrades.length === 0) return <div className="h-[60px] flex items-center justify-center text-[10px] text-dim font-bold uppercase tracking-widest">No Trade Data</div>

  // BOLT: Single-pass O(N) loop to find maximum absolute PnL with zero intermediate allocations.
  let max = 1;
  for (let i = 0; i < safeTrades.length; i++) {
    const val = Math.abs(safeTrades[i].pnl || 0);
    if (val > max) max = val;
  }

  return (
    <div
      role="img"
      aria-label="Profit and Loss performance chart"
      className="relative flex items-center gap-1 h-[60px] px-1"
    >
      {/* Zero baseline */}
      <div className="absolute left-0 right-0 h-px bg-border/40 z-0 top-1/2" />

      {safeTrades.map((t, i) => {
        const pnl = t.pnl || 0;
        const isPos = pnl >= 0;
        const absPnl = Math.abs(pnl);

        // Non-linear scaling (sqrt) to prevent flat bars for small values
        const scaleFactor = Math.sqrt(absPnl) / Math.sqrt(max);
        const h = absPnl === 0 ? 0 : Math.max(3, scaleFactor * 28); // Max half-height is ~30px

        return (
          <Tooltip key={t.id || `${t.symbol}-${i}`} content={`${t.symbol}: ${Number(pnl).toFixed(2)}`}>
            <div
              className={cn(
                "flex-1 transition-all duration-300 hover:opacity-100 opacity-80 z-10",
                isPos
                  ? "bg-green rounded-t-[1px] shadow-[0_0_10px_rgba(0,229,160,0.1)]"
                  : "bg-red rounded-b-[1px] shadow-[0_0_10px_rgba(255,68,102,0.1)]"
              )}
              style={{
                height: `${h}px`,
                transform: `translateY(${isPos ? -50 : 50}%)`,
                alignSelf: 'center'
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
})

export { Tooltip } from './tooltip'
export { cn } from './utils'

export const VisuallyHidden = ({ children }) => (
  <span className="absolute w-[1px] h-[1px] p-0 -m-[1px] overflow-hidden whitespace-nowrap border-0 clip-[rect(0,0,0,0)]">
    {children}
  </span>
)

export const ViewHeader = ({ icon: Icon, title, subTitle, children, sticky = true, backAction, isResuming: propsResuming }) => {
  const { config, wsStatus, isThrottled, isEcoMode, isSyncingOnResume, sessionActive, alerts, updateStats } = useTradingStore()
  const tradingMode = config.trading_mode || 'paper'

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = propsResuming ?? (sessionActive && isResuming)

  const [alertIndex, setAlertIndex] = React.useState(0)
  const [showDropdown, setShowDropdown] = React.useState(false)
  const [hasActiveModal, setHasActiveModal] = React.useState(false)

  const newestAlert = alerts && alerts.length > 0 ? alerts[0] : null
  const [lastProcessedAlert, setLastProcessedAlert] = React.useState(null)
  const [triggerRippleKey, setTriggerRippleKey] = React.useState(0)

  // Programmatically auto-focus the newest alert and trigger visual ripple cues
  React.useEffect(() => {
    if (!newestAlert) {
      setLastProcessedAlert(null)
      return
    }
    const isNewId = !lastProcessedAlert || lastProcessedAlert.id !== newestAlert.id
    const isNewCount = lastProcessedAlert && lastProcessedAlert.id === newestAlert.id && (newestAlert.count || 1) > (lastProcessedAlert.count || 1)
    const isNewTs = lastProcessedAlert && lastProcessedAlert.id === newestAlert.id && newestAlert.ts !== lastProcessedAlert.ts

    if (isNewId || isNewCount || isNewTs) {
      setLastProcessedAlert({ id: newestAlert.id, count: newestAlert.count || 1, ts: newestAlert.ts, level: newestAlert.level })
      setAlertIndex(0)
      setTriggerRippleKey(prev => prev + 1)
    }
  }, [newestAlert, lastProcessedAlert])

  // SRE-PERF: Highly optimized MutationObserver to detect active overlay modals/dialogs.
  // When a modal is open, we suppress the global ticker to prevent background visual noise,
  // screen-reader clutter, and accidental background keyboard tab indexing.
  React.useEffect(() => {
    const checkModals = () => {
      const isOpen = !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
      setHasActiveModal(isOpen);
    };

    checkModals();

    const observer = new MutationObserver(checkModals);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'class', 'style']
    });

    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!alerts || alerts.length <= 1) {
      setAlertIndex(0)
      return
    }
    const interval = setInterval(() => {
      setAlertIndex(prev => (prev + 1) % alerts.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [alerts])

  const activeAlert = !hasActiveModal && alerts && alerts.length > 0 ? alerts[alertIndex % alerts.length] : null

  return (
    <div className={cn(
      "z-40 transition-all duration-300 mb-2 lg:mb-3",
      sticky && "sticky top-0 bg-background/90 backdrop-blur-md py-1.5 -mx-4 px-4 md:-mx-10 md:px-10 border-b border-border/10 shadow-sm"
    )}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 relative w-full">
        {/* Left Side: Title and Badges */}
        <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1 w-full">
          {backAction && (
            <button
              onClick={backAction}
              aria-label="Go back"
              className="p-1 hover:bg-surface border border-border rounded-lg transition-all active:scale-90 group shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              <ChevronLeft size={14} className="text-dim group-hover:text-text" />
            </button>
          )}
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <div className="w-7 h-7 rounded-lg bg-accent/5 border border-accent/10 flex items-center justify-center shrink-0">
                <Icon size={14} className="text-accent" />
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <h1 className="text-xs md:text-sm font-black tracking-tight truncate uppercase">{showResumingFeedback ? 'Resuming...' : title}</h1>
                <div className="flex items-center gap-1.5 shrink-0 scale-[0.8] origin-left">
                  {tradingMode === 'paper' && <PaperBadge />}
                  {tradingMode === 'testnet' && <DemoBadge />}
                  {tradingMode === 'live' && <LiveBadge />}
                  {(isThrottled || isEcoMode || wsStatus !== 'live') && <EcoBadge />}
                </div>
              </div>
              {subTitle && (
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <p className="text-[9px] text-dim font-bold uppercase tracking-widest truncate opacity-80">
                    {subTitle}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0 opacity-40 scale-[0.8] origin-left">
                    <span className={cn("text-[9px] font-bold font-mono tracking-widest uppercase", !showResumingFeedback ? "text-green" : "text-accent")}>
                      {wsStatus !== 'live' ? 'Reconnecting' : showResumingFeedback ? 'Resuming Feed...' : 'Connected'}
                    </span>
                    {wsStatus !== 'live' && (
                      <button
                        onClick={() => window.location.reload()}
                        className="text-[9px] font-bold font-mono tracking-widest uppercase text-amber hover:text-white underline transition-colors"
                        aria-label="Retry connection"
                      >
                        Retry
                      </button>
                    )}
                    <PulseDot color={!showResumingFeedback ? "bg-green" : "bg-accent"} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: Integrated Non-Blocking Horizontal Ticker */}
        {activeAlert && (
          <div className="flex relative items-center justify-center min-w-0 w-full sm:w-auto flex-1 px-2 sm:px-4 z-50">
            <div
              onClick={() => setShowDropdown(!showDropdown)}
              className="group relative pointer-events-auto cursor-pointer flex items-center justify-between gap-2 px-3.5 py-1 bg-surface/30 hover:bg-surface/60 border border-border/40 hover:border-accent/30 rounded-full text-[10px] text-text max-w-[360px] lg:max-w-[440px] w-full transition-all duration-300 select-none animate-in fade-in"
              title="Click to view all recent alerts"
            >
              {triggerRippleKey > 0 && (
                <AlertRipple key={triggerRippleKey} level={lastProcessedAlert?.level} />
              )}

              <div className="flex items-center min-w-0 flex-1 relative overflow-hidden h-[18px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeAlert.id + '-' + activeAlert.count}
                    initial={{ y: 15, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -15, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                    className="flex items-center gap-1.5 min-w-0 w-full h-full"
                  >
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0 animate-pulse",
                      activeAlert.level === 'error' ? "bg-red" :
                      activeAlert.level === 'warn' ? "bg-amber" :
                      activeAlert.level === 'success' ? "bg-green" :
                      "bg-accent"
                    )} />
                    <span className="font-black uppercase tracking-wider shrink-0 opacity-80 text-[8.5px] text-white">
                      {activeAlert.title || 'Alert'}
                    </span>
                    <span className="opacity-30 shrink-0 font-black">|</span>
                    <span className="font-semibold truncate text-dim group-hover:text-text transition-colors">
                      {activeAlert.message}
                    </span>
                    {activeAlert.count > 1 && (
                      <span className="bg-white/10 px-1 py-0.2 rounded text-[7px] font-black shrink-0">x{activeAlert.count}</span>
                    )}
                    {alerts.length > 1 && (
                      <span className="text-[7.5px] font-bold text-accent shrink-0 uppercase tracking-tighter ml-auto">
                        +{alerts.length - 1} more
                      </span>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  const nextAlerts = alerts.filter(a => a.id !== activeAlert.id)
                  updateStats({ alerts: nextAlerts })
                  if (nextAlerts.length === 0) setShowDropdown(false)
                }}
                className="p-0.5 rounded text-dim hover:text-red hover:bg-white/5 transition-all shrink-0 focus-visible:ring-1 focus-visible:ring-red focus-visible:outline-none z-10"
                aria-label="Dismiss this alert"
              >
                <X size={10} />
              </button>
            </div>

            {/* Dropdown Overlay containing the exact alert history */}
            {showDropdown && (
              <>
                <div className="fixed inset-0 z-40 cursor-default" onClick={(e) => { e.stopPropagation(); setShowDropdown(false); }} />
                <div className="absolute top-full mt-2 bg-surface/95 border border-border/80 shadow-2xl rounded-2xl p-3 w-80 max-h-64 overflow-y-auto no-scrollbar z-50 animate-in fade-in slide-in-from-top-2 pointer-events-auto">
                  <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-border/30">
                    <span className="text-[9px] font-black uppercase tracking-widest text-dim">Recent Alerts ({alerts.length})</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); updateStats({ alerts: [] }); setShowDropdown(false); }}
                      className="text-[8.5px] font-black text-red hover:text-red-400 uppercase tracking-widest transition-colors focus-visible:ring-1 focus-visible:ring-red focus-visible:outline-none rounded px-1"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {alerts.map(a => (
                      <div key={a.id} className="flex items-start justify-between gap-2 p-2 bg-background/40 hover:bg-background/80 border border-border/30 rounded-xl transition-all">
                        <div className="min-w-0 flex-1 text-[9.5px]">
                          <div className="flex items-center gap-1.5 font-black uppercase tracking-wider text-white">
                            <span className={cn(
                              "w-1 h-1 rounded-full shrink-0",
                              a.level === 'error' ? "bg-red" :
                              a.level === 'warn' ? "bg-amber" :
                              a.level === 'success' ? "bg-green" :
                              "bg-accent"
                            )} />
                            {a.title || 'System Alert'}
                            {a.count > 1 && <span className="text-[7.5px] bg-white/10 px-1 py-0.2 rounded text-text/80">x{a.count}</span>}
                          </div>
                          <p className="font-semibold text-dim mt-0.5 leading-normal break-words">{a.message}</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            const nextAlerts = alerts.filter(item => item.id !== a.id)
                            updateStats({ alerts: nextAlerts })
                            if (nextAlerts.length === 0) setShowDropdown(false)
                          }}
                          className="p-1 rounded text-dim hover:text-red hover:bg-white/5 transition-all shrink-0 focus-visible:ring-1 focus-visible:ring-red focus-visible:outline-none"
                          aria-label="Dismiss"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Right Side: Children Action Items */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:shrink-0 w-full sm:w-auto justify-start sm:justify-end scale-95 sm:scale-90 origin-left sm:origin-right mt-1.5 sm:mt-0">
          {children}
        </div>
      </div>
    </div>
  )
}

// --- Modal Alert Ticker ---
export const ModalAlertTicker = React.memo(() => {
  const { alerts, updateStats } = useTradingStore()
  const [alertIndex, setAlertIndex] = React.useState(0)
  const [showDropdown, setShowDropdown] = React.useState(false)

  const newestAlert = alerts && alerts.length > 0 ? alerts[0] : null
  const [lastProcessedAlert, setLastProcessedAlert] = React.useState(null)
  const [triggerRippleKey, setTriggerRippleKey] = React.useState(0)

  // Programmatically auto-focus the newest alert and trigger visual ripple cues
  React.useEffect(() => {
    if (!newestAlert) {
      setLastProcessedAlert(null)
      return
    }
    const isNewId = !lastProcessedAlert || lastProcessedAlert.id !== newestAlert.id
    const isNewCount = lastProcessedAlert && lastProcessedAlert.id === newestAlert.id && (newestAlert.count || 1) > (lastProcessedAlert.count || 1)
    const isNewTs = lastProcessedAlert && lastProcessedAlert.id === newestAlert.id && newestAlert.ts !== lastProcessedAlert.ts

    if (isNewId || isNewCount || isNewTs) {
      setLastProcessedAlert({ id: newestAlert.id, count: newestAlert.count || 1, ts: newestAlert.ts, level: newestAlert.level })
      setAlertIndex(0)
      setTriggerRippleKey(prev => prev + 1)
    }
  }, [newestAlert, lastProcessedAlert])

  React.useEffect(() => {
    if (!alerts || alerts.length <= 1) {
      setAlertIndex(0)
      return
    }
    const interval = setInterval(() => {
      setAlertIndex(prev => (prev + 1) % alerts.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [alerts])

  if (!alerts || alerts.length === 0) return null;

  const activeAlert = alerts[alertIndex % alerts.length];

  return (
    <div className="relative flex items-center justify-center min-w-0 w-full px-4 py-2 border-b border-border/10 bg-surface/20 z-50 animate-in fade-in">
      <div className="relative w-full max-w-[540px]">
        <div
          onClick={() => setShowDropdown(!showDropdown)}
          className="group relative pointer-events-auto cursor-pointer flex items-center justify-between gap-2 px-3.5 py-1.5 bg-surface/30 hover:bg-surface/60 border border-border/40 hover:border-accent/30 rounded-full text-[10px] text-text w-full transition-all duration-300 select-none animate-in fade-in"
          title="Click to view all recent alerts"
        >
          {triggerRippleKey > 0 && (
            <AlertRipple key={triggerRippleKey} level={lastProcessedAlert?.level} />
          )}

          <div className="flex items-center min-w-0 flex-1 relative overflow-hidden h-[18px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeAlert.id + '-' + activeAlert.count}
                initial={{ y: 15, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -15, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                className="flex items-center gap-1.5 min-w-0 w-full h-full"
              >
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0 animate-pulse",
                  activeAlert.level === 'error' ? "bg-red" :
                  activeAlert.level === 'warn' ? "bg-amber" :
                  activeAlert.level === 'success' ? "bg-green" :
                  "bg-accent"
                )} />
                <span className="font-black uppercase tracking-wider shrink-0 opacity-80 text-[8.5px] text-white">
                  {activeAlert.title || 'Alert'}
                </span>
                <span className="opacity-30 shrink-0 font-black">|</span>
                <span className="font-semibold truncate text-dim group-hover:text-text transition-colors">
                  {activeAlert.message}
                </span>
                {activeAlert.count > 1 && (
                  <span className="bg-white/10 px-1 py-0.2 rounded text-[7px] font-black shrink-0">x{activeAlert.count}</span>
                )}
                {alerts.length > 1 && (
                  <span className="text-[7.5px] font-bold text-accent shrink-0 uppercase tracking-tighter ml-auto">
                    +{alerts.length - 1} more
                  </span>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              const nextAlerts = alerts.filter(a => a.id !== activeAlert.id)
              updateStats({ alerts: nextAlerts })
              if (nextAlerts.length === 0) setShowDropdown(false)
            }}
            className="p-0.5 rounded text-dim hover:text-red hover:bg-white/5 transition-all shrink-0 focus-visible:ring-1 focus-visible:ring-red focus-visible:outline-none z-10"
            aria-label="Dismiss this alert"
          >
            <X size={10} />
          </button>
        </div>

        {/* Dropdown Overlay containing the exact alert history */}
        {showDropdown && (
          <>
            <div className="fixed inset-0 z-40 cursor-default" onClick={(e) => { e.stopPropagation(); setShowDropdown(false); }} />
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-surface/95 border border-border/80 shadow-2xl rounded-2xl p-3 w-80 max-h-64 overflow-y-auto no-scrollbar z-50 animate-in fade-in slide-in-from-top-2 pointer-events-auto">
              <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-border/30">
                <span className="text-[9px] font-black uppercase tracking-widest text-dim">Recent Alerts ({alerts.length})</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); updateStats({ alerts: [] }); setShowDropdown(false); }}
                  className="text-[8.5px] font-black text-red hover:text-red-400 uppercase tracking-widest transition-colors focus-visible:ring-1 focus-visible:ring-red focus-visible:outline-none rounded px-1"
                >
                  Clear All
                </button>
              </div>
              <div className="space-y-1.5">
                {alerts.map(a => (
                  <div key={a.id} className="flex items-start justify-between gap-2 p-2 bg-background/40 hover:bg-background/80 border border-border/30 rounded-xl transition-all">
                    <div className="min-w-0 flex-1 text-[9.5px]">
                      <div className="flex items-center gap-1.5 font-black uppercase tracking-wider text-white">
                        <span className={cn(
                          "w-1 h-1 rounded-full shrink-0",
                          a.level === 'error' ? "bg-red" :
                          a.level === 'warn' ? "bg-amber" :
                          a.level === 'success' ? "bg-green" :
                          "bg-accent"
                        )} />
                        {a.title || 'System Alert'}
                        {a.count > 1 && <span className="text-[7.5px] bg-white/10 px-1 py-0.2 rounded text-text/80">x{a.count}</span>}
                      </div>
                      <p className="font-semibold text-dim mt-0.5 leading-normal break-words">{a.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        const nextAlerts = alerts.filter(item => item.id !== a.id)
                        updateStats({ alerts: nextAlerts })
                        if (nextAlerts.length === 0) setShowDropdown(false)
                      }}
                      className="p-1 rounded text-dim hover:text-red hover:bg-white/5 transition-all shrink-0 focus-visible:ring-1 focus-visible:ring-red focus-visible:outline-none"
                      aria-label="Dismiss"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
})
ModalAlertTicker.displayName = 'ModalAlertTicker'

// --- Copy Button ---
export const CopyButton = React.memo(({ value, getValue, className, tooltip = "Copy", successTooltip = "Copied!" }) => {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async (e) => {
    e.stopPropagation()
    try {
      // `getValue` defers expensive serialization until the user actually clicks copy,
      // avoiding e.g. cloning/stringifying a large config object on every parent render.
      const text = typeof getValue === 'function' ? getValue() : value
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  return (
    <Tooltip content={copied ? successTooltip : tooltip}>
      <button
        onClick={handleCopy}
        className={cn(
          "p-1.5 rounded-md transition-all active:scale-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
          copied ? "text-green bg-green/10" : "text-dim hover:text-text hover:bg-white/5",
          className
        )}
        aria-label={copied ? successTooltip : tooltip}
      >
        {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
      </button>
    </Tooltip>
  )
})

// --- Charts ---
export const Sparkline = SparklineChart;
export const CandlestickChart = CandlestickChartBase;

// --- Global Toaster & Toast Item ---
export const ToastItem = React.memo(React.forwardRef(({ alert, onDismiss }, ref) => {
  const [progress, setProgress] = React.useState(100)
  const [isPaused, setIsPaused] = React.useState(false)
  const duration = alert.id?.startsWith('playwright-') ? 60000 : (alert.level === 'error' ? 10000 : 6000) // Test toasts stay 60s, error 10s, others 6s
  const startTime = React.useRef(Date.now())
  const remainingTime = React.useRef(duration)
  const lastTick = React.useRef(Date.now())

  React.useEffect(() => {
    if (isPaused) return

    lastTick.current = Date.now()
    const interval = setInterval(() => {
      const now = Date.now()
      const delta = now - lastTick.current
      lastTick.current = now

      remainingTime.current = Math.max(0, remainingTime.current - delta)
      const nextProgress = (remainingTime.current / duration) * 100
      setProgress(nextProgress)

      if (remainingTime.current <= 0) {
        clearInterval(interval)
        onDismiss(alert.id)
      }
    }, 40)

    return () => clearInterval(interval)
  }, [isPaused, alert.id, onDismiss, duration])

  // Reset countdown and progress if the alert ts updates (due to debouncing count increment)
  React.useEffect(() => {
    remainingTime.current = duration
    setProgress(100)
    lastTick.current = Date.now()
  }, [alert.ts, duration])

  const configByLevel = {
    success: {
      colorClass: "bg-green/10 border-green/20 shadow-[0_0_20px_rgba(0,229,160,0.06)]",
      accentClass: "bg-green",
      iconColor: "text-green",
      icon: CheckCircle2,
      role: "status"
    },
    error: {
      colorClass: "bg-red/10 border-red/20 shadow-[0_0_20px_rgba(255,68,102,0.06)]",
      accentClass: "bg-red",
      iconColor: "text-red",
      icon: AlertCircle,
      role: "alert"
    },
    warn: {
      colorClass: "bg-amber/10 border-amber/20 shadow-[0_0_20px_rgba(245,166,35,0.06)]",
      accentClass: "bg-amber",
      iconColor: "text-amber",
      icon: AlertTriangle,
      role: "alert"
    },
    warning: {
      colorClass: "bg-amber/10 border-amber/20 shadow-[0_0_20px_rgba(245,166,35,0.06)]",
      accentClass: "bg-amber",
      iconColor: "text-amber",
      icon: AlertTriangle,
      role: "alert"
    },
    info: {
      colorClass: "bg-accent/10 border-accent/20 shadow-[0_0_20px_rgba(91,111,255,0.06)]",
      accentClass: "bg-accent",
      iconColor: "text-accent",
      icon: Info,
      role: "status"
    }
  }

  const config = configByLevel[alert.level] || configByLevel.info
  const IconComponent = config.icon

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: -20, scale: 0.95, x: 20 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.9, x: 50, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 350, damping: 30 }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      role={config.role}
      aria-live={config.role === "alert" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto relative overflow-hidden flex flex-col w-full min-w-[320px] max-w-[400px]",
        "bg-surface/90 border backdrop-blur-md rounded-2xl transition-all duration-300",
        config.colorClass
      )}
    >
      <div className="flex gap-3.5 p-4 items-start relative z-10">
        {/* Left Side: Indicator Line & Icon */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className={cn("w-1 h-8 rounded-full", config.accentClass)} />
          <div className={cn("w-6 h-6 rounded-lg bg-surface/40 flex items-center justify-center shrink-0 border border-white/5 shadow-sm", config.iconColor)}>
            <IconComponent size={14} />
          </div>
        </div>

        {/* Center: Title and Message */}
        <div className="flex-grow min-w-0 pr-1 select-text">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h4 className="text-[11px] font-black uppercase tracking-wider text-text leading-tight truncate">
              {alert.title || (alert.level === 'error' ? 'Error' : 'System Notice')}
            </h4>
            <AnimatePresence mode="popLayout">
              {alert.count > 1 && (
                <motion.span
                  key={alert.count}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  className="bg-white/10 text-white border border-white/10 px-1.5 py-0.5 rounded-full text-[8px] font-black shrink-0 tracking-tight leading-none min-w-[16px] text-center"
                >
                  x{alert.count}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <p className="text-[10px] font-semibold text-dim mt-1 leading-relaxed break-words max-h-24 overflow-y-auto no-scrollbar">
            {alert.message}
          </p>
        </div>

        {/* Right Side: Accessible Close Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(alert.id)
          }}
          className={cn(
            "p-1.5 rounded-lg transition-all shrink-0 text-dim/60 hover:text-red hover:bg-white/5",
            "focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          )}
          aria-label={`Dismiss notification: ${alert.title || ''}`}
        >
          <X size={12} />
        </button>
      </div>

      {/* Bottom Progress Bar: Draining over time, pausing when hovered/focused */}
      <div className="h-[2px] w-full bg-white/5 absolute bottom-0 left-0 right-0 z-20">
        <div
          className={cn("h-full transition-all duration-[40ms] ease-linear", config.accentClass)}
          style={{ width: `${progress}%` }}
        />
      </div>
    </motion.div>
  )
}))
ToastItem.displayName = 'ToastItem'

export const GlobalToaster = React.memo(() => {
  return null;
})
GlobalToaster.displayName = 'GlobalToaster'
