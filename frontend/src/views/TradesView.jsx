import React, { useState, useEffect, useRef, lazy, Suspense, useMemo } from 'react'
import { useTradingStore } from '../store/trading'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { SectionLabel, StatCard, cn, ViewHeader, Btn, Tooltip } from '../components/ui/primitives'
import { fmtUSD, pnlColor, pnlClass, safeNum } from '../lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Briefcase, Zap } from 'lucide-react'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { sessionAPI } from '../api/client'
import { Sidebar, BottomNav } from '../components/Navigation'
import { lazyWithRetry } from '../lib/lazy'

const TradeDetailModal = lazyWithRetry(() => import('../components/TradeDetailModal').then(m => ({ default: m.TradeDetailModal })))
const preloadTradeDetailModal = () => {
  import('../components/TradeDetailModal');
};

import { Filter, SlidersHorizontal, ChevronDown, RotateCcw } from 'lucide-react'

const TradesView = () => {
  const { activeTrades, totalPnl, totalRiskPct, totalSlUsed, config, sidebarCollapsed, healthEnabled, isThrottled, wsStatus, isSyncingOnResume, sessionActive, totalEstPnlToRealize } = useTradingStore()
  const [selectedTradeId, setSelectedTradeId] = useState(null)

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

  // BOLT OPTIMIZATION: Combine active trade calculations into a single-pass loop-fused useMemo
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
    const projected = (totalPnl - pnl) + estPnl;
    return {
      activePnl: pnl,
      activeEstPnl: estPnl,
      trueProjectedPnl: projected,
      peakRr: maxRr
    };
  }, [activeTrades, totalPnl]);

  const selectedTrade = (activeTrades || []).find(t => t.id === selectedTradeId || t.symbol === selectedTradeId)

  // Lifecycle-scoped subscription contract
  useResourceFocus('global_trades');

  const addAlert = useTradingStore(state => state.addAlert);
  const [closingMap, setClosingMap] = useState({})

  const handleCloseTrade = async (symbol) => {
    if (closingMap[symbol]) {
      return;
    }

    setClosingMap(prev => ({ ...prev, [symbol]: true }));

    try {
      await sessionAPI.closeTrade(symbol)
      setSelectedTradeId(null)
      addAlert({ level: 'success', title: 'Liquidation Started', message: `Manual closure request for ${symbol} sent to exchange.` });
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
      "min-h-screen transition-all duration-300",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
    )}>
      <Sidebar />
      <div className={cn(
        "max-w-[1200px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 lg:pb-8 transition-all",
        healthEnabled ? "pb-48" : "pb-32"
      )}>
        <ViewHeader
          icon={Briefcase}
          title="Active Positions"
          subTitle="Live monitoring across all strategies"
          backAction={() => window.location.hash = '#/'}
        />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8 lg:mb-12">
        <StatCard
          label="Active P&L"
          value={fmtUSD(activePnl)}
          color={pnlClass(activePnl)}
          subValue={
            <div className="flex flex-col gap-0.5 mt-1 min-w-[130px]">
              <div className="flex items-center justify-between text-[10px] text-dim/60">
                <span>Session Return:</span>
                <span className="font-bold font-mono" style={{ color: pnlColor(totalPnl) }}>{fmtUSD(totalPnl)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-dim/60">
                <span>Est. Target:</span>
                <span className="font-bold font-mono" style={{ color: pnlColor(activeEstPnl) }}>≈ {fmtUSD(activeEstPnl)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-dim/80 pt-0.5 border-t border-border/20">
                <span>Projected:</span>
                <span className="font-bold font-mono" style={{ color: pnlColor(trueProjectedPnl) }}>≈ {fmtUSD(trueProjectedPnl)}</span>
              </div>
            </div>
          }
        />
        <StatCard label="Active Risk" value={`${Number(totalRiskPct || 0).toFixed(2)}%`} color={totalRiskPct > config.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
        <StatCard label="Peak RR" value={`+${Number(peakRr || 0).toFixed(2)}`} color="text-accent" />
        <StatCard label="Positions" value={activeTrades.length.toString()} color="text-accent" />
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
            const isRiskReleased = isSlAtBreakeven || (t.risk_usdt === 0 && Number(t.initial_risk_usdt) > 0);
            if (riskFilter === 'PROTECTED' && !isRiskReleased) return false;
            if (riskFilter === 'ACTIVE' && isRiskReleased) return false;
          }
          return true;
        });

        return (
          <div className="flex flex-col gap-6">
            {/* Ultra-Dense Mobile-Optimized Filter Bar */}
            <div id="active-trades-filter-toolbar" className="bg-background/95 border border-border/40 rounded-2xl p-2.5 sm:p-3 shadow-sm flex flex-col gap-2 w-full">
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <Filter size={12} className="text-accent" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-text">Tactical Filters</span>
                  {hasActiveFilters && (
                    <span className="px-1.5 py-0.2 rounded-full bg-accent/20 text-accent border border-accent/30 text-[8px] font-mono font-black">
                      ACTIVE
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="px-2 py-1 rounded-lg text-[8.5px] font-black uppercase tracking-wider text-red hover:bg-red/10 border border-red/20 transition-all flex items-center gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-red outline-none"
                      aria-label="Reset position filters"
                    >
                      <RotateCcw size={10} />
                      <span className="hidden sm:inline">Reset</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleToggleFilters}
                    aria-expanded={filtersExpanded}
                    aria-label={filtersExpanded ? "Collapse active trade filters" : "Expand active trade filters"}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[8.5px] font-black uppercase tracking-wider flex items-center gap-1 border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0",
                      filtersExpanded
                        ? "bg-accent/15 border-accent/40 text-accent"
                        : "bg-surface border-border/40 text-dim hover:text-text hover:border-accent/30"
                    )}
                  >
                    <SlidersHorizontal size={11} className={cn(filtersExpanded ? "text-accent" : "text-dim")} />
                    <span>Options</span>
                    <ChevronDown size={11} className={cn("transition-transform duration-200", filtersExpanded && "rotate-180")} />
                  </button>
                </div>
              </div>

              {/* Collapsible Ultra-Dense Filter Chip Groups */}
              {filtersExpanded && (
                <div className="pt-2 border-t border-border/20 flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  {/* Strategy Filter */}
                  {availableStrategies.length > 1 && (
                    <div className="flex items-center gap-1 p-1 bg-surface border border-border/30 rounded-xl max-w-full overflow-x-auto no-scrollbar">
                      <span className="text-[7.5px] text-dim/70 font-black uppercase tracking-widest px-1 shrink-0">Strategy:</span>
                      <button
                        type="button"
                        onClick={() => handleStrategyFilterChange('ALL')}
                        aria-pressed={strategyFilter === 'ALL'}
                        className={cn(
                          "px-2 py-0.5 rounded-md text-[8px] font-black tracking-wider uppercase transition-all shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                          strategyFilter === 'ALL' ? "bg-accent text-white shadow-xs" : "text-dim hover:text-text"
                        )}
                      >
                        ALL
                      </button>
                      {availableStrategies.map(st => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => handleStrategyFilterChange(st)}
                          aria-pressed={strategyFilter === st}
                          className={cn(
                            "px-2 py-0.5 rounded-md text-[8px] font-black tracking-wider uppercase transition-all shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                            strategyFilter === st ? "bg-accent text-white shadow-xs" : "text-dim hover:text-text"
                          )}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Direction Filter */}
                  <div className="flex items-center gap-1 p-1 bg-surface border border-border/30 rounded-xl max-w-full overflow-x-auto no-scrollbar">
                    <span className="text-[7.5px] text-dim/70 font-black uppercase tracking-widest px-1 shrink-0">Direction:</span>
                    {['ALL', 'LONG', 'SHORT'].map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => handleDirectionFilterChange(d)}
                        aria-pressed={directionFilter === d}
                        className={cn(
                          "px-2 py-0.5 rounded-md text-[8px] font-black tracking-wider uppercase transition-all shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                          directionFilter === d ? "bg-accent text-white shadow-xs" : "text-dim hover:text-text"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>

                  {/* Risk Status Filter */}
                  <div className="flex items-center gap-1 p-1 bg-surface border border-border/30 rounded-xl max-w-full overflow-x-auto no-scrollbar">
                    <span className="text-[7.5px] text-dim/70 font-black uppercase tracking-widest px-1 shrink-0">Risk:</span>
                    {[
                      { id: 'ALL', label: 'ALL' },
                      { id: 'PROTECTED', label: 'PROTECTED' },
                      { id: 'ACTIVE', label: 'ACTIVE RISK' }
                    ].map(r => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => handleRiskFilterChange(r.id)}
                        aria-pressed={riskFilter === r.id}
                        className={cn(
                          "px-2 py-0.5 rounded-md text-[8px] font-black tracking-wider uppercase transition-all shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                          riskFilter === r.id ? "bg-accent text-white shadow-xs" : "text-dim hover:text-text"
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <SectionLabel className="mb-0">
                Live Tactical Map ({filteredTrades.length} / {(activeTrades || []).length})
              </SectionLabel>
            </div>

        {(!activeTrades || activeTrades.length === 0) ? (
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
          <AnimatePresence mode="popLayout">
            <div className="grid gap-4 grid-cols-1">
              {filteredTrades.map((trade, idx) => (
                <motion.div
                  key={trade.id || trade.symbol}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.05 }}
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
            </div>
          </AnimatePresence>
        )}
          </div>
        );
      })()}

      <Suspense fallback={null}>
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
      <BottomNav />
    </div>
  )
}

export default TradesView
