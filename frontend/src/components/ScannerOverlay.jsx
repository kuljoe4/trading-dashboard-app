import React, { useState, useMemo, useEffect, useRef } from 'react'
import { fmtVol } from '../lib/theme'
import { formatDuration } from '../lib/formatters'
import { PulseDot, Sparkline, cn, CopyButton, Tooltip, CandlestickChart } from './ui/primitives'
import { useTradingStore } from '../store/trading'
import { X, Search, ShieldCheck, XCircle, Zap, AlertCircle, ChevronDown, ChevronUp, Activity, CheckCircle2, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { shallow } from 'zustand/shallow'

const ScannerRow = React.memo(({ opp, i, threshold, activeTrades, isSingleMonitor, isLong, passing }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="flex flex-col border-b border-border/50">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "grid grid-cols-[30px_1fr_80px_60px] md:grid-cols-[30px_100px_1fr_60px_1fr_1fr_50px] items-center px-4 py-3 transition-all h-[56px] group cursor-pointer",
          !passing && "opacity-45 grayscale-[0.5]",
          isSingleMonitor && "bg-accent/5",
          passing && "hover:bg-white/5 active:bg-white/10",
          isExpanded && "bg-white/[0.02]"
        )}>
        <div className="flex flex-col justify-center">
          <span className="text-[11px] text-dim font-mono leading-none">#{i + 1}</span>
          {opp.volume_rank && (
            <div className="mt-1">
              <Tooltip content={`Volume Rank: This symbol is #${opp.volume_rank} in 24h volume among tracked assets.`}>
                 <span className="text-[7px] md:text-[8px] bg-white/5 border border-white/10 px-1 py-0.5 rounded text-dim/60 font-black uppercase tracking-tighter cursor-help">
                    V#{opp.volume_rank}
                 </span>
              </Tooltip>
            </div>
          )}
        </div>
        <div className="flex flex-col justify-center overflow-hidden">
           <div className="flex items-baseline gap-0.5">
             <span className="text-[14px] font-bold font-mono truncate">{opp.symbol.replace("USDT", "")}</span>
             <span className="text-[9px] text-dim font-mono opacity-50">/U</span>
             <CopyButton value={opp.symbol} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ml-1" />
           </div>
           <div className="flex items-center gap-1.5 mt-0.5">
            {activeTrades.some(t => t.symbol === opp.symbol) && (
               <Tooltip content="Currently in Position">
                 <div className="flex items-center gap-1">
                    <Zap size={10} className="text-green fill-green/20" />
                    <span className="text-[8px] font-bold text-green uppercase tracking-tighter">In Pos</span>
                 </div>
               </Tooltip>
            )}
            {isSingleMonitor && (
              <div className="flex items-center gap-1">
                 <ShieldCheck size={10} className="text-accent" />
                 <span className="text-[8px] font-bold text-accent uppercase tracking-tighter">Monitored</span>
              </div>
            )}
           </div>
        </div>
        <div className="flex flex-col items-end">
          <span className={cn(
            "text-[14px] font-bold font-mono",
            isLong ? "text-green" : "text-red"
          )}>
            {isLong ? "+" : "-"}{Number(Math.abs(opp.pct || 0)).toFixed(2)}%
          </span>
          <div className="md:hidden mt-1">
            <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={40} height={12} />
          </div>
        </div>
        <div className="md:flex justify-center hidden">
          <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={40} height={16} />
        </div>
        <span className="text-[11px] text-dim font-mono text-right md:block hidden">{fmtVol(opp.vol)}</span>
        <div className="md:flex items-center gap-2 px-2 overflow-hidden hidden" role="region" aria-label={`Opportunity score for ${opp.symbol}: ${opp.score.toFixed(1)}`}>
          <Tooltip content={
            <div className="flex flex-col gap-2 p-1 min-w-[120px]">
               <div className="text-[10px] font-black uppercase tracking-widest border-b border-white/10 pb-1">Score Breakdown</div>
               <div className="flex justify-between items-center text-[10px]">
                  <span className="text-dim uppercase font-bold">Momentum</span>
                  <span className="font-mono text-accent">{opp.score_breakdown?.momentum?.toFixed(1) || '0.0'}</span>
               </div>
               <div className="flex justify-between items-center text-[10px]">
                  <span className="text-dim uppercase font-bold">Volatility</span>
                  <span className="font-mono text-amber">{opp.score_breakdown?.volatility?.toFixed(1) || '0.0'}</span>
               </div>
               <div className="flex justify-between items-center text-[10px]">
                  <span className="text-dim uppercase font-bold">Trend</span>
                  <span className="font-mono text-purple-400">{opp.score_breakdown?.trend?.toFixed(1) || '0.0'}</span>
               </div>
               <div className="border-t border-white/10 pt-1 flex justify-between items-center font-black">
                  <span className="text-[9px] uppercase tracking-tighter">Total</span>
                  <span className={cn("text-[11px] font-mono", opp.score > 85 ? "text-accent" : "text-white")}>{Number(opp.score || 0).toFixed(1)}</span>
               </div>
            </div>
          }>
            <div className="flex-1 flex items-center gap-2 cursor-help" aria-label="Score breakdown bar">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden flex min-w-[40px] border border-white/5">
                <div className="h-full bg-accent/80" style={{ width: `${opp.score_breakdown?.momentum || 0}%` }} aria-label={`Momentum component: ${opp.score_breakdown?.momentum?.toFixed(1)}%`} />
                <div className="h-full bg-amber/80" style={{ width: `${opp.score_breakdown?.volatility || 0}%` }} aria-label={`Volatility component: ${opp.score_breakdown?.volatility?.toFixed(1)}%`} />
                <div className="h-full bg-purple/80" style={{ width: `${opp.score_breakdown?.trend || 0}%` }} aria-label={`Trend component: ${opp.score_breakdown?.trend?.toFixed(1)}%`} />
              </div>
              <div className="relative">
                <span className={cn(
                  "text-[10px] font-mono whitespace-nowrap",
                  opp.score > 85 ? "text-accent font-black" : "text-dim"
                )}>
                  {Number(opp.score || 0).toFixed(1)}
                </span>
                {opp.score > 85 && (
                  <span className="absolute -inset-1 bg-accent/20 blur-md rounded-full animate-pulse -z-10" />
                )}
              </div>
            </div>
          </Tooltip>
        </div>
        <div className="flex justify-center items-center gap-2">
          {passing ? (
            opp.signalResult?.allFired ? (
              <Tooltip content="Meets momentum and signal criteria for entry.">
                <span className="px-2 py-0.5 rounded bg-green/10 text-green text-[9px] font-black uppercase tracking-tighter border border-green/20 cursor-help">PASS</span>
              </Tooltip>
            ) : (
              <Tooltip content={
                <div className="flex flex-col gap-1">
                  <div className="font-bold flex items-center gap-1.5 text-red">
                    <AlertCircle size={12} />
                    SIGNAL REJECTED
                  </div>
                  <div className="text-[11px] opacity-90">{opp.signalResult?.reason || 'Authorization failed'}</div>
                  <div className="text-[10px] opacity-60 mt-1 border-t border-white/10 pt-1">
                    Symbol meets volume/momentum but fails pattern validation.
                  </div>
                </div>
              }>
                <span className="px-2 py-0.5 rounded bg-red/10 text-red text-[9px] font-black uppercase tracking-tighter border border-red/20 cursor-help flex items-center gap-1">
                  REJECT
                </span>
              </Tooltip>
            )
          ) : (
            <Tooltip content="Below momentum threshold. Awaiting stronger price action.">
              <span className="px-2 py-0.5 rounded bg-surface text-dim text-[9px] font-black uppercase tracking-tighter border border-border cursor-help">WAIT</span>
            </Tooltip>
          )}
          <div className="hidden md:block opacity-0 group-hover:opacity-100 transition-opacity">
             {isExpanded ? <ChevronUp size={12} className="text-dim" /> : <ChevronDown size={12} className="text-dim" />}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className={cn(
              "overflow-hidden bg-black/20 transition-all duration-500",
              opp.score > 85 && "bg-accent/[0.03] border-l-2 border-accent/40 shadow-[inset_10px_0_20px_-10px_rgba(91,111,255,0.1)]"
            )}
          >
            {opp.score > 85 && (
              <div className="bg-accent/10 border-b border-accent/20 px-6 py-1.5 flex items-center gap-2">
                 <Zap size={10} className="text-accent fill-accent animate-pulse" />
                 <span className="text-[9px] font-black uppercase tracking-[0.2em] text-accent">High Confidence Opportunity Detected</span>
              </div>
            )}
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-white/5">
              <div className="flex flex-col gap-4">
                <div className="text-[10px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-2">
                   <Activity size={12} className="text-accent" /> Signal Visualization
                </div>
                <div className="bg-surface border border-border rounded-2xl p-4 flex items-center justify-center min-h-[160px] relative overflow-hidden">
                   <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(var(--color-accent) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
                   {opp.ohlc_history ? (
                     <div className="w-full flex flex-col items-center">
                        <CandlestickChart data={opp.ohlc_history} width={360} height={120} />
                        <div className="flex justify-between w-full mt-4 px-2">
                           <div className="flex flex-col">
                              <span className="text-[8px] text-dim uppercase font-black tracking-widest">Entry Target</span>
                              <span className="text-xs font-mono font-bold">${opp.price.toLocaleString()}</span>
                           </div>
                           <div className="flex flex-col items-end">
                              <span className="text-[8px] text-dim uppercase font-black tracking-widest">Momentum</span>
                              <span className={cn("text-xs font-mono font-bold", isLong ? "text-green" : "text-red")}>
                                {isLong ? "+" : "-"}{Number(Math.abs(opp.pct || 0)).toFixed(2)}%
                              </span>
                           </div>
                        </div>
                     </div>
                   ) : (
                     <div className="text-[10px] text-dim italic opacity-40 uppercase tracking-widest">Loading OHLC telemetry...</div>
                   )}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                 <div className="text-[10px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-2">
                   <LayoutGrid size={12} className="text-accent" /> Opportunity Scoring
                 </div>
                 <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden group/scoring" role="group" aria-label="Detailed score breakdown">
                    <div className="absolute top-0 right-0 p-3 opacity-10 group-hover/scoring:opacity-20 transition-opacity">
                       <TrendingUp size={40} className="text-accent" />
                    </div>

                    <div className="space-y-5 relative z-10">
                       <div className="space-y-2">
                          <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest">
                             <span className="text-dim">Momentum Contribution</span>
                             <span className="text-accent">{opp.score_breakdown?.momentum?.toFixed(1) || '0.0'}%</span>
                          </div>
                          <div className="h-1.5 bg-background rounded-full overflow-hidden border border-white/5">
                             <motion.div
                               initial={{ width: 0 }}
                               animate={{ width: `${opp.score_breakdown?.momentum || 0}%` }}
                               className="h-full bg-accent shadow-[0_0_8px_var(--color-accent)]"
                             />
                          </div>
                       </div>

                       <div className="space-y-2">
                          <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest">
                             <span className="text-dim">Volatility Component</span>
                             <span className="text-amber">{opp.score_breakdown?.volatility?.toFixed(1) || '0.0'}%</span>
                          </div>
                          <div className="h-1.5 bg-background rounded-full overflow-hidden border border-white/5">
                             <motion.div
                               initial={{ width: 0 }}
                               animate={{ width: `${opp.score_breakdown?.volatility || 0}%` }}
                               className="h-full bg-amber shadow-[0_0_8px_var(--color-amber)]"
                             />
                          </div>
                       </div>

                       <div className="space-y-2">
                          <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest">
                             <span className="text-dim">Trend Strength</span>
                             <span className="text-purple-400">{opp.score_breakdown?.trend?.toFixed(1) || '0.0'}%</span>
                          </div>
                          <div className="h-1.5 bg-background rounded-full overflow-hidden border border-white/5">
                             <motion.div
                               initial={{ width: 0 }}
                               animate={{ width: `${opp.score_breakdown?.trend || 0}%` }}
                               className="h-full bg-purple-400 shadow-[0_0_8px_#a855f7]"
                             />
                          </div>
                       </div>

                       <div className="pt-2 border-t border-white/5 flex justify-between items-end">
                          <div className="flex flex-col">
                             <span className="text-[8px] text-dim font-black uppercase tracking-[0.2em]">Aggregate Score</span>
                             <span className={cn("text-2xl font-mono font-black tracking-tighter leading-none mt-1", opp.score > 85 ? "text-accent" : "text-text")}>
                                {opp.score.toFixed(1)}
                             </span>
                          </div>
                          <div className="text-[8px] text-dim/40 font-bold uppercase text-right leading-tight">
                             Weights: {config.scanner_weights ? `${(config.scanner_weights.momentum*100).toFixed(0)}/${(config.scanner_weights.volatility*100).toFixed(0)}/${(config.scanner_weights.trend*100).toFixed(0)}` : '50/30/20'}
                          </div>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="flex flex-col gap-4">
                 <div className="text-[10px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-2">
                   <ShieldCheck size={12} className="text-accent" /> Authorization Audit
                 </div>
                 <div className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 h-full">
                    <div className="flex items-center gap-3">
                       <div className={cn(
                         "w-10 h-10 rounded-full flex items-center justify-center shadow-lg",
                         opp.signalResult?.allFired ? "bg-green/10 text-green" : "bg-red/10 text-red"
                       )}>
                         {opp.signalResult?.allFired ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                       </div>
                       <div className="flex flex-col">
                          <div className="text-[11px] font-black uppercase tracking-widest">
                             {opp.signalResult?.allFired ? 'Authorization Passed' : 'Authorization Denied'}
                          </div>
                          <div className="text-[9px] text-dim font-bold uppercase tracking-tight">
                             Strategy Engine Verification
                          </div>
                       </div>
                    </div>

                    <div className="space-y-3 pt-2">
                       <div className="flex justify-between items-center text-[10px]">
                          <span className="text-dim uppercase font-black tracking-widest">Momentum Thresh.</span>
                          <span className="text-green font-bold font-mono">OK (≥ {threshold}%)</span>
                       </div>
                       <div className="flex justify-between items-center text-[10px]">
                          <span className="text-dim uppercase font-black tracking-widest">Signal Logic</span>
                          <span className={cn("font-bold uppercase tracking-widest", opp.signalResult?.allFired ? "text-green" : "text-red")}>
                             {opp.signalResult?.allFired ? 'Patterns Verified' : 'Pattern Rejected'}
                          </span>
                       </div>
                       {!opp.signalResult?.allFired && (
                         <div className="bg-red/5 border border-red/10 rounded-xl p-3 mt-2">
                            <div className="text-[8px] text-red/60 uppercase font-black tracking-widest mb-1">Reason:</div>
                            <div className="text-[11px] text-red-400 font-bold leading-relaxed">{opp.signalResult?.reason || 'Unknown authorization failure'}</div>
                         </div>
                       )}
                    </div>
                 </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export const ScannerOverlay = React.memo(({ onClose }) => {
  const { scannerResults, activeWindows, config, scannerPaused, gateState, lastScanTs, hibernating, activeTrades } = useTradingStore(state => ({
    scannerResults: state.scannerResults,
    activeWindows: state.activeWindows,
    config: state.config,
    scannerPaused: state.scannerPaused,
    gateState: state.gateState,
    lastScanTs: state.lastScanTs,
    hibernating: state.hibernating,
    activeTrades: state.activeTrades
  }), shallow)
  const threshold = config.scan_pct_threshold || 2.0
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(Date.now())
  const lastUpdateRef = useRef(lastScanTs)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const scanAge = lastScanTs > 0 ? Math.max(0, now - lastScanTs) : null
  const isUpdating = lastScanTs !== lastUpdateRef.current
  if (isUpdating) lastUpdateRef.current = lastScanTs

  const filteredResults = useMemo(() => {
    if (!search) return scannerResults
    const term = search.toLowerCase().trim()
    return scannerResults.filter(r => r.symbol.toLowerCase().includes(term))
  }, [scannerResults, search])

  const filteredWindows = useMemo(() => {
    if (!search) return activeWindows
    const term = search.toLowerCase().trim()
    return activeWindows.filter(w => w.symbol.toLowerCase().includes(term))
  }, [activeWindows, search])

  return (
    <div className="flex flex-col h-full bg-surface text-text overflow-hidden">
      <div className="p-4 border-b border-border flex justify-between items-center shrink-0 h-[64px]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative">
             <PulseDot color={hibernating ? "bg-amber" : scannerPaused ? "bg-red" : "bg-green"} />
             {!hibernating && !scannerPaused && (
               <span className="absolute inset-0 rounded-full border border-green animate-ping opacity-20 scale-150" />
             )}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold hidden sm:inline">Live Scanner</span>
              {hibernating ? (
                <span className="text-[10px] text-amber font-black uppercase tracking-tighter">Deep Sleep</span>
              ) : scannerPaused ? (
                <span className="text-[10px] text-red font-black uppercase tracking-tighter">Gated</span>
              ) : (
                <span className="text-[10px] text-green font-black uppercase tracking-tighter flex items-center gap-1">
                  Active
                  <span className="inline-block w-1 h-1 rounded-full bg-green animate-pulse" />
                </span>
              )}
            </div>
            {lastScanTs > 0 && (
              <div className="flex items-center gap-1.5 opacity-60">
                <span className={cn(
                  "text-[8px] text-dim font-black uppercase tracking-[0.1em] transition-colors duration-500",
                  scanAge < 5000 && "text-green"
                )}>
                  Last Scan: {scanAge < 2000 ? 'Just now' : `${formatDuration(scanAge)} ago`}
                </span>
                {isUpdating && <div className="w-1 h-1 rounded-full bg-green animate-ping" />}
              </div>
            )}
          </div>
          <span className="text-[10px] text-dim font-medium uppercase tracking-wider hidden md:inline ml-2">threshold ≥ {threshold}%</span>
        </div>

        <div className="flex items-center gap-3 flex-1 justify-end max-w-md">
          <div className="relative group flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
            <input
              autoFocus
              type="text"
              placeholder="Search symbols... [/]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
              className="w-full bg-background border border-border rounded-xl pl-9 pr-8 py-1.5 text-[11px] font-bold focus:border-accent outline-none transition-all"
              aria-label="Filter scanner symbols"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                aria-label="Clear filter"
              >
                <XCircle size={14} />
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors shrink-0" aria-label="Close scanner">
            <X size={18} className="text-dim" />
          </button>
        </div>
      </div>

      <div className={cn(
        "bg-accent/5 border-b border-border overflow-x-auto no-scrollbar shrink-0 transition-all duration-300 ease-in-out",
        filteredWindows.length > 0 ? "h-[42px] p-2.5 opacity-100" : "h-0 p-0 opacity-0 border-none"
      )}>
        <div className="flex gap-4">
          {filteredWindows.map((window) => (
            <div key={window.symbol} className="flex items-center gap-1.5 px-2 py-1 bg-surface border border-border rounded whitespace-nowrap h-[26px]">
              <strong className={cn("text-[11px] font-mono", window.direction === 'long' ? "text-green" : "text-red")}>
                {window.symbol}
              </strong>
              <span className="text-[10px] text-dim font-mono">{Math.round(window.remaining_ms / 1000)}s</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[30px_100px_1fr_60px_1fr_1fr_50px] items-center px-4 py-2 text-[10px] text-dim font-bold tracking-widest border-b border-border bg-surface/50 sticky top-0 uppercase h-[36px] shrink-0 md:grid hidden">
        <span>#</span>
        <div className="flex flex-col">
          <span>Symbol</span>
          <span className="text-[8px] text-dim/60 normal-case tracking-normal">Top 15 results</span>
        </div>
        <div className="flex justify-end">
          <Tooltip content="Price change % since the last scan interval.">
            <span className="cursor-help border-b border-dotted border-dim/30">Move</span>
          </Tooltip>
        </div>
        <div className="flex justify-center">
          <Tooltip content="Recent price action history (Sparkline).">
            <span className="cursor-help border-b border-dotted border-dim/30">Trend</span>
          </Tooltip>
        </div>
        <div className="flex justify-end">
          <Tooltip content="24-hour trading volume in USDT.">
            <span className="cursor-help border-b border-dotted border-dim/30">Volume</span>
          </Tooltip>
        </div>
        <div className="flex justify-end px-2">
          <Tooltip content="Internal engine ranking based on volatility, trend, and volume.">
            <span className="cursor-help border-b border-dotted border-dim/30">Score</span>
          </Tooltip>
        </div>
        <div className="flex justify-center">
          <Tooltip content="Gating status: PASS if the symbol meets the minimum momentum threshold.">
            <span className="cursor-help border-b border-dotted border-dim/30">Pass</span>
          </Tooltip>
        </div>
      </div>

      {/* Mobile Header (Simplified) */}
      <div className="grid grid-cols-[30px_1fr_80px_60px] items-center px-4 py-2 text-[10px] text-dim font-bold tracking-widest border-b border-border bg-surface/50 sticky top-0 uppercase h-[36px] shrink-0 md:hidden">
        <span>#</span>
        <span>Symbol</span>
        <div className="flex justify-end">
          <Tooltip content="Price change % since the last scan interval.">
            <span className="cursor-help border-b border-dotted border-dim/30">Move</span>
          </Tooltip>
        </div>
        <div className="flex justify-center">
          <Tooltip content="Gating status: PASS if the symbol meets the minimum momentum threshold.">
            <span className="cursor-help border-b border-dotted border-dim/30">Pass</span>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar min-h-0">
        {scannerResults.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-dim gap-3 py-20">
             <Loader2 size={24} className="animate-spin opacity-20" />
             <div className="text-[13px] font-bold uppercase tracking-widest opacity-40 italic">Initializing scanner...</div>
          </div>
        ) : filteredResults.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in duration-300">
            <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center mb-4 text-dim/20">
              <Search size={24} />
            </div>
            <div className="text-[13px] text-dim font-bold uppercase tracking-widest">No matching symbols</div>
            <p className="text-[11px] text-dim/60 mt-1">Try adjusting your filter or search for another pair.</p>
            <button
              onClick={() => setSearch('')}
              className="mt-6 px-6 py-2 bg-accent/10 border border-accent/20 text-accent rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-accent/20 transition-all active:scale-95"
            >
              Clear Filter
            </button>
          </div>
        ) : (
          filteredResults.map((opp, i) => {
            const passing = Math.abs(opp.pct) >= threshold
            const dir = (opp.dir || opp.direction || '').toLowerCase()
            const isLong = dir ? dir === 'long' : opp.pct >= 0
            const isSingleMonitor = config?.single_symbol_configs?.some(sc => sc.symbol === opp.symbol && sc.enabled)

            return (
              <div key={opp.symbol}
                className={cn(
                  "grid grid-cols-[30px_1fr_80px_60px] md:grid-cols-[30px_100px_1fr_60px_1fr_1fr_50px] items-center px-4 py-3 border-b border-border/50 transition-all h-[56px] group",
                  !passing && "opacity-45 grayscale-[0.5]",
                  isSingleMonitor && "bg-accent/5",
                  passing && "hover:bg-white/5 active:bg-white/10"
                )}>
                <div className="flex flex-col justify-center">
                  <span className="text-[11px] text-dim font-mono leading-none">#{i + 1}</span>
                  {opp.volume_rank && (
                    <div className="mt-1">
                      <Tooltip content={`Volume Rank: This symbol is #${opp.volume_rank} in 24h volume among tracked assets.`}>
                         <span className="text-[7px] md:text-[8px] bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded text-accent font-black uppercase tracking-tighter cursor-help shadow-sm">
                            V#{opp.volume_rank}
                         </span>
                      </Tooltip>
                    </div>
                  )}
                </div>
                <div className="flex flex-col justify-center overflow-hidden">
                   <div className="flex items-baseline gap-0.5">
                     <span className="text-[14px] font-bold font-mono truncate">{opp.symbol.replace("USDT", "")}</span>
                     <span className="text-[9px] text-dim font-mono opacity-50">/U</span>
                     <CopyButton value={opp.symbol} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ml-1" />
                   </div>
                   {isSingleMonitor && (
                     <div className="flex items-center gap-1 mt-0.5">
                        <ShieldCheck size={10} className="text-accent" />
                        <span className="text-[8px] font-bold text-accent uppercase tracking-tighter">Monitored</span>
                     </div>
                   )}
                </div>
                <div className="flex flex-col items-end">
                  <span className={cn(
                    "text-[14px] font-bold font-mono",
                    isLong ? "text-green" : "text-red"
                  )}>
                    {isLong ? "+" : "-"}{Number(Math.abs(opp.pct || 0)).toFixed(2)}%
                  </span>
                  <div className="md:hidden mt-1">
                    <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={40} height={12} />
                  </div>
                </div>
                <div className="md:flex justify-center hidden">
                  <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={40} height={16} />
                </div>
                <span className="text-[11px] text-dim font-mono text-right md:block hidden">{fmtVol(opp.vol)}</span>
                <div className="md:flex items-center gap-2 px-2 overflow-hidden hidden">
                  <div className="flex-1 h-1 bg-border rounded-full overflow-hidden min-w-[20px]">
                    <div className="h-full bg-accent rounded-full" style={{ width: `${(Number(opp.score || 0) / 10) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-dim font-mono whitespace-nowrap">{Number(opp.score || 0).toFixed(1)}</span>
                </div>
                <div className="flex justify-center">
                  <Tooltip content={
                    !passing ? "Below momentum threshold. Awaiting stronger price action." :
                    opp.signalResult && !opp.signalResult.allFired ? `Signal Failed: ${opp.signalResult.reason}` :
                    "Meets all criteria for automated entry."
                  }>
                    {!passing
                      ? <span className="px-2 py-0.5 rounded bg-surface text-dim text-[9px] font-black uppercase tracking-tighter border border-border cursor-help">WAIT</span>
                      : opp.signalResult && !opp.signalResult.allFired
                      ? <span className="px-2 py-0.5 rounded bg-amber/10 text-amber text-[9px] font-black uppercase tracking-tighter border border-amber/20 cursor-help">REJECT</span>
                      : <span className="px-2 py-0.5 rounded bg-green/10 text-green text-[9px] font-black uppercase tracking-tighter border border-green/20 cursor-help">PASS</span>
                    }
                  </Tooltip>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="p-4 border-t border-border bg-surface/50 text-[10px] text-dim font-bold uppercase tracking-[0.2em] text-center shrink-0 flex items-center justify-center gap-2">
        <span className="w-1 h-1 rounded-full bg-green animate-pulse" />
        Live Feed: !miniTicker · kline · Real-time
      </div>
    </div>
  )
})
