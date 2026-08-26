import React from 'react'
import { cn, Tooltip, CopyButton, MonitoredBadge } from './ui/primitives'
import { fmtUSD, pnlColor, pnlClass, safeNum } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { ShieldCheck, RefreshCw, Clock } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatDuration } from '../lib/formatters'
import { useNow } from '../hooks/useNow'

export const ActiveTradeCard = React.memo(({ trade, config, onTradeClose, onClick, isResuming, showResumingFeedback, onMouseEnter }) => {
  const now = useNow()

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  const duration = React.useMemo(() => {
    if (!trade.entry_ts) return '---'
    const start = trade.entry_ts_ms !== undefined ? trade.entry_ts_ms : new Date(trade.entry_ts).getTime()
    return formatDuration(now - start)
  }, [trade.entry_ts, trade.entry_ts_ms, now])

  const entry = Number(trade.entry_price || 0)
  const mark = Number(trade.mark_price || trade.last_price || 0)
  const sl = Number(trade.sl_price || 0)
  const tp = Number(trade.tp_price || 0)
  const isLong = trade.direction === 'LONG'

  // Resolve Est. Target and Winning Source
  let estPrice = sl; // Default to current SL
  let estLabel = 'Stop Loss';
  if (trade.est_pnl_source && trade.est_pnl_source.startsWith('signal:')) {
    const key = trade.est_pnl_source.substring(7);
    const sig = trade.exit_signals_status?.[key];
    if (sig && typeof sig.threshold === 'number' && sig.threshold > 0) {
      estPrice = sig.threshold;
      estLabel = sig.label || key;
    }
  }

  const isSignalWinning = trade.est_pnl_source && trade.est_pnl_source.startsWith('signal:');

  // Check if any signal threshold has been crossed by the mark price or is actively fired
  let hasCrossedSignal = false;
  let hasDelayedSignal = false;
  if (trade.exit_signals_status) {
    for (const [key, sig] of Object.entries(trade.exit_signals_status)) {
      if (sig && sig.threshold_is_price && typeof sig.threshold === 'number' && sig.threshold > 0) {
        let signalPnl = 0;
        if (isLong) {
          signalPnl = (sig.threshold - entry) * (trade.qty || 0);
        } else {
          signalPnl = (entry - sig.threshold) * (trade.qty || 0);
        }
        const isDelayActive = typeof sig.remaining_delay === 'number' && sig.remaining_delay > 0;
        const currentPnlVal = Number(trade.pnl || 0);
        if (sig.fired && sig.active) {
          hasCrossedSignal = true;
        }
        if (isDelayActive && signalPnl <= currentPnlVal) {
          hasDelayedSignal = true;
        }
      } else if (sig && sig.fired && sig.active) {
        hasCrossedSignal = true;
      }
    }
  }

  // Dynamic R-Multiple Price Runway Model with Proximity Auto-Zoom
  const initialSl = Number(trade.initial_sl || sl || 0);
  const rawRiskUnit = Math.abs(entry - initialSl);
  const riskUnit = rawRiskUnit > 0 ? rawRiskUnit : (entry > 0 ? entry * 0.01 : 1);

  const getR = (price) => {
    if (!price || !isFinite(price) || !entry) return 0;
    return isLong ? (price - entry) / riskUnit : (entry - price) / riskUnit;
  };

  const maxRr = Number(trade.max_rr ?? trade.max_rr_achieved ?? trade.rr ?? 0);
  const peakR = Math.max(0, maxRr);
  const slR = getR(sl);
  const markR = getR(mark);
  const estR = getR(estPrice);
  const tpR = tp > 0 ? getR(tp) : 0;

  // Find active span across all key markers
  const minActiveR = Math.min(-1, slR, markR, estR);
  const maxActiveR = Math.max(0, markR, peakR, tpR);
  const activeSpanR = maxActiveR - minActiveR;

  // Auto-Zoom: Enforce minimum view span for clear visual separation when markers are close together
  const viewSpanR = Math.max(1.2, activeSpanR);
  const paddingR = Math.max(0.1, viewSpanR * 0.08);

  const leftEdgeR = minActiveR - paddingR;
  const rightEdgeR = maxActiveR + paddingR;
  const totalRangeR = rightEdgeR - leftEdgeR;
  const targetR = tp > 0 ? tpR : maxActiveR;

  const pos = (price) => {
    if (!totalRangeR || totalRangeR <= 0) return 50;
    const r = getR(price);
    const frac = (r - leftEdgeR) / totalRangeR;
    return Math.max(0, Math.min(100, frac * 100));
  };

  const progress = pos(mark);
  const entryMarkPos = pos(entry);
  const slPos = pos(sl);
  const tpPos = tp > 0 ? pos(tp) : null;
  const estPos = pos(estPrice);
  const peakPrice = isLong ? (entry + peakR * riskUnit) : (entry - peakR * riskUnit);
  const peakPos = pos(peakPrice);
  const isPeakBeyondTarget = tp > 0 && peakR > tpR;

  const rightLabelPrice = tp > 0 ? tp : (isLong ? entry + targetR * riskUnit : entry - targetR * riskUnit);

  const pnlLabel = Number(trade.pnl || 0) >= 0 ? 'profit' : 'loss';
  const rrValue = Number(trade.rr || 0).toFixed(2);
  const ariaText = `${trade.symbol} ${trade.direction}: ${rrValue}R ${pnlLabel}. Live mark is at ${Math.round(progress)}% of runway scale.`;

  const netFee = safeNum(trade.realized_fee) + safeNum(trade.funding_fee)

  return (
    <motion.div
      whileHover={{
        borderColor: "rgba(91, 111, 255, 0.3)",
        boxShadow: "0 0 20px rgba(91, 111, 255, 0.12)"
      }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      role="button"
      tabIndex={0}
      className={cn(
        "bg-surface border border-border/40 rounded-2xl p-4 md:p-5 flex flex-col gap-4 w-full shadow-sm cursor-pointer hover:border-accent/30 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none group relative overflow-hidden",
        isResuming && "opacity-80 border-accent/20 bg-accent/[0.01]"
      )}
      aria-label={`View details for ${trade.symbol} ${trade.direction} trade, P&L is ${fmtUSD(trade.pnl)}, live risk-to-reward is ${Number(trade.rr || 0).toFixed(2)}R, peak risk-to-reward is ${Number(trade.max_rr ?? trade.max_rr_achieved ?? trade.rr ?? 0).toFixed(2)}R`}
    >
      {showResumingFeedback && (
        <div className="absolute inset-0 bg-accent/5 backdrop-blur-[1px] z-10 flex items-center justify-center pointer-events-none">
           <div className="bg-background/80 border border-accent/20 px-3 py-1 rounded-full text-[8px] font-black text-accent uppercase tracking-widest flex items-center gap-1.5 shadow-xl animate-in fade-in zoom-in duration-300">
              <RefreshCw size={10} className="animate-spin" /> Resuming Feed...
           </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap leading-none">
            <span className="text-sm md:text-base font-black font-mono tracking-tight shrink-0 text-text leading-none">{trade.symbol || '---'}</span>
            <CopyButton value={trade.symbol} className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 transition-opacity scale-75 -ml-1.5" />
            <span className={cn("text-[9px] md:text-xs font-black px-1.5 py-0.5 rounded border uppercase shrink-0 leading-none", isLong ? 'text-green border-green/20 bg-green/5' : 'text-red border-red/20 bg-red/5')}>
              {isLong ? '▲' : '▼'} {trade.direction || '---'}
            </span>
            <span className="bg-accent/10 text-accent border border-accent/20 text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 font-mono leading-none">
              {trade.strategy_config?.scan_interval || trade.strategy_config?.interval || config?.scan_interval || '5m'}
            </span>
            {trade.strategy_label && config && (
              trade.strategy_label === (config.strategy_label || 'Momentum Strategy') ? (
                <Tooltip content={`Strategy: ${trade.strategy_label}`}>
                  <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 cursor-help leading-none">
                    Base
                  </span>
                </Tooltip>
              ) : (
                <Tooltip content={`Strategy: ${trade.strategy_label}`}>
                  <span className="bg-purple/10 text-purple border border-purple/20 text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0 cursor-help animate-pulse leading-none">
                    Variant
                  </span>
                </Tooltip>
              )
            )}
            {trade.is_reconciliation && (
              <span className="bg-amber text-black border border-amber text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter leading-none">
                Recon
              </span>
            )}
            {trade.strategy_config?.is_nominal_overshoot && (
              <Tooltip content="SCALED RISK: The position notional size was scaled up to meet Binance's minimum order requirements. This forces a higher actual risk percentage than configured. Exercise caution.">
                <span className="bg-amber/15 text-amber border border-amber/35 text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter leading-none cursor-help shadow-sm">
                  SCALED RISK
                </span>
              </Tooltip>
            )}
          </div>
          <div className="flex gap-2 items-center flex-wrap leading-none">
            {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
              <MonitoredBadge className="opacity-80" />
            )}
            {trade.strategy_config?.trailing_stop_enabled && (
              <span className="bg-purple-400/10 border border-purple-400/25 text-purple-400 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.15)] leading-none">
                Trailing Active
              </span>
            )}
            {trade.initial_sl > 0 && Math.abs(trade.sl_price - trade.initial_sl) > 0.0000001 && (
              <Tooltip content={`Stop Loss moved from original entry protection level: ${fmtUSD(trade.initial_sl)} ➔ ${fmtUSD(trade.sl_price)}`}>
                <span className="bg-amber/10 border border-amber/25 text-amber text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 leading-none cursor-help">
                  SL Moved
                </span>
              </Tooltip>
            )}
            {trade.entry_ts && (
              <span className="bg-accent/10 border border-accent/25 text-accent text-[8px] md:text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 leading-none">
                <Clock size={10} className="text-accent" /> {duration}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0 min-w-[100px]">
          <Tooltip content="Live P&L including commission and funding">
            <div className={cn(
              "text-base md:text-lg lg:text-xl font-black font-mono tracking-tighter leading-none mb-1.5 cursor-help border-b border-dotted border-white/5",
              trade.pnl != null && !isNaN(Number(trade.pnl)) ? pnlClass(trade.pnl) : 'text-dim'
            )}>
              {trade.pnl != null && !isNaN(Number(trade.pnl)) ? fmtUSD(trade.pnl) : '$0.00'}
            </div>
          </Tooltip>
          <div className="flex flex-col items-end gap-1 leading-none">
            <Tooltip content={`Current RR: ${Number(trade.rr || 0).toFixed(2)}R | Peak RR: ${Number(trade.max_rr ?? trade.rr ?? 0).toFixed(2)}R`}>
              <span
                className="text-[10px] md:text-[11px] font-black font-mono text-dim uppercase tracking-widest cursor-help flex items-center gap-1 leading-none"
                aria-label={`Live risk-to-reward is ${Number(trade.rr || 0).toFixed(2)}R, Peak risk-to-reward is ${Number(trade.max_rr ?? trade.rr ?? 0).toFixed(2)}R`}
              >
                {Number(trade.rr || 0).toFixed(2)}R <span className="text-[9px] text-accent/80 font-black tracking-normal leading-none" aria-hidden="true">(Peak: {Number(trade.max_rr ?? trade.rr ?? 0).toFixed(2)}R)</span>
              </span>
            </Tooltip>
            {(trade.realized_fee > 0 || trade.funding_fee !== 0) && (
              <Tooltip content={`Commission: ${fmtUSD(-safeNum(trade.realized_fee))} | Funding: ${fmtUSD(-safeNum(trade.funding_fee))}`}>
                <div className={cn(
                  "text-[8px] md:text-[9px] font-black font-mono uppercase tracking-tighter cursor-help border-b border-dotted leading-none",
                  netFee > 0 ? "text-red/40 border-red/10" : "text-green/40 border-green/10"
                )}>
                  {fmtUSD(-netFee)}
                </div>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {/* Mini Price Runway & Live Target Gauges */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-dim leading-none">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-dim/80">Live Mark:</span>
            <span className="font-mono text-text/90 font-bold">{fmtUSD(mark)}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasCrossedSignal && (
              <Tooltip content="One or more technical exit signals have triggered or crossed threshold!">
                <span className="inline-flex items-center gap-1 bg-red/15 text-red border border-red/30 text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter leading-none animate-pulse shadow-[0_0_8px_rgba(255,68,102,0.3)] mr-1">
                  ⚡ CROSSED / FIRED
                </span>
              </Tooltip>
            )}
            {hasDelayedSignal && !hasCrossedSignal && (
              <Tooltip content="An exit signal threshold is active but currently delay-gated. It may become the active estimate soon.">
                <span className="inline-flex items-center gap-1 bg-amber/10 text-amber border border-amber/20 text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter leading-none animate-pulse mr-1.5">
                  <Clock size={8} className="animate-spin duration-[3000ms]" /> Delayed Signal
                </span>
              </Tooltip>
            )}
            <span className="text-dim/80">Exit Guard:</span>
            <span className={cn(
              "px-1.5 py-0.5 rounded text-[8px] font-mono font-black uppercase tracking-tighter shrink-0",
              isSignalWinning
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : trade.tp_mode === 'exp_rr_seq'
                  ? "bg-purple/10 text-purple border border-purple/20 animate-pulse"
                  : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
            )}>
              {isSignalWinning ? 'Exit Signal' : trade.tp_mode === 'exp_rr_seq' ? 'Milestone' : 'Fixed TP'}
            </span>
          </div>
        </div>

        <div className="relative pt-1 pb-1">
          {/* Progress Bar Container */}
          <div
            className="h-1.5 w-full bg-border/40 rounded-full relative shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuetext={ariaText}
          >
            {/* Entry Point Marker */}
            <div
              className="absolute top-0 bottom-0 w-px bg-white/50 z-20"
              style={{ left: `${entryMarkPos}%` }}
              aria-hidden="true"
            />

            {/* Current SL Marker */}
            {sl > 0 && (
              <Tooltip content={
                <div className="flex flex-col gap-1 text-[11px] p-1 font-sans">
                  <div className="font-bold border-b border-white/5 pb-1 mb-1">Current Stop Loss</div>
                  <div className="text-dim">
                    SL R: <span className="text-text font-mono font-semibold">{slR.toFixed(2)}R</span>
                  </div>
                  <div className="text-dim">
                    Price: <span className="text-text font-mono font-semibold">{fmtUSD(sl)}</span>
                  </div>
                </div>
              }>
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red/60 z-20 cursor-help"
                  style={{ left: `${slPos}%` }}
                />
              </Tooltip>
            )}

            {/* Progress Bar Fill */}
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(0,0,0,0.2)]",
                trade.pnl >= 0 ? "bg-green" : "bg-red"
              )}
              style={{ width: `${progress}%` }}
            />

            {/* Peak Target Marker */}
            {maxRr > 0 && (
              <Tooltip content={
                <div className="flex flex-col gap-1 text-[11px] p-1 font-sans">
                  <div className="font-bold border-b border-white/5 pb-1 mb-1">Peak Target Achieved</div>
                  <div className="text-dim">
                    Multiplier: <span className="text-text font-mono font-semibold">{maxRr.toFixed(2)}R</span>
                  </div>
                  <div className="text-dim">
                    Price: <span className="text-text font-mono font-semibold">{fmtUSD(peakPrice)}</span>
                  </div>
                  {isPeakBeyondTarget && (
                    <div className="text-purple text-[10px] font-semibold mt-1">
                      ▲ Trailed beyond target!
                    </div>
                  )}
                </div>
              }>
                <div
                  className="absolute top-0 bottom-0 flex flex-col items-center justify-center z-20 cursor-help transition-all duration-500 w-1 -ml-0.5"
                  style={{ left: `${peakPos}%` }}
                >
                  <div className="h-full w-px border-l border-dashed border-purple/60" />
                </div>
              </Tooltip>
            )}

            {/* TP Marker if explicit TP is configured */}
            {tp > 0 && (
              <Tooltip content={
                <div className="flex flex-col gap-1 text-[11px] p-1 font-sans">
                  <div className="font-bold border-b border-white/5 pb-1 mb-1">Take Profit Target</div>
                  <div className="text-dim">
                    Target R: <span className="text-text font-mono font-semibold">{targetR.toFixed(2)}R</span>
                  </div>
                  <div className="text-dim">
                    Price: <span className="text-text font-mono font-semibold">{fmtUSD(tp)}</span>
                  </div>
                </div>
              }>
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-green/60 z-20 cursor-help"
                  style={{ left: `${tpPos}%` }}
                />
              </Tooltip>
            )}

            {/* O(1) Gauge Marker Collision Detection */}
            {(() => {
              const isEstCollidingWithMark = Math.abs(estPos - progress) < 3.5;
              const isEstCollidingWithPeak = Math.abs(estPos - peakPos) < 3.5;
              const isPeakCollidingWithMark = Math.abs(peakPos - progress) < 3.0;

              return (
                <>
                  {/* Winning Est. Target Marker with Collision Offset */}
                  {trade.est_pnl_to_realize !== undefined && (
                    <Tooltip content={
                      <div className="flex flex-col gap-1 text-[11px] p-1 font-sans">
                        <div className="font-bold border-b border-white/5 pb-1 mb-1 flex items-center justify-between gap-4">
                          <span>Est. Exit Target</span>
                          <span className={cn("font-mono font-black", pnlClass(trade.est_pnl_to_realize))}>
                            {fmtUSD(trade.est_pnl_to_realize)}
                          </span>
                        </div>
                        <div className="text-dim">
                          Source: <span className="text-text font-semibold">{estLabel}</span>
                        </div>
                        <div className="text-dim">
                          Price: <span className="text-text font-mono font-semibold">{fmtUSD(estPrice)}</span>
                        </div>
                        {(isEstCollidingWithMark || isEstCollidingWithPeak) && (
                          <div className="text-[9px] text-accent/80 font-mono mt-0.5 pt-0.5 border-t border-white/5">
                            ⚡ Marker shifted slightly to prevent visual overlap
                          </div>
                        )}
                      </div>
                    }>
                      <div
                        className={cn(
                          "absolute -ml-1.5 w-3 h-3 rotate-45 border-2 border-purple bg-background shadow-[0_0_8px_rgba(168,85,247,0.5)] z-40 cursor-help transition-all duration-300 hover:scale-125",
                          isEstCollidingWithMark ? "top-[-5px]" : "top-1/2 -translate-y-1/2"
                        )}
                        style={{ left: `${estPos}%` }}
                      />
                    </Tooltip>
                  )}

                  {/* Glowing Price Handle/Thumb showing current Mark location */}
                  <div
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 -ml-1.5 w-3 h-3 rounded-full border-2 bg-surface shadow-md z-30 transition-all duration-300",
                      trade.pnl >= 0 ? "border-green" : "border-red",
                      isPeakCollidingWithMark && "ring-2 ring-purple/40"
                    )}
                    style={{ left: `${progress}%` }}
                  />
                </>
              );
            })()}
          </div>
        </div>

        <div className="flex justify-between text-[9px] font-bold text-dim uppercase tracking-widest font-mono">
          <div className="flex flex-col items-start leading-tight">
            <span className="text-red/60">SL</span>
            <span className="font-bold text-text/80 font-mono mt-0.5">{fmtUSD(sl)}</span>
            <span className="text-[8px] opacity-40">{slR >= 0 ? `+${slR.toFixed(2)}R` : `${slR.toFixed(2)}R`}</span>
          </div>
          <div className="flex flex-col items-center text-center leading-tight">
            <span className="text-text/30">Entry</span>
            <span className="font-bold text-text/60 font-mono mt-0.5">{fmtUSD(entry)}</span>
            <span className="text-[8px] opacity-40">0.00R</span>
          </div>
          <div className="flex flex-col items-end leading-tight text-right">
            <span className="text-green/60">{tp > 0 ? 'TP' : 'Scale'}</span>
            <span className="font-bold text-text/80 font-mono mt-0.5">{fmtUSD(rightLabelPrice)}</span>
            <span className="text-[8px] opacity-40">{targetR >= 0 ? `+${targetR.toFixed(2)}R` : `${targetR.toFixed(2)}R`}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
})
