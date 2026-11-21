import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn, Tooltip } from './primitives';
import { price as fmtPrice } from '../../lib/formatters';
import { computeConditionMeter, buildHtfLadderModel, buildMacdFilterModel, computeConditionValueDelta } from '../../utils/candidateConditions';
import { ConditionDial, HtfBreakoutLadder, MacdFilterStrip } from './CandidateConditionsGauge';

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

const ZONE_COLOR_MAP = {
  watching: '#64748b',
  near: '#3b82f6',
  fresh: '#22c55e',
  stale: '#f59e0b',
  late: '#ef4444',
  warming: '#f59e0b',
  blocked: '#a855f7',
};

/**
 * SignalGauge: Renders the vertical HtfBreakoutLadder for HTF Breakout signals
 * or the 0–150% semicircular ConditionDial for threshold/spread signals,
 * with live value change highlighting and semantic color-coding.
 */
export const SignalGauge = React.memo(({
  signal,
  label,
  value,
  threshold,
  unit = '',
  fired = false,
  active = true,
  rejected = false,
  status,
  description = '',
  signalDescription = '',
  signalKey: propSignalKey = '',
  signalMetric = '',
  proximity,
  etaCandles = null,
  estimatedPnl = null,
  estimatedR = null,
  signalEstimation = null,
  insufficientData = false,
  thresholdIsPrice = false,
  isExit = false,
  type = '',
  isLong = true,
  markPrice,
  strategyConfig = {},
  opp = null,
  className,
  compact = false,
  children,
}) => {
  const effectiveIsExit = Boolean(isExit || type === 'exit');
  const resolvedEstPnl = signalEstimation?.estimatedPnl ?? estimatedPnl;
  const resolvedEstR = signalEstimation?.estimatedR ?? estimatedR;
  const resolvedProx = signalEstimation?.proximity ?? proximity ?? 0;
  const resolvedEta = signalEstimation?.etaCandles ?? etaCandles;
  const s = signal || {
    key: propSignalKey,
    metric: signalMetric,
    label,
    value,
    threshold,
    unit,
    fired,
    active,
    rejected,
    status,
    description: description || signalDescription,
    proximity: resolvedProx,
    etaCandles: resolvedEta,
    estimatedPnl: resolvedEstPnl,
    estimatedR: resolvedEstR,
    insufficientData,
    threshold_is_price: thresholdIsPrice,
  };

  const finalLabel = s.label || label || s.key || propSignalKey || 'Signal';
  const finalValue = s.value !== undefined ? s.value : (value !== undefined ? value : markPrice);
  const finalThreshold = s.threshold !== undefined ? s.threshold : threshold;
  const finalUnit = s.unit !== undefined ? s.unit : unit;
  const isFired = s.fired !== undefined ? s.fired : fired;
  const isActive = s.active !== undefined ? s.active : active;
  const isRejected = s.rejected !== undefined ? s.rejected : (s.status === 'blocked' || rejected);
  const finalProx = Math.min(100, Math.max(0, Math.round(Number(s.proximity !== undefined ? s.proximity : resolvedProx) || 0)));
  const finalEta = s.etaCandles !== undefined ? s.etaCandles : resolvedEta;
  const finalInsufficient = s.insufficientData !== undefined ? s.insufficientData : insufficientData;
  const isPrice = s.threshold_is_price !== undefined ? s.threshold_is_price : thresholdIsPrice;
  const sigKey = String(s.key || propSignalKey || finalLabel || '').toLowerCase();
  const isHtfBreakout =
    sigKey.includes('htf_breakout') ||
    sigKey.includes('prev_day_breakout') ||
    finalLabel.toLowerCase().includes('htf breakout') ||
    (s.ref_high !== undefined && s.ref_low !== undefined);

  const ladder = useMemo(() => {
    if (!isHtfBreakout || finalInsufficient) return null;
    return buildHtfLadderModel({
      sigKey: s.key || propSignalKey || 'htf_breakout',
      signalDetail: s,
      opp,
      strategyConfig,
      markPrice: Number(finalValue || markPrice || 0),
      isLong,
      isExit: effectiveIsExit,
    });
  }, [isHtfBreakout, finalInsufficient, s, propSignalKey, opp, strategyConfig, finalValue, markPrice, isLong, effectiveIsExit]);

  const meter = useMemo(() => computeConditionMeter({
    value: finalValue,
    threshold: finalThreshold,
    thresholdIsPrice: Boolean(isPrice),
    unit: finalUnit || '',
    isLong,
    isExit: effectiveIsExit,
    fired: Boolean(isFired),
    active: isActive !== false,
    rejected: Boolean(isRejected || ladder?.isOverCap),
    insufficientData: Boolean(finalInsufficient),
    signalKey: s.key || propSignalKey || finalLabel,
    proximity: finalProx,
    isIndicatorPair:
      sigKey.includes('dual') ||
      sigKey.includes('cross') ||
      String(s.metric || signalMetric || '').toLowerCase().includes('dual') ||
      String(s.metric || signalMetric || '').toLowerCase().includes('cross'),
  }), [finalValue, finalThreshold, isPrice, finalUnit, isLong, effectiveIsExit, isFired, isActive, isRejected, ladder?.isOverCap, finalInsufficient, s.key, propSignalKey, finalLabel, finalProx, sigKey, s.metric, signalMetric]);

  const formatVal = (val) => {
    if (val === undefined || val === null || Number.isNaN(Number(val))) return '---';
    const num = Number(val);
    if (isPrice || finalUnit === 'price') return fmtPrice(num);
    const decimals = Math.abs(num) >= 100 ? 2 : Math.abs(num) >= 1 ? 3 : 4;
    return `${num.toFixed(decimals)}${finalUnit || ''}`;
  };

  const zone = ladder
    ? (ladder.isOverCap || isRejected ? 'blocked' : (ladder.zone === 'below' ? 'watching' : ladder.zone))
    : (meter.dialZone || 'watching');
  const liveFormatted = finalInsufficient ? '---' : formatVal(finalValue);

  const macdFilter = useMemo(() => {
    if (finalInsufficient) return null;
    return buildMacdFilterModel({
      sigKey: s.key || propSignalKey || finalLabel,
      signalDetail: s,
      strategyConfig,
      isLong,
      isExit: effectiveIsExit,
    });
  }, [finalInsufficient, s, propSignalKey, finalLabel, strategyConfig, isLong, effectiveIsExit]);

  const prevItemRef = useRef(null);
  const [changeInfo, setChangeInfo] = useState(null);

  useEffect(() => {
    const currItem = {
      liveValue: !finalInsufficient && Number.isFinite(Number(finalValue)) ? Number(finalValue) : null,
      liveText: liveFormatted,
      dialPct: ladder ? ladder.dialPct : meter.dialPct,
      rawDialPct: ladder ? ladder.rawDialPct : meter.rawDialPct,
      dialZone: zone,
      unit: finalUnit || '',
      thresholdIsPrice: Boolean(isPrice || finalUnit === 'price'),
      stateLabel: ladder ? ladder.zoneLabel : meter.dialStatus,
      macdFilter,
    };

    const delta = computeConditionValueDelta(prevItemRef.current, currItem);
    prevItemRef.current = currItem;

    if (!delta) return undefined;
    setChangeInfo(delta);
    const timer = setTimeout(() => setChangeInfo(null), 1800);
    return () => clearTimeout(timer);
  }, [finalValue, finalInsufficient, liveFormatted, ladder, meter.dialPct, meter.rawDialPct, meter.dialStatus, zone, finalUnit, isPrice, macdFilter]);

  const liveToneClass = zone === 'watching' ? 'text-text' : (ZONE_TEXT_CLASS[zone] || 'text-text');
  const hasDeltaReadout = Boolean(meter.deltaValueText || meter.deltaPctText);

  return (
    <Tooltip content={s.description || description || signalDescription || `${finalLabel}: ${formatVal(finalValue)} / ${formatVal(finalThreshold)}`}>
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-border/55 bg-gradient-to-b from-surface/40 via-bg/45 to-bg/65 flex flex-col justify-between shadow-xs transition-colors duration-200 hover:border-border/80',
          compact ? 'p-2.5 gap-2' : 'p-3 gap-2.5',
          isHtfBreakout && 'sm:col-span-2',
          className
        )}
      >
        {/* Subtle Top Status Spine */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px] opacity-85"
          style={{ backgroundColor: ZONE_COLOR_MAP[zone] || ZONE_COLOR_MAP.watching }}
        />

        {/* Top Row: Label + Pill Zone Status */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <span className="text-[11.5px] font-bold text-text tracking-tight leading-snug break-words block">
              {finalLabel}
            </span>
            {finalEta !== null && finalEta > 0 && !isFired && (
              <span className="text-[9.5px] font-mono text-dim tabular-nums">
                ~{finalEta} bars to target
              </span>
            )}
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[9.5px] font-mono font-bold shrink-0 px-2 py-0.5 rounded-full bg-surface/70 border border-border/50',
              ZONE_TEXT_CLASS[zone] || 'text-dim'
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', ZONE_DOT_CLASS[zone] || 'bg-dim')} />
            {ladder ? ladder.zoneLabel : meter.dialStatus}
          </span>
        </div>

        {/* Body: HTF Level Ladder or Semicircular Dial */}
        {ladder ? (
          <HtfBreakoutLadder ladder={ladder} compact={compact} changeInfo={changeInfo} />
        ) : (
          <>
            <div className="flex justify-center items-center my-0.5">
              <ConditionDial
                dialPct={meter.dialPct}
                dialZone={zone}
                dialOverText={meter.dialOverText}
                dialScale={meter.dialScale}
                subText={meter.dialScale?.subText || ''}
                size="sm"
                changeInfo={changeInfo}
              />
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg bg-surface/45 border border-border/35 px-2.5 py-1.5 font-mono text-[10.5px] tabular-nums">
              <div className="flex items-baseline justify-between gap-2 min-w-0">
                <span className="text-dim text-[9px] uppercase tracking-wider font-semibold shrink-0">Live / Target</span>
                <div className="min-w-0 truncate flex items-center gap-1">
                  <strong
                    className={cn(
                      'font-bold truncate transition-colors duration-300',
                      changeInfo?.changed ? changeInfo.toneClass : liveToneClass
                    )}
                  >
                    {liveFormatted}
                  </strong>
                  {finalThreshold !== undefined && finalThreshold !== null && (
                    <>
                      <span className="text-dim/60 shrink-0">/</span>
                      <span className="text-accent font-semibold truncate">{formatVal(finalThreshold)}</span>
                    </>
                  )}
                </div>
              </div>

              {hasDeltaReadout && (
                <div className="flex items-center justify-between gap-2 text-[9px] border-t border-border/25 pt-1 min-w-0">
                  <span className="text-dim uppercase tracking-wider font-semibold text-[8.5px] shrink-0">
                    {(Number(meter.dialPct) || 0) >= 100 ? 'Past target' : 'To go'}
                  </span>
                  <span
                    className={cn(
                      'font-bold min-w-0 truncate transition-colors duration-300',
                      changeInfo?.changed ? changeInfo.toneClass : (ZONE_TEXT_CLASS[zone] || 'text-dim')
                    )}
                  >
                    {meter.deltaValueText}
                    {meter.deltaPctText && meter.deltaPctText !== meter.deltaValueText ? ` (${meter.deltaPctText})` : ''}
                  </span>
                </div>
              )}

              {macdFilter && (
                <MacdFilterStrip macdFilter={macdFilter} changeInfo={changeInfo} />
              )}
            </div>
          </>
        )}

        {children && (
          <div className="pt-1 border-t border-border/25">
            {children}
          </div>
        )}
      </div>
    </Tooltip>
  );
});

SignalGauge.displayName = 'SignalGauge';
export default SignalGauge;

