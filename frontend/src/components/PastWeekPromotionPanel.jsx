import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  ChevronDown,
  ArrowRight,
  AlertTriangle,
  ShieldAlert,
  X,
  Layers,
  Check,
} from 'lucide-react';
import { cn, Btn } from './ui/primitives';
import { SmoothCollapse } from './ui/SmoothMotion';
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
  const [confirmItem, setConfirmItem] = useState(null);
  const [updateActiveOpt, setUpdateActiveOpt] = useState(true);
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

  // Sync sensible confirmation defaults whenever a strategy is opened for promotion
  useEffect(() => {
    if (!confirmItem) return;
    const isActive = Boolean(confirmItem.locationFlags?.isActive);
    setUpdateActiveOpt(isActive);
    setActivateInactiveOpt(false);
    setActivationMode('variant');
    setSavePresetOpt(true);
  }, [confirmItem]);

  const topStrategy = strategies[0] || null;
  const isBusy = Boolean(submitting || promotingLabel);

  const openConfirmModal = (item) => {
    if (!item || isBusy) return;
    setConfirmItem(item);
  };

  const handleConfirmSubmit = async () => {
    if (!confirmItem || !onPromoteStrategy || isBusy) return;
    const isActive = Boolean(confirmItem.locationFlags?.isActive);
    const shouldUpdateActive = isActive ? updateActiveOpt : activateInactiveOpt;
    if (!shouldUpdateActive && !savePresetOpt) return;

    setSubmitting(true);
    try {
      const ok = await onPromoteStrategy(confirmItem, {
        updateActive: shouldUpdateActive,
        activateIfInactive: !isActive && activateInactiveOpt,
        activationMode,
        savePreset: savePresetOpt,
      });
      if (ok !== false) {
        setConfirmItem(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderConfirmDialog = () => {
    if (!confirmItem) return null;
    const { riskPlan, locationFlags } = confirmItem;
    const isActive = Boolean(locationFlags?.isActive);
    const matchesActiveMode = Boolean(locationFlags?.matchesActiveMode);
    const canActivateWhileIdleOrMatching = !sessionActive || matchesActiveMode;
    const willTouchActive = isActive ? updateActiveOpt : activateInactiveOpt;
    const nothingSelected = !willTouchActive && !savePresetOpt;
    const isLiveTarget = locationFlags?.targetMode === 'live' || locationFlags?.activeConfigMode === 'live';

    return (
      <Dialog.Root
        open={Boolean(confirmItem)}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmItem(null);
        }}
      >
        <AnimatePresence>
          {confirmItem && (
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
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-surface border border-border rounded-t-3xl rounded-b-none md:rounded-2xl p-4 sm:p-5 shadow-2xl overflow-y-auto max-h-[88vh] flex flex-col gap-3.5"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Dialog.Title className="text-sm sm:text-base font-bold tracking-tight text-text truncate">
                        Promote "{confirmItem.strategyLabel}"
                      </Dialog.Title>
                      <Dialog.Description className="text-[11px] text-dim mt-0.5 leading-snug">
                        Double risk per trade and strategy risk allocation based on past 7-day results ({modeLabel}).
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild disabled={submitting}>
                      <button
                        type="button"
                        disabled={submitting}
                        aria-label="Close promotion confirmation"
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
                        <span className="text-dim">{formatRiskPct(riskPlan.currentRiskPerTrade)}</span>
                        <ArrowRight size={12} className="text-accent shrink-0" />
                        <span className="text-accent">{formatRiskPct(riskPlan.nextRiskPerTrade)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-border/35">
                      <span className="text-dim font-medium">Max Strategy Risk</span>
                      <div className="flex items-center gap-1.5 font-mono tabular-nums font-bold">
                        <span className="text-dim">{formatRiskPct(riskPlan.currentMaxTotalRisk)}</span>
                        <ArrowRight size={12} className="text-green shrink-0" />
                        <span className="text-green">{formatRiskPct(riskPlan.nextMaxTotalRisk)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] pt-2 border-t border-border/35 text-dim">
                      <span>Concurrent Full-Risk Slots</span>
                      <span className="font-mono tabular-nums text-text">
                        {riskPlan.currentConcurrentSlots} → {riskPlan.nextConcurrentSlots}
                      </span>
                    </div>
                  </div>

                  {/* Safety / Cap Notices */}
                  {!confirmItem.qualifiesForPromotion && (
                    <div className="rounded-xl border border-amber/35 bg-amber/8 px-3 py-2 flex items-start gap-2 text-[11px] text-amber leading-snug">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span>
                        Past 7-day net P&amp;L is not positive ({fmtUSD(confirmItem.netPnl)}). Confirm only if you intentionally want to double this strategy&apos;s risk limits.
                      </span>
                    </div>
                  )}

                  {(riskPlan.maxRiskClampedByCap || riskPlan.riskClampedByCap) && (
                    <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2 flex items-start gap-2 text-[11px] text-dim leading-snug">
                      <AlertTriangle size={14} className="text-amber shrink-0 mt-0.5" />
                      <span>
                        Doubled value exceeded maximum bounds and was clamped cleanly to {formatRiskPct(riskPlan.nextRiskPerTrade)} / {formatRiskPct(riskPlan.nextMaxTotalRisk)} (100% max).
                      </span>
                    </div>
                  )}

                  {riskPlan.hardCapWarning && (
                    <div className="rounded-xl border border-amber/35 bg-amber/8 px-3 py-2 flex items-start gap-2 text-[11px] text-amber leading-snug">
                      <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                      <span>
                        Risk Hardening is enabled with a {formatRiskPct(riskPlan.maxSingleTradeRiskPct)} single-trade ceiling; new risk per trade ({formatRiskPct(riskPlan.nextRiskPerTrade)}) exceeds that hardening cap.
                      </span>
                    </div>
                  )}

                  {isLiveTarget && (
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
                          Persists doubled 2× risk limits in Presets Library
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
                      className="flex-1 min-h-[42px] sm:min-h-[36px] text-xs bg-accent text-white font-semibold"
                    >
                      <Check size={14} />
                      <span>Apply 2× Risk</span>
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

  // Empty 7D state: super quiet single-line summary bar
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
          <span className="font-semibold text-text truncate">Past 7 Days Promotion</span>
          <span aria-hidden="true" className="text-dim/40">·</span>
          <span className="text-[11px] text-dim truncate">
            No closed {modeLabel.toLowerCase()} trades in the last 7 days
          </span>
        </div>
        {renderConfirmDialog()}
      </div>
    );
  }

  return (
    <section
      data-testid="past-week-promotion-panel"
      aria-label="Past 7 Days Strategy Promotion"
      className={cn(
        'rounded-2xl border border-border/55 bg-surface/45 transition-colors overflow-hidden',
        className
      )}
    >
      {/* Compact Header & #1 Leader Inline Summary */}
      <div className={cn('px-3 flex flex-col gap-2', compact ? 'py-2' : 'py-2.5 sm:px-4 sm:py-3')}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <TrendingUp size={15} className="text-green shrink-0" />
            <div className="min-w-0 flex-1 flex flex-col">
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <span className="font-bold text-text tracking-tight">Past 7 Days Promotion</span>
                <span aria-hidden="true" className="text-dim/40">·</span>
                <span className="font-mono text-[11px] text-dim tabular-nums">
                  {modeLabel} · {summary.profitableCount}/{summary.totalStrategies} profitable
                </span>
              </div>

              {!isExpanded && topStrategy && (
                <div className="text-[11px] font-mono tabular-nums text-dim flex items-center gap-x-1.5 gap-y-0.5 flex-wrap mt-0.5">
                  <span className="text-text font-semibold truncate max-w-[180px] sm:max-w-[260px]">
                    #1 {topStrategy.strategyLabel}
                  </span>
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <span className={cn('font-bold', pnlClass(topStrategy.netPnl))}>
                    {topStrategy.netPnl > 0 ? `+${fmtUSD(topStrategy.netPnl)}` : fmtUSD(topStrategy.netPnl)}
                  </span>
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <span>{topStrategy.winRate.toFixed(0)}% WR</span>
                  <span aria-hidden="true" className="opacity-40 hidden xs:inline">·</span>
                  <span className="hidden xs:inline">{topStrategy.profitFactor.toFixed(2)} PF</span>
                  <span aria-hidden="true" className="opacity-40">·</span>
                  <span className="text-accent font-semibold">
                    {formatRiskPct(topStrategy.riskPlan.currentRiskPerTrade)}→{formatRiskPct(topStrategy.riskPlan.nextRiskPerTrade)}
                  </span>
                  <span className="text-dim/75">
                    ({formatRiskPct(topStrategy.riskPlan.currentMaxTotalRisk)}→{formatRiskPct(topStrategy.riskPlan.nextMaxTotalRisk)} cap)
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
            {!isExpanded && topStrategy && (
              <button
                type="button"
                data-testid="promote-top-strategy-btn"
                disabled={topStrategy.riskPlan.isAtMaxCap || isBusy}
                onClick={() => openConfirmModal(topStrategy)}
                className={cn(
                  'min-h-[38px] sm:min-h-[32px] px-3 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                  topStrategy.riskPlan.isAtMaxCap
                    ? 'bg-background/40 border-border/50 text-dim cursor-not-allowed'
                    : topStrategy.qualifiesForPromotion
                      ? 'bg-green/15 border-green/40 text-green hover:bg-green/25'
                      : 'bg-background/70 border-border/70 text-text hover:border-accent/45 hover:text-accent'
                )}
              >
                <span>
                  {promotingLabel === topStrategy.strategyLabel
                    ? 'Promoting...'
                    : topStrategy.riskPlan.isAtMaxCap
                      ? 'At 100% Cap'
                      : 'Promote 2×'}
                </span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {strategies.map((item) => {
              const role = getRoleDescriptor(item);
              const { riskPlan } = item;
              const isPromotingThis = promotingLabel === item.strategyLabel;

              return (
                <div
                  key={item.strategyLabel}
                  data-testid={`promotion-strategy-card-${item.rank}`}
                  className={cn(
                    'rounded-xl border p-2.5 sm:p-3 flex flex-col gap-2 transition-colors',
                    item.qualifiesForPromotion && item.rank === 1
                      ? 'border-green/35 bg-green/[0.03]'
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

                  {/* Metrics + 2x Risk Preview Row */}
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
                        <span className="text-dim">{formatRiskPct(riskPlan.currentRiskPerTrade)}</span>
                        <span className="text-dim/50">→</span>
                        <span className="text-accent">{formatRiskPct(riskPlan.nextRiskPerTrade)}</span>
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0 text-right">
                      <span className="text-[9.5px] font-sans text-dim leading-none mb-0.5">Max Strategy</span>
                      <span className="font-semibold truncate">
                        <span className="text-dim">{formatRiskPct(riskPlan.currentMaxTotalRisk)}</span>
                        <span className="text-dim/50"> → </span>
                        <span className="text-green">{formatRiskPct(riskPlan.nextMaxTotalRisk)}</span>
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
                      {riskPlan.hardCapWarning && ' · Exceeds hardening cap'}
                    </span>

                    <button
                      type="button"
                      disabled={riskPlan.isAtMaxCap || isBusy}
                      onClick={() => openConfirmModal(item)}
                      className={cn(
                        'min-h-[38px] sm:min-h-[32px] px-3 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                        riskPlan.isAtMaxCap
                          ? 'bg-background/40 border-border/50 text-dim cursor-not-allowed'
                          : item.qualifiesForPromotion
                            ? 'bg-green/15 border-green/40 text-green hover:bg-green/25'
                            : 'bg-background/70 border-border/70 text-text hover:border-accent/45 hover:text-accent'
                      )}
                    >
                      {!riskPlan.isAtMaxCap && <Layers size={12} className="shrink-0" />}
                      <span>
                        {isPromotingThis
                          ? 'Promoting...'
                          : riskPlan.isAtMaxCap
                            ? 'At 100% Cap'
                            : 'Promote 2× Risk'}
                      </span>
                    </button>
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
