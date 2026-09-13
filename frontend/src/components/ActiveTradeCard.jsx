import React from 'react'
import { cn, Tooltip, CopyButton, MonitoredBadge } from './ui/primitives'
import { fmtUSD, pnlClass, safeNum } from '../lib/theme'
import { ShieldCheck, RefreshCw, Clock, Lock, Activity, ChevronRight, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDuration, calculateProximity } from '../lib/formatters'
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
  let estPrice = sl
  let estLabel = 'Stop Loss'
  if (trade.est_pnl_source && trade.est_pnl_source.startsWith('signal:')) {
    const key = trade.est_pnl_source.substring(7)
    const sig = trade.exit_signals_status?.[key]
    if (sig && typeof sig.threshold === 'number' && sig.threshold > 0) {
      estPrice = sig.threshold
      estLabel = sig.label || key
    }
  }

  const isSignalWinning = trade.est_pnl_source && trade.est_pnl_source.startsWith('signal:')

  // Check exit signal triggers & delays
  let hasCrossedSignal = false
  let hasDelayedSignal = false
  let activeSignalCount = 0
  if (trade.exit_signals_status) {
    for (const [key, sig] of Object.entries(trade.exit_signals_status)) {
      if (!sig) continue
      activeSignalCount++
      if (sig.threshold_is_price && typeof sig.threshold === 'number' && sig.threshold > 0) {
        let signalPnl = isLong ? (sig.threshold - entry) * (trade.qty || 0) : (entry - sig.threshold) * (trade.qty || 0)
        const isDelayActive = typeof sig.remaining_delay === 'number' && sig.remaining_delay > 0
        const currentPnlVal = Number(trade.pnl || 0)
        if (sig.fired && sig.active) {
          hasCrossedSignal = true
        }
        if (isDelayActive && signalPnl <= currentPnlVal) {
          hasDelayedSignal = true
        }
      } else if (sig.fired && sig.active) {
        hasCrossedSignal = true
      }
    }
  }

  // Dynamic R-Multiple Price Runway Calculations
  const initialSl = Number(trade.initial_sl || sl || 0)
  const rawRiskUnit = Math.abs(entry - initialSl)
  const riskUnit = rawRiskUnit > 0 ? rawRiskUnit : (entry > 0 ? entry * 0.01 : 1)

  const getR = (price) => {
    if (!price || !isFinite(price) || !entry) return 0
    return isLong ? (price - entry) / riskUnit : (entry - price) / riskUnit
  }

  const maxRr = Number(trade.max_rr ?? trade.max_rr_achieved ?? trade.rr ?? 0)
  const peakR = Math.max(0, maxRr)
  const slR = getR(sl)
  const markR = getR(mark)
  const tpR = tp > 0 ? getR(tp) : 0
  const initialSlR = getR(initialSl)

  // Percentages relative to entry
  const markPercent = (entry > 0 && mark > 0)
    ? (isLong ? ((mark - entry) / entry) * 100 : ((entry - mark) / entry) * 100)
    : 0

  const slPercent = (entry > 0 && sl > 0)
    ? (isLong ? ((sl - entry) / entry) * 100 : ((entry - sl) / entry) * 100)
    : 0

  // Peak Giveback Metrics
  const givebackR = Math.max(0, peakR - markR)
  const givebackPctOfPeak = peakR > 0.05 ? Math.min(100, Math.max(0, (givebackR / peakR) * 100)) : 0
  const isRetracing = peakR >= 0.25 && givebackR >= 0.15

  // Distance to Danger / Room Metrics
  const roomToSlR = Math.max(0, isLong ? (mark - sl) / riskUnit : (sl - mark) / riskUnit)
  const roomToSlUsdt = Math.max(0, Math.abs(mark - sl) * Number(trade.qty || 0))
  const roomToTpR = tp > 0 ? Math.max(0, isLong ? (tp - mark) / riskUnit : (mark - tp) / riskUnit) : null
  const roomToTpUsdt = tp > 0 ? Math.max(0, Math.abs(tp - mark) * Number(trade.qty || 0)) : null

  // Trade Phase Resolution
  const isRiskReleased = trade.risk_usdt === 0 || (isLong ? sl >= entry - 1e-6 : sl <= entry + 1e-6)
  let tradePhase = 'INITIAL RISK'
  if (isRetracing) {
    tradePhase = 'RETRACING'
  } else if (isRiskReleased) {
    tradePhase = 'RISK LOCKED'
  } else if (markR > 0) {
    tradePhase = 'IN PROFIT'
  }

  // Runway Scale Constraints
  const targetR = tp > 0 ? Math.max(0.5, tpR, peakR, markR) : Math.max(1.5, peakR, markR)
  const bufferR = Math.max(0.2, targetR * 0.1)
  const rightEdgeR = targetR + bufferR
  const leftEdgeR = Math.min(-1, slR, markR < -1 ? markR : -1)
  const totalRangeR = rightEdgeR - leftEdgeR

  const pos = (price) => {
    if (!totalRangeR || totalRangeR <= 0) return 50
    const r = getR(price)
    const frac = (r - leftEdgeR) / totalRangeR
    return Math.max(0, Math.min(100, frac * 100))
  }

  const progress = pos(mark)
  const entryMarkPos = pos(entry)
  const slPos = pos(sl)
  const tpPos = tp > 0 ? pos(tp) : null
  const estPos = pos(estPrice)
  const peakPrice = isLong ? (entry + peakR * riskUnit) : (entry - peakR * riskUnit)
  const peakPos = pos(peakPrice)

  // Dual Indicator Markers calculation (retained for telemetry & compatibility)
  const { dualIndicatorMarkers, dualGroups } = React.useMemo(() => {
    if (!trade.exit_signals_status) return { dualIndicatorMarkers: [], dualGroups: [] }
    const list = []
    const groupsMap = new Map()

    for (const [key, sig] of Object.entries(trade.exit_signals_status)) {
      if (!sig) continue

      let groupKey = 'default'
      if (key.includes('_')) {
        const parts = key.split('_')
        if (parts.length >= 2) groupKey = `${parts[0]}_${parts[1]}`
      }

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, { key: groupKey, label: sig.label || groupKey.toUpperCase(), fast: null, slow: null })
      }
      const grp = groupsMap.get(groupKey)

      if (sig.threshold_is_price && typeof sig.threshold === 'number' && sig.threshold > 0) {
        const item = {
          key,
          label: sig.label || key,
          price: sig.threshold,
          pos: pos(sig.threshold),
          fired: sig.fired && sig.active,
          isFast: key.includes('fast'),
          isSlow: key.includes('slow'),
          signal: sig
        }
        list.push(item)
        if (item.isFast) grp.fast = item
        if (item.isSlow) grp.slow = item
      }

      if (typeof sig.fast_value === 'number' && sig.fast_value > 0) {
        const item = {
          key: `${key}-fast`,
          label: 'FAST EMA',
          price: sig.fast_value,
          pos: pos(sig.fast_value),
          fired: sig.fired,
          isFast: true,
          signal: sig
        }
        list.push(item)
        grp.fast = item
      }

      if (typeof sig.slow_value === 'number' && sig.slow_value > 0) {
        const item = {
          key: `${key}-slow`,
          label: 'SLOW EMA',
          price: sig.slow_value,
          pos: pos(sig.slow_value),
          fired: sig.fired,
          isSlow: true,
          signal: sig
        }
        list.push(item)
        grp.slow = item
      }
    }

    const groupSpans = []
    for (const grp of groupsMap.values()) {
      if (grp.fast && grp.slow) {
        const minPos = Math.min(grp.fast.pos, grp.slow.pos)
        const maxPos = Math.max(grp.fast.pos, grp.slow.pos)
        const width = Math.max(0.5, maxPos - minPos)
        const gapPct = entry > 0 ? (Math.abs(grp.fast.price - grp.slow.price) / entry) * 100 : 0
        const proximity = Math.max(0, Math.min(1, 1 - gapPct / 4))
        groupSpans.push({
          key: grp.key,
          label: grp.label,
          minPos,
          maxPos,
          width,
          gapPct,
          proximity,
          fastPrice: grp.fast.price,
          slowPrice: grp.slow.price,
          isFired: grp.fast.fired || grp.slow.fired
        })
      }
    }

    return { dualIndicatorMarkers: list, dualGroups: groupSpans }
  }, [trade.exit_signals_status, mark, entry, totalRangeR, leftEdgeR])

  const pnlLabel = Number(trade.pnl || 0) >= 0 ? 'profit' : 'loss'
  const rrValue = markR.toFixed(2)
  const riskLockText = isRiskReleased ? 'RISK LOCKED (0.00R Protected)' : `Locked (${fmtUSD(trade.risk_usdt)})`
  const ariaText = `${trade.symbol} ${trade.direction}: ${fmtUSD(trade.pnl)} (${rrValue}R ${pnlLabel}). Phase: ${tradePhase}. Risk status: ${riskLockText}. Live mark at ${rrValue}R.`

  const netFee = safeNum(trade.realized_fee) + safeNum(trade.funding_fee)

  const exitSignalProximity = React.useMemo(() => {
    if (!trade.exit_signals_status) return 0
    const statuses = Object.values(trade.exit_signals_status)
    if (statuses.length === 0) return 0

    let maxProx = 0
    for (const sig of statuses) {
      if (sig) {
        const prox = calculateProximity(sig, mark, entry, isLong, true)
        if (prox > maxProx) maxProx = prox
      }
    }
    return Math.round(maxProx)
  }, [trade.exit_signals_status, mark, entry, isLong])

  // Track mark price movement for restrained motion trail
  const prevMarkRef = React.useRef(mark)
  const [trail, setTrail] = React.useState(null)

  // Event highlights
  const prevSlRef = React.useRef(sl)
  const prevMaxRrRef = React.useRef(maxRr)
  const [slHighlight, setSlHighlight] = React.useState(false)
  const [peakHighlight, setPeakHighlight] = React.useState(false)

  React.useEffect(() => {
    if (prevMarkRef.current !== mark && mark > 0 && prevMarkRef.current > 0) {
      const oldPos = pos(prevMarkRef.current)
      const newPos = pos(mark)
      if (Math.abs(oldPos - newPos) > 0.05) {
        setTrail({
          start: Math.min(oldPos, newPos),
          width: Math.abs(oldPos - newPos),
          isUp: mark >= prevMarkRef.current,
          key: Date.now()
        })
      }
    }
    prevMarkRef.current = mark
  }, [mark])

  React.useEffect(() => {
    if (prevSlRef.current !== sl && sl > 0 && prevSlRef.current > 0) {
      setSlHighlight(true)
      const timer = setTimeout(() => setSlHighlight(false), 600)
      prevSlRef.current = sl
      return () => clearTimeout(timer)
    }
    prevSlRef.current = sl
  }, [sl])

  React.useEffect(() => {
    if (prevMaxRrRef.current !== maxRr && maxRr > 0) {
      setPeakHighlight(true)
      const timer = setTimeout(() => setPeakHighlight(false), 600)
      prevMaxRrRef.current = maxRr
      return () => clearTimeout(timer)
    }
    prevMaxRrRef.current = maxRr
  }, [maxRr])

  return (
    <motion.div
      whileHover={{
        borderColor: "rgba(91, 111, 255, 0.35)",
        boxShadow: "0 0 12px rgba(91, 111, 255, 0.1)"
      }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      role="button"
      tabIndex={0}
      className={cn(
        "bg-surface border border-border/80 rounded-xl p-2.5 sm:p-3 flex flex-col justify-between w-full h-[152px] shadow-md shadow-black/20 cursor-pointer hover:border-accent/40 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none group relative overflow-hidden select-none shrink-0",
        isResuming && "opacity-80 border-accent/20 bg-accent/[0.01]"
      )}
      aria-label={ariaText}
    >
      {showResumingFeedback && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-[1px] z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-surface border border-accent/30 px-2.5 py-0.5 rounded-full text-[8px] font-black text-accent uppercase tracking-widest flex items-center gap-1.5 shadow-xl">
            <RefreshCw size={10} className="animate-spin" /> Resuming Feed...
          </div>
        </div>
      )}

      {/* TIER 1: Dominant Header (Symbol, Position, Badges + Dominant P&L Block) */}
      <div className="flex items-start justify-between gap-2 h-[34px] min-w-0 shrink-0">
        <div className="flex flex-col justify-center gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-1 min-w-0 flex-wrap leading-none">
            <span className="text-xs sm:text-sm font-black font-mono tracking-tight text-text leading-none shrink-0">
              {trade.symbol || '---'}
            </span>
            <CopyButton value={trade.symbol} className="hidden sm:inline-flex opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity scale-75 -ml-1" />

            <span className={cn(
              "text-[7.5px] font-black px-1 py-0.5 rounded border uppercase shrink-0 leading-none font-mono",
              isLong ? 'text-green border-green/20 bg-green/5' : 'text-red border-red/20 bg-red/5'
            )}>
              {isLong ? '▲ LONG' : '▼ SHORT'}
            </span>

            <span className="bg-accent/10 text-accent border border-accent/20 text-[7px] font-black px-1 py-0.5 rounded uppercase tracking-tighter shrink-0 font-mono leading-none">
              {trade.strategy_config?.scan_interval || trade.strategy_config?.interval || config?.scan_interval || '5m'}
            </span>

            {/* Risk Phase & Protection Badges */}
            {isRiskReleased ? (
              <Tooltip content={`INITIAL RISK PROTECTED: Stop Loss moved to entry or better (${trade.risk_lock_reason || 'SL_AT_BREAKEVEN'}). Initial risk is 0.00R.`}>
                <span className="bg-green/10 border border-green/30 text-green text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded flex items-center gap-0.5 leading-none cursor-help shrink-0 shadow-sm">
                  <Lock size={7} className="text-green shrink-0" />
                  <span>RISK LOCKED</span>
                </span>
              </Tooltip>
            ) : (
              trade.initial_sl > 0 && Math.abs(trade.sl_price - trade.initial_sl) > 0.0000001 && (
                <Tooltip content={`Stop Loss ratcheted from ${fmtUSD(trade.initial_sl)} to ${fmtUSD(trade.sl_price)}`}>
                  <span className="bg-amber/10 border border-amber/25 text-amber text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded flex items-center gap-0.5 leading-none cursor-help shrink-0">
                    <ShieldCheck size={7} className="text-amber" />
                    <span>SL MOVED</span>
                  </span>
                </Tooltip>
              )
            )}

            {trade.strategy_config?.trailing_stop_enabled && (
              <Tooltip content="Dynamic Trailing Stop Loss engaged">
                <span className="bg-purple/10 border border-purple/25 text-purple text-[7px] font-black uppercase tracking-wider px-1 py-0.5 rounded flex items-center gap-0.5 leading-none shrink-0 cursor-help">
                  <RefreshCw size={7} className="animate-spin text-purple shrink-0" />
                  <span>TRAIL</span>
                </span>
              </Tooltip>
            )}

            {trade.is_knife && (
              <span className="text-[7.5px] bg-amber/15 text-amber font-black border border-amber/30 px-1 py-0.5 rounded tracking-wider uppercase leading-none shrink-0">
                🔪 KNIFE
              </span>
            )}

            {config?.single_symbol_configs?.some(sc => sc.symbol === trade.symbol && sc.enabled) && (
              <MonitoredBadge className="opacity-80 scale-90 -ml-0.5" />
            )}
          </div>

          <div className="flex items-center gap-1 text-[7.5px] text-dim font-mono font-medium leading-none pt-0.5">
            <span className="flex items-center gap-0.5">
              <Clock size={8} className="text-accent/80 shrink-0" /> {duration}
            </span>
            <span>·</span>
            <span>Entry {fmtUSD(entry)}</span>
            {(netFee !== 0) && (
              <>
                <span>·</span>
                <span className={netFee > 0 ? "text-red/60" : "text-green/60"}>Fee {fmtUSD(-netFee)}</span>
              </>
            )}
          </div>
        </div>

        {/* DOMINANT P&L BLOCK (USD, R-multiple, %) */}
        <div className="flex flex-col items-end justify-center shrink-0 leading-none">
          <Tooltip content={`Live P&L: ${fmtUSD(trade.pnl)} | Current R: ${markR >= 0 ? '+' : ''}${markR.toFixed(2)}R | Return: ${markPercent >= 0 ? '+' : ''}${markPercent.toFixed(2)}%`}>
            <div className={cn(
              "text-base sm:text-lg font-black font-mono tracking-tighter leading-none cursor-help transition-all duration-300 flex items-center gap-1",
              trade.pnl != null && !isNaN(Number(trade.pnl)) ? pnlClass(trade.pnl) : 'text-dim'
            )}>
              {trade.pnl != null && !isNaN(Number(trade.pnl)) ? fmtUSD(trade.pnl) : '$0.00'}
            </div>
          </Tooltip>
          <div className="flex items-center gap-1 pt-0.5 text-[8.5px] font-black font-mono leading-none">
            <span className={cn(
              "px-1 py-0.2 rounded font-mono font-black",
              markR >= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red"
            )}>
              {markR >= 0 ? '+' : ''}{markR.toFixed(2)}R
            </span>
            <span className={cn(
              "font-mono font-semibold",
              markPercent >= 0 ? "text-green" : "text-red"
            )}>
              {markPercent >= 0 ? '+' : ''}{markPercent.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* TIER 2: Clean R-First Runway Track & Landmarks */}
      <div className="flex flex-col justify-center h-[58px] min-w-0 my-0.5 relative shrink-0">
        {/* Top Tick Landmark Labels (R-First Language) */}
        <div className="flex justify-between items-end text-[7.5px] font-black font-mono uppercase tracking-tight text-dim mb-1 leading-none">
          {/* SL Landmark */}
          {(() => {
            const slDistPct = entry > 0 ? (Math.abs(sl - entry) / entry) * 100 : 0;
            const initialSlDistPct = entry > 0 ? (Math.abs(initialSl - entry) / entry) * 100 : 0;
            return (
              <Tooltip content={`Stop Loss: ${fmtUSD(sl)} (${slR >= 0 ? '+' : ''}${slR.toFixed(2)}R) • Current Dist: ${slDistPct.toFixed(2)}% • Initial SL: ${fmtUSD(initialSl)} (${initialSlDistPct.toFixed(2)}%)`}>
                <div className="flex flex-col items-start cursor-help">
                  <span className={cn("text-red font-black", slHighlight && "text-[#00f0ff]")}>
                    SL {slR.toFixed(1)}R
                  </span>
                  <span className="text-[6.5px] text-dim/70 font-normal">{fmtUSD(sl)} ({slDistPct.toFixed(1)}%)</span>
                </div>
              </Tooltip>
            );
          })()}

          {/* ENTRY Landmark */}
          <Tooltip content={`Entry Price: ${fmtUSD(entry)} (0.00R)`}>
            <div className="flex flex-col items-center cursor-help">
              <span className="text-dim font-black">0R ENTRY</span>
              <span className="text-[6.5px] text-dim/70 font-normal">{fmtUSD(entry)}</span>
            </div>
          </Tooltip>

          {/* PEAK Landmark (If active) */}
          {peakR >= 0.1 && (
            <Tooltip content={`Peak Profit Reached: +${peakR.toFixed(2)}R (${fmtUSD(peakPrice)})`}>
              <div className="flex flex-col items-center cursor-help">
                <span className={cn("text-purple font-black", peakHighlight && "text-[#00f0ff]")}>
                  PEAK +{peakR.toFixed(1)}R
                </span>
                <span className="text-[6.5px] text-dim/70 font-normal">{fmtUSD(peakPrice)}</span>
              </div>
            </Tooltip>
          )}

          {/* TP Landmark (Or Right Scale Target) */}
          <Tooltip content={tp > 0 ? `Take Profit Target: ${fmtUSD(tp)} (+${tpR.toFixed(2)}R)` : `Target Scale: +${targetR.toFixed(1)}R`}>
            <div className="flex flex-col items-end cursor-help">
              <span className="text-green font-black">
                {tp > 0 ? `TP +${tpR.toFixed(1)}R` : `+${targetR.toFixed(1)}R`}
              </span>
              <span className="text-[6.5px] text-dim/70 font-normal">
                {fmtUSD(tp > 0 ? tp : (isLong ? entry + targetR * riskUnit : entry - targetR * riskUnit))}
              </span>
            </div>
          </Tooltip>
        </div>

        {/* Tactical R Runway Bar */}
        <div
          className="h-[6px] w-full rounded-full relative bg-surface border border-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] my-1"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuetext={ariaText}
        >
          {/* Loss Zone Tinting */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-red/20 rounded-l-full transition-all duration-300"
            style={{ width: `${entryMarkPos}%` }}
          />

          {/* Profit Zone Tinting */}
          <div
            className="absolute top-0 bottom-0 right-0 bg-green/20 rounded-r-full transition-all duration-300"
            style={{ left: `${entryMarkPos}%` }}
          />

          {/* Progress Fill */}
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300 opacity-90 shadow-[0_0_6px_rgba(0,0,0,0.4)]",
              trade.pnl >= 0 ? "bg-green" : "bg-red"
            )}
            style={{ width: `${progress}%` }}
          />

          {/* Entry Seam Marker Dot */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -ml-0.5 w-1 h-2 rounded-full bg-white/90 z-20 pointer-events-none shadow-[0_0_4px_rgba(255,255,255,0.9)]"
            style={{ left: `${entryMarkPos}%` }}
            aria-hidden="true"
          />

          {/* Active SL Marker Line */}
          {sl > 0 && (
            <div
              className={cn(
                "absolute top-0 bottom-0 z-20 pointer-events-none transition-all duration-300 -ml-[1px]",
                slHighlight ? "w-1 bg-[#00f0ff] shadow-[0_0_8px_#00f0ff]" : "w-0.5 bg-red"
              )}
              style={{ left: `${slPos}%` }}
            />
          )}

          {/* Peak Historical Landmark Marker */}
          {peakR >= 0.1 && (
            <div
              className="absolute top-0 bottom-0 z-20 pointer-events-none transition-all duration-300 -ml-[1px] flex flex-col items-center"
              style={{ left: `${peakPos}%` }}
            >
              <div className="w-0.5 h-full bg-purple shadow-[0_0_4px_rgba(168,85,247,0.8)]" />
            </div>
          )}

          {/* Take Profit Target Line */}
          {tp > 0 && (
            <div
              className="absolute top-0 bottom-0 z-20 pointer-events-none transition-all duration-300 -ml-[1px] w-0.5 bg-green shadow-[0_0_4px_rgba(34,197,94,0.8)]"
              style={{ left: `${tpPos}%` }}
            />
          )}

          {/* Trail Motion Blur */}
          <AnimatePresence>
            {trail && (
              <motion.div
                key={trail.key}
                initial={{ opacity: 0.85, scaleY: 1 }}
                animate={{ opacity: 0, scaleY: 0.3 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
                className={cn(
                  "absolute top-0 bottom-0 rounded-full pointer-events-none z-30",
                  trail.isUp
                    ? "bg-gradient-to-r from-transparent via-[#00f0ff]/80 to-[#00f0ff]"
                    : "bg-gradient-to-r from-[#f59e0b] via-[#f59e0b]/80 to-transparent"
                )}
                style={{
                  left: `${trail.start}%`,
                  width: `${Math.max(1.5, trail.width)}%`
                }}
              />
            )}
          </AnimatePresence>

          {/* Live Current Price Dot */}
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 -ml-1.5 w-3 h-3 rounded-full z-30 transition-all duration-300 flex items-center justify-center pointer-events-none",
              trade.pnl >= 0 ? "bg-green shadow-[0_0_8px_rgba(34,197,94,0.9)]" : "bg-red shadow-[0_0_8px_rgba(239,68,68,0.9)]"
            )}
            style={{ left: `${progress}%` }}
          >
            <div className="w-1 h-1 rounded-full bg-white shadow-sm" />
          </div>
        </div>

        {/* Current Price Callout Bar below Runway */}
        <div className="flex justify-between items-center text-[7.5px] font-mono leading-none pt-0.5">
          <div className="flex items-center gap-1 text-dim">
            <span className="font-bold text-text">NOW: {fmtUSD(mark)}</span>
            <span className={cn("font-black", markR >= 0 ? "text-green" : "text-red")}>
              ({markR >= 0 ? '+' : ''}{markR.toFixed(2)}R)
            </span>
          </div>

          {/* Retracement & Giveback Warning */}
          {isRetracing ? (
            <Tooltip content={`Peak +${peakR.toFixed(2)}R retraced to +${markR.toFixed(2)}R. Profit giveback: -${givebackR.toFixed(2)}R (${givebackPctOfPeak.toFixed(0)}% of peak).`}>
              <span className="text-amber font-black cursor-help flex items-center gap-0.5 bg-amber/10 border border-amber/20 px-1 py-0.2 rounded">
                <AlertTriangle size={7} /> Giveback -{givebackR.toFixed(2)}R ({givebackPctOfPeak.toFixed(0)}%)
              </span>
            </Tooltip>
          ) : peakR >= 0.2 ? (
            <span className="text-dim/80">Peak: +{peakR.toFixed(2)}R</span>
          ) : (
            <span className="text-dim/80">Initial SL: {fmtUSD(initialSl)}</span>
          )}
        </div>
      </div>

      {/* TIER 3: Strategy & Engine Telemetry Layer (Distance to Danger, Exit Engine Status) */}
      <div className="flex items-center justify-between text-[7.5px] font-mono font-bold uppercase tracking-wider text-dim border-t border-white/5 pt-1.5 h-[26px] min-w-0 shrink-0">
        {/* Left: Distance to Danger Metrics */}
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          <Tooltip content={`Room to Stop Loss: ${roomToSlR.toFixed(2)}R (${fmtUSD(roomToSlUsdt)})`}>
            <span className="cursor-help flex items-center gap-0.5 text-text">
              <span className="text-dim">Room SL:</span>
              <span className={cn("font-black", roomToSlR < 0.5 ? "text-red" : "text-amber")}>
                {roomToSlR.toFixed(2)}R
              </span>
            </span>
          </Tooltip>

          {roomToTpR !== null && (
            <>
              <span className="text-dim/40">·</span>
              <Tooltip content={`Room to Take Profit: ${roomToTpR.toFixed(2)}R (${fmtUSD(roomToTpUsdt)})`}>
                <span className="cursor-help flex items-center gap-0.5 text-text">
                  <span className="text-dim">Room TP:</span>
                  <span className="font-black text-green">{roomToTpR.toFixed(2)}R</span>
                </span>
              </Tooltip>
            </>
          )}
        </div>

        {/* Right: Strategy Engine State */}
        <div className="flex items-center gap-1 shrink-0">
          {hasCrossedSignal ? (
            <Tooltip content="Strategy exit conditions triggered!">
              <span className="bg-red/15 text-red border border-red/30 px-1 py-0.2 rounded font-black flex items-center gap-0.5 animate-pulse">
                ⚡ FIRED
              </span>
            </Tooltip>
          ) : hasDelayedSignal ? (
            <Tooltip content="Exit signal active but delay-gated">
              <span className="bg-amber/10 text-amber border border-amber/20 px-1 py-0.2 rounded font-black flex items-center gap-0.5">
                <Clock size={7} className="animate-spin" /> DELAYED
              </span>
            </Tooltip>
          ) : (
            <Tooltip content={`Strategy Exit Engine actively monitoring position (${activeSignalCount} signal rules active)`}>
              <span className="bg-surface text-accent border border-accent/20 px-1 py-0.2 rounded font-black flex items-center gap-0.5 cursor-help">
                <Activity size={7} className="text-accent shrink-0" /> MONITORING
              </span>
            </Tooltip>
          )}

          {/* Dual Indicator Markers Calculation & Rendering Retention (for tests & tooltips) */}
          {dualIndicatorMarkers.length > 0 && (
            <Tooltip content={
              <div className="flex flex-col gap-1 text-[10px] p-1">
                <div className="font-bold border-b border-white/10 pb-0.5">Dual Indicator Convergence</div>
                {dualIndicatorMarkers.map(m => {
                  const prox = m.signal ? calculateProximity(m.signal, mark, entry, isLong, true) : (mark > 0 ? (1 - Math.abs(m.price - mark) / mark) * 100 : 0);
                  return (
                    <div key={m.key} className="flex items-center justify-between gap-2">
                      <span>Dual Indicator ({m.label}):</span>
                      <span className="font-mono font-bold text-accent">{fmtUSD(m.price)} ({prox.toFixed(1)}% prox)</span>
                    </div>
                  );
                })}
              </div>
            }>
              <span className="bg-accent/10 border border-accent/20 text-accent px-1 py-0.2 rounded font-black cursor-help">
                {dualIndicatorMarkers.length} IND
              </span>
            </Tooltip>
          )}
        </div>
      </div>
    </motion.div>
  )
})
