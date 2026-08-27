import React from 'react'
import { cn, Tooltip, CopyButton, MonitoredBadge } from './ui/primitives'
import { fmtUSD, pnlColor, pnlClass, safeNum } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { ShieldCheck, RefreshCw, Clock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
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
  const mark = Number(trade.current_price || trade.mark_price || trade.last_price || 0)
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

  // Dynamic R-Multiple Price Runway Model (Zero Synthetic Targets)
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
  const tpR = tp > 0 ? getR(tp) : 0;

  // Signed percentage calculations
  const initialSlPercent = (entry > 0 && initialSl > 0)
    ? (isLong ? ((initialSl - entry) / entry) * 100 : ((entry - initialSl) / entry) * 100)
    : 0;

  const slPercent = (entry > 0 && sl > 0)
    ? (isLong ? ((sl - entry) / entry) * 100 : ((entry - sl) / entry) * 100)
    : 0;

  const markPercent = (entry > 0 && mark > 0)
    ? (isLong ? ((mark - entry) / entry) * 100 : ((entry - mark) / entry) * 100)
    : 0;

  // Scale target dynamically: derived from structural targets (tpR / peakR) without markR jitter.
  const targetR = tp > 0 ? Math.max(0.5, tpR, peakR) : Math.max(1.5, peakR);
  const bufferR = Math.max(0.2, targetR * 0.1);
  const rightEdgeR = targetR + bufferR;
  const leftEdgeR = Math.min(-1, slR, markR < -1 ? markR : -1);
  const totalRangeR = rightEdgeR - leftEdgeR;

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

  // Right slot label & pricing resolution
  const rightSlotLabel = tp > 0 ? 'TP' : (peakR > 0 ? 'Peak' : 'Target');
  const rightSlotPrice = tp > 0 ? tp : (peakR > 0 ? peakPrice : (isLong ? entry + 1.5 * riskUnit : entry - 1.5 * riskUnit));
  const rightSlotR = tp > 0 ? tpR : (peakR > 0 ? peakR : 1.5);

  const pnlLabel = Number(trade.pnl || 0) >= 0 ? 'profit' : 'loss';
  const rrValue = Number(trade.rr || 0).toFixed(2);
  const ariaText = `${trade.symbol} ${trade.direction}: ${rrValue}R ${pnlLabel}. Live mark is at ${Math.round(progress)}% of runway scale.`;

  const netFee = safeNum(trade.realized_fee) + safeNum(trade.funding_fee);

  // Track recent mark price movement for trailing waterfall animation
  const prevMarkRef = React.useRef(mark);
  const [trail, setTrail] = React.useState(null);

  // Value change tracking for dynamic marker highlights
  const prevSlRef = React.useRef(sl);
  const prevMaxRrRef = React.useRef(maxRr);
  const prevEstRef = React.useRef(estPrice);
  const prevTpRef = React.useRef(tp);

  const [slHighlight, setSlHighlight] = React.useState(false);
  const [peakHighlight, setPeakHighlight] = React.useState(false);
  const [estHighlight, setEstHighlight] = React.useState(false);
  const [tpHighlight, setTpHighlight] = React.useState(false);

  React.useEffect(() => {
    if (prevMarkRef.current !== mark && mark > 0 && prevMarkRef.current > 0) {
      const oldPos = pos(prevMarkRef.current);
      const newPos = pos(mark);
      if (Math.abs(oldPos - newPos) > 0.05) {
        setTrail({
          start: Math.min(oldPos, newPos),
          width: Math.abs(oldPos - newPos),
          isUp: mark >= prevMarkRef.current,
          key: Date.now()
        });
      }
    }
    prevMarkRef.current = mark;
  }, [mark]);

  React.useEffect(() => {
    if (prevSlRef.current !== sl && sl > 0 && prevSlRef.current > 0) {
      setSlHighlight(true);
      const timer = setTimeout(() => setSlHighlight(false), 3000);
      prevSlRef.current = sl;
      return () => clearTimeout(timer);
    }
    prevSlRef.current = sl;
  }, [sl]);

  React.useEffect(() => {
    if (prevMaxRrRef.current !== maxRr && maxRr > 0) {
      setPeakHighlight(true);
      const timer = setTimeout(() => setPeakHighlight(false), 3000);
      prevMaxRrRef.current = maxRr;
      return () => clearTimeout(timer);
    }
    prevMaxRrRef.current = maxRr;
  }, [maxRr]);

  React.useEffect(() => {
    if (prevEstRef.current !== estPrice && estPrice > 0) {
      setEstHighlight(true);
      const timer = setTimeout(() => setEstHighlight(false), 3000);
      prevEstRef.current = estPrice;
      return () => clearTimeout(timer);
    }
    prevEstRef.current = estPrice;
  }, [estPrice]);

  React.useEffect(() => {
    if (prevTpRef.current !== tp && tp > 0) {
      setTpHighlight(true);
      const timer = setTimeout(() => setTpHighlight(false), 3000);
      prevTpRef.current = tp;
      return () => clearTimeout(timer);
    }
    prevTpRef.current = tp;
  }, [tp]);

  return (
    <motion.div
      whileHover={{
        borderColor: "rgba(91, 111, 255, 0.3)",
        boxShadow: "0 0 16px rgba(91, 111, 255, 0.1)"
      }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      role="button"
      tabIndex={0}
      className={cn(
        "bg-surface border border-border/40 rounded-xl p-2 sm:p-2.5 md:p-3 flex flex-col gap-1.5 sm:gap-2 w-full shadow-sm cursor-pointer hover:border-accent/30 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none group relative overflow-hidden",
        isResuming && "opacity-80 border-accent/20 bg-accent/[0.01]"
      )}
      aria-label={`View details for ${trade.symbol} ${trade.direction} trade, P&L is ${fmtUSD(trade.pnl)}, live risk-to-reward is ${Number(trade.rr || 0).toFixed(2)}R, peak risk-to-reward is ${Number(trade.max_rr ?? trade.max_rr_achieved ?? trade.rr ?? 0).toFixed(2)}R`}
    >
      {showResumingFeedback && (
        <div className="absolute inset-0 bg-accent/5 backdrop-blur-[1px] z-10 flex items-center justify-center pointer-events-none">
           <div className="bg-background/80 border border-accent/20 px-2.5 py-0.5 rounded-full text-[8px] font-black text-accent uppercase tracking-widest flex items-center gap-1.5 shadow-xl animate-in fade-in zoom-in duration-300">
              <RefreshCw size={10} className="animate-spin" /> Resuming Feed...
           </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 flex-wrap leading-none">
          <span className="text-xs sm:text-sm font-black font-mono tracking-tight shrink-0 text-text leading-none">{trade.symbol || '---'}</span>
          <CopyButton value={trade.symbol} className="hidden sm:inline-flex opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 transition-opacity scale-75 -ml-1.5" />
          <span className={cn("text-[7.5px] sm:text-[8px] md:text-[9px] font-black px-1 py-0.5 rounded border uppercase shrink-0 leading-none", isLong ? 'text-green border-green/20 bg-green/5' : 'text-red border-red/20 bg-red/5')}>
            {isLong ? '▲' : '▼'} {trade.direction || '---'}
          </span>
          <span className="bg-accent/10 text-accent border border-accent/20 text-[7px] font-black px-1 py-0.5 rounded uppercase tracking-tighter shrink-0 font-mono leading-none">
            {trade.strategy_config?.scan_interval || trade.strategy_config?.interval || config?.scan_interval || '5m'}
          </span>
          {trade.strategy_label && config && (
            trade.strategy_label === (config.strategy_label || 'Momentum Strategy') ? (
              <Tooltip content={`Strategy: ${trade.strategy_label}`}>
                <motion.span
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[7px] font-black px-1 py-0.5 rounded uppercase tracking-tighter shrink-0 cursor-help leading-none flex items-center gap-0.5"
                >
                  <span className="sm:hidden font-mono text-[7px] font-extrabold">B</span>
                  <span className="hidden sm:inline">Base</span>
                </motion.span>
              </Tooltip>
            ) : (
              <Tooltip content={`Strategy: ${trade.strategy_label}`}>
                <motion.span
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-purple/10 text-purple border border-purple/20 text-[7px] font-black px-1 py-0.5 rounded uppercase tracking-tighter shrink-0 cursor-help animate-pulse leading-none flex items-center gap-0.5"
                >
                  <span className="sm:hidden font-mono text-[7px] font-extrabold">V</span>
                  <span className="hidden sm:inline">Variant</span>
                </motion.span>
              </Tooltip>
            )
          )}
          {trade.is_reconciliation && (
            <span className="bg-amber text-black border border-amber text-[7px] font-black px-1 py-0.5 rounded uppercase tracking-tighter leading-none">
              Recon
            </span>
          )}
          {trade.is_knife && (
            <motion.span
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-[7.5px] sm:text-[8px] bg-amber/15 text-amber font-black border border-amber/30 px-1 py-0.5 rounded tracking-wider uppercase flex items-center gap-0.5 leading-none shrink-0"
            >
              🔪 KNIFE
            </motion.span>
          )}
          {trade.strategy_config?.is_nominal_overshoot && (
            <Tooltip content="SCALED RISK: The position notional size was scaled up to meet Binance's minimum order requirements. Exercise caution.">
              <span className="bg-amber/15 text-amber border border-amber/35 text-[7px] font-black px-1 py-0.5 rounded uppercase tracking-tighter leading-none cursor-help shadow-sm shrink-0 flex items-center gap-0.5">
                ⚡ <span className="sm:hidden">SCALED</span><span className="hidden sm:inline">SCALED RISK</span>
              </span>
            </Tooltip>
          )}
          {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
            <MonitoredBadge className="opacity-80 scale-90 -ml-0.5" />
          )}
          {trade.strategy_config?.trailing_stop_enabled && (
            <Tooltip content="Dynamic trailing stop active for this position">
              <span className="bg-purple-400/10 border border-purple-400/25 text-purple-400 text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded flex items-center gap-0.5 animate-pulse leading-none shrink-0 cursor-help">
                <RefreshCw size={7} className="animate-spin text-purple-400" />
                <span className="hidden sm:inline">Trailing</span>
              </span>
            </Tooltip>
          )}
          {trade.initial_sl > 0 && Math.abs(trade.sl_price - trade.initial_sl) > 0.0000001 && (
            <Tooltip content={`Stop Loss moved from original entry protection level: ${fmtUSD(trade.initial_sl)} ➔ ${fmtUSD(trade.sl_price)}`}>
              <span className="bg-amber/10 border border-amber/25 text-amber text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded flex items-center gap-0.5 leading-none cursor-help shrink-0">
                <ShieldCheck size={7} className="text-amber" />
                <span className="hidden sm:inline">SL Moved</span>
              </span>
            </Tooltip>
          )}
          {trade.entry_ts && (
            <span className="bg-accent/10 border border-accent/25 text-accent text-[7.5px] sm:text-[8px] font-black uppercase tracking-wider px-1 py-0.5 rounded flex items-center gap-0.5 leading-none shrink-0">
              <Clock size={8} className="text-accent" /> {duration}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {(trade.realized_fee > 0 || trade.funding_fee !== 0) && (
            <Tooltip content={`Commission: ${fmtUSD(-safeNum(trade.realized_fee))} | Funding: ${fmtUSD(-safeNum(trade.funding_fee))}`}>
              <div className={cn(
                "text-[7px] sm:text-[7.5px] font-black font-mono uppercase tracking-tighter cursor-help border-b border-dotted leading-none",
                netFee > 0 ? "text-red/40 border-red/10" : "text-green/40 border-green/10"
              )}>
                {fmtUSD(-netFee)}
              </div>
            </Tooltip>
          )}
          <Tooltip content="Live P&L including commission and funding">
            <div className={cn(
              "text-xs sm:text-sm md:text-base lg:text-lg font-black font-mono tracking-tighter leading-none cursor-help border-b border-dotted border-white/5 transition-all duration-500",
              trade.pnl != null && !isNaN(Number(trade.pnl)) ? pnlClass(trade.pnl) : 'text-dim',
              trail && "scale-105 text-accent animate-pulse"
            )}>
              {trade.pnl != null && !isNaN(Number(trade.pnl)) ? fmtUSD(trade.pnl) : '$0.00'}
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Tactical Map Price Runway & Live Target Gauges */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest text-dim leading-none">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-dim/80">MARK:</span>
            {entry > 0 && mark > 0 && (
              <span className={cn(
                "font-mono text-[7.5px] font-black transition-all duration-500 px-1 py-0.2 rounded",
                markPercent >= 0 ? "text-green bg-green/5" : "text-red bg-red/5",
                trail && "scale-105 font-extrabold animate-pulse"
              )}>
                {markPercent >= 0 ? '▲ +' : '▼ '}{markPercent.toFixed(2)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {hasCrossedSignal && (
              <Tooltip content="One or more technical exit signals have triggered or crossed threshold!">
                <span className="inline-flex items-center gap-0.5 bg-red/15 text-red border border-red/30 text-[7px] font-black px-1 py-0.2 rounded uppercase tracking-tighter leading-none animate-pulse shadow-[0_0_6px_rgba(255,68,102,0.3)]">
                  ⚡ CROSSED / FIRED
                </span>
              </Tooltip>
            )}
            {hasDelayedSignal && !hasCrossedSignal && (
              <Tooltip content="An exit signal threshold is active but currently delay-gated. It may become the active estimate soon.">
                <span className="inline-flex items-center gap-0.5 bg-amber/10 text-amber border border-amber/20 text-[7px] font-black px-1 py-0.2 rounded uppercase tracking-tighter leading-none animate-pulse">
                  <Clock size={7} className="animate-spin duration-[3000ms]" /> Delayed
                </span>
              </Tooltip>
            )}
            <span className="text-dim/80">Guard:</span>
            <span className={cn(
              "px-1 py-0.2 rounded text-[7.5px] font-mono font-black uppercase tracking-tighter shrink-0",
              isSignalWinning
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : trade.tp_mode === 'exp_rr_seq'
                  ? "bg-purple/10 text-purple border border-purple/20 animate-pulse"
                  : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
            )}>
              {isSignalWinning ? 'Signal' : trade.tp_mode === 'exp_rr_seq' ? 'Milestone' : 'Fixed TP'}
            </span>
          </div>
        </div>

        {/* Tactical Map Track Area with Stem & Pennant Overhead Space - Ultra High Density */}
        <div className="relative pt-3.5 pb-0.5 min-h-[30px]">
          {/* Main Thinner Track Bar (4px height) */}
          <div
            className="h-[4px] w-full rounded-full relative overflow-hidden bg-surface border border-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuetext={ariaText}
          >
            {/* Waterline Zone Tinting: Loss Zone (Left of Entry) */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-[#ff2a55]/25 transition-all duration-300"
              style={{ width: `${entryMarkPos}%` }}
            />

            {/* Waterline Zone Tinting: Profit Zone (Right of Entry) */}
            <div
              className="absolute top-0 bottom-0 right-0 bg-[#00e5a0]/22 transition-all duration-300"
              style={{ left: `${entryMarkPos}%` }}
            />

            {/* Progress Fill */}
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300 opacity-90 shadow-[0_0_6px_rgba(0,0,0,0.4)]",
                trade.pnl >= 0 ? "bg-[#00e5a0]" : "bg-[#ff2a55]"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Overlaid Tactical Map Indicators */}

          {/* Waterline Seam Line & Top Dot at Entry */}
          <div
            className="absolute top-3.5 bottom-0.5 w-0.5 bg-white z-20 pointer-events-none transition-all duration-300 flex flex-col items-center -ml-[1px]"
            style={{ left: `${entryMarkPos}%` }}
            aria-hidden="true"
          >
            <div className="w-1 h-1 rounded-full bg-white -mt-0.5 shadow-[0_0_4px_rgba(255,255,255,0.9)]" />
          </div>

          {/* Current Stop Loss Marker */}
          {sl > 0 && (
            <Tooltip content={
              <div className="flex flex-col gap-1 text-[11px] p-1 font-sans text-left">
                <div className="font-bold border-b border-white/5 pb-1 mb-1">Current Stop Loss</div>
                <div className="text-dim">Current SL: <span className="text-text font-mono font-semibold">{fmtUSD(sl)} ({slPercent >= 0 ? '+' : ''}{slPercent.toFixed(2)}%)</span></div>
                {initialSl > 0 && (
                  <div className="text-dim">Initial SL: <span className="text-amber font-mono font-semibold">{fmtUSD(initialSl)} ({initialSlPercent >= 0 ? '+' : ''}{initialSlPercent.toFixed(2)}%)</span></div>
                )}
                <div className="text-dim">SL R-Multiple: <span className="text-text font-mono font-semibold">{slR >= 0 ? '+' : ''}{slR.toFixed(2)}R</span></div>
              </div>
            }>
              <div
                className={cn(
                  "absolute top-3.5 bottom-0.5 z-20 cursor-help transition-all duration-500 -ml-[1px]",
                  slHighlight ? "w-1 bg-[#00f0ff] shadow-[0_0_10px_#00f0ff] animate-pulse" : "w-0.5 bg-red"
                )}
                style={{ left: `${slPos}%` }}
              />
            </Tooltip>
          )}

          {/* Peak Line & Labeled Pennant Flag */}
          {maxRr > 0 && (
            <Tooltip content={
              <div className="flex flex-col gap-1 text-[11px] p-1 font-sans">
                <div className="font-bold border-b border-white/5 pb-1 mb-1">Peak Target Achieved</div>
                <div className="text-dim">Multiplier: <span className="text-text font-mono font-semibold">{maxRr.toFixed(2)}R</span></div>
                <div className="text-dim">Price: <span className="text-text font-mono font-semibold">{fmtUSD(peakPrice)}</span></div>
                {isPeakBeyondTarget && (
                  <div className="text-purple text-[10px] font-semibold mt-1">▲ Trailed beyond target!</div>
                )}
              </div>
            }>
              <div
                className="absolute top-0 bottom-0.5 z-20 cursor-help transition-all duration-500 flex flex-col items-center -ml-[1px]"
                style={{ left: `${peakPos}%` }}
              >
                <div className={cn(
                  "px-0.5 py-0 text-[6.5px] font-black uppercase rounded tracking-tighter shadow-sm mb-0.5 leading-none transition-all duration-500",
                  peakHighlight ? "bg-purple text-white shadow-[0_0_12px_rgba(168,85,247,0.9)] scale-125 animate-pulse" : "bg-purple/20 border border-purple/40 text-purple"
                )}>
                  PEAK
                </div>
                <div className="flex-1 w-px border-l border-dashed border-purple/70" />
              </div>
            </Tooltip>
          )}

          {/* Take Profit Target Line */}
          {tp > 0 && (
            <Tooltip content={
              <div className="flex flex-col gap-1 text-[11px] p-1 font-sans">
                <div className="font-bold border-b border-white/5 pb-1 mb-1">Take Profit Target</div>
                <div className="text-dim">Target R: <span className="text-text font-mono font-semibold">+{tpR.toFixed(2)}R</span></div>
                <div className="text-dim">Price: <span className="text-text font-mono font-semibold">{fmtUSD(tp)}</span></div>
              </div>
            }>
              <div
                className={cn(
                  "absolute top-3.5 bottom-0.5 z-20 cursor-help transition-all duration-500 -ml-[1px]",
                  tpHighlight ? "w-1 bg-[#00f0ff] shadow-[0_0_10px_#00f0ff] animate-pulse" : "w-0.5 bg-green"
                )}
                style={{ left: `${tpPos}%` }}
              />
            </Tooltip>
          )}

          {/* Est-Target Stem & Overhead Diamond */}
          {trade.est_pnl_to_realize !== undefined && (
            <Tooltip content={
              <div className="flex flex-col gap-1 text-[11px] p-1 font-sans">
                <div className="font-bold border-b border-white/5 pb-1 mb-1 flex items-center justify-between gap-4">
                  <span>Est. Exit Target</span>
                  <span className={cn("font-mono font-black", pnlClass(trade.est_pnl_to_realize))}>
                    {fmtUSD(trade.est_pnl_to_realize)}
                  </span>
                </div>
                <div className="text-dim">Source: <span className="text-text font-semibold">{estLabel}</span></div>
                <div className="text-dim">Price: <span className="text-text font-mono font-semibold">{fmtUSD(estPrice)}</span></div>
              </div>
            }>
              <div
                className="absolute top-0 bottom-0.5 z-30 cursor-help transition-all duration-500 flex flex-col items-center -ml-[4px]"
                style={{ left: `${estPos}%` }}
              >
                <div className={cn(
                  "w-2 h-2 rotate-45 border bg-background mb-0.5 transition-all duration-500",
                  estHighlight ? "border-[#00f0ff] shadow-[0_0_12px_#00f0ff] scale-125 animate-pulse" : "border-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                )} />
                <div className="flex-1 w-0.5 bg-emerald-400/80" />
              </div>
            </Tooltip>
          )}

          {/* Trailing Movement Trail (To/From Waterfall Fade Cue - Distinct Cyan/Amber Color Coding & Ultra-Slow Dissolve) */}
          <AnimatePresence>
            {trail && (
              <motion.div
                key={trail.key}
                initial={{ opacity: 0.95, scaleY: 1 }}
                animate={{ opacity: 0, scaleY: 0.2 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 9.0, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "absolute top-[11px] h-[5px] rounded-full pointer-events-none z-30 blur-[0.4px]",
                  trail.isUp
                    ? "bg-gradient-to-r from-transparent via-[#00f0ff]/90 to-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.8)]"
                    : "bg-gradient-to-r from-[#f59e0b] via-[#f59e0b]/90 to-transparent shadow-[0_0_10px_rgba(245,158,11,0.8)]"
                )}
                style={{
                  left: `${trail.start}%`,
                  width: `${Math.max(1.5, trail.width)}%`
                }}
              />
            )}
          </AnimatePresence>

          {/* Sleek Tiny Ultra-Bright Live Mark Indicator with Movement Color Shift & Side Arc */}
          <div
            className={cn(
              "absolute top-[11px] -ml-[3.5px] w-2 h-2 rounded-full z-40 transition-all duration-200 pointer-events-none flex items-center justify-center shadow-lg",
              trail
                ? (trail.isUp
                    ? "bg-[#00f0ff] shadow-[0_0_12px_#00f0ff] scale-110"
                    : "bg-[#f59e0b] shadow-[0_0_12px_#f59e0b] scale-110")
                : (trade.pnl >= 0
                    ? "bg-[#00e5a0] shadow-[0_0_10px_#00e5a0]"
                    : "bg-[#ff2a55] shadow-[0_0_10px_#ff2a55]")
            )}
            style={{ left: `${progress}%` }}
          >
            {/* Trail Direction Arc Ring Segment */}
            <div className={cn(
              "absolute -inset-1 rounded-full border-2 border-transparent transition-all duration-300 pointer-events-none",
              trail
                ? (trail.isUp
                    ? "border-l-[#00f0ff] border-t-[#00f0ff] shadow-[0_0_8px_#00f0ff] animate-pulse"
                    : "border-r-[#f59e0b] border-b-[#f59e0b] shadow-[0_0_8px_#f59e0b] animate-pulse")
                : (trade.pnl >= 0
                    ? "border-l-[#00e5a0] border-t-[#00e5a0] opacity-40"
                    : "border-r-[#ff2a55] border-b-[#ff2a55] opacity-40")
            )} />
            <div className={cn(
              "absolute -inset-0.5 rounded-full animate-ping opacity-35 pointer-events-none",
              trail
                ? (trail.isUp ? "bg-[#00f0ff]" : "bg-[#f59e0b]")
                : (trade.pnl >= 0 ? "bg-[#00e5a0]" : "bg-[#ff2a55]")
            )} />
          </div>
        </div>

        {/* Bottom Metadata Grid */}
        <div className="flex justify-between items-center text-[7.5px] sm:text-[8px] font-bold text-dim uppercase tracking-widest font-mono leading-none pt-0.5">
          <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
            <span className="text-red font-black shrink-0">SL</span>
            <span className={cn(
              "font-black font-mono truncate transition-all duration-500",
              slPercent >= 0 ? "text-green" : "text-red",
              slHighlight && "scale-110 text-[#00f0ff] animate-pulse"
            )}>
              {slPercent >= 0 ? `+${slPercent.toFixed(1)}%` : `${slPercent.toFixed(1)}%`}
            </span>
            {initialSl > 0 && Math.abs(sl - initialSl) > 0.0000001 && (
              <Tooltip content={`Initial SL Protection Level: ${initialSlPercent >= 0 ? '+' : ''}${initialSlPercent.toFixed(2)}%`}>
                <span className="text-amber font-mono shrink-0 cursor-help">
                  [{initialSlPercent >= 0 ? '+' : ''}{initialSlPercent.toFixed(1)}%]
                </span>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1 text-center min-w-0 px-1">
            <span className="text-dim/80 font-black shrink-0">ENTRY</span>
            <span className="w-1.5 h-1.5 rounded-full bg-white/80 shadow-[0_0_4px_rgba(255,255,255,0.8)] inline-block" />
          </div>
          <div className="flex items-center gap-1 text-right min-w-0">
            <Tooltip content={`Current RR: ${Number(trade.rr || 0).toFixed(2)}R | Peak RR: ${Number(trade.max_rr ?? trade.rr ?? 0).toFixed(2)}R`}>
              <span className={cn(
                "font-black font-mono cursor-help flex items-center gap-0.5 transition-all duration-300",
                (trail || peakHighlight) && "scale-105 text-accent animate-pulse"
              )}>
                <span className="text-accent">{Number(trade.rr || 0).toFixed(2)}R</span>
                <span className={cn(
                  "text-dim/70 text-[7px] sm:text-[7.5px] transition-all duration-500",
                  peakHighlight && "text-purple font-extrabold animate-pulse"
                )}>
                  ({Number(trade.max_rr ?? trade.rr ?? 0).toFixed(2)}R Peak)
                </span>
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
    </motion.div>
  )
})
