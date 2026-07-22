import React, { useState, useMemo, useEffect, useRef } from 'react'
import { fmtVol } from '../lib/theme'
import { formatDuration, calculateSupertrend } from '../lib/formatters'
import { PulseDot, Sparkline, cn, CopyButton, Tooltip, CandlestickChart, MonitoredBadge, InPosBadge, SmartCandidateBadge } from './ui/primitives'
import { SignalGauge } from './ui/SignalGauge'
import { useTradingStore } from '../store/trading'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { useNow } from '../hooks/useNow'
import { X, Search, ShieldCheck, XCircle, Zap, AlertCircle, ChevronDown, ChevronUp, Activity, CheckCircle2, Loader2, LayoutGrid, TrendingUp, Clock, Info, ShieldAlert, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { shallow } from 'zustand/shallow'

const FreshnessIndicator = React.memo(({ ts }) => {
  const now = useNow();

  if (!ts || ts <= 0) return null;
  const age = Math.max(0, now - ts);

  return (
    <Tooltip content={`Telemetry timestamped ${formatDuration(age)} ago`}>
      <div className={cn("w-1.5 h-1.5 rounded-full cursor-help transition-colors duration-500", age < 5000 ? "bg-green" : "bg-amber/40")} />
    </Tooltip>
  );
});
FreshnessIndicator.displayName = 'FreshnessIndicator';

const ActiveWindowsList = React.memo(({ search }) => {
  const activeWindows = useTradingStore(state => state.activeWindows || []);

  const filteredWindows = useMemo(() => {
    const windows = Array.isArray(activeWindows) ? activeWindows.filter(Boolean) : []
    if (!search) return windows
    const term = search.toLowerCase().trim()
    return windows.filter(w => w.symbol.toLowerCase().includes(term))
  }, [activeWindows, search])

  if (filteredWindows.length === 0) return (
    <div className="h-0 p-0 opacity-0 border-none transition-all duration-300" />
  );

  return (
    <div className="bg-accent/5 border-b border-border overflow-x-auto no-scrollbar shrink-0 transition-all duration-300 ease-in-out h-[42px] p-2.5 opacity-100">
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
  );
});
ActiveWindowsList.displayName = 'ActiveWindowsList';

const ScanStatus = React.memo(() => {
  const { lastScanTs, intervalSec } = useTradingStore(state => ({
    lastScanTs: state.lastScanTs,
    intervalSec: state.config?.scan_check_interval_sec || 5
  }), shallow);

  const now = useNow();
  const lastUpdateRef = useRef(lastScanTs)
  const isUpdating = lastScanTs !== lastUpdateRef.current
  if (isUpdating) lastUpdateRef.current = lastScanTs

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


const buildAuthoritativeMarkers = (ohlc = [], signalResult = {}, config = {}) => {
  if (!Array.isArray(ohlc)) return [];
  const markers = [];

  const engulfingEnabled = (config?.enabled_signals || []).includes('engulfing');
  if (engulfingEnabled && signalResult) {
    const engulfing = signalResult.details?.engulfing || signalResult.signals?.engulfing;
    if (engulfing && engulfing.streak_start_ts !== undefined) {
      const startTs = engulfing.streak_start_ts;
      const endTs = engulfing.streak_end_ts;

      let sCount = 1;
      ohlc.forEach((candle, idx) => {
        const ts = candle.time || candle.t;
        if (ts >= startTs && ts <= endTs) {
          markers.push({ index: idx, label: `S${sCount++}`, color: '#64748b' });
        }
      });

      const engulfFired = signalResult.fired || engulfing.fired;
      if (engulfFired) {
         const isSoft = engulfing.mode?.startsWith('soft_') || engulfing.description?.toLowerCase().includes('live');
         const signalCandleTs = (engulfing.unit === 'price' && !isSoft) ? ohlc[ohlc.length - 2]?.time : ohlc[ohlc.length - 1]?.time;
         const sigIdx = ohlc.findIndex(c => (c.time || c.t) === signalCandleTs);
         if (sigIdx !== -1) {
            markers.push({ index: sigIdx, label: 'CONF', color: '#00e5a0' });
         }
      }
    }
  }

  const supertrendEnabled = (config?.enabled_signals || []).includes('supertrend');
  if (supertrendEnabled) {
    const period = parseInt(config?.signal_params?.supertrend_period || 10, 10);
    const multiplier = parseFloat(config?.signal_params?.supertrend_multiplier || 3);
    const { direction } = calculateSupertrend(ohlc, period, multiplier);

    // Find where trend direction flips
    for (let i = Math.max(1, period); i < ohlc.length; i++) {
      if (direction[i - 1] !== direction[i]) {
        const label = direction[i] === 'up' ? 'ST-UP' : 'ST-DN';
        const color = direction[i] === 'up' ? '#00e5a0' : '#ff4466';
        markers.push({ index: i, label, color });
      }
    }
  }

  return markers;
};

const DecisionPipeline = React.memo(({ steps }) => {
  return (
    <div className="flex items-center justify-between gap-1.5 bg-background/25 border border-border/40 rounded-xl p-2">
      {steps.map((step, idx) => {
        const Icon = step.icon;
        const isLast = idx === steps.length - 1;
        return (
          <React.Fragment key={step.label}>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <div className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[9px] leading-none font-bold",
                step.complete ? "bg-green/10 border-green/30 text-green" : "bg-surface border-border text-dim"
              )}>
                <Icon size={10} />
              </div>
              <div className="min-w-0 leading-none">
                <div className="text-[8px] font-black uppercase tracking-wider text-text/90 truncate">{step.label}</div>
                <div className="text-[7.5px] font-semibold text-dim truncate mt-0.5" title={step.detail}>{step.detail}</div>
              </div>
            </div>
            {!isLast && (
              <div className="h-3 w-px bg-border/40 shrink-0 mx-1" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
});
DecisionPipeline.displayName = 'DecisionPipeline';

const ExpandedScannerRowContent = React.memo(({ opp, config, isLong, passing, threshold, status, scannerPaused, hibernating, hibernationMode }) => {
  useResourceFocus('scanner_symbol', opp.symbol);

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
  const supertrendEnabled = (config?.enabled_signals || []).includes('supertrend');
  const decisionMarkers = useMemo(() => {
    if (!engulfingEnabled && !supertrendEnabled) return [];
    return buildAuthoritativeMarkers(opp.ohlc_history, signalStatus, config);
  }, [opp.ohlc_history, signalStatus, config, engulfingEnabled, supertrendEnabled]);

  const supertrendLine = useMemo(() => {
    if (!supertrendEnabled || !Array.isArray(opp.ohlc_history) || opp.ohlc_history.length === 0) return null;
    const period = parseInt(config?.signal_params?.supertrend_period || 10, 10);
    const multiplier = parseFloat(config?.signal_params?.supertrend_multiplier || 3);
    const { supertrend, direction } = calculateSupertrend(opp.ohlc_history, period, multiplier);
    return supertrend.map((val, idx) => ({
      value: val,
      direction: direction[idx]
    }));
  }, [supertrendEnabled, opp.ohlc_history, config]);

  const engulfSignal = checklistSignals.engulfing;

  const chartSl = useMemo(() => {
    if (config?.sl_type === 'streak_extreme' || config?.sl_type === 'engulfing_boundary') {
       return engulfSignal?.slPrice || (isLong ? engulfSignal?.pattern_low : engulfSignal?.pattern_high);
    }
    if (config?.sl_type === 'lookback_low/high') {
       return checklistSignals.breakout_hl?.slPrice;
    }
    if (config?.sl_type === 'supertrend') {
       return checklistSignals.supertrend?.slPrice || checklistSignals.exit_supertrend?.slPrice;
    }
    if (config?.sl_type === 'pct') {
       const dist = opp.price * ((config.sl_distance_pct || 0.8) / 100);
       return isLong ? opp.price - dist : opp.price + dist;
    }
    return null;
  }, [config, opp.price, isLong, engulfSignal, checklistSignals.breakout_hl, checklistSignals.supertrend, checklistSignals.exit_supertrend]);

  const closeEngulfEnabled = engulfingEnabled && config?.signal_params?.engulfing_mode?.startsWith('close');
  const funnelSteps = [
    { label: 'Momentum Scan', detail: `${Number(Math.abs(opp.pct || 0)).toFixed(2)}% move vs ${Number(threshold || 0).toFixed(2)}% threshold`, complete: passing, icon: TrendingUp },
    { label: 'Signal Context', detail: closeEngulfEnabled ? `Last closed candle close must clear ${config?.engulfing_lookback || 2} reverse candle ${isLong ? 'highs' : 'lows'}.` : 'Uses configured technical entry signals.', complete: closeEngulfEnabled ? !!engulfSignal?.fired : !!opp.signalResult?.allFired, icon: Activity },
    { label: 'Authorization', detail: opp.signalResult?.reason || 'Waiting for signal engine decision.', complete: !!opp.signalResult?.allFired, icon: ShieldCheck },
  ];

  return (
    <>
      <div className="bg-white/5 border-b border-white/5 px-3 md:px-5 py-1.5 flex items-center justify-between gap-2.5">
         <div className="flex items-center gap-2 md:gap-2.5 min-w-0">
           <div className={cn("px-1.5 py-0.2 md:px-2 md:py-0.5 rounded-full text-[7.5px] md:text-[8.5px] font-black uppercase tracking-widest border shadow-sm shrink-0", status.color)}>
             {status.label}
           </div>
           <span className="text-[9px] md:text-[10px] text-dim font-medium italic opacity-80 truncate">{summarySentence}</span>
         </div>
         {opp.score > 85 && (
           <div className="flex items-center gap-1.5">
              <Zap size={10} className="text-accent fill-accent animate-pulse" />
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-accent">High Authority</span>
           </div>
         )}
      </div>
      <div className="p-3 md:p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 border-t border-white/5">
        {/* Panel 1: Timeline & Overlays */}
        <div className="flex flex-col gap-2.5">
          <div className="text-[9px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-1.5 px-0.5">
             <Activity size={10} className="text-accent" /> Timeline & Overlays
          </div>
          <div className="bg-surface/50 border border-border rounded-xl p-3 md:p-4 flex items-center justify-center min-h-[180px] md:min-h-[240px] relative overflow-hidden group/viz">
             <div className="absolute inset-0 opacity-[0.03] pointer-events-none group-hover/viz:opacity-[0.05] transition-opacity" style={{ backgroundImage: 'radial-gradient(var(--color-accent) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
             {Array.isArray(opp.ohlc_history) && opp.ohlc_history.length >= 2 ? (
               <div className="w-full flex flex-col items-center relative z-10">
                  <CandlestickChart
                    data={opp.ohlc_history}
                    height={130}
                    threshold={threshold}
                    isLong={isLong}
                    entryPrice={opp.price}
                    signals={opp.ohlc_history.filter(d => opp.signalResult?.firedSignals?.includes(d.time))}
                    decisionMarkers={decisionMarkers}
                    slPrice={chartSl}
                    showOscillator={false}
                    supertrendLine={supertrendLine}
                  />
                  <div className="flex justify-between w-full mt-3 md:mt-4 px-1">
                     <div className="flex flex-col">
                        <span className="text-[7.5px] md:text-[8px] text-dim uppercase font-black tracking-widest mb-0.5">Entry Level</span>
                        <span className="text-2xs md:text-xs font-mono font-black text-text/90">${opp.price.toLocaleString()}</span>
                     </div>
                     <div className="flex items-center gap-2.5 md:gap-4">
                        <div className="flex flex-col items-end">
                          <span className="text-[7.5px] md:text-[8px] text-dim uppercase font-black tracking-widest mb-0.5">Threshold</span>
                          <span className="text-2xs md:text-xs font-mono font-black text-amber">${(opp.price * (1 + (isLong ? threshold : -threshold) / 100)).toLocaleString()}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[7.5px] md:text-[8px] text-dim uppercase font-black tracking-widest mb-0.5">Delta</span>
                          <span className={cn("text-2xs md:text-xs font-mono font-black", isLong ? "text-green" : "text-red")}>
                            {isLong ? "▲" : "▼"} {Number(Math.abs(opp.pct || 0)).toFixed(2)}%
                          </span>
                        </div>
                     </div>
                  </div>
               </div>
             ) : (
               <div className="flex flex-col items-center justify-center gap-3 py-3 w-full">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shadow-inner">
                       {hibernating ? <Zap size={20} className="text-amber/40 animate-pulse" /> : <Activity size={20} className="text-dim/20 animate-pulse" />}
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="text-[9px] text-dim font-black uppercase tracking-[0.2em] animate-pulse text-center leading-none">
                       {hibernating ? (hibernationMode === 'light' ? 'Light Sleep' : 'Deep Sleep') : scannerPaused ? "Scanner Gated" : "Synchronizing"}
                    </div>
                    <p className="text-[8px] text-dim/40 font-bold uppercase tracking-tight text-center leading-none">
                      {hibernating ? (hibernationMode === 'light' ? "Streams active, telemetry paused" : "Telemetry paused to save CPU") : scannerPaused ? "Awaiting next valid window" : "Establishing authoritative data link..."}
                    </p>
                  </div>
               </div>
             )}
          </div>
        </div>

        {/* Panel 2: Decision Funnel */}
        <div className="flex flex-col gap-2.5">
           <div className="text-[9px] text-dim font-black uppercase tracking-[0.2em] flex items-center gap-1.5 px-0.5">
             <LayoutGrid size={10} className="text-accent" /> Decision Funnel
           </div>
                 <div className="bg-surface/50 border border-border rounded-xl p-3 md:p-4 flex flex-col gap-2.5 md:gap-3 relative overflow-hidden group/scoring shadow-sm">
              {/* Score Bars Section */}
                    <div className="grid grid-cols-3 gap-3 pb-2 border-b border-white/5">
                 {[
                   { label: 'Momentum', value: opp.score_breakdown?.momentum, color: 'bg-accent', text: 'text-accent' },
                   { label: 'Volatility', value: opp.score_breakdown?.volatility, color: 'bg-amber', text: 'text-amber' },
                   { label: 'Trend', value: opp.score_breakdown?.trend, color: 'bg-purple-400', text: 'text-purple-400' }
                 ].map((metric) => (
                        <div key={metric.label} className="space-y-0.5">
                          <div className="flex justify-between items-center text-[7.5px] font-black uppercase tracking-wider leading-none">
                       <span className="text-dim/80 truncate mr-1">{metric.label}</span>
                       <span className={cn(metric.text)}>{Number(metric.value || 0).toFixed(0)}%</span>
                    </div>
                          <div className="h-0.5 bg-background/80 rounded-full overflow-hidden">
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
                    <DecisionPipeline steps={funnelSteps} />

              {/* Signal Checklist */}
                    <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                   <div className="text-[9px] font-black text-dim uppercase tracking-widest">Technical Checklist</div>
                   <div className={cn(
                     "px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-tighter border",
                     opp.signalResult?.allFired ? "bg-green/10 text-green border-green/20" : "bg-red/10 text-red border-red/20"
                   )}>
                      {opp.signalResult?.allFired ? 'All Fired' : 'Awaiting'}
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
              <div className="mt-auto pt-3 md:pt-4 border-t border-white/5 flex items-center justify-between gap-3">
                 <div className="flex items-center gap-2.5">
                    <div className={cn(
                      "w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl flex items-center justify-center border transition-transform duration-500 shrink-0",
                      opp.signalResult?.allFired ? "bg-green text-white border-green/30" : "bg-red text-white border-red/30"
                    )}>
                      {opp.signalResult?.allFired ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    </div>
                    <div className="flex flex-col gap-0.5">
                       <div className="text-[11px] md:text-xs font-black uppercase tracking-tight leading-none">
                          {opp.signalResult?.allFired ? 'Signal Authorized' : 'Signal Denied'}
                       </div>
                       {!opp.signalResult?.allFired && (
                         <div className="text-[9px] text-red-400/90 font-bold italic leading-none">
                            {opp.signalResult?.reason || 'Critical logic mismatch'}
                         </div>
                       )}
                    </div>
                 </div>
                 <div className="flex flex-col items-end shrink-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                       <span className="text-[8px] text-dim font-black uppercase tracking-[0.2em] leading-none">Composite</span>
                       <FreshnessIndicator ts={opp.lastUpdate} />
                    </div>
                    <div className="flex items-baseline gap-1 leading-none">
                       <span className={cn("text-lg md:text-xl font-mono font-black tracking-tighter leading-none", opp.score > 85 ? "text-accent" : "text-text")}>
                          {Number(opp.score || 0).toFixed(1)}
                       </span>
                       <span className="text-[8.5px] text-dim font-bold uppercase tracking-widest opacity-40 leading-none">/ 100</span>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </>
  );
});
ExpandedScannerRowContent.displayName = 'ExpandedScannerRowContent';

const ScannerRow = React.memo(({ opp, i, config, isInPosition, isMonitored, scannerPaused, hibernating, hibernationMode }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const threshold = config?.scan_pct_threshold || 2.0;
  const dir = (opp.dir || opp.direction || '').toLowerCase();
  const isLong = dir ? dir === 'long' : opp.pct >= 0;
  const passing = Math.abs(opp.pct) >= threshold;
  const isSingleMonitor = isMonitored;

  const getStatus = () => {
    if (opp.score > 85 && opp.signalResult?.allFired) return { label: 'Strong Setup', color: 'bg-green/10 text-green border-green/20' };
    if (opp.signalResult?.allFired) return { label: 'Ready', color: 'bg-accent/10 text-accent border-accent/20' };
    if (passing) return { label: 'Watching', color: 'bg-amber/10 text-amber border-amber/20' };
    return { label: 'Waiting', color: 'bg-surface text-dim border-border' };
  };

  const status = getStatus();
  const proximity = Number(Math.min(100, (Math.abs(opp.pct || 0) / (threshold || 1)) * 100)).toFixed(0);

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
          "flex md:grid md:grid-cols-[25px_90px_1fr_50px_1fr_1.2fr_135px] items-center px-3 py-1 md:py-1.5 md:px-4 transition-all h-[42px] md:h-[46px] group cursor-pointer outline-none focus-visible:bg-white/5",
          !passing && "opacity-45 grayscale-[0.5]",
          isSingleMonitor && "bg-accent/5",
          passing && "hover:bg-white/5 active:bg-white/10",
          isExpanded && "bg-white/[0.02]"
        )}>
        <div className="flex flex-col justify-center gap-0.5 w-6 shrink-0 md:w-auto md:shrink leading-none">
          <span className="text-[9px] text-dim font-black font-mono leading-none opacity-40 group-hover:opacity-100 transition-opacity">{(i + 1).toString().padStart(2, '0')}</span>
          {opp.change_rank !== undefined ? (
            <div className="flex items-center">
              <span className="text-[7.5px] bg-purple/10 border border-purple/20 px-1 py-0.2 rounded-[3px] text-purple font-black uppercase tracking-tighter shadow-sm leading-none">
                C{opp.change_rank}
              </span>
            </div>
          ) : opp.volume_rank !== undefined ? (
            <div className="flex items-center">
              <span className="text-[7.5px] bg-accent/10 border border-accent/20 px-1 py-0.2 rounded-[3px] text-accent font-black uppercase tracking-tighter shadow-sm leading-none">
                V{opp.volume_rank}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col justify-center overflow-hidden flex-1 md:flex-none">
           <div className="flex items-baseline gap-0.5 leading-none">
             <span className="text-[12px] md:text-[13px] font-bold font-mono truncate">{opp.symbol.replace("USDT", "")}</span>
             <span className="text-[8px] text-dim font-mono opacity-50">/U</span>
             <CopyButton value={opp.symbol} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ml-0.5 p-0.5 scale-75" />
           </div>
           <div className="flex items-center gap-1 mt-0.5 h-3">
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
        <div className="flex flex-col items-end w-14 shrink-0 md:w-auto md:shrink">
          <span className={cn(
            "text-[12px] md:text-[13px] font-bold font-mono leading-none",
            isLong ? "text-green" : "text-red"
          )}>
            {isLong ? "+" : "-"}{Number(Math.abs(opp.pct || 0)).toFixed(2)}%
          </span>
          <div className="md:hidden mt-0.5 scale-90">
            <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={36} height={10} />
          </div>
        </div>
        <div className="md:flex justify-center hidden">
          <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={40} height={14} />
        </div>
        <span className="text-[10px] text-dim font-mono text-right md:block hidden">{fmtVol(opp.vol)}</span>
        <div className="md:flex items-center gap-1.5 px-1.5 overflow-hidden hidden" role="region" aria-label={`Opportunity score for ${opp.symbol}: ${Number(opp.score || 0).toFixed(1)}`}>
          <Tooltip content={
            <div className="flex flex-col gap-1.5 p-1 min-w-[120px]">
               <div className="text-[9px] font-black uppercase tracking-widest border-b border-white/10 pb-1">Score Breakdown</div>
               <div className="flex justify-between items-center text-[9px]">
                  <span className="text-dim uppercase font-bold">Momentum</span>
                  <span className="font-mono text-accent">{Number(opp.score_breakdown?.momentum || 0).toFixed(1)}</span>
               </div>
               <div className="flex justify-between items-center text-[9px]">
                  <span className="text-dim uppercase font-bold">Volatility</span>
                  <span className="font-mono text-amber">{Number(opp.score_breakdown?.volatility || 0).toFixed(1)}</span>
               </div>
               <div className="flex justify-between items-center text-[9px]">
                  <span className="text-dim uppercase font-bold">Trend</span>
                  <span className="font-mono text-purple-400">{Number(opp.score_breakdown?.trend || 0).toFixed(1)}</span>
               </div>
               <div className="border-t border-white/10 pt-1 flex justify-between items-center font-black">
                  <span className="text-[8px] uppercase tracking-tighter">Total</span>
                  <span className={cn("text-[10px] font-mono", opp.score > 85 ? "text-accent" : "text-white")}>{Number(opp.score || 0).toFixed(1)}</span>
               </div>
            </div>
          }>
            <div className="flex-1 flex items-center gap-1.5 cursor-help" aria-label="Score breakdown bar">
              <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden flex min-w-[35px] border border-white/5">
                <div className="h-full bg-accent/80" style={{ width: `${opp.score_breakdown?.momentum || 0}%` }} />
                <div className="h-full bg-amber/80" style={{ width: `${opp.score_breakdown?.volatility || 0}%` }} />
                <div className="h-full bg-purple/80" style={{ width: `${opp.score_breakdown?.trend || 0}%` }} />
              </div>
              <div className="relative">
                <span className={cn(
                  "text-[9px] font-mono whitespace-nowrap",
                  opp.score > 85 ? "text-accent font-black" : "text-dim"
                )}>
                  {Number(opp.score || 0).toFixed(1)}
                </span>
                {opp.score > 85 && (
                  <span className="absolute -inset-0.5 bg-accent/20 blur-md rounded-full animate-pulse -z-10" />
                )}
              </div>
            </div>
          </Tooltip>
        </div>
        <div className="flex justify-end md:justify-center items-center gap-1.5 w-18 shrink-0 md:w-auto md:shrink">
          <div className="hidden lg:flex items-center gap-1 mr-2">
             <div className="flex flex-col items-end leading-none">
                <span className="text-[9px] font-bold text-text/90 font-mono leading-none">{proximity}%</span>
                <span className="text-[6.5px] text-dim font-black uppercase tracking-widest leading-none mt-0.5">Prox</span>
             </div>
          </div>
          <span className={cn("px-1 md:px-1.5 py-0.2 rounded text-[7.5px] md:text-[8px] font-black uppercase tracking-tighter border min-w-[55px] md:min-w-[65px] text-center transition-colors leading-none", status.color)}>
            {status.label}
          </span>
          <div className="hidden md:block opacity-0 group-hover:opacity-100 transition-opacity ml-1">
             {isExpanded ? <ChevronUp size={10} className="text-dim" /> : <ChevronDown size={10} className="text-dim" />}
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
            <ExpandedScannerRowContent
              opp={opp}
              config={config}
              isLong={isLong}
              passing={passing}
              threshold={threshold}
              status={status}
              scannerPaused={scannerPaused}
              hibernating={hibernating}
              hibernationMode={hibernationMode}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export const ScannerOverlay = React.memo(({ onClose }) => {
  const { scannerResults, config, scannerPaused, hibernating, hibernationMode, activeTrades, sessionActive, isThrottled, wsStatus, isSyncingOnResume } = useTradingStore(state => ({
    scannerResults: state.scannerResults,
    config: state.config,
    scannerPaused: state.scannerPaused,
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
  const [discoveryMode, setDiscoveryMode] = useState('all') // 'all' | 'volume' | 'pct_change'
  const [sortBy, setSortBy] = useState('score') // 'score' | 'pct_desc' | 'pct_asc' | 'vol_desc'
  const [rangeFilter, setRangeFilter] = useState('all') // 'all' | 'pos' | 'neg' | 'movers' | 'extreme'

  // UX-MOBILE: Ensure search input is visible when focused
  const handleInputFocus = React.useCallback((e) => {
    requestAnimationFrame(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  const filteredResults = useMemo(() => {
    let results = Array.isArray(scannerResults) ? scannerResults.filter(Boolean) : []

    // Pre-calculate full lists for ranking reference
    const sortedByVolume = [...results].sort((a, b) => (b.vol || b.volume || 0) - (a.vol || a.volume || 0));
    const sortedByChange = [...results].sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));

    // 1. Map ranks so they remain consistent regardless of secondary search/range filters
    results = results.map(r => {
      const volIdx = sortedByVolume.findIndex(o => o.symbol === r.symbol);
      const chgIdx = sortedByChange.findIndex(o => o.symbol === r.symbol);
      return {
        ...r,
        volume_rank: volIdx !== -1 ? volIdx + 1 : r.volume_rank,
        change_rank: chgIdx !== -1 ? chgIdx + 1 : undefined
      };
    });

    // 2. Filter by search
    if (search) {
      const term = search.toLowerCase().trim()
      results = results.filter(r => r.symbol.toLowerCase().includes(term))
    }

    // 3. Filter by range
    if (rangeFilter === 'pos') {
      results = results.filter(r => (r.pct || 0) > 0)
    } else if (rangeFilter === 'neg') {
      results = results.filter(r => (r.pct || 0) < 0)
    } else if (rangeFilter === 'movers') {
      results = results.filter(r => Math.abs(r.pct || 0) >= 2.0)
    } else if (rangeFilter === 'extreme') {
      results = results.filter(r => Math.abs(r.pct || 0) >= 5.0)
    }

    // 4. Apply Discovery Mode Slicing (Top 24)
    if (discoveryMode === 'volume') {
      results = results
        .sort((a, b) => (a.volume_rank || 999) - (b.volume_rank || 999))
        .slice(0, 24);
    } else if (discoveryMode === 'pct_change') {
      results = results
        .sort((a, b) => (a.change_rank || 999) - (b.change_rank || 999))
        .slice(0, 24);
    }

    // 5. Apply sorting
    if (sortBy === 'score') {
      results = [...results].sort((a, b) => (b.score || 0) - (a.score || 0))
    } else if (sortBy === 'pct_desc') {
      results = [...results].sort((a, b) => (b.pct || 0) - (a.pct || 0))
    } else if (sortBy === 'pct_asc') {
      results = [...results].sort((a, b) => (a.pct || 0) - (b.pct || 0))
    } else if (sortBy === 'vol_desc') {
      results = [...results].sort((a, b) => (b.vol || b.volume || 0) - (a.vol || a.volume || 0))
    }

    return results;
  }, [scannerResults, search, rangeFilter, discoveryMode, sortBy])

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
      <div className="p-3 border-b border-border flex justify-between items-center shrink-0 h-[52px]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <div className="relative flex items-center justify-center w-4 h-4">
                 <PulseDot color={showResumingFeedback ? "bg-accent" : hibernating ? (hibernationMode === 'light' ? "bg-accent" : "bg-amber") : scannerPaused ? "bg-red" : "bg-green"} />
                 {!hibernating && !scannerPaused && !showResumingFeedback && (
                   <span className="absolute inset-0 rounded-full border border-green animate-ping opacity-20 scale-125" />
                 )}
                 {showResumingFeedback && (
                   <span className="absolute inset-0 rounded-full border border-accent animate-ping opacity-20 scale-125" />
                 )}
              </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-black tracking-tight hidden sm:inline uppercase leading-none">{showResumingFeedback ? 'Resuming...' : 'Live Scanner'}</span>
                    <span className={cn(
                      "text-[8px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded-full border shadow-sm leading-none",
                      discoveryMode === 'all'
                        ? "bg-accent/10 border-accent/20 text-accent"
                        : discoveryMode === 'volume'
                        ? "bg-green/10 border-green/20 text-green"
                        : "bg-purple/10 border-purple/20 text-purple"
                    )}>
                      {discoveryMode === 'all' ? 'All' : discoveryMode === 'volume' ? 'Volume Rank' : 'Change Rank'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 opacity-60 mt-0.5">
                    <div className="text-[7.5px] text-dim font-black uppercase tracking-tighter leading-none">Weights</div>
                    <div className="px-1 py-0.2 rounded bg-background border border-border/50 font-mono text-[7.5px] font-bold text-text/60 leading-none">
                      {config.scanner_weights ? `${Number((config.scanner_weights.momentum || 0)*100).toFixed(0)}:${Number((config.scanner_weights.volatility || 0)*100).toFixed(0)}:${Number((config.scanner_weights.trend || 0)*100).toFixed(0)}` : '50:30:20'}
                    </div>
                  </div>
                </div>
                <div className="h-6 w-px bg-border/40 hidden sm:block mx-0.5" />
              {showResumingFeedback ? (
                <div className="flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-accent/10 border border-accent/20 shadow-md">
                  <RefreshCw size={8} className="text-accent animate-spin" />
                  <span className="text-[8px] text-accent font-black uppercase tracking-wider">Resuming</span>
                </div>
              ) : hibernating ? (
                <div className={cn(
                  "flex items-center gap-1 px-1.5 py-0.2 rounded-full border shadow-md",
                  hibernationMode === 'light' ? "bg-accent/10 border-accent/20" : "bg-amber/10 border-amber/20"
                )}>
                  <span className={cn("w-1 h-1 rounded-full animate-pulse", hibernationMode === 'light' ? "bg-accent" : "bg-amber")} />
                  <span className={cn("text-[8px] font-black uppercase tracking-wider", hibernationMode === 'light' ? "text-accent" : "text-amber")}>
                    {hibernationMode === 'light' ? 'Light' : 'Deep'}
                  </span>
                </div>
              ) : scannerPaused ? (
                <div className="flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-red/10 border border-red/20 shadow-md">
                  <span className="w-1 h-1 rounded-full bg-red animate-pulse" />
                  <span className="text-[8px] text-red font-black uppercase tracking-wider">Gated</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-green/10 border border-green/20 shadow-md">
                  <span className="w-1 h-1 rounded-full bg-green animate-pulse" />
                  <span className="text-[8px] text-green font-black uppercase tracking-wider">Active</span>
                </div>
              )}
            </div>
            <ScanStatus />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-1 justify-end max-w-xs md:max-w-md">
          <div className="relative group flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
            <input
              type="text"
              placeholder="Search... [/]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={handleInputFocus}
              onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
              className="w-full bg-background border border-border rounded-lg pl-8 pr-7 py-1 text-[10px] font-bold focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all"
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

      <ActiveWindowsList search={search} />

      {/* Real-time Discovery & Leaderboard Toolbar */}
      <div className="bg-background/25 border-b border-border/40 p-2.5 flex flex-col gap-2 shrink-0 sm:flex-row sm:items-center sm:justify-between">
        {/* Discovery Mode Selector */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
          <span className="text-[9px] font-black text-dim uppercase tracking-wider shrink-0 mr-1.5">Discovery:</span>
          {[
            { id: 'all', label: 'All Scanned', color: 'accent' },
            { id: 'volume', label: 'Top 24 Volume', color: 'green' },
            { id: 'pct_change', label: 'Top 24h Change', color: 'purple' }
          ].map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => setDiscoveryMode(m.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent outline-none",
                discoveryMode === m.id
                  ? m.color === 'accent'
                    ? "bg-accent/15 border-accent/40 text-accent"
                    : m.color === 'green'
                    ? "bg-green/15 border-green/40 text-green"
                    : "bg-purple/15 border-purple/40 text-purple"
                  : "bg-surface/50 border-border/30 text-dim hover:text-text hover:border-border/60"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Filters and Sorting dropdowns */}
        <div className="flex items-center gap-2">
          {/* Filter Dropdown */}
          <div className="flex items-center gap-1.5 flex-1 sm:flex-none">
            <span className="text-[9px] font-black text-dim uppercase tracking-wider hidden md:inline">Filter:</span>
            <select
              value={rangeFilter}
              onChange={(e) => setRangeFilter(e.target.value)}
              className="bg-surface border border-border/40 rounded-lg px-2.5 py-1 text-[10px] font-bold text-text/80 outline-none hover:border-border-hover focus-visible:ring-2 focus-visible:ring-accent h-7 w-full sm:w-36 transition-colors"
              aria-label="Filter by 24h change range"
            >
              <option value="all">All Movements</option>
              <option value="pos">Positive (&gt;0%)</option>
              <option value="neg">Negative (&lt;0%)</option>
              <option value="movers">Movers (&gt;2%)</option>
              <option value="extreme">Extreme (&gt;5%)</option>
            </select>
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5 flex-1 sm:flex-none">
            <span className="text-[9px] font-black text-dim uppercase tracking-wider hidden md:inline">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-surface border border-border/40 rounded-lg px-2.5 py-1 text-[10px] font-bold text-text/80 outline-none hover:border-border-hover focus-visible:ring-2 focus-visible:ring-accent h-7 w-full sm:w-44 transition-colors"
              aria-label="Sort options"
            >
              <option value="score">Scanner Score (Default)</option>
              <option value="pct_desc">Change % (High → Low)</option>
              <option value="pct_asc">Change % (Low → High)</option>
              <option value="vol_desc">Volume (High → Low)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[25px_90px_1fr_50px_1fr_1.2fr_135px] items-center px-4 py-1.5 text-[9px] text-dim font-bold tracking-widest border-b border-border bg-surface/50 sticky top-0 uppercase h-[32px] shrink-0 md:grid hidden">
        <span>#</span>
        <div className="flex flex-col leading-none">
          <span>Symbol</span>
          <span className="text-[7.5px] text-dim/60 normal-case tracking-normal">Top 15 results</span>
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
        <div className="flex justify-end px-1">
          <span>Score</span>
        </div>
        <div className="flex justify-center">
          <span>Status</span>
        </div>
      </div>

      {/* Mobile Header (Simplified) */}
      <div className="flex md:hidden items-center px-3 py-1 text-[9px] text-dim font-bold tracking-widest border-b border-border bg-surface/50 sticky top-0 uppercase h-[30px] shrink-0">
        <span className="w-6 shrink-0">#</span>
        <span className="flex-1">Symbol</span>
        <div className="w-14 shrink-0 text-right">
          <span>Move</span>
        </div>
        <div className="w-18 shrink-0 text-right">
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
