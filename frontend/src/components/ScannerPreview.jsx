import React from 'react'
import { shallow } from 'zustand/shallow'
import { useTradingStore } from '../store/trading'
import { getMarketRegimeInfo } from '../utils/marketRegime'
import { calculateOpportunityProximity } from '../lib/formatters'
import { SectionLabel, Tooltip, CopyButton, InPosBadge, Sparkline, cn } from './ui/primitives'
import { Zap, Turtle, Flame, PauseCircle, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const preloadScannerOverlay = () => {
  import('./ScannerOverlay');
};

export const ScannerPreview = React.memo(({ scannerResults, config, onOpen }) => {
  const { activeTrades, scannerPaused, hibernating } = useTradingStore(state => ({
    activeTrades: state.activeTrades || [],
    scannerPaused: state.scannerPaused,
    hibernating: state.hibernating
  }), shallow);

  const threshold = config?.scan_pct_threshold || 2
  const top = (scannerResults || []).slice(0, 5)
  // Pre-allocate 5 slots to prevent layout shift
  const placeholders = Array.from({ length: Math.max(0, 5 - top.length) })

  const weights = config?.scanner_weights || { momentum: 0.5, volatility: 0.3, trend: 0.2 };
  const momW = Math.round((weights.momentum ?? 0.5) * 100);
  const volW = Math.round((weights.volatility ?? 0.3) * 100);
  const trendW = Math.round((weights.trend ?? 0.2) * 100);

  const regimeInfo = getMarketRegimeInfo(scannerResults, config, { scannerPaused, hibernating });

  const getOppProximity = (opp) => calculateOpportunityProximity(opp, config);

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden mb-8 shadow-sm h-[395px] flex flex-col text-left">
      <div className="p-4 sm:p-5 border-b border-border flex justify-between items-center bg-surface/30 shrink-0 gap-3">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SectionLabel className="mb-0">
              <Zap size={14} className="text-accent" /> Live Scanner
            </SectionLabel>
            {/* Market Regime Badge Indicator */}
            <Tooltip content={regimeInfo.guidance}>
              <div
                tabIndex={0}
                role="region"
                aria-label={`Market Activity: ${regimeInfo.label}. Average Momentum ${regimeInfo.avgMomentum.toFixed(2)}%, Candidates passing threshold ${regimeInfo.passingCount} of ${regimeInfo.totalCount}`}
                className={cn(
                  "px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border flex items-center gap-1 font-mono cursor-help focus-visible:ring-2 focus-visible:ring-accent outline-none",
                  regimeInfo.badgeClass
                )}
              >
                {regimeInfo.regime === 'slow' && <Turtle size={11} className="shrink-0 text-cyan-400" />}
                {regimeInfo.regime === 'active' && <Flame size={11} className="shrink-0 text-accent animate-pulse" />}
                {regimeInfo.regime === 'moderate' && <Zap size={11} className="shrink-0 text-amber" />}
                {(regimeInfo.regime === 'paused' || regimeInfo.regime === 'hibernating') && <PauseCircle size={11} className="shrink-0" />}
                <span>{regimeInfo.label}</span>
              </div>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2 mt-1 flex-wrap text-[9px] font-bold">
            <span className="text-dim uppercase tracking-widest">
              Passing {regimeInfo.passingCount}/{regimeInfo.totalCount} &gt; {threshold}%
            </span>
            <span className="text-dim/40">•</span>
            <span className="text-accent font-mono text-[9px] uppercase tracking-wider">
              Weights {momW}:{volW}:{trendW}
            </span>
          </div>
        </div>

        <button
          className="text-[11px] font-bold text-accent hover:text-accent/80 transition-colors uppercase tracking-widest cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded shrink-0"
          aria-label="View all scanner results"
          onClick={onOpen}
          onMouseEnter={preloadScannerOverlay}
        >
          Open Full
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {top.length === 0 && placeholders.length === 5 ? (
          <div className="h-full p-6 flex flex-col items-center justify-center text-center bg-surface/10 gap-3">
            <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Turtle size={24} className="animate-bounce" />
            </div>
            <div className="flex flex-col gap-1 max-w-sm">
              <span className="text-xs font-black uppercase tracking-wider text-cyan-400">Slow / Quiet Market</span>
              <p className="text-[11px] font-medium text-dim leading-relaxed">
                {regimeInfo.guidance}
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 bg-background/50 border border-border/40 rounded-lg text-[9px] font-mono text-dim font-bold uppercase tracking-wider mt-1">
              <RefreshCw size={11} className="animate-spin text-accent" />
              Monitoring {config?.scan_interval || '1m'} klines for momentum expansion
            </div>
          </div>
        ) : (
          <>
            {/* Active Fast Market Speed Banner */}
            {regimeInfo.regime === 'active' && (
              <div
                tabIndex={0}
                role="region"
                aria-label={`Fast Market Expansion. ${regimeInfo.passingCount} of ${regimeInfo.totalCount} candidates passing threshold ${threshold}%, average momentum ${regimeInfo.avgMomentum.toFixed(2)}%`}
                className="bg-accent/10 border-b border-accent/30 px-4 py-2 flex items-center justify-between gap-3 text-xs font-mono shrink-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Flame size={14} className="text-accent animate-pulse shrink-0" />
                  <span className="font-black text-accent uppercase tracking-wider text-[10px] truncate">
                    🔥 Fast Market Expansion ({regimeInfo.passingCount}/{regimeInfo.totalCount} Candidates &gt; {threshold}%)
                  </span>
                </div>
                <span className="text-[9px] font-bold text-accent/80 uppercase tracking-widest shrink-0 hidden sm:inline">
                  Avg Momentum {regimeInfo.avgMomentum.toFixed(2)}%
                </span>
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
