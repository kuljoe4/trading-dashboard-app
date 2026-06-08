import React from 'react'
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { CheckCircle2, AlertCircle, Loader2, Zap, Copy } from 'lucide-react'
import { Sparkline as SparklineChart } from '../DataCharts'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

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

// --- Stat Card ---
export const StatCard = React.memo(({ label, value, color = "text-text", subValue, syncing }) => (
  <div
    className="bg-surface border border-border p-6 rounded-2xl shadow-sm hover:border-accent/30 hover:bg-white/[0.02] transition-all group relative overflow-hidden flex flex-col justify-center min-h-[110px]"
    role="region"
    aria-label={`${label}: ${value}`}
  >
    {syncing && (
      <div className="absolute inset-0 bg-accent/5 animate-pulse pointer-events-none" aria-label="Syncing data..." />
    )}
    <div className="text-[10px] text-dim tracking-[0.2em] mb-2 uppercase font-black group-hover:text-dim/80 transition-colors" aria-hidden="true">{label}</div>
    <div className={cn(
      "text-2xl font-bold font-mono tracking-tight transition-all duration-500",
      color,
      syncing && "opacity-40 blur-[1px]"
    )}>{value}</div>
    {subValue && (
      <div className={cn(
        "text-[10px] text-dim mt-2 font-mono font-bold uppercase flex items-center gap-1.5",
        syncing && "text-accent/60 animate-pulse"
      )}>
        {syncing && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
        {subValue}
      </div>
    )}
  </div>
))

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
        "px-5 py-2.5 rounded-xl font-bold text-[13px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95",
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

export const EcoBadge = () => (
  <span className="px-2.5 py-1 rounded-full border border-green/20 bg-green/10 text-[10px] text-green font-bold tracking-wider flex items-center gap-1.5 shadow-[0_0_10px_rgba(0,229,160,0.05)]">
    <div className="w-1.5 h-1.5 bg-green rounded-full animate-pulse" />
    ECO
  </span>
)

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

  return (
    <div
      className={cn(
        "flex-1 bg-surface border rounded-2xl p-6 transition-all duration-500",
        borderColorClass
      )}
      role="region"
      aria-label={`${label}: ${satisfied ? 'Satisfied' : 'Awaiting'}`}
    >
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="text-[11px] text-dim tracking-[0.15em] mb-2 uppercase font-bold">{label}</div>
          <div className={cn("text-2xl font-bold font-mono tracking-tight", textColorClass)}>
            {formattedValue}
          </div>
          {sublabel && <div className="text-[11px] text-dim mt-2 font-bold uppercase tracking-tight">{sublabel}</div>}
        </div>
        <div className="text-right">
          <div className="text-[10px] text-dim mb-2 font-bold uppercase tracking-[0.15em]">THRESHOLD</div>
          <div className="text-[14px] text-text font-mono font-bold">{thresholdText}</div>
        </div>
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
  if (!trades || trades.length === 0) return <div className="h-[60px] flex items-center justify-center text-[10px] text-dim font-bold uppercase tracking-widest">No Trade Data</div>

  const max = Math.max(...trades.map(t => Math.abs(t.pnl || 0)), 1);

  return (
    <div
      role="img"
      aria-label="Profit and Loss performance chart"
      className="relative flex items-center gap-1 h-[60px] px-1"
    >
      {/* Zero baseline */}
      <div className="absolute left-0 right-0 h-px bg-border/40 z-0 top-1/2" />

      {trades.map((t, i) => {
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

// --- Tooltip ---
export const Tooltip = ({ children, content, side = "top", align = "center", className }) => {
  if (!content) return children;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn(
            "z-[100] overflow-hidden rounded-lg bg-surface border border-border px-3 py-1.5 text-[10px] font-bold font-mono text-text shadow-xl animate-in fade-in zoom-in-95 duration-200",
            className
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-border" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
};

export const VisuallyHidden = ({ children }) => (
  <span className="absolute w-[1px] h-[1px] p-0 -m-[1px] overflow-hidden whitespace-nowrap border-0 clip-[rect(0,0,0,0)]">
    {children}
  </span>
)

// --- Copy Button ---
export const CopyButton = ({ value, className }) => {
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
    <Tooltip content={copied ? "Copied!" : "Copy"}>
      <button
        onClick={handleCopy}
        className={cn(
          "p-1.5 rounded-md transition-all active:scale-90",
          copied ? "text-green bg-green/10" : "text-dim hover:text-text hover:bg-white/5",
          className
        )}
        aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
      >
        {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
      </button>
    </Tooltip>
  )
}

// --- Sparkline ---
export const Sparkline = SparklineChart;
