import React, { useMemo } from 'react';
import { cn, Tooltip } from './primitives';
import { price as fmtPrice } from '../../lib/formatters';
import { computeConditionMeter, buildHtfLadderModel } from '../../utils/candidateConditions';
import { ConditionDial, HtfBreakoutLadder } from './CandidateConditionsGauge';

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

/**
 * SignalGauge: Renders the vertical HtfBreakoutLadder for HTF Breakout signals
 * or the 0–150% semicircular ConditionDial for threshold/spread signals.
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
  proximity = 0,
  etaCandles = null,
  estimatedPnl = null,
  estimatedR = null,
  insufficientData = false,
  thresholdIsPrice = false,
  isExit = false,
  isLong = true,
  className,
  compact = false,
}) => {
  const s = signal || {
    label,
    value,
    threshold,
    unit,
    fired,
    active,
    rejected,
    status,
    description,
    proximity,
    etaCandles,
    estimatedPnl,
    estimatedR,
    insufficientData,
    threshold_is_price: thresholdIsPrice,
  };

  const finalLabel = s.label || label || s.key || 'Signal';
  const finalValue = s.value !== undefined ? s.value : value;
  const finalThreshold = s.threshold !== undefined ? s.threshold : threshold;
  const finalUnit = s.unit !== undefined ? s.unit : unit;
  const isFired = s.fired !== undefined ? s.fired : fired;
  const isActive = s.active !== undefined ? s.active : active;
  const isRejected = s.rejected !== undefined ? s.rejected : (s.status === 'blocked' || rejected);
  const finalProx = Math.min(100, Math.max(0, Math.round(s.proximity !== undefined ? s.proximity : proximity)));
  const finalEta = s.etaCandles !== undefined ? s.etaCandles : etaCandles;
  const finalInsufficient = s.insufficientData !== undefined ? s.insufficientData : insufficientData;
  const isPrice = s.threshold_is_price !== undefined ? s.threshold_is_price : thresholdIsPrice;
  const sigKey = String(s.key || finalLabel || '').toLowerCase();
  const isHtfBreakout =
    sigKey.includes('htf_breakout') ||
    sigKey.includes('prev_day_breakout') ||
    finalLabel.toLowerCase().includes('htf breakout') ||
    (s.ref_high !== undefined && s.ref_low !== undefined);

  const ladder = useMemo(() => {
    if (!isHtfBreakout || finalInsufficient) return null;
    return buildHtfLadderModel({
      sigKey: s.key || 'htf_breakout',
      signalDetail: s,
      markPrice: Number(finalValue || 0),
      isLong,
      isExit,
    });
  }, [isHtfBreakout, finalInsufficient, s, finalValue, isLong, isExit]);

  const meter = useMemo(() => computeConditionMeter({
    value: finalValue,
    threshold: finalThreshold,
    thresholdIsPrice: Boolean(isPrice),
    unit: finalUnit || '',
    isLong,
    isExit,
    fired: Boolean(isFired),
    active: isActive !== false,
    rejected: Boolean(isRejected),
    insufficientData: Boolean(finalInsufficient),
    signalKey: s.key || finalLabel,
    proximity: finalProx,
    isIndicatorPair: String(s.key || finalLabel).toLowerCase().includes('dual') || String(s.key || finalLabel).toLowerCase().includes('cross'),
  }), [finalValue, finalThreshold, isPrice, finalUnit, isLong, isExit, isFired, isActive, isRejected, finalInsufficient, s.key, finalLabel, finalProx]);

  const formatVal = (val) => {
    if (val === undefined || val === null || Number.isNaN(Number(val))) return '---';
    const num = Number(val);
    if (isPrice || finalUnit === 'price') return fmtPrice(num);
    const decimals = Math.abs(num) >= 100 ? 2 : Math.abs(num) >= 1 ? 3 : 4;
    return `${num.toFixed(decimals)}${finalUnit || ''}`;
  };

  const zone = meter.dialZone || 'watching';

  return (
    <Tooltip content={s.description || description || `${finalLabel}: ${formatVal(finalValue)} / ${formatVal(finalThreshold)}`}>
      <div
        className={cn(
          'rounded-xl border border-border/50 bg-bg/40 flex flex-col justify-between transition-colors',
          compact ? 'p-2.5 gap-1.5' : 'p-3 gap-2',
          isHtfBreakout && 'sm:col-span-2',
          zone === 'fresh' && 'border-green/35 bg-green/[0.03]',
          zone === 'stale' && 'border-amber/35 bg-amber/[0.03]',
          (zone === 'late' || zone === 'blocked') && 'border-red/35 bg-red/[0.03]',
          className
        )}
      >
        {/* Top Row: Label + Unboxed Zone Status */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-text leading-snug break-words block">
              {finalLabel}
            </span>
            {finalEta !== null && finalEta > 0 && !isFired && (
              <span className="text-[9.5px] font-mono text-dim">
                ~{finalEta} bars to target
              </span>
            )}
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[10px] font-mono font-bold shrink-0',
              ZONE_TEXT_CLASS[zone] || 'text-dim'
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', ZONE_DOT_CLASS[zone] || 'bg-dim')} />
            {ladder ? ladder.zoneLabel : meter.dialStatus}
          </span>
        </div>

        {/* Body: HTF Level Ladder or Semicircular Dial */}
        {ladder ? (
          <HtfBreakoutLadder ladder={ladder} compact={compact} />
        ) : (
          <>
            <div className="flex justify-center items-center my-0.5">
              <ConditionDial
                dialPct={meter.dialPct}
                dialZone={zone}
                dialOverText={meter.dialOverText}
                size="sm"
              />
            </div>

            <div className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-border/30 font-mono text-[10.5px] tabular-nums">
              <span className="text-dim text-[9.5px]">Live / Target</span>
              <div className="truncate">
                <strong className="text-text font-bold">{finalInsufficient ? '---' : formatVal(finalValue)}</strong>
                {finalThreshold !== undefined && finalThreshold !== null && (
                  <span className="text-dim"> / {formatVal(finalThreshold)}</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Tooltip>
  );
});

SignalGauge.displayName = 'SignalGauge';
export default SignalGauge;
