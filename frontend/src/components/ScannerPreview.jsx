import React from 'react'
import { shallow } from 'zustand/shallow'
import { useTradingStore } from '../store/trading'
import { getMarketRegimeInfo } from '../utils/marketRegime'
import { calculateOpportunityProximity } from '../lib/formatters'
import { SectionLabel, Tooltip, CopyButton, InPosBadge, Sparkline, cn } from './ui/primitives'
import { ScannerPreviewRowsSkeleton } from './ui/Skeletons'
import { Zap, Turtle, Flame, PauseCircle, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const preloadScannerOverlay = () => {
  import('./ScannerOverlay');
};

export const ScannerPreview = React.memo(({ scannerResults, config, onOpen, embedded = false }) => {
  const { activeTrades, scannerPaused, hibernating } = useTradingStore(state => ({
    activeTrades: state.activeTrades || [],
    scannerPaused: state.scannerPaused,
    hibernating: state.hibernating
  }), shallow);

  const threshold = config?.scan_pct_threshold || 2
  const top = (scannerResults || []).slice(0, 5)
  // Pre-allocate 5 slots to prevent layout shift
  const placeholders = Array.from({ length: Math.max(0, 5 - top.length) })

  const regimeInfo = getMarketRegimeInfo(scannerResults, config, { scannerPaused, hibernating });

  const getOppProximity = (opp) => calculateOpportunityProximity(opp, config);

  return (
    <div className={cn(
      "w-full max-w-full min-w-0 overflow-hidden flex flex-col text-left",
      embedded
        ? "bg-transparent min-h-[200px]"
        : "bg-surface border border-border rounded-xl mb-3 shadow-sm min-h-[215px]"
    )}>
      <div className="px-3 py-1.5 border-b border-border flex justify-between items-center bg-surface/30 shrink-0 gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <SectionLabel className="mb-0 shrink-0">
            <Zap size={13} className="text-accent" /> Live Scanner
          </SectionLabel>
          <span className="text-[9px] font-bold text-dim uppercase tracking-wider font-mono truncate">
            {regimeInfo.passingCount}/{regimeInfo.totalCount} &gt; {threshold}%
          </span>
        </div>

        <button
          className="text-[10px] font-bold text-accent hover:text-accent/80 transition-colors uppercase tracking-widest cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded shrink-0 py-0.5 px-1.5"
          aria-label="View all scanner results"
          onClick={onOpen}
          onMouseEnter={preloadScannerOverlay}
        >
          Open Full
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-x-hidden">
        {top.length === 0 && placeholders.length === 5 ? (
          !scannerPaused && !hibernating ? (
            <div className="flex flex-col flex-1 justify-between">
              <ScannerPreviewRowsSkeleton rows={4} />
              <div className="px-3 py-1.5 border-t border-border/25 bg-surface/20 flex items-center justify-between text-[9.5px] font-mono text-dim">
                <span className="truncate">{regimeInfo.guidance}</span>
                <span className="text-accent/85 shrink-0 ml-2">Monitoring {config?.scan_interval || '1m'}</span>
              </div>
            </div>
          ) : (
            <div className="h-full p-4 flex flex-col items-center justify-center text-center bg-surface/10 gap-2">
              <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Turtle size={16} />
              </div>
              <div className="flex flex-col gap-0.5 max-w-sm">
                <span className="text-[10.5px] font-black uppercase tracking-wider text-cyan-400">No Active Candidates</span>
                <p className="text-[9.5px] font-medium text-dim leading-snug">
                  {regimeInfo.guidance}
                </p>
              </div>
            </div>
          )
        ) : (
          <>
            {regimeInfo.regime === 'active' && (
              <div className="sr-only" aria-live="polite">
                <span>🔥 Fast Market Expansion ({regimeInfo.passingCount}/{regimeInfo.totalCount} Candidates &gt; {threshold}%)</span>
              </div>
            )}
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
                      "flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-3 py-1.5 transition-colors hover:bg-white/5 min-h-[36px] sm:h-[38px] group w-full max-w-full min-w-0 overflow-hidden",
                      !isLast && "border-b border-border/40",
                      !passing && "opacity-60"
                    )}
                  >
                    <span className="text-[9px] text-dim font-mono w-4 shrink-0">#{i + 1}</span>
                    <strong className="text-[11px] font-mono w-12 sm:w-16 truncate shrink-0">{opp.symbol.replace('USDT', '')}</strong>
                    <CopyButton value={opp.symbol} className="hidden sm:inline-flex opacity-0 group-hover:opacity-100 focus-visible:opacity-100 -ml-1.5 shrink-0" />
                    <div className="flex-1 flex justify-center h-5 min-w-[28px] overflow-hidden items-center">
                      <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={40} height={14} />
                    </div>
                    <div className="flex flex-col items-end w-13 sm:w-16 justify-center shrink-0">
                      <em className={cn("text-[10.5px] sm:text-[11px] font-bold font-mono text-right leading-none tabular-nums", colorClass)}>
                        {opp.pct >= 0 ? '+' : ''}{Number(opp.pct || 0).toFixed(2)}%
                      </em>
                      {(activeTrades || []).some(t => t.symbol === opp.symbol) && (
                        <InPosBadge className="opacity-60 scale-90 origin-right mt-0.5" />
                      )}
                    </div>
                    <div className="w-13 sm:w-16 flex flex-col items-end justify-center gap-0.5 shrink-0">
                      {passing ? (
                        opp.signalResult?.allFired ? (
                          <b className="text-[8px] sm:text-[9px] font-black text-green uppercase tracking-wider">TRIGGERED</b>
                        ) : (
                          <b className="text-[8px] sm:text-[9px] font-black text-amber uppercase tracking-wider">PENDING</b>
                        )
                      ) : (
                        <b className="text-[8px] sm:text-[9px] font-bold text-dim uppercase tracking-wider">WAITING</b>
                      )}
                      <div className="w-10 sm:w-12 h-1 bg-background/80 rounded-full overflow-hidden border border-white/5" title={`Proximity: ${getOppProximity(opp)}%`}>
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
                "h-[36px] sm:h-[38px] flex items-center px-2.5 sm:px-3 opacity-10 grayscale w-full max-w-full min-w-0 overflow-hidden",
                i !== placeholders.length - 1 && "border-b border-border/40"
              )}>
                <div className="w-4 h-1.5 bg-dim rounded-full mr-2 shrink-0" />
                <div className="w-12 sm:w-16 h-2.5 bg-dim rounded-full mr-2 shrink-0" />
                <div className="flex-1" />
                <div className="w-12 sm:w-16 h-2.5 bg-dim rounded-full mr-2 shrink-0" />
                <div className="w-10 h-1.5 bg-dim rounded-full shrink-0" />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
})
ScannerPreview.displayName = 'ScannerPreview'
