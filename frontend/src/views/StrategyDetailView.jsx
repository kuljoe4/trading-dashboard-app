import React, { useMemo, useState, Suspense } from 'react'
import { pnlColor, pnlClass, fmtUSD } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { DecisionLog } from '../components/DecisionLog'
import { 
  StatCard, SectionLabel, StatusBadge, PaperBadge, DemoBadge, LiveBadge,
  ConditionWidget, PnLBars, CopyButton, cn, ViewHeader
} from '../components/ui/primitives'
import { SignalGauge } from '../components/ui/SignalGauge'
import { calculateProximity } from '../lib/formatters'
import { ScannerPreview } from './DashboardView'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Activity, BarChart3, TrendingUp, Zap, Pause, Play, Edit3, Loader2
} from 'lucide-react'
import { EquityCurve } from '../components/Analytics'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { sessionAPI } from '../api/client'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { lazyWithRetry } from '../lib/lazy'

const TradeDetailModal = lazyWithRetry(() => import('../components/TradeDetailModal').then(m => ({ default: m.TradeDetailModal })))
const preloadTradeDetailModal = () => {
  import('../components/TradeDetailModal');
};

const SIGNAL_LABELS = {
  momentum_pct: 'Momentum',
  breakout_hl: 'Breakout H/L',
  ema_price_cross: 'EMA Cross',
  ema_dual_cross: 'Dual EMA Cross',
  ema_close: 'EMA Close',
  ema_dual_close: 'Dual EMA Close',
  ma: 'MA Cross',
  engulfing: 'Engulfing',
  macd_impulse: 'MACD Impulse',
  macd_fade: 'MACD Fade',
  macd_pbc: 'MACD PBC',
  supertrend: 'Supertrend'
};

const StrategyDetailView = ({ s, onBack, onEdit, onPause, onOpenScanner }) => {
  const { config, scannerResults, variantScannerResults, analytics, wsStatus, isSyncing, isThrottled, isSyncingOnResume, sessionActive, pausedStrategies, sessionPaused, activeTrades } = useTradingStore()
  const [selectedTradeId, setSelectedTradeId] = useState(null)
  const [selectedFocusSymbol, setSelectedFocusSymbol] = useState(null)
  const [isPausing, setIsPausing] = useState(false)
  const [closingMap, setClosingMap] = useState({})

  // BOLT OPTIMIZATION: Resolve variant-specific configuration if viewing a strategy variant
  const strategyConfig = useMemo(() => {
    if (!config) return {};
    const idx = config.strategy_variants?.findIndex(v => v.strategy_label === s.strategy_label);
    return (idx !== -1 && idx !== undefined)
      ? { ...config, ...config.strategy_variants[idx] }
      : config;
  }, [config, s.strategy_label]);

  // Resolve variant-aware timeframe and scanner opportunities list
  const strategyScannerResults = useMemo(() => {
    if (!s || !s.strategy_label) return [];
    if (variantScannerResults && variantScannerResults[s.strategy_label]) {
      return variantScannerResults[s.strategy_label];
    }
    return scannerResults || [];
  }, [variantScannerResults, scannerResults, s?.strategy_label]);

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = sessionActive && isResuming
  const isVariant = useMemo(() => {
    if (!config) return false;
    return config.strategy_label !== s.strategy_label;
  }, [config, s.strategy_label]);

  // Lifecycle-scoped subscription contract
  useResourceFocus('strategy', s.strategy_label);

  const proximityLeaderboard = useMemo(() => {
    const list = strategyScannerResults || [];
    const enabledSigs = strategyConfig.enabled_signals || [];
    const scanThresh = strategyConfig.scan_pct_threshold || 2.0;

    return list.map(opp => {
      const isLong = opp.dir === 'long' || opp.pct >= 0;
      const velocityProgress = Math.min(100, (Math.abs(opp.pct || 0) / scanThresh) * 100);

      let sigSum = velocityProgress;
      let count = 1;

      if (opp.signalResult?.signals) {
        for (const sigKey of enabledSigs) {
          const s = opp.signalResult.signals[sigKey];
          if (s) {
            const prox = calculateProximity(s, opp.close || s.value || 0, 0, isLong, false);
            sigSum += prox;
            count++;
          }
        }
      }

      const avgProximity = count > 0 ? sigSum / count : 0;
      return {
        ...opp,
        proximity: opp.signalResult?.allFired ? 100 : Math.round(avgProximity)
      };
    }).sort((a, b) => b.proximity - a.proximity);
  }, [strategyScannerResults, strategyConfig.enabled_signals, strategyConfig.scan_pct_threshold]);

  const focusedOpp = useMemo(() => {
    if (selectedFocusSymbol) {
      const found = strategyScannerResults.find(r => r.symbol === selectedFocusSymbol);
      if (found) return found;
    }
    return proximityLeaderboard[0] || strategyScannerResults[0] || { symbol: '---', pct: 0, dir: '---' };
  }, [selectedFocusSymbol, strategyScannerResults, proximityLeaderboard]);

  const bestOpp = focusedOpp;
  const scanMet = Math.abs(bestOpp.pct) >= strategyConfig.scan_pct_threshold
  const signalResult = bestOpp.signalResult || { allFired: false, firedSignals: [] }
  const entryMet = scanMet && signalResult.allFired
  const signalsCount = strategyConfig.enabled_signals?.length || 0
  const firedCount = signalResult.firedSignals?.length || 0
  const signalLogic = strategyConfig.signal_logic || 'all'
  const requiredSignals = strategyConfig.required_signals || []
  const reqLabels = (strategyConfig.enabled_signals || []).filter(s => requiredSignals.includes(s)).map(s => SIGNAL_LABELS[s] || s)
  const optLabels = (strategyConfig.enabled_signals || []).filter(s => !requiredSignals.includes(s)).map(s => SIGNAL_LABELS[s] || s)

  const conditionFormula = signalLogic === 'combo'
    ? `${reqLabels.length > 0 ? `[Req: ${reqLabels.join(' AND ')}]` : '[Req: Base]'} AND ${optLabels.length > 0 ? `[Any: ${optLabels.join(' | ')}]` : '[Any]'}`
    : signalLogic === 'all' ? 'Match All (AND)' : 'Match Any (OR)'

  const isStrategyPaused = pausedStrategies?.includes(s.strategy_label) || sessionPaused;

  const strategyActiveTrades = useMemo(() => {
    if (!activeTrades || !s?.strategy_label) return []
    return activeTrades.filter(t => t.strategy_label === s.strategy_label)
  }, [activeTrades, s?.strategy_label])

  const activeTradeCount = strategyActiveTrades.length

  const selectedTrade = useMemo(() => {
    return (strategyActiveTrades || []).find(t => t.id === selectedTradeId || t.symbol === selectedTradeId)
  }, [strategyActiveTrades, selectedTradeId])

  const handleCloseTrade = async (symbol) => {
    try {
      await sessionAPI.closeTrade(symbol)
      setSelectedTradeId(null)
      useTradingStore.getState().addAlert({ level: 'success', title: 'Liquidation Started', message: `Manual closure request for ${symbol} sent to exchange.` });
    } catch (e) {
      useTradingStore.getState().addAlert({ level: 'error', title: 'Closure Failed', message: e?.response?.data?.message || e.message || 'Could not close position.' });
    }
  }

  return (
    <motion.div
      layout
      className="max-w-[1200px] mx-auto p-3 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 lg:pb-10"
    >
      <ViewHeader
        icon={Activity}
        title={s.strategy_label}
        subTitle={`Loop Monitoring · ${s.strategyId?.substring(0, 8)}`}
        backAction={onBack}
      >
         <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
           <CopyButton value={s.strategyId} className="p-1 hidden sm:inline-flex" />
           <StatusBadge status={s.sessionActive} />
           {isVariant && (
             <span className="px-2.5 py-1 rounded bg-purple/10 text-purple border border-purple/20 text-[10px] font-black uppercase tracking-widest scale-90 origin-left">
               Variant
             </span>
           )}
           <span className="px-2.5 py-1 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 text-[10px] font-black uppercase tracking-widest scale-90 origin-left opacity-65">
             {activeTradeCount} ACTIVE
           </span>

           {/* Strategy Control Actions (Pause/Resume & Edit Configuration) */}
           {sessionActive && (
             <button
               type="button"
               disabled={isPausing}
               aria-busy={isPausing}
               aria-disabled={isPausing}
               onClick={async () => {
                 if (isPausing) return;
                 setIsPausing(true);
                 try {
                   await onPause(s.strategy_label);
                 } finally {
                   setIsPausing(false);
                 }
               }}
               className={cn(
                 "px-2.5 py-1 rounded border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0",
                 isPausing ? "cursor-wait opacity-60 text-dim bg-surface border-border" : (
                   isStrategyPaused
                     ? "bg-green/10 text-green border-green/20 hover:bg-green/20 active:scale-95 cursor-pointer"
                     : "bg-amber/10 text-amber border-amber/20 hover:bg-amber/20 active:scale-95 cursor-pointer"
                 )
               )}
               aria-label={isPausing ? (isStrategyPaused ? "Resuming strategy..." : "Pausing strategy...") : (isStrategyPaused ? "Resume strategy" : "Pause strategy")}
             >
               {isPausing ? <Loader2 size={10} className="animate-spin text-accent" /> : (isStrategyPaused ? <Play size={10} fill="currentColor" /> : <Pause size={10} fill="currentColor" />)}
               {isPausing ? (isStrategyPaused ? "Resuming..." : "Pausing...") : (isStrategyPaused ? "Resume" : "Pause")}
             </button>
           )}

           <button
             onClick={onEdit}
             className="px-2.5 py-1 bg-surface border border-border text-dim hover:text-accent hover:border-accent/40 rounded border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0"
             aria-label="Edit configuration"
           >
             <Edit3 size={10} />
             Edit
           </button>
         </div>
      </ViewHeader>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4 mb-6 md:mb-10">
        <StatCard
          label="Active P&L"
          value={fmtUSD(s.activePnl)}
          color={pnlClass(s.activePnl)}
          subValue={analytics === null ? "Syncing..." : `Total: ${fmtUSD(s.totalPnl)}`}
          syncing={showResumingFeedback || isSyncing || (analytics === null && s.activePnl === 0)}
        />
        <StatCard
          label="Active Trades"
          value={activeTradeCount.toString()}
          color={activeTradeCount > 0 ? "text-green" : "text-dim"}
          subValue={activeTradeCount > 0 ? "In Position" : "Flat"}
          tooltipText="The number of open positions currently managed under this strategy."
        />
        <StatCard label="Hit Count" value={(s.entryCount ?? 0).toString()} color="text-accent" />
        <StatCard label="SL Budget" value={`$${Number(s.totalSlUsed || 0).toFixed(0)}`} subValue={`Limit $${strategyConfig.total_sl_guard_usdt}`} color={s.totalSlUsed > strategyConfig.total_sl_guard_usdt * 0.7 ? "text-amber" : "text-text"} />
        <StatCard label="Active Risk" value={`${Number(s.totalRiskPct || 0).toFixed(1)}%`} color={s.totalRiskPct > strategyConfig.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"} />
      </div>

      <div className="mb-10">
        <SectionLabel>Automation Gating</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
          <ConditionWidget label={`Scanner: % Move (${strategyConfig.scan_interval})`} value={bestOpp.pct} threshold={strategyConfig.scan_pct_threshold} satisfied={scanMet} sublabel={`Top Opp: ${bestOpp.symbol} ${bestOpp.dir.toUpperCase()}`} />
          <ConditionWidget label="Signal Authorization" value={firedCount} threshold={signalLogic === 'all' ? signalsCount : 1} unit={`/${signalsCount} signals`} satisfied={entryMet} sublabel={bestOpp.symbol !== '---' ? `[${bestOpp.symbol}] ${signalResult.reason || "Awaiting signals"}` : (signalResult.reason || "Waiting for structural signal")} />
        </div>

      {/* Watchlist Proximity Leaderboard */}
      {proximityLeaderboard.length > 0 && (
        <div className="mb-5 bg-surface/40 border border-border/40 p-3.5 rounded-2xl text-left">
          <div className="flex justify-between items-center mb-2.5">
            <span className="text-[10px] font-black text-dim uppercase tracking-widest flex items-center gap-1.5">
              <Zap size={12} className="text-accent" /> Watchlist Proximity Leaderboard
            </span>
            <span className="text-[9px] font-mono text-dim/60 uppercase">Sorted by Proximity %</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {proximityLeaderboard.slice(0, 5).map(opp => {
              const isSelected = focusedOpp.symbol === opp.symbol;
              const isFired = opp.signalResult?.allFired;
              return (
                <button
                  key={opp.symbol}
                  type="button"
                  onClick={() => setSelectedFocusSymbol(opp.symbol)}
                  className={cn(
                    "p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    isSelected
                      ? "bg-accent/10 border-accent text-accent shadow-sm"
                      : isFired
                      ? "bg-green/5 border-green/30 text-green"
                      : "bg-background/40 border-border/60 hover:border-border text-text"
                  )}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black font-mono">{opp.symbol}</span>
                    <span className={cn(
                      "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded",
                      isFired ? "bg-green/20 text-green" : "bg-surface text-dim"
                    )}>
                      {opp.proximity}%
                    </span>
                  </div>

                  <div className="h-1 bg-background/80 rounded-full overflow-hidden relative border border-white/5">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        isFired ? "bg-green" : opp.proximity > 80 ? "bg-accent" : "bg-dim/50"
                      )}
                      style={{ width: `${opp.proximity}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

        {/* Real-time Technical Signal Checklist */}
        {strategyConfig.enabled_signals && strategyConfig.enabled_signals.length > 0 && (
          <div className="bg-surface/30 border border-border/40 p-4 rounded-2xl mb-5 text-left">
            <div className="flex justify-between items-center mb-3">
              <div className="flex flex-col text-left">
                <div className="text-[10px] font-black text-dim uppercase tracking-widest">
                  Technical Signal Checklist ({bestOpp.symbol})
                </div>
                <div className="text-[9px] font-mono font-bold text-accent uppercase tracking-wider mt-0.5">
                  Formula: {conditionFormula}
                </div>
              </div>
              <div className={cn(
                "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border shadow-sm",
                entryMet ? "bg-green/10 text-green border-green/20" : "bg-amber/10 text-amber border-amber/20"
              )}>
                {entryMet ? 'TRIGGERED (AUTHORIZED)' : 'PENDING'}
              </div>
            </div>

            {/* Checklist Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {/* Velocity (Scanner Threshold) */}
              <SignalGauge
                label="Velocity Move"
                value={Math.abs(bestOpp.pct || 0)}
                threshold={strategyConfig.scan_pct_threshold || 2.0}
                unit="%"
                fired={scanMet}
                active={scanMet}
                markPrice={bestOpp.close || 0}
              />

              {/* Technical Indicator Signals */}
              {strategyConfig.enabled_signals.map(sig => {
                const s = signalResult.signals?.[sig] || { fired: false, active: true, label: SIGNAL_LABELS[sig] || sig };
                return (
                  <SignalGauge
                    key={sig}
                    label={SIGNAL_LABELS[sig] || sig}
                    value={s.value}
                    threshold={s.threshold}
                    unit={s.unit}
                    fired={s.fired}
                    active={s.active !== false}
                    remainingDelay={s.remaining_delay || 0}
                    configDelay={s.config_delay || 0}
                    insufficientData={s.insufficientData}
                    thresholdIsPrice={s.threshold_is_price}
                    isLong={bestOpp.dir === 'long'}
                    markPrice={bestOpp.close || s.value || 0}
                    type="entry"
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Evaluation Timeframes List */}
        {strategyConfig.enabled_signals && strategyConfig.enabled_signals.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-background/30 p-4 rounded-2xl border border-border/40 mb-10 text-left animate-in fade-in duration-300">
            <div className="text-[10px] font-black text-dim uppercase tracking-widest shrink-0 whitespace-nowrap">
              Evaluation Timeframes:
            </div>
            <div className="flex flex-wrap gap-2 items-center flex-1 min-w-0">
              {strategyConfig.enabled_signals.map(sig => {
                const rawTf = (strategyConfig.signal_timeframes || {})[sig];
                const tf = (!rawTf || rawTf === 'default') ? (strategyConfig.scan_interval || '5m') : rawTf;
                return (
                  <span key={sig} className="px-2.5 py-1 rounded-xl bg-surface border border-border text-[10px] font-mono text-text/90 flex items-center gap-1.5 shadow-sm transition-all hover:border-accent/30 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 group-hover:scale-110 transition-transform" />
                    <span className="font-bold">{SIGNAL_LABELS[sig] || sig}</span>
                    <span className="text-dim/60 font-semibold font-mono">({tf})</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Active Positions List for Strategy Details (Symbols) */}
        {activeTradeCount > 0 && (
          <div className="mb-10 animate-in fade-in duration-300 text-left">
            <SectionLabel>Active Positions ({activeTradeCount})</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {strategyActiveTrades.map(trade => (
                <ActiveTradeCard
                  key={trade.id || trade.symbol}
                  trade={trade}
                  config={strategyConfig}
                  onClick={() => setSelectedTradeId(trade.id || trade.symbol)}
                  onMouseEnter={preloadTradeDetailModal}
                  isResuming={isResuming}
                  showResumingFeedback={showResumingFeedback}
                />
              ))}
            </div>
          </div>
        )}

        <ScannerPreview
          scannerResults={(strategyScannerResults || []).filter(Boolean)}
          config={strategyConfig}
          onOpen={() => onOpenScanner(s.strategy_label)}
        />
      </div>

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

    </motion.div>
  )
}
export default StrategyDetailView
