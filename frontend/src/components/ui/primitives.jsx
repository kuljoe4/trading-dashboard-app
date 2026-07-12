import React from 'react'
import { motion } from 'framer-motion'
import { cn } from "./utils"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { CheckCircle2, AlertCircle, Loader2, Zap, Copy, ChevronLeft, Plus, Minus, Lock, Unlock, Info, RefreshCw } from 'lucide-react'
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
                "w-10 h-10 rounded-lg border flex items-center justify-center transition-all active:scale-90",
                isLocked
                  ? "bg-transparent border-transparent text-dim/20"
                  : "bg-background border-border text-dim hover:text-text hover:border-accent/40 shadow-sm"
              )}
              aria-label={isLocked ? "Tap to unlock" : `Decrease ${label}`}
            >
              <Minus size={20} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleAction(onIncrement); }}
              disabled={!isLocked && value >= max}
              className={cn(
                "w-10 h-10 rounded-lg border flex items-center justify-center transition-all active:scale-90",
                isLocked
                  ? "bg-transparent border-transparent text-dim/20"
                  : "bg-background border-border text-dim hover:text-text hover:border-accent/40 shadow-sm"
              )}
              aria-label={isLocked ? "Tap to unlock" : `Increase ${label}`}
            >
              <Plus size={20} />
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
export const StatCard = React.memo(({ label, value, color = "text-text", subValue, syncing, tooltipText }) => {
  // BOLT: Clean up double-negative visuals: if value starts with '-', don't show negative arrow in label/icon.
  const sanitizedValue = typeof value === 'string' && (value.includes('▼') || value.includes('▲') || value.includes('▾') || value.includes('▴')) && value.includes('-')
    ? value.replace('-', '') // Remove the minus if an arrow is already present
    : value;

  const content = (
    <div
      className="bg-surface border border-border/60 p-3 md:p-4 lg:p-5 rounded-2xl shadow-sm hover:border-accent/30 hover:bg-white/[0.01] transition-all group relative overflow-hidden flex flex-col items-start min-h-[64px] md:min-h-[80px] lg:min-h-[100px] min-w-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      role="region"
      aria-label={`${label}: ${value}${tooltipText ? '. ' + tooltipText : ''}`}
      aria-busy={syncing}
    >
      {syncing && (
        <div className="absolute inset-0 bg-accent/5 animate-pulse pointer-events-none" aria-label="Syncing data..." />
      )}
      <div className="flex flex-col gap-0.5 w-full">
        <div className="flex items-start gap-1.5 min-h-[2rem] md:min-h-[2.25rem]">
            <div className="text-[9px] md:text-[10px] text-dim tracking-[0.15em] uppercase font-black leading-[1.1] flex-1" aria-hidden="true">{label}</div>
            {tooltipText && <Info size={10} className="text-dim/30 group-hover:text-accent transition-colors" />}
        </div>
        <div className="flex flex-col">
          <div className={cn(
            "text-sm md:text-base lg:text-xl font-black font-mono tracking-tighter transition-all duration-500 truncate",
            color,
            syncing && "opacity-40 blur-[1px]"
          )}>{sanitizedValue}</div>
          {subValue && (
            <div className={cn(
              "text-[8px] md:text-[9px] text-dim font-mono font-black uppercase flex items-center gap-1.5 whitespace-nowrap overflow-hidden",
              syncing && "text-accent/60 animate-pulse"
            )}>
              {syncing && <Loader2 size={8} className="animate-spin shrink-0" aria-hidden="true" />}
              <span className="truncate">{subValue}</span>
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
      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold tracking-wider transition-all",
      active
        ? "text-green bg-green/10 border-green/20 shadow-[0_0_10px_rgba(0,229,160,0.05)]"
        : "text-dim bg-surface border-border"
    )}>
      {active && <PulseDot color="bg-green" />}
      {active ? "LIVE" : "STOPPED"}
    </span>
  )
}

// --- Mode Badges ---
export const PaperBadge = () => (
  <span className="px-2.5 py-1 rounded-full border border-amber/20 bg-amber/10 text-[10px] text-amber font-bold tracking-wider flex items-center gap-1.5">
    <Zap size={10} fill="currentColor" />
    PAPER
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
      "px-2.5 py-1 rounded-full border text-[10px] font-bold tracking-wider flex items-center gap-1.5 transition-colors",
      showResumingFeedback ? "border-accent/30 bg-accent/10 text-accent shadow-[0_0_15px_rgba(91,111,255,0.1)]" : "border-green/20 bg-green/10 text-green shadow-[0_0_10px_rgba(0,229,160,0.05)]"
    )}>
      {showResumingFeedback ? (
        <RefreshCw size={10} className="animate-spin" />
      ) : (
        <div className="w-1.5 h-1.5 bg-green rounded-full animate-pulse" />
      )}
      {showResumingFeedback ? 'RESUMING' : 'ECO'}
    </span>
  );
}

export const DemoBadge = () => (
  <span className="px-2.5 py-1 rounded-full border border-purple/20 bg-purple/10 text-[10px] text-purple font-bold tracking-wider flex items-center gap-1.5">
    <Zap size={10} fill="currentColor" />
    DEMO
  </span>
)

export const LiveBadge = () => (
  <span className="px-2.5 py-1 rounded-full border border-green/20 bg-green/10 text-[10px] text-green font-bold tracking-wider flex items-center gap-1.5">
    <Zap size={10} fill="currentColor" />
    LIVE
  </span>
)

// --- Condition Widget ---
export const ConditionWidget = React.memo(({ label, value, threshold, unit = "%", satisfied, sublabel }) => {
  const absThreshold = Math.max(Math.abs(threshold), 0.0001);
  const pct = threshold !== 0
    ? Math.min((Math.abs(value) / (absThreshold * 1.5)) * 100, 100)
    : Math.min(value > 0 ? 100 : 0, 100);
  const colorClass = satisfied ? "bg-green" : "bg-amber";
  const textColorClass = satisfied ? "text-green" : "text-amber";
  const borderColorClass = satisfied ? "border-green/30 shadow-[0_0_15px_rgba(0,229,160,0.05)]" : "border-border";

  const isCount = unit.includes('/') || unit.includes('signals');
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

  const max = Math.max(...safeTrades.map(t => Math.abs(t.pnl || 0)), 1);

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
  const { config, wsStatus, isThrottled, isEcoMode, isSyncingOnResume, sessionActive } = useTradingStore()
  const tradingMode = config.trading_mode || 'paper'

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = propsResuming ?? (sessionActive && isResuming)

  return (
    <div className={cn(
      "z-40 transition-all duration-300 mb-4 lg:mb-6",
      sticky && "sticky top-0 bg-background/90 backdrop-blur-md py-1.5 -mx-4 px-4 md:-mx-10 md:px-10 border-b border-border/10 shadow-sm"
    )}>
      <div className="flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {backAction && (
            <button
              onClick={backAction}
              aria-label="Go back"
              className="p-1 hover:bg-surface border border-border rounded-lg transition-all active:scale-90 group shrink-0"
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
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-xs md:text-sm font-black tracking-tight truncate uppercase">{showResumingFeedback ? 'Resuming...' : title}</h1>
                <div className="hidden sm:flex items-center gap-1.5 shrink-0 scale-[0.8] origin-left">
                  {tradingMode === 'paper' && <PaperBadge />}
                  {tradingMode === 'testnet' && <DemoBadge />}
                  {tradingMode === 'live' && <LiveBadge />}
                  {(isThrottled || isEcoMode || wsStatus !== 'live') && <EcoBadge />}
                </div>
              </div>
              {subTitle && (
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-[9px] text-dim font-bold uppercase tracking-widest truncate opacity-80">
                    {subTitle}
                  </p>
                  <div className="hidden lg:flex items-center gap-1.5 shrink-0 opacity-40 scale-[0.8] origin-left">
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
        <div className="flex items-center gap-2 shrink-0 scale-90 origin-right">
          {children}
        </div>
      </div>
    </div>
  )
}

// --- Copy Button ---
export const CopyButton = React.memo(({ value, className, tooltip = "Copy", successTooltip = "Copied!" }) => {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
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
          "p-1.5 rounded-md transition-all active:scale-90",
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
