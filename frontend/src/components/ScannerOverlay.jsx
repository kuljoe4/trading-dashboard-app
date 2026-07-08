import React, { useState, useMemo, useEffect, useRef } from 'react'
import { fmtVol } from '../lib/theme'
import { formatDuration } from '../lib/formatters'
import { PulseDot, Sparkline, cn, CopyButton, Tooltip, CandlestickChart } from './ui/primitives'
import { useTradingStore } from '../store/trading'
import { X, Search, ShieldCheck, XCircle, Zap, AlertCircle, ChevronDown, ChevronUp, Activity, CheckCircle2, Loader2, LayoutGrid, TrendingUp, Clock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { shallow } from 'zustand/shallow'

const FreshnessIndicator = React.memo(({ ts }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!ts || ts <= 0) return null;
  const age = Math.max(0, now - ts);

  return (
    <Tooltip content={`Telemetry timestamped ${formatDuration(age)} ago`}>
      <div className={cn("w-1.5 h-1.5 rounded-full cursor-help transition-colors duration-500", age < 5000 ? "bg-green" : "bg-amber/40")} />
    </Tooltip>
  );
});
FreshnessIndicator.displayName = 'FreshnessIndicator';

const ScannerRow = React.memo(({ opp, i, config, activeTrades, isMonitored, scannerPaused, hibernating, lastScanTs }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const threshold = config?.scan_pct_threshold || 2.0;
  const dir = (opp.dir || opp.direction || '').toLowerCase();
  const isLong = dir ? dir === 'long' : opp.pct >= 0;
  const passing = Math.abs(opp.pct) >= threshold;
  const isSingleMonitor = isMonitored ?? config?.single_symbol_configs?.some(sc => sc.symbol === opp.symbol && sc.enabled);

  const getStatus = () => {
    if (opp.score > 85 && opp.signalResult?.allFired) return { label: 'Strong Setup', color: 'bg-green/10 text-green border-green/20' };
    if (opp.signalResult?.allFired) return { label: 'Ready', color: 'bg-accent/10 text-accent border-accent/20' };
    if (passing) return { label: 'Watching', color: 'bg-amber/10 text-amber border-amber/20' };
    return { label: 'Waiting', color: 'bg-surface text-dim border-border' };
  };

  const status = getStatus();
  const proximity = Math.min(100, (Math.abs(opp.pct) / threshold) * 100).toFixed(0);

  const summarySentence = useMemo(() => {
    const dirText = isLong ? "Momentum" : "Downward pressure";
    if (opp.score > 85 && opp.signalResult?.allFired) return `High-confidence ${dirText.toLowerCase()} and trend align perfectly.`;
    if (opp.signalResult?.allFired) return `${dirText} and trend align, all technical signals have triggered.`;
    if (passing) return `${dirText} is strong, currently nearing the trigger threshold.`;
    return `Symbol is stable; awaiting expansion toward ${threshold}% threshold.`;
  }, [isLong, opp.score, opp.signalResult?.allFired, passing, threshold]);

  // DEBUG: Track telemetry presence in expanded state to identify synchronization gaps
  useEffect(() => {
    if (config?.debug_mode && isExpanded && (!opp.ohlc_history || opp.ohlc_history.length === 0)) {
      console.warn(`[Scanner Debug] Expanded ${opp.symbol} has no telemetry. Gated: ${scannerPaused}, Hibernating: ${hibernating}, LastScan: ${lastScanTs}`);
    }
  }, [isExpanded, opp.symbol, opp.ohlc_history, scannerPaused, hibernating, lastScanTs, config?.debug_mode]);
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="flex flex-col border-b border-border/50">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className={cn(
          "grid grid-cols-[30px_1fr_80px_60px] md:grid-cols-[30px_100px_1fr_60px_1fr_1fr_50px] items-center px-4 py-3 transition-all h-[56px] group cursor-pointer outline-none focus-visible:bg-white/5",
          !passing && "opacity-45 grayscale-[0.5]",
          isSingleMonitor && "bg-accent/5",
          passing && "hover:bg-white/5 active:bg-white/10",
          isExpanded && "bg-white/[0.02]"
        )}>
        <div className="flex flex-col justify-center gap-1">
          <span className="text-[10px] text-dim font-black font-mono leading-none opacity-40 group-hover:opacity-100 transition-opacity">{(i + 1).toString().padStart(2, '0')}</span>
          {opp.volume_rank && (
            <div className="flex items-center">
              <span className="text-[8px] bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded-[4px] text-accent font-black uppercase tracking-tighter shadow-sm">
                V{opp.volume_rank}
              </span>
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
              <div className="flex items-center gap-1">
                 <Zap size={10} className="text-green fill-green/20" />
                 <span className="text-[8px] font-bold text-green uppercase tracking-tighter">In Pos</span>
              </div>
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
                  <span className="font-mono text-accent">{(config?.scanner_weights?.momentum * (opp.score_breakdown?.momentum || 0)).toFixed(1)}</span>
               </div>
               <div className="flex justify-between items-center text-[10px]">
                  <span className="text-dim uppercase font-bold">Volatility</span>
                  <span className="font-mono text-amber">{(config?.scanner_weights?.volatility * (opp.score_breakdown?.volatility || 0)).toFixed(1)}</span>
               </div>
               <div className="flex justify-between items-center text-[10px]">
                  <span className="text-dim uppercase font-bold">Trend</span>
                  <span className="font-mono text-purple-400">{(config?.scanner_weights?.trend * (opp.score_breakdown?.trend || 0)).toFixed(1)}</span>
               </div>
               <div className="border-t border-white/10 pt-1 flex justify-between items-center font-black">
                  <span className="text-[9px] uppercase tracking-tighter">Total</span>
                  <span className={cn("text-[11px] font-mono", opp.score > 85 ? "text-accent" : "text-white")}>{Number(opp.score || 0).toFixed(1)}</span>
               </div>
            </div>
          }>
            <div className="flex-1 flex items-center gap-2 cursor-help" aria-label="Score breakdown bar">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden flex min-w-[40px] border border-white/5">
                <div className="h-full bg-accent/80" style={{ width: `${(config?.scanner_weights?.momentum || 0.5) * (opp.score_breakdown?.momentum || 0)}%` }} aria-label={`Momentum component: ${opp.score_breakdown?.momentum?.toFixed(1)}%`} />
                <div className="h-full bg-amber/80" style={{ width: `${(config?.scanner_weights?.volatility || 0.3) * (opp.score_breakdown?.volatility || 0)}%` }} aria-label={`Volatility component: ${opp.score_breakdown?.volatility?.toFixed(1)}%`} />
                <div className="h-full bg-purple/80" style={{ width: `${(config?.scanner_weights?.trend || 0.2) * (opp.score_breakdown?.trend || 0)}%` }} aria-label={`Trend component: ${opp.score_breakdown?.trend?.toFixed(1)}%`} />
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
          <div className="hidden lg:flex items-center gap-1 mr-4">
             <div className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] font-bold text-text/90 font-mono leading-none">{proximity}%</span>
                <span className="text-[7px] text-dim font-black uppercase tracking-widest leading-none">Prox</span>
             </div>
          </div>
          <span className={cn("px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border min-w-[70px] text-center transition-colors", status.color)}>
            {status.label}
          </span>
          <div className="hidden md:block opacity-0 group-hover:opacity-100 transition-opacity ml-2">
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
            <div className="bg-white/5 border-b border-white/5 px-6 py-2.5 flex items-center justify-between">
               <div className="flex items-center gap-3">
                 <div className={cn("px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm", status.color)}>
                   {status.label}
                 </div>
                 <span className="text-[11px] text-dim font-medium italic opacity-80">{summarySentence}</span>
               </div>
               {opp.score > 85 && (
                 <div className="flex items-center gap-2">
                    <Zap size={12} className="text-accent fill-accent animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-accent">High Authority</span>
                 </div>
               )}
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-white/5">
              <div className="flex flex-col gap-4">
                <div className="text-[10px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-2 px-1">
                   <Activity size={12} className="text-accent" /> Signal Visualization
                </div>
                <div className="bg-surface/50 border border-border rounded-2xl p-5 flex items-center justify-center min-h-[180px] relative overflow-hidden group/viz">
                   <div className="absolute inset-0 opacity-[0.03] pointer-events-none group-hover/viz:opacity-[0.05] transition-opacity" style={{ backgroundImage: 'radial-gradient(var(--color-accent) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
                   {Array.isArray(opp.ohlc_history) && opp.ohlc_history.length >= 2 ? (
                     <div className="w-full flex flex-col items-center relative z-10">
                        <CandlestickChart data={opp.ohlc_history} width={360} height={140} />
                        <div className="flex justify-between w-full mt-6 px-2">
                           <div className="flex flex-col">
                              <span className="text-[9px] text-dim uppercase font-black tracking-widest mb-1">Entry Level</span>
                              <span className="text-sm font-mono font-black text-text/90">${opp.price.toLocaleString()}</span>
                           </div>
                           <div className="flex flex-col items-end">
                              <span className="text-[9px] text-dim uppercase font-black tracking-widest mb-1">Delta</span>
                              <span className={cn("text-sm font-mono font-black", isLong ? "text-green" : "text-red")}>
                                {isLong ? "▲" : "▼"} {Number(Math.abs(opp.pct || 0)).toFixed(2)}%
                              </span>
                           </div>
                        </div>
                     </div>
                   ) : (
                     <div className="flex flex-col items-center gap-4 py-4">
                        <div className="relative">
                          <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-inner">
                             {hibernating ? <Zap size={28} className="text-amber/40 animate-pulse" /> : <Activity size={28} className="text-dim/20 animate-pulse" />}
                          </div>
                          <div className={cn(
                            "absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-surface flex items-center justify-center",
                            hibernating ? "bg-amber" : scannerPaused ? "bg-red" : "bg-accent"
                          )}>
                            <div className="w-1 h-1 rounded-full bg-white animate-ping" />
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="text-[11px] text-dim font-black uppercase tracking-[0.2em] animate-pulse text-center leading-none">
                             {hibernating ? "Deep Sleep" : scannerPaused ? "Scanner Gated" : "Synchronizing"}
                          </div>
                          <p className="text-[9px] text-dim/40 font-bold uppercase tracking-tight text-center">
                            {hibernating ? "Market telemetry paused to save resources" : scannerPaused ? "Awaiting next valid window" : "Establishing authoritative data link..."}
                          </p>
                        </div>
                     </div>
                   )}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                 <div className="text-[10px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-2 px-1">
                   <LayoutGrid size={12} className="text-accent" /> Intelligence Score
                 </div>
                 <div className="bg-surface/50 border border-border rounded-2xl p-6 flex flex-col gap-5 relative overflow-hidden group/scoring shadow-sm" role="group" aria-label="Detailed score breakdown">
                    <div className="absolute -top-4 -right-4 p-8 opacity-[0.03] group-hover/scoring:opacity-10 transition-opacity">
                       <TrendingUp size={120} className="text-accent" />
                    </div>

                    <div className="space-y-6 relative z-10">
                       {[
                         { label: 'Momentum', value: opp.score_breakdown?.momentum, color: 'bg-accent', text: 'text-accent' },
                         { label: 'Volatility', value: opp.score_breakdown?.volatility, color: 'bg-amber', text: 'text-amber' },
                         { label: 'Trend Strength', value: opp.score_breakdown?.trend, color: 'bg-purple-400', text: 'text-purple-400' }
                       ].map((metric) => (
                        <div key={metric.label} className="space-y-2.5">
                          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                             <span className="text-dim/80">{metric.label}</span>
                             <span className={cn(metric.text)}>{metric.value?.toFixed(1) || '0.0'}%</span>
                          </div>
                          <div className="h-2 bg-background/80 rounded-full overflow-hidden border border-white/5 shadow-inner">
                             <motion.div
                               initial={{ width: 0 }}
                               animate={{ width: `${metric.value || 0}%` }}
                               transition={{ type: "spring", stiffness: 50, damping: 20 }}
                               className={cn("h-full shadow-[0_0_12px_rgba(var(--accent-rgb),0.3)]", metric.color)}
                             />
                          </div>
                        </div>
                       ))}

                       <div className="pt-4 mt-2 border-t border-border/40 flex justify-between items-end">
                          <div className="flex flex-col">
                             <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] text-dim font-black uppercase tracking-[0.2em]">Composite Authority</span>
                                <FreshnessIndicator ts={opp.lastUpdate} />
                             </div>
                             <div className="flex items-baseline gap-2">
                                <span className={cn("text-3xl font-mono font-black tracking-tighter leading-none", opp.score > 85 ? "text-accent shadow-accent/20" : "text-text")}>
                                   {opp.score.toFixed(1)}
                                </span>
                                <span className="text-[10px] text-dim font-bold uppercase tracking-widest opacity-40">/ 100</span>
                             </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                             <div className="text-[8px] text-dim/60 font-black uppercase tracking-tighter">Engine Logic Weighting</div>
                             <div className="px-2 py-1 rounded-md bg-background border border-border/50 font-mono text-[9px] font-bold text-text/60">
                                {config.scanner_weights ? `${(config.scanner_weights.momentum*100).toFixed(0)}:${(config.scanner_weights.volatility*100).toFixed(0)}:${(config.scanner_weights.trend*100).toFixed(0)}` : '50:30:20'}
                             </div>
                          </div>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="flex flex-col gap-4">
                 <div className="text-[10px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-2 px-1">
                   <ShieldCheck size={12} className="text-accent" /> Security Audit
                 </div>
                 <div className="bg-surface/50 border border-border rounded-2xl p-6 flex flex-col gap-6 h-full relative overflow-hidden group/audit">
                    <div className={cn(
                      "absolute top-0 right-0 w-32 h-32 blur-3xl opacity-[0.05] transition-opacity group-hover/audit:opacity-[0.08]",
                      opp.signalResult?.allFired ? "bg-green" : "bg-red"
                    )} />

                    <div className="flex items-center gap-4 relative z-10">
                       <div className={cn(
                         "w-12 h-12 rounded-2xl flex items-center justify-center border shadow-2xl transition-transform duration-500 group-hover/audit:scale-110",
                         opp.signalResult?.allFired ? "bg-green text-white border-green/30 shadow-green/20" : "bg-red text-white border-red/30 shadow-red/20"
                       )}>
                         {opp.signalResult?.allFired ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
                       </div>
                       <div className="flex flex-col gap-0.5">
                          <div className="text-[13px] font-black uppercase tracking-tight">
                             {opp.signalResult?.allFired ? 'Authorization Passed' : 'Authorization Denied'}
                          </div>
                          <div className="text-[9px] text-dim font-black uppercase tracking-widest opacity-60">
                             Engine Integrity Verified
                          </div>
                       </div>
                    </div>

                    <div className="space-y-4 relative z-10">
                       <div className="p-4 bg-background/50 rounded-xl border border-border/40 flex flex-col gap-3">
                          <div className="flex justify-between items-center text-[10px] font-bold">
                             <div className="flex items-center gap-2">
                               <div className="w-1.5 h-1.5 rounded-full bg-green shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
                               <span className="text-dim uppercase tracking-widest">Velocity Threshold</span>
                             </div>
                             <span className="text-text font-mono">OK (≥{threshold}%)</span>
                          </div>
                          <div className="h-px bg-border/20" />
                          <div className="flex justify-between items-center text-[10px] font-bold">
                             <div className="flex items-center gap-2">
                               <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_6px_rgba(255,255,255,0.2)]", opp.signalResult?.allFired ? "bg-green" : "bg-red")} />
                               <span className="text-dim uppercase tracking-widest">Pattern Recognition</span>
                             </div>
                             <span className={cn("uppercase tracking-widest font-black", opp.signalResult?.allFired ? "text-green" : "text-red")}>
                                {opp.signalResult?.allFired ? 'Patterns Verified' : 'Rejected'}
                             </span>
                          </div>
                       </div>

                       {!opp.signalResult?.allFired && (
                         <div className="bg-red/10 border border-red/20 rounded-xl p-4 animate-in fade-in slide-in-from-top-1 duration-500">
                            <div className="flex items-center gap-2 text-[9px] text-red font-black uppercase tracking-widest mb-2">
                               <XCircle size={12} /> Rejection Analysis
                            </div>
                            <div className="text-[11px] text-red-400/90 font-bold leading-relaxed italic pr-2 border-l-2 border-red/30 pl-3">
                               "{opp.signalResult?.reason || 'Critical authorization failure detected'}"
                            </div>
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
  const lastUpdateRef = useRef(lastScanTs)

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const scanAge = lastScanTs > 0 ? Math.max(0, now - lastScanTs) : null
  const isUpdating = lastScanTs !== lastUpdateRef.current
  if (isUpdating) lastUpdateRef.current = lastScanTs

  const filteredResults = useMemo(() => {
    const results = Array.isArray(scannerResults) ? scannerResults.filter(Boolean) : []
    if (!search) return results
    const term = search.toLowerCase().trim()
    return results.filter(r => r.symbol.toLowerCase().includes(term))
  }, [scannerResults, search])

  const filteredWindows = useMemo(() => {
    const windows = Array.isArray(activeWindows) ? activeWindows.filter(Boolean) : []
    if (!search) return windows
    const term = search.toLowerCase().trim()
    return windows.filter(w => w.symbol.toLowerCase().includes(term))
  }, [activeWindows, search])

  // BOLT OPTIMIZATION: Pre-calculate a Set of monitored symbols to avoid O(N*M) lookup in the render loop.
  // Reduces complexity from O(N*M) to O(N+M), improving render performance when many symbols are monitored.
  const monitoredSymbols = useMemo(() => {
    const set = new Set();
    config?.single_symbol_configs?.forEach(sc => {
      if (sc.enabled) set.add(sc.symbol);
    });
    return set;
  }, [config?.single_symbol_configs]);

  return (
    <div className="flex flex-col h-full bg-surface text-text overflow-hidden">
      <div className="p-4 border-b border-border flex justify-between items-center shrink-0 h-[64px]">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex flex-col">
            <div className="flex items-center gap-2.5">
              <div className="relative flex items-center justify-center w-5 h-5">
                 <PulseDot color={hibernating ? "bg-amber" : scannerPaused ? "bg-red" : "bg-green"} />
                 {!hibernating && !scannerPaused && (
                   <span className="absolute inset-0 rounded-full border border-green animate-ping opacity-20 scale-150" />
                 )}
              </div>
              <span className="text-[15px] font-black tracking-tight hidden sm:inline uppercase">Live Scanner</span>
              <div className="h-4 w-px bg-border/40 hidden sm:block mx-1" />
              {hibernating ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber/10 border border-amber/20 shadow-lg shadow-amber/5">
                  <span className="w-1 h-1 rounded-full bg-amber animate-pulse" />
                  <span className="text-[9px] text-amber font-black uppercase tracking-widest">Deep Sleep</span>
                </div>
              ) : scannerPaused ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red/10 border border-red/20 shadow-lg shadow-red/5">
                  <span className="w-1 h-1 rounded-full bg-red animate-pulse" />
                  <span className="text-[9px] text-red font-black uppercase tracking-widest">Gated</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green/10 border border-green/20 shadow-lg shadow-green/5">
                  <span className="w-1 h-1 rounded-full bg-green animate-pulse" />
                  <span className="text-[9px] text-green font-black uppercase tracking-widest">Active</span>
                </div>
              )}
            </div>
            {lastScanTs > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <Clock size={10} className="text-dim/40" />
                <span className={cn(
                  "text-[9px] text-dim font-bold uppercase tracking-wider transition-colors duration-500",
                  scanAge < 5000 && "text-green"
                )}>
                  {scanAge < 2000 ? 'Just now' : `${formatDuration(scanAge)} ago`}
                </span>
                {isUpdating && <div className="w-1 h-1 rounded-full bg-green animate-ping" />}
              </div>
            )}
          </div>
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
              className="w-full bg-background border border-border rounded-xl pl-9 pr-8 py-1.5 text-[11px] font-bold focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
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
          <button onClick={onClose} className="p-2 hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent outline-none rounded-full transition-colors shrink-0" aria-label="Close scanner">
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
          <span>Move</span>
        </div>
        <div className="flex justify-center">
          <span>Trend</span>
        </div>
        <div className="flex justify-end">
          <span>Volume</span>
        </div>
        <div className="flex justify-end px-2">
          <span>Score</span>
        </div>
        <div className="flex justify-center">
          <span>Status</span>
        </div>
      </div>

      {/* Mobile Header (Simplified) */}
      <div className="grid grid-cols-[30px_1fr_80px_60px] items-center px-4 py-2 text-[10px] text-dim font-bold tracking-widest border-b border-border bg-surface/50 sticky top-0 uppercase h-[36px] shrink-0 md:hidden">
        <span>#</span>
        <span>Symbol</span>
        <div className="flex justify-end">
          <span>Move</span>
        </div>
        <div className="flex justify-center">
          <span>Status</span>
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
          filteredResults.map((opp, i) => (
            <ScannerRow
              key={opp.symbol}
              opp={opp}
              i={i}
              config={config}
              activeTrades={activeTrades}
              isMonitored={monitoredSymbols.has(opp.symbol)}
              scannerPaused={scannerPaused}
              hibernating={hibernating}
              lastScanTs={lastScanTs}
            />
          ))
        )}
      </div>

      <div className="p-4 border-t border-border bg-surface/50 text-[10px] text-dim font-bold uppercase tracking-[0.2em] text-center shrink-0 flex items-center justify-center gap-2">
        <span className="w-1 h-1 rounded-full bg-green animate-pulse" />
        Live Feed: !miniTicker · kline · Real-time
      </div>
    </div>
  )
})
