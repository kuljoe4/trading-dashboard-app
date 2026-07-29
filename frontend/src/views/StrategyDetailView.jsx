import React, { useMemo, useState, Suspense } from 'react'
import { pnlColor, pnlClass, fmtUSD } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { DecisionLog } from '../components/DecisionLog'
import { 
  StatCard, SectionLabel, StatusBadge, PaperBadge, DemoBadge, LiveBadge,
  ConditionWidget, PnLBars, CopyButton, cn, ViewHeader
} from '../components/ui/primitives'
import { ScannerPreview } from './DashboardView'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Activity, BarChart3, TrendingUp, Zap, Pause, Play, Edit3
} from 'lucide-react'
import { EquityCurve } from '../components/Analytics'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { sessionAPI } from '../api/client'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { lazyWithRetry } from '../lib/lazy'

const TradeDetailModal = lazyWithRetry(() => import('../components/TradeDetailModal').then(m => ({ default: m.TradeDetailModal })))

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

  const bestOpp = useMemo(() => strategyScannerResults[0] || { symbol: '---', pct: 0, dir: '---' }, [strategyScannerResults])
  const scanMet = Math.abs(bestOpp.pct) >= strategyConfig.scan_pct_threshold
  const signalResult = bestOpp.signalResult || { allFired: false, firedSignals: [] }
  const entryMet = scanMet && signalResult.allFired
  const signalsCount = strategyConfig.enabled_signals?.length || 0
  const firedCount = signalResult.firedSignals?.length || 0
  const signalLogic = strategyConfig.signal_logic || 'all'

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
               onClick={() => onPause(s.strategy_label)}
               className={cn(
                 "px-2.5 py-1 rounded border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0",
                 isStrategyPaused
                   ? "bg-green/10 text-green border-green/20 hover:bg-green/20"
                   : "bg-amber/10 text-amber border-amber/20 hover:bg-amber/20"
               )}
               aria-label={isStrategyPaused ? "Resume strategy" : "Pause strategy"}
             >
               {isStrategyPaused ? <Play size={10} fill="currentColor" /> : <Pause size={10} fill="currentColor" />}
               {isStrategyPaused ? "Resume" : "Pause"}
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

        {/* Real-time Technical Signal Checklist */}
        {strategyConfig.enabled_signals && strategyConfig.enabled_signals.length > 0 && (
          <div className="bg-surface/30 border border-border/40 p-4 rounded-2xl mb-5 text-left">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[10px] font-black text-dim uppercase tracking-widest">
                Technical Signal Checklist ({bestOpp.symbol})
              </div>
              <div className={cn(
                "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border shadow-sm",
                entryMet ? "bg-green/10 text-green border-green/20" : "bg-amber/10 text-amber border-amber/20"
              )}>
                {entryMet ? 'TRIGGERED (AUTHORIZED)' : 'PENDING'}
              </div>
            </div>

            {/* Checklist Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
              {/* Velocity (Scanner Threshold) */}
              <div className={cn(
                "flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-[11px] font-bold font-mono transition-all",
                scanMet ? "bg-green/5 border-green/20 text-green" : "bg-background/40 border-border text-dim/60"
              )}>
                <div className="flex items-center gap-2 truncate">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", scanMet ? "bg-green animate-pulse" : "bg-dim/40")} />
                  <span className="truncate font-sans font-bold text-text/80">Velocity Move</span>
                </div>
                <span className="shrink-0 font-black font-mono ml-1">
                  {bestOpp.symbol !== '---' ? `${Math.abs(bestOpp.pct).toFixed(2)}%` : '---'}
                </span>
              </div>

              {/* Other Signals */}
              {strategyConfig.enabled_signals.map(sig => {
                const s = signalResult.signals?.[sig] || { fired: false, active: true, label: SIGNAL_LABELS[sig] || sig };
                const isFired = s.fired && s.active;
                const isDelayed = s.remaining_delay > 0 && !isFired;
                return (
                  <div key={sig} className={cn(
                    "flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-[11px] font-bold font-mono transition-all",
                    isFired ? "bg-green/5 border-green/20 text-green" : s.fired ? "bg-amber/5 border-amber/20 text-amber" : "bg-background/40 border-border text-dim/60"
                  )}>
                    <div className="flex items-center gap-2 truncate">
                      <span className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        isFired ? "bg-green" : isDelayed ? "bg-amber animate-pulse" : s.fired ? "bg-amber" : "bg-dim/40"
                      )} />
                      <span className="truncate font-sans font-bold text-text/80">{SIGNAL_LABELS[sig] || sig}</span>
                    </div>
                    <span className="shrink-0 font-black font-mono ml-1">
                      {bestOpp.symbol === '---' ? '---' : s.insufficientData ? 'Collecting' : isFired ? 'Triggered' : isDelayed ? `Delay` : s.fired ? 'Met' : 'Watching'}
                    </span>
                  </div>
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
