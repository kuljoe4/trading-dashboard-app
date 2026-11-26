import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ArrowRight,
  AlertTriangle,
  ShieldAlert,
  X,
  Layers,
  Check,
} from 'lucide-react';
import { cn, Btn } from './ui/primitives';
import { SmoothCollapse, MotionSegmentedPill, MOTION_EASE } from './ui/SmoothMotion';
import { fmtUSD, pnlClass } from '../lib/theme';
import { usePersistedFilter } from '../hooks/usePersistedFilter';
import {
  aggregatePastWeekStrategies,
  formatRiskPct,
  PAST_WEEK_WINDOW_DAYS,
} from '../utils/strategyPromotion';

const MODE_LABELS = {
  paper: 'Paper',
  testnet: 'Testnet',
  live: 'Live',
  backtest: 'Backtest',
};

const getRoleDescriptor = (item) => {
  const flags = item?.locationFlags;
  if (!flags) return { label: 'Session', cls: 'text-dim' };
  if (flags.isActiveBase) return { label: 'Active Base', cls: 'text-accent font-semibold' };
  if (flags.isActiveVariant) {
    return { label: `Variant #${flags.variantIndex + 1}`, cls: 'text-violet-300 font-semibold' };
  }
  if (flags.hasPreset) return { label: 'Preset', cls: 'text-green font-medium' };
  return { label: 'Session', cls: 'text-dim' };
};

export const PastWeekPromotionPanel = ({
  trades = [],
  sessions = [],
  activeConfig = {},
  presets = [],
  mode = 'paper',
  sessionActive = false,
  promotingLabel = null,
  onPromoteStrategy,
  compact = false,
  defaultExpanded = false,
  storageKey = 'past_week_promotion_expanded',
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = usePersistedFilter(storageKey, defaultExpanded);
  const [reviewFilter, setReviewFilter] = useState('all'); // 'all' | 'winners' | 'underperformers'
  const [confirmState, setConfirmState] = useState(null); // { item, action: 'promote' | 'demote' }
  const [updateActiveOpt, setUpdateActiveOpt] = useState(true);
  const [pauseStrategyOpt, setPauseStrategyOpt] = useState(false);
  const [activateInactiveOpt, setActivateInactiveOpt] = useState(false);
  const [activationMode, setActivationMode] = useState('variant');
  const [savePresetOpt, setSavePresetOpt] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const normalizedMode = String(mode || 'paper').toLowerCase();
  const modeLabel = MODE_LABELS[normalizedMode] || normalizedMode.toUpperCase();

  const { strategies, summary } = useMemo(
    () =>
      aggregatePastWeekStrategies({
        trades,
        sessions,
        activeConfig,
        presets,
        mode: normalizedMode,
        windowDays: PAST_WEEK_WINDOW_DAYS,
      }),
    [trades, sessions, activeConfig, presets, normalizedMode]
  );

  // Sync sensible confirmation defaults whenever a strategy modal opens
  useEffect(() => {
    if (!confirmState?.item) return;
    const isActive = Boolean(confirmState.item.locationFlags?.isActive);
    setUpdateActiveOpt(isActive);
    setPauseStrategyOpt(false);
    setActivateInactiveOpt(false);
    setActivationMode('variant');
    setSavePresetOpt(true);
  }, [confirmState]);

  const topStrategy = strategies[0] || null;
  const worstUnderperformer = useMemo(() => {
    for (let i = strategies.length - 1; i >= 0; i--) {
      if (strategies[i].qualifiesForDemotion) return strategies[i];
    }
    return null;
  }, [strategies]);

  // Reset filter automatically if category becomes empty
  useEffect(() => {
    if (reviewFilter === 'winners' && summary.profitableCount === 0) setReviewFilter('all');
    if (reviewFilter === 'underperformers' && summary.underperformingCount === 0) setReviewFilter('all');
  }, [reviewFilter, summary.profitableCount, summary.underperformingCount]);

  const filteredStrategies = useMemo(() => {
    if (reviewFilter === 'winners') return strategies.filter((s) => s.qualifiesForPromotion);
    if (reviewFilter === 'underperformers') return strategies.filter((s) => s.qualifiesForDemotion);
    return strategies;
  }, [strategies, reviewFilter]);

  const isBusy = Boolean(submitting || promotingLabel);

  const openConfirmModal = (item, action = null) => {
    if (!item || isBusy) return;
    const resolvedAction = action === 'demote'
      ? 'demote'
      : action === 'promote'
        ? 'promote'
        : (item.qualifiesForDemotion && !item.qualifiesForPromotion ? 'demote' : 'promote');
    setConfirmState({ item, action: resolvedAction });
  };

  const handleConfirmSubmit = async () => {
    if (!confirmState?.item || !onPromoteStrategy || isBusy) return;
    const { item, action } = confirmState;
    const isDemote = action === 'demote';
    const activePlan = isDemote ? item.demoteRiskPlan : item.riskPlan;
    const isActive = Boolean(item.locationFlags?.isActive);
    const shouldUpdateActive = isActive ? updateActiveOpt : activateInactiveOpt;
    if (!shouldUpdateActive && !savePresetOpt) return;

    setSubmitting(true);
    try {
      const ok = await onPromoteStrategy(item, {
        action,
        riskPlan: activePlan,
        pauseStrategy: isDemote && isActive && updateActiveOpt && pauseStrategyOpt,
        updateActive: shouldUpdateActive,
        activateIfInactive: !isActive && activateInactiveOpt,
        activationMode,
        savePreset: savePresetOpt,
      });
      if (ok !== false) {
        setConfirmState(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderConfirmDialog = () => {
    if (!confirmState?.item) return null;
    const confirmItem = confirmState.item;
    const isDemote = confirmState.action === 'demote';
    const activePlan = isDemote ? confirmItem.demoteRiskPlan : confirmItem.riskPlan;
    const { locationFlags } = confirmItem;
    const isActive = Boolean(locationFlags?.isActive);
    const matchesActiveMode = Boolean(locationFlags?.matchesActiveMode);
    const canActivateWhileIdleOrMatching = !sessionActive || matchesActiveMode;
    const willTouchActive = isActive ? updateActiveOpt : activateInactiveOpt;
    const nothingSelected = !willTouchActive && !savePresetOpt;
    const isLiveTarget = locationFlags?.targetMode === 'live' || locationFlags?.activeConfigMode === 'live';

    return (
      <Dialog.Root
        open={Boolean(confirmState)}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmState(null);
        }}
      >
        <AnimatePresence>
          {confirmState && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    'fixed inset-0 z-10120 bg-black/80 w-full h-full',
                    submitting ? 'cursor-wait' : 'cursor-pointer'
                  )}
                />
              </Dialog.Overlay>
              <Dialog.Content className="fixed bottom-0 top-auto left-0 right-0 translate-x-0 translate-y-0 z-10130 outline-none w-full max-h-[88vh] md:fixed md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[calc(100%-2rem)] md:max-w-md">
                <motion.div
                  role="dialog"
                  initial={{ opacity: 0, scale: 0.97, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: 4 }}
                  transition={{ duration: 0.2, ease: MOTION_EASE.outExpo }}
                  className="bg-surface border border-border rounded-t-3xl rounded-b-none md:rounded-2xl p-4 sm:p-5 shadow-2xl overflow-y-auto max-h-[88vh] flex flex-col gap-3.5"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Dialog.Title className="text-sm sm:text-base font-bold tracking-tight text-text truncate">
                        {isDemote ? `Demote "${confirmItem.strategyLabel}"` : `Promote "${confirmItem.strategyLabel}"`}
                      </Dialog.Title>
                      <Dialog.Description className="text-[11px] text-dim mt-0.5 leading-snug">
                        {isDemote
                          ? `Halve risk per trade and strategy risk allocation (0.5×) based on past 7-day results (${modeLabel}).`
                          : `Double risk per trade and strategy risk allocation (2×) based on past 7-day results (${modeLabel}).`}
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild disabled={submitting}>
                      <button
                        type="button"
                        disabled={submitting}
                        aria-label={isDemote ? 'Close demotion confirmation' : 'Close promotion confirmation'}
                        className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-dim hover:text-text hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                      >
                        <X size={15} />
                      </button>
                    </Dialog.Close>
                  </div>

                  {/* Past 7D Snapshot Strip */}
                  <div className="rounded-xl border border-border/60 bg-background/55 px-3 py-2 flex items-center justify-between gap-2 text-xs font-mono tabular-nums flex-wrap">
                    <span className={cn('font-bold', pnlClass(confirmItem.netPnl))}>
                      {confirmItem.netPnl > 0 ? `+${fmtUSD(confirmItem.netPnl)}` : fmtUSD(confirmItem.netPnl)}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11px] text-dim">
                      <span>{confirmItem.winRate.toFixed(0)}% WR</span>
                      <span aria-hidden="true" className="opacity-40">·</span>
                      <span>{confirmItem.profitFactor.toFixed(2)} PF</span>
                      <span aria-hidden="true" className="opacity-40">·</span>
                      <span>
                        {confirmItem.tradesCount} {confirmItem.tradesCount === 1 ? 'trade' : 'trades'}
                      </span>
                    </div>
                  </div>

                  {/* Before -> After Risk Table */}
                  <div className="rounded-xl border border-border/70 bg-background/45 p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-dim font-medium">Risk per Trade</span>
                      <div className="flex items-center gap-1.5 font-mono tabular-nums font-bold">
                        <span className="text-dim">{formatRiskPct(activePlan.currentRiskPerTrade)}</span>
                        <ArrowRight size={12} className={cn('shrink-0', isDemote ? 'text-amber' : 'text-accent')} />
                        <span className={isDemote ? 'text-amber' : 'text-accent'}>
                          {formatRiskPct(activePlan.nextRiskPerTrade)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-border/35">
                      <span className="text-dim font-medium">Max Strategy Risk</span>
                      <div className="flex items-center gap-1.5 font-mono tabular-nums font-bold">
                        <span className="text-dim">{formatRiskPct(activePlan.currentMaxTotalRisk)}</span>
                        <ArrowRight size={12} className={cn('shrink-0', isDemote ? 'text-amber' : 'text-green')} />
                        <span className={isDemote ? 'text-amber' : 'text-green'}>
                          {formatRiskPct(activePlan.nextMaxTotalRisk)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] pt-2 border-t border-border/35 text-dim">
                      <span>Concurrent Full-Risk Slots</span>
                      <span className="font-mono tabular-nums text-text">
                        {activePlan.currentConcurrentSlots} → {activePlan.nextConcurrentSlots}
                      </span>
                    </div>
                  </div>

                  {/* Safety / Cap Notices */}
                  {!isDemote && !confirmItem.qualifiesForPromotion && (
                    <div className="rounded-xl border border-amber/35 bg-amber/8 px-3 py-2 flex items-start gap-2 text-[11px] text-amber leading-snug">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>
                        Past 7-day net P&amp;L is not positive ({fmtUSD(confirmItem.netPnl)}). Confirm only if you intentionally want to double this strategy&apos;s risk limits.
                      </span>
                    </div>
                  )}

                  {isDemote && confirmItem.qualifiesForPromotion && (
                    <div className="rounded-xl border border-amber/35 bg-amber/8 px-3 py-2 flex items-start gap-2 text-[11px] text-amber leading-snug">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>
                        Past 7-day net P&amp;L is positive (+{fmtUSD(confirmItem.netPnl)}). Confirm only if you intentionally want to halve this strategy&apos;s risk limits.
                      </span>
                    </div>
                  )}

                  {!isDemote && (activePlan.maxRiskClampedByCap || activePlan.riskClampedByCap) && (
                    <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2 flex items-start gap-2 text-[11px] text-dim leading-snug">
                      <AlertTriangle size={14} className="text-amber shrink-0 mt-0.5" />
                      <span>
                        Doubled value exceeded maximum bounds and was clamped cleanly to {formatRiskPct(activePlan.nextRiskPerTrade)} / {formatRiskPct(activePlan.nextMaxTotalRisk)} (100% max).
                      </span>
                    </div>
                  )}

                  {isDemote && (activePlan.maxRiskClampedByMin || activePlan.riskClampedByMin) && (
                    <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2 flex items-start gap-2 text-[11px] text-dim leading-snug">
                      <AlertTriangle size={14} className="text-amber shrink-0 mt-0.5" />
                      <span>
                        Halved value reached minimum bounds and was clamped cleanly to {formatRiskPct(activePlan.nextRiskPerTrade)} / {formatRiskPct(activePlan.nextMaxTotalRisk)} (0.01% / 0.1% min).
                      </span>
                    </div>
                  )}

                  {!isDemote && activePlan.hardCapWarning && (
                    <div className="rounded-xl border border-amber/35 bg-amber/8 px-3 py-2 flex items-start gap-2 text-[11px] text-amber leading-snug">
                      <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                      <span>
                        Risk Hardening is enabled with a {formatRiskPct(activePlan.maxSingleTradeRiskPct)} single-trade ceiling; new risk per trade ({formatRiskPct(activePlan.nextRiskPerTrade)}) exceeds that hardening cap.
                      </span>
                    </div>
                  )}

                  {!isDemote && isLiveTarget && (
                    <div className="rounded-xl border border-red/35 bg-red/8 px-3 py-2 flex items-start gap-2 text-[11px] text-red leading-snug">
                      <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                      <span>
                        Live mode capital risk will increase immediately upon confirmation.
                      </span>
                    </div>
                  )}

                  {/* Apply Targets */}
                  <div className="flex flex-col gap-2 pt-0.5">
                    {isActive ? (
                      <div className="flex flex-col gap-1.5">
                        <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border/60 bg-background/45 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={updateActiveOpt}
                            onChange={(e) => setUpdateActiveOpt(e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded border-border accent-accent cursor-pointer shrink-0"
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-semibold text-text">
                              Update active {locationFlags.isActiveBase ? 'Base Strategy' : `Variant #${locationFlags.variantIndex + 1}`}
                            </span>
                            <span className="text-[11px] text-dim">
                              {sessionActive
                                ? 'Hot-reloads running session limits immediately'
                                : 'Saves updated risk limits to active draft'}
                            </span>
                          </div>
                        </label>

                        {isDemote && updateActiveOpt && (
                          <label className="flex items-start gap-2.5 p-2.5 pl-4 rounded-xl border border-amber/30 bg-amber/[0.04] cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={pauseStrategyOpt}
                              onChange={(e) => setPauseStrategyOpt(e.target.checked)}
                              className="mt-0.5 w-4 h-4 rounded border-border accent-amber cursor-pointer shrink-0"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-semibold text-text">
                                Also pause strategy in active config
                              </span>
                              <span className="text-[11px] text-dim">
                                Halts new entries for &quot;{confirmItem.strategyLabel}&quot; while keeping existing exits managed
                              </span>
                            </div>
                          </label>
                        )}
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-xl border border-border/60 bg-background/45 flex flex-col gap-2">
                        <label className={cn(
                          'flex items-start gap-2.5 select-none',
                          canActivateWhileIdleOrMatching ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                        )}>
                          <input
                            type="checkbox"
                            disabled={!canActivateWhileIdleOrMatching}
                            checked={activateInactiveOpt}
                            onChange={(e) => setActivateInactiveOpt(e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded border-border accent-accent cursor-pointer shrink-0"
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-semibold text-text">
                              Also activate in {sessionActive ? 'running session' : 'active configuration'}
                            </span>
                            <span className="text-[11px] text-dim">
                              {canActivateWhileIdleOrMatching
                                ? 'Not currently loaded as base or variant'
                                : `Running session is in ${String(locationFlags?.activeConfigMode || '').toUpperCase()} mode`}
                            </span>
                          </div>
                        </label>
                        {activateInactiveOpt && canActivateWhileIdleOrMatching && (
                          <div className="grid grid-cols-2 gap-1.5 pl-6">
                            <button
                              type="button"
                              onClick={() => setActivationMode('variant')}
                              className={cn(
                                'min-h-[34px] px-2.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                                activationMode === 'variant'
                                  ? 'bg-violet-500/15 border-violet-500/45 text-violet-200'
                                  : 'bg-background/60 border-border/60 text-dim hover:text-text'
                              )}
                            >
                              Add as Variant
                            </button>
                            <button
                              type="button"
                              onClick={() => setActivationMode('base')}
                              className={cn(
                                'min-h-[34px] px-2.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer',
                                activationMode === 'base'
                                  ? 'bg-accent/15 border-accent/45 text-accent'
                                  : 'bg-background/60 border-border/60 text-dim hover:text-text'
                              )}
                            >
                              Load as Base
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border/60 bg-background/45 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={savePresetOpt}
                        onChange={(e) => setSavePresetOpt(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-border accent-accent cursor-pointer shrink-0"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-text">
                          {locationFlags?.hasPreset
                            ? `Update preset "${locationFlags.matchedPreset.name}"`
                            : `Save as preset "${confirmItem.strategyLabel}"`}
                        </span>
                        <span className="text-[11px] text-dim">
                          {isDemote
                            ? 'Persists halved 0.5× risk limits in Presets Library'
                            : 'Persists doubled 2× risk limits in Presets Library'}
                        </span>
                      </div>
                    </label>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
                    <Dialog.Close asChild disabled={submitting}>
                      <Btn
                        type="button"
                        variant="ghost"
                        disabled={submitting}
                        className="flex-1 min-h-[42px] sm:min-h-[36px] text-xs"
                      >
                        Cancel
                      </Btn>
                    </Dialog.Close>
                    <Btn
                      type="button"
                      variant="primary"
                      loading={submitting}
                      disabled={submitting || nothingSelected}
                      onClick={handleConfirmSubmit}
                      className={cn(
                        'flex-1 min-h-[42px] sm:min-h-[36px] text-xs font-semibold',
                        isDemote ? 'bg-amber text-black hover:bg-amber/90' : 'bg-accent text-white'
                      )}
                    >
                      <Check size={14} />
                      <span>{isDemote ? 'Apply 0.5× Risk' : 'Apply 2× Risk'}</span>
                    </Btn>
                  </div>
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    );
  };

  // Empty 7D state: quiet single-line summary bar
  if (strategies.length === 0) {
    return (
      <div
        data-testid="past-week-promotion-panel"
        className={cn(
          'rounded-2xl border border-border/45 bg-surface/35 px-3 py-2.5 flex items-center justify-between gap-2 text-xs',
          className
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp size={14} className="text-dim shrink-0" />
          <span className="font-semibold text-text truncate">Past 7 Days Risk Review</span>
          <span aria-hidden="true" className="text-dim/40">·</span>
          <span className="text-[11px] text-dim truncate">
            No closed {modeLabel.toLowerCase()} trades in the last 7 days
          </span>
        </div>
        {renderConfirmDialog()}
      </div>
    );
  }

  // Collapsed headline candidate: #1 winner if any exist, otherwise deepest drag for immediate demotion
  const featuredItem = (topStrategy && !topStrategy.qualifiesForPromotion && worstUnderperformer)
    ? worstUnderperformer
    : topStrategy;
  const featuredIsDemote = Boolean(featuredItem?.qualifiesForDemotion && !featuredItem?.qualifiesForPromotion);
  const featuredPlan = featuredIsDemote ? featuredItem?.demoteRiskPlan : featuredItem?.riskPlan;
  const featuredAtBound = featuredIsDemote ? featuredPlan?.isAtMinCap : featuredPlan?.isAtMaxCap;

  return (
    <section
      data-testid="past-week-promotion-panel"
      aria-label="Past 7 Days Strategy Promotion and Demotion"
      className={cn(
        'rounded-2xl border border-border/55 bg-surface/45 transition-colors overflow-hidden',
        className
      )}
    >
      {/* Compact Header & Featured Leader/Drag Inline Summary */}
      <div className={cn('px-3 flex flex-col gap-2', compact ? 'py-2' : 'py-2.5 sm:px-4 sm:py-3')}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {featuredIsDemote
              ? <TrendingDown size={15} className="text-amber shrink-0" />
              : <TrendingUp size={15} className="text-green shrink-0" />}
            <div className="min-w-0 flex-1 flex flex-col">
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <span className="font-bold text-text tracking-tight">Past 7 Days Risk Review</span>
                <span aria-hidden="true" className="text-dim/40">·</span>
                <span className="font-mono text-[11px] text-dim tabular-nums">
                  {modeLabel} · {summary.profitableCount} up · {summary.underperformingCount} down
                </span>
              </div>

              {!isExpanded && featuredItem && featuredPlan && (
                <div className="text-[11px] font-mono tabular-nums text-dim flex items-center gap-x-1.5 gap-y-0.5 flex-wrap mt-0.5">
                  <span className="text-text font-semibold truncate max-w-[180px] sm:max-w-[260px]">
                    #{featuredItem.rank} {featuredItem.strategyLabel}
                  </span>
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <span className={cn('font-bold', pnlClass(featuredItem.netPnl))}>
                    {featuredItem.netPnl > 0 ? `+${fmtUSD(featuredItem.netPnl)}` : fmtUSD(featuredItem.netPnl)}
                  </span>
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <span>{featuredItem.winRate.toFixed(0)}% WR</span>
                  <span aria-hidden="true" className="opacity-40 hidden xs:inline">·</span>
                  <span className="hidden xs:inline">{featuredItem.profitFactor.toFixed(2)} PF</span>
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <span className={cn('font-semibold', featuredIsDemote ? 'text-amber' : 'text-accent')}>
                    {formatRiskPct(featuredPlan.currentRiskPerTrade)}→{formatRiskPct(featuredPlan.nextRiskPerTrade)}
                  </span>
                  <span className="text-dim/75">
                    ({formatRiskPct(featuredPlan.currentMaxTotalRisk)}→{formatRiskPct(featuredPlan.nextMaxTotalRisk)} cap)
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
            {!isExpanded && featuredItem && (
              <button
                type="button"
                data-testid={featuredIsDemote ? 'demote-featured-strategy-btn' : 'promote-top-strategy-btn'}
                disabled={featuredAtBound || isBusy}
                onClick={() => openConfirmModal(featuredItem, featuredIsDemote ? 'demote' : 'promote')}
                className={cn(
                  'min-h-[38px] sm:min-h-[32px] px-3 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                  featuredAtBound
                    ? 'bg-background/40 border-border/50 text-dim cursor-not-allowed'
                    : featuredIsDemote
                      ? 'bg-amber/15 border-amber/40 text-amber hover:bg-amber/25'
                      : featuredItem.qualifiesForPromotion
                        ? 'bg-green/15 border-green/40 text-green hover:bg-green/25'
                        : 'bg-background/70 border-border/70 text-text hover:border-accent/45 hover:text-accent'
                )}
              >
                <span>
                  {promotingLabel === featuredItem.strategyLabel
                    ? (featuredIsDemote ? 'Demoting...' : 'Promoting...')
                    : featuredAtBound
                      ? (featuredIsDemote ? 'At Min Floor' : 'At 100% Cap')
                      : (featuredIsDemote ? 'Demote 0.5×' : 'Promote 2×')}
                </span>
              </button>
            )}

            {!isExpanded && worstUnderperformer && topStrategy?.qualifiesForPromotion && worstUnderperformer.strategyLabel !== featuredItem?.strategyLabel && (
              <button
                type="button"
                data-testid="demote-drag-strategy-btn"
                disabled={worstUnderperformer.demoteRiskPlan.isAtMinCap || isBusy}
                onClick={() => openConfirmModal(worstUnderperformer, 'demote')}
                title={`Halve risk for #${worstUnderperformer.rank} ${worstUnderperformer.strategyLabel} (${fmtUSD(worstUnderperformer.netPnl)})`}
                className={cn(
                  'min-h-[38px] sm:min-h-[32px] px-2.5 rounded-xl text-xs font-semibold border transition-colors hidden md:flex items-center gap-1 whitespace-nowrap cursor-pointer focus-visible:ring-2 focus-visible:ring-amber focus-visible:outline-none',
                  worstUnderperformer.demoteRiskPlan.isAtMinCap
                    ? 'bg-background/40 border-border/50 text-dim cursor-not-allowed'
                    : 'bg-amber/10 border-amber/35 text-amber hover:bg-amber/20'
                )}
              >
                <span>Demote 0.5×</span>
              </button>
            )}

            <button
              type="button"
              data-testid="toggle-past-week-promotion"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((prev) => !prev)}
              className={cn(
                'min-h-[38px] sm:min-h-[32px] px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                isExpanded
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-background/60 border-border/60 text-dim hover:text-text hover:border-border'
              )}
            >
              <span>{isExpanded ? 'Hide' : `All (${strategies.length})`}</span>
              <ChevronDown
                size={13}
                className={cn('transition-transform duration-200', isExpanded && 'rotate-180')}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Ranked Strategy Cards */}
      <SmoothCollapse isOpen={isExpanded}>
        <div className="px-3 pb-3 sm:px-4 sm:pb-3.5 pt-2 border-t border-border/35 flex flex-col gap-2 bg-background/20">
          {summary.profitableCount > 0 && summary.underperformingCount > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'all', label: `All (${strategies.length})` },
                { id: 'winners', label: `Winners (${summary.profitableCount})` },
                { id: 'underperformers', label: `Underperformers (${summary.underperformingCount})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setReviewFilter(tab.id)}
                  aria-pressed={reviewFilter === tab.id}
                  className={cn(
                    'relative overflow-hidden min-h-[32px] sm:min-h-[26px] px-2.5 rounded-lg text-[11px] font-semibold border transition-colors duration-200 ease-[var(--ease-out-expo)] cursor-pointer',
                    reviewFilter === tab.id
                      ? 'border-accent/40 text-accent'
                      : 'bg-background/50 border-border/50 text-dim hover:text-text'
                  )}
                >
                  {reviewFilter === tab.id && (
                    <MotionSegmentedPill
                      layoutId="past-week-review-filter"
                      className="rounded-lg bg-accent/15 z-0"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filteredStrategies.map((item) => {
              const role = getRoleDescriptor(item);
              const primaryIsDemote = item.qualifiesForDemotion;
              const primaryPlan = primaryIsDemote ? item.demoteRiskPlan : item.riskPlan;
              const secondaryPlan = primaryIsDemote ? item.riskPlan : item.demoteRiskPlan;
              const isScalingThis = promotingLabel === item.strategyLabel;
              const primaryAtBound = primaryIsDemote ? primaryPlan.isAtMinCap : primaryPlan.isAtMaxCap;
              const secondaryAtBound = primaryIsDemote ? secondaryPlan.isAtMaxCap : secondaryPlan.isAtMinCap;

              return (
                <div
                  key={item.strategyLabel}
                  data-testid={`promotion-strategy-card-${item.rank}`}
                  className={cn(
                    'rounded-xl border p-2.5 sm:p-3 flex flex-col gap-2 transition-colors',
                    item.qualifiesForPromotion && item.rank === 1
                      ? 'border-green/35 bg-green/[0.03]'
                      : item.qualifiesForDemotion
                        ? 'border-amber/30 bg-amber/[0.025]'
                        : 'border-border/55 bg-surface/65'
                  )}
                >
                  {/* Top Row: Rank + Strategy Label + Net P&L */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 text-[10.5px] leading-none flex-wrap">
                        <span className="font-mono font-bold text-dim tabular-nums">#{item.rank}</span>
                        <span aria-hidden="true" className="text-dim/40">·</span>
                        <span className={role.cls}>{role.label}</span>
                        <span aria-hidden="true" className="text-dim/40">·</span>
                        <span className="font-mono text-dim tabular-nums">
                          {item.slDesc.compactText} · {item.tpDesc.compactText}
                        </span>
                      </div>
                      <div className="text-xs sm:text-sm font-bold text-text truncate tracking-tight">
                        {item.strategyLabel}
                      </div>
                    </div>

                    <div className="flex flex-col items-end shrink-0 text-right font-mono tabular-nums">
                      <span className={cn('text-xs sm:text-sm font-bold leading-tight', pnlClass(item.netPnl))}>
                        {item.netPnl > 0 ? `+${fmtUSD(item.netPnl)}` : fmtUSD(item.netPnl)}
                      </span>
                      <span className="text-[10px] text-dim">
                        {item.tradesCount} {item.tradesCount === 1 ? 'trade' : 'trades'}
                      </span>
                    </div>
                  </div>

                  {/* Metrics + Scaled Risk Preview Row */}
                  <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-border/30 text-[11px] font-mono tabular-nums">
                    <div className="flex flex-col min-w-0">
                      <span className="text-[9.5px] font-sans text-dim leading-none mb-0.5">Win / PF</span>
                      <span className="text-text font-semibold truncate">
                        {item.winRate.toFixed(0)}% · {item.profitFactor.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[9.5px] font-sans text-dim leading-none mb-0.5">Risk / Trade</span>
                      <span className="font-semibold truncate flex items-center gap-1">
                        <span className="text-dim">{formatRiskPct(primaryPlan.currentRiskPerTrade)}</span>
                        <span className="text-dim/50">→</span>
                        <span className={primaryIsDemote ? 'text-amber' : 'text-accent'}>
                          {formatRiskPct(primaryPlan.nextRiskPerTrade)}
                        </span>
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0 text-right">
                      <span className="text-[9.5px] font-sans text-dim leading-none mb-0.5">Max Strategy</span>
                      <span className="font-semibold truncate">
                        <span className="text-dim">{formatRiskPct(primaryPlan.currentMaxTotalRisk)}</span>
                        <span className="text-dim/50"> → </span>
                        <span className={primaryIsDemote ? 'text-amber' : 'text-green'}>
                          {formatRiskPct(primaryPlan.nextMaxTotalRisk)}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Action Footer */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30">
                    <span className="text-[10.5px] text-dim truncate">
                      {item.avgR !== null ? (
                        <span className="font-mono tabular-nums">
                          Avg {item.avgR >= 0 ? '+' : ''}{item.avgR.toFixed(2)}R
                        </span>
                      ) : (
                        <span>7D window</span>
                      )}
                      {!primaryIsDemote && primaryPlan.hardCapWarning && ' · Exceeds hardening cap'}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        data-testid={primaryIsDemote ? `promote-card-btn-${item.rank}` : `demote-card-btn-${item.rank}`}
                        disabled={secondaryAtBound || isBusy}
                        onClick={() => openConfirmModal(item, primaryIsDemote ? 'promote' : 'demote')}
                        title={primaryIsDemote ? 'Promote (2× Risk)' : 'Demote (0.5× Risk)'}
                        className={cn(
                          'min-h-[38px] sm:min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                          secondaryAtBound
                            ? 'bg-background/30 border-border/40 text-dim/50 cursor-not-allowed'
                            : primaryIsDemote
                              ? 'bg-background/60 border-border/60 text-dim hover:text-green hover:border-green/40'
                              : 'bg-background/60 border-border/60 text-dim hover:text-amber hover:border-amber/40'
                        )}
                      >
                        {primaryIsDemote ? '2×' : '0.5×'}
                      </button>

                      <button
                        type="button"
                        data-testid={primaryIsDemote ? `demote-card-btn-${item.rank}` : `promote-card-btn-${item.rank}`}
                        disabled={primaryAtBound || isBusy}
                        onClick={() => openConfirmModal(item, primaryIsDemote ? 'demote' : 'promote')}
                        className={cn(
                          'min-h-[38px] sm:min-h-[32px] px-3 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                          primaryAtBound
                            ? 'bg-background/40 border-border/50 text-dim cursor-not-allowed'
                            : primaryIsDemote
                              ? 'bg-amber/15 border-amber/40 text-amber hover:bg-amber/25'
                              : item.qualifiesForPromotion
                                ? 'bg-green/15 border-green/40 text-green hover:bg-green/25'
                                : 'bg-background/70 border-border/70 text-text hover:border-accent/45 hover:text-accent'
                        )}
                      >
                        {!primaryAtBound && <Layers size={12} className="shrink-0" />}
                        <span>
                          {isScalingThis
                            ? (primaryIsDemote ? 'Demoting...' : 'Promoting...')
                            : primaryAtBound
                              ? (primaryIsDemote ? 'At Min Floor' : 'At 100% Cap')
                              : (primaryIsDemote ? 'Demote 0.5× Risk' : 'Promote 2× Risk')}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SmoothCollapse>

      {renderConfirmDialog()}
    </section>
  );
};
