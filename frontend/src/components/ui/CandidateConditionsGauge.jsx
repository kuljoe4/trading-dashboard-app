import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from './primitives';
import { SmoothHeightContainer } from './SmoothMotion';
import { ConditionCardsSkeleton } from './Skeletons';
import { price as fmtPrice } from '../../lib/formatters';
import {
  buildCandidateConditionsModel,
  computeConditionValueDelta,
  computeHtfLadderDomain,
} from '../../utils/candidateConditions';

const ZONE_COLOR_MAP = {
  watching: '#64748b',
  near: '#3b82f6',
  fresh: '#22c55e',
  stale: '#22c55e',
  late: '#22c55e',
  warming: '#f59e0b',
  blocked: '#a855f7',
};

const ZONE_TEXT_CLASS = {
  watching: 'text-dim',
  near: 'text-accent',
  fresh: 'text-green',
  stale: 'text-green',
  late: 'text-green',
  warming: 'text-amber',
  blocked: 'text-purple-400',
};

const ZONE_DOT_CLASS = {
  watching: 'bg-dim/70',
  near: 'bg-accent',
  fresh: 'bg-green',
  stale: 'bg-green',
  late: 'bg-green',
  warming: 'bg-amber',
  blocked: 'bg-purple-400',
};

function formatCleanCardStatus(cZone, stateLabel) {
  if (stateLabel && stateLabel !== 'Watching') return stateLabel;
  if (cZone === 'near') return 'Near';
  if (cZone === 'fresh' || cZone === 'stale' || cZone === 'late') return 'Triggered';
  if (cZone === 'blocked') return 'Blocked';
  if (cZone === 'warming') return 'Warming';
  return stateLabel || 'Watching';
}

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
 * Clean linear angle mapping for 0..150 semicircular dial:
 * - 0..100 (Approach to target): -180° .. -60° (2/3 of arc)
 * - 100..150 (Past target):      -60°  ..   0° (1/3 of arc)
 */
function pctToAngle(p) {
  const clamped = Math.max(0, Math.min(150, Number(p) || 0));
  return -180 + (clamped / 150) * 180;
}

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function describeAngleArc(cx, cy, r, a1, a2) {
  if (Math.abs(a2 - a1) < 0.25) return '';
  const [x1, y1] = polar(cx, cy, r, a1);
  const [x2, y2] = polar(cx, cy, r, a2);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function describeArc(cx, cy, r, pStart, pEnd) {
  return describeAngleArc(cx, cy, r, pctToAngle(pStart), pctToAngle(pEnd));
}

/**
 * Lightweight 1D vertical label de-collision solver (O(N), N <= 5).
 * Preserves order, nudges labels apart, and avoids floating pill zones so text never overlaps.
 * Always attaches finite numeric `y` and `labelY` even when `items.length === 1`.
 */
function decollideVerticalLabels(items, minGap, minY, maxY, avoidY = null, avoidHalfH = 0) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const hasAvoid = Number.isFinite(Number(avoidY)) && avoidHalfH > 0;
  const avoidCenter = hasAvoid ? Number(avoidY) : 0;

  const filtered = hasAvoid
    ? items.filter((item) => {
        const rawY = Number(item?.y);
        return !Number.isFinite(rawY) || Math.abs(rawY - avoidCenter) >= avoidHalfH;
      })
    : items;

  if (filtered.length === 0) return [];

  const sorted = filtered
    .map((item, idx) => {
      const rawY = Number(item?.y);
      const safeY = Number.isFinite(rawY) ? rawY : minY;
      return {
        ...item,
        y: safeY,
        _idx: idx,
        labelY: Math.max(minY, Math.min(maxY, safeY)),
      };
    })
    .sort((a, b) => a.y - b.y);

  if (sorted.length > 1) {
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
  }

  if (!hasAvoid) return sorted;

  // Drop any label whose final de-collided position still intrudes on the floating pill
  return sorted.filter((item) => Math.abs(item.labelY - avoidCenter) >= avoidHalfH - 1);
}

/**
 * Proportionate semicircular condition dial with collision-proof disjoint zones:
 * - Top margin keeps target/cross label strictly inside the SVG (never bleeds into card header)
 * - Endpoint labels sit outside the arc ends so nothing overlaps the arc or readout
 * - Center readout + subtext sit cleanly below the hub with full SVG width available
 */
export const ConditionDial = React.memo(function ConditionDial({
  dialPct = 0,
  dialZone = 'watching',
  dialOverText = '',
  subText = '',
  dialScale = null,
  size = 'md',
  changeInfo = null,
}) {
  const clamped = Math.max(0, Math.min(150, Math.round(Number(dialPct) || 0)));
  const color = ZONE_COLOR_MAP[dialZone] || ZONE_COLOR_MAP.watching;

  const isSm = size === 'sm';
  const w = isSm ? 180 : 218;
  const h = isSm ? 98 : 114;
  const cx = w / 2;
  const cy = isSm ? 62 : 74;
  const r = isSm ? 41 : 53;
  const strokeW = isSm ? 7.5 : 8.5;
  const arcLen = Math.PI * r;
  const needleLen = r - strokeW * 0.85;

  const leftOuterX = cx - r - strokeW / 2 - 4;
  const rightOuterX = cx + r + strokeW / 2 + 4;

  const isBipolar = dialScale?.mode === 'bipolar_pct' && Number(dialScale.boundPct) > 0;
  const isLinearRatio = dialScale?.mode === 'linear_ratio' && Number(dialScale.maxPct) >= 150;

  let targetAngle = pctToAngle(100);
  let targetLabel = 'target';
  let minLabel = '0%';
  let maxLabel = '+50%';
  let needleDeg = (clamped / 150) * 180;
  let preTrackPath = describeArc(cx, cy, r, 0, 99.5);
  let postTrackPath = describeArc(cx, cy, r, 100.5, 150);
  let activeArcPath = '';
  let useDashSweep = true;
  let dashOffset = arcLen * (1 - clamped / 150);
  let hasActiveArc = clamped > 0;
  let minorTickAngles = [];
  let overflowSide = null;
  let subTextBase = subText || (clamped <= 100 ? `${clamped}% of target` : `target + ${Math.max(0, Math.round(clamped - 100))}%`);

  if (isBipolar) {
    const bound = Number(dialScale.boundPct);
    const valPct = Number.isFinite(Number(dialScale.valuePct)) ? Number(dialScale.valuePct) : 0;
    const clampedPct = Number.isFinite(Number(dialScale.clampedValuePct))
      ? Number(dialScale.clampedValuePct)
      : Math.max(-bound, Math.min(bound, valPct));
    const frac = (clampedPct + bound) / (2 * bound); // 0 at -bound, 0.5 at 0, 1 at +bound
    const needleAngle = -180 + frac * 180;

    targetAngle = -90;
    targetLabel = dialScale.centerLabel || 'cross';
    minLabel = dialScale.minLabel || `-${bound}%`;
    maxLabel = dialScale.maxLabel || `+${bound}%`;
    needleDeg = frac * 180;
    preTrackPath = describeAngleArc(cx, cy, r, -180, -90.8);
    postTrackPath = describeAngleArc(cx, cy, r, -89.2, 0);
    // Center-anchored active wedge showing exact distance from Cross/Target (0%)
    const aStart = Math.min(-90, needleAngle);
    const aEnd = Math.max(-90, needleAngle);
    activeArcPath = describeAngleArc(cx, cy, r, aStart, aEnd);
    useDashSweep = false;
    hasActiveArc = Math.abs(needleAngle - (-90)) >= 0.6;
    minorTickAngles = [-135, -45];
    if (dialScale.isOffScale) {
      overflowSide = valPct < 0 ? 'left' : 'right';
    }
    subTextBase = subText || dialScale.subText || `scale ±${bound}%`;
  } else if (isLinearRatio) {
    const maxPct = Number(dialScale.maxPct);
    const rawVal = Number.isFinite(Number(dialScale.valuePct)) ? Math.max(0, Number(dialScale.valuePct)) : clamped;
    const clampedVal = Math.min(maxPct, rawVal);
    const ratioToAngle = (v) => -180 + (Math.max(0, Math.min(maxPct, v)) / maxPct) * 180;

    targetAngle = ratioToAngle(100);
    targetLabel = dialScale.targetLabel || 'target';
    minLabel = dialScale.minLabel || '0%';
    maxLabel = dialScale.maxLabel || (dialScale.invertTrack ? `${maxPct}%` : `+${maxPct - 100}%`);
    needleDeg = (clampedVal / maxPct) * 180;
    preTrackPath = describeAngleArc(cx, cy, r, -180, Math.max(-179.5, targetAngle - 0.8));
    postTrackPath = describeAngleArc(cx, cy, r, Math.min(-0.5, targetAngle + 0.8), 0);
    activeArcPath = describeAngleArc(cx, cy, r, -180, 0);
    useDashSweep = true;
    dashOffset = arcLen * (1 - clampedVal / maxPct);
    hasActiveArc = clampedVal > 0;

    const candidateTicks = maxPct <= 200 ? [50, 150] : maxPct <= 300 ? [50, 200] : maxPct <= 500 ? [200, 300, 400] : [250, 500, 750];
    minorTickAngles = candidateTicks
      .filter((v) => v > 0 && v < maxPct)
      .map((v) => ratioToAngle(v))
      .filter((ang) => Math.abs(ang - targetAngle) >= 14);
    if (dialScale.isOffScale) {
      overflowSide = 'right';
    }
    subTextBase = subText || dialScale.subText || subTextBase;
  } else {
    activeArcPath = describeAngleArc(cx, cy, r, -180, 0);
    minorTickAngles = [pctToAngle(50)];
  }

  const preTrackColor = dialScale?.invertTrack ? '#22c55e' : '#64748b';
  const postTrackColor = dialScale?.invertTrack ? '#ef4444' : '#22c55e';

  const [tx1, ty1] = polar(cx, cy, r - strokeW * 0.9, targetAngle);
  const [tx2, ty2] = polar(cx, cy, r + strokeW * 0.9, targetAngle);
  const [rawTlx, rawTly] = polar(cx, cy, r + strokeW * 0.9 + (isSm ? 6.5 : 8), targetAngle);
  const targetTextAnchor = targetAngle < -108 ? 'end' : targetAngle > -72 ? 'start' : 'middle';
  const targetLabelX = Math.max(26, Math.min(w - 26, rawTlx));
  const targetLabelY = targetAngle === -90
    ? Math.max(9.5, ty2 - 3.5)
    : Math.max(9.5, Math.min(cy - 12, rawTly + 2));

  const displayOverText = dialOverText || `${clamped}%`;
  const overFontSize = isSm
    ? (displayOverText.length > 18 ? '9.5' : displayOverText.length > 13 ? '10.5' : '11.5')
    : (displayOverText.length > 18 ? '11' : displayOverText.length > 13 ? '12.5' : '13.5');

  void changeInfo;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="max-w-full h-auto block select-none shrink-0"
      aria-label={`Condition gauge at ${clamped}% (${dialOverText})`}
    >
      {/* Clean 2-Segment Track: Pre-Target and Post-Target */}
      {preTrackPath && (
        <path d={preTrackPath} stroke={preTrackColor} strokeOpacity="0.24" strokeWidth={strokeW} strokeLinecap="round" fill="none" />
      )}
      {postTrackPath && (
        <path d={postTrackPath} stroke={postTrackColor} strokeOpacity="0.26" strokeWidth={strokeW} strokeLinecap="round" fill="none" />
      )}

      {/* Subtle Proportionate Reference Minor Ticks */}
      {minorTickAngles.map((ang, i) => {
        const [mx1, my1] = polar(cx, cy, r - strokeW * 0.55, ang);
        const [mx2, my2] = polar(cx, cy, r + strokeW * 0.55, ang);
        return (
          <line
            key={i}
            x1={mx1}
            y1={my1}
            x2={mx2}
            y2={my2}
            stroke="currentColor"
            className="text-dim/45"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        );
      })}

      {/* Active Fill Arc Halo + Core */}
      {activeArcPath && (
        <>
          <path
            d={activeArcPath}
            stroke={color}
            strokeOpacity={hasActiveArc ? 0.22 : 0}
            strokeWidth={strokeW + 4}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={useDashSweep ? arcLen : undefined}
            strokeDashoffset={useDashSweep ? dashOffset : undefined}
            className={useDashSweep ? 'svg-smooth-stroke' : 'svg-smooth-color'}
          />
          <path
            d={activeArcPath}
            stroke={color}
            strokeOpacity={hasActiveArc ? 1 : 0}
            strokeWidth={strokeW}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={useDashSweep ? arcLen : undefined}
            strokeDashoffset={useDashSweep ? dashOffset : undefined}
            className={useDashSweep ? 'svg-smooth-stroke' : 'svg-smooth-color'}
          />
        </>
      )}

      {/* Target / Cross Major Tick */}
      <line
        x1={tx1}
        y1={ty1}
        x2={tx2}
        y2={ty2}
        stroke="currentColor"
        className="text-text"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <text
        x={targetLabelX}
        y={targetLabelY}
        textAnchor={targetTextAnchor}
        fontSize={isSm ? '7.8' : '8.2'}
        className="fill-dim font-mono font-bold uppercase tracking-tight"
      >
        {targetLabel}
      </text>

      {/* Real-Unit Scale Endpoints placed cleanly outside arc ends */}
      <text x={leftOuterX} y={cy + 3} textAnchor="end" fontSize={isSm ? '7.8' : '8.2'} className="fill-dim/80 font-mono tabular-nums">
        {overflowSide === 'left' ? `‹${minLabel}` : minLabel}
      </text>
      <text x={rightOuterX} y={cy + 3} textAnchor="start" fontSize={isSm ? '7.8' : '8.2'} className="fill-dim/80 font-mono tabular-nums">
        {overflowSide === 'right' ? `${maxLabel}›` : maxLabel}
      </text>

      {/* Smoothly Rotated Needle + Dual-Ring Center Hub */}
      <g
        className="svg-smooth-transform"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          transform: `rotate(${needleDeg.toFixed(2)}deg)`,
        }}
      >
        <line
          x1={cx}
          y1={cy}
          x2={cx - needleLen}
          y2={cy}
          stroke="currentColor"
          className="text-text/90"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <circle cx={cx - needleLen} cy={cy} r={isSm ? 2 : 2.5} fill={color} className="svg-smooth-color" />
      </g>
      <circle cx={cx} cy={cy} r={isSm ? 4.25 : 5} fill={color} fillOpacity="0.22" className="svg-smooth-color" />
      <circle cx={cx} cy={cy} r={isSm ? 2.5 : 3} className="fill-text" />

      {/* Readout Band cleanly below the hub (full SVG width, zero hub/needle/arc collision) */}
      <text
        x={cx}
        y={cy + (isSm ? 19 : 21)}
        textAnchor="middle"
        fontSize={overFontSize}
        fontWeight="800"
        fill={color}
        className="font-mono tabular-nums svg-smooth-color"
      >
        {displayOverText}
      </text>
      <text
        x={cx}
        y={cy + (isSm ? 31 : 34)}
        textAnchor="middle"
        fontSize={isSm ? '7.8' : '8.6'}
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
  },
  near: {
    color: '#3b82f6',
    textClass: 'text-accent',
  },
  fresh: {
    color: '#22c55e',
    textClass: 'text-green',
  },
  stale: {
    color: '#22c55e',
    textClass: 'text-green',
  },
  late: {
    color: '#22c55e',
    textClass: 'text-green',
  },
  rejected: {
    color: '#a855f7',
    textClass: 'text-purple-400',
  },
};

/**
 * Modern App-Like Spatial Level Ladder for HTF Breakouts (`htf_breakout` / `prev_day_breakout`):
 * - Zoomed-in true-proportion vertical domain anchored right to the top edge of the graphic
 * - Slim color-filled lookback & trigger candles with matching color wicks
 * - Single-line proportional SL <-> Entry <-> Target/Exit ratio footer
 */
export const HtfBreakoutLadder = React.memo(function HtfBreakoutLadder({ ladder, compact = false, changeInfo = null }) {
  const zoneClipId = useId();
  const svgWrapRef = useRef(null);
  const [boxSize, setBoxSize] = useState(() => ({
    w: 400,
    h: compact ? 116 : 134,
  }));

  useEffect(() => {
    const el = svgWrapRef.current;
    if (!el) return undefined;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const nextW = Math.round(rect.width);
      const nextH = Math.round(rect.height);
      if (nextW > 40 && nextH > 40) {
        setBoxSize((prev) => (Math.abs(prev.w - nextW) <= 1 && Math.abs(prev.h - nextH) <= 1 ? prev : { w: nextW, h: nextH }));
      }
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => updateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, Boolean(ladder)]);

  if (!ladder) return null;

  const refTf = ladder.refTf || '1d';
  const trigTf = ladder.trigTf || '1h';
  const mode = ladder.mode || 'closed_candle_confirm';
  const bufferPct = Number.isFinite(Number(ladder.bufferPct)) ? Number(ladder.bufferPct) : 0;
  const maxExpansionPct = Number.isFinite(Number(ladder.maxExpansionPct)) ? Number(ladder.maxExpansionPct) : 0;
  const effectiveMaxExpPct = Number.isFinite(Number(ladder.effectiveMaxExpPct)) ? Number(ladder.effectiveMaxExpPct) : 2.0;
  const hasHardCap = Boolean(ladder.hasHardCap) || maxExpansionPct > 0;
  const slType = ladder.slType || 'lookback_low/high';
  const slLookbackPeriod = Number.isFinite(Number(ladder.slLookbackPeriod)) ? Number(ladder.slLookbackPeriod) : 5;
  const slMaxPct = Number.isFinite(Number(ladder.slMaxPct)) ? Number(ladder.slMaxPct) : 3.0;
  const slExceedsMax = Boolean(ladder.slExceedsMax);
  const slRejected = Boolean(ladder.slRejected);
  const slCapUsedPct = Number.isFinite(Number(ladder.slCapUsedPct)) ? Number(ladder.slCapUsedPct) : 0;
  const refHigh = Number.isFinite(Number(ladder.refHigh)) ? Number(ladder.refHigh) : 0;
  const refLow = Number.isFinite(Number(ladder.refLow)) ? Number(ladder.refLow) : 0;
  const breakoutLevel = Number.isFinite(Number(ladder.breakoutLevel)) ? Number(ladder.breakoutLevel) : (refHigh || refLow || 0);
  const isLong = ladder.isLong !== false;
  const activeRef = isLong ? refHigh : refLow;
  const computedRefRangePct = activeRef > 0 && refHigh > refLow ? ((refHigh - refLow) / activeRef) * 100 : 0;
  const refRangePct = Number.isFinite(Number(ladder.refRangePct)) && Number(ladder.refRangePct) > 0
    ? Number(ladder.refRangePct)
    : computedRefRangePct;
  const expansionCap = Number.isFinite(Number(ladder.expansionCap)) ? Number(ladder.expansionCap) : breakoutLevel;
  const capPriceDeltaPct = hasHardCap && breakoutLevel > 0
    ? Math.abs(((expansionCap - breakoutLevel) / breakoutLevel) * 100)
    : effectiveMaxExpPct;
  const displayExpPct = hasHardCap && bufferPct === 0 && Math.abs(capPriceDeltaPct - effectiveMaxExpPct) > 0.05
    ? capPriceDeltaPct
    : effectiveMaxExpPct;
  const fmtExpPct = Number(displayExpPct.toFixed(displayExpPct < 0.01 ? 4 : (displayExpPct < 0.1 ? 3 : 2)));
  const livePrice = Number.isFinite(Number(ladder.livePrice)) ? Number(ladder.livePrice) : breakoutLevel;
  const slPrice = Number.isFinite(Number(ladder.slPrice)) && Number(ladder.slPrice) > 0
    ? Number(ladder.slPrice)
    : (isLong ? refLow : refHigh);
  const slDistPct = Number.isFinite(Number(ladder.slDistPct)) ? Number(ladder.slDistPct) : 0;
  const pnlOrRewardPct = Number.isFinite(Number(ladder.pnlOrRewardPct)) ? Number(ladder.pnlOrRewardPct) : 0;
  const rrRatio = Number.isFinite(Number(ladder.rrRatio)) && Number(ladder.rrRatio) > 0 ? Number(ladder.rrRatio) : 2.0;
  const lookbackCandles = Array.isArray(ladder.lookbackCandles) ? ladder.lookbackCandles : [];
  const distFromLevelPct = Number.isFinite(Number(ladder.distFromLevelPct)) ? Number(ladder.distFromLevelPct) : 0;
  const capUsedPct = Number.isFinite(Number(ladder.capUsedPct)) ? Number(ladder.capUsedPct) : 0;
  const capRoomPct = Number.isFinite(Number(ladder.capRoomPct)) ? Number(ladder.capRoomPct) : 0;
  const candleConfirmState = ladder.candleConfirmState || 'below';
  const countdownText = ladder.countdownText || '';
  const zone = ladder.zone || 'below';
  const isOverCap = Boolean(ladder.isOverCap);
  void trigTf;
  void changeInfo;

  const zTone = LADDER_ZONE_TONE[zone] || LADDER_ZONE_TONE.below;

  // True-Proportion Linear Vertical Domain [pMin, pMax]
  const {
    slBehindBreakout,
    slScaleBreak,
    slVisualPrice,
    overCapActive,
    pMax,
    pMin,
    effectiveCapTarget,
  } = computeHtfLadderDomain({
    isLong,
    breakoutLevel,
    expansionCap,
    slPrice,
    livePrice,
    hasHardCap,
  });

  const svgW = Math.max(250, boxSize.w || 400);
  const svgH = Math.max(compact ? 104 : 116, boxSize.h || (compact ? 116 : 134));
  const padTop = 7;
  const padBot = 7;
  const plotH = svgH - padTop - padBot;
  const leftRailW = svgW < 330 ? 70 : 80;
  const rightRailW = svgW < 330 ? 88 : 104;
  const xLeft = leftRailW;
  const xRight = Math.max(xLeft + 88, svgW - rightRailW);
  const bandW = xRight - xLeft;
  const rightPillX = xRight + 4;
  const rightPillW = Math.max(68, svgW - rightPillX - 4);
  const leftPillW = Math.max(54, xLeft - 10);

  const yOf = (priceVal) => {
    const numVal = Number(priceVal);
    if (!Number.isFinite(numVal)) return padTop + plotH / 2;
    const denom = Math.max(1e-9, pMax - pMin);
    const ratio = (pMax - numVal) / denom;
    return Math.max(padTop, Math.min(svgH - padBot, padTop + ratio * plotH));
  };

  const yBreak = yOf(breakoutLevel);
  const yCap = yOf(hasHardCap ? expansionCap : effectiveCapTarget);
  const yPx = yOf(livePrice);
  const ySl = yOf(slVisualPrice);
  const pillY = Math.max(8, Math.min(svgH - 8, yPx));

  const rectBand = (y1, y2) => ({
    y: Math.min(y1, y2),
    height: Math.max(0, Math.abs(y2 - y1)),
  });

  const slRiskBox = slBehindBreakout ? rectBand(ySl, yBreak) : rectBand(ySl, yPx);
  const capBox = rectBand(yBreak, yCap);
  const rejectBox = isLong ? rectBand(padTop, yCap) : rectBand(yCap, svgH - padBot);

  const absDist = Number.isFinite(Math.abs(distFromLevelPct)) ? Math.abs(distFromLevelPct) : 0;
  const distText = `${distFromLevelPct >= 0 ? '+' : '-'}${absDist >= 10 ? absDist.toFixed(1) : absDist.toFixed(2)}%`;
  const capUsedRound = Math.max(0, Math.round(capUsedPct));
  const safeCapRoom = Number.isFinite(capRoomPct) ? capRoomPct : 0;
  const capRoomFormatted = safeCapRoom <= 0
    ? '0%'
    : `${safeCapRoom >= 10 ? safeCapRoom.toFixed(1) : safeCapRoom.toFixed(2)}%`;
  const slUsedRound = Math.max(0, Math.round(slCapUsedPct));

  let confirmLabel = isLong ? `Below ${refTf} high` : `Above ${refTf} low`;
  let confirmToneClass = 'text-dim';
  if (candleConfirmState === 'closed_beyond') {
    confirmLabel = 'Closed beyond ✓';
    confirmToneClass = 'text-green';
  } else if (candleConfirmState === 'wicked_only') {
    confirmLabel = mode === 'closed_candle_confirm' ? 'Wicked · wait close' : 'Wicked through';
    confirmToneClass = 'text-amber';
  }

  // De-collide Left Level Labels (avoiding the Left Signed Distance Pill at pillY)
  const rawLeftLabels = [
    {
      id: 'slLb',
      y: ySl,
      text: `SL -${slDistPct.toFixed(2)}%`,
      color: '#f87171',
      bold: false,
    },
    {
      id: 'lvl',
      y: yBreak,
      text: bufferPct > 0 ? `${refTf} +${bufferPct}%` : `${refTf} ${isLong ? 'high' : 'low'}`,
      color: '#60a5fa',
      bold: true,
    },
    ...(hasHardCap ? [{
      id: 'cap',
      y: yCap,
      text: `cap ${isLong ? '+' : '-'}${fmtExpPct}%`,
      color: '#c084fc',
      bold: true,
    }] : []),
  ];
  const leftLabels = decollideVerticalLabels(rawLeftLabels, 12.5, 9, svgH - 9, pillY, 13.5);

  // De-collide Right Static Price Labels (avoiding the Right Live Price Pill at pillY)
  const rawRightLabels = [
    {
      id: 'slPx',
      y: ySl,
      text: fmtPrice(slPrice),
      color: '#f87171',
      bold: false,
    },
    {
      id: 'lvlPx',
      y: yBreak,
      text: fmtPrice(breakoutLevel),
      color: '#e2e8f0',
      bold: true,
    },
    ...(hasHardCap ? [{
      id: 'capPx',
      y: yCap,
      text: fmtPrice(expansionCap),
      color: '#c084fc',
      bold: true,
    }] : []),
  ];
  const rightLabels = decollideVerticalLabels(rawRightLabels, 12.5, 9, svgH - 9, pillY, 13.5);

  // True-Proportion SL <-> Entry <-> Target/Exit bar ratios for the single-line footer (unclamped R:R geometry)
  const safeSlRiskPct = Math.max(0.05, Math.abs(slDistPct));
  const safeRewardPct = Math.max(0.05, Math.abs(pnlOrRewardPct));
  const totalRiskRewardSpan = safeSlRiskPct + safeRewardPct;
  const riskWingWidthPct = Math.max(5, Math.min(95, (safeSlRiskPct / totalRiskRewardSpan) * 100));
  const rewardWingWidthPct = 100 - riskWingWidthPct;

  // Slim lookback + trigger candles geometry inside right-side lane of the zoomed SVG rail
  const candleLaneRight = xRight - 10;
  const candleCount = lookbackCandles.length;
  const candleSpacing = 8;
  const slimCandleBodyW = 3.4;
  const candleLaneLeft = candleLaneRight - Math.max(1, candleCount - 1) * candleSpacing;

  // Safe inner text lane strictly left of the candle lane so zone labels never collide with candles
  const zoneTextRight = candleCount > 0 ? Math.max(xLeft + 8, candleLaneLeft - 9) : xRight - 6;
  const zoneTextW = Math.max(0, zoneTextRight - (xLeft + 6));

  // Helper to vertically place zone text clear of the horizontal live price cursor line (yPx)
  const resolveZoneTextY = (box, minHeight = 14) => {
    if (box.height < minHeight || zoneTextW < 42) return null;
    const midY = box.y + box.height / 2 + 2.8;
    if (Math.abs(midY - yPx) >= 8.5) return midY;
    if (box.height < 24) return null;
    // Shift away from live cursor inside the band
    const topSlot = box.y + 9.5;
    const botSlot = box.y + box.height - 3.5;
    return Math.abs(topSlot - yPx) >= Math.abs(botSlot - yPx) ? topSlot : botSlot;
  };

  const slZoneTextY = resolveZoneTextY(slRiskBox, 14);
  const capZoneTextY = resolveZoneTextY(capBox, 14);
  const rejectZoneTextY = overCapActive ? resolveZoneTextY(rejectBox, 12) : null;

  const slSourceTag = slType === 'pct'
    ? 'Fixed'
    : slType === 'supertrend'
      ? 'ST'
      : slType === 'engulfing_boundary'
        ? 'Eng'
        : `${slLookbackPeriod}b`;
  const slZoneLabel = zoneTextW >= 152
    ? `SL (${slSourceTag}) · -${slDistPct.toFixed(2)}%${slScaleBreak ? ' · break' : ''}`
    : zoneTextW >= 96
      ? `SL (${slSourceTag}) -${slDistPct.toFixed(1)}%`
      : `SL -${slDistPct.toFixed(1)}%`;

  const capZoneLabel = hasHardCap
    ? (zoneTextW >= 152
        ? `Cap ${fmtExpPct}% (${maxExpansionPct}% Ref)`
        : zoneTextW >= 112
          ? `Cap ${fmtExpPct}% (${maxExpansionPct}%R)`
          : `Cap ${fmtExpPct}%`)
    : (zoneTextW >= 124
        ? `Uncapped (${refTf} ${refRangePct.toFixed(1)}%)`
        : 'Uncapped');

  const livePriceText = fmtPrice(livePrice);

  return (
    <div className="flex-1 flex flex-col gap-1.5 w-full min-h-0">
      {/* Flex-1 Wrapper so the Breakout SVG expands to fill 100% of available vertical space between header and footer */}
      <div
        ref={svgWrapRef}
        className={cn(
          'relative flex-1 w-full flex',
          compact ? 'min-h-[108px]' : 'min-h-[124px]'
        )}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          className="w-full h-full block overflow-hidden select-none rounded-lg bg-gradient-to-b from-bg/80 via-bg/55 to-bg/80 border border-border/45"
          aria-label={`HTF Breakout level ladder: live ${livePriceText} vs ${refTf} level ${fmtPrice(breakoutLevel)}`}
        >
        <defs>
          <clipPath id={zoneClipId}>
            <rect x={xLeft + 5} y={0} width={zoneTextW} height={svgH} />
          </clipPath>
          <linearGradient id={`${zoneClipId}-open`} x1="0" y1={isLong ? '1' : '0'} x2="0" y2={isLong ? '0' : '1'}>
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Lookback SL Risk Zone (SL <-> Breakout Level) */}
        <rect
          x={xLeft}
          y={slRiskBox.y}
          width={bandW}
          height={Math.max(1.5, slRiskBox.height)}
          fill="#ef4444"
          fillOpacity="0.08"
        />
        <rect
          x={xLeft}
          y={slRiskBox.y}
          width="2.5"
          height={Math.max(1.5, slRiskBox.height)}
          fill="#ef4444"
          fillOpacity="0.55"
        />
        {slZoneTextY !== null && (
          <text
            x={xLeft + 8}
            y={slZoneTextY}
            fontSize="8"
            fill="#f87171"
            fillOpacity="0.85"
            clipPath={`url(#${zoneClipId})`}
            className="font-mono font-semibold"
          >
            {slZoneLabel}
          </text>
        )}
        {slScaleBreak && slRiskBox.height >= 10 && (() => {
          const midY = slRiskBox.y + slRiskBox.height / 2;
          return (
            <path
              d={`M ${xLeft - 1.5} ${(midY - 4).toFixed(1)} L ${xLeft + 3.5} ${(midY - 1.5).toFixed(1)} L ${xLeft - 1.5} ${(midY + 1.5).toFixed(1)} L ${xLeft + 3.5} ${(midY + 4).toFixed(1)}`}
              stroke="#f87171"
              strokeWidth="1.25"
              fill="none"
            />
          );
        })()}

        {/* Breakout Zone: Bounded Cap Box + 50% Midpoint when Cap On, or Open-Ended Gradient when Cap Off */}
        {hasHardCap ? (
          <>
            <rect x={xLeft} y={capBox.y} width={bandW} height={Math.max(1.5, capBox.height)} fill="#22c55e" fillOpacity="0.14" />
            <rect x={xLeft} y={capBox.y} width="3" height={Math.max(1.5, capBox.height)} fill="#22c55e" fillOpacity="0.8" />
            {capBox.height >= 18 && (
              <line
                x1={xLeft + 4}
                y1={(yBreak + yCap) / 2}
                x2={xRight}
                y2={(yBreak + yCap) / 2}
                stroke="#22c55e"
                strokeOpacity="0.28"
                strokeWidth="0.8"
                strokeDasharray="2 3"
              />
            )}
          </>
        ) : (
          <rect
            x={xLeft}
            y={capBox.y}
            width={bandW}
            height={Math.max(1.5, capBox.height)}
            fill={`url(#${zoneClipId}-open)`}
          />
        )}
        {capZoneTextY !== null && (
          <text
            x={xLeft + 8}
            y={capZoneTextY}
            fontSize="8"
            fill="#4ade80"
            fillOpacity={hasHardCap ? '0.9' : '0.72'}
            clipPath={`url(#${zoneClipId})`}
            className="font-mono font-semibold"
          >
            {capZoneLabel}
          </text>
        )}

        {/* Over-Cap Zone (>100% Cap, shown only when price extends beyond cap) */}
        {overCapActive && rejectBox.height >= 3 && (
          <>
            <rect x={xLeft} y={rejectBox.y} width={bandW} height={rejectBox.height} fill="#a855f7" fillOpacity="0.12" />
            <rect x={xLeft} y={rejectBox.y} width="2.5" height={rejectBox.height} fill="#a855f7" fillOpacity="0.75" />
            {rejectZoneTextY !== null && (
              <text
                x={xLeft + 8}
                y={rejectZoneTextY}
                fontSize="8"
                fill="#c084fc"
                clipPath={`url(#${zoneClipId})`}
                className="font-mono font-semibold"
              >
                {hasHardCap ? 'Over Cap' : 'Extended'}
              </text>
            )}
          </>
        )}

        {/* Lookback SL Line */}
        <line
          x1={xLeft}
          y1={ySl}
          x2={xRight}
          y2={ySl}
          stroke="#ef4444"
          strokeWidth="1.15"
          strokeDasharray="2.5 2.5"
        />

        {/* Breakout Level Line */}
        <line
          x1={xLeft}
          y1={yBreak}
          x2={xRight}
          y2={yBreak}
          stroke="#3b82f6"
          strokeWidth="1.75"
          strokeDasharray="4 2.5"
        />

        {/* Breakout Max Expansion Cap Line (shown only when max_expansion_pct > 0) */}
        {hasHardCap && (
          <line
            x1={xLeft}
            y1={yCap}
            x2={xRight}
            y2={yCap}
            stroke="#a855f7"
            strokeWidth="1.5"
            strokeDasharray="3 2.5"
          />
        )}

        {/* Slim Color-Filled Lookback Candles + Trigger Candle Lane */}
        {candleCount > 0 && (
          <g aria-label="Lookback and trigger candles">
            <rect
              x={candleLaneLeft - 5}
              y={2}
              width={(candleCount - 1) * candleSpacing + 10}
              height={svgH - 4}
              rx="3.5"
              fill="#0f172a"
              fillOpacity="0.30"
            />
            {lookbackCandles.map((c, idx) => {
              const cx = candleLaneLeft + idx * candleSpacing;
              const yCHigh = yOf(c.high);
              const yCLow = yOf(c.low);
              const yCOpen = yOf(c.open);
              const yCClose = yOf(c.close);
              const bodyTop = Math.min(yCOpen, yCClose);
              const bodyH = Math.max(2, Math.abs(yCClose - yCOpen));
              const cColor = c.isUp ? '#22c55e' : '#ef4444';
              const isTrig = Boolean(c.isTrigger);

              return (
                <g key={c.id || idx}>
                  <line
                    x1={cx}
                    y1={yCHigh}
                    x2={cx}
                    y2={yCLow}
                    stroke={cColor}
                    strokeWidth={isTrig ? '1.3' : '1.05'}
                    strokeLinecap="round"
                    strokeOpacity={isTrig ? '0.98' : '0.82'}
                  />
                  <rect
                    x={cx - slimCandleBodyW / 2}
                    y={bodyTop}
                    width={slimCandleBodyW}
                    height={bodyH}
                    rx="0.9"
                    fill={cColor}
                    fillOpacity={isTrig ? '0.96' : '0.78'}
                    stroke={cColor}
                    strokeWidth="0.5"
                  />
                </g>
              );
            })}
          </g>
        )}

        {/* De-collided Left Level Labels */}
        {leftLabels.map((lbl) => {
          const safeY = Number.isFinite(Number(lbl.y)) ? Number(lbl.y) : 0;
          const safeLabelY = Number.isFinite(Number(lbl.labelY)) ? Number(lbl.labelY) : safeY;
          return (
            <g key={lbl.id}>
              <path
                d={`M ${xLeft} ${safeY.toFixed(1)} L ${xLeft - 4} ${safeLabelY.toFixed(1)} L ${xLeft - 6} ${safeLabelY.toFixed(1)}`}
                stroke={lbl.color}
                strokeOpacity="0.55"
                strokeWidth="1"
                fill="none"
              />
              <text
                x={xLeft - 8}
                y={safeLabelY + 2.8}
                textAnchor="end"
                fontSize="8.2"
                fill={lbl.color}
                fontWeight={lbl.bold ? '700' : '500'}
                className="font-mono"
              >
                {lbl.text}
              </text>
            </g>
          );
        })}

        {/* De-collided Right Static Price Labels */}
        {rightLabels.map((lbl) => {
          const safeY = Number.isFinite(Number(lbl.y)) ? Number(lbl.y) : 0;
          const safeLabelY = Number.isFinite(Number(lbl.labelY)) ? Number(lbl.labelY) : safeY;
          return (
            <g key={lbl.id}>
              <path
                d={`M ${xRight} ${safeY.toFixed(1)} L ${xRight + 4} ${safeLabelY.toFixed(1)} L ${xRight + 6} ${safeLabelY.toFixed(1)}`}
                stroke={lbl.color}
                strokeOpacity="0.5"
                strokeWidth="1"
                fill="none"
              />
              <text
                x={xRight + 8}
                y={safeLabelY + 2.8}
                textAnchor="start"
                fontSize="8.2"
                fill={lbl.color}
                fontWeight={lbl.bold ? '700' : '500'}
                className="font-mono tabular-nums"
              >
                {lbl.text}
              </text>
            </g>
          );
        })}

        {/* Smooth GPU-Translated Live Price Cursor Line + Floating Pill Callouts */}
        <g
          className="svg-smooth-transform"
          style={{ transform: `translateY(${Number(yPx).toFixed(2)}px)` }}
        >
          <line
            x1={xLeft}
            y1={0}
            x2={xRight}
            y2={0}
            stroke={zTone.color}
            strokeOpacity="0.26"
            strokeWidth="4.5"
            className="svg-smooth-color"
          />
          <line
            x1={xLeft}
            y1={0}
            x2={xRight}
            y2={0}
            stroke={zTone.color}
            strokeWidth="1.8"
            className="svg-smooth-color"
          />
          <circle cx={xRight} cy={0} r="3" fill={zTone.color} className="svg-smooth-color" />
        </g>

        {/* Smooth GPU-Translated Right & Left Floating Pills */}
        <g
          className="svg-smooth-transform"
          style={{ transform: `translateY(${Number(pillY).toFixed(2)}px)` }}
        >
          {/* Right Floating Live Price Pill */}
          <rect
            x={rightPillX}
            y={-8}
            width={rightPillW}
            height="16"
            rx="4"
            fill={zTone.color}
            className="svg-smooth-color"
          />
          <text
            x={rightPillX + rightPillW / 2}
            y={3.1}
            textAnchor="middle"
            fontSize={livePriceText.length > 9 || rightPillW < 82 ? '7.8' : '8.8'}
            fontWeight="800"
            fill="#ffffff"
            className="font-mono tabular-nums"
          >
            {livePriceText}
          </text>

          {/* Left Signed Distance Pill (fits comfortably inside left rail without hitting left level labels) */}
          <rect
            x="4"
            y={-7.5}
            width={leftPillW}
            height="15"
            rx="4"
            fill={zTone.color}
            fillOpacity="0.18"
            stroke={zTone.color}
            strokeWidth="1"
            className="svg-smooth-color"
          />
          <text
            x={4 + leftPillW / 2}
            y={2.8}
            textAnchor="middle"
            fontSize={distText.length > 7 || leftPillW < 60 ? '7.4' : '8.2'}
            fontWeight="800"
            fill={zTone.color}
            className="font-mono tabular-nums svg-smooth-color"
          >
            {distText}
          </text>
        </g>
        </svg>
      </div>

      {/* Responsive Ultra-Compact Footer: Candle State · True-Proportion SL/Entry/Target Ratio Bar · Cap Used */}
      <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-1 rounded-lg bg-surface/45 border border-border/35 px-2 py-1 font-mono text-[9px] tabular-nums shrink-0">
        <span className={cn('font-semibold truncate min-w-0', confirmToneClass)}>
          {confirmLabel}
          {countdownText && !isOverCap ? ` · ${countdownText.replace(/.*close in /, '')}` : ''}
        </span>

        {/* Inline True-Proportion Two-Wing SL <-> Entry <-> Target Ratio Bar */}
        <div
          className="flex-1 min-w-[100px] max-w-[205px] flex items-center gap-1.5"
          title={
            slType === 'pct'
              ? `SL: -${slDistPct.toFixed(2)}% (Fixed) | Target +${Math.abs(pnlOrRewardPct).toFixed(2)}% (${rrRatio.toFixed(1)}R)`
              : `SL Check: -${slDistPct.toFixed(2)}% / ${slMaxPct.toFixed(2)}% max (${slUsedRound}% of max SL) | Target +${Math.abs(pnlOrRewardPct).toFixed(2)}% (${rrRatio.toFixed(1)}R)`
          }
        >
          <span className="text-[8px] font-bold text-red shrink-0">
            -{slDistPct.toFixed(1)}%
          </span>
          <div className="flex-1 h-2.5 rounded bg-bg/85 border border-border/45 overflow-hidden flex items-center min-w-[32px]">
            <div
              className="h-full bg-red/40 border-r border-text/85 transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ width: `${riskWingWidthPct.toFixed(2)}%` }}
            />
            <div
              className="h-full bg-green/40 transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ width: `${rewardWingWidthPct.toFixed(2)}%` }}
            />
          </div>
          <span className="text-[8px] font-bold text-green shrink-0">
            +{Math.abs(pnlOrRewardPct).toFixed(1)}% ({rrRatio.toFixed(1)}R)
          </span>
        </div>

        {hasHardCap ? (
          <span
            className="text-dim shrink-0"
            title={`Breakout Cap: ${fmtExpPct}% (${maxExpansionPct}% of ${refRangePct.toFixed(2)}% ${refTf} candle range) · Used: ${capUsedRound}% | SL: ${slDistPct.toFixed(2)}%`}
          >
            Cap{' '}
            <strong className={cn(zTone.textClass)}>
              {distFromLevelPct < 0 ? '0%' : `${capUsedRound}%`}
            </strong>
            <span className="text-dim/75"> ({capRoomFormatted} left)</span>
            {slExceedsMax && (
              <span className={cn('ml-1 font-semibold', slRejected ? 'text-purple-400' : 'text-amber')}>
                · SL {slUsedRound}%
              </span>
            )}
          </span>
        ) : (
          <span
            className="text-dim shrink-0"
            title={`Breakout Max Cap: Disabled (0%) · ${refTf} Ref Candle Range: ${refRangePct.toFixed(2)}% (${fmtPrice(refLow)}–${fmtPrice(refHigh)})`}
          >
            Cap <strong className="text-dim">Off</strong>
            <span className="text-dim/75"> ({refTf} {refRangePct.toFixed(1)}%)</span>
            {slExceedsMax && (
              <span className={cn('ml-1 font-semibold', slRejected ? 'text-purple-400' : 'text-amber')}>
                · SL {slUsedRound}%
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
});

/** Compact histogram phase/window visualization for MACD filters and impulse entries. */
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

  const isImpulse = macdFilter.mode === 'macd_impulse';
  const barCount = Number(macdFilter.barCount ?? macdFilter.gates?.find((g) => g.key === 'bar_window')?.value?.match?.(/#(\d+)/)?.[1]);
  const maxEntryCandle = Number(macdFilter.maxEntryCandle ?? macdFilter.gates?.find((g) => g.key === 'bar_window')?.value?.match?.(/\/\s*(\d+)/)?.[1]) || 2;
  const isLate = isImpulse && Number.isFinite(barCount) && barCount > maxEntryCandle;
  const statusLabel = macdFilter.aligned ? (isImpulse ? 'ENTRY OPEN' : 'ALIGNED') : isLate ? 'LATE' : macdFilter.rejected ? 'BLOCKED' : 'WAITING';
  const bars = (Array.isArray(macdFilter.recentHist) ? macdFilter.recentHist : []).slice(-6);
  const maxAbs = Math.max(0.00000001, ...bars.map((v) => Math.abs(Number(v) || 0)));
  void changeInfo;

  return (
    <div
      className="rounded-lg border border-border/35 bg-bg/45 px-2 py-1.5 flex flex-col gap-1.5 text-[9.5px] font-mono tabular-nums"
      data-testid="macd-filter-strip"
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-dim truncate">{isEmaFilter ? 'MACD filter' : isImpulse ? 'MACD impulse' : 'MACD histogram'}</span>
        <span className={cn('font-black tracking-wider transition-colors duration-300', statusColorClass)}>{statusLabel}</span>
      </div>
      <div className="flex items-end gap-1 h-7" aria-label={`${histColorLabel}; ${statusLabel}`}>
        {bars.length > 0 ? bars.map((value, idx) => {
          const n = Number(value) || 0;
          const height = Math.max(3, Math.round((Math.abs(n) / maxAbs) * 24));
          const eligible = isImpulse && idx >= bars.length - maxEntryCandle && (n >= 0) === isHistGreen;
          return (
            <span
              key={`${idx}-${n}`}
              className={cn('flex-1 min-w-[3px] max-w-3 rounded-t-sm transition-all', n >= 0 ? 'bg-green/75' : 'bg-red/75', eligible && 'ring-1 ring-accent ring-offset-1 ring-offset-bg')}
              style={{ height: `${height}px` }}
              title={`${n >= 0 ? 'Green' : 'Red'} histogram ${n}`}
            />
          );
        }) : <span className="text-dim self-center">Histogram warming up</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('font-semibold', histColorClass)}>{histColorLabel}</span>
        {isImpulse ? (
          <span className={cn('font-bold', isLate ? 'text-purple-400' : macdFilter.aligned ? 'text-green' : 'text-dim')}>
            Candle {Number.isFinite(barCount) ? barCount : '—'} / {maxEntryCandle}
          </span>
        ) : (
          <span className="text-dim">{macdFilter.histogramText || '---'}</span>
        )}
      </div>
    </div>
  );
});

export const EngulfingPatternStrip = React.memo(function EngulfingPatternStrip({ pattern }) {
  if (!pattern) return null;
  const bullish = pattern.direction === 'bullish';
  const stateLabel = pattern.state === 'confirmed' ? 'CONFIRMED' : pattern.state === 'late' ? 'LATE' : pattern.state === 'waiting_break' ? 'ARMED' : 'BUILDING';
  const stateClass = pattern.state === 'confirmed' ? 'text-green' : pattern.state === 'late' ? 'text-purple-400' : pattern.state === 'waiting_break' ? 'text-amber' : 'text-dim';
  const shownStreak = Math.min(5, Math.max(pattern.streakRequired, pattern.streakFound, 1));
  return (
    <div className="rounded-lg border border-border/35 bg-bg/45 px-2 py-1.5 flex flex-col gap-1.5 text-[9.5px] font-mono tabular-nums" data-testid="engulfing-pattern-strip">
      <div className="flex items-center justify-between gap-2">
        <span className="text-dim">{bullish ? 'Bullish' : 'Bearish'} · {String(pattern.mode).replace(/_/g, ' ')}</span>
        <span className={cn('font-black tracking-wider', stateClass)}>{stateLabel}</span>
      </div>
      <div className="flex items-center gap-1 h-8" aria-label={`${pattern.streakFound} of ${pattern.streakRequired} reversal candles found`}>
        {Array.from({ length: shownStreak }).map((_, idx) => (
          <span key={idx} className={cn('relative w-3 h-5 rounded-sm border', idx < pattern.streakFound ? (bullish ? 'border-red/70 bg-red/30' : 'border-green/70 bg-green/30') : 'border-border/50 bg-surface/40')}>
            <span className="absolute left-1/2 -translate-x-1/2 -top-1 -bottom-1 w-px bg-current opacity-50" />
          </span>
        ))}
        <span className="text-dim px-0.5">→</span>
        <span className={cn('relative w-4 h-7 rounded-sm border-2', pattern.fired ? (bullish ? 'border-green bg-green/30' : 'border-red bg-red/30') : 'border-accent/60 bg-accent/10')}>
          <span className="absolute left-1/2 -translate-x-1/2 -top-1 -bottom-1 w-px bg-current opacity-60" />
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-dim">
        <span>{pattern.streakFound}/{pattern.streakRequired} streak · {pattern.sequential ? 'Adjacent' : `Within ${pattern.lookback}`}</span>
        <span>{pattern.closeOnly ? 'Closed candle' : 'Live candle'}{pattern.volumeConfirm ? ' · Vol' : ''}</span>
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
  lastScanTs = 0,
  nowMs = undefined,
  headerAction = null,
  ruleFilter = 'all',
  entryOpp = null,
  linkedTrade = null,
  configuredExitRules = [],
  isSyncing = false,
}) {
  const mountTsRef = useRef(Date.now());
  const modelNowMs = nowMs ?? (Number(lastScanTs) > 0 ? Number(lastScanTs) : mountTsRef.current);

  const isEntryFilter = ruleFilter === 'entry';
  const isExitFilter = ruleFilter === 'exit';

  // Resolve effective trade & opportunity according to the active rule filter:
  // - 'entry': force Entry Conditions view (even for In-Pos trades, using captured entryOpp if available)
  // - 'exit': force Exit Conditions view (live Exit Monitor if open trade exists, Closed Exit Snapshot for closed trades, or Configured Exit Preview for searching candidates)
  // - 'all': default context-aware behavior
  const effectiveActiveTrade = useMemo(() => {
    if (isEntryFilter) return null;
    if (isExitFilter) return activeTrade || linkedTrade || null;
    return activeTrade;
  }, [isEntryFilter, isExitFilter, activeTrade, linkedTrade]);

  const effectiveOpp = useMemo(() => {
    if (isEntryFilter && !opp?.isEntrySnapshot && entryOpp) {
      return entryOpp;
    }
    return opp;
  }, [isEntryFilter, opp, entryOpp]);

  const model = useMemo(() => buildCandidateConditionsModel({
    opp: effectiveOpp,
    strategyConfig,
    activeTrade: effectiveActiveTrade,
    closedTrades,
    isPaused,
    gateState,
    gateReason,
    lastScanTs,
    nowMs: modelNowMs,
  }), [effectiveOpp, strategyConfig, effectiveActiveTrade, closedTrades, isPaused, gateState, gateReason, lastScanTs, modelNowMs]);

  const isInPos = model.mode === 'in_position';
  const hasCandidate = model.symbol && model.symbol !== '---';
  const compositeDial = model.compositeDial || { dialZone: 'watching', dialStatus: 'Watching', dialOverText: '100% to go' };

  const isClosedExitSnapshotView = Boolean(
    isExitFilter &&
    !isInPos &&
    effectiveOpp?.isEntrySnapshot &&
    effectiveOpp?.exitSnapshot &&
    effectiveOpp.exitSnapshot.tradeStatus !== 'OPEN'
  );
  const isExitPreviewMode = Boolean(isExitFilter && !isInPos && !isClosedExitSnapshotView);
  const showingExitView = isInPos || isClosedExitSnapshotView || isExitPreviewMode;

  // Track single-shot live value changes without polling loops
  const prevSnapshotRef = useRef({ symbol: null, mode: null, overallStatus: null, markPrice: 0, items: {} });
  const [changedValueMap, setChangedValueMap] = useState({});
  const [runwayChange, setRunwayChange] = useState(null);
  const [handoffCue, setHandoffCue] = useState(null);

  const valueSignature = useMemo(
    () => `${model.markPrice}:${model.compositeDialPct}:` + model.conditions.map(
      c => `${c.key}:${c.stateLabel}:${c.liveText}:${c.dialPct}:${c.rawDialPct ?? ''}:${c.ladder?.livePrice ?? ''}:${c.macdFilter?.histogram ?? ''}:${c.macdFilter?.aligned ? 1 : 0}:${c.engulfingPattern?.state ?? ''}:${c.engulfingPattern?.streakFound ?? ''}`
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
  const isOpenTradeSnapshot = Boolean(effectiveOpp?.isEntrySnapshot && effectiveOpp?.snapshotTradeStatus === 'OPEN');
  const showExitSnapshotBar = Boolean(
    effectiveOpp?.isEntrySnapshot &&
    effectiveOpp?.exitSnapshot &&
    !isEntryFilter &&
    !isInPos
  );

  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm overflow-hidden flex flex-col transition-colors duration-300 [contain:layout_style]',
        isInPos && 'border-green/35',
        isOpenTradeSnapshot && !isInPos && 'border-accent/40',
        compact ? 'p-2.5 gap-2' : 'p-3.5 gap-3',
        className
      )}
    >
      {/* Top Header Strip (reserved min-height & kept mounted across Entry <-> Exit / Snapshot transitions for zero CLS) */}
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-border/40 pb-2 min-h-[30px]">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span
            className={cn(
              'text-[10px] font-black uppercase tracking-wider transition-colors duration-200',
              isInPos ? 'text-green' : (effectiveOpp?.isEntrySnapshot || isClosedExitSnapshotView) ? 'text-accent' : 'text-dim'
            )}
          >
            {showingExitView ? 'Exit Conditions' : 'Entry Conditions'}
          </span>
          {hasCandidate && (
            <span className="text-xs font-black font-mono text-text">
              {model.symbol}
            </span>
          )}
          {model.dir !== '---' && (
            <span
              className={cn(
                'text-[10px] font-black font-mono uppercase transition-colors duration-200',
                model.dir === 'LONG' ? 'text-green' : 'text-red'
              )}
            >
              {model.dir}
            </span>
          )}
          <span className="text-[10px] font-mono text-dim">
            · {showingExitView ? 'Exit Gate' : 'Signal Gate'}: <strong className="text-text">{isExitPreviewMode ? 'ARMED' : isClosedExitSnapshotView ? 'CLOSED' : model.logicLabel}</strong>
          </span>
          {handoffCue && (
            <span className="text-[10px] font-mono font-bold text-green animate-handoff-slide">
              · {handoffCue}
            </span>
          )}
          {effectiveOpp?.isEntrySnapshot && !isInPos && (
            <span className="text-[10px] font-mono text-accent">
              · {isClosedExitSnapshotView
                ? `Closed exit snapshot (${effectiveOpp.snapshotTradeStatus})`
                : isOpenTradeSnapshot
                  ? 'In-Pos entry snapshot'
                  : (effectiveOpp.snapshotTradeStatus && effectiveOpp.snapshotTradeStatus !== 'OPEN'
                      ? `History snapshot (${effectiveOpp.snapshotTradeStatus})`
                      : 'Entry snapshot')}
              {typeof effectiveOpp.capRespected === 'boolean' && !isClosedExitSnapshotView && (
                <strong className={effectiveOpp.capRespected ? 'text-green' : 'text-red'}>
                  {' '}· Cap {effectiveOpp.capRespected ? 'respected' : 'exceeded'}
                </strong>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {headerAction}
          {/* Overall Status Indicator */}
          {isClosedExitSnapshotView ? (
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold tabular-nums">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', Number(effectiveOpp.exitSnapshot?.pnlPct || 0) >= 0 ? 'bg-green' : 'bg-red')} />
              <span className={Number(effectiveOpp.exitSnapshot?.pnlPct || 0) >= 0 ? 'text-green' : 'text-red'}>
                {String(effectiveOpp.exitSnapshot?.exitSignalType || effectiveOpp.exitSnapshot?.exitReason || 'CLOSED').replace(/_/g, ' ')}
              </span>
            </div>
          ) : isExitPreviewMode ? (
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold tabular-nums">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-accent" />
              <span className="text-dim">
                {configuredExitRules.length} {configuredExitRules.length === 1 ? 'rule' : 'rules'} armed
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold tabular-nums">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200', ZONE_DOT_CLASS[compositeDial.dialZone] || 'bg-dim')} />
              <span className={cn('transition-colors duration-200', ZONE_TEXT_CLASS[compositeDial.dialZone] || 'text-dim')}>
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
          )}
        </div>
      </div>

      {/* In-Place Height-Interpolated Body (zero unmount/blanking & reserved min-height prevents CLS across mode switches) */}
      <SmoothHeightContainer duration={0.24}>
        <div className={cn('flex flex-col', compact ? 'gap-2 min-h-[120px]' : 'gap-3 min-h-[168px]')}>
          {/* Compact In-Position SL -> Entry -> Live -> TP Runway + Ratio & Distance Graphic */}
          {isInPos && runway && (
            <div className="px-2.5 py-2 rounded-lg bg-bg/45 border border-border/40 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums flex-wrap">
                <span className="text-dim">
                  SL <strong className={model.positionMeta?.isProtected ? 'text-green' : 'text-red'}>{fmtPrice(model.positionMeta?.slPrice)}</strong>
                  {Number(model.positionMeta?.slDistPct) > 0 && (
                    <span className="text-[9px] text-red/85 ml-1">(-{Number(model.positionMeta.slDistPct).toFixed(2)}%)</span>
                  )}
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
                  {Number.isFinite(Number(model.positionMeta?.livePnlPct)) && (
                    <span className={cn('text-[9px] font-bold ml-1 transition-colors duration-200', Number(model.positionMeta.livePnlPct) >= 0 ? 'text-green' : 'text-red')}>
                      ({Number(model.positionMeta.livePnlPct) >= 0 ? '+' : ''}{Number(model.positionMeta.livePnlPct).toFixed(2)}%)
                    </span>
                  )}
                  {model.positionMeta?.tpPrice > 0 && (
                    <>
                      <span className="mx-1.5 text-border">·</span>
                      TP <strong className="text-green">{fmtPrice(model.positionMeta?.tpPrice)}</strong>
                      {Number(model.positionMeta?.tpDistPct) > 0 && (
                        <span className="text-[9px] text-green/85 ml-1">(+{Number(model.positionMeta.tpDistPct).toFixed(2)}%)</span>
                      )}
                    </>
                  )}
                </span>
                <span
                  className={cn(
                    'font-bold transition-colors duration-300',
                    (Number(model.positionMeta?.currentR) || 0) >= 0 ? 'text-green' : 'text-red'
                  )}
                >
                  {(Number(model.positionMeta?.currentR) || 0) >= 0 ? '+' : ''}{(Number(model.positionMeta?.currentR) || 0).toFixed(2)}R
                  {Number(model.positionMeta?.targetR) > 0 ? ` / ${Number(model.positionMeta.targetR).toFixed(1)}R` : ''}
                  {model.positionMeta?.trailingActive ? ' · Trailing' : model.positionMeta?.isProtected ? ' · Protected' : ''}
                </span>
              </div>
              {(() => {
                const currR = Number(runway.currentR ?? model.positionMeta?.currentR ?? 0);
                const isProfit = currR >= 0;
                const fillLeftPct = isProfit ? runway.entryPct : Math.min(runway.entryPct, runway.livePct);
                const fillWidthPct = Math.abs(runway.livePct - runway.entryPct);
                const rTicks = Array.isArray(runway.rTicks) ? runway.rTicks : [];
                return (
                  <div className="flex flex-col gap-1">
                    <div className="relative h-2 w-full rounded-full bg-surface/80 border border-border/40 overflow-hidden">
                      {/* Loss / Profit Zone Tinting anchored at 0R Entry */}
                      <div
                        className="absolute inset-y-0 left-0 bg-red/12"
                        style={{ width: `${runway.entryPct}%` }}
                      />
                      <div
                        className="absolute inset-y-0 right-0 bg-green/12"
                        style={{ left: `${runway.entryPct}%` }}
                      />
                      {/* Proportionate R-multiple tick hairlines */}
                      {rTicks.map((t) => (
                        <div
                          key={t.r}
                          className={cn(
                            'absolute top-0 bottom-0 w-px pointer-events-none',
                            t.isAnchor ? 'bg-border/70' : 'bg-border/35'
                          )}
                          style={{ left: `${t.pct}%` }}
                        />
                      ))}
                      {/* Active PnL Fill anchored strictly at Entry (0R): red left for loss, green right for profit */}
                      <div
                        className={cn(
                          'absolute inset-y-0 transition-[left,width,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
                          isProfit ? 'bg-green/55' : 'bg-red/55'
                        )}
                        style={{
                          left: `${fillLeftPct}%`,
                          width: `${fillWidthPct}%`,
                        }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red/90 transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                        style={{ left: `${runway.slPct}%` }}
                        title={`Stop Loss (${Number(runway.slR ?? -1).toFixed(2)}R)`}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-text/85 transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                        style={{ left: `${runway.entryPct}%` }}
                        title="Entry Price (0R)"
                      />
                      {runway.tpPct !== null && (
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-green transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                          style={{ left: `${runway.tpPct}%` }}
                          title={`Take Profit (+${Number(runway.targetR ?? 2).toFixed(1)}R)`}
                        />
                      )}
                      <div
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-bg shadow-xs transition-[left,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
                          isProfit ? 'bg-green' : 'bg-red'
                        )}
                        style={{ left: `calc(${runway.livePct}% - 5px)` }}
                        title={`Live Price (${fmtPrice(model.markPrice)} · ${currR >= 0 ? '+' : ''}${currR.toFixed(2)}R)`}
                      />
                    </div>
                    {rTicks.length > 0 && (() => {
                      // Prioritize 0R and -1R anchors, then greedily keep ticks spaced >= 11% apart so labels never overlap
                      const MIN_TICK_LABEL_GAP_PCT = 11;
                      const prioritized = [...rTicks].sort((a, b) => {
                        const prio = (t) => (t.r === 0 ? 0 : t.r === -1 ? 1 : 2);
                        return prio(a) - prio(b) || a.pct - b.pct;
                      });
                      const visibleTickLabels = [];
                      for (const t of prioritized) {
                        if (t.pct < 4 || t.pct > 96) continue;
                        if (visibleTickLabels.every((kept) => Math.abs(kept.pct - t.pct) >= MIN_TICK_LABEL_GAP_PCT)) {
                          visibleTickLabels.push(t);
                        }
                      }
                      visibleTickLabels.sort((a, b) => a.pct - b.pct);
                      return (
                        <div className="relative h-3 w-full font-mono text-[8px] text-dim/75 tabular-nums select-none overflow-hidden">
                          {visibleTickLabels.map((t) => (
                            <span
                              key={t.r}
                              className={cn(
                                'absolute top-0 -translate-x-1/2 whitespace-nowrap',
                                t.r === 0 && 'text-text/80 font-bold',
                                t.r === -1 && 'text-red/80'
                              )}
                              style={{ left: `${t.pct}%` }}
                            >
                              {t.label}
                            </span>
                          ))}
                          {runway.liveOffLeft && (
                            <span className="absolute left-0 top-0 text-red font-bold bg-bg/80 px-0.5">‹</span>
                          )}
                          {runway.liveOffRight && (
                            <span className="absolute right-0 top-0 text-green font-bold bg-bg/80 px-0.5">›</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Ultra-Compact 1-Line Entry & Exit/Live Snapshot + True Linear R-Axis SL ↔ Entry ↔ Exit Ratio Bar */}
          {showExitSnapshotBar && (() => {
            const ex = effectiveOpp.exitSnapshot;
            const isLiveOpen = ex.tradeStatus === 'OPEN';
            const slDist = Math.max(0.05, Math.abs(Number(ex.slDistPct || effectiveOpp.sl_dist_pct || 1.0)));
            const pnlPctVal = Number(ex.pnlPct || 0);
            const exitRrVal = Number(ex.exitRr || 0);
            const targetRrVal = Math.max(0.5, Number(ex.targetRr || 2.0));

            const minR = Math.min(-1, exitRrVal) * 1.05;
            const maxR = Math.max(targetRrVal, exitRrVal, 1) * 1.05;
            const spanR = Math.max(1.5, maxR - minR);
            const rToPct = (rVal) => Math.max(0, Math.min(100, ((rVal - minR) / spanR) * 100));
            const slX = rToPct(-1);
            const entryX = rToPct(0);
            const exitX = rToPct(exitRrVal);
            const targetX = rToPct(targetRrVal);
            const fillLeft = exitRrVal >= 0 ? entryX : Math.min(entryX, exitX);
            const fillW = Math.abs(exitX - entryX);

            return (
              <div className="px-2.5 py-1.5 rounded-lg bg-bg/55 border border-border/45 flex items-center justify-between gap-2 flex-wrap font-mono text-[9.5px] tabular-nums">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={cn(
                    'text-[8.5px] font-black uppercase px-1.5 py-0.2 rounded border',
                    isLiveOpen
                      ? 'bg-green/12 border-green/35 text-green'
                      : 'bg-accent/12 border-accent/30 text-accent'
                  )}>
                    {isLiveOpen ? 'In-Pos Snapshot' : 'Exit Snapshot'}
                  </span>
                  <strong className="text-text uppercase truncate">
                    {isLiveOpen
                      ? 'LIVE POSITION'
                      : String(ex.exitSignalType || ex.exitReason || 'EXIT').replace(/_/g, ' ')}
                  </strong>
                  <span className="text-dim hidden sm:inline">
                    · SL <strong className="text-red">{fmtPrice(ex.initialSlPrice || ex.finalSlPrice)}</strong> → Entry <strong className="text-text">{fmtPrice(ex.entryPrice)}</strong> → {isLiveOpen ? 'Live' : 'Exit'} <strong className={pnlPctVal >= 0 ? 'text-green' : 'text-red'}>{fmtPrice(ex.exitPrice)}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  {/* Inline True Linear R-Axis Bar anchored at Entry (0R) */}
                  <div
                    className="flex items-center gap-1.5"
                    title={`SL -${slDist.toFixed(2)}% (-1.0R) | Entry 0R | ${isLiveOpen ? 'Live' : 'Exit'} ${pnlPctVal >= 0 ? '+' : ''}${pnlPctVal.toFixed(2)}% (${exitRrVal >= 0 ? '+' : ''}${exitRrVal.toFixed(2)}R) | Target +${targetRrVal.toFixed(1)}R`}
                  >
                    <span className="text-[8px] font-bold text-red">-{slDist.toFixed(1)}%</span>
                    <div className="relative w-28 h-2.5 rounded bg-surface/85 border border-border/45 overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-red/12" style={{ width: `${entryX}%` }} />
                      <div className="absolute inset-y-0 right-0 bg-green/12" style={{ left: `${entryX}%` }} />
                      <div
                        className={cn(
                          'absolute inset-y-0 transition-[left,width,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
                          exitRrVal >= 0 ? 'bg-green/60' : 'bg-red/60'
                        )}
                        style={{ left: `${fillLeft}%`, width: `${fillW}%` }}
                      />
                      <div className="absolute top-0 bottom-0 w-px bg-red/80" style={{ left: `${slX}%` }} />
                      <div className="absolute top-0 bottom-0 w-0.5 bg-text/90" style={{ left: `${entryX}%` }} />
                      <div className="absolute top-0 bottom-0 w-px bg-green/80" style={{ left: `${targetX}%` }} />
                    </div>
                    <span className={cn('text-[8px] font-bold', pnlPctVal >= 0 ? 'text-green' : 'text-red')}>
                      {pnlPctVal >= 0 ? '+' : ''}{pnlPctVal.toFixed(1)}%
                    </span>
                  </div>

                  <span className={cn('px-1.5 py-0.2 rounded border font-bold text-[9px]', exitRrVal >= 0 ? 'bg-green/10 border-green/30 text-green' : 'bg-red/10 border-red/30 text-red')}>
                    {exitRrVal >= 0 ? '+' : ''}{exitRrVal.toFixed(2)}R / {targetRrVal.toFixed(1)}R
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Dedicated Closed Snapshot Exit Breakdown (when ruleFilter === 'exit' on a closed trade snapshot) */}
          {isClosedExitSnapshotView ? (() => {
            const ex = effectiveOpp.exitSnapshot;
            const pnlPctVal = Number(ex.pnlPct || 0);
            const pnlUsdtVal = Number(ex.pnlUsdt || 0);
            const exitRrVal = Number(ex.exitRr || 0);
            const maxRrVal = Number(ex.maxRr ?? exitRrVal);
            const minRrVal = Number(ex.minRr ?? 0);
            const targetRrVal = Number(ex.targetRr || 2.0);
            const capturedExitSignals = ex.exitSignalsStatus && typeof ex.exitSignalsStatus === 'object'
              ? Object.entries(ex.exitSignalsStatus)
              : [];

            return (
              <div className="flex flex-col gap-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 font-mono">
                  <div className="rounded-xl border border-border/55 bg-bg/50 p-2.5 flex flex-col justify-between gap-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Exit Trigger</div>
                    <div className="text-xs font-bold text-text uppercase truncate" title={String(ex.exitSignalType || ex.exitReason || 'CLOSED')}>
                      {String(ex.exitSignalType || ex.exitReason || 'CLOSED').replace(/_/g, ' ')}
                    </div>
                    <div className="text-[10px] text-dim truncate" title={ex.exitSignalReason || ex.exitReason || ''}>
                      {ex.exitSignalReason || `Status: ${ex.tradeStatus || 'CLOSED'}`}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/55 bg-bg/50 p-2.5 flex flex-col justify-between gap-1.5 tabular-nums">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Realized Outcome</div>
                    <div className={cn('text-xs font-bold', pnlPctVal >= 0 ? 'text-green' : 'text-red')}>
                      {pnlPctVal >= 0 ? '+' : ''}{pnlPctVal.toFixed(2)}% ({pnlUsdtVal >= 0 ? '+' : ''}${pnlUsdtVal.toFixed(2)})
                    </div>
                    <div className="text-[10px] text-dim">
                      Exit <strong className="text-text">{exitRrVal >= 0 ? '+' : ''}{exitRrVal.toFixed(2)}R</strong> · Peak <strong className="text-green">+{Math.max(0, maxRrVal).toFixed(2)}R</strong> · Min <strong className="text-red">{minRrVal.toFixed(2)}R</strong>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/55 bg-bg/50 p-2.5 flex flex-col justify-between gap-1.5 tabular-nums">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Price Execution</div>
                    <div className="text-xs font-bold text-text">
                      {fmtPrice(ex.entryPrice)} → <span className={pnlPctVal >= 0 ? 'text-green' : 'text-red'}>{fmtPrice(ex.exitPrice)}</span>
                    </div>
                    <div className="text-[10px] text-dim">
                      Init SL {fmtPrice(ex.initialSlPrice)} · Final SL {fmtPrice(ex.finalSlPrice)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/55 bg-bg/50 p-2.5 flex flex-col justify-between gap-1.5 tabular-nums">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-dim">Target &amp; Risk</div>
                    <div className="text-xs font-bold text-text">
                      {ex.tpPrice > 0 ? `TP ${fmtPrice(ex.tpPrice)}` : `Target ${targetRrVal.toFixed(1)}R`}
                    </div>
                    <div className="text-[10px] text-dim">
                      SL Dist {Math.abs(Number(ex.slDistPct || 0)).toFixed(2)}% · Goal {targetRrVal.toFixed(1)}R
                    </div>
                  </div>
                </div>

                {capturedExitSignals.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 font-mono">
                    {capturedExitSignals.map(([sigKey, st]) => {
                      const fired = Boolean(st?.fired);
                      return (
                        <div key={sigKey} className={cn('rounded-lg border px-2.5 py-2 flex items-center justify-between gap-2 text-[10.5px]', fired ? 'border-green/40 bg-green/5' : 'border-border/45 bg-bg/40')}>
                          <span className="font-semibold text-text truncate">{String(sigKey).replace(/_/g, ' ')}</span>
                          <span className={cn('font-bold uppercase shrink-0', fired ? 'text-green' : 'text-dim')}>
                            {fired ? 'FIRED' : 'IDLE'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : configuredExitRules.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 font-mono">
                    {configuredExitRules.map((rule) => (
                      <div key={rule.key} className="rounded-lg border border-border/45 bg-bg/35 px-2.5 py-2 flex items-center justify-between gap-2 text-[10.5px]">
                        <div className="min-w-0">
                          <div className="font-semibold text-text truncate">{rule.label}</div>
                          <div className="text-[9.5px] text-dim truncate">{rule.paramsText || rule.reasonText}</div>
                        </div>
                        <span className="text-[9.5px] font-bold uppercase text-dim shrink-0">
                          {rule.status === 'firing' ? 'FIRED' : 'RULE'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })() : isExitPreviewMode ? (
            /* Configured Exit Rules Preview (when ruleFilter === 'exit' on a searching candidate with no open trade yet) */
            <div className="flex flex-col gap-2">
              {configuredExitRules.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 font-mono">
                  {configuredExitRules.map((rule) => (
                    <div
                      key={rule.key}
                      className="rounded-xl border border-border/55 bg-bg/45 p-2.5 flex flex-col justify-between gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-text truncate">{rule.label}</span>
                        <span className="text-[9.5px] font-bold uppercase text-accent shrink-0">ARMED</span>
                      </div>
                      <div className="text-[10.5px] text-text/85 truncate" title={rule.paramsText}>
                        {rule.paramsText || 'Configured'}
                      </div>
                      {rule.reasonText && (
                        <div className="text-[10px] text-dim leading-snug line-clamp-2">
                          {rule.reasonText}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] font-mono text-dim py-2 text-center">
                  No custom exit signals configured — positions will exit via Stop Loss / Take Profit levels.
                </div>
              )}
              <div className="text-[10px] font-mono text-dim pt-1 border-t border-border/35 flex items-center justify-between gap-2 flex-wrap">
                <span>Live exit dials activate automatically when a position opens on {hasCandidate ? model.symbol : 'a candidate'}.</span>
                <span className="text-accent/90">Previewing configured exit rules</span>
              </div>
            </div>
          ) : effectiveOpp?.isEntrySnapshot && effectiveOpp?.isMetadataOnlySnapshot && model.conditions.length === 0 ? (
            /* Fallback Entry Metadata Card for In-Pos / Closed trades that lack deep signalResult telemetry */
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5 font-mono tabular-nums">
              <div className="rounded-xl border border-border/55 bg-bg/50 p-2.5 flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase text-dim">Entry Price</span>
                <span className="text-xs font-bold text-text">{fmtPrice(effectiveOpp.price || effectiveOpp.exitSnapshot?.entryPrice)}</span>
                <span className="text-[10px] text-dim">{effectiveOpp.dir?.toUpperCase() || 'LONG'} entry</span>
              </div>
              <div className="rounded-xl border border-border/55 bg-bg/50 p-2.5 flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase text-dim">Initial Stop Loss</span>
                <span className="text-xs font-bold text-red">{fmtPrice(effectiveOpp.exitSnapshot?.initialSlPrice)}</span>
                <span className="text-[10px] text-dim">Dist -{Math.abs(Number(effectiveOpp.sl_dist_pct || 0)).toFixed(2)}%</span>
              </div>
              <div className="rounded-xl border border-border/55 bg-bg/50 p-2.5 flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase text-dim">Entry Source</span>
                <span className="text-xs font-bold text-text truncate">{effectiveOpp.entryReason || 'Strategy Execution'}</span>
                <span className="text-[10px] text-dim">Status: {effectiveOpp.snapshotTradeStatus || 'OPEN'}</span>
              </div>
              <div className="rounded-xl border border-border/55 bg-bg/50 p-2.5 flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase text-dim">Target R:R</span>
                <span className="text-xs font-bold text-accent">{Number(effectiveOpp.exitSnapshot?.targetRr || 2.0).toFixed(1)}R</span>
                <span className="text-[10px] text-dim">Telemetry captured on new fills</span>
              </div>
            </div>
          ) : isSyncing && !effectiveOpp?.isEntrySnapshot ? (
            <ConditionCardsSkeleton
              compact={compact}
              count={Math.max(2, Math.min(4, model.conditions.length || 4))}
            />
          ) : model.conditions.length === 0 ? (
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
                      'relative overflow-hidden rounded-xl border border-border/55 bg-gradient-to-b from-surface/40 via-bg/45 to-bg/65 p-2.5 flex flex-col justify-between h-full gap-1.5 shadow-xs transition-colors duration-200 hover:border-border/80',
                      changeInfo?.stateChanged && 'animate-event-arrive',
                      isLadder && (compact ? 'sm:col-span-2' : 'sm:col-span-2')
                    )}
                  >
                    {/* Subtle Top Status Spine */}
                    <div
                      className="absolute top-0 left-0 right-0 h-[2px] opacity-85 transition-colors duration-300"
                      style={{ backgroundColor: ZONE_COLOR_MAP[cZone] || ZONE_COLOR_MAP.watching }}
                    />

                    {/* Card Top Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={cn(
                              'text-[8.5px] font-black font-mono uppercase tracking-wider px-1.2 py-0.2 rounded border',
                              (c.isScannerGate || c.isSlGate)
                                ? 'bg-amber/10 text-amber border-amber/30'
                                : 'bg-surface/70 text-dim border-border/50'
                            )}
                          >
                            {c.connector}
                          </span>
                          <span className="text-[11.5px] font-bold text-text tracking-tight">
                            {c.label}
                          </span>
                          <span className="text-[9.5px] font-mono text-dim">
                            · <strong className="text-text/80">{c.timeframe}</strong>
                          </span>
                        </div>
                        <div className="text-[9px] font-mono text-dim mt-0.5 leading-tight flex items-center gap-1.5 flex-wrap">
                          {c.paramsText && c.paramsText !== 'Standard' && (
                            <span className="truncate">{c.paramsText} ·</span>
                          )}
                          <ConditionFreshness evaluatedAtMs={c.evaluatedAtMs} changeInfo={changeInfo} />
                        </div>
                      </div>

                      {/* Pill Status Indicator */}
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 text-[9px] font-mono font-bold shrink-0 px-1.5 py-0.5 rounded-full bg-surface/70 border border-border/50 transition-colors duration-200',
                          ZONE_TEXT_CLASS[cZone] || 'text-dim'
                        )}
                      >
                        <span className={cn('w-1.5 h-1.5 rounded-full transition-colors duration-200', ZONE_DOT_CLASS[cZone] || 'bg-dim')} />
                        {formatCleanCardStatus(cZone, c.stateLabel)}
                      </span>
                    </div>

                    {/* Visualization Body: Spatial Level Ladder for HTF Breakouts, Semicircular Dial for Threshold Signals */}
                    {isLadder ? (
                      <HtfBreakoutLadder ladder={c.ladder} compact={compact} changeInfo={changeInfo} />
                    ) : (
                      <>
                        <div className="flex justify-center items-center">
                          <ConditionDial
                            dialPct={c.dialPct}
                            dialZone={cZone}
                            dialOverText={c.dialOverText}
                            subText={c.dialScale?.subText || ''}
                            dialScale={c.dialScale || null}
                            size={compact ? 'sm' : 'md'}
                            changeInfo={changeInfo}
                          />
                        </div>

                        {/* Card Bottom: App-Like Bento Telemetry Strip for Live vs Target + Signed Distance */}
                        <div className="flex flex-col gap-1.5 rounded-lg bg-surface/45 border border-border/35 px-2.5 py-1.5 font-mono text-[10.5px] tabular-nums">
                          <div className="flex items-baseline justify-between gap-2 min-w-0">
                            <span className="text-dim text-[9.5px] uppercase tracking-wider font-semibold shrink-0">Live / Target</span>
                            <div className="min-w-0 truncate flex items-center gap-1">
                              <strong
                                className={cn(
                                  'font-bold truncate transition-colors duration-300',
                                  changeInfo?.changed ? changeInfo.toneClass : liveToneClass
                                )}
                              >
                                {c.liveText}
                              </strong>
                              <span className="text-dim/60 shrink-0">/</span>
                              <span className="text-accent font-semibold truncate">{c.targetText}</span>
                            </div>
                          </div>

                          {hasDeltaReadout && (
                            <div className="flex items-center justify-between gap-2 text-[9.5px] border-t border-border/25 pt-1 min-w-0">
                              <span className="text-dim uppercase tracking-wider font-semibold text-[8.5px] shrink-0">
                                {c.deltaLabel || ((Number(c.dialPct) || 0) >= 100 ? 'Past target' : 'To go')}
                              </span>
                              <span
                                className={cn(
                                  'font-bold min-w-0 truncate transition-colors duration-300',
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
                          {c.engulfingPattern && (
                            <EngulfingPatternStrip pattern={c.engulfingPattern} />
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
                    className="absolute top-0 left-0 right-0 h-[2px] opacity-85 transition-colors duration-300"
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
                        'inline-flex items-center gap-1.5 text-[9.5px] font-mono font-bold shrink-0 px-2 py-0.5 rounded-full bg-bg/60 border border-border/50 transition-colors duration-200',
                        ZONE_TEXT_CLASS[compositeDial.dialZone] || 'text-dim'
                      )}
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full transition-colors duration-200', ZONE_DOT_CLASS[compositeDial.dialZone] || 'bg-dim')} />
                      {formatCleanCardStatus(compositeDial.dialZone, model.firedConditionsCount === model.totalConditionsCount && model.totalConditionsCount > 0 ? 'Ready' : 'Watching')}
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
          {!showingExitView && model.antiWhipsaw && !model.antiWhipsaw.disabled && (
            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/40 text-[10px] font-mono flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200',
                    model.antiWhipsaw.locked ? 'bg-amber' : 'bg-green'
                  )}
                />
                <span className="text-dim font-bold uppercase">Anti-Whipsaw:</span>
                <span
                  className={cn(
                    'font-bold truncate transition-colors duration-200',
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
      </SmoothHeightContainer>
    </div>
  );
});

export default CandidateConditionsGauge;
