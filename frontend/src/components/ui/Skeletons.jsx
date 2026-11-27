import React from 'react'
import { cn } from './utils'
import { useSelectedEngine } from '../../hooks/useSelectedEngine'
import { EngineSwitch } from '../EngineSwitch'

/**
 * Base GPU-composited zero-CLS shimmer block.
 * Respects prefers-reduced-motion and low-glare mode via CSS `.skeleton-shimmer`.
 */
export const SkeletonBlock = ({ className = '', style }) => (
  <div
    aria-hidden="true"
    style={style}
    className={cn(
      'rounded-md bg-surface/70 border border-border/25 skeleton-shimmer motion-reduce:animate-none',
      className
    )}
  />
)

/**
 * Internal helper: Renders real static metric card border & static uppercase label
 * while placing shimmer ONLY on dynamic numeric values/subvalues.
 */
const StaticMetricSkeletonCard = ({
  label,
  compact = true,
  hasSubValue = false,
  valueWidth = 'w-20',
  subWidth = 'w-24',
}) => (
  <div
    className={cn(
      'bg-surface border border-border rounded-xl flex flex-col items-start justify-between h-full w-full min-w-0',
      compact ? 'p-2.5 min-h-[48px] md:min-h-[56px]' : 'p-3.5 md:p-4 min-h-[64px] md:min-h-[76px]'
    )}
  >
    <span
      className={cn(
        'text-dim tracking-wider uppercase font-bold leading-snug truncate w-full',
        compact ? 'text-[8.5px] md:text-[9px]' : 'text-[9px] md:text-[10px]'
      )}
    >
      {label}
    </span>
    <div className="flex flex-col items-start w-full min-w-0 mt-auto pt-1.5">
      <SkeletonBlock className={cn(compact ? 'h-4 md:h-[18px]' : 'h-5 md:h-6', valueWidth)} />
      {hasSubValue && (
        <SkeletonBlock className={cn('h-2.5 mt-1.5 opacity-65', subWidth)} />
      )}
    </div>
  </div>
)

const readSkeletonPref = (key, fallback) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key)
      return val !== null ? val : fallback
    }
  } catch (_) {}
  return fallback
}

/**
 * Pixel-matched skeleton chrome mirroring ViewHeader Row 1 + Row 2 so loading -> live view transitions cause 0px header CLS.
 */
const ViewHeaderSkeleton = ({
  title,
  subTitle,
  hasBack = false,
  hasIcon = false,
  hasMetricsRow = true,
  rightSlot = null,
}) => (
  <>
    <div
      className={cn(
        'py-1 sm:py-1.5 px-2.5 sm:px-3 bg-background/60 border-b border-border/20',
        hasMetricsRow ? 'mb-0 rounded-t-2xl' : 'mb-1.5 md:mb-2 rounded-2xl'
      )}
    >
      <div className="flex flex-row items-center justify-between gap-1.5 sm:gap-2 relative w-full min-h-[34px] sm:min-h-[34px] sm:h-[34px] flex-nowrap h-[34px] min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
          {hasBack && (
            <div className="min-h-[34px] min-w-[34px] sm:min-h-[32px] sm:min-w-[32px] p-1 border border-border/60 rounded-xl flex items-center justify-center shrink-0 text-dim text-xs font-bold">
              ←
            </div>
          )}
          {hasIcon && (
            <div
              className={cn(
                'w-6 h-6 sm:w-7 sm:h-7 rounded-xl bg-accent/10 border border-accent/20 items-center justify-center shrink-0',
                hasBack ? 'hidden sm:flex' : 'flex'
              )}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-accent/40" />
            </div>
          )}
          <div className="flex flex-col justify-center min-w-0 flex-1 h-[34px]">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 h-[18px] flex-nowrap">
              {title ? (
                <h1 className="font-black tracking-tight truncate uppercase text-text min-w-0 leading-none text-[12.5px] sm:text-xs md:text-sm">
                  {title}
                </h1>
              ) : (
                <SkeletonBlock className="w-32 sm:w-44 h-4 rounded" />
              )}
            </div>
            {subTitle && (
              <div className={cn('items-center gap-2 min-w-0 h-[14px]', !hasBack ? 'flex' : 'hidden sm:flex')}>
                <p className="text-[8.5px] sm:text-[9px] text-dim font-bold uppercase tracking-wider sm:tracking-widest truncate opacity-80 leading-none">
                  {subTitle}
                </p>
              </div>
            )}
          </div>
        </div>
        {rightSlot && (
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 justify-end flex-nowrap">
            {rightSlot}
          </div>
        )}
      </div>
    </div>
    {hasMetricsRow && (
      <div className="relative w-full h-[26px] sm:h-[28px] mb-1.5 lg:mb-2 py-0.5 px-2.5 sm:px-3 flex items-center rounded-b-2xl border-b border-border/20 bg-background/60">
        <div className="flex items-center justify-between gap-2 flex-nowrap min-h-[22px] h-[22px] w-full">
          <div className="flex items-center gap-1.5 sm:gap-2 font-mono text-[9px] sm:text-[9.5px] tabular-nums font-bold min-w-0 truncate">
            <span className="w-2 h-2 rounded-full bg-accent/60 shrink-0" />
            <span className="text-[8.5px] uppercase tracking-wider text-dim font-bold">Syncing Feed</span>
            <span className="text-border/40 select-none">|</span>
            <span className="text-[8.5px] uppercase tracking-wider text-dim opacity-60 font-sans">GATE</span>
            <SkeletonBlock className="w-10 h-2.5 rounded opacity-65" />
          </div>
        </div>
      </div>
    )}
  </>
)

/**
 * Matches StrategyDetailView geometry (ViewHeader + 4 KPI cards + tab bar + Inspect Live + 4 dial cards).
 */
export const StrategyDetailSkeleton = () => (
  <div
    className="max-w-[1300px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-5 md:pt-5 lg:px-6 lg:pt-6 pb-36 lg:pb-16"
    role="status"
    aria-busy="true"
    aria-label="Loading strategy details"
  >
    <ViewHeaderSkeleton
      title={null}
      subTitle="Base Strategy"
      hasBack={true}
      hasIcon={true}
      hasMetricsRow={false}
      rightSlot={
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-nowrap">
          <div className="hidden sm:flex h-8 px-3 rounded-xl border border-border bg-surface items-center text-[11px] font-semibold text-dim">
            Scanner
          </div>
          <div className="h-8 px-3 rounded-xl border border-border bg-surface flex items-center text-[11px] font-semibold text-dim">
            Config
          </div>
        </div>
      }
    />

    {/* 4 KPI cards with real static labels */}
    <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-fr items-stretch gap-2 sm:gap-2.5 mb-3">
      <StaticMetricSkeletonCard label="Active P&L" hasSubValue valueWidth="w-24" subWidth="w-28" />
      <StaticMetricSkeletonCard label="Exposure & Slots" hasSubValue valueWidth="w-24" subWidth="w-24" />
      <StaticMetricSkeletonCard label="Win Rate" hasSubValue valueWidth="w-16" subWidth="w-28" />
      <StaticMetricSkeletonCard label="Profit Factor" hasSubValue valueWidth="w-16" subWidth="w-20" />
    </div>

    {/* Static 3-tab strip */}
    <div className="h-[42px] w-full sm:w-[340px] rounded-xl bg-surface/60 border border-border/50 p-1 grid grid-cols-3 gap-1 mb-3">
      {['Signals', 'Performance', 'History'].map((tab, idx) => (
        <div
          key={tab}
          className={cn(
            'h-full rounded-lg flex items-center justify-center text-[11px] font-bold uppercase tracking-wider',
            idx === 0 ? 'bg-accent/15 text-accent border border-accent/25' : 'text-dim'
          )}
        >
          {tab}
        </div>
      ))}
    </div>

    {/* Inspect Live + Condition Cards panel */}
    <div className="rounded-2xl bg-surface/45 border border-border/50 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-border/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text">Inspect Live</span>
          <SkeletonBlock className="w-20 h-5 rounded-md opacity-70" />
        </div>
        <SkeletonBlock className="w-20 h-5 rounded-md opacity-70" />
      </div>
      <div className="p-3.5">
        <ConditionCardsSkeleton count={4} />
      </div>
    </div>
  </div>
)

/**
 * Matches CandidateConditionsGauge dial cards grid (`min-h-[168px]` / `min-h-[120px]` compact) with 0 CLS.
 */
export const ConditionCardsSkeleton = ({ compact = false, count = 4 }) => {
  const safeCount = Math.max(1, Math.min(4, count))
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Syncing live signal conditions"
      className={cn(
        'grid auto-rows-fr items-stretch gap-2.5',
        compact
          ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-h-[120px]'
          : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 min-h-[168px]'
      )}
    >
      {Array.from({ length: safeCount }).map((_, idx) => (
        <div
          key={idx}
          className="relative overflow-hidden rounded-xl border border-border/40 bg-surface/40 p-2.5 flex flex-col justify-between gap-2 min-h-[168px]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono uppercase text-dim font-semibold">Signal</span>
                <SkeletonBlock className="w-20 h-3.5 rounded" />
              </div>
              <SkeletonBlock className="w-24 h-2.5 rounded opacity-65" />
            </div>
            <SkeletonBlock className="w-14 h-4 rounded-full shrink-0" />
          </div>

          {/* Semicircular dial silhouette */}
          <div className="flex justify-center items-center py-1">
            <div className="w-[104px] h-[54px] rounded-t-full border-t-[7px] border-x-[7px] border-border/45 bg-transparent relative overflow-hidden skeleton-shimmer">
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-10 h-3 rounded bg-surface/80" />
            </div>
          </div>

          {/* Static labels + dynamic readout values */}
          <div className="rounded-lg bg-bg/40 border border-border/30 px-2.5 py-1.5 flex items-center justify-between gap-2">
            <span className="text-[9px] font-mono uppercase text-dim">Live</span>
            <SkeletonBlock className="w-16 h-3 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Matches ScannerOverlay 5-column desktop (`md:grid-cols-[28px_1.5fr_1fr_1.2fr_110px]`) and mobile row structure.
 */
export const ScannerRowsSkeleton = ({ rows = 6, showHeader = true, label = 'Loading scanner candidates' }) => (
  <div
    className="w-full flex flex-col flex-1 min-h-0"
    role="status"
    aria-busy="true"
    aria-label={label}
  >
    {showHeader && (
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-text">Live Market Scanner</div>
          <div className="text-[10px] text-dim font-mono">Scanning candidate momentum</div>
        </div>
        <SkeletonBlock className="w-24 h-7 rounded-lg hidden sm:block" />
      </div>
    )}
    <div className="divide-y divide-border/25 flex-1 overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="px-4 py-3 grid grid-cols-[1fr_auto] md:grid-cols-[28px_1.5fr_1fr_1.2fr_110px] items-center gap-3 min-h-[56px]"
        >
          <span className="hidden md:block text-[10px] font-mono text-dim tabular-nums">#{i + 1}</span>
          <div className="flex items-center gap-2.5 min-w-0">
            <SkeletonBlock className="w-20 h-4 rounded" />
            <SkeletonBlock className="w-12 h-4 rounded-full opacity-70" />
          </div>
          <div className="hidden md:flex items-center gap-2">
            <SkeletonBlock className="w-16 h-3.5 rounded" />
            <SkeletonBlock className="w-12 h-3 rounded opacity-65" />
          </div>
          <div className="hidden md:flex items-center gap-2">
            <SkeletonBlock className="w-24 h-2 rounded-full" />
            <SkeletonBlock className="w-10 h-3 rounded opacity-70" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <SkeletonBlock className="w-16 h-6 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  </div>
)

/**
 * Matches ScannerPreview's 5 pre-allocated rows (`min-h-[36px] sm:h-[38px]`) for zero CLS while warming up.
 */
export const ScannerPreviewRowsSkeleton = ({ rows = 5 }) => (
  <div
    className="flex flex-col divide-y divide-border/20 w-full"
    role="status"
    aria-busy="true"
    aria-label="Scanning market pairs"
  >
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="flex items-center justify-between gap-2 px-2.5 sm:px-3 min-h-[36px] sm:h-[38px]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <SkeletonBlock className="w-16 h-3 rounded" />
          <SkeletonBlock className="w-10 h-3 rounded opacity-60" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SkeletonBlock className="w-14 h-3 rounded opacity-70 hidden sm:block" />
          <SkeletonBlock className="w-12 h-3.5 rounded" />
        </div>
      </div>
    ))}
  </div>
)

/**
 * Matches DecisionLog filter strip + 5 log rows inside DashboardView collapsible logs.
 */
export const DecisionLogSkeleton = ({ rows = 5 }) => (
  <div
    className="w-full space-y-2.5 p-2"
    role="status"
    aria-busy="true"
    aria-label="Loading session logs"
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        {['All', 'Info', 'Warn', 'Error'].map((lvl, idx) => (
          <span
            key={lvl}
            className={cn(
              'px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider',
              idx === 0 ? 'bg-accent/15 border-accent/35 text-accent' : 'bg-surface border-border/50 text-dim'
            )}
          >
            {lvl}
          </span>
        ))}
      </div>
      <div className="h-7 px-3 rounded-lg border border-border/50 bg-background/50 flex items-center text-[10px] text-dim font-mono">
        Filter logs...
      </div>
    </div>
    <div className="rounded-xl border border-border/35 bg-surface/25 divide-y divide-border/25 overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-3 py-2.5 flex items-center justify-between gap-3 h-[42px]">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <SkeletonBlock className="w-14 h-3 rounded shrink-0 opacity-65" />
            <SkeletonBlock className="w-16 h-4 rounded shrink-0" />
            <SkeletonBlock className="w-48 sm:w-72 h-3 rounded opacity-75" />
          </div>
          <SkeletonBlock className="w-12 h-3 rounded shrink-0 opacity-60" />
        </div>
      ))}
    </div>
  </div>
)

/**
 * Matches Recharts / SVG performance chart containers with realistic axes & bars (no bare spinner).
 */
export const ChartPanelSkeleton = ({ height = 220, label = 'Loading performance chart' }) => {
  const barHeights = [34, 52, 42, 68, 58, 76, 48, 64, 82, 56, 72, 62]
  return (
    <div
      style={{ height }}
      role="status"
      aria-busy="true"
      aria-label={label}
      className="w-full rounded-xl bg-surface/30 border border-border/35 px-4 py-3 flex flex-col justify-between relative overflow-hidden skeleton-shimmer"
    >
      {/* Top micro-legend placeholder */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="w-20 h-2.5 rounded opacity-70" />
          <SkeletonBlock className="w-14 h-2.5 rounded opacity-50" />
        </div>
        <SkeletonBlock className="w-16 h-2.5 rounded opacity-55" />
      </div>

      {/* Horizontal gridlines + vertical bar silhouettes */}
      <div className="relative flex-1 my-2.5 flex items-end gap-1.5 sm:gap-2.5 px-1">
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
          <div className="w-full border-t border-border/25" />
          <div className="w-full border-t border-border/20" />
          <div className="w-full border-t border-border/20" />
          <div className="w-full border-t border-border/30" />
        </div>
        {barHeights.map((pct, i) => (
          <div
            key={i}
            style={{ height: `${pct}%` }}
            className="flex-1 rounded-t bg-surface/75 border-t border-x border-border/30"
          />
        ))}
      </div>

      {/* Bottom X-axis ticks */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <SkeletonBlock className="w-10 h-2 rounded opacity-55" />
        <SkeletonBlock className="w-10 h-2 rounded opacity-55" />
        <SkeletonBlock className="w-10 h-2 rounded opacity-55 hidden sm:block" />
        <SkeletonBlock className="w-10 h-2 rounded opacity-55" />
      </div>
    </div>
  )
}

/**
 * Matches StrategyCalendarPnL 7-column daily calendar breakdown (`h-[120px]`).
 */
export const CalendarGridSkeleton = () => (
  <div
    role="status"
    aria-busy="true"
    aria-label="Loading daily calendar breakdown"
    className="w-full min-h-[120px] rounded-xl bg-surface/30 border border-border/35 p-3 space-y-2"
  >
    <div className="grid grid-cols-7 gap-1.5 text-center">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
        <span key={day} className="text-[9px] font-bold uppercase tracking-wider text-dim">
          {day}
        </span>
      ))}
    </div>
    <div className="grid grid-cols-7 gap-1.5">
      {Array.from({ length: 14 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-9 rounded-lg" />
      ))}
    </div>
  </div>
)

/**
 * Matches TradeDetailView (`max-w-[1200px]`, ViewHeader + 4 KPI StatCards + 2-col tactical panels).
 * Keeps static headings and metric labels visible while dynamic telemetry shimmers.
 */
export const TradeDetailSkeleton = () => (
  <div
    className="max-w-[1200px] mx-auto px-4 pt-4 md:px-8 md:pt-8 pb-36 lg:pb-16"
    role="status"
    aria-busy="true"
    aria-label="Loading trade details"
  >
    <ViewHeaderSkeleton
      title={null}
      subTitle="Position Telemetry"
      hasBack={true}
      hasMetricsRow={true}
      rightSlot={
        <div className="flex items-center gap-1.5 h-8">
          <SkeletonBlock className="w-12 h-4 rounded-full" />
          <SkeletonBlock className="w-12 h-4 rounded-full opacity-75" />
        </div>
      }
    />

    <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-fr items-stretch gap-3 mb-4">
      <StaticMetricSkeletonCard label="Unrealized P&L" compact={false} valueWidth="w-24" />
      <StaticMetricSkeletonCard label="Reward : Risk" compact={false} valueWidth="w-20" />
      <StaticMetricSkeletonCard label="Position Size" compact={false} valueWidth="w-24" />
      <StaticMetricSkeletonCard label="Stop Distance" compact={false} valueWidth="w-20" />
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="h-[220px] rounded-2xl bg-surface/45 border border-border/45 p-4 flex flex-col justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-dim">Price & Risk Ladder</span>
        <SkeletonBlock className="w-full h-24 rounded-xl opacity-75" />
        <div className="flex justify-between text-[10px] font-mono text-dim">
          <span>Entry Price</span>
          <span>Stop Loss</span>
        </div>
      </div>
      <div className="h-[220px] rounded-2xl bg-surface/45 border border-border/45 p-4 space-y-3">
        <span className="text-[11px] font-bold uppercase tracking-widest text-dim block">Signal & Execution Context</span>
        {['Strategy', 'Side', 'Duration', 'Fee Impact'].map((fieldLabel) => (
          <div key={fieldLabel} className="flex items-center justify-between text-xs">
            <span className="text-dim">{fieldLabel}</span>
            <SkeletonBlock className="w-20 h-3 rounded" />
          </div>
        ))}
      </div>
    </div>
  </div>
)

/**
 * Matches ActiveTradeCard stacked layout during session resume/hydration (keeps static cell labels visible).
 */
export const ActiveTradesSkeleton = ({ count = 2 }) => (
  <div
    className="grid gap-4 grid-cols-1"
    role="status"
    aria-busy="true"
    aria-label="Synchronizing active positions"
  >
    {Array.from({ length: count }).map((_, idx) => (
      <div
        key={idx}
        className="rounded-2xl bg-surface/50 border border-border/50 p-4 space-y-3 min-h-[146px]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <SkeletonBlock className="w-24 h-4 rounded" />
            <SkeletonBlock className="w-12 h-4 rounded-full opacity-75" />
            <SkeletonBlock className="w-20 h-3.5 rounded opacity-60 hidden sm:block" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBlock className="w-20 h-5 rounded" />
            <SkeletonBlock className="w-16 h-7 rounded-lg opacity-75" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {['Entry', 'Mark Price', 'Stop Loss', 'Risk / Target'].map((metricLabel) => (
            <div key={metricLabel} className="rounded-lg bg-bg/40 border border-border/25 p-2 space-y-1.5">
              <span className="text-[9px] uppercase tracking-wider text-dim font-bold block">{metricLabel}</span>
              <SkeletonBlock className="w-20 h-3.5 rounded" />
            </div>
          ))}
        </div>
        <SkeletonBlock className="w-full h-2.5 rounded-full opacity-70" />
      </div>
    ))}
  </div>
)

/**
 * Matches HistoryView SessionGroup accordion cards while initial sessions & trades are loading.
 */
export const HistorySessionsSkeleton = ({ count = 3 }) => (
  <div
    className="flex flex-col gap-3"
    role="status"
    aria-busy="true"
    aria-label="Loading trading session history"
  >
    {Array.from({ length: count }).map((_, idx) => (
      <div
        key={idx}
        className="rounded-2xl bg-surface/50 border border-border/45 px-4 py-3.5 min-h-[76px] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <SkeletonBlock className="w-8 h-8 rounded-lg shrink-0" />
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2">
              <SkeletonBlock className="w-32 h-3.5 rounded" />
              <SkeletonBlock className="w-14 h-4 rounded-full opacity-75" />
            </div>
            <SkeletonBlock className="w-44 h-2.5 rounded opacity-60" />
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6 shrink-0">
          <div className="space-y-1">
            <span className="text-[9px] uppercase tracking-wider text-dim font-bold block">Trades</span>
            <SkeletonBlock className="w-12 h-3.5 rounded" />
          </div>
          <div className="space-y-1">
            <span className="text-[9px] uppercase tracking-wider text-dim font-bold block">Net P&L</span>
            <SkeletonBlock className="w-16 h-3.5 rounded" />
          </div>
          <SkeletonBlock className="w-6 h-6 rounded-lg opacity-70" />
        </div>
      </div>
    ))}
  </div>
)

/**
 * Matches DashboardView (Overview) geometry:
 * Renders real static Overview header, real interactive Live|Paper EngineSwitch (never skeletonized),
 * real Global Metrics labels/toolbar with value-only shimmers, and dynamic Strategy card telemetry placeholders.
 */
export const DashboardSkeleton = () => {
  const selectedEngine = useSelectedEngine()
  const expanded = readSkeletonPref('global_metrics_expanded', 'false') === 'true'
  const cardViewMode = readSkeletonPref('dashboard_card_view_mode', 'detailed')
  return (
    <div
      className="max-w-[1600px] mx-auto px-2.5 pt-1.5 sm:px-4 sm:pt-2.5 lg:px-5 lg:pt-2.5 pb-36 lg:pb-16"
      role="status"
      aria-busy="true"
      aria-label="Loading cockpit overview"
    >
      <ViewHeaderSkeleton
        title="Overview"
        subTitle="Real-time strategy management & market oversight"
        hasMetricsRow={true}
        rightSlot={
          <span className="h-7 min-w-[28px] px-2 rounded-lg border border-border/60 bg-surface text-[9px] font-bold uppercase tracking-widest text-dim inline-flex items-center justify-center">
            <span className="hidden md:inline">Eco Mode</span>
          </span>
        }
      />

      {/* Static EngineSwitch remains untouched and interactive between Live & Paper transitions */}
      {selectedEngine && (
        <div className="mb-1.5 sm:mb-2">
          <EngineSwitch running={null} />
        </div>
      )}

      {/* Global Metrics Header + Control Track */}
      <div className="flex flex-col gap-1.5 mb-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 w-full">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="text-[11px] text-dim tracking-widest uppercase font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0">
              Global Metrics
            </div>
            <span className="sm:hidden text-[10px] font-mono tabular-nums text-dim truncate">
              --/-- Slots · Cap --%
            </span>
          </div>
          <div className="grid grid-cols-2 sm:inline-flex items-stretch gap-1 p-0.5 bg-surface/90 border border-border/60 rounded-lg w-full sm:w-auto shrink-0">
            <span className="h-7 sm:h-6 px-2 sm:px-2.5 rounded-md flex items-center justify-center text-[10px] font-mono font-bold uppercase tracking-wider text-dim">
              Risk Limits
            </span>
            <span className="h-7 sm:h-6 px-2 sm:px-2.5 rounded-md flex items-center justify-center text-[10px] font-mono font-bold uppercase tracking-wider text-dim">
              {expanded ? 'Compact' : 'Expand'}
            </span>
          </div>
        </div>

        {/* 4 Global Metric StatCards: static labels remain visible, ONLY dynamic values shimmer */}
        <div
          className={cn(
            'grid auto-rows-fr items-stretch gap-2.5',
            expanded ? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4' : 'grid-cols-2 md:grid-cols-4'
          )}
        >
          <StaticMetricSkeletonCard label="Account Balance" compact={!expanded} hasSubValue={expanded} valueWidth="w-24" subWidth="w-32" />
          <StaticMetricSkeletonCard label="Active P&L" compact={!expanded} hasSubValue={expanded} valueWidth="w-28" subWidth="w-32" />
          <StaticMetricSkeletonCard label="Live Risk" compact={!expanded} hasSubValue={expanded} valueWidth="w-16" subWidth="w-28" />
          <StaticMetricSkeletonCard label="Peak RR" compact={!expanded} hasSubValue={expanded} valueWidth="w-16" subWidth="w-28" />
        </div>
      </div>

      {/* Active Strategy panel: static title + static view-mode tabs, dynamic strategy rows/numbers shimmer */}
      <div className="rounded-xl bg-surface border border-border p-3 sm:p-4 flex flex-col mb-3">
        <div className="flex items-center justify-between gap-2 mb-2.5 min-h-[30px]">
          <span className="text-[11px] text-dim tracking-widest uppercase font-bold">Active Strategy</span>
          <div className="inline-flex items-center bg-background/60 border border-border/40 p-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider">
            {[
              { id: 'detailed', label: 'Detailed' },
              { id: 'compact', label: 'Compact' },
              { id: 'list', label: 'List' },
            ].map((t) => (
              <span
                key={t.id}
                className={cn(
                  'h-6 px-2.5 rounded-md inline-flex items-center',
                  cardViewMode === t.id ? 'bg-accent text-white shadow-xs' : 'text-dim'
                )}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <div
          className={cn(
            'grid gap-2.5 sm:gap-3 min-h-[118px]',
            cardViewMode === 'list' ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 auto-rows-fr items-stretch'
          )}
        >
          {[0, 1].map((i) => (
            <div key={i} className="min-h-[118px] rounded-xl bg-background/50 border border-border/40 p-3.5 flex flex-col justify-between gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <SkeletonBlock className="w-36 h-4 rounded" />
                <SkeletonBlock className="w-16 h-5 rounded-full opacity-75" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-surface/50 border border-border/30 p-2 space-y-1">
                  <span className="text-[9px] uppercase text-dim font-bold block">Active</span>
                  <SkeletonBlock className="w-14 h-3 rounded" />
                </div>
                <div className="rounded-lg bg-surface/50 border border-border/30 p-2 space-y-1">
                  <span className="text-[9px] uppercase text-dim font-bold block">Session</span>
                  <SkeletonBlock className="w-14 h-3 rounded" />
                </div>
                <div className="rounded-lg bg-surface/50 border border-border/30 p-2 space-y-1">
                  <span className="text-[9px] uppercase text-dim font-bold block">Slots</span>
                  <SkeletonBlock className="w-10 h-3 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 w-full">
        <div className="bg-surface border border-border rounded-2xl p-3.5 sm:p-5 flex items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <SkeletonBlock className="w-8 h-8 rounded-xl opacity-75 shrink-0" />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 min-w-0 flex-1 pr-1 sm:pr-2">
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-bold tracking-tight text-text">Periodic Performance</span>
                <span aria-hidden="true" className="text-dim/40 text-xs">·</span>
                <span className="text-[11px] font-medium text-dim">All Sessions</span>
              </div>
              <div className="flex items-center gap-2.5 font-mono text-[10px] font-semibold text-dim tabular-nums">
                <span>TODAY --</span>
                <span aria-hidden="true" className="text-dim/30">·</span>
                <span>7D --</span>
              </div>
            </div>
          </div>
          <SkeletonBlock className="w-8 h-8 sm:w-7 sm:h-7 rounded-lg opacity-65 shrink-0" />
        </div>

        <div className="bg-surface border border-border rounded-xl px-3 py-2.5 sm:px-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <SkeletonBlock className="w-3.5 h-3.5 rounded opacity-75 shrink-0" />
            <span className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-text">Session Logs</span>
            <span className="text-[9px] text-dim font-mono uppercase tracking-wider">Buffer: 500</span>
          </div>
          <SkeletonBlock className="w-6 h-6 rounded-md opacity-65 shrink-0" />
        </div>
      </div>
    </div>
  )
}

/**
 * Matches TradesView geometry: Static ViewHeader + real KPI labels with value shimmers + static filter bar + ActiveTradesSkeleton.
 */
export const TradesSkeleton = () => (
  <div
    className="max-w-[1160px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-6 md:pt-6 pb-36 lg:pb-16"
    role="status"
    aria-busy="true"
    aria-label="Loading active positions"
  >
    <ViewHeaderSkeleton
      title="Active Positions"
      subTitle="Live monitoring across all strategies"
      hasBack={true}
      hasIcon={true}
      hasMetricsRow={true}
    />

    <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-fr items-stretch gap-2.5 mb-3">
      <StaticMetricSkeletonCard label="Active P&L" hasSubValue valueWidth="w-24" subWidth="w-28" />
      <StaticMetricSkeletonCard label="Active Risk" hasSubValue valueWidth="w-16" subWidth="w-24" />
      <StaticMetricSkeletonCard label="Peak RR" hasSubValue valueWidth="w-16" subWidth="w-24" />
      <StaticMetricSkeletonCard label="Positions" hasSubValue valueWidth="w-14" subWidth="w-24" />
    </div>

    <div className="h-[52px] rounded-xl bg-surface border border-border px-3.5 flex items-center justify-between mb-3">
      <span className="text-xs font-semibold text-text">Tactical Filters</span>
      <span className="px-3 py-1 rounded-xl border border-border bg-surface-elevated text-[11px] font-semibold text-dim">
        Filters
      </span>
    </div>

    <ActiveTradesSkeleton count={2} />
  </div>
)

/**
 * Matches HistoryView geometry: Static ViewHeader + static filter toolbar + Lifetime Analytics labels with value shimmers + Session rows.
 */
export const HistorySkeleton = () => (
  <div
    className="max-w-[1160px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-6 md:pt-6 pb-36 lg:pb-16"
    role="status"
    aria-busy="true"
    aria-label="Loading trade history"
  >
    <ViewHeaderSkeleton
      title="Trade History"
      subTitle="Verified records of closed sessions & positions"
      hasBack={true}
      hasIcon={true}
      hasMetricsRow={true}
      rightSlot={
        <div className="flex items-center gap-1 bg-surface border border-border/50 p-0.5 rounded-xl text-xs font-bold">
          <span className="h-7 px-2.5 sm:px-3 rounded-lg bg-accent text-white inline-flex items-center">Records</span>
          <span className="h-7 px-2.5 sm:px-3 rounded-lg text-dim inline-flex items-center">Backtest</span>
        </div>
      }
    />

    <div className="rounded-2xl bg-surface/60 border border-border/50 p-3 space-y-2.5 mb-4">
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1 text-[11px] font-semibold">
          <span className="px-3 py-1.5 rounded-lg bg-accent/15 text-accent border border-accent/30">Paper</span>
          <span className="px-3 py-1.5 rounded-lg text-dim border border-border/40">Live</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-dim">
          <span className="px-3 py-1.5 rounded-xl border border-border/50 bg-background/50">Search history...</span>
          <span className="px-3 py-1.5 rounded-xl border border-border/50 bg-background/50">Filters</span>
        </div>
      </div>
    </div>

    <div className="min-h-[68px] rounded-2xl bg-surface/55 border border-border/50 p-4 flex items-center justify-between gap-4 mb-4">
      <div className="min-w-0">
        <div className="text-xs md:text-sm font-black tracking-tight uppercase text-text">Lifetime Analytics & Insights</div>
        <div className="text-[9px] text-dim font-bold uppercase tracking-widest mt-0.5 opacity-80">
          Aggregated performance metrics
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-6 shrink-0">
        <div className="space-y-1">
          <span className="text-[8px] text-dim font-black uppercase tracking-widest opacity-60 block">Net P&L</span>
          <SkeletonBlock className="w-16 h-4 rounded" />
        </div>
        <div className="space-y-1">
          <span className="text-[8px] text-dim font-black uppercase tracking-widest opacity-60 block">Win Rate</span>
          <SkeletonBlock className="w-14 h-4 rounded" />
        </div>
        <div className="space-y-1">
          <span className="text-[8px] text-dim font-black uppercase tracking-widest opacity-60 block">Sharpe</span>
          <SkeletonBlock className="w-10 h-4 rounded" />
        </div>
      </div>
    </div>

    <HistorySessionsSkeleton count={3} />
  </div>
)

/**
 * Matches SettingsView geometry: Static ViewHeader + 4 KPI cards with static labels + real Category tabs + static Settings section titles.
 */
export const SettingsSkeleton = () => (
  <div
    className="max-w-[1160px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-6 md:pt-6 pb-36 lg:pb-16"
    role="status"
    aria-busy="true"
    aria-label="Loading system settings"
  >
    <ViewHeaderSkeleton
      title="System Settings"
      subTitle="Global workspace, credentials & engine infrastructure"
      hasBack={true}
      hasIcon={true}
      hasMetricsRow={false}
      rightSlot={
        <div className="h-8 px-2.5 sm:px-3 rounded-lg bg-surface border border-border/70 inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-dim">
          Expand All
        </div>
      }
    />

    <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-fr items-stretch gap-2.5 mb-3">
      <StaticMetricSkeletonCard label="Readiness" hasSubValue valueWidth="w-20" subWidth="w-24" />
      <StaticMetricSkeletonCard label="Exchange Keys" hasSubValue valueWidth="w-16" subWidth="w-24" />
      <StaticMetricSkeletonCard label="Hibernation" hasSubValue valueWidth="w-20" subWidth="w-24" />
      <StaticMetricSkeletonCard label="Theme & Glare" hasSubValue valueWidth="w-20" subWidth="w-24" />
    </div>

    <div className="h-[44px] w-full sm:w-auto rounded-xl bg-surface/60 border border-border/50 p-1 inline-flex items-center gap-1 overflow-x-auto mb-3">
      {['All Sections', 'Security & Keys', 'Engine & Data', 'Workspace & UI', 'Diagnostics & Reset'].map((cat, idx) => (
        <span
          key={cat}
          className={cn(
            'px-3 h-full rounded-lg inline-flex items-center text-[11px] font-semibold whitespace-nowrap',
            idx === 0 ? 'bg-accent/15 text-accent border border-accent/25' : 'text-dim'
          )}
        >
          {cat}
        </span>
      ))}
    </div>

    <div className="flex flex-col gap-3">
      {[
        'Appearance & Visual Comfort',
        'Streaming & System Alerts',
        'Exchange Credentials',
        'Engine & Scanner Bandwidth',
        'Startup Checklist & Maintenance',
      ].map((sectionTitle) => (
        <div key={sectionTitle} className="h-[58px] rounded-2xl bg-surface/55 border border-border/50 px-5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-bold uppercase tracking-wider text-text truncate">{sectionTitle}</span>
          </div>
          <SkeletonBlock className="w-16 h-3 rounded opacity-65 shrink-0" />
        </div>
      ))}
    </div>
  </div>
)

/**
 * Matches BacktestPanel results area while historical simulation is running (keeps KPI labels static).
 */
export const BacktestResultsSkeleton = () => (
  <div
    className="flex flex-col gap-5"
    role="status"
    aria-busy="true"
    aria-label="Running backtest simulation"
  >
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 auto-rows-fr items-stretch gap-3">
      {[
        'Net Return',
        'Win Rate',
        'Profit Factor',
        'Max Drawdown',
        'Sharpe',
        'Total Trades',
        'Expectancy',
      ].map((kpiLabel) => (
        <StaticMetricSkeletonCard key={kpiLabel} label={kpiLabel} hasSubValue valueWidth="w-16" subWidth="w-20" />
      ))}
    </div>
    <ChartPanelSkeleton height={240} label="Simulating equity curve" />
    <div className="rounded-2xl bg-surface/45 border border-border/45 p-4 space-y-2.5">
      <span className="text-xs font-bold uppercase tracking-wider text-text block">Symbol Performance</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[46px] rounded-xl bg-background/40 border border-border/25 px-3 flex items-center justify-between">
          <SkeletonBlock className="w-28 h-3.5 rounded" />
          <SkeletonBlock className="w-20 h-3.5 rounded opacity-75" />
        </div>
      ))}
    </div>
  </div>
)

/**
 * Matches SettingsView Startup & Connection Checklist 3-column grid while verifying readiness.
 */
export const StartupChecklistSkeleton = ({ count = 6 }) => (
  <div
    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
    role="status"
    aria-busy="true"
    aria-label="Verifying startup checklist"
  >
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="rounded-xl border border-border/40 bg-background/40 p-4 space-y-2.5 min-h-[112px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-bold uppercase tracking-wider text-dim">Check #{i + 1}</span>
          <SkeletonBlock className="w-12 h-3 rounded opacity-75" />
        </div>
        <SkeletonBlock className="w-36 h-3.5 rounded" />
        <SkeletonBlock className="w-28 h-3 rounded opacity-75" />
        <SkeletonBlock className="w-full h-2.5 rounded opacity-55" />
      </div>
    ))}
  </div>
)

/**
 * Lightweight centered drawer/modal skeleton for lazy TradeDetailModal suspense.
 */
export const ModalDrawerSkeleton = () => (
  <div
    className="fixed inset-x-0 bottom-0 top-[6dvh] lg:inset-x-auto lg:left-1/2 lg:-translate-x-1/2 lg:top-[6dvh] lg:bottom-[6dvh] lg:w-full lg:max-w-[1140px] z-[101] bg-background border border-border/70 rounded-t-[32px] lg:rounded-3xl p-5 flex flex-col gap-4 shadow-2xl"
    role="status"
    aria-busy="true"
    aria-label="Loading trade details"
  >
    <div className="flex items-center justify-between border-b border-border/30 pb-3">
      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-text">Position Telemetry</div>
          <SkeletonBlock className="w-36 h-2.5 rounded opacity-65" />
        </div>
      </div>
      <span className="px-2 py-1 rounded-lg border border-border/50 text-xs text-dim">ESC</span>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-fr items-stretch gap-3">
      <StaticMetricSkeletonCard label="Unrealized P&L" valueWidth="w-20" />
      <StaticMetricSkeletonCard label="Reward : Risk" valueWidth="w-16" />
      <StaticMetricSkeletonCard label="Entry Price" valueWidth="w-20" />
      <StaticMetricSkeletonCard label="Stop Loss" valueWidth="w-20" />
    </div>
    <ChartPanelSkeleton height={220} label="Loading trade telemetry" />
  </div>
)
