import React, { useMemo } from 'react';
import { cn } from './primitives';
import { price as fmtPrice } from '../../lib/formatters';
import { buildCandidateConditionsModel } from '../../utils/candidateConditions';

const DIAL_ZONES = [
  { key: 'watching', label: 'Watching', range: '<100%', color: '#64748b' },
  { key: 'near', label: 'Near', range: '80–99%', color: '#3b82f6' },
  { key: 'fresh', label: 'Fresh', range: '0–5% past', color: '#22c55e' },
  { key: 'stale', label: 'Stale', range: '5–15% past', color: '#f59e0b' },
  { key: 'late', label: 'Late', range: '>15% past', color: '#ef4444' },
];

const ZONE_COLOR_MAP = {
  watching: '#64748b',
  near: '#3b82f6',
  fresh: '#22c55e',
  stale: '#f59e0b',
  late: '#ef4444',
  warming: '#f59e0b',
  blocked: '#a855f7',
};

const ZONE_TEXT_CLASS = {
  watching: 'text-dim',
  near: 'text-accent',
  fresh: 'text-green',
  stale: 'text-amber',
  late: 'text-red',
  warming: 'text-amber',
  blocked: 'text-purple-400',
};

const ZONE_DOT_CLASS = {
  watching: 'bg-dim/70',
  near: 'bg-accent',
  fresh: 'bg-green',
  stale: 'bg-amber',
  late: 'bg-red',
  warming: 'bg-amber',
  blocked: 'bg-purple-400',
};

function formatFreshness(ts, nowMs) {
  const evaluated = Number(ts);
  if (!Number.isFinite(evaluated) || evaluated <= 0) return 'Update time unavailable';
  const ageSeconds = Math.max(0, Math.floor((Number(nowMs) - evaluated) / 1000));
  if (ageSeconds < 60) return `Updated ${ageSeconds}s ago`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `Updated ${ageMinutes}m ago`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `Captured ${ageHours}h ago`;
  return `Captured ${Math.floor(ageHours / 24)}d ago`;
}

/**
 * Piecewise angle mapping for 0..150 dial so Fresh (100-105) and Stale (105-115)
 * have wide, legible visual arcs instead of razor-thin 6° slices:
 * - 0..80 (Watching):  -180° .. -90°  (50% of arc)
 * - 80..100 (Near):    -90°  .. -62°  (target tick at -62°)
 * - 100..105 (Fresh):  -62°  .. -40°  (22° wide green slice)
 * - 105..115 (Stale):  -40°  .. -18°  (22° wide amber slice)
 * - 115..150 (Late):   -18°  ..   0°  (18° wide red slice)
 */
function pctToAngle(p) {
  const clamped = Math.max(0, Math.min(150, Number(p) || 0));
  if (clamped <= 80) {
    return -180 + (clamped / 80) * 90;
  }
  if (clamped <= 100) {
    return -90 + ((clamped - 80) / 20) * 28;
  }
  if (clamped <= 105) {
    return -62 + ((clamped - 100) / 5) * 22;
  }
  if (clamped <= 115) {
    return -40 + ((clamped - 105) / 10) * 22;
  }
  return -18 + ((clamped - 115) / 35) * 18;
}

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function describeArc(cx, cy, r, pStart, pEnd) {
  const a1 = pctToAngle(pStart);
  const a2 = pctToAngle(pEnd);
  if (Math.abs(a2 - a1) < 0.25) return '';
  const [x1, y1] = polar(cx, cy, r, a1);
  const [x2, y2] = polar(cx, cy, r, a2);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * Semicircular 0–150% condition dial with piecewise widened post-target zones:
 * - Target tick at 100% (-62°)
 * - 5 color-coded arc zones: Watching (<80%), Near (80-100%), Fresh (100-105%), Stale (105-115%), Late (115-150%)
 */
export const ConditionDial = React.memo(function ConditionDial({
  dialPct = 0,
  dialZone = 'watching',
  dialOverText = '',
  size = 'md',
}) {
  const clamped = Math.max(0, Math.min(150, Math.round(Number(dialPct) || 0)));
  const color = ZONE_COLOR_MAP[dialZone] || ZONE_COLOR_MAP.watching;

  const isSm = size === 'sm';
  const w = isSm ? 148 : 204;
  const h = isSm ? 86 : 114;
  const cx = w / 2;
  const cy = isSm ? 68 : 90;
  const r = isSm ? 50 : 68;
  const strokeW = isSm ? 8 : 10;

  const [tx1, ty1] = polar(cx, cy, r - strokeW * 0.85, pctToAngle(100));
  const [tx2, ty2] = polar(cx, cy, r + strokeW * 0.85, pctToAngle(100));
  const [nx, ny] = polar(cx, cy, r - strokeW * 0.9, pctToAngle(clamped));
  const [sx, sy] = polar(cx, cy, r, -180);
  const [ex, ey] = polar(cx, cy, r, 0);

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="overflow-visible select-none shrink-0"
      aria-label={`Condition gauge at ${clamped}% (${dialOverText})`}
    >
      {/* Background Zone Track Segments (Widened piecewise arcs for Fresh & Stale) */}
      <path d={describeArc(cx, cy, r, 0, 80)} stroke="#64748b" strokeOpacity="0.22" strokeWidth={strokeW} fill="none" />
      <path d={describeArc(cx, cy, r, 80, 100)} stroke="#3b82f6" strokeOpacity="0.28" strokeWidth={strokeW} fill="none" />
      <path d={describeArc(cx, cy, r, 100, 105)} stroke="#22c55e" strokeOpacity="0.38" strokeWidth={strokeW} fill="none" />
      <path d={describeArc(cx, cy, r, 105, 115)} stroke="#f59e0b" strokeOpacity="0.38" strokeWidth={strokeW} fill="none" />
      <path d={describeArc(cx, cy, r, 115, 150)} stroke="#ef4444" strokeOpacity="0.35" strokeWidth={strokeW} fill="none" />

      {/* Active Fill Arc */}
      {clamped > 0 && (
        <path
          d={describeArc(cx, cy, r, 0, clamped)}
          stroke={color}
          strokeWidth={strokeW}
          fill="none"
          strokeLinecap="round"
        />
      )}

      {/* Target Tick at 100% */}
      <line
        x1={tx1}
        y1={ty1}
        x2={tx2}
        y2={ty2}
        stroke="currentColor"
        className="text-text/80"
        strokeWidth="2"
      />
      <text
        x={tx2 + 2}
        y={ty2 - 4}
        textAnchor="middle"
        fontSize={isSm ? '8' : '9'}
        className="fill-dim font-mono font-semibold"
      >
        target
      </text>

      {/* Scale Endpoints */}
      <text x={sx - 2} y={sy + 12} textAnchor="start" fontSize={isSm ? '8' : '9'} className="fill-dim/70 font-mono">
        0%
      </text>
      <text x={ex + 2} y={ey + 12} textAnchor="end" fontSize={isSm ? '8' : '9'} className="fill-dim/70 font-mono">
        +50%
      </text>

      {/* Needle */}
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke="currentColor"
        className="text-text"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={isSm ? 3 : 3.5} className="fill-text" />

      {/* Center Readout: Relative to Target */}
      <text
        x={cx}
        y={cy - (isSm ? 14 : 18)}
        textAnchor="middle"
        fontSize={isSm ? (dialOverText.length > 14 ? '9.5' : '11.5') : (dialOverText.length > 14 ? '11.5' : '14')}
        fontWeight="700"
        fill={color}
        className="font-mono tabular-nums"
      >
        {dialOverText || `${clamped}%`}
      </text>
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize={isSm ? '8' : '9'}
        className="fill-dim font-mono tabular-nums"
      >
        {clamped <= 100 ? `${clamped}% of target` : `target + ${Math.max(0, Math.round(clamped - 100))}%`}
      </text>
    </svg>
  );
});

const LADDER_ZONE_TONE = {
  below: { color: '#64748b', textClass: 'text-dim', dotClass: 'bg-dim/70' },
  near: { color: '#3b82f6', textClass: 'text-accent', dotClass: 'bg-accent' },
  fresh: { color: '#22c55e', textClass: 'text-green', dotClass: 'bg-green' },
  stale: { color: '#f59e0b', textClass: 'text-amber', dotClass: 'bg-amber' },
  late: { color: '#ef4444', textClass: 'text-red', dotClass: 'bg-red' },
  rejected: { color: '#a855f7', textClass: 'text-purple-400', dotClass: 'bg-purple-400' },
};

/**
 * Spatial Vertical Level Ladder for HTF Breakouts (`htf_breakout` / `prev_day_breakout`):
 * - Reference High & Low dashed lines with shaded reference range
 * - Optional Buffer line
 * - Fresh (0–25%), Stale (25–60%), Late (60–100%), and Rejected (>cap) zones derived from `htf_breakout_max_expansion_pct`
 * - Current live price marker (`px`), candle-confirm state, countdown to trigger close, and 3-metric readout
 */
export const HtfBreakoutLadder = React.memo(function HtfBreakoutLadder({ ladder, compact = false }) {
  if (!ladder) return null;

  const {
    refTf,
    trigTf,
    mode,
    bufferPct,
    effectiveMaxExpPct,
    hasHardCap,
    refHigh,
    refLow,
    breakoutLevel,
    expansionCap,
    livePrice,
    distFromLevelPct,
    capUsedPct,
    capRoomPct,
    candleConfirmState,
    countdownText,
    zone,
    zoneLabel,
    isOverCap,
    isLong,
  } = ladder;

  const zTone = LADDER_ZONE_TONE[zone] || LADDER_ZONE_TONE.below;

  // Compute vertical domain [pMin, pMax] so reference range, breakout level, expansion cap, and livePrice fit cleanly
  const rangeSpan = Math.max(Math.abs(refHigh - refLow), breakoutLevel * 0.005);
  const capDist = Math.max(Math.abs(expansionCap - breakoutLevel), breakoutLevel * 0.01);
  const pMax = isLong
    ? Math.max(expansionCap + capDist * 0.42, livePrice + capDist * 0.18, refHigh + rangeSpan * 0.2)
    : Math.max(refHigh + rangeSpan * 0.22, livePrice + rangeSpan * 0.15);
  const pMin = isLong
    ? Math.min(refLow - rangeSpan * 0.22, livePrice - rangeSpan * 0.15)
    : Math.min(expansionCap - capDist * 0.42, livePrice - capDist * 0.18, refLow - rangeSpan * 0.2);

  const svgH = compact ? 136 : 158;
  const padTop = 12;
  const padBot = 12;
  const plotH = svgH - padTop - padBot;
  const xLeft = 64;
  const xRight = 286;
  const bandW = xRight - xLeft;

  const yOf = (priceVal) => {
    const denom = Math.max(1e-9, pMax - pMin);
    const ratio = (pMax - priceVal) / denom;
    return Math.max(padTop, Math.min(svgH - padBot, padTop + ratio * plotH));
  };

  const yHigh = yOf(refHigh);
  const yLow = yOf(refLow);
  const yBreak = yOf(breakoutLevel);
  const yCap = yOf(expansionCap);
  const yPx = yOf(livePrice);

  // Fresh (0-25%), Stale (25-60%), Late (60-100%) boundaries along the breakout->cap span
  const pFreshEdge = breakoutLevel + (expansionCap - breakoutLevel) * 0.25;
  const pStaleEdge = breakoutLevel + (expansionCap - breakoutLevel) * 0.60;
  const yFreshEdge = yOf(pFreshEdge);
  const yStaleEdge = yOf(pStaleEdge);

  const rectBand = (y1, y2) => ({
    y: Math.min(y1, y2),
    height: Math.max(1.5, Math.abs(y2 - y1)),
  });

  const rangeBox = rectBand(yHigh, yLow);
  const freshBox = rectBand(yBreak, yFreshEdge);
  const staleBox = rectBand(yFreshEdge, yStaleEdge);
  const lateBox = rectBand(yStaleEdge, yCap);
  const rejectBox = isLong ? rectBand(padTop, yCap) : rectBand(yCap, svgH - padBot);

  const absDist = Math.abs(distFromLevelPct);
  const distText = `${distFromLevelPct >= 0 ? '+' : '-'}${absDist >= 10 ? absDist.toFixed(1) : absDist.toFixed(2)}%`;
  const capUsedRound = Math.max(0, Math.round(capUsedPct));
  const capRoomFormatted = capRoomPct <= 0
    ? '0% (over)'
    : `${capRoomPct >= 10 ? capRoomPct.toFixed(1) : capRoomPct.toFixed(2)}%`;

  let confirmLabel = isLong ? `Below ${refTf} high` : `Above ${refTf} low`;
  let confirmToneClass = 'text-dim';
  let confirmDotClass = 'bg-dim/60';
  if (candleConfirmState === 'closed_beyond') {
    confirmLabel = 'Candle closed beyond ✓';
    confirmToneClass = 'text-green';
    confirmDotClass = 'bg-green';
  } else if (candleConfirmState === 'wicked_only') {
    confirmLabel = mode === 'closed_candle_confirm' ? 'Wicked only · awaiting close' : 'Wicked through level';
    confirmToneClass = 'text-amber';
    confirmDotClass = 'bg-amber';
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Status & Candle-Confirm Bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] font-mono">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={cn('inline-flex items-center gap-1.5 font-bold', zTone.textClass)}>
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', zTone.dotClass)} />
            {zoneLabel}
          </span>
          <span className={cn('inline-flex items-center gap-1.5 font-medium', confirmToneClass)}>
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', confirmDotClass)} />
            {confirmLabel}
          </span>
        </div>
        <span className="text-[9.5px] text-dim tabular-nums">
          {isOverCap
            ? 'entry blocked: over max expansion'
            : (candleConfirmState === 'wicked_only' || !isOverCap)
              ? countdownText
              : ''}
        </span>
      </div>

      {/* Vertical Level Ladder SVG */}
      <svg
        width="100%"
        viewBox={`0 0 380 ${svgH}`}
        className="w-full overflow-visible select-none rounded-lg bg-bg/35 border border-border/30"
        aria-label={`HTF Breakout level ladder: live ${fmtPrice(livePrice)} vs ${refTf} level ${fmtPrice(breakoutLevel)}`}
      >
        {/* Reference Day Range Band */}
        <rect
          x={xLeft}
          y={rangeBox.y}
          width={bandW}
          height={rangeBox.height}
          fill="#64748b"
          fillOpacity="0.10"
        />
        {rangeBox.height >= 16 && (
          <text
            x={xLeft + 6}
            y={rangeBox.y + rangeBox.height / 2 + 3}
            fontSize="9"
            className="fill-dim/75 font-mono"
          >
            {refTf} range
          </text>
        )}

        {/* Breakout Expansion Zones: Fresh (0-25%), Stale (25-60%), Late (60-100%), Rejected (>100%) */}
        <rect x={xLeft} y={freshBox.y} width={bandW} height={freshBox.height} fill="#22c55e" fillOpacity="0.16" />
        <rect x={xLeft} y={staleBox.y} width={bandW} height={staleBox.height} fill="#f59e0b" fillOpacity="0.16" />
        <rect x={xLeft} y={lateBox.y} width={bandW} height={lateBox.height} fill="#ef4444" fillOpacity="0.16" />
        <rect x={xLeft} y={rejectBox.y} width={bandW} height={rejectBox.height} fill="#a855f7" fillOpacity="0.13" />

        {/* Zone Labels Inside Ladder */}
        {freshBox.height >= 9 && (
          <text x={xLeft + 6} y={freshBox.y + freshBox.height / 2 + 3} fontSize="8.5" fill="#22c55e" className="font-mono font-semibold">
            Fresh (0–25% cap)
          </text>
        )}
        {staleBox.height >= 9 && (
          <text x={xLeft + 6} y={staleBox.y + staleBox.height / 2 + 3} fontSize="8.5" fill="#f59e0b" className="font-mono font-semibold">
            Stale (25–60%)
          </text>
        )}
        {lateBox.height >= 9 && (
          <text x={xLeft + 6} y={lateBox.y + lateBox.height / 2 + 3} fontSize="8.5" fill="#ef4444" className="font-mono font-semibold">
            Late (60–100%)
          </text>
        )}
        {rejectBox.height >= 10 && (
          <text x={xLeft + 6} y={rejectBox.y + rejectBox.height / 2 + 3} fontSize="8.5" fill="#a855f7" className="font-mono font-semibold">
            {hasHardCap ? 'Rejected (>cap)' : 'Extended'}
          </text>
        )}

        {/* Reference Low Line */}
        <line
          x1={xLeft}
          y1={yLow}
          x2={xRight}
          y2={yLow}
          stroke={!isLong ? '#3b82f6' : '#64748b'}
          strokeWidth={!isLong ? '1.5' : '1'}
          strokeDasharray="3 3"
        />
        <text x={xLeft - 5} y={yLow + 3} textAnchor="end" fontSize="9" className={cn('font-mono', !isLong ? 'fill-text font-bold' : 'fill-dim')}>
          {refTf} low
        </text>
        <text x={xRight + 5} y={yLow + 3} fontSize="9" className={cn('font-mono tabular-nums', !isLong ? 'fill-text font-bold' : 'fill-dim')}>
          {fmtPrice(refLow)}
        </text>

        {/* Reference High Line */}
        <line
          x1={xLeft}
          y1={yHigh}
          x2={xRight}
          y2={yHigh}
          stroke={isLong ? '#3b82f6' : '#64748b'}
          strokeWidth={isLong ? '1.5' : '1'}
          strokeDasharray="4 3"
        />
        <text x={xLeft - 5} y={yHigh + 3} textAnchor="end" fontSize="9" className={cn('font-mono', isLong ? 'fill-text font-bold' : 'fill-dim')}>
          {refTf} high
        </text>
        <text x={xRight + 5} y={yHigh + 3} fontSize="9" className={cn('font-mono tabular-nums', isLong ? 'fill-text font-bold' : 'fill-dim')}>
          {fmtPrice(refHigh)}
        </text>

        {/* Optional Buffer Line (when bufferPct > 0) */}
        {bufferPct > 0 && Math.abs(yBreak - (isLong ? yHigh : yLow)) > 3 && (
          <>
            <line
              x1={xLeft}
              y1={yBreak}
              x2={xRight}
              y2={yBreak}
              stroke="#3b82f6"
              strokeWidth="1.25"
              strokeDasharray="2 2"
            />
            <text x={xLeft - 5} y={yBreak + 3} textAnchor="end" fontSize="8.5" fill="#3b82f6" className="font-mono">
              buf +{bufferPct}%
            </text>
          </>
        )}

        {/* Max-Expansion Cap Line */}
        <line
          x1={xLeft}
          y1={yCap}
          x2={xRight}
          y2={yCap}
          stroke="#a855f7"
          strokeWidth="1.25"
          strokeDasharray="3 3"
        />
        <text x={xLeft - 5} y={yCap + 3} textAnchor="end" fontSize="9" fill="#a855f7" className="font-mono font-semibold">
          cap {isLong ? '+' : '-'}{effectiveMaxExpPct}%
        </text>
        <text x={xRight + 5} y={yCap + 3} fontSize="9" fill="#a855f7" className="font-mono tabular-nums">
          {fmtPrice(expansionCap)}
        </text>

        {/* Live Price Marker */}
        <line
          x1={xLeft}
          y1={yPx}
          x2={xRight}
          y2={yPx}
          stroke={zTone.color}
          strokeWidth="2"
        />
        <circle cx={xRight} cy={yPx} r="3.5" fill={zTone.color} />
        <rect x={xRight + 4} y={yPx - 8} width="84" height="16" rx="3" fill={zTone.color} />
        <text x={xRight + 46} y={yPx + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#ffffff" className="font-mono tabular-nums">
          {fmtPrice(livePrice)}
        </text>
        <rect x={16} y={yPx - 7.5} width="42" height="15" rx="3" fill={zTone.color} fillOpacity="0.18" stroke={zTone.color} strokeWidth="0.8" />
        <text x={37} y={yPx + 3} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={zTone.color} className="font-mono tabular-nums">
          {distText}
        </text>
      </svg>

      {/* Bottom 3-Metric Readout */}
      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/30 font-mono text-[10px] tabular-nums">
        <div className="flex flex-col">
          <span className="text-[9px] text-dim">{distFromLevelPct >= 0 ? 'Past level' : 'To level'}</span>
          <span className={cn('font-bold', zTone.textClass)}>{distText}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-dim">{hasHardCap ? `Cap used (${effectiveMaxExpPct}%)` : `Ref span (${effectiveMaxExpPct}%)`}</span>
          <span className={cn('font-bold', capUsedRound > 100 ? 'text-purple-400' : capUsedRound > 60 ? 'text-red' : 'text-text')}>
            {distFromLevelPct < 0 ? '0%' : `${capUsedRound}%`}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span className="text-[9px] text-dim">Cap room</span>
          <span className={cn('font-bold', capRoomPct <= 0 ? 'text-purple-400' : 'text-text')}>
            {capRoomFormatted}
          </span>
        </div>
      </div>
    </div>
  );
});

/**
 * Real-time condition gauges & spatial HTF breakout ladder:
 * - Semicircular 0–150% dials for threshold/spread signals
 * - Vertical Level Ladder for HTF Breakouts (`htf_breakout` / `prev_day_breakout`)
 * - Single shared legend in header (never repeated per card)
 * - De-duplicated In-Position runway (no duplicate Entry/SL/TP/PnL text blocks)
 */
export const CandidateConditionsGauge = React.memo(function CandidateConditionsGauge({
  opp = null,
  strategyConfig = {},
  activeTrade = null,
  closedTrades = [],
  isPaused = false,
  gateState = 'ACTIVE',
  gateReason = '',
  compact = false,
  className = '',
  nowMs = Date.now(),
}) {
  const model = useMemo(() => buildCandidateConditionsModel({
    opp,
    strategyConfig,
    activeTrade,
    closedTrades,
    isPaused,
    gateState,
    gateReason,
    nowMs,
  }), [opp, strategyConfig, activeTrade, closedTrades, isPaused, gateState, gateReason, nowMs]);

  const isInPos = model.mode === 'in_position';
  const posMeta = model.positionMeta;
  const hasCandidate = model.symbol && model.symbol !== '---';
  const compositeDial = model.compositeDial || { dialZone: 'watching', dialStatus: 'Watching', dialOverText: '100% to go' };

  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm overflow-hidden flex flex-col',
        compact ? 'p-2.5 gap-2' : 'p-3.5 gap-3',
        className
      )}
    >
      {/* Top Header Strip */}
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-border/40 pb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-wider text-dim">
            {isInPos ? 'Exit Conditions' : 'Entry Conditions'}
          </span>
          {hasCandidate && (
            <span className="text-xs font-black font-mono text-text">
              {model.symbol}
            </span>
          )}
          {model.dir !== '---' && (
            <span
              className={cn(
                'text-[10px] font-black font-mono uppercase',
                model.dir === 'LONG' ? 'text-green' : 'text-red'
              )}
            >
              {model.dir}
            </span>
          )}
          <span className="text-[10px] font-mono text-dim">
            · {isInPos ? 'Exit Gate' : 'Signal Gate'}: <strong className="text-text">{model.logicLabel}</strong>
          </span>
          {opp?.isEntrySnapshot && (
            <span className="text-[10px] font-mono text-accent">
              · Entry snapshot
              {typeof opp.capRespected === 'boolean' && (
                <strong className={opp.capRespected ? 'text-green' : 'text-red'}>
                  {' '}· Cap {opp.capRespected ? 'respected' : 'exceeded'}
                </strong>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Single Zone Legend (shown once in header) */}
          {!compact && (
            <div className="hidden xl:flex items-center gap-2.5 text-[9.5px] font-mono text-dim">
              {DIAL_ZONES.map((z) => (
                <span key={z.key} className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-xs shrink-0" style={{ backgroundColor: z.color }} />
                  <span className="text-text/80 font-semibold">{z.label}</span>
                  <span className="text-dim/70">{z.range}</span>
                </span>
              ))}
            </div>
          )}

          {/* Overall Status Indicator */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold tabular-nums">
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', ZONE_DOT_CLASS[compositeDial.dialZone] || 'bg-dim')} />
            <span className={cn(ZONE_TEXT_CLASS[compositeDial.dialZone] || 'text-dim')}>
              {model.overallStatus}
            </span>
            {hasCandidate && model.totalConditionsCount > 0 && (
              <span className="text-dim font-normal">
                · {model.firedConditionsCount}/{model.totalConditionsCount} signals
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Condition Cards + Composite Summary Grid */}
      {model.conditions.length === 0 ? (
        <div className="text-[11px] font-mono text-dim py-2 text-center">
          No {isInPos ? 'exit' : 'entry'} signal conditions configured — relying on {isInPos ? 'SL / TP levels' : 'scanner gate'}.
        </div>
      ) : (
        <div
          className={cn(
            'grid gap-2.5',
            compact
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'
          )}
        >
          {model.conditions.map((c) => {
            const cZone = c.dialZone || 'watching';
            const isLadder = c.visualization === 'ladder' && c.ladder;
            return (
              <div
                key={c.key}
                className={cn(
                  'rounded-xl border border-border/50 bg-bg/40 p-3 flex flex-col justify-between gap-2 transition-colors',
                  isLadder && (compact ? 'sm:col-span-2' : 'sm:col-span-2'),
                  cZone === 'fresh' && 'border-green/35 bg-green/[0.03]',
                  cZone === 'stale' && 'border-amber/35 bg-amber/[0.03]',
                  (cZone === 'late' || cZone === 'blocked') && 'border-red/35 bg-red/[0.03]'
                )}
              >
                {/* Card Top Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          'text-[9px] font-black font-mono uppercase tracking-wider',
                          c.isScannerGate ? 'text-amber' : 'text-dim'
                        )}
                      >
                        {c.connector}
                      </span>
                      <span className="text-xs font-bold text-text">
                        {c.label}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-dim mt-0.5 leading-snug break-words">
                      {c.timeframe}{c.paramsText && c.paramsText !== 'Standard' ? ` · ${c.paramsText}` : ''}
                    </div>
                    <div className="text-[9px] font-mono text-dim/75 mt-0.5 tabular-nums">
                      {formatFreshness(c.evaluatedAtMs, nowMs)}
                    </div>
                  </div>

                  {/* Unboxed Zone Status Indicator */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] font-mono font-bold shrink-0',
                      ZONE_TEXT_CLASS[cZone] || 'text-dim'
                    )}
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full', ZONE_DOT_CLASS[cZone] || 'bg-dim')} />
                    {c.dialStatus || c.stateLabel}
                  </span>
                </div>

                {/* Visualization Body: Spatial Level Ladder for HTF Breakouts, Semicircular Dial for Threshold Signals */}
                {isLadder ? (
                  <HtfBreakoutLadder ladder={c.ladder} compact={compact} />
                ) : (
                  <>
                    <div className="flex justify-center items-center my-0.5">
                      <ConditionDial
                        dialPct={c.dialPct}
                        dialZone={cZone}
                        dialOverText={c.dialOverText}
                        size={compact ? 'sm' : 'md'}
                      />
                    </div>

                    {/* Card Bottom: Live vs Target */}
                    <div className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-border/30 font-mono text-[11px] tabular-nums">
                      <span className="text-dim text-[10px]">Live / Target</span>
                      <div className="truncate">
                        <strong className="text-text font-bold">{c.liveText}</strong>
                        <span className="text-dim"> / {c.targetText}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Composite Gate Card */}
          {model.conditions.length > 1 && (
            <div className="rounded-xl border border-border/60 bg-surface/60 p-3 flex flex-col justify-between gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-text">
                    Composite · {model.logicLabel}
                  </div>
                  <div className="text-[10px] font-mono text-dim mt-0.5 leading-snug">
                    {model.firedConditionsCount}/{model.totalConditionsCount} signals hit
                    {model.logicLabel === 'ALL' ? ' (weakest)' : model.logicLabel === 'ANY' ? ' (strongest)' : ''}
                  </div>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[10px] font-mono font-bold shrink-0',
                    ZONE_TEXT_CLASS[compositeDial.dialZone] || 'text-dim'
                  )}
                >
                  <span className={cn('w-1.5 h-1.5 rounded-full', ZONE_DOT_CLASS[compositeDial.dialZone] || 'bg-dim')} />
                  {compositeDial.dialStatus}
                </span>
              </div>

              <div className="flex justify-center items-center my-0.5">
                <ConditionDial
                  dialPct={model.compositeDialPct}
                  dialZone={compositeDial.dialZone}
                  dialOverText={compositeDial.dialOverText}
                  size={compact ? 'sm' : 'md'}
                />
              </div>

              <div className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-border/30 font-mono text-[10px] text-dim tabular-nums">
                <span>Action</span>
                <span className="text-text font-bold truncate" title={model.actionSummary}>
                  {model.actionSummary}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer Strip: Anti-Whipsaw & Execution Gate */}
      {!isInPos && model.antiWhipsaw && !model.antiWhipsaw.disabled && (
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/40 text-[10px] font-mono flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                model.antiWhipsaw.locked ? 'bg-amber' : 'bg-green'
              )}
            />
            <span className="text-dim font-bold uppercase">Anti-Whipsaw:</span>
            <span
              className={cn(
                'font-bold truncate',
                model.antiWhipsaw.locked ? 'text-amber' : 'text-text/90'
              )}
            >
              {model.antiWhipsaw.summary}
            </span>
          </div>
          <span className="text-dim tabular-nums">
            {model.actionSummary}
          </span>
        </div>
      )}
    </div>
  );
});

export default CandidateConditionsGauge;
