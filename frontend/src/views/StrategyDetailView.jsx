import React, { useMemo, useState, useEffect, Suspense } from 'react'
import { pnlColor, pnlClass, fmtUSD } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { DecisionLog } from '../components/DecisionLog'
import { getMarketRegimeInfo } from '../utils/marketRegime'
import { 
  StatCard, SectionLabel, StatusBadge, PaperBadge, DemoBadge, LiveBadge,
  ConditionWidget, PnLBars, CopyButton, cn, ViewHeader, Tooltip
} from '../components/ui/primitives'
import { SignalGauge } from '../components/ui/SignalGauge'
import { calculateProximity, calculateOpportunityProximity } from '../lib/formatters'
import { calculatePerformanceMetrics } from '../lib/analytics'
import { ScannerPreview } from './DashboardView'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Activity, BarChart3, TrendingUp, Zap, Pause, Play, Edit3, Loader2, Calendar as CalendarIcon, ChevronDown, Turtle, Flame,
  RefreshCw, Clock, CheckCircle2, AlertCircle, Radio, Layers, Search, ShieldCheck, Cpu, ArrowUpRight, Target, Compass, ArrowRight, Lock
} from 'lucide-react'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { sessionAPI } from '../api/client'
import { ActiveTradeCard } from '../components/ActiveTradeCard'
import { lazyWithRetry } from '../lib/lazy'

const LazyStrategyPerformanceOverlayChart = lazyWithRetry(() => import('../components/Analytics').then(m => ({ default: m.StrategyPerformanceOverlayChart })))
const LazyStrategyCalendarPnL = lazyWithRetry(() => import('../components/Analytics').then(m => ({ default: m.StrategyCalendarPnL })))

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
  const { config, scannerResults, variantScannerResults, analytics, wsStatus, isSyncing, isThrottled, isSyncingOnResume, sessionActive, pausedStrategies, sessionPaused, activeTrades, tradeHistory } = useTradingStore()
  const [selectedTradeId, setSelectedTradeId] = useState(null)
  const [selectedFocusSymbol, setSelectedFocusSymbol] = useState(null)
  const [showPnl, setShowPnl] = useState(true)
  const [showHitRate, setShowHitRate] = useState(true)
  const [showPf, setShowPf] = useState(false)
  const [showSharpe, setShowSharpe] = useState(false)
  const [showSortino, setShowSortino] = useState(false)
  const [isPausing, setIsPausing] = useState(false)
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)
  const [isChecklistOpen, setIsChecklistOpen] = useState(true)
  const [syncingTfMap, setSyncingTfMap] = useState({})
  const [isBatchSyncing, setIsBatchSyncing] = useState(false)

  // Real-time telemetry & store timestamps
  const lastAuthoritativeUpdateTs = useTradingStore(state => state.lastAuthoritativeUpdateTs || Date.now());
  const lastScanTs = useTradingStore(state => state.lastScanTs);
  const nextScanTs = useTradingStore(state => state.nextScanTs);
  const gateState = useTradingStore(state => state.gateState || 'ACTIVE');
  const gateReason = useTradingStore(state => state.gateReason || 'OK');

  // Live timer tick for data stream age calculation
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // BOLT OPTIMIZATION: Resolve variant-specific configuration if viewing a strategy variant
  const strategyConfig = useMemo(() => {
    if (!config) return {};
    if (!s || !s.strategy_label || s.strategy_label === config.strategy_label) return config;
    const variant = config.strategy_variants?.find(v => v.strategy_label === s.strategy_label);
    if (!variant) return config;

    const baseSymbols = Array.isArray(config.symbols) ? config.symbols : [];
    const hasVariantSymbols = Array.isArray(variant.symbols);
    const hasVariantScannerOverride =
      variant.watchlist_size !== undefined ||
      variant.discovery_mode !== undefined ||
      variant.scan_interval !== undefined ||
      variant.global_scanner_enabled !== undefined;

    const variantSymbols = hasVariantSymbols
      ? variant.symbols
      : (hasVariantScannerOverride ? [] : baseSymbols);

    return { ...config, ...variant, symbols: variantSymbols };
  }, [config, s?.strategy_label]);

  const isVariant = useMemo(() => {
    if (!config || !s?.strategy_label) return false;
    return config.strategy_label !== s.strategy_label;
  }, [config, s?.strategy_label]);

  // Resolve variant-aware timeframe and scanner opportunities list
  const strategyScannerResults = useMemo(() => {
    if (!s || !s.strategy_label) return [];
    if (variantScannerResults && variantScannerResults[s.strategy_label]) {
      return variantScannerResults[s.strategy_label];
    }
    // Strict variant isolation: never leak base strategy scanner results into variant view!
    if (isVariant) {
      return [];
    }
    return scannerResults || [];
  }, [variantScannerResults, scannerResults, s?.strategy_label, isVariant]);

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = sessionActive && isResuming

  // Lifecycle-scoped subscription contract
  useResourceFocus('strategy', s.strategy_label);

  const storeBalance = useTradingStore(state => state.balance);
  const totalSessionPnl = useTradingStore(state => state.totalPnl || 0);

  const startingBal = useMemo(() => {
    const mode = strategyConfig?.trading_mode || (strategyConfig?.paper_mode ? 'paper' : 'live');
    return mode === 'paper'
      ? (strategyConfig?.paper_starting_balance || 10000)
      : (mode === 'testnet'
          ? (strategyConfig?.testnet_starting_balance && strategyConfig.testnet_starting_balance !== 10000
              ? strategyConfig.testnet_starting_balance
              : (storeBalance ? Math.max(1, storeBalance - totalSessionPnl) : 10000))
          : (strategyConfig?.live_starting_balance && strategyConfig.live_starting_balance !== 10000
              ? strategyConfig.live_starting_balance
              : (storeBalance ? Math.max(1, storeBalance - totalSessionPnl) : 10000)));
  }, [strategyConfig, storeBalance, totalSessionPnl]);

  // Per-strategy performance metrics calculation
  const stratPerformance = useMemo(() => {
    const trades = tradeHistory || analytics?.trades || [];
    const filtered = trades.filter(t => (t.strategy_label || 'Momentum Strategy') === s.strategy_label);
    const metrics = calculatePerformanceMetrics(filtered, startingBal);
    const total = filtered.length;

    const rawHitRate = total > 0 ? (metrics.wins / total) * 100 : 0;
    const hitRate = Math.min(100, Math.max(0, rawHitRate));
    const overallWr = typeof analytics?.overallWinRate === 'number' ? analytics.overallWinRate : 50;
    const hitRateRatio = overallWr > 0 ? hitRate / overallWr : 1.0;

    const targetRr = strategyConfig.exit_rr_target || strategyConfig.min_rr || 1.5;
    const breakevenWr = Math.round((1 / (1 + targetRr)) * 100);
    const recommendedWr = Math.min(85, Math.round(breakevenWr * 1.3));

    return {
      total,
      wins: metrics.wins,
      losses: total - metrics.wins,
      sumPnl: metrics.totalPnl,
      hitRate,
      hitRateRatio,
      profitFactor: metrics.profitFactor,
      sharpe: metrics.sharpe,
      sortino: metrics.sortino,
      targetRr,
      breakevenWr,
      recommendedWr
    };
  }, [tradeHistory, analytics, s.strategy_label, strategyConfig]);

  const hitRateRatioText = stratPerformance.hitRateRatio >= 1.15
    ? `${stratPerformance.hitRateRatio.toFixed(2)}x (Expanding)`
    : stratPerformance.hitRateRatio <= 0.85
    ? `${stratPerformance.hitRateRatio.toFixed(2)}x (Contracting)`
    : `${stratPerformance.hitRateRatio.toFixed(2)}x (Stable)`;

  const proximityLeaderboard = useMemo(() => {
    const list = strategyScannerResults || [];

    return list.map(opp => {
      const proximity = calculateOpportunityProximity(opp, strategyConfig);
      return {
        ...opp,
        proximity
      };
    })
    .filter(opp => {
      const isFired = !!(opp.signalResult?.allFired && opp.signalResult?.signals);
      return !isFired && opp.proximity < 100;
    })
    .sort((a, b) => b.proximity - a.proximity);
  }, [strategyScannerResults, strategyConfig]);

  const focusedOpp = useMemo(() => {
    if (selectedFocusSymbol) {
      const found = strategyScannerResults.find(r => r.symbol === selectedFocusSymbol);
      if (found) return found;
    }
    return proximityLeaderboard[0] || strategyScannerResults[0] || { symbol: '---', pct: 0, dir: '---' };
  }, [selectedFocusSymbol, strategyScannerResults, proximityLeaderboard]);

  const bestOpp = focusedOpp;
  const scanMet = Math.abs(bestOpp.pct) >= strategyConfig.scan_pct_threshold;
  const signalResult = bestOpp.signalResult || { allFired: false, firedSignals: [] };
  const entryMet = scanMet && signalResult.allFired;
  const signalsCount = strategyConfig.enabled_signals?.length || 0;
  const firedCount = signalResult.firedSignals?.length || 0;
  const signalLogic = strategyConfig.signal_logic || 'all';
  const requiredSignals = strategyConfig.required_signals || [];

  // Single-pass signal label classification
  const { reqLabels, optLabels } = useMemo(() => {
    const req = [];
    const opt = [];
    const enabled = strategyConfig.enabled_signals || [];
    for (let i = 0; i < enabled.length; i++) {
      const sig = enabled[i];
      const label = SIGNAL_LABELS[sig] || sig;
      if (requiredSignals.includes(sig)) {
        req.push(label);
      } else {
        opt.push(label);
      }
    }
    return { reqLabels: req, optLabels: opt };
  }, [strategyConfig.enabled_signals, requiredSignals]);

  const conditionFormula = signalLogic === 'combo'
    ? `${reqLabels.length > 0 ? `[Req: ${reqLabels.join(' AND ')}]` : '[Req: Base]'} AND ${optLabels.length > 0 ? `[Any: ${optLabels.join(' | ')}]` : '[Any]'}`
    : signalLogic === 'all' ? 'Match All (AND)' : 'Match Any (OR)';

  const isStrategyPaused = pausedStrategies?.includes(s.strategy_label) || sessionPaused;

  const strategyActiveTrades = useMemo(() => {
    if (!activeTrades || !s?.strategy_label) return [];
    return activeTrades.filter(t => t.strategy_label === s.strategy_label);
  }, [activeTrades, s?.strategy_label]);

  const activeTradeCount = strategyActiveTrades.length;

  // Static vs Dynamic Watchlist Metadata
  const staticSymbols = useMemo(() => {
    return Array.isArray(strategyConfig.symbols) ? strategyConfig.symbols.filter(Boolean) : [];
  }, [strategyConfig.symbols]);

  const isStaticWatchlist = staticSymbols.length > 0;

  // Symbol Status Mapping for Static Symbols
  const staticSymbolStatuses = useMemo(() => {
    const map = {};
    for (const sym of staticSymbols) {
      const activeTrade = strategyActiveTrades.find(t => t.symbol === sym);
      if (activeTrade) {
        map[sym] = { state: 'POSITION', label: 'IN POSITION', badgeClass: 'text-green border-green/30 bg-green/10', trade: activeTrade };
        continue;
      }
      const opp = strategyScannerResults.find(r => r.symbol === sym);
      if (opp?.signalResult?.allFired) {
        map[sym] = { state: 'TRIGGERED', label: 'SIGNAL FIRED', badgeClass: 'text-amber border-amber/30 bg-amber/10', opp };
        continue;
      }
      if (opp) {
        const prox = calculateOpportunityProximity(opp, strategyConfig);
        map[sym] = { state: 'EVALUATING', label: `EVALUATING (${prox}%)`, badgeClass: 'text-accent border-accent/30 bg-accent/10', opp };
        continue;
      }
      map[sym] = { state: 'MONITORING', label: 'STATIC TARGET', badgeClass: 'text-dim border-border/40 bg-surface/40' };
    }
    return map;
  }, [staticSymbols, strategyActiveTrades, strategyScannerResults, strategyConfig]);

  // Active Trade / Candidate End-to-End Lifecycle Stage Resolution
  const currentLifecycleStage = useMemo(() => {
    const activeTrade = strategyActiveTrades.find(t => t.symbol === focusedOpp.symbol);
    if (activeTrade) {
      const sl = Number(activeTrade.current_sl ?? activeTrade.sl_price ?? 0);
      const entry = Number(activeTrade.entry_price || 0);
      const isLong = activeTrade.direction === 'LONG';
      const isSlAtBreakeven = sl > 0 && (isLong ? sl >= entry - 1e-6 : sl <= entry + 1e-6);
      
      if (activeTrade.exit_signals_status && Object.values(activeTrade.exit_signals_status).some(s => s?.fired)) {
        return {
          stageNumber: 5,
          title: 'Stage 5: Exit Signal Triggered',
          statusLabel: 'EXIT TRIGGERED',
          colorClass: 'text-red border-red/30 bg-red/10',
          desc: 'Strategy exit condition crossed; order execution or stop loss close pending.'
        };
      }
      if (isSlAtBreakeven || activeTrade.risk_usdt === 0) {
        return {
          stageNumber: 4,
          title: 'Stage 4: Risk Protected Position',
          statusLabel: 'RISK PROTECTED',
          colorClass: 'text-green border-green/30 bg-green/10',
          desc: 'Stop loss ratcheted to breakeven or better (0.00R capital risk).'
        };
      }
      return {
        stageNumber: 4,
        title: 'Stage 4: Active Managed Position',
        statusLabel: 'IN POSITION',
        colorClass: 'text-accent border-accent/30 bg-accent/10',
        desc: 'Position active on exchange with active SL/TP and trailing ratchet monitoring.'
      };
    }

    if (entryMet) {
      return {
        stageNumber: 3,
        title: 'Stage 3: Risk Guard & Execution',
        statusLabel: 'SIGNAL FIRED',
        colorClass: 'text-amber border-amber/30 bg-amber/10',
        desc: 'All entry signals matched; anti-whipsaw, leverage, and capital risk checks executing.'
      };
    }

    if (scanMet || firedCount > 0) {
      return {
        stageNumber: 2,
        title: 'Stage 2: Technical Signal Evaluation',
        statusLabel: 'EVALUATING',
        colorClass: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',
        desc: `${firedCount}/${signalsCount} entry rules satisfied; evaluating trigger formula.`
      };
    }

    return {
      stageNumber: 1,
      title: 'Stage 1: Scope & Discovery',
      statusLabel: 'MONITORING',
      colorClass: 'text-dim border-border/40 bg-surface/40',
      desc: isStaticWatchlist ? 'Monitored in defined Static Watchlist target list.' : 'Scanned via Smart Watchlist discovery feed.'
    };
  }, [focusedOpp, strategyActiveTrades, entryMet, scanMet, firedCount, signalsCount, isStaticWatchlist]);

  const selectedTrade = useMemo(() => {
    return (strategyActiveTrades || []).find(t => t.id === selectedTradeId || t.symbol === selectedTradeId);
  }, [strategyActiveTrades, selectedTradeId]);

  const handleCloseTrade = async (symbol) => {
    try {
      await sessionAPI.closeTrade(symbol);
      setSelectedTradeId(null);
      useTradingStore.getState().addAlert({ level: 'success', title: 'Liquidation Started', message: `Manual closure request for ${symbol} sent to exchange.` });
    } catch (e) {
      useTradingStore.getState().addAlert({ level: 'error', title: 'Closure Failed', message: e?.response?.data?.message || e.message || 'Could not close position.' });
    }
  };

  // Manual Kline Backfill / Sync Action
  const handleSyncTimeframe = async (tf, targetSymbol) => {
    const symbol = targetSymbol || bestOpp.symbol;
    if (!symbol || symbol === '---' || !tf) return;

    setSyncingTfMap(prev => ({ ...prev, [tf]: true }));
    try {
      const res = await sessionAPI.backfillKlines(symbol, tf);
      const data = res?.data;

      useTradingStore.getState().addAlert({
        level: data?.isWarmupComplete ? 'success' : 'info',
        title: data?.isWarmupComplete ? 'Warmup Complete' : 'Timeframe Synced',
        message: data?.message || `Synced ${tf} candles for ${symbol}.`
      });
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to sync candles.';
      useTradingStore.getState().addAlert({
        level: 'warn',
        title: 'Sync Notice',
        message: msg
      });
    } finally {
      setSyncingTfMap(prev => ({ ...prev, [tf]: false }));
    }
  };

  // Batch sync all evaluation timeframes for current strategy
  const handleBatchSyncTimeframes = async () => {
    const symbol = bestOpp.symbol;
    if (!symbol || symbol === '---') return;

    setIsBatchSyncing(true);
    try {
      const timeframes = new Set();
      const enabled = strategyConfig.enabled_signals || [];
      const scanTf = strategyConfig.scan_interval || '1m';
      timeframes.add(scanTf);

      for (const sig of enabled) {
        const rawTf = (strategyConfig.signal_timeframes || {})[sig];
        const tf = (!rawTf || rawTf === 'default') ? scanTf : rawTf;
        timeframes.add(tf);
      }

      for (const tf of timeframes) {
        await handleSyncTimeframe(tf, symbol);
      }
    } finally {
      setIsBatchSyncing(false);
    }
  };

  // Evaluation Timeframe Debug Table Data Construction
  const timeframeDebugItems = useMemo(() => {
    const enabled = strategyConfig.enabled_signals || [];
    const scanTf = strategyConfig.scan_interval || '1m';
    const items = [];

    // 1. Primary Scanner Timeframe
    const ohlcLen = bestOpp.ohlc_history?.length || bestOpp.history?.length || 0;
    const reqScanWarmup = 50;
    items.push({
      key: 'scanner',
      label: 'Scanner Velocity',
      tf: scanTf,
      candles: ohlcLen > 0 ? ohlcLen : 200,
      required: reqScanWarmup,
      isWarming: ohlcLen > 0 && ohlcLen < reqScanWarmup,
      statusMsg: ohlcLen >= reqScanWarmup || ohlcLen === 0 ? 'Ready' : `Warming (${ohlcLen}/${reqScanWarmup})`
    });

    // 2. Technical Indicator Evaluation Timeframes
    for (const sig of enabled) {
      const rawTf = (strategyConfig.signal_timeframes || {})[sig];
      const tf = (!rawTf || rawTf === 'default') ? scanTf : rawTf;
      const sigDetail = signalResult.signals?.[sig] || {};

      const candles = sigDetail.value && typeof sigDetail.value === 'number' && sigDetail.insufficientData
        ? sigDetail.value
        : (ohlcLen > 0 ? ohlcLen : 200);
      const required = sigDetail.threshold && typeof sigDetail.threshold === 'number' && sigDetail.insufficientData
        ? sigDetail.threshold
        : 100;
      const isWarming = sigDetail.insufficientData === true || candles < required;

      items.push({
        key: sig,
        label: SIGNAL_LABELS[sig] || sig,
        tf,
        candles,
        required,
        isWarming,
        statusMsg: isWarming ? `Warming (${candles}/${required})` : 'Ready'
      });
    }

    return items;
  }, [strategyConfig, bestOpp, signalResult]);

  // Compute live telemetry stats
  const streamAgeSec = Math.max(0, ((nowMs - lastAuthoritativeUpdateTs) / 1000)).toFixed(1);
  const streamFresh = streamAgeSec < 5.0;
  const regimeInfo = getMarketRegimeInfo(strategyScannerResults, strategyConfig, { scannerPaused: isStrategyPaused });

  return (
    <div className="max-w-[1200px] mx-auto p-3 md:p-8 animate-in fade-in duration-300 pb-32 lg:pb-10">
      <ViewHeader
        icon={Activity}
        title={s.strategy_label}
        subTitle={`Strategy Engine · ${s.strategyId?.substring(0, 8)}`}
        backAction={onBack}
      >
         <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap py-0.5 justify-end">
           <CopyButton value={s.strategyId} className="p-1.5 hidden sm:inline-flex" />
           <div className="flex items-center gap-1.5 bg-surface/60 border border-border/40 rounded-xl px-2.5 py-1">
             <StatusBadge status={s.sessionActive} />
             {isVariant && (
               <span className="text-[10px] font-mono font-bold text-purple uppercase tracking-wider">
                 · Variant
               </span>
             )}
             <span className="text-[10px] font-mono font-bold text-dim uppercase tracking-wider">
               · {activeTradeCount} Active
             </span>
           </div>

           {/* Strategy Control Actions */}
           <div className="flex items-center gap-1.5 shrink-0">
             {sessionActive && (
               <Tooltip content={isStrategyPaused ? "Resume Strategy Automation" : "Pause Strategy Automation"}>
                 <button
                   type="button"
                   disabled={isPausing}
                   aria-busy={isPausing}
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
                     "px-2.5 py-1.5 min-h-[32px] sm:px-3 rounded-xl border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0 cursor-pointer active:scale-95",
                     isPausing ? "cursor-wait opacity-60 text-dim bg-surface border-border" : (
                       isStrategyPaused
                         ? "bg-green/10 text-green border-green/20 hover:bg-green/20"
                         : "bg-amber/10 text-amber border-amber/20 hover:bg-amber/20"
                     )
                   )}
                   aria-label={isPausing ? (isStrategyPaused ? "Resuming strategy..." : "Pausing strategy...") : (isStrategyPaused ? "Resume strategy" : "Pause strategy")}
                 >
                   {isPausing ? <Loader2 size={12} className="animate-spin text-accent" /> : (isStrategyPaused ? <Play size={12} fill="currentColor" /> : <Pause size={12} fill="currentColor" />)}
                   <span>{isPausing ? (isStrategyPaused ? "Resuming..." : "Pausing...") : (isStrategyPaused ? "Resume" : "Pause")}</span>
                 </button>
               </Tooltip>
             )}

             {!isVariant && (
               <Tooltip content="Edit Strategy Configuration">
                 <button
                   type="button"
                   onClick={onEdit}
                   className="px-2.5 py-1.5 min-h-[32px] sm:px-3 bg-surface border border-border text-dim hover:text-accent hover:border-accent/40 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0 cursor-pointer"
                   aria-label="Edit strategy configuration"
                 >
                   <Edit3 size={12} />
                   <span>Edit</span>
                 </button>
               </Tooltip>
             )}
           </div>
         </div>
      </ViewHeader>

      {/* KPI Performance Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2.5 md:gap-3.5 mb-6">
        <StatCard
          label="Active P&L"
          value={fmtUSD(s.activePnl)}
          color={pnlClass(s.activePnl)}
          subValue={analytics === null ? "Syncing..." : `Total: ${fmtUSD(s.totalPnl)}`}
          syncing={showResumingFeedback || isSyncing || (analytics === null && s.activePnl === 0)}
        />
        <StatCard
          label="Hit Rate %"
          value={`${stratPerformance.hitRate.toFixed(1)}%`}
          color={stratPerformance.hitRate >= stratPerformance.recommendedWr ? "text-green" : "text-amber"}
          subValue={`Target: >=${stratPerformance.recommendedWr}% (BE: ${stratPerformance.breakevenWr}%)`}
          tooltipText={`Strategy Win Rate. Dynamic recommendation based on ${stratPerformance.targetRr}R target: Breakeven >= ${stratPerformance.breakevenWr}%, Recommended Target >= ${stratPerformance.recommendedWr}%.`}
        />
        <StatCard
          label="Hit Rate Ratio"
          value={hitRateRatioText}
          color={stratPerformance.hitRateRatio >= 1.15 ? "text-green" : stratPerformance.hitRateRatio <= 0.85 ? "text-amber" : "text-text"}
          subValue={`Baseline: ${(typeof analytics?.overallWinRate === 'number' ? analytics.overallWinRate : 50).toFixed(0)}%`}
          tooltipText="Hit rate ratio relative to overall performance baseline. Thresholds: >= 1.15 Expansion, <= 0.85 Contraction."
        />
        <StatCard
          label="Profit Factor"
          value={stratPerformance.total > 0 ? stratPerformance.profitFactor.toFixed(2) : '---'}
          color={stratPerformance.profitFactor >= 1.5 ? "text-green" : stratPerformance.profitFactor >= 1.0 ? "text-amber" : "text-text"}
          subValue="Target: >= 1.50"
          tooltipText="Profit Factor (Gross Wins / Gross Losses). Recommended: > 1.00 (Profitable), >= 1.50 (Solid), >= 2.00 (Excellent)."
        />
        <StatCard
          label="Sharpe (Sh)"
          value={stratPerformance.total > 1 ? stratPerformance.sharpe.toFixed(2) : '---'}
          color={stratPerformance.sharpe >= 1.5 ? "text-green" : stratPerformance.sharpe >= 1.0 ? "text-amber" : stratPerformance.sharpe < 0 ? "text-red" : "text-text"}
          subValue="Target: >= 1.50"
          tooltipText="Sharpe Ratio (Risk-Adjusted Return). Recommended: >= 1.00 (Acceptable), >= 1.50 (Good), >= 2.00 (Excellent)."
        />
        <StatCard
          label="Sortino (So)"
          value={stratPerformance.total > 1 ? stratPerformance.sortino.toFixed(2) : '---'}
          color={stratPerformance.sortino >= 2.0 ? "text-green" : stratPerformance.sortino >= 1.0 ? "text-amber" : stratPerformance.sortino < 0 ? "text-red" : "text-text"}
          subValue="Target: >= 2.00"
          tooltipText="Sortino Ratio (Downside Risk-Adjusted Return). Recommended: >= 1.00 (Acceptable), >= 2.00 (Good), >= 3.00 (Excellent)."
        />
        <StatCard
          label="Active Risk"
          value={`${Number(s.totalRiskPct || 0).toFixed(1)}%`}
          color={s.totalRiskPct > strategyConfig.max_total_risk_pct * 0.8 ? "text-amber" : "text-text"}
          subValue={`Limit: ${strategyConfig.max_total_risk_pct || 5}%`}
          tooltipText="Total active risk exposure across open positions."
        />
        <StatCard
          label="Active Trades"
          value={activeTradeCount.toString()}
          color={activeTradeCount > 0 ? "text-green" : "text-dim"}
          subValue={activeTradeCount > 0 ? "In Position" : "Flat"}
          tooltipText="The number of open positions currently managed under this strategy."
        />
      </div>

      {/* Performance Analytics & Dual-Axis Overlay Chart */}
      <div className="mb-6 border border-border/40 bg-surface/30 rounded-2xl overflow-hidden transition-all flex flex-col gap-3 p-3.5 sm:p-4 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3 pb-2.5 border-b border-border/20">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <BarChart3 size={13} />
            </div>
            <div>
              <span className="text-xs font-black uppercase tracking-wider text-text">Strategy Performance Overlay</span>
              <p className="text-[9px] text-dim font-medium">Cumulative PnL ($) and rolling Hit Rate (%)</p>
            </div>
          </div>

          <div className="flex items-center p-0.5 bg-surface/60 rounded-xl border border-border/40 text-dim flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setShowPnl(!showPnl)}
              aria-pressed={showPnl}
              className={cn(
                "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                showPnl ? "bg-surface border border-border/60 text-green" : "text-dim/60 hover:text-dim"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", showPnl ? "bg-green" : "bg-dim/30")} />
              PnL
            </button>
            <button
              type="button"
              onClick={() => setShowHitRate(!showHitRate)}
              aria-pressed={showHitRate}
              className={cn(
                "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                showHitRate ? "bg-surface border border-border/60 text-accent" : "text-dim/60 hover:text-dim"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", showHitRate ? "bg-accent" : "bg-dim/30")} />
              Hit Rate
            </button>
            <button
              type="button"
              onClick={() => setShowPf(!showPf)}
              aria-pressed={showPf}
              className={cn(
                "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                showPf ? "bg-surface border border-border/60 text-purple" : "text-dim/60 hover:text-dim"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", showPf ? "bg-purple" : "bg-dim/30")} />
              PF
            </button>
            <button
              type="button"
              onClick={() => setShowSharpe(!showSharpe)}
              aria-pressed={showSharpe}
              className={cn(
                "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                showSharpe ? "bg-surface border border-border/60 text-amber" : "text-dim/60 hover:text-dim"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", showSharpe ? "bg-amber" : "bg-dim/30")} />
              Sh
            </button>
            <button
              type="button"
              onClick={() => setShowSortino(!showSortino)}
              aria-pressed={showSortino}
              className={cn(
                "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                showSortino ? "bg-surface border border-border/60 text-cyan-400" : "text-dim/60 hover:text-dim"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", showSortino ? "bg-cyan-400" : "bg-dim/30")} />
              So
            </button>
          </div>
        </div>

        {(showPnl || showHitRate || showPf || showSharpe || showSortino) ? (
          <Suspense fallback={
            <div className="h-[200px] w-full flex items-center justify-center bg-background/20 rounded-xl border border-border/30">
              <Loader2 size={18} className="animate-spin text-accent" />
            </div>
          }>
            <LazyStrategyPerformanceOverlayChart
              trades={(tradeHistory || analytics?.trades || []).filter(t => (t.strategy_label || 'Momentum Strategy') === s.strategy_label)}
              height={200}
              showPnl={showPnl}
              showHitRate={showHitRate}
              showPf={showPf}
              showSharpe={showSharpe}
              showSortino={showSortino}
              startingBalance={startingBal}
            />
          </Suspense>
        ) : (
          <div className="py-6 flex flex-col items-center justify-center text-center bg-background/20 border border-dashed border-border/40 rounded-xl">
            <BarChart3 size={18} className="text-dim/40 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-dim">Chart layers hidden</span>
          </div>
        )}

        <div className="pt-2 border-t border-border/20">
          <button
            type="button"
            onClick={() => setIsCalendarOpen(!isCalendarOpen)}
            aria-expanded={isCalendarOpen}
            aria-controls="calendar-content"
            className="w-full py-2 flex items-center justify-between text-left hover:bg-surface/50 transition-colors cursor-pointer rounded-xl px-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <div className="flex items-center gap-2">
              <CalendarIcon size={12} className="text-accent" />
              <span className="text-[10px] font-black uppercase tracking-wider text-text">Daily Calendar Breakdown</span>
            </div>
            <ChevronDown size={14} className={cn("text-dim transition-transform duration-200", isCalendarOpen && "rotate-180")} />
          </button>
          {isCalendarOpen && (
            <div id="calendar-content" className="pt-2 animate-in fade-in duration-200">
              <Suspense fallback={
                <div className="h-[120px] w-full flex items-center justify-center bg-background/20 rounded-xl border border-border/30">
                  <Loader2 size={16} className="animate-spin text-accent" />
                </div>
              }>
                <LazyStrategyCalendarPnL trades={tradeHistory || analytics?.trades || []} strategyFilter={s.strategy_label} />
              </Suspense>
            </div>
          )}
        </div>
      </div>

      {/* REDESIGNED UNIFIED STRATEGY ENGINE & SIGNAL PIPELINE */}
      <div className="mb-8 border border-border/50 bg-surface/20 rounded-2xl overflow-hidden text-left shadow-sm">
        {/* Streamlined Live Pipeline & Freshness Telemetry Header */}
        <div className="p-3.5 sm:p-4 bg-surface/50 border-b border-border/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
              <Cpu size={14} />
            </div>
            <div>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-xs font-black uppercase tracking-wider text-text">Engine Pipeline</span>
                <span className={cn(
                  "px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase border",
                  isStrategyPaused ? "bg-amber/10 text-amber border-amber/30" : "bg-green/10 text-green border-green/30"
                )}>
                  {isStrategyPaused ? 'PAUSED' : 'ACTIVE'}
                </span>
                <span className="text-[10px] text-dim/60 font-medium">·</span>
                <span className="text-[9.5px] text-dim font-medium uppercase">{gateReason || 'OK'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-[10px] text-dim self-stretch sm:self-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-border/20">
            {/* Market Regime Badge */}
            <Tooltip content={regimeInfo.guidance}>
              <div className={cn(
                "px-2 py-0.5 rounded-lg border flex items-center gap-1 cursor-help",
                regimeInfo.badgeClass
              )}>
                {regimeInfo.regime === 'slow' && <Turtle size={10} className="shrink-0 text-cyan-400" />}
                {regimeInfo.regime === 'active' && <Flame size={10} className="shrink-0 text-accent animate-pulse" />}
                {regimeInfo.regime === 'moderate' && <Zap size={10} className="shrink-0 text-amber" />}
                <span className="font-black uppercase tracking-wider">{regimeInfo.label}</span>
              </div>
            </Tooltip>

            {/* Stream Freshness & Telemetry */}
            <div className="flex items-center gap-1.5 text-dim/80">
              <Radio size={11} className={streamFresh ? "text-green animate-pulse" : "text-amber"} />
              <span>{streamFresh ? `Live (${streamAgeSec}s)` : `Syncing (${streamAgeSec}s)`}</span>
            </div>

            {/* Batch Sync Action Button */}
            <button
              type="button"
              disabled={isBatchSyncing || bestOpp.symbol === '---'}
              onClick={handleBatchSyncTimeframes}
              className={cn(
                "px-2.5 py-1 bg-surface border border-border/60 hover:border-accent/40 text-text rounded-lg text-[9.5px] font-black uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                isBatchSyncing && "opacity-60 cursor-wait"
              )}
              aria-label="Batch sync all evaluation timeframes"
            >
              <RefreshCw size={10} className={cn(isBatchSyncing && "animate-spin text-accent")} />
              <span>{isBatchSyncing ? 'Syncing...' : 'Sync All'}</span>
            </button>
          </div>
        </div>

        {/* Watchlist Proximity Leaderboard */}
        {proximityLeaderboard.length > 0 && (
          <div className="p-3.5 bg-background/30 border-b border-border/20">
            <div className="flex justify-between items-center mb-2 font-mono">
              <span className="text-[9px] font-black text-dim uppercase tracking-widest flex items-center gap-1">
                <Zap size={11} className="text-accent" /> Watchlist Proximity Leaderboard
              </span>
              <span className="text-[8.5px] text-dim/60 uppercase">Sorted by Proximity %</span>
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
                      "p-2 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                      isSelected
                        ? "bg-accent/10 border-accent text-accent shadow-xs"
                        : isFired
                        ? "bg-green/5 border-green/30 text-green"
                        : "bg-surface/40 border-border/40 hover:border-border text-text"
                    )}
                  >
                    <div className="flex justify-between items-center font-mono">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-black">{opp.symbol}</span>
                        <span className={cn(
                          "text-[7.5px] font-black uppercase px-1 py-0.2 rounded border",
                          (opp.dir === 'long' || opp.pct >= 0)
                            ? "text-green border-green/30 bg-green/10"
                            : "text-red border-red/30 bg-red/10"
                        )}>
                          {(opp.dir || (opp.pct >= 0 ? 'long' : 'short')).toUpperCase()}
                        </span>
                      </div>
                      <span className={cn(
                        "text-[8.5px] font-mono font-bold px-1 rounded",
                        isFired ? "bg-green/20 text-green" : "bg-surface text-dim"
                      )}>
                        {opp.proximity}%
                      </span>
                    </div>

                    <div className="h-1 bg-background/80 rounded-full overflow-hidden relative border border-white/5">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
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

        {/* Watchlist Scope & Target Universe */}
        <div className="p-3 bg-surface/30 border-b border-border/20 flex flex-col gap-2">
          <div className="flex items-center justify-between font-mono flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <Target size={12} className="text-accent" />
              <span className="text-[10px] font-black uppercase tracking-wider text-text">Watchlist Scope & Universe</span>
              <span className={cn(
                "px-2 py-0.5 rounded text-[8.5px] font-bold uppercase border",
                isStaticWatchlist ? "bg-purple/10 text-purple border-purple/30" : "bg-cyan-400/10 text-cyan-400 border-cyan-400/30"
              )}>
                {isStaticWatchlist ? `STATIC WATCHLIST (${staticSymbols.length})` : `SMART WATCHLIST (Top ${strategyConfig.watchlist_size || 15})`}
              </span>
            </div>

            <span className="text-[9px] text-dim font-mono">
              {isStaticWatchlist
                ? 'Target pairs explicitly defined in strategy config'
                : `Discovery: ${(strategyConfig.discovery_mode || 'volume').toUpperCase()} · Interval: ${strategyConfig.scan_interval || '5m'}`}
            </span>
          </div>

          {/* Static Watchlist Symbol Chips */}
          {isStaticWatchlist && staticSymbols.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1 font-mono">
              {staticSymbols.map(sym => {
                const info = staticSymbolStatuses[sym] || { label: 'STATIC TARGET', badgeClass: 'text-dim border-border/40 bg-surface/40' };
                const isSelected = focusedOpp.symbol === sym;

                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setSelectedFocusSymbol(sym)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg border text-[10px] font-bold flex items-center gap-1.5 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                      isSelected ? "bg-accent/20 border-accent text-accent shadow-xs" : info.badgeClass
                    )}
                  >
                    <span>{sym}</span>
                    <span className="text-[8px] opacity-80 uppercase font-black font-mono tracking-tight">· {info.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* End-to-End Trade Lifecycle Pipeline Visualizer */}
        <div className="p-3.5 bg-background/20 border-b border-border/20 font-mono flex flex-col gap-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Compass size={13} className="text-accent" />
              <span className="text-[10px] font-black uppercase tracking-wider text-text">Trade Lifecycle Pipeline</span>
              <span className={cn("px-2 py-0.5 rounded text-[8.5px] font-black uppercase border", currentLifecycleStage.colorClass)}>
                {currentLifecycleStage.statusLabel}
              </span>
            </div>
            <span className="text-[9px] text-dim">
              Target: <strong className="text-text">{focusedOpp.symbol}</strong> · {currentLifecycleStage.desc}
            </span>
          </div>

          {/* 5-Stage Step Visualizer Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 relative">
            {[
              { num: 1, label: '1. Discovery', short: 'Scope' },
              { num: 2, label: '2. Signals', short: 'Evaluation' },
              { num: 3, label: '3. Risk Check', short: 'Execution' },
              { num: 4, label: '4. Active Trade', short: 'Protection' },
              { num: 5, label: '5. Resolution', short: 'Exit' }
            ].map(step => {
              const isCurrent = currentLifecycleStage.stageNumber === step.num;
              const isPassed = currentLifecycleStage.stageNumber > step.num;

              return (
                <div
                  key={step.num}
                  className={cn(
                    "p-1.5 rounded-lg border text-center flex flex-col items-center justify-center gap-0.5 transition-all",
                    isCurrent
                      ? "bg-accent/15 border-accent text-accent shadow-xs font-black"
                      : isPassed
                      ? "bg-green/10 border-green/30 text-green font-bold"
                      : "bg-surface/30 border-border/30 text-dim/60 font-medium"
                  )}
                >
                  <span className="text-[9.5px] leading-tight font-black uppercase">{step.label}</span>
                  <span className="text-[7.5px] text-dim/70 font-mono uppercase">{step.short}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Focused Candidate Inspector & Signal Checklist */}
        <div className="p-3.5 sm:p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border/20 font-mono">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase text-text">Candidate Signal Inspector</span>
              <span className="px-2 py-0.5 bg-surface border border-border text-accent rounded-md text-[10px] font-black">
                {bestOpp.symbol} {bestOpp.dir ? bestOpp.dir.toUpperCase() : 'NEUTRAL'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9.5px]">
              <span className="text-dim">Formula:</span>
              <span className="text-text font-bold">{conditionFormula}</span>
              <span className={cn(
                "px-2 py-0.5 rounded text-[8.5px] font-black uppercase border",
                entryMet ? "bg-green/10 text-green border-green/20" : "bg-amber/10 text-amber border-amber/20"
              )}>
                {entryMet ? 'TRIGGERED' : 'PENDING'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left Column: Signal Gauges */}
            <div className="lg:col-span-2 flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                <SignalGauge
                  label="Velocity Move"
                  value={Math.abs(bestOpp.pct || 0)}
                  threshold={strategyConfig.scan_pct_threshold || 2.0}
                  unit="%"
                  fired={scanMet}
                  active={scanMet}
                  markPrice={bestOpp.close || 0}
                />

                {(strategyConfig.enabled_signals || []).map(sig => {
                  const sigDetail = signalResult.signals?.[sig] || { fired: false, active: true, label: SIGNAL_LABELS[sig] || sig };
                  return (
                    <SignalGauge
                      key={sig}
                      label={SIGNAL_LABELS[sig] || sig}
                      value={sigDetail.value}
                      threshold={sigDetail.threshold}
                      unit={sigDetail.unit}
                      fired={sigDetail.fired}
                      active={sigDetail.active !== false}
                      remainingDelay={sigDetail.remaining_delay || 0}
                      configDelay={sigDetail.config_delay || 0}
                      insufficientData={sigDetail.insufficientData}
                      thresholdIsPrice={sigDetail.threshold_is_price}
                      isLong={bestOpp.dir === 'long'}
                      markPrice={bestOpp.close || sigDetail.value || 0}
                      type="entry"
                    />
                  );
                })}
              </div>
            </div>

            {/* Right Column: Timeframe Candle Warmup & Freshness Debug Inspector */}
            <div className="bg-background/40 border border-border/40 rounded-xl p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between border-b border-border/20 pb-2">
                <span className="text-[10px] font-black text-dim uppercase tracking-wider flex items-center gap-1.5 font-mono">
                  <Clock size={12} className="text-accent" /> Timeframe & Warmup Debug
                </span>
                <span className="text-[8.5px] font-mono text-dim/60 uppercase">Buffer Freshness</span>
              </div>

              <div className="flex flex-col gap-2">
                {timeframeDebugItems.map(item => {
                  const pct = item.required > 0 ? Math.min(100, Math.round((item.candles / item.required) * 100)) : 100;
                  const isSyncingThis = syncingTfMap[item.tf];

                  return (
                    <div key={item.key} className="p-2 bg-surface/50 border border-border/30 rounded-lg flex flex-col gap-1 font-mono">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-bold text-text flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                          {item.label} <span className="text-dim/60">({item.tf})</span>
                        </span>
                        <span className={cn("font-bold", item.isWarming ? "text-amber" : "text-green")}>
                          {item.statusMsg}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[9px] text-dim">
                        <div className="flex-1 bg-background/80 rounded-full h-1 overflow-hidden relative border border-white/5">
                          <div
                            className={cn("h-full transition-all duration-300", item.isWarming ? "bg-amber" : "bg-green")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="shrink-0">{pct}%</span>
                        <button
                          type="button"
                          disabled={isSyncingThis || bestOpp.symbol === '---'}
                          onClick={() => handleSyncTimeframe(item.tf, bestOpp.symbol)}
                          className={cn(
                            "px-1.5 py-0.5 bg-surface hover:bg-surface-light border border-border text-text rounded text-[8px] uppercase font-bold flex items-center gap-0.5 transition-all cursor-pointer focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                            isSyncingThis && "opacity-60 cursor-wait"
                          )}
                          aria-label={`Sync ${item.tf} candles for ${bestOpp.symbol}`}
                        >
                          <RefreshCw size={8} className={cn(isSyncingThis && "animate-spin text-accent")} />
                          <span>Sync</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Positions List for Strategy Details */}
      {activeTradeCount > 0 && (
        <div className="mb-8 animate-in fade-in duration-300 text-left">
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

      {/* Scanner Preview */}
      <ScannerPreview
        scannerResults={strategyScannerResults}
        config={strategyConfig}
        onOpen={() => onOpenScanner(s.strategy_label)}
      />

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
  )
}

export default StrategyDetailView
