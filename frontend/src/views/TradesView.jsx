import React, { useState, lazy, Suspense, useMemo } from 'react'
import { useTradingStore } from '../store/trading'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { SectionLabel, StatCard, cn, ViewHeader, Btn } from '../components/ui/primitives'
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

import { Search, Filter, SlidersHorizontal, ChevronDown, LayoutGrid, Layers, List } from 'lucide-react'

const TradesView = () => {
  const { activeTrades, totalPnl, totalRiskPct, totalSlUsed, config, sidebarCollapsed, healthEnabled, isThrottled, wsStatus, isSyncingOnResume, sessionActive, totalEstPnlToRealize } = useTradingStore()
  const [selectedTradeId, setSelectedTradeId] = useState(null)

  // Persisted view mode ('detailed' | 'compact' | 'list') and filter settings
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('trades_view_mode') || 'detailed';
  });
  const [search, setSearch] = useState(() => {
    return localStorage.getItem('trades_filter_search') || '';
  });
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

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('trades_view_mode', mode);
  };

  const handleSearchChange = (val) => {
    setSearch(val);
    localStorage.setItem('trades_filter_search', val);
  };

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

        const filteredTrades = (activeTrades || []).filter(t => {
          if (search) {
            const term = search.toLowerCase().trim();
            const symbolMatch = (t.symbol || '').toLowerCase().includes(term);
            const stratMatch = (t.strategy_label || '').toLowerCase().includes(term);
            if (!symbolMatch && !stratMatch) return false;
          }
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
            {/* Filter Toolbar & View Mode Switcher */}
            <div className="bg-background/95 border border-border/30 rounded-2xl p-3 shadow-sm flex flex-col gap-3 w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
                {/* View Mode Selector Tabs */}
                <div className="flex items-center bg-surface/60 border border-border/40 p-0.5 rounded-xl self-start sm:self-auto" role="tablist" aria-label="Active positions view mode selection">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'detailed'}
                    onClick={() => handleViewModeChange('detailed')}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                      viewMode === 'detailed' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text"
                    )}
                  >
                    <LayoutGrid size={12} />
                    <span>Detailed</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'compact'}
                    onClick={() => handleViewModeChange('compact')}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                      viewMode === 'compact' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text"
                    )}
                  >
                    <Layers size={12} />
                    <span>Compact</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'list'}
                    onClick={() => handleViewModeChange('list')}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                      viewMode === 'list' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text"
                    )}
                  >
                    <List size={12} />
                    <span>List</span>
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative group w-full sm:max-w-[260px]">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
                  <input
                    type="text"
                    placeholder="Search active positions..."
                    aria-label="Search active positions"
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="w-full bg-surface border border-border/40 rounded-xl pl-9 pr-3 py-1.5 text-[10.5px] font-bold focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                  />
                </div>

                {/* Toggle Advanced Filters Button */}
                <button
                  type="button"
                  onClick={handleToggleFilters}
                  aria-expanded={filtersExpanded}
                  aria-label={filtersExpanded ? "Collapse active trade filters" : "Expand active trade filters"}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0 self-end sm:self-auto",
                    filtersExpanded
                      ? "bg-accent/15 border-accent/40 text-accent"
                      : "bg-surface border-border/40 text-dim hover:text-text hover:border-accent/30"
                  )}
                >
                  <SlidersHorizontal size={12} className={cn(filtersExpanded ? "text-accent" : "text-dim")} />
                  <span>Filters</span>
                  <ChevronDown size={12} className={cn("transition-transform duration-200", filtersExpanded && "rotate-180")} />
                </button>
              </div>

              {/* Collapsible Filter Panel */}
              {filtersExpanded && (
                <div className="pt-2 border-t border-border/20 flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                  {/* Strategy Filter */}
                  {availableStrategies.length > 1 && (
                    <div className="flex items-center gap-1 p-1 bg-surface border border-border/30 rounded-xl overflow-x-auto no-scrollbar">
                      <span className="text-[8px] text-dim/70 font-black uppercase tracking-widest px-1.5">Strategy:</span>
                      <button
                        type="button"
                        onClick={() => handleStrategyFilterChange('ALL')}
                        aria-pressed={strategyFilter === 'ALL'}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[8.5px] font-black tracking-wider uppercase transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                          strategyFilter === 'ALL' ? "bg-accent/15 text-accent border border-accent/20" : "text-dim hover:text-text"
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
                            "px-2 py-1 rounded-lg text-[8.5px] font-black tracking-wider uppercase transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                            strategyFilter === st ? "bg-accent/15 text-accent border border-accent/20" : "text-dim hover:text-text"
                          )}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Direction Filter */}
                  <div className="flex items-center gap-1 p-1 bg-surface border border-border/30 rounded-xl">
                    <span className="text-[8px] text-dim/70 font-black uppercase tracking-widest px-1.5">Direction:</span>
                    {['ALL', 'LONG', 'SHORT'].map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => handleDirectionFilterChange(d)}
                        aria-pressed={directionFilter === d}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[8.5px] font-black tracking-wider uppercase transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                          directionFilter === d ? "bg-accent/15 text-accent border border-accent/20" : "text-dim hover:text-text"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>

                  {/* Risk Status Filter */}
                  <div className="flex items-center gap-1 p-1 bg-surface border border-border/30 rounded-xl">
                    <span className="text-[8px] text-dim/70 font-black uppercase tracking-widest px-1.5">Risk:</span>
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
                          "px-2 py-1 rounded-lg text-[8.5px] font-black tracking-wider uppercase transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none",
                          riskFilter === r.id ? "bg-accent/15 text-accent border border-accent/20" : "text-dim hover:text-text"
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
              No open trades match your current search or filter parameters.
            </p>
            <Btn
              variant="secondary"
              onClick={() => {
                handleSearchChange('');
                handleStrategyFilterChange('ALL');
                handleDirectionFilterChange('ALL');
                handleRiskFilterChange('ALL');
              }}
              className="px-6 text-xs"
            >
              Reset Filters
            </Btn>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className={cn(
              "grid gap-4",
              viewMode === 'compact' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
            )}>
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
                    compact={viewMode !== 'detailed'}
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
