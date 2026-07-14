import React, { useState, useMemo, useEffect, useRef } from 'react'
import { fmtVol } from '../lib/theme'
import { formatDuration } from '../lib/formatters'
import { PulseDot, Sparkline, cn, CopyButton, Tooltip, CandlestickChart, MonitoredBadge, InPosBadge, SmartCandidateBadge } from './ui/primitives'
import { SignalGauge } from './ui/SignalGauge'
import { useTradingStore } from '../store/trading'
import { X, Search, ShieldCheck, XCircle, Zap, AlertCircle, ChevronDown, ChevronUp, Activity, CheckCircle2, Loader2, LayoutGrid, TrendingUp, Clock, Info, ShieldAlert, RefreshCw } from 'lucide-react'
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

const ActiveWindowsList = React.memo(({ windows }) => {
  if (!windows || windows.length === 0) return (
    <div className="h-0 p-0 opacity-0 border-none transition-all duration-300" />
  );

  return (
    <div className="bg-accent/5 border-b border-border overflow-x-auto no-scrollbar shrink-0 transition-all duration-300 ease-in-out h-[42px] p-2.5 opacity-100">
      <div className="flex gap-4">
        {windows.map((window) => (
          <div key={window.symbol} className="flex items-center gap-1.5 px-2 py-1 bg-surface border border-border rounded whitespace-nowrap h-[26px]">
            <strong className={cn("text-[11px] font-mono", window.direction === 'long' ? "text-green" : "text-red")}>
              {window.symbol}
            </strong>
            <span className="text-[10px] text-dim font-mono">{Math.round(window.remaining_ms / 1000)}s</span>
          </div>
        ))}
      </div>
    </div>
  );
});
ActiveWindowsList.displayName = 'ActiveWindowsList';

const ScanStatus = React.memo(({ lastScanTs, intervalSec = 5, isUpdating }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const scanAge = lastScanTs > 0 ? Math.max(0, now - lastScanTs) : null;
  const nextSlotSec = Math.max(0, intervalSec - Math.floor((scanAge || 0) / 1000));

  return (
    <div className="flex items-center gap-2.5 mt-1">
      {lastScanTs > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <Clock size={10} className="text-dim/40" />
            <span className={cn(
              "text-[9px] text-dim font-bold uppercase tracking-wider transition-colors duration-500",
              scanAge < 5000 && "text-green"
            )}>
              {scanAge < 2000 ? 'Just now' : `${formatDuration(scanAge)} ago`}
            </span>
          </div>
          <div className="w-1 h-1 rounded-full bg-border/40" />
          <div className="flex items-center gap-1.5">
            <RefreshCw size={10} className={cn("text-dim/40", nextSlotSec <= 1 && "animate-spin text-accent/60")} />
            <span className={cn(
              "text-[9px] font-black uppercase tracking-widest tabular-nums",
              nextSlotSec <= 1 ? "text-accent" : "text-dim/60"
            )}>
              Next slot: {nextSlotSec} sec
            </span>
          </div>
          {isUpdating && <div className="w-1 h-1 rounded-full bg-green animate-ping" />}
        </>
      )}
    </div>
  );
});
ScanStatus.displayName = 'ScanStatus';


const buildAuthoritativeMarkers = (ohlc = [], signalResult = {}) => {
  if (!Array.isArray(ohlc) || !signalResult) return [];
  const engulfing = signalResult.details?.engulfing;
  if (!engulfing || engulfing.streak_start_ts === undefined) return [];

  const markers = [];
  const startTs = engulfing.streak_start_ts;
  const endTs = engulfing.streak_end_ts;

  let sCount = 1;
  (ohlc || []).forEach((candle, idx) => {
    const ts = candle.time || candle.t;
    if (ts >= startTs && ts <= endTs) {
      markers.push({ index: idx, label: `S${sCount++}`, color: '#64748b' });
    }
  });

  if (signalResult.fired) {
     const signalCandleTs = engulfing.unit === 'price' ? ohlc[ohlc.length - 2]?.time : ohlc[ohlc.length - 1]?.time;
     const sigIdx = ohlc.findIndex(c => (c.time || c.t) === signalCandleTs);
     if (sigIdx !== -1) {
        markers.push({ index: sigIdx, label: 'CONF', color: '#00e5a0' });
     }
  }

  return markers;
};

const FunnelStep = React.memo(({ label, detail, complete, icon: Icon }) => (
  <div className={cn(
    "relative flex items-start gap-3 rounded-2xl border p-3 transition-colors",
    complete ? "bg-green/5 border-green/20" : "bg-background/30 border-border/70"
  )}>
    <div className={cn(
      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border",
      complete ? "bg-green/10 border-green/30 text-green" : "bg-surface border-border text-dim"
    )}>
      <Icon size={15} />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-text/90">{label}</div>
      <div className="mt-1 text-[10px] font-semibold leading-snug text-dim">{detail}</div>
    </div>
  </div>
));

const ScannerRow = React.memo(({ opp, i, config, isInPosition, isMonitored, scannerPaused, hibernating, hibernationMode }) => {
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
  const proximity = Number(Math.min(100, (Math.abs(opp.pct || 0) / (threshold || 1)) * 100)).toFixed(0);

  const summarySentence = useMemo(() => {
    const dirText = isLong ? "Momentum" : "Downward pressure";
    if (opp.score > 85 && opp.signalResult?.allFired) return `High-confidence ${dirText.toLowerCase()} and trend align perfectly.`;
    if (opp.signalResult?.allFired) return `${dirText} and trend align, all technical signals have triggered.`;
    if (passing) return `${dirText} is strong, currently nearing the trigger threshold.`;
    return `Symbol is stable; awaiting expansion toward ${threshold}% threshold.`;
  }, [isLong, opp.score, opp.signalResult?.allFired, passing, threshold]);

  const signalStatus = opp.signalResult || {};
  const checklistSignals = opp.signalResult?.signals || {};
  const engulfingEnabled = (config?.enabled_signals || []).includes('engulfing');
  const decisionMarkers = engulfingEnabled ? buildAuthoritativeMarkers(opp.ohlc_history, signalStatus) : [];
  const engulfSignal = checklistSignals.engulfing;

  // BOLT: Determine the prospective Stop Loss price for visualization on the chart.
  // Prioritizes structural streak extremes if configured, falls back to pct-based distance.
  const chartSl = useMemo(() => {
    if (config?.sl_type === 'streak_extreme' || config?.sl_type === 'engulfing_boundary') {
       return engulfSignal?.slPrice || (isLong ? engulfSignal?.pattern_low : engulfSignal?.pattern_high);
    }
    if (config?.sl_type === 'lookback_low/high') {
       return checklistSignals.breakout_hl?.slPrice;
    }
    if (config?.sl_type === 'pct') {
       const dist = opp.price * ((config.sl_distance_pct || 0.8) / 100);
       return isLong ? opp.price - dist : opp.price + dist;
    }
    return null;
  }, [config, opp.price, isLong, engulfSignal, checklistSignals.breakout_hl]);

  const closeEngulfEnabled = engulfingEnabled && config?.signal_params?.engulfing_mode?.startsWith('close');
  const funnelSteps = [
    { label: 'Momentum Scan', detail: `${Number(Math.abs(opp.pct || 0)).toFixed(2)}% move vs ${Number(threshold || 0).toFixed(2)}% threshold`, complete: passing, icon: TrendingUp },
    { label: 'Signal Context', detail: closeEngulfEnabled ? `Last closed candle close must clear ${config?.engulfing_lookback || 2} reverse candle ${isLong ? 'highs' : 'lows'}.` : 'Uses configured technical entry signals.', complete: closeEngulfEnabled ? !!engulfSignal?.fired : !!opp.signalResult?.allFired, icon: Activity },
    { label: 'Authorization', detail: opp.signalResult?.reason || 'Waiting for signal engine decision.', complete: !!opp.signalResult?.allFired, icon: ShieldCheck },
  ];

  // DEBUG: Track telemetry presence in expanded state to identify synchronization gaps
  useEffect(() => {
    if (config?.debug_mode && isExpanded && (!opp.ohlc_history || opp.ohlc_history.length === 0)) {
      console.warn(`[Scanner Debug] Expanded ${opp.symbol} has no telemetry. Gated: ${scannerPaused}, Hibernating: ${hibernating}`);
    }
  }, [isExpanded, opp.symbol, opp.ohlc_history, scannerPaused, hibernating, config?.debug_mode]);
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
          "flex md:grid md:grid-cols-[30px_100px_1fr_60px_1fr_1fr_50px] items-center px-4 py-3 transition-all h-[56px] group cursor-pointer outline-none focus-visible:bg-white/5",
          !passing && "opacity-45 grayscale-[0.5]",
          isSingleMonitor && "bg-accent/5",
          passing && "hover:bg-white/5 active:bg-white/10",
          isExpanded && "bg-white/[0.02]"
        )}>
        <div className="flex flex-col justify-center gap-1 w-7 shrink-0 md:w-auto md:shrink">
          <span className="text-[10px] text-dim font-black font-mono leading-none opacity-40 group-hover:opacity-100 transition-opacity">{(i + 1).toString().padStart(2, '0')}</span>
          {opp.volume_rank && (
            <div className="flex items-center">
              <span className="text-[8px] bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded-[4px] text-accent font-black uppercase tracking-tighter shadow-sm">
                V{opp.volume_rank}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col justify-center overflow-hidden flex-1 md:flex-none">
           <div className="flex items-baseline gap-0.5">
             <span className="text-[14px] font-bold font-mono truncate">{opp.symbol.replace("USDT", "")}</span>
             <span className="text-[9px] text-dim font-mono opacity-50">/U</span>
             <CopyButton value={opp.symbol} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ml-1" />
           </div>
           <div className="flex items-center gap-1.5 mt-0.5 h-3.5">
            {isInPosition && (
              <InPosBadge />
            )}
            {opp.is_smart_candidate && (
              <SmartCandidateBadge />
            )}
            {isSingleMonitor && (
              <MonitoredBadge />
            )}
           </div>
        </div>
        <div className="flex flex-col items-end w-16 shrink-0 md:w-auto md:shrink">
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
        <div className="md:flex items-center gap-2 px-2 overflow-hidden hidden" role="region" aria-label={`Opportunity score for ${opp.symbol}: ${Number(opp.score || 0).toFixed(1)}`}>
          <Tooltip content={
            <div className="flex flex-col gap-2 p-1 min-w-[120px]">
               <div className="text-[10px] font-black uppercase tracking-widest border-b border-white/10 pb-1">Score Breakdown</div>
               <div className="flex justify-between items-center text-[10px]">
                  <span className="text-dim uppercase font-bold">Momentum</span>
                  <span className="font-mono text-accent">{Number((config?.scanner_weights?.momentum || 0) * (opp.score_breakdown?.momentum || 0)).toFixed(1)}</span>
               </div>
               <div className="flex justify-between items-center text-[10px]">
                  <span className="text-dim uppercase font-bold">Volatility</span>
                  <span className="font-mono text-amber">{Number((config?.scanner_weights?.volatility || 0) * (opp.score_breakdown?.volatility || 0)).toFixed(1)}</span>
               </div>
               <div className="flex justify-between items-center text-[10px]">
                  <span className="text-dim uppercase font-bold">Trend</span>
                  <span className="font-mono text-purple-400">{Number((config?.scanner_weights?.trend || 0) * (opp.score_breakdown?.trend || 0)).toFixed(1)}</span>
               </div>
               <div className="border-t border-white/10 pt-1 flex justify-between items-center font-black">
                  <span className="text-[9px] uppercase tracking-tighter">Total</span>
                  <span className={cn("text-[11px] font-mono", opp.score > 85 ? "text-accent" : "text-white")}>{Number(opp.score || 0).toFixed(1)}</span>
               </div>
            </div>
          }>
            <div className="flex-1 flex items-center gap-2 cursor-help" aria-label="Score breakdown bar">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden flex min-w-[40px] border border-white/5">
                <div className="h-full bg-accent/80" style={{ width: `${(config?.scanner_weights?.momentum || 0.5) * (opp.score_breakdown?.momentum || 0)}%` }} aria-label={`Momentum component: ${Number(opp.score_breakdown?.momentum || 0).toFixed(1)}%`} />
                <div className="h-full bg-amber/80" style={{ width: `${(config?.scanner_weights?.volatility || 0.3) * (opp.score_breakdown?.volatility || 0)}%` }} aria-label={`Volatility component: ${Number(opp.score_breakdown?.volatility || 0).toFixed(1)}%`} />
                <div className="h-full bg-purple/80" style={{ width: `${(config?.scanner_weights?.trend || 0.2) * (opp.score_breakdown?.trend || 0)}%` }} aria-label={`Trend component: ${Number(opp.score_breakdown?.trend || 0).toFixed(1)}%`} />
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
        <div className="flex justify-end md:justify-center items-center gap-2 w-20 shrink-0 md:w-auto md:shrink">
          <div className="hidden lg:flex items-center gap-1 mr-4">
             <div className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] font-bold text-text/90 font-mono leading-none">{proximity}%</span>
                <span className="text-[7px] text-dim font-black uppercase tracking-widest leading-none">Prox</span>
             </div>
          </div>
          <span className={cn("px-1.5 md:px-2 py-0.5 rounded text-[8px] md:text-[9px] font-black uppercase tracking-tighter border min-w-[60px] md:min-w-[70px] text-center transition-colors", status.color)}>
            {status.label}
          </span>
          <div className="hidden md:block opacity-0 group-hover:opacity-100 transition-opacity ml-1 md:ml-2">
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
            <div className="bg-white/5 border-b border-white/5 px-4 md:px-6 py-2.5 flex items-center justify-between gap-3">
               <div className="flex items-center gap-2 md:gap-3 min-w-0">
                 <div className={cn("px-2 py-0.5 md:px-2.5 md:py-1 rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-widest border shadow-sm shrink-0", status.color)}>
                   {status.label}
                 </div>
                 <span className="text-[10px] md:text-[11px] text-dim font-medium italic opacity-80 truncate">{summarySentence}</span>
               </div>
               {opp.score > 85 && (
                 <div className="flex items-center gap-2">
                    <Zap size={12} className="text-accent fill-accent animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-accent">High Authority</span>
                 </div>
               )}
            </div>
            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8 border-t border-white/5">
              {/* Panel 1: Timeline & Overlays */}
              <div className="flex flex-col gap-4">
                <div className="text-[10px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-2 px-1">
                   <Activity size={12} className="text-accent" /> Timeline & Overlays
                </div>
                <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-5 flex items-center justify-center min-h-[260px] md:min-h-[300px] relative overflow-hidden group/viz">
                   <div className="absolute inset-0 opacity-[0.03] pointer-events-none group-hover/viz:opacity-[0.05] transition-opacity" style={{ backgroundImage: 'radial-gradient(var(--color-accent) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
                   {Array.isArray(opp.ohlc_history) && opp.ohlc_history.length >= 2 ? (
                     <div className="w-full flex flex-col items-center relative z-10">
                        <CandlestickChart
                          data={opp.ohlc_history}
                          height={180}
                          threshold={threshold}
                          isLong={isLong}
                          entryPrice={opp.price}
                          signals={opp.ohlc_history.filter(d => signalStatus.firedSignals?.includes(d.time))}
                          decisionMarkers={decisionMarkers}
                          slPrice={chartSl}
                        />
                        <div className="flex justify-between w-full mt-4 md:mt-6 px-1 md:px-2">
                           <div className="flex flex-col">
                              <span className="text-[8px] md:text-[9px] text-dim uppercase font-black tracking-widest mb-0.5 md:mb-1">Entry Level</span>
                              <span className="text-xs md:text-sm font-mono font-black text-text/90">${opp.price.toLocaleString()}</span>
                           </div>
                           <div className="flex items-center gap-3 md:gap-6">
                              <div className="flex flex-col items-end">
                                <span className="text-[8px] md:text-[9px] text-dim uppercase font-black tracking-widest mb-0.5 md:mb-1">Threshold</span>
                                <span className="text-xs md:text-sm font-mono font-black text-amber">${(opp.price * (1 + (isLong ? threshold : -threshold) / 100)).toLocaleString()}</span>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="text-[8px] md:text-[9px] text-dim uppercase font-black tracking-widest mb-0.5 md:mb-1">Delta</span>
                                <span className={cn("text-xs md:text-sm font-mono font-black", isLong ? "text-green" : "text-red")}>
                                  {isLong ? "▲" : "▼"} {Number(Math.abs(opp.pct || 0)).toFixed(2)}%
                                </span>
                              </div>
                           </div>
                        </div>
                     </div>
                   ) : (
                     <div className="flex flex-col items-center justify-center gap-4 py-4 w-full">
                        <div className="relative">
                          <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-inner">
                             {hibernating ? <Zap size={28} className="text-amber/40 animate-pulse" /> : <Activity size={28} className="text-dim/20 animate-pulse" />}
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="text-[11px] text-dim font-black uppercase tracking-[0.2em] animate-pulse text-center leading-none">
                             {hibernating ? (hibernationMode === 'light' ? 'Light Sleep' : 'Deep Sleep') : scannerPaused ? "Scanner Gated" : "Synchronizing"}
                          </div>
                          <p className="text-[9px] text-dim/40 font-bold uppercase tracking-tight text-center">
                            {hibernating ? (hibernationMode === 'light' ? "Market streams active, telemetry paused" : "Market telemetry paused to save resources") : scannerPaused ? "Awaiting next valid window" : "Establishing authoritative data link..."}
                          </p>
                        </div>
                     </div>
                   )}
                </div>
              </div>

              {/* Panel 2: Decision Funnel */}
              <div className="flex flex-col gap-4">
                 <div className="text-[10px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-2 px-1">
                   <LayoutGrid size={12} className="text-accent" /> Decision Funnel
                 </div>
                 <div className="bg-surface/50 border border-border rounded-2xl p-4 md:p-6 flex flex-col gap-4 md:gap-6 relative overflow-hidden group/scoring shadow-sm">
                    {/* Score Bars Section */}
                    <div className="grid grid-cols-3 gap-3 md:gap-4 pb-4 md:pb-6 border-b border-white/5">
                       {[
                         { label: 'Momentum', value: opp.score_breakdown?.momentum, color: 'bg-accent', text: 'text-accent' },
                         { label: 'Volatility', value: opp.score_breakdown?.volatility, color: 'bg-amber', text: 'text-amber' },
                         { label: 'Trend', value: opp.score_breakdown?.trend, color: 'bg-purple-400', text: 'text-purple-400' }
                       ].map((metric) => (
                        <div key={metric.label} className="space-y-1 md:space-y-1.5">
                          <div className="flex justify-between items-center text-[8px] md:text-[9px] font-black uppercase tracking-widest">
                             <span className="text-dim/80 truncate mr-1">{metric.label}</span>
                             <span className={cn(metric.text)}>{Number(metric.value || 0).toFixed(0)}%</span>
                          </div>
                          <div className="h-1 md:h-1.5 bg-background/80 rounded-full overflow-hidden border border-white/5">
                             <motion.div
                               initial={{ width: 0 }}
                               animate={{ width: `${metric.value || 0}%` }}
                               className={cn("h-full", metric.color)}
                             />
                          </div>
                        </div>
                       ))}
                    </div>

                    {/* Decision path */}
                    <div className="grid grid-cols-1 gap-3">
                      {funnelSteps.map((step) => (
                        <FunnelStep key={step.label} {...step} />
                      ))}
                    </div>

                    {/* Signal Checklist */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                         <div className="text-[10px] font-black text-dim uppercase tracking-widest">Technical Checklist</div>
                         <div className={cn(
                           "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border",
                           opp.signalResult?.allFired ? "bg-green/10 text-green border-green/20" : "bg-red/10 text-red border-red/20"
                         )}>
                            {opp.signalResult?.allFired ? 'All Signals Fired' : 'Awaiting Signals'}
                         </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SignalGauge
                          label="Velocity"
                          value={Math.abs(opp.pct)}
                          threshold={threshold}
                          unit="%"
                          fired={passing}
                          active={true}
                          type="entry"
                        />
                        {Object.entries(checklistSignals).map(([key, s]) => (
                          <SignalGauge
                            key={key}
                            label={s.label || key}
                            value={s.value}
                            threshold={s.threshold}
                            unit={s.unit}
                            fired={s.fired}
                            active={s.active}
                            remainingDelay={s.remaining_delay}
                            configDelay={s.config_delay}
                            insufficientData={s.insufficientData}
                            type="entry"
                          />
                        ))}
                      </div>
                    </div>

                    {/* Final Verdict */}
                    <div className="mt-auto pt-4 md:pt-6 border-t border-white/5 flex items-center justify-between gap-4">
                       <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center border transition-transform duration-500 shrink-0",
                            opp.signalResult?.allFired ? "bg-green text-white border-green/30" : "bg-red text-white border-red/30"
                          )}>
                            {opp.signalResult?.allFired ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                          </div>
                          <div className="flex flex-col gap-0.5">
                             <div className="text-[13px] font-black uppercase tracking-tight">
                                {opp.signalResult?.allFired ? 'Signal Authorized' : 'Signal Denied'}
                             </div>
                             {!opp.signalResult?.allFired && (
                               <div className="text-[10px] text-red-400/90 font-bold italic">
                                  {opp.signalResult?.reason || 'Critical logic mismatch'}
                               </div>
                             )}
                          </div>
                       </div>
                       <div className="flex flex-col items-end shrink-0">
                          <div className="flex items-center gap-2 mb-1">
                             <span className="text-[9px] text-dim font-black uppercase tracking-[0.2em]">Composite Score</span>
                             <FreshnessIndicator ts={opp.lastUpdate} />
                          </div>
                          <div className="flex items-baseline gap-2">
                             <span className={cn("text-2xl font-mono font-black tracking-tighter", opp.score > 85 ? "text-accent" : "text-text")}>
                                {Number(opp.score || 0).toFixed(1)}
                             </span>
                             <span className="text-[10px] text-dim font-bold uppercase tracking-widest opacity-40">/ 100</span>
                          </div>
                       </div>
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
  const { scannerResults, activeWindows, config, scannerPaused, lastScanTs, hibernating, hibernationMode, activeTrades, sessionActive, isThrottled, wsStatus, isSyncingOnResume } = useTradingStore(state => ({
    scannerResults: state.scannerResults,
    activeWindows: state.activeWindows,
    config: state.config,
    scannerPaused: state.scannerPaused,
    lastScanTs: state.lastScanTs,
    hibernating: state.hibernating,
    hibernationMode: state.hibernationMode,
    activeTrades: state.activeTrades,
    sessionActive: state.sessionActive,
    isThrottled: state.isThrottled,
    wsStatus: state.wsStatus,
    isSyncingOnResume: state.isSyncingOnResume
  }), shallow)

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showResumingFeedback = sessionActive && isResuming;

  const activeTradeSymbols = useMemo(() => new Set((activeTrades || []).map(t => t.symbol)), [activeTrades])
  const threshold = config.scan_pct_threshold || 2.0
  const [search, setSearch] = useState('')
  const lastUpdateRef = useRef(lastScanTs)

  const isUpdating = lastScanTs !== lastUpdateRef.current
  if (isUpdating) lastUpdateRef.current = lastScanTs

  // UX-MOBILE: Ensure search input is visible when focused
  const handleInputFocus = React.useCallback((e) => {
    requestAnimationFrame(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

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
    (config?.single_symbol_configs || []).forEach(sc => {
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
                 <PulseDot color={showResumingFeedback ? "bg-accent" : hibernating ? (hibernationMode === 'light' ? "bg-accent" : "bg-amber") : scannerPaused ? "bg-red" : "bg-green"} />
                 {!hibernating && !scannerPaused && !showResumingFeedback && (
                   <span className="absolute inset-0 rounded-full border border-green animate-ping opacity-20 scale-150" />
                 )}
                 {showResumingFeedback && (
                   <span className="absolute inset-0 rounded-full border border-accent animate-ping opacity-20 scale-150" />
                 )}
              </div>
                <div className="flex flex-col">
                  <span className="text-[15px] font-black tracking-tight hidden sm:inline uppercase">{showResumingFeedback ? 'Resuming Feed...' : 'Live Scanner'}</span>
                  <div className="flex items-center gap-2 opacity-60">
                    <div className="text-[8px] text-dim font-black uppercase tracking-tighter">Engine Logic Weighting</div>
                    <div className="px-1.5 py-0.5 rounded bg-background border border-border/50 font-mono text-[8px] font-bold text-text/60">
                      {config.scanner_weights ? `${Number((config.scanner_weights.momentum || 0)*100).toFixed(0)}:${Number((config.scanner_weights.volatility || 0)*100).toFixed(0)}:${Number((config.scanner_weights.trend || 0)*100).toFixed(0)}` : '50:30:20'}
                    </div>
                  </div>
                </div>
                <div className="h-8 w-px bg-border/40 hidden sm:block mx-1" />
              {showResumingFeedback ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 shadow-lg shadow-accent/5">
                  <RefreshCw size={10} className="text-accent animate-spin" />
                  <span className="text-[9px] text-accent font-black uppercase tracking-widest">Resuming</span>
                </div>
              ) : hibernating ? (
                <div className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded-full border shadow-lg",
                  hibernationMode === 'light' ? "bg-accent/10 border-accent/20 shadow-accent/5" : "bg-amber/10 border-amber/20 shadow-amber/5"
                )}>
                  <span className={cn("w-1 h-1 rounded-full animate-pulse", hibernationMode === 'light' ? "bg-accent" : "bg-amber")} />
                  <span className={cn("text-[9px] font-black uppercase tracking-widest", hibernationMode === 'light' ? "text-accent" : "text-amber")}>
                    {hibernationMode === 'light' ? 'Light Sleep' : 'Deep Sleep'}
                  </span>
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
            <ScanStatus
              lastScanTs={lastScanTs}
              intervalSec={config.scan_check_interval_sec || 5}
              isUpdating={isUpdating}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-1 justify-end max-w-md">
          <div className="relative group flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
            <input
              type="text"
              placeholder="Search symbols... [/]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={handleInputFocus}
              onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
              className="w-full bg-background border border-border rounded-xl pl-9 pr-8 py-1.5 text-[11px] font-bold focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
              aria-label="Filter scanner symbols"
            />
            {search && (
              <Tooltip content="Clear Filter">
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                  aria-label="Clear Filter"
                >
                  <XCircle size={14} />
                </button>
              </Tooltip>
            )}
          </div>
          <Tooltip content="Close Scanner">
            <button onClick={onClose} className="p-2 hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent outline-none rounded-full transition-colors shrink-0" aria-label="Close scanner">
              <X size={18} className="text-dim" />
            </button>
          </Tooltip>
        </div>
      </div>

      <ActiveWindowsList windows={filteredWindows} />

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
      <div className="flex md:hidden items-center px-4 py-2 text-[10px] text-dim font-bold tracking-widest border-b border-border bg-surface/50 sticky top-0 uppercase h-[36px] shrink-0">
        <span className="w-7 shrink-0">#</span>
        <span className="flex-1">Symbol</span>
        <div className="w-16 shrink-0 text-right">
          <span>Move</span>
        </div>
        <div className="w-20 shrink-0 text-right">
          <span>Status</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar min-h-0">
        {scannerResults.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-dim gap-3 py-20">
             <RefreshCw size={24} className="animate-spin opacity-20" />
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
              isInPosition={activeTradeSymbols.has(opp.symbol)}
              isMonitored={monitoredSymbols.has(opp.symbol)}
              scannerPaused={scannerPaused}
              hibernating={hibernating}
              hibernationMode={hibernationMode}
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
