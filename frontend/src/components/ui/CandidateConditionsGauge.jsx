import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './primitives';
import { price as fmtPrice } from '../../lib/formatters';
import { buildCandidateConditionsModel, computeConditionValueDelta } from '../../utils/candidateConditions';

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
 * Isolated leaf freshness label with adaptive 5s/15s timer so parent
 * SVG dials & model useMemo never recompute just for relative age ticks.
 * Color-codes freshness by recency and active value change.
 */
const ConditionFreshness = React.memo(function ConditionFreshness({ evaluatedAtMs, changeInfo = null }) {
  const [now, setNow] = useState(() => Date.now());
  const evaluated = Number(evaluatedAtMs);
  const valid = Number.isFinite(evaluated) && evaluated > 0;

  useEffect(() => {
    if (!valid) return undefined;
    let timerId = null;
    const scheduleNext = () => {
      const currNow = Date.now();
      setNow(currNow);
      const ageSec = Math.max(0, (currNow - evaluated) / 1000);
      const nextDelay = ageSec < 60 ? 5000 : ageSec < 3600 ? 15000 : 60000;
      timerId = setTimeout(scheduleNext, nextDelay);
    };
    const initAgeSec = Math.max(0, (Date.now() - evaluated) / 1000);
    const initDelay = initAgeSec < 60 ? 5000 : initAgeSec < 3600 ? 15000 : 60000;
    timerId = setTimeout(scheduleNext, initDelay);
    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [valid, evaluated]);

  const ageSec = valid ? Math.max(0, Math.floor((now - evaluated) / 1000)) : Infinity;
  const isFreshTick = Boolean(changeInfo?.changed) || ageSec <= 5;
  const isRecent = ageSec <= 20;

  return (
    <span
      className={cn(
        'transition-colors duration-300',
        isFreshTick
          ? (changeInfo?.toneClass || 'text-green')
          : isRecent
            ? 'text-text/75'
            : 'text-dim/75'
      )}
    >
      {formatFreshness(evaluatedAtMs, now)}
    </span>
  );
});

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
 * Lightweight 1D vertical label de-collision solver (O(N), N <= 5).
 * Preserves order and nudges labels apart so price callouts never overlap on tight ranges.
 */
function decollideVerticalLabels(items, minGap, minY, maxY) {
  if (!items || items.length <= 1) return items;
  const sorted = items
    .map((item, idx) => ({ ...item, _idx: idx, labelY: Math.max(minY, Math.min(maxY, item.y)) }))
    .sort((a, b) => a.y - b.y);

  // Forward pass: push down overlapping items
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].labelY - sorted[i - 1].labelY < minGap) {
      sorted[i].labelY = Math.min(maxY, sorted[i - 1].labelY + minGap);
    }
  }
  // Backward pass: pull up if clamped at bottom
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i + 1].labelY - sorted[i].labelY < minGap) {
      sorted[i].labelY = Math.max(minY, sorted[i + 1].labelY - minGap);
    }
  }
  return sorted;
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
  subText = '',
  size = 'md',
  changeInfo = null,
}) {
  const clamped = Math.max(0, Math.min(150, Math.round(Number(dialPct) || 0)));
  const color = ZONE_COLOR_MAP[dialZone] || ZONE_COLOR_MAP.watching;

  const isSm = size === 'sm';
  const w = isSm ? 156 : 212;
  const h = isSm ? 90 : 118;
  const cx = w / 2;
  const cy = isSm ? 70 : 92;
  const r = isSm ? 52 : 70;
  const strokeW = isSm ? 8.5 : 10.5;

  const [tx1, ty1] = polar(cx, cy, r - strokeW * 0.95, pctToAngle(100));
  const [tx2, ty2] = polar(cx, cy, r + strokeW * 0.95, pctToAngle(100));
  const [nx, ny] = polar(cx, cy, r - strokeW * 0.85, pctToAngle(clamped));
  const [sx, sy] = polar(cx, cy, r, -180);
  const [ex, ey] = polar(cx, cy, r, 0);

  const subTextBase = subText || (clamped <= 100 ? `${clamped}% of target` : `target + ${Math.max(0, Math.round(clamped - 100))}%`);
  void changeInfo;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="overflow-visible select-none shrink-0"
      aria-label={`Condition gauge at ${clamped}% (${dialOverText})`}
    >
      {/* Subtle Under-Track Base */}
      <path
        d={describeArc(cx, cy, r, 0, 150)}
        stroke="currentColor"
        className="text-border/35"
        strokeWidth={strokeW + 2}
        strokeLinecap="round"
        fill="none"
      />

      {/* Background Zone Track Segments (Widened piecewise arcs for Fresh & Stale) */}
      <path d={describeArc(cx, cy, r, 0, 79)} stroke="#64748b" strokeOpacity="0.22" strokeWidth={strokeW} fill="none" />
      <path d={describeArc(cx, cy, r, 80, 99)} stroke="#3b82f6" strokeOpacity="0.30" strokeWidth={strokeW} fill="none" />
      <path d={describeArc(cx, cy, r, 100, 104.7)} stroke="#22c55e" strokeOpacity="0.40" strokeWidth={strokeW} fill="none" />
      <path d={describeArc(cx, cy, r, 105.3, 114.7)} stroke="#f59e0b" strokeOpacity="0.40" strokeWidth={strokeW} fill="none" />
      <path d={describeArc(cx, cy, r, 115.3, 150)} stroke="#ef4444" strokeOpacity="0.36" strokeWidth={strokeW} fill="none" />

      {/* Active Fill Arc Halo + Core */}
      {clamped > 0 && (
        <>
          <path
            d={describeArc(cx, cy, r, 0, clamped)}
            stroke={color}
            strokeOpacity="0.22"
            strokeWidth={strokeW + 4}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={describeArc(cx, cy, r, 0, clamped)}
            stroke={color}
            strokeWidth={strokeW}
            fill="none"
            strokeLinecap="round"
          />
        </>
      )}

      {/* Target Tick at 100% */}
      <line
        x1={tx1}
        y1={ty1}
        x2={tx2}
        y2={ty2}
        stroke="currentColor"
        className="text-text"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <text
        x={tx2 + 2}
        y={ty2 - 5}
        textAnchor="middle"
        fontSize={isSm ? '8' : '8.5'}
        className="fill-dim font-mono font-bold uppercase tracking-tight"
      >
        target
      </text>

      {/* Scale Endpoints */}
      <text x={sx - 2} y={sy + 13} textAnchor="start" fontSize={isSm ? '8' : '8.5'} className="fill-dim/75 font-mono tabular-nums">
        0%
      </text>
      <text x={ex + 2} y={ey + 13} textAnchor="end" fontSize={isSm ? '8' : '8.5'} className="fill-dim/75 font-mono tabular-nums">
        +50%
      </text>

      {/* Needle + Dual-Ring Center Hub */}
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke="currentColor"
        className="text-text/90"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx={nx} cy={ny} r={isSm ? 2 : 2.5} fill={color} />
      <circle cx={cx} cy={cy} r={isSm ? 4.5 : 5.5} fill={color} fillOpacity="0.22" />
      <circle cx={cx} cy={cy} r={isSm ? 2.75 : 3.25} className="fill-text" />

      {/* Center Readout: Relative to Target */}
      <text
        x={cx}
        y={cy - (isSm ? 15 : 19)}
        textAnchor="middle"
        fontSize={isSm ? (dialOverText.length > 14 ? '9.5' : '11.5') : (dialOverText.length > 14 ? '11.5' : '14')}
        fontWeight="800"
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
        {subTextBase}
      </text>
    </svg>
  );
});

const LADDER_ZONE_TONE = {
  below: {
    color: '#64748b',
    textClass: 'text-dim',
    dotClass: 'bg-dim/80',
    badgeClass: 'bg-surface/80 text-dim border-border/50',
  },
  near: {
    color: '#3b82f6',
    textClass: 'text-accent',
    dotClass: 'bg-accent',
    badgeClass: 'bg-accent/12 text-accent border-accent/30',
  },
  fresh: {
    color: '#22c55e',
    textClass: 'text-green',
    dotClass: 'bg-green',
    badgeClass: 'bg-green/12 text-green border-green/30',
  },
  stale: {
    color: '#f59e0b',
    textClass: 'text-amber',
    dotClass: 'bg-amber',
    badgeClass: 'bg-amber/12 text-amber border-amber/30',
  },
  late: {
    color: '#ef4444',
    textClass: 'text-red',
    dotClass: 'bg-red',
    badgeClass: 'bg-red/12 text-red border-red/30',
  },
  rejected: {
    color: '#a855f7',
    textClass: 'text-purple-400',
    dotClass: 'bg-purple-400',
    badgeClass: 'bg-purple-500/12 text-purple-300 border-purple-400/35',
  },
};

/**
 * Modern App-Like Spatial Level Ladder for HTF Breakouts (`htf_breakout` / `prev_day_breakout`):
 * - Hero Breakout Bar: Live price vs breakout level, timeframe pair (`refTf → trigTf`), candle confirmation state, and countdown
 * - Collision-free Spatial SVG Visualizer: de-collided price level callouts with leader ticks, glowing live price cursor pill, and color-coded expansion zones
 * - Segmented Expansion Cap Allowance Meter (`Fresh 0–25%` · `Stale 25–60%` · `Late 60–100%`)
 * - 3-Card Bento Telemetry Dock (`To/Past Level`, `Expansion Used`, `Cap Room Left`)
 */
export const HtfBreakoutLadder = React.memo(function HtfBreakoutLadder({ ladder, compact = false, changeInfo = null }) {
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

  // Compute vertical domain [pMin, pMax] so reference range, breakout level, expansion cap, and livePrice fit with generous breathing room
  const rangeSpan = Math.max(Math.abs(refHigh - refLow), breakoutLevel * 0.005);
  const capDist = Math.max(Math.abs(expansionCap - breakoutLevel), breakoutLevel * 0.01);
  const pMax = isLong
    ? Math.max(expansionCap + capDist * 0.48, livePrice + capDist * 0.24, refHigh + rangeSpan * 0.24)
    : Math.max(refHigh + rangeSpan * 0.26, livePrice + rangeSpan * 0.18);
  const pMin = isLong
    ? Math.min(refLow - rangeSpan * 0.26, livePrice - rangeSpan * 0.18)
    : Math.min(expansionCap - capDist * 0.48, livePrice - capDist * 0.24, refLow - rangeSpan * 0.24);

  const svgW = 400;
  const svgH = compact ? 146 : 166;
  const padTop = 14;
  const padBot = 14;
  const plotH = svgH - padTop - padBot;
  const xLeft = 78;
  const xRight = 294;
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
  const priceDeltaVal = livePrice - breakoutLevel;
  const absPriceDelta = Math.abs(priceDeltaVal);
  const priceDeltaText = Number.isFinite(absPriceDelta) && breakoutLevel > 0
    ? `${priceDeltaVal >= 0 ? '+' : '-'}${fmtPrice(absPriceDelta)}`
    : distText;

  const capUsedRound = Math.max(0, Math.round(capUsedPct));
  const capBarFillPct = distFromLevelPct < 0 ? 0 : Math.max(2, Math.min(100, capUsedPct));
  const capRoomFormatted = capRoomPct <= 0
    ? '0% (over)'
    : `${capRoomPct >= 10 ? capRoomPct.toFixed(1) : capRoomPct.toFixed(2)}%`;

  let confirmLabel = isLong ? `Below ${refTf} high` : `Above ${refTf} low`;
  let confirmToneClass = 'text-dim bg-surface/60 border-border/40';
  let confirmDotClass = 'bg-dim/60';
  if (candleConfirmState === 'closed_beyond') {
    confirmLabel = 'Candle closed beyond ✓';
    confirmToneClass = 'text-green bg-green/10 border-green/30';
    confirmDotClass = 'bg-green';
  } else if (candleConfirmState === 'wicked_only') {
    confirmLabel = mode === 'closed_candle_confirm' ? 'Wicked only · awaiting close' : 'Wicked through level';
    confirmToneClass = 'text-amber bg-amber/10 border-amber/30';
    confirmDotClass = 'bg-amber animate-pulse';
  }

  // De-collide Left Level Labels
  const rawLeftLabels = [
    {
      id: 'low',
      y: yLow,
      text: `${refTf} low`,
      color: !isLong ? '#60a5fa' : '#94a3b8',
      bold: !isLong,
    },
    {
      id: 'high',
      y: yHigh,
      text: `${refTf} high`,
      color: isLong ? '#60a5fa' : '#94a3b8',
      bold: isLong,
    },
    ...(bufferPct > 0
      ? [{
          id: 'buf',
          y: yBreak,
          text: `buf +${bufferPct}%`,
          color: '#38bdf8',
          bold: true,
        }]
      : []),
    {
      id: 'cap',
      y: yCap,
      text: `cap ${isLong ? '+' : '-'}${effectiveMaxExpPct}%`,
      color: '#c084fc',
      bold: true,
    },
  ];
  const leftLabels = decollideVerticalLabels(rawLeftLabels, 13, 12, svgH - 12);

  // De-collide Right Price Labels (excluding livePrice pill which floats prominently, nudging static prices away from yPx)
  const rawRightLabels = [
    {
      id: 'lowPx',
      y: yLow,
      text: fmtPrice(refLow),
      color: !isLong ? '#e2e8f0' : '#94a3b8',
      bold: !isLong,
    },
    {
      id: 'highPx',
      y: yHigh,
      text: fmtPrice(refHigh),
      color: isLong ? '#e2e8f0' : '#94a3b8',
      bold: isLong,
    },
    {
      id: 'capPx',
      y: yCap,
      text: fmtPrice(expansionCap),
      color: '#c084fc',
      bold: true,
    },
  ].filter((item) => Math.abs(item.y - yPx) >= 13);
  const rightLabels = decollideVerticalLabels(rawRightLabels, 13, 12, svgH - 12);

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* App-Like Hero Breakout Summary Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg bg-surface/55 border border-border/40 px-2.5 py-1.5 text-[10px] font-mono">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border font-bold tracking-tight',
              zTone.badgeClass
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', zTone.dotClass)} />
            {zoneLabel}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md border font-semibold',
              confirmToneClass
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', confirmDotClass)} />
            {confirmLabel}
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto tabular-nums">
          <span className="text-dim hidden sm:inline">
            Lvl <strong className="text-text font-bold">{fmtPrice(breakoutLevel)}</strong>
          </span>
          { (isOverCap || countdownText) && (
            <span
              className={cn(
                'px-1.5 py-0.5 rounded border text-[9.5px] font-semibold',
                isOverCap
                  ? 'bg-purple-500/12 border-purple-400/35 text-purple-300'
                  : 'bg-bg/60 border-border/40 text-dim'
              )}
            >
              {isOverCap ? 'Blocked · Over Max Expansion' : `⏱ ${countdownText}`}
            </span>
          )}
        </div>
      </div>

      {/* Spatial Vertical Level Ladder SVG */}
      <svg
        width="100%"
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full overflow-visible select-none rounded-xl bg-gradient-to-b from-bg/75 via-bg/50 to-bg/75 border border-border/45 shadow-inner"
        aria-label={`HTF Breakout level ladder: live ${fmtPrice(livePrice)} vs ${refTf} level ${fmtPrice(breakoutLevel)}`}
      >
        {/* Reference Day Range Band */}
        <rect
          x={xLeft}
          y={rangeBox.y}
          width={bandW}
          height={rangeBox.height}
          rx="2"
          fill="#64748b"
          fillOpacity="0.11"
        />
        <rect
          x={xLeft}
          y={rangeBox.y}
          width="3"
          height={rangeBox.height}
          fill="#64748b"
          fillOpacity="0.45"
        />
        {rangeBox.height >= 16 && (
          <text
            x={xLeft + 10}
            y={rangeBox.y + rangeBox.height / 2 + 3}
            fontSize="8.5"
            className="fill-dim/80 font-mono font-medium uppercase tracking-wider"
          >
            {refTf} ref range
          </text>
        )}

        {/* Breakout Expansion Zones: Fresh (0-25%), Stale (25-60%), Late (60-100%), Rejected (>100%) */}
        <rect x={xLeft} y={freshBox.y} width={bandW} height={freshBox.height} fill="#22c55e" fillOpacity="0.16" />
        <rect x={xLeft} y={freshBox.y} width="3" height={freshBox.height} fill="#22c55e" fillOpacity="0.85" />

        <rect x={xLeft} y={staleBox.y} width={bandW} height={staleBox.height} fill="#f59e0b" fillOpacity="0.15" />
        <rect x={xLeft} y={staleBox.y} width="3" height={staleBox.height} fill="#f59e0b" fillOpacity="0.85" />

        <rect x={xLeft} y={lateBox.y} width={bandW} height={lateBox.height} fill="#ef4444" fillOpacity="0.15" />
        <rect x={xLeft} y={lateBox.y} width="3" height={lateBox.height} fill="#ef4444" fillOpacity="0.85" />

        <rect x={xLeft} y={rejectBox.y} width={bandW} height={rejectBox.height} fill="#a855f7" fillOpacity="0.13" />
        <rect x={xLeft} y={rejectBox.y} width="3" height={rejectBox.height} fill="#a855f7" fillOpacity="0.8" />

        {/* Zone Labels Inside Rail */}
        {freshBox.height >= 10 && (
          <text x={xLeft + 10} y={freshBox.y + freshBox.height / 2 + 3} fontSize="8.5" fill="#4ade80" className="font-mono font-bold">
            Fresh · 0–25% cap
          </text>
        )}
        {staleBox.height >= 10 && (
          <text x={xLeft + 10} y={staleBox.y + staleBox.height / 2 + 3} fontSize="8.5" fill="#fbbf24" className="font-mono font-bold">
            Stale · 25–60%
          </text>
        )}
        {lateBox.height >= 10 && (
          <text x={xLeft + 10} y={lateBox.y + lateBox.height / 2 + 3} fontSize="8.5" fill="#f87171" className="font-mono font-bold">
            Late · 60–100%
          </text>
        )}
        {rejectBox.height >= 11 && (
          <text x={xLeft + 10} y={rejectBox.y + rejectBox.height / 2 + 3} fontSize="8.5" fill="#c084fc" className="font-mono font-bold">
            {hasHardCap ? 'Over Cap · Rejected' : 'Extended Zone'}
          </text>
        )}

        {/* Reference Low Line */}
        <line
          x1={xLeft}
          y1={yLow}
          x2={xRight}
          y2={yLow}
          stroke={!isLong ? '#3b82f6' : '#64748b'}
          strokeWidth={!isLong ? '1.75' : '1'}
          strokeDasharray={!isLong ? '4 2.5' : '3 3'}
        />

        {/* Reference High Line */}
        <line
          x1={xLeft}
          y1={yHigh}
          x2={xRight}
          y2={yHigh}
          stroke={isLong ? '#3b82f6' : '#64748b'}
          strokeWidth={isLong ? '1.75' : '1'}
          strokeDasharray={isLong ? '4 2.5' : '3 3'}
        />

        {/* Optional Buffer Trigger Line (when bufferPct > 0) */}
        {bufferPct > 0 && Math.abs(yBreak - (isLong ? yHigh : yLow)) > 2 && (
          <line
            x1={xLeft}
            y1={yBreak}
            x2={xRight}
            y2={yBreak}
            stroke="#38bdf8"
            strokeWidth="1.5"
            strokeDasharray="3 2"
          />
        )}

        {/* Max-Expansion Cap Line */}
        <line
          x1={xLeft}
          y1={yCap}
          x2={xRight}
          y2={yCap}
          stroke="#a855f7"
          strokeWidth="1.5"
          strokeDasharray="3 2.5"
        />

        {/* De-collided Left Level Labels with Connector Ticks */}
        {leftLabels.map((lbl) => (
          <g key={lbl.id}>
            <path
              d={`M ${xLeft} ${lbl.y.toFixed(1)} L ${xLeft - 4} ${lbl.labelY.toFixed(1)} L ${xLeft - 7} ${lbl.labelY.toFixed(1)}`}
              stroke={lbl.color}
              strokeOpacity="0.55"
              strokeWidth="1"
              fill="none"
            />
            <text
              x={xLeft - 9}
              y={lbl.labelY + 3}
              textAnchor="end"
              fontSize="8.5"
              fill={lbl.color}
              fontWeight={lbl.bold ? '700' : '500'}
              className="font-mono"
            >
              {lbl.text}
            </text>
          </g>
        ))}

        {/* De-collided Right Static Price Labels with Connector Ticks */}
        {rightLabels.map((lbl) => (
          <g key={lbl.id}>
            <path
              d={`M ${xRight} ${lbl.y.toFixed(1)} L ${xRight + 4} ${lbl.labelY.toFixed(1)} L ${xRight + 7} ${lbl.labelY.toFixed(1)}`}
              stroke={lbl.color}
              strokeOpacity="0.5"
              strokeWidth="1"
              fill="none"
            />
            <text
              x={xRight + 9}
              y={lbl.labelY + 3}
              textAnchor="start"
              fontSize="8.5"
              fill={lbl.color}
              fontWeight={lbl.bold ? '700' : '500'}
              className="font-mono tabular-nums"
            >
              {lbl.text}
            </text>
          </g>
        ))}

        {/* Live Price Cursor Line + Radar Halo + Floating Pill Callouts */}
        <line
          x1={xLeft}
          y1={yPx}
          x2={xRight}
          y2={yPx}
          stroke={zTone.color}
          strokeOpacity="0.28"
          strokeWidth="5"
        />
        <line
          x1={xLeft}
          y1={yPx}
          x2={xRight}
          y2={yPx}
          stroke={zTone.color}
          strokeWidth="2"
        />
        <circle cx={xRight} cy={yPx} r="5.5" fill={zTone.color} fillOpacity="0.25" />
        <circle cx={xRight} cy={yPx} r="3.2" fill={zTone.color} />

        {/* Right Floating Live Price Pill */}
        <rect
          x={xRight + 6}
          y={yPx - 9}
          width="94"
          height="18"
          rx="5"
          fill={zTone.color}
        />
        <text
          x={xRight + 53}
          y={yPx + 3.5}
          textAnchor="middle"
          fontSize="9.5"
          fontWeight="800"
          fill="#ffffff"
          className="font-mono tabular-nums"
        >
          {fmtPrice(livePrice)}
        </text>

        {/* Left Signed Distance Pill */}
        <rect
          x="6"
          y={yPx - 8.5}
          width="52"
          height="17"
          rx="4.5"
          fill={zTone.color}
          fillOpacity="0.18"
          stroke={zTone.color}
          strokeWidth="1"
        />
        <text
          x="32"
          y={yPx + 3}
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="800"
          fill={zTone.color}
          className="font-mono tabular-nums"
        >
          {distText}
        </text>
      </svg>

      {/* Segmented Expansion Cap Allowance Progress Bar */}
      <div className="flex flex-col gap-1 px-0.5">
        <div className="flex items-center justify-between text-[9px] font-mono text-dim tabular-nums">
          <span>
            Expansion Allowance ({refTf} → {trigTf})
          </span>
          <span className={cn('font-bold', zTone.textClass)}>
            {distFromLevelPct < 0
              ? `${distText} to breakout`
              : `${capUsedRound}% of ${effectiveMaxExpPct}% cap used`}
          </span>
        </div>
        <div className="relative h-2 w-full rounded-full bg-bg/80 border border-border/40 overflow-hidden flex">
          {/* Segmented Zone Backdrop: 0-25% Fresh, 25-60% Stale, 60-100% Late */}
          <div className="h-full bg-green/20 border-r border-bg/60" style={{ width: '25%' }} title="Fresh Zone (0–25% cap)" />
          <div className="h-full bg-amber/20 border-r border-bg/60" style={{ width: '35%' }} title="Stale Zone (25–60% cap)" />
          <div className="h-full bg-red/20" style={{ width: '40%' }} title="Late Zone (60–100% cap)" />

          {/* Active Expansion Progress Fill */}
          {capBarFillPct > 0 && (
            <div
              className="absolute top-0 bottom-0 left-0 rounded-full transition-all duration-300"
              style={{
                width: `${capBarFillPct}%`,
                backgroundColor: zTone.color,
              }}
            />
          )}
        </div>
      </div>

      {/* Bottom 3-Card Bento Telemetry Dock */}
      <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px] tabular-nums">
        <div className="rounded-lg bg-surface/45 border border-border/35 px-2 py-1.5 flex flex-col justify-between">
          <span className="text-[8.5px] uppercase tracking-wider text-dim font-semibold">
            {distFromLevelPct >= 0 ? 'Past level' : 'To level'}
          </span>
          <div className="flex items-baseline justify-between gap-1 mt-0.5">
            <span
              className={cn(
                'font-bold text-[11px] transition-colors duration-300',
                changeInfo?.changed ? changeInfo.toneClass : zTone.textClass
              )}
            >
              {distText}
            </span>
            <span className="text-[8.5px] text-dim truncate">{priceDeltaText}</span>
          </div>
        </div>

        <div className="rounded-lg bg-surface/45 border border-border/35 px-2 py-1.5 flex flex-col justify-between">
          <span className="text-[8.5px] uppercase tracking-wider text-dim font-semibold">
            {hasHardCap ? `Cap used (${effectiveMaxExpPct}%)` : `Ref span (${effectiveMaxExpPct}%)`}
          </span>
          <div className="flex items-baseline justify-between gap-1 mt-0.5">
            <span
              className={cn(
                'font-bold text-[11px]',
                capUsedRound > 100
                  ? 'text-purple-400'
                  : capUsedRound > 60
                    ? 'text-red'
                    : capUsedRound > 25
                      ? 'text-amber'
                      : distFromLevelPct >= 0
                        ? 'text-green'
                        : 'text-dim'
              )}
            >
              {distFromLevelPct < 0 ? '0%' : `${capUsedRound}%`}
            </span>
            <span className="text-[8.5px] text-dim">
              {distFromLevelPct < 0 ? 'pre-lvl' : zone}
            </span>
          </div>
        </div>

        <div className="rounded-lg bg-surface/45 border border-border/35 px-2 py-1.5 flex flex-col justify-between text-right">
          <span className="text-[8.5px] uppercase tracking-wider text-dim font-semibold">
            Cap room
          </span>
          <div className="flex items-baseline justify-end gap-1 mt-0.5">
            <span
              className={cn(
                'font-bold text-[11px]',
                capRoomPct <= 0
                  ? 'text-purple-400'
                  : capUsedRound > 60
                    ? 'text-amber'
                    : 'text-green'
              )}
            >
              {capRoomFormatted}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

/**
 * Subtle single-line MACD Filter / Histogram readout with zero background/border CLS.
 */
export const MacdFilterStrip = React.memo(function MacdFilterStrip({ macdFilter, changeInfo = null }) {
  if (!macdFilter || !macdFilter.enabled) return null;

  const isEmaFilter = macdFilter.mode === 'ema_filter';
  const histNum = macdFilter.histogram;
  const hasHistNum = Number.isFinite(histNum);
  const expectPositive = macdFilter.expectedSign !== 'negative';
  const isHistGreen = hasHistNum
    ? histNum >= 0
    : (macdFilter.aligned ? expectPositive : !expectPositive);

  const histColorClass = isHistGreen ? 'text-green' : 'text-red';
  const histColorLabel = isHistGreen ? 'Hist. Green' : 'Hist. Red';

  const statusColorClass = macdFilter.aligned
    ? 'text-green'
    : macdFilter.rejected
      ? 'text-purple-400'
      : 'text-red';

  const statusLabel = macdFilter.aligned ? 'Aligned' : 'Not aligned';
  void changeInfo;

  return (
    <div
      className="flex items-center justify-between gap-2 text-[9.5px] font-mono tabular-nums"
      data-testid="macd-filter-strip"
    >
      <span className="text-dim truncate">
        {isEmaFilter ? 'MACD filter' : 'MACD hist'}
      </span>
      <span className="truncate font-semibold">
        <span className={cn('transition-colors duration-300', statusColorClass)}>
          {statusLabel}
        </span>
        <span className="text-dim"> · </span>
        <span className={cn('transition-colors duration-300', histColorClass)}>
          {histColorLabel}
        </span>
      </span>
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
  lastScanTs = 0,
  nowMs = undefined,
}) {
  const mountTsRef = useRef(Date.now());
  const modelNowMs = nowMs ?? (Number(lastScanTs) > 0 ? Number(lastScanTs) : mountTsRef.current);

  const model = useMemo(() => buildCandidateConditionsModel({
    opp,
    strategyConfig,
    activeTrade,
    closedTrades,
    isPaused,
    gateState,
    gateReason,
    lastScanTs,
    nowMs: modelNowMs,
  }), [opp, strategyConfig, activeTrade, closedTrades, isPaused, gateState, gateReason, lastScanTs, modelNowMs]);

  const isInPos = model.mode === 'in_position';
  const hasCandidate = model.symbol && model.symbol !== '---';
  const compositeDial = model.compositeDial || { dialZone: 'watching', dialStatus: 'Watching', dialOverText: '100% to go' };

  // Track single-shot live value changes without polling loops
  const prevSnapshotRef = useRef({ symbol: null, mode: null, overallStatus: null, markPrice: 0, items: {} });
  const [changedValueMap, setChangedValueMap] = useState({});
  const [runwayChange, setRunwayChange] = useState(null);
  const [handoffCue, setHandoffCue] = useState(null);

  const valueSignature = useMemo(
    () => `${model.markPrice}:${model.compositeDialPct}:` + model.conditions.map(
      c => `${c.key}:${c.stateLabel}:${c.liveText}:${c.dialPct}:${c.rawDialPct ?? ''}:${c.ladder?.livePrice ?? ''}:${c.macdFilter?.histogram ?? ''}:${c.macdFilter?.aligned ? 1 : 0}`
    ).join('|'),
    [model.markPrice, model.compositeDialPct, model.conditions]
  );

  useEffect(() => {
    const prev = prevSnapshotRef.current;
    const sameSymbol = prev.symbol && prev.symbol === model.symbol && model.symbol !== '---';
    const nextItems = {};
    const valChanges = {};

    for (const c of model.conditions) {
      nextItems[c.key] = c;
      const oldItem = prev.items[c.key];
      if (sameSymbol && oldItem) {
        const deltaInfo = computeConditionValueDelta(oldItem, c);
        if (deltaInfo) {
          valChanges[c.key] = deltaInfo;
        }
      }
    }

    let nextRunwayChange = null;
    if (sameSymbol && isInPos && prev.markPrice > 0 && model.markPrice > 0 && Math.abs(model.markPrice - prev.markPrice) > 1e-10) {
      const priceDiff = model.markPrice - prev.markPrice;
      const favorable = model.dir === 'SHORT' ? priceDiff < 0 : priceDiff > 0;
      nextRunwayChange = {
        toneClass: favorable ? 'text-green' : 'text-amber',
      };
    }

    let cue = null;
    if (sameSymbol && prev.mode === 'searching' && model.mode === 'in_position') {
      cue = 'Position Open → Exit Monitor';
    } else if (sameSymbol && prev.overallStatus !== model.overallStatus && model.overallStatus === 'ENTRY READY') {
      cue = 'Signals Met → Stage 3 Risk';
    }

    prevSnapshotRef.current = {
      symbol: model.symbol,
      mode: model.mode,
      overallStatus: model.overallStatus,
      markPrice: model.markPrice,
      items: nextItems,
    };

    const hasValChanges = Object.keys(valChanges).length > 0;
    if (!hasValChanges && !nextRunwayChange && !cue) return undefined;

    if (hasValChanges) setChangedValueMap(valChanges);
    if (nextRunwayChange) setRunwayChange(nextRunwayChange);
    if (cue) setHandoffCue(cue);

    const timer = setTimeout(() => {
      setChangedValueMap({});
      setRunwayChange(null);
      setHandoffCue(null);
    }, 1800);
    return () => clearTimeout(timer);
  }, [model.symbol, model.mode, model.overallStatus, model.markPrice, model.dir, isInPos, valueSignature, model.conditions]);

  const runway = isInPos ? model.positionMeta?.positionRunway : null;

  return (
    <div
      key={`${model.symbol}:${model.mode}`}
      className={cn(
        'rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm overflow-hidden flex flex-col animate-in fade-in duration-200',
        isInPos && 'border-green/35',
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
          {handoffCue && (
            <span className="text-[10px] font-mono font-bold text-green animate-handoff-slide">
              · {handoffCue}
            </span>
          )}
          {opp?.isEntrySnapshot && (
            <span className="text-[10px] font-mono text-accent">
              · {opp.snapshotTradeStatus && opp.snapshotTradeStatus !== 'OPEN' ? `History snapshot (${opp.snapshotTradeStatus})` : 'Entry snapshot'}
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
            {!isInPos && model.overallStatus === 'ENTRY READY' && (
              <span className="text-green/90 font-semibold animate-handoff-slide">→ Risk</span>
            )}
            {hasCandidate && model.totalConditionsCount > 0 && (
              <span className="text-dim font-normal">
                · {model.firedConditionsCount}/{model.totalConditionsCount} signals
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Compact In-Position SL -> Entry -> Live -> TP Runway (zero extra API data) */}
      {isInPos && runway && (
        <div className="px-2.5 py-2 rounded-lg bg-bg/45 border border-border/40 flex flex-col gap-1.5 animate-handoff-slide">
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums flex-wrap">
            <span className="text-dim">
              SL <strong className={model.positionMeta?.isProtected ? 'text-green' : 'text-red'}>{fmtPrice(model.positionMeta?.slPrice)}</strong>
              <span className="mx-1.5 text-border">·</span>
              Entry <strong className="text-text">{fmtPrice(model.positionMeta?.entryPrice)}</strong>
              <span className="mx-1.5 text-border">·</span>
              Live{' '}
              <strong
                className={cn(
                  'transition-colors duration-300',
                  runwayChange ? runwayChange.toneClass : 'text-accent'
                )}
              >
                {fmtPrice(model.markPrice)}
              </strong>
              {model.positionMeta?.tpPrice > 0 && (
                <>
                  <span className="mx-1.5 text-border">·</span>
                  TP <strong className="text-green">{fmtPrice(model.positionMeta?.tpPrice)}</strong>
                </>
              )}
            </span>
            <span
              className={cn(
                'font-bold transition-colors duration-300',
                (model.positionMeta?.currentR || 0) >= 0 ? 'text-green' : 'text-red'
              )}
            >
              {(model.positionMeta?.currentR || 0) >= 0 ? '+' : ''}{(model.positionMeta?.currentR || 0).toFixed(2)}R
              {model.positionMeta?.trailingActive ? ' · Trailing' : model.positionMeta?.isProtected ? ' · Protected' : ''}
            </span>
          </div>
          <div className="relative h-2 w-full rounded-full bg-surface/80 border border-border/40 overflow-hidden">
            {/* SL -> Entry base fill & live position indicator via GPU transform */}
            <div
              className="absolute inset-y-0 left-0 w-full bg-green/25 origin-left transition-transform duration-300 ease-out will-change-transform"
              style={{ transform: `scaleX(${Math.max(0, Math.min(1, runway.livePct / 100))})` }}
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red/80"
              style={{ left: `${runway.slPct}%` }}
              title="Stop Loss"
            />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-dim/80"
              style={{ left: `${runway.entryPct}%` }}
              title="Entry Price"
            />
            {runway.tpPct !== null && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-green"
                style={{ left: `${runway.tpPct}%` }}
                title="Take Profit"
              />
            )}
            <div
              className={cn(
                'absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-bg shadow-xs transition-transform duration-300 ease-out will-change-transform',
                (model.positionMeta?.currentR || 0) >= 0 ? 'bg-green' : 'bg-amber'
              )}
              style={{ left: `calc(${runway.livePct}% - 5px)` }}
              title={`Live Price (${fmtPrice(model.markPrice)})`}
            />
          </div>
        </div>
      )}

      {/* Condition Cards + Composite Summary Grid */}
      {model.conditions.length === 0 ? (
        <div className="text-[11px] font-mono text-dim py-2 text-center">
          No {isInPos ? 'exit' : 'entry'} signal conditions configured — relying on {isInPos ? 'SL / TP levels' : 'scanner gate'}.
        </div>
      ) : (
        <div
          className={cn(
            'grid auto-rows-fr items-stretch gap-2.5',
            compact
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'
          )}
        >
          {model.conditions.map((c) => {
            const cZone = c.dialZone || 'watching';
            const isLadder = c.visualization === 'ladder' && c.ladder;
            const changeInfo = changedValueMap[c.key] || null;
            const liveToneClass = cZone === 'watching'
              ? (c.isScannerGate && c.liveValue !== null ? (c.liveValue >= 0 ? 'text-green' : 'text-red') : 'text-text')
              : (ZONE_TEXT_CLASS[cZone] || 'text-text');
            const hasDeltaReadout = Boolean(c.deltaValueText || c.deltaPctText);

            return (
              <div
                key={c.key}
                className={cn(
                  'relative overflow-hidden rounded-xl border border-border/55 bg-gradient-to-b from-surface/40 via-bg/45 to-bg/65 p-3 flex flex-col justify-between h-full gap-2.5 shadow-xs transition-colors duration-200 hover:border-border/80',
                  changeInfo?.stateChanged && 'animate-event-arrive',
                  isLadder && (compact ? 'sm:col-span-2' : 'sm:col-span-2')
                )}
              >
                {/* Subtle Top Status Spine */}
                <div
                  className="absolute top-0 left-0 right-0 h-[2px] opacity-85"
                  style={{ backgroundColor: ZONE_COLOR_MAP[cZone] || ZONE_COLOR_MAP.watching }}
                />

                {/* Card Top Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          'text-[8.5px] font-black font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border',
                          c.isScannerGate
                            ? 'bg-amber/10 text-amber border-amber/30'
                            : 'bg-surface/70 text-dim border-border/50'
                        )}
                      >
                        {c.connector}
                      </span>
                      <span className="text-xs font-bold text-text tracking-tight">
                        {c.label}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-dim mt-1 leading-snug break-words">
                      <span className="text-text/80 font-semibold">{c.timeframe}</span>
                      {c.paramsText && c.paramsText !== 'Standard' ? ` · ${c.paramsText}` : ''}
                    </div>
                    <div className="text-[9px] font-mono mt-0.5 tabular-nums">
                      <ConditionFreshness evaluatedAtMs={c.evaluatedAtMs} changeInfo={changeInfo} />
                    </div>
                  </div>

                  {/* Pill Zone Status Indicator */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-[9.5px] font-mono font-bold shrink-0 px-2 py-0.5 rounded-full bg-surface/70 border border-border/50',
                      ZONE_TEXT_CLASS[cZone] || 'text-dim'
                    )}
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full', ZONE_DOT_CLASS[cZone] || 'bg-dim')} />
                    {c.dialStatus || c.stateLabel}
                  </span>
                </div>

                {/* Visualization Body: Spatial Level Ladder for HTF Breakouts, Semicircular Dial for Threshold Signals */}
                {isLadder ? (
                  <HtfBreakoutLadder ladder={c.ladder} compact={compact} changeInfo={changeInfo} />
                ) : (
                  <>
                    <div className="flex justify-center items-center my-0.5">
                      <ConditionDial
                        dialPct={c.dialPct}
                        dialZone={cZone}
                        dialOverText={c.dialOverText}
                        size={compact ? 'sm' : 'md'}
                        changeInfo={changeInfo}
                      />
                    </div>

                    {/* Card Bottom: App-Like Bento Telemetry Strip for Live vs Target + Signed Distance */}
                    <div className="flex flex-col gap-1.5 rounded-lg bg-surface/45 border border-border/35 px-2.5 py-1.5 font-mono text-[10.5px] tabular-nums">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-dim text-[9.5px] uppercase tracking-wider font-semibold">Live / Target</span>
                        <div className="truncate flex items-center gap-1">
                          <strong
                            className={cn(
                              'font-bold transition-colors duration-300',
                              changeInfo?.changed ? changeInfo.toneClass : liveToneClass
                            )}
                          >
                            {c.liveText}
                          </strong>
                          <span className="text-dim/60">/</span>
                          <span className="text-accent font-semibold">{c.targetText}</span>
                        </div>
                      </div>

                      {hasDeltaReadout && (
                        <div className="flex items-center justify-between gap-2 text-[9.5px] border-t border-border/25 pt-1">
                          <span className="text-dim uppercase tracking-wider font-semibold text-[8.5px]">
                            {(Number(c.dialPct) || 0) >= 100 ? 'Past target' : 'To go'}
                          </span>
                          <span
                            className={cn(
                              'font-bold truncate transition-colors duration-300',
                              changeInfo?.changed ? changeInfo.toneClass : (ZONE_TEXT_CLASS[cZone] || 'text-dim')
                            )}
                          >
                            {c.deltaValueText}
                            {c.deltaPctText && c.deltaPctText !== c.deltaValueText ? ` (${c.deltaPctText})` : ''}
                          </span>
                        </div>
                      )}

                      {c.macdFilter && (
                        <MacdFilterStrip macdFilter={c.macdFilter} changeInfo={changeInfo} />
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Composite Gate Card */}
          {model.conditions.length > 1 && (
            <div className="relative overflow-hidden rounded-xl border border-border/65 bg-gradient-to-b from-surface/70 via-surface/45 to-bg/70 p-3 flex flex-col justify-between gap-2.5 shadow-xs">
              <div
                className="absolute top-0 left-0 right-0 h-[2px] opacity-85"
                style={{ backgroundColor: ZONE_COLOR_MAP[compositeDial.dialZone] || ZONE_COLOR_MAP.watching }}
              />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-text tracking-tight">
                    Composite · {model.logicLabel}
                  </div>
                  <div className="text-[10px] font-mono text-dim mt-0.5 leading-snug">
                    <span className={cn('font-bold', model.firedConditionsCount > 0 ? 'text-green' : 'text-text')}>
                      {model.firedConditionsCount}/{model.totalConditionsCount}
                    </span>{' '}
                    signals hit
                    {model.logicLabel === 'ALL' ? ' (weakest)' : model.logicLabel === 'ANY' ? ' (strongest)' : ''}
                  </div>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-[9.5px] font-mono font-bold shrink-0 px-2 py-0.5 rounded-full bg-bg/60 border border-border/50',
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

              <div className="flex items-baseline justify-between gap-2 rounded-lg bg-bg/50 border border-border/35 px-2.5 py-1.5 font-mono text-[10px] text-dim tabular-nums">
                <span className="uppercase tracking-wider text-[8.5px] font-semibold">Action</span>
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
