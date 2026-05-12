import React from 'react'
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { CheckCircle2, AlertCircle, Loader2, Zap } from 'lucide-react'
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
export const StatCard = React.memo(({ label, value, color = "text-text", subValue }) => (
  <div className="bg-surface border border-border p-5 rounded-2xl shadow-sm hover:border-border-hover transition-colors group">
    <div className="text-[10px] text-dim tracking-widest mb-2 uppercase font-bold group-hover:text-dim/80 transition-colors">{label}</div>
    <div className={cn(
      "text-xl font-bold font-mono tracking-tight",
      color
    )}>{value}</div>
    {subValue && <div className="text-[10px] text-dim mt-1 font-mono uppercase">{subValue}</div>}
  </div>
))

// --- Section Label ---
export const SectionLabel = ({ children, className }) => (
  <div className={cn("text-[11px] text-dim tracking-widest mb-3 uppercase font-bold flex items-center gap-2", className)}>
    {children}
  </div>
)

// --- Button ---
export const Btn = ({ children, variant = "primary", onClick, className, disabled, loading, icon: Icon, ...props }) => {
  const variants = {
    success: "bg-green/10 text-green border border-green/20 hover:bg-green/20 shadow-[0_0_15px_rgba(0,229,160,0.1)]",
    danger: "bg-red/10 text-red border border-red/20 hover:bg-red/20 shadow-[0_0_15px_rgba(255,68,102,0.1)]",
    primary: "bg-accent text-white hover:bg-accent/90 shadow-[0_0_20px_rgba(91,111,255,0.2)]",
    ghost: "bg-transparent text-dim hover:text-text hover:bg-surface border border-border"
  }

  return (
    <button
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
}

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

// --- Paper Badge ---
export const PaperBadge = () => (
  <span className="px-2.5 py-1 rounded-full border border-amber/20 bg-amber/10 text-[10px] text-amber font-bold tracking-wider flex items-center gap-1.5">
    <Zap size={10} fill="currentColor" />
    PAPER
  </span>
)

// --- Condition Widget ---
export const ConditionWidget = React.memo(({ label, value, threshold, unit = "%", satisfied, sublabel }) => {
  const pct = Math.min((Math.abs(value) / (Math.max(Math.abs(threshold), 0.1) * 1.5)) * 100, 100);
  const colorClass = satisfied ? "bg-green" : "bg-amber";
  const textColorClass = satisfied ? "text-green" : "text-amber";
  const borderColorClass = satisfied ? "border-green/30 shadow-[0_0_15px_rgba(0,229,160,0.05)]" : "border-border";

  return (
    <div className={cn(
      "flex-1 bg-surface border rounded-2xl p-5 transition-all duration-500",
      borderColorClass
    )}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-[10px] text-dim tracking-widest mb-1.5 uppercase font-bold">{label}</div>
          <div className={cn("text-2xl font-bold font-mono tracking-tight", textColorClass)}>
            {value > 0 ? "+" : ""}{value.toFixed(2)}{unit}
          </div>
          {sublabel && <div className="text-[11px] text-dim mt-1.5 font-bold uppercase tracking-tight">{sublabel}</div>}
        </div>
        <div className="text-right">
          <div className="text-[10px] text-dim mb-1.5 font-bold uppercase tracking-widest">THRESHOLD</div>
          <div className="text-[14px] text-text font-mono font-bold">≥ {threshold}{unit}</div>
        </div>
      </div>

      <ProgressPrimitive.Root className="h-1.5 bg-border rounded-full overflow-hidden">
        <ProgressPrimitive.Indicator
          className={cn("h-full transition-all duration-700 ease-out", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </ProgressPrimitive.Root>

      <div className="mt-3.5 flex items-center gap-2">
        {satisfied ? (
          <CheckCircle2 size={14} className="text-green" />
        ) : (
          <AlertCircle size={14} className="text-amber" />
        )}
        <span className={cn("text-[11px] font-bold uppercase tracking-widest", textColorClass)}>
          {satisfied ? "Condition satisfied" : "Awaiting signal…"}
        </span>
      </div>
    </div>
  );
})

// --- P&L Bars ---
export const PnLBars = ({ trades }) => {
  if (!trades || trades.length === 0) return <div className="h-[60px] flex items-center justify-center text-[10px] text-dim font-bold uppercase tracking-widest">No Trade Data</div>
  const max = Math.max(...trades.map(t => Math.abs(t.pnl || 0)), 1);
  return (
    <div
      role="img"
      aria-label="Profit and Loss performance chart"
      className="flex items-end gap-1.5 h-[60px] px-1"
    >
      {trades.map((t, i) => {
        const pnl = t.pnl || 0;
        const h = Math.max(4, (Math.abs(pnl) / max) * 52);
        return (
          <div key={i} title={`${t.symbol}: ${pnl}`} className={cn(
            "flex-1 rounded-t-sm transition-all duration-300 hover:scale-y-110",
            pnl >= 0 ? "bg-green shadow-[0_0_10px_rgba(0,229,160,0.2)]" : "bg-red shadow-[0_0_10px_rgba(255,68,102,0.2)]"
          )} style={{ height: `${h}px` }} />
        );
      })}
    </div>
  );
}

// --- Sparkline ---
export const Sparkline = SparklineChart;
