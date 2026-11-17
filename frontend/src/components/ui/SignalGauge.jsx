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
  proximity = 0,
  etaCandles = null,
  estimatedPnl = null,
  estimatedR = null,
  signalEstimation = null,
  entryPrice = null,
  markPrice = null,
  qty = null,
  riskUsdt = null,
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

  // Exit estimation: backend (authoritative, covers non-price signals like MACD/momentum) first,
  // then price-threshold fallback; capped by live PnL so an unreached signal never over-promises.
  const estimation = useMemo(() => {
    const dir = isLong ? 1 : -1;
    const entry = Number(entryPrice);
    const q = Number(qty);
    const canPrice = Number.isFinite(entry) && entry > 0 && Number.isFinite(q) && q > 0;
    const backendPnl = signalEstimation?.estimatedPnl ?? s.estimatedPnl ?? estimatedPnl;
    let pnl = (backendPnl !== undefined && backendPnl !== null && Number.isFinite(Number(backendPnl))) ? Number(backendPnl) : null;
    if (pnl === null && isPrice && canPrice && Number.isFinite(Number(finalThreshold))) {
      pnl = (Number(finalThreshold) - entry) * q * dir;
    }
    const mark = Number(markPrice);
    if (pnl !== null && canPrice && Number.isFinite(mark) && mark > 0) {
      pnl = Math.min(pnl, (mark - entry) * q * dir);
    }
    const backendR = signalEstimation?.estimatedR ?? s.estimatedR ?? estimatedR;
    let r = (backendR !== undefined && backendR !== null && Number.isFinite(Number(backendR))) ? Number(backendR) : null;
    const risk = Number(riskUsdt);
    if (r === null && pnl !== null && Number.isFinite(risk) && risk > 0) r = pnl / risk;
    return pnl === null && r === null ? null : { pnl, r };
  }, [signalEstimation, s, estimatedPnl, estimatedR, entryPrice, markPrice, qty, riskUsdt, isLong, isPrice, finalThreshold]);

  const zone = meter.dialZone || 'watching';
  const liveFormatted = finalInsufficient ? '---' : formatVal(finalValue);

  const macdFilter = useMemo(() => {
    if (finalInsufficient) return null;
    return buildMacdFilterModel({
      sigKey: s.key || finalLabel,
      signalDetail: s,
      isLong,
      isExit,
    });
  }, [finalInsufficient, s, finalLabel, isLong, isExit]);

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
    <Tooltip content={s.description || description || `${finalLabel}: ${formatVal(finalValue)} / ${formatVal(finalThreshold)}`}>
      <div
        className={cn(
          'rounded-xl border border-border/50 bg-bg/40 flex flex-col justify-between',
          compact ? 'p-2.5 gap-1.5' : 'p-3 gap-2',
          isHtfBreakout && 'sm:col-span-2',
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
          <HtfBreakoutLadder ladder={ladder} compact={compact} changeInfo={changeInfo} />
        ) : (
          <>
            <div className="flex justify-center items-center my-0.5">
              <ConditionDial
                dialPct={meter.dialPct}
                dialZone={zone}
                dialOverText={meter.dialOverText}
                size="sm"
                changeInfo={changeInfo}
              />
            </div>

            <div className="flex flex-col gap-1 pt-1.5 border-t border-border/30 font-mono text-[10.5px] tabular-nums">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-dim text-[9.5px]">Live / Target</span>
                <div className="truncate flex items-center gap-1">
                  <strong
                    className={cn(
                      'font-bold transition-colors duration-300',
                      changeInfo?.changed ? changeInfo.toneClass : liveToneClass
                    )}
                  >
                    {liveFormatted}
                  </strong>
                  {finalThreshold !== undefined && finalThreshold !== null && (
                    <>
                      <span className="text-dim">/</span>
                      <span className="text-accent/90 font-semibold">{formatVal(finalThreshold)}</span>
                    </>
                  )}
                </div>
              </div>

              {hasDeltaReadout && (
                <div className="flex items-center justify-between gap-2 text-[9px]">
                  <span className="text-dim">
                    {(Number(meter.dialPct) || 0) >= 100 ? 'Past target' : 'Distance'}
                  </span>
                  <span
                    className={cn(
                      'font-semibold truncate transition-colors duration-300',
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

        {estimation && !finalInsufficient && (
          <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-border/30 font-mono text-[10px] tabular-nums">
            <span className="text-dim text-[9.5px]">Est. PnL / R</span>
            <span className={cn('font-bold', (estimation.pnl ?? estimation.r ?? 0) >= 0 ? 'text-green' : 'text-red')}>
              {estimation.pnl !== null ? `${estimation.pnl >= 0 ? '+' : '-'}$${Math.abs(estimation.pnl).toFixed(2)}` : '---'}
              {estimation.r !== null ? ` · ${estimation.r >= 0 ? '+' : ''}${estimation.r.toFixed(2)}R` : ''}
            </span>
          </div>
        )}
      </div>
    </Tooltip>
  );
});

SignalGauge.displayName = 'SignalGauge';
export default SignalGauge;

