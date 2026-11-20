import React from 'react'
import { cn } from './primitives'

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
 * Matches StrategyDetailView geometry (ViewHeader + 4 KPI cards + tab bar + Inspect Live + 4 dial cards).
 */
export const StrategyDetailSkeleton = () => (
  <div
    className="max-w-[1600px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 lg:px-5 lg:pt-5 pb-20 space-y-3"
    role="status"
    aria-busy="true"
    aria-label="Loading strategy details"
  >
    {/* Header bar */}
    <div className="min-h-[56px] w-full rounded-2xl bg-surface/45 border border-border/35 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <SkeletonBlock className="w-8 h-8 rounded-lg shrink-0" />
        <div className="space-y-1.5">
          <SkeletonBlock className="w-44 sm:w-56 h-4 rounded" />
          <SkeletonBlock className="w-28 sm:w-40 h-2.5 rounded opacity-70" />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <SkeletonBlock className="w-20 h-8 rounded-lg hidden sm:block" />
        <SkeletonBlock className="w-20 h-8 rounded-lg" />
      </div>
    </div>

    {/* 4 KPI cards */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[64px] rounded-xl bg-surface/45 border border-border/35 px-3 py-2.5 flex flex-col justify-between"
        >
          <SkeletonBlock className="w-20 h-2.5 rounded opacity-75" />
          <SkeletonBlock className="w-28 h-4 rounded" />
        </div>
      ))}
    </div>

    {/* 3-tab strip */}
    <div className="h-[42px] w-full sm:w-[340px] rounded-xl bg-surface/40 border border-border/35 p-1 grid grid-cols-3 gap-1">
      <SkeletonBlock className="h-full rounded-lg" />
      <SkeletonBlock className="h-full rounded-lg opacity-55" />
      <SkeletonBlock className="h-full rounded-lg opacity-55" />
    </div>

    {/* Inspect Live + Condition Cards panel */}
    <div className="rounded-2xl bg-surface/35 border border-border/40 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-border/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="w-24 h-6 rounded-lg" />
          <SkeletonBlock className="w-20 h-6 rounded-lg opacity-70" />
          <SkeletonBlock className="w-20 h-6 rounded-lg opacity-55 hidden sm:block" />
        </div>
        <SkeletonBlock className="w-24 h-6 rounded-lg opacity-70" />
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
          className="relative overflow-hidden rounded-xl border border-border/40 bg-surface/35 p-2.5 flex flex-col justify-between gap-2 min-h-[168px]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <SkeletonBlock className="w-8 h-3.5 rounded" />
                <SkeletonBlock className="w-24 h-3.5 rounded" />
              </div>
              <SkeletonBlock className="w-28 h-2.5 rounded opacity-65" />
            </div>
            <SkeletonBlock className="w-16 h-4 rounded-full shrink-0" />
          </div>

          {/* Semicircular dial silhouette */}
          <div className="flex justify-center items-center py-1">
            <div className="w-[104px] h-[54px] rounded-t-full border-t-[7px] border-x-[7px] border-border/45 bg-transparent relative overflow-hidden skeleton-shimmer">
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-10 h-3 rounded bg-surface/80" />
            </div>
          </div>

          {/* Telemetry readout footer */}
          <div className="rounded-lg bg-bg/40 border border-border/30 px-2.5 py-1.5 flex items-center justify-between gap-2">
            <SkeletonBlock className="w-14 h-3 rounded opacity-75" />
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
        <div className="flex items-center gap-2.5">
          <SkeletonBlock className="w-7 h-7 rounded-lg" />
          <div className="space-y-1">
            <SkeletonBlock className="w-36 h-3.5 rounded" />
            <SkeletonBlock className="w-24 h-2.5 rounded opacity-65" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBlock className="w-28 h-7 rounded-lg hidden sm:block" />
          <SkeletonBlock className="w-7 h-7 rounded-lg" />
        </div>
      </div>
    )}
    <div className="divide-y divide-border/25 flex-1 overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="px-4 py-3 grid grid-cols-[1fr_auto] md:grid-cols-[28px_1.5fr_1fr_1.2fr_110px] items-center gap-3 min-h-[56px]"
        >
          <SkeletonBlock className="hidden md:block w-5 h-3.5 rounded opacity-60" />
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
        <SkeletonBlock className="w-14 h-7 rounded-lg" />
        <SkeletonBlock className="w-16 h-7 rounded-lg opacity-70" />
        <SkeletonBlock className="w-16 h-7 rounded-lg opacity-55" />
      </div>
      <SkeletonBlock className="w-40 h-7 rounded-lg opacity-75" />
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
    <div className="grid grid-cols-7 gap-1.5">
      {Array.from({ length: 7 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-3 rounded opacity-60" />
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
 * Prevents premature "Trade Not Found" flash during initial REST hydration.
 */
export const TradeDetailSkeleton = () => (
  <div
    className="max-w-[1200px] mx-auto px-4 pt-4 md:px-8 md:pt-8 pb-36 lg:pb-16 space-y-4"
    role="status"
    aria-busy="true"
    aria-label="Loading trade details"
  >
    <div className="min-h-[58px] rounded-2xl bg-surface/45 border border-border/35 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="w-8 h-8 rounded-lg" />
        <div className="space-y-1.5">
          <SkeletonBlock className="w-36 h-4 rounded" />
          <SkeletonBlock className="w-48 h-2.5 rounded opacity-65" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SkeletonBlock className="w-16 h-5 rounded-full" />
        <SkeletonBlock className="w-14 h-5 rounded-full opacity-75" />
      </div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[74px] rounded-xl bg-surface/45 border border-border/35 p-3 flex flex-col justify-between">
          <SkeletonBlock className="w-20 h-2.5 rounded opacity-70" />
          <SkeletonBlock className="w-24 h-5 rounded" />
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="h-[220px] rounded-2xl bg-surface/35 border border-border/35 p-4 flex flex-col justify-between">
        <SkeletonBlock className="w-40 h-3.5 rounded" />
        <SkeletonBlock className="w-full h-24 rounded-xl opacity-75" />
        <div className="flex justify-between">
          <SkeletonBlock className="w-24 h-3 rounded opacity-65" />
          <SkeletonBlock className="w-24 h-3 rounded opacity-65" />
        </div>
      </div>
      <div className="h-[220px] rounded-2xl bg-surface/35 border border-border/35 p-4 space-y-3">
        <SkeletonBlock className="w-36 h-3.5 rounded" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <SkeletonBlock className="w-28 h-3 rounded opacity-70" />
            <SkeletonBlock className="w-20 h-3 rounded" />
          </div>
        ))}
      </div>
    </div>
  </div>
)

/**
 * Matches ActiveTradeCard stacked layout during session resume/hydration (prevents premature "No Active Trades" flash).
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
        className="rounded-2xl bg-surface/40 border border-border/40 p-4 space-y-3 min-h-[146px]"
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
          {[0, 1, 2, 3].map((m) => (
            <div key={m} className="rounded-lg bg-bg/40 border border-border/25 p-2 space-y-1.5">
              <SkeletonBlock className="w-14 h-2.5 rounded opacity-65" />
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
        className="rounded-2xl bg-surface/40 border border-border/35 px-4 py-3.5 min-h-[76px] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
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
            <SkeletonBlock className="w-12 h-2 rounded opacity-60" />
            <SkeletonBlock className="w-16 h-3.5 rounded" />
          </div>
          <div className="space-y-1">
            <SkeletonBlock className="w-12 h-2 rounded opacity-60" />
            <SkeletonBlock className="w-14 h-3.5 rounded" />
          </div>
          <SkeletonBlock className="w-6 h-6 rounded-lg opacity-70" />
        </div>
      </div>
    ))}
  </div>
)
