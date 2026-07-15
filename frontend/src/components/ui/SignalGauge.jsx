import React from 'react'
import { motion } from 'framer-motion'
import { cn, Tooltip } from './primitives'
import { Zap, Activity, Clock, CheckCircle2 } from 'lucide-react'

export const SignalGauge = React.memo(({
  label,
  value,
  threshold,
  unit,
  fired,
  active,
  remainingDelay,
  configDelay,
  insufficientData,
  thresholdIsPrice,
  isLong,
  entryPrice,
  markPrice,
  qty,
  riskUsdt,
  type = 'entry' // 'entry' or 'exit'
}) => {
  const isFired = fired && active
  const isDelayed = remainingDelay > 0 && !isFired

  const numValue = Number(value) || 0
  const numThreshold = Number(threshold) || 0

  // Calculate progress/convergence
  let progress = 0
  if (!insufficientData) {
    if (isFired) {
      progress = 100
    } else if (thresholdIsPrice && entryPrice && markPrice) {
      const totalDist = isLong ? (numThreshold - entryPrice) : (entryPrice - numThreshold)
      const progressDist = isLong ? (markPrice - entryPrice) : (entryPrice - markPrice)
      if (totalDist > 0) {
        progress = Math.max(0, Math.min(100, (progressDist / totalDist) * 100))
      }
    } else if (numThreshold !== 0) {
      progress = Math.max(0, Math.min(100, (Math.abs(numValue) / Math.abs(numThreshold)) * 100))
    }
  }

  const getStatus = () => {
    if (insufficientData) return { label: 'Collecting', color: 'text-dim bg-background/50 border-border/40' }
    if (isFired) return { label: 'Triggered', color: 'text-white bg-red border-red/20 shadow-lg shadow-red/20' }
    if (isDelayed) return { label: 'Delayed', color: 'text-amber bg-amber/20 border-amber/30' }
    if (fired) return { label: 'Met', color: 'text-amber bg-amber/20 border-amber/30' }
    if (progress > 80) return { label: 'Near', color: 'text-accent bg-accent/10 border-accent/20' }
    return { label: 'Watching', color: 'text-dim bg-background/50 border-border/40' }
  }

  const status = getStatus()

  // Estimated PnL / RR for exit signals
  const estPnl = (thresholdIsPrice && entryPrice && qty)
    ? (numThreshold - entryPrice) * qty * (isLong ? 1 : -1)
    : null
  const estRr = (estPnl !== null && riskUsdt > 0) ? (estPnl / riskUsdt) : null

  const content = (
    <div className={cn(
      "relative overflow-hidden p-3 rounded-xl border transition-all duration-500",
      isFired ? "bg-red/5 border-red/40" : fired ? "bg-amber/5 border-amber/30" : "bg-background/30 border-border/80"
    )}>
      <div className="flex justify-between items-start mb-2.5">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center border transition-all duration-500",
            isFired ? "bg-red text-white border-red/30" : fired ? "bg-amber text-white border-amber/20" : "bg-surface border-border/80 text-dim"
          )}>
            {isFired ? <Zap size={14} fill="currentColor" /> : <Activity size={14} />}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black uppercase tracking-tight">{label}</span>
              {isDelayed && (
                <div className="flex items-center gap-1 text-amber bg-amber/10 px-1 py-0.5 rounded border border-amber/20 text-[8px] font-black">
                  <Clock size={8} />
                  <span>{Math.ceil(remainingDelay)}s</span>
                </div>
              )}
            </div>
            <span className="text-[9px] text-dim font-bold uppercase tracking-tight opacity-70">
              {insufficientData ? 'Collecting data...' : `Target: ${numThreshold}${unit}`}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className={cn("text-sm font-mono font-black tracking-tighter leading-none", isFired ? "text-red" : fired ? "text-amber" : "text-text")}>
            {insufficientData ? '---' : Number(numValue).toFixed(numValue >= 100 ? 2 : 4)}
            <span className="text-[9px] ml-0.5 opacity-40 font-bold">{unit}</span>
          </div>
          <div className={cn("mt-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border", status.color)}>
            {status.label}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-end px-1">
          <span className="text-[8px] font-black text-dim uppercase tracking-widest">Convergence</span>
          <span className={cn("text-[9px] font-mono font-black", fired ? "text-green" : "text-text/80")}>
            {insufficientData ? '0.0' : Number(progress).toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 bg-background/80 rounded-full overflow-hidden relative border border-white/5">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: "spring", stiffness: 40, damping: 20 }}
            className={cn(
              "absolute top-0 left-0 h-full rounded-full transition-colors duration-700",
              isFired ? "bg-red" : fired ? "bg-amber" : "bg-accent"
            )}
          />
        </div>
      </div>

      {type === 'exit' && (estPnl !== null || estRr !== null) && (
        <div className="mt-3 pt-3 border-t border-border/40 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-dim/60">
          <div className="flex items-center gap-3">
            {estPnl !== null && (
              <div className="flex items-center gap-1.5">
                <span className="opacity-40">Est. PnL:</span>
                <span className={cn("font-mono", estPnl >= 0 ? "text-green" : "text-red")}>
                  {estPnl >= 0 ? '+' : '-'}${Number(Math.abs(estPnl)).toFixed(2)}
                </span>
              </div>
            )}
            {estRr !== null && (
              <div className="flex items-center gap-1.5">
                <span className="opacity-40">Est. RR:</span>
                <span className="font-mono text-text/80">{Number(estRr).toFixed(2)}R</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Tooltip content={status.label === 'Triggered' ? 'Signal Active' : 'Waiting for convergence'}>
      {content}
    </Tooltip>
  );
})
SignalGauge.displayName = 'SignalGauge'
