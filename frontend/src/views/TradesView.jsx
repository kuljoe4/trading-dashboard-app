import React, { useState, useEffect, useRef, lazy, Suspense, useMemo } from 'react'
import { shallow } from 'zustand/shallow'
import { useTradingStore } from '../store/trading'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { SectionLabel, StatCard, cn, ViewHeader, Btn, Tooltip } from '../components/ui/primitives'
import { SmoothCollapse, MotionSegmentedPill, MOTION_EASE } from '../components/ui/SmoothMotion'
import { ActiveTradesSkeleton, ModalDrawerSkeleton } from '../components/ui/Skeletons'
import { fmtUSD, pnlColor, pnlClass, safeNum } from '../lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Briefcase, Zap } from 'lucide-react'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { sessionAPI } from '../api/client'
import { lazyWithRetry } from '../lib/lazy'
import { formatStopLossDescriptor, formatTakeProfitDescriptor } from '../utils/strategySummary.js'

const TradeDetailModal = lazyWithRetry(() => import('../components/TradeDetailModal').then(m => ({ default: m.TradeDetailModal })))
const preloadTradeDetailModal = () => {
  import('../components/TradeDetailModal');
};

import { Filter, SlidersHorizontal, ChevronDown, RotateCcw } from 'lucide-react'

const TradesView = () => {
  const { activeTrades, totalPnl, activePnl: storeActivePnl, lastKnownPnl, totalRiskPct, totalSlUsed, config, healthEnabled, isThrottled, wsStatus, isSyncingOnResume, initialStatusLoaded, lastAuthoritativeUpdateTs, sessionActive, totalEstPnlToRealize } = useTradingStore(state => ({
    activeTrades: state.activeTrades,
    totalPnl: state.totalPnl,
    activePnl: state.activePnl,
    lastKnownPnl: state.lastKnownPnl,
    totalRiskPct: state.totalRiskPct,
    totalSlUsed: state.totalSlUsed,
    config: state.config,
    healthEnabled: state.healthEnabled,
    isThrottled: state.isThrottled,
    wsStatus: state.wsStatus,
    isSyncingOnResume: state.isSyncingOnResume,
    initialStatusLoaded: state.initialStatusLoaded,
    lastAuthoritativeUpdateTs: state.lastAuthoritativeUpdateTs,
    sessionActive: state.sessionActive,
    totalEstPnlToRealize: state.totalEstPnlToRealize,
  }), shallow)
  const [selectedTradeId, setSelectedTradeId] = useState(null)

  useEffect(() => {
    if (activeTrades && activeTrades.length > 0) {
      preloadTradeDetailModal();
    }
  }, [activeTrades?.length]);

  // Persisted filter settings
  const [strategyFilter, setStrategyFilter] = useState(() => {
    return localStorage.getItem('trades_filter_strategy') || 'ALL';
  });
  const [directionFilter, setDirectionFilter] = useState(() => {
    return localStorage.getItem('trades_filter_direction') || 'ALL';
  });
  const [riskFilter, setRiskFilter] = useState(() => {
    return localStorage.getItem('trades_filter_risk') || 'ALL';
  });
  const [filtersExpanded, setFiltersExpanded] = useState(() => {
    return localStorage.getItem('trades_filters_expanded') === 'true';
  });

  const handleStrategyFilterChange = (val) => {
    setStrategyFilter(val);
    localStorage.setItem('trades_filter_strategy', val);
  };

  const handleDirectionFilterChange = (val) => {
    setDirectionFilter(val);
    localStorage.setItem('trades_filter_direction', val);
  };

  const handleRiskFilterChange = (val) => {
    setRiskFilter(val);
    localStorage.setItem('trades_filter_risk', val);
  };

  const handleToggleFilters = () => {
    setFiltersExpanded(prev => {
      const next = !prev;
      localStorage.setItem('trades_filters_expanded', String(next));
      return next;
    });
  };

  const resetAllFilters = () => {
    handleStrategyFilterChange('ALL');
    handleDirectionFilterChange('ALL');
    handleRiskFilterChange('ALL');
  };

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = sessionActive && isResuming
  const coldUnhydrated = !initialStatusLoaded && !lastAuthoritativeUpdateTs

  // BOLT OPTIMIZATION: Combine active trade calculations into a single-pass loop-fused useMemo
  const effectiveTotalPnl = (safeNum(totalPnl) === 0 && sessionActive && isResuming && safeNum(lastKnownPnl?.totalPnl) !== 0)
    ? safeNum(lastKnownPnl?.totalPnl)
    : safeNum(totalPnl);

  const effectiveTotalRiskPct = (safeNum(totalRiskPct) === 0 && sessionActive && (isResuming || (activeTrades || []).length > 0) && safeNum(lastKnownPnl?.totalRiskPct) > 0)
    ? safeNum(lastKnownPnl?.totalRiskPct)
    : safeNum(totalRiskPct);

  const { activePnl, activeEstPnl, trueProjectedPnl, peakRr } = useMemo(() => {
    const trades = activeTrades || [];
    let pnl = 0;
    let estPnl = 0;
    let maxRr = 0;
    const len = trades.length;
    for (let i = 0; i < len; i++) {
      const t = trades[i];
      pnl += safeNum(t.pnl);
      estPnl += safeNum(t.est_pnl_to_realize);
      maxRr = Math.max(maxRr, Number(t.max_rr ?? t.max_rr_achieved ?? 0));
    }
    const cachedActive = safeNum(storeActivePnl) || safeNum(lastKnownPnl?.activePnl);
    if (pnl === 0 && sessionActive && (isResuming || len > 0) && cachedActive !== 0) {
      pnl = cachedActive;
    }
    if (estPnl === 0 && sessionActive && (isResuming || len > 0) && safeNum(totalEstPnlToRealize || lastKnownPnl?.totalEstPnlToRealize) !== 0) {
      estPnl = safeNum(totalEstPnlToRealize || lastKnownPnl?.totalEstPnlToRealize);
    }
    if (maxRr === 0 && sessionActive && (isResuming || len > 0) && safeNum(lastKnownPnl?.maxRr) > 0) {
      maxRr = safeNum(lastKnownPnl?.maxRr);
    }
    const projected = (effectiveTotalPnl - pnl) + estPnl;
    return {
      activePnl: pnl,
      activeEstPnl: estPnl,
      trueProjectedPnl: projected,
      peakRr: maxRr
    };
  }, [activeTrades, effectiveTotalPnl, sessionActive, isResuming, storeActivePnl, lastKnownPnl, totalEstPnlToRealize]);

  const selectedTrade = (activeTrades || []).find(t => t.id === selectedTradeId || t.symbol === selectedTradeId)

  // Lifecycle-scoped subscription contract
  useResourceFocus('global_trades');

  const addAlert = useTradingStore(state => state.addAlert);
  const [closingMap, setClosingMap] = useState({})

  const handleCloseTrade = async (symbol) => {
    if (closingMap[symbol]) {
      console.log(`[Trades Engine] Close trade request already in flight for ${symbol}, ignoring.`);
      return;
    }

    setClosingMap(prev => ({ ...prev, [symbol]: true }));
    console.log(`[Trades Engine] Dispatching manual position closure for ${symbol}`);

    try {
      await sessionAPI.closeTrade(symbol)
      setSelectedTradeId(null)
      addAlert({ level: 'success', title: 'Liquidation Started', message: `Manual closure request for ${symbol} sent to exchange.` });
      console.log(`[Trades Engine] Close request successful for ${symbol}`);
    } catch (e) {
      console.error(`[Trades Engine] Close trade failed for ${symbol}:`, e);
      addAlert({ level: 'error', title: 'Closure Failed', message: e?.response?.data?.message || e.message || 'Could not close position.' });
    } finally {
      setClosingMap(prev => {
        const next = { ...prev };
        delete next[symbol];
        return next;
      });
    }
  }

  return (
    <div className={cn(
      "max-w-[1160px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-6 md:pt-6 transition-[padding] duration-300 ease-[var(--ease-glide)]",
      healthEnabled ? "pb-48 sm:pb-48 md:pb-48 lg:pb-16" : "pb-36 sm:pb-36 md:pb-36 lg:pb-16"
    )}>
        <ViewHeader
          icon={Briefcase}
          title="Active Positions"
          subTitle="Live monitoring across all strategies"
          backAction={() => window.location.hash = '#/'}
          hideMetricsNumbers
          mobileOneRow
        />

      <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-fr items-stretch gap-2.5 mb-3">
        <StatCard
          compact
          label="Active P&L"
          value={fmtUSD(activePnl)}
          valueLoading={coldUnhydrated}
          color={pnlClass(activePnl)}
          subValue={`Session: ${fmtUSD(effectiveTotalPnl)} · Est: ${fmtUSD(activeEstPnl)}`}
          subValueLoading={coldUnhydrated}
          tooltipText={`Session Return: ${fmtUSD(effectiveTotalPnl)} | Est. Target: ${fmtUSD(activeEstPnl)} | Projected: ${fmtUSD(trueProjectedPnl)}`}
        />
        <StatCard
          compact
          label="Active Risk"
          value={`${Number(effectiveTotalRiskPct || 0).toFixed(2)}%`}
          valueLoading={coldUnhydrated}
          color={effectiveTotalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"}
          subValue={`Cap: ${config.max_total_risk_pct || 5}% · SL: ${formatStopLossDescriptor(config).compactText}`}
          tooltipText="Combined stop-loss risk across all active trades relative to account balance."
        />
        <StatCard
          compact
          label="Peak RR"
          value={`+${Number(peakRr || 0).toFixed(2)}`}
          valueLoading={coldUnhydrated}
          color="text-accent"
          subValue={`Exit: ${formatTakeProfitDescriptor(config).compactText}`}
          tooltipText="Maximum Reward-to-Risk ratio achieved across currently open positions."
        />
        <StatCard
          compact
          label="Positions"
          value={`${activeTrades.length}/${config.max_open_trades || 5}`}
          valueLoading={coldUnhydrated}
          color="text-accent"
          subValue={`Max: ${config.max_open_trades || 5} Slots · ${activeTrades.length > 0 ? 'Active' : 'Standby'}`}
          tooltipText={`Currently open trade slots: ${activeTrades.length} / ${config.max_open_trades || 5}`}
        />
      </div>

      {/* Extract unique strategy labels from active positions */}
      {(() => {
        const availableStrategies = Array.from(new Set((activeTrades || []).map(t => t.strategy_label || 'Momentum Strategy')));

        const hasActiveFilters = strategyFilter !== 'ALL' || directionFilter !== 'ALL' || riskFilter !== 'ALL';

        const filteredTrades = (activeTrades || []).filter(t => {
          if (strategyFilter !== 'ALL' && (t.strategy_label || 'Momentum Strategy') !== strategyFilter) {
            return false;
          }
          if (directionFilter !== 'ALL' && (t.direction || 'LONG').toUpperCase() !== directionFilter) {
            return false;
          }
          if (riskFilter !== 'ALL') {
            const entry = Number(t.entry_price || 0);
            const sl = Number(t.sl_price || 0);
            const isLong = (t.direction || 'LONG').toUpperCase() === 'LONG';
            const isSlAtBreakeven = sl > 0 && (isLong ? sl >= entry - 1e-6 : sl <= entry + 1e-6);
            const isEstPnlLocked = t.risk_lock_reason === 'EST_PNL_BELOW_THRESHOLD' || (Number(t.risk_usdt) > 0 && Boolean(t.strategy_config?.release_risk_on_est_pnl_be));
            const isRiskReleased = !isEstPnlLocked && (isSlAtBreakeven || (t.risk_usdt === 0 && Number(t.initial_risk_usdt) > 0));
            if (riskFilter === 'PROTECTED' && !isRiskReleased) return false;
            if (riskFilter === 'ACTIVE' && isRiskReleased) return false;
          }
          return true;
        });

        return (
          <div className="flex flex-col gap-3">
            {/* Mobile-First Tactical Filter Bar */}
            <div id="active-trades-filter-toolbar" className="bg-surface border border-border rounded-2xl p-3 sm:p-3.5 shadow-xs flex flex-col gap-2.5 w-full">
              <div className="flex items-center justify-between gap-2 w-full min-h-[40px] sm:min-h-[32px]">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 sm:w-6 sm:h-6 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <Filter size={13} className="text-accent" />
                  </div>
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-xs font-semibold text-text truncate">Tactical Filters</span>
                    {hasActiveFilters && (
                      <span className="text-[11px] font-mono font-semibold text-accent shrink-0 tabular-nums">
                        · {(strategyFilter !== 'ALL' ? 1 : 0) + (directionFilter !== 'ALL' ? 1 : 0) + (riskFilter !== 'ALL' ? 1 : 0)} active
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="min-h-[40px] sm:min-h-[30px] px-2.5 sm:px-3 py-1 rounded-xl text-[11px] font-semibold text-red hover:bg-red/10 border border-red/25 transition-colors duration-200 flex items-center justify-center gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-red outline-none whitespace-nowrap"
                      aria-label="Reset position filters"
                    >
                      <RotateCcw size={12} />
                      <span>Reset</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleToggleFilters}
                    aria-expanded={filtersExpanded}
                    aria-label={filtersExpanded ? "Collapse active trade filters" : "Expand active trade filters"}
                    className={cn(
                      "min-h-[40px] sm:min-h-[30px] px-3 py-1 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 border transition-[background-color,border-color,color] duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0 whitespace-nowrap",
                      filtersExpanded || hasActiveFilters
                        ? "bg-accent/15 border-accent/40 text-accent"
                        : "bg-surface-elevated border-border text-dim hover:text-text hover:border-accent/30"
                    )}
                  >
                    <SlidersHorizontal size={12} className={cn(filtersExpanded || hasActiveFilters ? "text-accent" : "text-dim")} />
                    <span>Filters</span>
                    <ChevronDown size={12} className={cn("transition-transform duration-200", filtersExpanded && "rotate-180")} />
                  </button>
                </div>
              </div>

              {!filtersExpanded && hasActiveFilters && (
                <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono text-dim pt-1.5 border-t border-border/20">
                  {strategyFilter !== 'ALL' && (
                    <span>Strategy: <strong className="text-text">{strategyFilter}</strong></span>
                  )}
                  {strategyFilter !== 'ALL' && (directionFilter !== 'ALL' || riskFilter !== 'ALL') && (
                    <span aria-hidden="true" className="opacity-40">·</span>
                  )}
                  {directionFilter !== 'ALL' && (
                    <span>Side: <strong className="text-text">{directionFilter}</strong></span>
                  )}
                  {directionFilter !== 'ALL' && riskFilter !== 'ALL' && (
                    <span aria-hidden="true" className="opacity-40">·</span>
                  )}
                  {riskFilter !== 'ALL' && (
                    <span>Risk: <strong className="text-text">{riskFilter === 'ACTIVE' ? 'Active Risk' : 'Protected'}</strong></span>
                  )}
                </div>
              )}

              {/* Collapsible Mobile-First Filter Chip Groups */}
              <SmoothCollapse isOpen={filtersExpanded}>
                <div className="pt-2.5 border-t border-border/25 grid grid-cols-1 md:grid-cols-2 lg:flex lg:flex-wrap items-stretch gap-2.5">
                  {/* Strategy Filter */}
                  {availableStrategies.length > 1 && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 p-2 bg-background/60 border border-border/40 rounded-xl w-full lg:w-auto">
                      <span className="text-[11px] text-dim font-semibold px-1 shrink-0">Strategy</span>
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStrategyFilterChange('ALL')}
                          aria-pressed={strategyFilter === 'ALL'}
                          className={cn(
                            "relative overflow-hidden min-h-[38px] sm:min-h-[30px] px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors duration-200 ease-[var(--ease-out-expo)] shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none whitespace-nowrap",
                            strategyFilter === 'ALL' ? "text-white" : "text-dim hover:text-text hover:bg-surface/60"
                          )}
                        >
                          {strategyFilter === 'ALL' && (
                            <MotionSegmentedPill layoutId="trades-strategy-filter" className="rounded-lg bg-accent shadow-xs z-0" />
                          )}
                          <span className="relative z-10">All</span>
                        </button>
                        {availableStrategies.map(st => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => handleStrategyFilterChange(st)}
                            aria-pressed={strategyFilter === st}
                            className={cn(
                              "relative overflow-hidden min-h-[38px] sm:min-h-[30px] px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors duration-200 ease-[var(--ease-out-expo)] shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none whitespace-nowrap",
                              strategyFilter === st ? "text-white" : "text-dim hover:text-text hover:bg-surface/60"
                            )}
                          >
                            {strategyFilter === st && (
                              <MotionSegmentedPill layoutId="trades-strategy-filter" className="rounded-lg bg-accent shadow-xs z-0" />
                            )}
                            <span className="relative z-10">{st}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Direction Filter */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 p-2 bg-background/60 border border-border/40 rounded-xl w-full md:w-auto">
                    <span className="text-[11px] text-dim font-semibold px-1 shrink-0">Direction</span>
                    <div className="grid grid-cols-3 sm:inline-flex items-center gap-1 w-full sm:w-auto">
                      {['ALL', 'LONG', 'SHORT'].map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => handleDirectionFilterChange(d)}
                          aria-pressed={directionFilter === d}
                          className={cn(
                            "relative overflow-hidden min-h-[38px] sm:min-h-[30px] px-3 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-colors duration-200 ease-[var(--ease-out-expo)] shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none whitespace-nowrap",
                            directionFilter === d ? "text-white" : "text-dim hover:text-text hover:bg-surface/60"
                          )}
                        >
                          {directionFilter === d && (
                            <MotionSegmentedPill layoutId="trades-dir-filter" className="rounded-lg bg-accent shadow-xs z-0" />
                          )}
                          <span className="relative z-10">{d}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Risk Status Filter */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 p-2 bg-background/60 border border-border/40 rounded-xl w-full md:w-auto">
                    <span className="text-[11px] text-dim font-semibold px-1 shrink-0">Risk</span>
                    <div className="grid grid-cols-3 sm:inline-flex items-center gap-1 w-full sm:w-auto">
                      {[
                        { id: 'ALL', label: 'All' },
                        { id: 'PROTECTED', label: 'Protected' },
                        { id: 'ACTIVE', label: 'Active Risk' }
                      ].map(r => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => handleRiskFilterChange(r.id)}
                          aria-pressed={riskFilter === r.id}
                          className={cn(
                            "relative overflow-hidden min-h-[38px] sm:min-h-[30px] px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors duration-200 ease-[var(--ease-out-expo)] shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none whitespace-nowrap",
                            riskFilter === r.id ? "text-white" : "text-dim hover:text-text hover:bg-surface/60"
                          )}
                        >
                          {riskFilter === r.id && (
                            <MotionSegmentedPill layoutId="trades-risk-filter" className="rounded-lg bg-accent shadow-xs z-0" />
                          )}
                          <span className="relative z-10">{r.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </SmoothCollapse>
            </div>

            <div className="flex items-center justify-between px-0.5">
              <SectionLabel className="mb-0">
                Live Tactical Map ({filteredTrades.length} / {(activeTrades || []).length})
              </SectionLabel>
            </div>

        {(!activeTrades || activeTrades.length === 0) ? (
          (!initialStatusLoaded || (sessionActive && isResuming)) ? (
            <ActiveTradesSkeleton count={2} />
          ) : (
          <div className="bg-surface/20 border border-border border-dashed rounded-3xl p-20 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center mb-6 text-dim/20">
              <Zap size={32} />
            </div>
            <h3 className="text-lg font-bold mb-2">No Active Trades</h3>
            <p className="text-dim text-sm max-w-xs mx-auto mb-8">
              The engine is currently scanning for opportunities. New positions will appear here in real-time.
            </p>
            <Btn
              variant="primary"
              onClick={() => window.dispatchEvent(new Event('toggle-scanner'))}
              icon={Zap}
              className="px-8"
            >
              Open Live Scanner
            </Btn>
          </div>
          )
        ) : filteredTrades.length === 0 ? (
          <div className="bg-surface/20 border border-border border-dashed rounded-3xl p-12 flex flex-col items-center justify-center text-center">
            <h3 className="text-base font-bold mb-1">No Matching Active Positions</h3>
            <p className="text-dim text-xs max-w-xs mx-auto mb-4">
              No open trades match your current filter parameters.
            </p>
            <Btn
              variant="secondary"
              onClick={resetAllFilters}
              className="px-6 text-xs"
            >
              Reset Filters
            </Btn>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1">
            <AnimatePresence mode="popLayout" initial={false}>
              {filteredTrades.map((trade, idx) => (
                <motion.div
                  key={trade.id || trade.symbol}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4, scale: 0.99 }}
                  transition={{ duration: 0.22, delay: Math.min(idx * 0.02, 0.12), ease: MOTION_EASE.outExpo }}
                  className="[contain:layout_style]"
                >
                  <ActiveTradeCard
                    trade={trade}
                    config={config}
                    compact={false}
                    onClick={() => setSelectedTradeId(trade.id || trade.symbol)}
                    onMouseEnter={preloadTradeDetailModal}
                    isResuming={isResuming}
                    showResumingFeedback={showResumingFeedback}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
          </div>
        );
      })()}

      <Suspense fallback={selectedTrade ? <ModalDrawerSkeleton /> : null}>
        {selectedTrade && (
          <TradeDetailModal
            isOpen={!!selectedTrade}
            onClose={() => setSelectedTradeId(null)}
            trade={selectedTrade}
            onTradeClose={handleCloseTrade}
          />
        )}
      </Suspense>
    </div>
  )
}

export default TradesView
