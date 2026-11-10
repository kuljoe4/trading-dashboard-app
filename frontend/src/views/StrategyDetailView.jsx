import React, { useMemo, useState, useEffect, useCallback, Suspense } from 'react'
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
import { ScannerPreview } from '../components/ScannerPreview'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Activity, BarChart3, TrendingUp, Zap, Pause, Play, Edit3, Loader2, Calendar as CalendarIcon, ChevronDown, Turtle, Flame,
  RefreshCw, Clock, CheckCircle2, AlertCircle, Radio, Layers, Search, ShieldCheck, Cpu, ArrowUpRight, Target, Compass, ArrowRight, Lock,
  Copy, Check, Filter, AlertTriangle, ShieldAlert, FileText, ChevronRight, X
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
  const [activeTab, setActiveTab] = useState('pipeline') // 'pipeline' | 'performance' | 'decisions'
  const [showAllStaticSymbols, setShowAllStaticSymbols] = useState(false)
  const [showWarmupDebug, setShowWarmupDebug] = useState(false)
  const [showScannerPreview, setShowScannerPreview] = useState(false)
  const [expandedReasonIds, setExpandedReasonIds] = useState({})
  const toggleReasonDetails = useCallback((id) => {
    setExpandedReasonIds(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Journey Map & Reasons Log State
  const [activeJourneyMilestone, setActiveJourneyMilestone] = useState(null)
  const [reasonsFilter, setReasonsFilter] = useState('all') // 'all' | 'signals' | 'gates' | 'entries' | 'exits'
  const [reasonsSearch, setReasonsSearch] = useState('')
  const [copiedReasonId, setCopiedReasonId] = useState(null)

  const logs = useTradingStore(state => state.logs || [])
  const strategyGateStates = useTradingStore(state => state.strategyGateStates || {})

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

  const stratName = s?.strategy_label || 'Momentum Strategy';
  const stratGate = strategyGateStates[stratName] || {};
  const effectiveGate = stratGate.gateState || (isVariant ? 'ACTIVE' : gateState);
  const effectiveReason = stratGate.gateReason || (isVariant ? (stratGate.gateState ? stratGate.gateState : 'OK') : gateReason);

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

  const strategyActiveTrades = useMemo(() => {
    if (!activeTrades || !s?.strategy_label) return [];
    return activeTrades.filter(t => t.strategy_label === s.strategy_label);
  }, [activeTrades, s?.strategy_label]);

  const activeTradeCount = strategyActiveTrades.length;

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
    if (proximityLeaderboard[0]) return proximityLeaderboard[0];
    if (strategyScannerResults[0]) return strategyScannerResults[0];
    if (strategyActiveTrades[0]) {
      return {
        symbol: strategyActiveTrades[0].symbol,
        pct: 0,
        dir: strategyActiveTrades[0].direction?.toLowerCase() || 'long',
        close: strategyActiveTrades[0].entry_price || 0,
        signalResult: { allFired: true, firedSignals: strategyConfig.enabled_signals || [] }
      };
    }
    return { symbol: '---', pct: 0, dir: '---' };
  }, [selectedFocusSymbol, strategyScannerResults, proximityLeaderboard, strategyActiveTrades, strategyConfig.enabled_signals]);

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
          stageNumber: 6,
          title: 'Stage 6: Exit Signal Triggered',
          statusLabel: 'EXIT TRIGGERED',
          colorClass: 'text-red border-red/30 bg-red/10',
          desc: 'Strategy exit condition crossed; order execution or stop loss close pending.'
        };
      }
      if (isSlAtBreakeven || activeTrade.risk_usdt === 0) {
        return {
          stageNumber: 5,
          title: 'Stage 5: Risk Protected Position',
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

  // 6-Milestone Interactive Journey Map Specification
  const journeyMilestones = useMemo(() => {
    return [
      {
        num: 1,
        title: '1. Discovery & Universe',
        subtitle: 'Market Scope',
        short: 'Scope',
        status: isStaticWatchlist ? 'STATIC' : 'DISCOVERY',
        isPassed: true,
        isActive: currentLifecycleStage.stageNumber === 1,
        badgeClass: 'text-dim border-border/40 bg-surface/40',
        desc: isStaticWatchlist
          ? `Fixed universe of ${staticSymbols.length} pairs explicitly monitored in strategy configuration.`
          : `Smart discovery scanning 24h ${strategyConfig.discovery_mode || 'volume'} universe on ${strategyConfig.scan_interval || '5m'} interval.`,
        criteria: [
          { label: 'Watchlist Universe', value: isStaticWatchlist ? `${staticSymbols.length} Static Symbols` : `Top ${strategyConfig.watchlist_size || 15} by ${strategyConfig.discovery_mode || 'volume'}` },
          { label: 'Min 24h Volume', value: `$${((strategyConfig.scan_min_volume_usdt || 500000) / 1000).toLocaleString()}k USDT` },
          { label: 'Scan Interval', value: strategyConfig.scan_interval || '5m' },
          { label: 'Velocity Threshold', value: `±${strategyConfig.scan_pct_threshold || 2.0}%` }
        ]
      },
      {
        num: 2,
        title: '2. Technical Signal Engine',
        subtitle: 'Rule Formula',
        short: 'Signals',
        status: entryMet ? 'TRIGGERED' : (firedCount > 0 ? `${firedCount}/${signalsCount} FIRED` : 'EVALUATING'),
        isPassed: currentLifecycleStage.stageNumber > 2,
        isActive: currentLifecycleStage.stageNumber === 2,
        badgeClass: entryMet ? 'text-green border-green/30 bg-green/10' : firedCount > 0 ? 'text-accent border-accent/30 bg-accent/10' : 'text-dim border-border/40 bg-surface/40',
        desc: `Evaluating ${signalsCount} configured technical signals with '${signalLogic.toUpperCase()}' matching logic.`,
        criteria: [
          { label: 'Formula Logic', value: conditionFormula },
          { label: 'Enabled Signals', value: (strategyConfig.enabled_signals || []).map(s => SIGNAL_LABELS[s] || s).join(', ') || 'None' },
          { label: 'Required Signals (AND)', value: reqLabels.join(', ') || 'None (All equal)' },
          { label: 'Buffer Warmup', value: `${timeframeDebugItems.filter(i => !i.isWarming).length}/${timeframeDebugItems.length} Timeframes Ready` }
        ]
      },
      {
        num: 3,
        title: '3. Pre-Trade Risk & Capital Gating',
        subtitle: 'Safety Invariants',
        short: 'Risk Check',
        status: isStrategyPaused ? 'PAUSED' : (effectiveGate === 'ACTIVE' || effectiveGate === 'OK') ? 'READY' : 'GATED',
        isPassed: currentLifecycleStage.stageNumber > 3,
        isActive: currentLifecycleStage.stageNumber === 3,
        badgeClass: isStrategyPaused ? 'text-amber border-amber/30 bg-amber/10' : (effectiveGate === 'ACTIVE' || effectiveGate === 'OK') ? 'text-green border-green/30 bg-green/10' : 'text-red border-red/30 bg-red/10',
        desc: 'Anti-whipsaw, sliding frequency limits, trade spacing, and maximum account risk exposure checks.',
        criteria: [
          { label: 'Account Max Risk', value: `${strategyConfig.max_total_risk_pct || 5.0}% Total Portfolio Cap` },
          { label: 'Risk Per Trade', value: `${strategyConfig.risk_pct_per_trade || 1.0}% ($${((startingBal * (strategyConfig.risk_pct_per_trade || 1.0)) / 100).toFixed(2)})` },
          { label: 'Max Open Trades', value: `${strategyConfig.max_open_trades || 3} positions` },
          { label: 'Spacing & Anti-Whipsaw', value: `${strategyConfig.min_trade_interval_min || 0}m interval · Whipsaw Guard Active` }
        ]
      },
      {
        num: 4,
        title: '4. Order Entry & Exchange Execution',
        subtitle: 'Order Routing',
        short: 'Execution',
        status: strategyActiveTrades.length > 0 ? `${activeTradeCount} OPEN` : 'STANDBY',
        isPassed: currentLifecycleStage.stageNumber > 4,
        isActive: currentLifecycleStage.stageNumber === 4,
        badgeClass: strategyActiveTrades.length > 0 ? 'text-accent border-accent/30 bg-accent/10' : 'text-dim border-border/40 bg-surface/40',
        desc: 'Exchange order routing with mandatory LOT_SIZE precision on stop-loss orders (Binance compliance).',
        criteria: [
          { label: 'Stop-Loss Order Compliance', value: 'Explicit LOT_SIZE Quantity on STOP_MARKET' },
          { label: 'Initial SL Distance', value: `${strategyConfig.sl_distance_pct || 2.0}% (${strategyConfig.sl_type || 'pct'})` },
          { label: 'Active Positions', value: `${activeTradeCount} Open Trade${activeTradeCount === 1 ? '' : 's'}` },
          { label: 'Execution Fallback', value: 'Algo Conditional -> STOP_MARKET Mandatory Fallback' }
        ]
      },
      {
        num: 5,
        title: '5. Protective Ratcheting & Trailing',
        subtitle: 'Live Invariants',
        short: 'Protection',
        status: strategyActiveTrades.some(t => t.current_sl && Number(t.current_sl) >= Number(t.entry_price)) ? 'PROTECTED (0.00R)' : 'MONITORING',
        isPassed: currentLifecycleStage.stageNumber > 5,
        isActive: currentLifecycleStage.stageNumber === 5,
        badgeClass: strategyActiveTrades.some(t => t.current_sl && Number(t.current_sl) >= Number(t.entry_price)) ? 'text-green border-green/30 bg-green/10' : 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',
        desc: 'Gapless Cancel-then-Replace stop-loss ratcheting with automatic re-arm rollback protection.',
        criteria: [
          { label: 'SL Update Protocol', value: 'Cancel-then-Replace (ModifyOrder unsupported)' },
          { label: 'Rollback Protection', value: 'Re-arm previous SL if replacement fails' },
          { label: 'Rate-Limit Delta Guard', value: 'Min 0.01% price delta before replacing SL' },
          { label: 'Trailing Stop Mode', value: strategyConfig.trailing_stop_enabled ? `Active (${strategyConfig.trailing_stop_distance_pct || 1.0}%)` : 'Disabled' }
        ]
      },
      {
        num: 6,
        title: '6. Exit Resolution & Realized PnL',
        subtitle: 'Trade Closeout',
        short: 'Exit',
        status: stratPerformance.total > 0 ? `${stratPerformance.wins}W / ${stratPerformance.losses}L` : 'READY',
        isPassed: false,
        isActive: currentLifecycleStage.stageNumber === 6,
        badgeClass: stratPerformance.total > 0 ? (stratPerformance.sumPnl >= 0 ? 'text-green border-green/30 bg-green/10' : 'text-red border-red/30 bg-red/10') : 'text-dim border-border/40 bg-surface/40',
        desc: 'Technical exit indicators, target R:R take profits, preserved exit reasons, and balance reconciliation.',
        criteria: [
          { label: 'Target R:R', value: `${strategyConfig.exit_rr_target || strategyConfig.tp_ratio || 2.0}R` },
          { label: 'Exit Signals', value: (strategyConfig.exit_signals || []).map(s => SIGNAL_LABELS[s] || s).join(', ') || 'Standard SL/TP' },
          { label: 'Realized PnL', value: fmtUSD(stratPerformance.sumPnl) },
          { label: 'Historical Hit Rate', value: `${stratPerformance.hitRate.toFixed(1)}% (${stratPerformance.total} trades)` }
        ]
      }
    ];
  }, [
    isStaticWatchlist, staticSymbols, strategyConfig, currentLifecycleStage, entryMet, firedCount, signalsCount,
    signalLogic, conditionFormula, reqLabels, timeframeDebugItems, isStrategyPaused, effectiveGate, startingBal,
    strategyActiveTrades, activeTradeCount, stratPerformance
  ]);

  const formatClockTime = useCallback((ts) => {
    if (!ts) return '--:--:--';
    const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
    if (isNaN(ms) || ms <= 0) return '--:--:--';
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, []);

  const formatTimeAgo = useCallback((ts) => {
    if (!ts) return 'just now';
    const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
    if (isNaN(ms) || ms <= 0) return 'just now';
    const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
  }, [nowMs]);

  const handleCopyReason = useCallback((item) => {
    try {
      const payload = JSON.stringify({
        category: item.category,
        symbol: item.symbol,
        title: item.title,
        reason: item.reason,
        stage: item.stage,
        details: item.details
      }, null, 2);
      navigator.clipboard.writeText(payload);
      setCopiedReasonId(item.id);
      setTimeout(() => setCopiedReasonId(null), 1800);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  }, []);

  // Aggregated Strategy Reasons Log
  const strategyReasons = useMemo(() => {
    const list = [];

    // 1. Live Candidate Evaluation reasons
    const opps = strategyScannerResults || [];
    opps.slice(0, 8).forEach(opp => {
      const scanDiff = Math.abs(opp.pct || 0) - (strategyConfig.scan_pct_threshold || 2.0);
      const scanMetLocal = scanDiff >= 0;
      const sigRes = opp.signalResult || {};
      const allFired = !!sigRes.allFired;

      if (!scanMetLocal) {
        list.push({
          id: `cand-scan-${opp.symbol}`,
          category: 'signals',
          type: 'miss',
          symbol: opp.symbol,
          direction: opp.dir || (opp.pct >= 0 ? 'LONG' : 'SHORT'),
          title: `Scan Velocity Below Threshold (${Math.abs(opp.pct || 0).toFixed(2)}%)`,
          reason: `Price change velocity of ${Math.abs(opp.pct || 0).toFixed(2)}% does not meet the configured minimum threshold of ${strategyConfig.scan_pct_threshold || 2.0}%.`,
          stage: '1. Discovery',
          timestamp: opp.lastUpdate || opp.ts || opp.timestamp || (nowMs - 15000),
          badgeClass: 'text-dim border-border/40 bg-surface/30',
          details: { velocity: `${opp.pct}%`, threshold: `${strategyConfig.scan_pct_threshold}%`, markPrice: opp.close }
        });
      } else if (!allFired) {
        const fired = sigRes.firedSignals || [];
        const required = strategyConfig.required_signals || [];
        const missing = (strategyConfig.enabled_signals || []).filter(sig => !fired.includes(sig));
        const missingLabels = missing.map(m => SIGNAL_LABELS[m] || m).join(', ');
        list.push({
          id: `cand-sig-${opp.symbol}`,
          category: 'signals',
          type: 'miss',
          symbol: opp.symbol,
          direction: opp.dir || (opp.pct >= 0 ? 'LONG' : 'SHORT'),
          title: `Entry Formula Incomplete (Pending: ${missingLabels || 'Awaiting Triggers'})`,
          reason: `Velocity threshold passed (${Math.abs(opp.pct || 0).toFixed(2)}%), but ${fired.length}/${(strategyConfig.enabled_signals || []).length} indicator rules satisfied. Waiting for: ${missingLabels || 'confirmation'}.`,
          stage: '2. Signals',
          timestamp: opp.lastUpdate || opp.ts || opp.timestamp || (nowMs - 25000),
          badgeClass: 'text-amber border-amber/30 bg-amber/10',
          details: { firedSignals: fired, missingSignals: missing, formula: conditionFormula }
        });
      } else {
        list.push({
          id: `cand-fired-${opp.symbol}`,
          category: 'signals',
          type: 'trigger',
          symbol: opp.symbol,
          direction: opp.dir || (opp.pct >= 0 ? 'LONG' : 'SHORT'),
          title: `Entry Signal Fully Fired (${opp.dir ? opp.dir.toUpperCase() : 'BUY'})`,
          reason: `All ${(strategyConfig.enabled_signals || []).length} signal conditions satisfied according to formula [${conditionFormula}]. Candidate passed to risk engine.`,
          stage: '2. Signals',
          timestamp: opp.lastUpdate || opp.ts || opp.timestamp || (nowMs - 5000),
          badgeClass: 'text-green border-green/30 bg-green/10',
          details: { formula: conditionFormula, firedSignals: sigRes.firedSignals }
        });
      }
    });

    // 2. Risk Gating reasons
    if (isStrategyPaused) {
      list.push({
        id: `gate-paused-${stratName}`,
        category: 'gates',
        type: 'block',
        symbol: '---',
        title: 'Strategy Automation Paused',
        reason: 'Automated order placement is manually paused for this strategy. Open positions continue to be monitored for exit/stop-loss triggers.',
        stage: '3. Risk Guard',
        timestamp: stratGate.updatedAt ? new Date(stratGate.updatedAt).getTime() : (nowMs - 60000),
        badgeClass: 'text-amber border-amber/30 bg-amber/10',
        details: { gateState: 'PAUSED', userIntervention: 'Manual pause flag active' }
      });
    } else if (effectiveGate && effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK') {
      list.push({
        id: `gate-blocked-${stratName}`,
        category: 'gates',
        type: 'block',
        symbol: '---',
        title: `Risk Gate Triggered (${effectiveGate.toUpperCase()})`,
        reason: `Engine risk restriction: ${effectiveReason || 'Threshold guard active'}. Entry orders throttled until condition clears.`,
        stage: '3. Risk Guard',
        timestamp: stratGate.updatedAt ? new Date(stratGate.updatedAt).getTime() : (nowMs - 30000),
        badgeClass: 'text-red border-red/30 bg-red/10',
        details: { gateState: effectiveGate, gateReason: effectiveReason }
      });
    }

    // 3. Active Trades entry reasons & lifecycle events
    strategyActiveTrades.forEach(trade => {
      if (trade.entry_reason || trade.signal_reason) {
        list.push({
          id: `entry-${trade.id || trade.symbol}`,
          category: 'entries',
          type: 'fill',
          symbol: trade.symbol,
          direction: trade.direction,
          title: `Position Entry Executed @ $${Number(trade.entry_price || 0).toLocaleString()}`,
          reason: trade.entry_reason || trade.signal_reason || 'Signal rule matched and risk invariant verified.',
          stage: '4. Order Execution',
          timestamp: trade.entry_ts_ms || (trade.entry_ts ? new Date(trade.entry_ts).getTime() : (trade.createdAt ? new Date(trade.createdAt).getTime() : (nowMs - 120000))),
          badgeClass: 'text-accent border-accent/30 bg-accent/10',
          details: {
            entryPrice: trade.entry_price,
            qty: trade.qty,
            riskUsdt: trade.risk_usdt,
            initialSl: trade.initial_sl,
            signalReason: trade.signal_reason
          }
        });
      }

      // Active trade events (e.g. SL ratchets, trailing activations)
      if (Array.isArray(trade.active_trade_events)) {
        trade.active_trade_events.forEach((evt, idx) => {
          list.push({
            id: `event-${trade.id}-${idx}`,
            category: 'entries',
            type: 'event',
            symbol: trade.symbol,
            direction: trade.direction,
            title: evt.title || `Risk Ratchet Milestone (${evt.type || 'SL Update'})`,
            reason: evt.reason || evt.message || `Stop loss adjusted to preserve capital / lock in profit.`,
            stage: '5. Protection',
            timestamp: evt.timestamp_ms || (evt.timestamp ? new Date(evt.timestamp).getTime() : nowMs - (idx * 60000)),
            badgeClass: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',
            details: evt
          });
        });
      }

      // Exit signals fired if any
      if (trade.exit_signals_status) {
        Object.entries(trade.exit_signals_status).forEach(([sigKey, status]) => {
          if (status?.fired) {
            list.push({
              id: `exit-sig-${trade.id}-${sigKey}`,
              category: 'exits',
              type: 'trigger',
              symbol: trade.symbol,
              direction: trade.direction,
              title: `Exit Signal Crossed: ${SIGNAL_LABELS[sigKey] || sigKey}`,
              reason: `Technical exit indicator condition met. Position liquidation triggered per strategy exit rules.`,
              stage: '6. Resolution',
              timestamp: status?.fired_ts || (trade.exit_signals_status_ts ? new Date(trade.exit_signals_status_ts).getTime() : (nowMs - 10000)),
              badgeClass: 'text-red border-red/30 bg-red/10',
              details: { signal: sigKey, status }
            });
          }
        });
      }
    });

    // 4. Closed Trades exit reasons
    const stratTrades = (tradeHistory || []).filter(t => (t.strategy_label || 'Momentum Strategy') === stratName);
    stratTrades.slice(0, 25).forEach(trade => {
      const isWin = Number(trade.pnl || 0) >= 0;
      list.push({
        id: `closed-${trade.id || trade.symbol}-${trade.exit_ts}`,
        category: 'exits',
        type: isWin ? 'win' : 'loss',
        symbol: trade.symbol,
        direction: trade.direction,
        title: `Position Closed: ${trade.exit_reason || (isWin ? 'Take Profit Target' : 'Stop Loss Hit')}`,
        reason: `${isWin ? 'Profitable' : 'Defensive'} closure with PnL of ${fmtUSD(trade.pnl)} (${trade.exit_rr ? `${Number(trade.exit_rr).toFixed(2)}R` : ''}). Reason: ${trade.exit_reason || 'Standard exit rule'}.${trade.risk_lock_reason ? ` Lock: ${trade.risk_lock_reason}` : ''}`,
        stage: '6. Resolution',
        timestamp: trade.exit_ts_ms || (trade.exit_ts ? new Date(trade.exit_ts).getTime() : (trade.closed_at ? new Date(trade.closed_at).getTime() : (nowMs - 3600000))),
        badgeClass: isWin ? 'text-green border-green/30 bg-green/10' : 'text-red border-red/30 bg-red/10',
        details: {
          exitReason: trade.exit_reason,
          riskLockReason: trade.risk_lock_reason,
          pnl: trade.pnl,
          exitRr: trade.exit_rr,
          exitPrice: trade.exit_price,
          fees: trade.funding_fee
        }
      });
    });

    // 5. Relevant system logs & Scanner Diagnostics
    const stratInterval = strategyConfig.scan_interval || '5m';
    const seenLogIds = new Set();

    (logs || []).forEach((log, idx) => {
      const msg = typeof log.message === 'string' ? log.message : (typeof log.msg === 'string' ? log.msg : '');
      if (!msg) return;

      const isStrategyLog = msg.includes(stratName);
      const isScannerDiag = msg.includes('[Scanner Diagnostic]');
      const isIntervalMatch = msg.includes(`(${stratInterval} timeframe)`) || msg.includes(`interval ${stratInterval}`) || msg.includes(`for interval ${stratInterval}`);
      const isSymbolMatch = focusedOpp?.symbol && focusedOpp.symbol !== '---' && msg.includes(focusedOpp.symbol);

      if (!isStrategyLog && !isSymbolMatch && !(isScannerDiag && isIntervalMatch)) {
        return;
      }

      const logId = log.id || `diag-${idx}-${log.timestamp || idx}`;
      if (seenLogIds.has(logId)) return;
      seenLogIds.add(logId);

      const symMatch = msg.match(/\b([A-Z0-9]{2,12}USDT)\b/);
      const itemSymbol = symMatch ? symMatch[1] : (focusedOpp?.symbol || '---');

      let category = 'signals';
      let stage = '1. Discovery';
      let title = `Engine Event: ${log.level ? String(log.level).toUpperCase() : 'INFO'}`;
      let badgeClass = 'text-dim border-border/40 bg-surface/30';
      let itemType = 'log';

      if (msg.includes('pre-filtered: prospective SL distance')) {
        category = 'gates';
        stage = '3. Risk Guard';
        itemType = 'block';
        title = `Prospective SL Filter: ${itemSymbol}`;
        badgeClass = 'text-amber border-amber/30 bg-amber/10';
      } else if (msg.includes('skipped: momentum') && msg.includes('below threshold')) {
        category = 'signals';
        stage = '1. Discovery';
        itemType = 'miss';
        title = `Momentum Below Threshold: ${itemSymbol}`;
        badgeClass = 'text-dim border-border/40 bg-surface/30';
      } else if (msg.includes('skipped: insufficient candles')) {
        category = 'signals';
        stage = '1. Discovery';
        itemType = 'warmup';
        title = `Candle Buffer Warming: ${itemSymbol}`;
        badgeClass = 'text-dim border-border/40 bg-surface/30';
      } else if (msg.includes('disallowed by entry_side')) {
        category = 'signals';
        stage = '2. Signals';
        itemType = 'miss';
        title = `Direction Filter: ${itemSymbol}`;
        badgeClass = 'text-amber border-amber/30 bg-amber/10';
      } else if (log.level === 'error' || log.level === 'warn') {
        category = 'gates';
        stage = '3. Risk Guard';
        itemType = 'block';
        badgeClass = log.level === 'error' ? 'text-red border-red/30 bg-red/10' : 'text-amber border-amber/30 bg-amber/10';
      }

      list.push({
        id: logId,
        category,
        type: itemType,
        symbol: itemSymbol,
        title,
        reason: msg.replace(/\[Scanner Diagnostic\]\s*/, '').replace(/\[MomentumScannerService\]\s*/, ''),
        stage,
        timestamp: log.ts_ms || (log.timestamp ? new Date(log.timestamp).getTime() : (log.ts ? new Date(log.ts).getTime() : (nowMs - (idx * 5000)))),
        badgeClass,
        details: log
      });
    });

    // Sort descending by timestamp
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }, [s?.strategy_label, strategyScannerResults, strategyConfig, isStrategyPaused, strategyGateStates, gateState, gateReason, strategyActiveTrades, tradeHistory, logs, focusedOpp?.symbol, nowMs, conditionFormula]);

  const reasonsCounts = useMemo(() => {
    return {
      all: strategyReasons.length,
      signals: strategyReasons.filter(r => r.category === 'signals').length,
      gates: strategyReasons.filter(r => r.category === 'gates').length,
      entries: strategyReasons.filter(r => r.category === 'entries').length,
      exits: strategyReasons.filter(r => r.category === 'exits').length,
    };
  }, [strategyReasons]);

  const filteredReasons = useMemo(() => {
    let list = strategyReasons;
    if (reasonsFilter !== 'all') {
      list = list.filter(r => r.category === reasonsFilter);
    }
    const q = reasonsSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(r =>
        (r.symbol && r.symbol.toLowerCase().includes(q)) ||
        (r.title && r.title.toLowerCase().includes(q)) ||
        (r.reason && r.reason.toLowerCase().includes(q)) ||
        (r.stage && r.stage.toLowerCase().includes(q))
      );
    }
    return list;
  }, [strategyReasons, reasonsFilter, reasonsSearch]);

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

  // Compute live telemetry stats
  const streamAgeSec = Math.max(0, ((nowMs - lastAuthoritativeUpdateTs) / 1000)).toFixed(1);
  const streamFresh = streamAgeSec < 5.0;
  const regimeInfo = getMarketRegimeInfo(strategyScannerResults, strategyConfig, { scannerPaused: isStrategyPaused });

  return (
    <div className="max-w-[1300px] mx-auto p-3 md:p-5 lg:p-6 animate-in fade-in duration-300 pb-16 lg:pb-8">
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

             <Tooltip content={isVariant ? "Edit Strategy Variant Configuration" : "Edit Base Strategy Configuration"}>
               <button
                 type="button"
                 onClick={onEdit}
                 className="px-2.5 py-1.5 min-h-[32px] sm:px-3 bg-surface border border-border text-dim hover:text-accent hover:border-accent/40 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0 cursor-pointer"
                 aria-label={isVariant ? "Edit strategy variant configuration" : "Edit base strategy configuration"}
               >
                 <Edit3 size={12} />
                 <span>{isVariant ? 'Edit Variant' : 'Edit Base'}</span>
               </button>
             </Tooltip>
           </div>
         </div>
      </ViewHeader>

      {/* KPI Performance Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5 md:gap-3 mb-5">
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

      {/* Promoted Active Positions Section (Always visible when in position) */}
      {activeTradeCount > 0 && (
        <div className="mb-5 animate-in fade-in duration-300 text-left">
          <SectionLabel>Active Positions ({activeTradeCount})</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
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

      {/* Segmented Cockpit Navigation Tabs */}
      <div className="flex items-center gap-1 sm:gap-1.5 p-1 bg-surface/40 border border-border/40 rounded-xl mb-5 text-left overflow-x-auto no-scrollbar" role="tablist" aria-label="Strategy Navigation">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pipeline'}
          onClick={() => setActiveTab('pipeline')}
          className={cn(
            "flex-1 min-w-[95px] sm:min-w-0 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
            activeTab === 'pipeline'
              ? "bg-surface text-accent border border-border/60 shadow-xs"
              : "text-dim hover:text-text hover:bg-surface/30"
          )}
        >
          <Cpu size={14} className={cn("shrink-0", activeTab === 'pipeline' ? "text-accent" : "text-dim")} />
          <span className="truncate"><span className="hidden sm:inline">Pipeline & </span>Signals</span>
          <span className={cn(
            "hidden xs:inline-flex text-[9px] px-1.5 py-0.2 rounded font-mono font-bold tracking-tight shrink-0",
            isStrategyPaused ? "bg-amber/10 text-amber border border-amber/20" : "bg-green/10 text-green border border-green/20"
          )}>
            {isStrategyPaused ? 'Paused' : 'Active'}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'performance'}
          onClick={() => setActiveTab('performance')}
          className={cn(
            "flex-1 min-w-[95px] sm:min-w-0 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
            activeTab === 'performance'
              ? "bg-surface text-accent border border-border/60 shadow-xs"
              : "text-dim hover:text-text hover:bg-surface/30"
          )}
        >
          <BarChart3 size={14} className={cn("shrink-0", activeTab === 'performance' ? "text-accent" : "text-dim")} />
          <span className="truncate"><span className="hidden sm:inline">Performance & </span>Charts</span>
          <span className="hidden xs:inline-flex text-[9px] px-1.5 py-0.2 rounded font-mono font-bold bg-white/5 text-dim border border-white/5 shrink-0">
            {stratPerformance.total}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'decisions'}
          onClick={() => setActiveTab('decisions')}
          className={cn(
            "flex-1 min-w-[95px] sm:min-w-0 py-2 px-2.5 sm:px-3 rounded-lg text-xs font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
            activeTab === 'decisions'
              ? "bg-surface text-accent border border-border/60 shadow-xs"
              : "text-dim hover:text-text hover:bg-surface/30"
          )}
        >
          <FileText size={14} className={cn("shrink-0", activeTab === 'decisions' ? "text-accent" : "text-dim")} />
          <span className="truncate">Decision<span className="hidden sm:inline"> Log</span></span>
          <span className="hidden xs:inline-flex text-[9px] px-1.5 py-0.2 rounded font-mono font-bold bg-white/5 text-dim border border-white/5 shrink-0">
            {strategyReasons.length}
          </span>
        </button>
      </div>

      {/* TAB 1: Pipeline & Live Signals */}
      {activeTab === 'pipeline' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="border border-border/50 bg-surface/20 rounded-2xl overflow-hidden text-left shadow-sm">
            {/* Streamlined Live Pipeline & Freshness Telemetry Header */}
            <div className="p-3.5 sm:p-4 bg-surface/50 border-b border-border/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
                  <Cpu size={14} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-mono flex-wrap">
                    <span className="text-xs font-black uppercase tracking-wider text-text truncate">Engine Pipeline</span>
                    <span className={cn(
                      "px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase border shrink-0",
                      isStrategyPaused ? "bg-amber/10 text-amber border-amber/30" : "bg-green/10 text-green border-green/30"
                    )}>
                      {isStrategyPaused ? 'PAUSED' : 'ACTIVE'}
                    </span>
                    <span className="text-[10px] text-dim/60 font-medium">·</span>
                    <span className="text-[9.5px] text-dim font-medium uppercase truncate">{effectiveReason || 'OK'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 font-mono text-[10px] text-dim self-stretch sm:self-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-border/20 flex-wrap">
                {/* Market Regime Badge */}
                <Tooltip content={regimeInfo.guidance}>
                  <div className={cn(
                    "px-2 py-0.5 rounded-lg border flex items-center gap-1 cursor-help shrink-0",
                    regimeInfo.badgeClass
                  )}>
                    {regimeInfo.regime === 'slow' && <Turtle size={10} className="shrink-0 text-cyan-400" />}
                    {regimeInfo.regime === 'active' && <Flame size={10} className="shrink-0 text-accent animate-pulse" />}
                    {regimeInfo.regime === 'moderate' && <Zap size={10} className="shrink-0 text-amber" />}
                    <span className="font-black uppercase tracking-wider">{regimeInfo.label}</span>
                  </div>
                </Tooltip>

                {/* Stream Freshness & Telemetry */}
                <div className="flex items-center gap-1.5 text-dim/80 shrink-0">
                  <Radio size={11} className={streamFresh ? "text-green animate-pulse" : "text-amber"} />
                  <span>{streamFresh ? `Live (${streamAgeSec}s)` : `Syncing (${streamAgeSec}s)`}</span>
                </div>

                {/* Batch Sync Action Button */}
                <button
                  type="button"
                  disabled={isBatchSyncing || bestOpp.symbol === '---'}
                  onClick={handleBatchSyncTimeframes}
                  className={cn(
                    "px-2.5 py-1 bg-surface border border-border/60 hover:border-accent/40 text-text rounded-lg text-[9.5px] font-black uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0",
                    isBatchSyncing && "opacity-60 cursor-wait"
                  )}
                  aria-label="Batch sync all evaluation timeframes"
                >
                  <RefreshCw size={10} className={cn(isBatchSyncing && "animate-spin text-accent")} />
                  <span>{isBatchSyncing ? 'Syncing...' : 'Sync All'}</span>
                </button>
              </div>
            </div>

            {/* Unified Scope & Proximity 2-Column Grid (Minimizes vertical height) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 border-b border-border/20 divide-y lg:divide-y-0 lg:divide-x divide-border/20 bg-surface/20">
              {/* Watchlist Scope & Target Universe */}
              <div className="p-3 bg-surface/30 flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between font-mono flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Target size={12} className="text-accent shrink-0" />
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

                {/* Static Watchlist Symbol Chips with Progressive Disclosure */}
                {isStaticWatchlist && staticSymbols.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 font-mono">
                    {(showAllStaticSymbols ? staticSymbols : staticSymbols.slice(0, 8)).map(sym => {
                      const info = staticSymbolStatuses[sym] || { label: 'STATIC TARGET', badgeClass: 'text-dim border-border/40 bg-surface/40' };
                      const isSelected = focusedOpp.symbol === sym;

                      return (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => setSelectedFocusSymbol(sym)}
                          className={cn(
                            "px-2.5 py-1 rounded-lg border text-[10px] font-bold flex items-center gap-1.5 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-w-0",
                            isSelected ? "bg-accent/20 border-accent text-accent shadow-xs" : info.badgeClass
                          )}
                        >
                          <span className="truncate">{sym}</span>
                          <span className="text-[8px] opacity-80 uppercase font-black font-mono tracking-tight shrink-0">· {info.label}</span>
                        </button>
                      );
                    })}

                    {staticSymbols.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllStaticSymbols(!showAllStaticSymbols)}
                        className="px-2 py-1 rounded-lg border border-border/60 hover:border-accent/40 bg-surface/50 text-[9.5px] font-mono font-bold text-accent flex items-center gap-1 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                      >
                        <span>{showAllStaticSymbols ? 'Show Less' : `+${staticSymbols.length - 8} More`}</span>
                        <ChevronDown size={11} className={cn("transition-transform duration-200", showAllStaticSymbols && "rotate-180")} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Watchlist Proximity Leaderboard */}
              <div className="p-3 bg-background/30 flex flex-col justify-between gap-2">
                <div className="flex justify-between items-center mb-1 font-mono">
                  <span className="text-[9px] font-black text-dim uppercase tracking-widest flex items-center gap-1">
                    <Zap size={11} className="text-accent" /> Watchlist Proximity Leaderboard
                  </span>
                  <span className="text-[8.5px] text-dim/60 uppercase">Sorted by Proximity %</span>
                </div>

                {proximityLeaderboard.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
                    {proximityLeaderboard.slice(0, 5).map(opp => {
                      const isSelected = focusedOpp.symbol === opp.symbol;
                      const isFired = opp.signalResult?.allFired;
                      return (
                        <button
                          key={opp.symbol}
                          type="button"
                          onClick={() => setSelectedFocusSymbol(opp.symbol)}
                          className={cn(
                            "p-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col gap-0.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-w-0",
                            isSelected
                              ? "bg-accent/10 border-accent text-accent shadow-xs"
                              : isFired
                              ? "bg-green/5 border-green/30 text-green"
                              : "bg-surface/40 border-border/40 hover:border-border text-text"
                          )}
                        >
                          <div className="flex justify-between items-center font-mono gap-1">
                            <span className="text-[10px] font-black truncate">{opp.symbol}</span>
                            <span className={cn(
                              "text-[8px] font-mono font-bold px-1 rounded shrink-0",
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
                ) : (
                  <div className="text-[9px] font-mono text-dim/60 uppercase py-2">
                    Awaiting scan candidates
                  </div>
                )}
              </div>
            </div>

            {/* Interactive End-to-End Trade Journey Map (6 Milestones) */}
            <div className="p-3.5 sm:p-4 bg-background/25 border-b border-border/20 font-mono flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Compass size={14} className="text-accent shrink-0" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-text">Trade Journey Map</span>
                  <span className={cn("px-2 py-0.5 rounded text-[8.5px] font-black uppercase border shrink-0", currentLifecycleStage.colorClass)}>
                    {currentLifecycleStage.statusLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[9px] text-dim flex-wrap">
                  <span>Target: <strong className="text-text font-bold">{focusedOpp.symbol !== '---' ? focusedOpp.symbol : (isStaticWatchlist ? `${staticSymbols.length} Static Targets` : 'Discovery Universe')}</strong></span>
                  <span className="text-dim/40">·</span>
                  <span>Click any milestone below to inspect execution criteria</span>
                </div>
              </div>

              {/* 6-Milestone Interactive Journey Trail */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 relative">
                {journeyMilestones.map(m => {
                  const isSelected = activeJourneyMilestone === m.num;
                  const isCurrent = currentLifecycleStage.stageNumber === m.num;
                  const isPassed = currentLifecycleStage.stageNumber > m.num;

                  return (
                    <button
                      key={m.num}
                      type="button"
                      onClick={() => setActiveJourneyMilestone(isSelected ? null : m.num)}
                      aria-expanded={isSelected}
                      aria-label={`Milestone ${m.num}: ${m.title} (${m.status})`}
                      className={cn(
                        "p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[72px] min-w-0 relative overflow-hidden group",
                        isSelected
                          ? "bg-accent/15 border-accent text-accent shadow-sm ring-1 ring-accent/30"
                          : isCurrent
                          ? "bg-accent/10 border-accent/60 text-accent font-black shadow-xs"
                          : isPassed
                          ? "bg-green/10 border-green/30 text-green font-bold hover:border-green/50"
                          : "bg-surface/40 border-border/40 text-dim/80 hover:border-border hover:text-text"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <span className="text-[10px] font-black uppercase tracking-tight truncate">{m.short}</span>
                        <span className={cn(
                          "text-[7.5px] font-bold px-1.5 py-0.2 rounded border font-mono tracking-tighter shrink-0 truncate max-w-[65px]",
                          isSelected ? "bg-accent text-white border-accent" : m.badgeClass
                        )}>
                          {m.status}
                        </span>
                      </div>

                      <span className="text-[8.5px] text-dim/80 line-clamp-1 text-left leading-tight font-medium">
                        {m.subtitle}
                      </span>

                      {/* Indicator bar */}
                      <div className="w-full bg-background/80 rounded-full h-1 overflow-hidden relative border border-white/5">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            isSelected || isCurrent ? "bg-accent w-full" : isPassed ? "bg-green w-full" : "bg-dim/30 w-1/4"
                          )}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Interactive Milestone Detailed Inspector */}
              {activeJourneyMilestone && (() => {
                const milestone = journeyMilestones.find(m => m.num === activeJourneyMilestone);
                if (!milestone) return null;

                return (
                  <div className="mt-1 p-3.5 bg-surface/50 border border-accent/30 rounded-xl flex flex-col gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border/20 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-accent text-white text-[10px] font-black flex items-center justify-center shrink-0">
                          {milestone.num}
                        </span>
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wider text-text">{milestone.title}</h4>
                          <p className="text-[9.5px] text-dim font-medium">{milestone.desc}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={cn("text-[9px] font-black px-2 py-0.5 rounded border uppercase", milestone.badgeClass)}>
                          {milestone.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveJourneyMilestone(null)}
                          className="p-1 hover:bg-white/10 rounded-md text-dim hover:text-text transition-colors"
                          aria-label="Close milestone inspection"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-1 font-mono">
                      {milestone.criteria.map((crit, idx) => (
                        <div key={idx} className="p-2 bg-background/40 border border-border/30 rounded-lg flex flex-col gap-0.5">
                          <span className="text-[8px] font-black uppercase text-dim tracking-wider">{crit.label}</span>
                          <span className="text-[10px] font-bold text-text truncate" title={crit.value}>{crit.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Focused Candidate Inspector & Signal Checklist */}
            <div className="p-3.5 sm:p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-border/20 font-mono">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-black uppercase text-text shrink-0">Candidate Signal Inspector</span>
                  <span className="px-2 py-0.5 bg-surface border border-border text-accent rounded-md text-[10px] font-black truncate max-w-[120px] xs:max-w-none">
                    {bestOpp.symbol} {bestOpp.dir ? bestOpp.dir.toUpperCase() : 'NEUTRAL'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 xs:gap-2 text-[9.5px] min-w-0 max-w-full">
                  <span className="text-dim shrink-0">Formula:</span>
                  <span className="text-text font-bold truncate max-w-[120px] xs:max-w-[180px] sm:max-w-xs md:max-w-md" title={conditionFormula}>{conditionFormula}</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[8.5px] font-black uppercase border shrink-0",
                    entryMet ? "bg-green/10 text-green border-green/20" : "bg-amber/10 text-amber border-amber/20"
                  )}>
                    {entryMet ? 'TRIGGERED' : 'PENDING'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left Column: Signal Gauges */}
                {bestOpp.symbol === '---' ? (
                  <div className="lg:col-span-2 p-6 rounded-xl bg-background/50 border border-border/40 flex flex-col items-center justify-center text-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                      <Search size={18} />
                    </div>
                    <div className="flex flex-col gap-1 max-w-md">
                      <span className="text-xs font-black uppercase tracking-wider text-text">No Candidates Passing Velocity Threshold</span>
                      <p className="text-[11px] text-dim leading-relaxed">
                        Scanner is actively scanning the universe on {strategyConfig.scan_interval || '4h'} (configured threshold: ±{strategyConfig.scan_pct_threshold || 1.0}%). Live evaluations, pre-filters, and candle buffer statuses are reported below in the Decision Log.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-mono text-dim font-bold bg-surface/60 px-3 py-1 rounded-lg border border-border/40">
                      <RefreshCw size={10} className="animate-spin text-accent" />
                      <span>Awaiting momentum trigger across {strategyConfig.watchlist_size || 80} discovery symbols</span>
                    </div>
                  </div>
                ) : (
                  <div className="lg:col-span-2 flex flex-col gap-3 min-w-0">
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
                )}

                {/* Right Column: Timeframe Candle Warmup & Freshness Debug Inspector with Progressive Disclosure */}
                <div className="bg-background/40 border border-border/40 rounded-xl p-3 flex flex-col gap-2.5 min-w-0">
                  <div className="flex items-center justify-between border-b border-border/20 pb-2">
                    <button
                      type="button"
                      onClick={() => setShowWarmupDebug(!showWarmupDebug)}
                      className="text-[10px] font-black text-dim hover:text-text uppercase tracking-wider flex items-center gap-1.5 font-mono cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded transition-colors"
                    >
                      <Clock size={12} className="text-accent" />
                      <span>Timeframe & Warmup</span>
                      <ChevronDown size={11} className={cn("text-dim transition-transform duration-200", showWarmupDebug && "rotate-180")} />
                    </button>
                    <span className="text-[8.5px] font-mono text-dim/60 uppercase">Buffer Freshness</span>
                  </div>

                  {showWarmupDebug && (
                    <div className="flex flex-col gap-2 animate-in fade-in duration-200">
                      {timeframeDebugItems.map(item => {
                        const pct = item.required > 0 ? Math.min(100, Math.round((item.candles / item.required) * 100)) : 100;
                        const isSyncingThis = syncingTfMap[item.tf];

                        return (
                          <div key={item.key} className="p-2 bg-surface/50 border border-border/30 rounded-lg flex flex-col gap-1 font-mono">
                            <div className="flex items-center justify-between text-[10px] gap-1">
                              <span className="font-bold text-text flex items-center gap-1 truncate">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                                <span className="truncate">{item.label}</span>
                                <span className="text-dim/60 shrink-0">({item.tf})</span>
                              </span>
                              <span className={cn("font-bold shrink-0", item.isWarming ? "text-amber" : "text-green")}>
                                {item.statusMsg}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 text-[9px] text-dim">
                              <div className="flex-1 bg-background/80 rounded-full h-1 overflow-hidden relative border border-white/5 min-w-[50px]">
                                <div
                                  className={cn("h-full transition-all duration-300", item.isWarming ? "bg-amber" : "bg-green")}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="shrink-0 tabular-nums">{pct}%</span>
                              <button
                                type="button"
                                disabled={isSyncingThis || bestOpp.symbol === '---'}
                                onClick={() => handleSyncTimeframe(item.tf, bestOpp.symbol)}
                                className={cn(
                                  "px-1.5 py-0.5 bg-surface hover:bg-surface-light border border-border text-text rounded text-[8px] uppercase font-bold flex items-center gap-0.5 transition-all cursor-pointer focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none shrink-0",
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
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Collapsible Live Scanner Preview Bar (Saves ~350px vertical scroll) */}
          <div className="bg-surface/30 border border-border/40 rounded-2xl overflow-hidden shadow-xs">
            <button
              type="button"
              onClick={() => setShowScannerPreview(!showScannerPreview)}
              className="w-full p-3.5 flex items-center justify-between hover:bg-surface/50 transition-colors font-mono text-left cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none"
              aria-expanded={showScannerPreview}
            >
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-accent" />
                <span className="text-xs font-black uppercase text-text">Live Scanner Stream</span>
                <span className="text-[9px] text-dim uppercase">· {strategyScannerResults.length} Pairs Monitored</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9.5px] font-bold text-accent uppercase">
                  {showScannerPreview ? 'Collapse Scanner' : 'Expand Scanner'}
                </span>
                <ChevronDown size={12} className={cn("text-accent transition-transform duration-200", showScannerPreview && "rotate-180")} />
              </div>
            </button>
            {showScannerPreview && (
              <div className="border-t border-border/20 animate-in fade-in duration-200">
                <ScannerPreview
                  scannerResults={strategyScannerResults}
                  config={strategyConfig}
                  onOpen={() => onOpenScanner(s.strategy_label)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Performance & Overlay Charts */}
      {activeTab === 'performance' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="border border-border/40 bg-surface/30 rounded-2xl overflow-hidden transition-all flex flex-col gap-3 p-3.5 sm:p-4 shadow-sm">
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
                  height={240}
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
        </div>
      )}

      {/* TAB 3: Strategy Reasons & Decision Log */}
      {activeTab === 'decisions' && (
        <div className="space-y-4 animate-in fade-in duration-200 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <SectionLabel>Strategy Reasons & Decision Log</SectionLabel>
              <p className="text-xs text-dim">
                Complete causal chain of opportunity evaluations, gating decisions, executions, and exit triggers for this strategy.
              </p>
            </div>

            {/* Quick Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {[
                { id: 'all', label: 'All', count: reasonsCounts.all },
                { id: 'signals', label: 'Signals', count: reasonsCounts.signals },
                { id: 'gates', label: 'Risk Gates', count: reasonsCounts.gates },
                { id: 'entries', label: 'Entries', count: reasonsCounts.entries },
                { id: 'exits', label: 'Exits', count: reasonsCounts.exits },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setReasonsFilter(tab.id)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-mono rounded-lg transition-all border flex items-center gap-1.5 cursor-pointer whitespace-nowrap",
                    reasonsFilter === tab.id
                      ? "bg-accent/15 text-accent border-accent/40 font-semibold shadow-xs"
                      : "bg-surface/60 text-dim hover:text-text border-border/40 hover:border-border"
                  )}
                >
                  <span>{tab.label}</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.2 rounded-full tabular-nums",
                    reasonsFilter === tab.id ? "bg-accent/20 text-accent font-bold" : "bg-white/5 text-dim"
                  )}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-surface/50 border border-border/40 rounded-xl">
            <div className="relative w-full sm:w-80">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
              <input
                type="text"
                value={reasonsSearch}
                onChange={(e) => setReasonsSearch(e.target.value)}
                placeholder="Search symbol, trigger, or reason keyword..."
                className="w-full pl-9 pr-8 py-1.5 bg-background/70 border border-border/50 rounded-lg text-xs font-mono text-text placeholder:text-dim/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
              />
              {reasonsSearch && (
                <button
                  type="button"
                  onClick={() => setReasonsSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dim hover:text-text cursor-pointer p-0.5"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end text-[11px] text-dim font-mono">
              <span>Showing <strong className="text-text tabular-nums">{filteredReasons.length}</strong> of <strong className="tabular-nums">{strategyReasons.length}</strong> events</span>
              {reasonsSearch && (
                <button
                  type="button"
                  onClick={() => { setReasonsSearch(''); setReasonsFilter('all'); }}
                  className="text-accent hover:underline text-[11px] cursor-pointer"
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>

          {/* Reasons Feed List */}
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {filteredReasons.length === 0 ? (
              <div className="p-8 text-center bg-surface/30 border border-border/30 rounded-xl">
                <FileText size={24} className="mx-auto text-dim/40 mb-2" />
                <div className="text-xs font-semibold text-text mb-1">No matching strategy decisions</div>
                <p className="text-[11px] text-dim max-w-sm mx-auto">
                  {reasonsSearch || reasonsFilter !== 'all'
                    ? 'No events match your current filter or search criteria. Try selecting "All" or clearing the search keyword.'
                    : 'Decision events will appear here as scanner opportunities are scored, gates are evaluated, and orders are executed.'}
                </p>
              </div>
            ) : (
              filteredReasons.map((item) => {
                const isCopied = copiedReasonId === item.id;
                return (
                  <div
                    key={item.id}
                    className="p-2.5 bg-surface/50 hover:bg-surface/80 border border-border/30 hover:border-border/60 rounded-lg transition-all flex flex-col gap-1.5 font-mono group"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0 text-[11px]">
                        {/* Direction Indicator */}
                        {item.direction && (
                          <span className={cn(
                            "font-bold uppercase tracking-wider text-[11px] shrink-0",
                            item.direction === 'LONG' || item.direction === 'long' ? "text-green" : "text-red"
                          )}>
                            [{item.direction.toUpperCase()}]
                          </span>
                        )}

                        {/* Symbol */}
                        {item.symbol && item.symbol !== '---' && (
                          <span className="font-bold text-text font-mono shrink-0">
                            {item.symbol}
                          </span>
                        )}

                        {/* Middle dot separator */}
                        {(item.direction || (item.symbol && item.symbol !== '---')) && (
                          <span className="text-dim/40 text-[10px]">·</span>
                        )}

                        {/* Stage indicator */}
                        <span className="text-dim text-[10.5px] shrink-0 font-medium">
                          {item.stage}
                        </span>

                        <span className="text-dim/40 text-[10px]">·</span>

                        {/* Title */}
                        <span className="font-semibold text-text group-hover:text-accent transition-colors truncate max-w-[220px] xs:max-w-xs sm:max-w-md">
                          {item.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-auto">
                        {/* Dual Authoritative Timestamp: Clock time (HH:MM:SS) + Relative elapsed (Xs ago) */}
                        <time
                          dateTime={new Date(item.timestamp).toISOString()}
                          title={new Date(item.timestamp).toLocaleString()}
                          className="text-[10px] text-dim/90 whitespace-nowrap flex items-center gap-1 tabular-nums font-mono cursor-help"
                        >
                          <span className="font-bold text-text/80">{formatClockTime(item.timestamp)}</span>
                          <span className="text-dim/40">·</span>
                          <span className="text-dim">{formatTimeAgo(item.timestamp)}</span>
                        </time>
                        <button
                          type="button"
                          onClick={() => handleCopyReason(item)}
                          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1 text-dim hover:text-text bg-surface/60 hover:bg-surface rounded border border-border/30 transition-all cursor-pointer"
                          title="Copy decision explanation"
                          aria-label="Copy decision explanation"
                        >
                          {isCopied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                        </button>
                      </div>
                    </div>

                    {/* Primary Reason Text (Direct prose, zero box-in-a-box) */}
                    <p className="text-[11.5px] text-text/85 font-sans leading-relaxed break-words pl-0.5">
                      {item.reason}
                    </p>

                    {/* Supplemental Meta Parameters with Progressive Disclosure */}
                    {item.details && Object.keys(item.details).length > 0 && (
                      <div className="pt-1 border-t border-border/15 flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => toggleReasonDetails(item.id)}
                          className="text-[9px] font-mono font-bold text-dim/70 hover:text-accent flex items-center gap-1 cursor-pointer transition-colors self-start"
                        >
                          <span>{expandedReasonIds[item.id] ? 'Hide Execution Details' : 'View Execution Details'}</span>
                          <ChevronDown size={10} className={cn("transition-transform duration-200", expandedReasonIds[item.id] && "rotate-180")} />
                        </button>

                        {expandedReasonIds[item.id] && (
                          <div className="flex flex-wrap items-center gap-2 text-[9.5px] text-dim font-mono pt-0.5 border-t border-dashed border-border/20 animate-in fade-in duration-150">
                            {item.details.formula && (
                              <span className="truncate max-w-full" title={item.details.formula}>
                                Formula: <span className="text-text font-bold">{item.details.formula}</span>
                              </span>
                            )}
                            {item.details.formula && item.details.entryPrice && <span className="text-dim/30">|</span>}
                            {item.details.entryPrice && (
                              <span>
                                Entry: <span className="text-text font-bold tabular-nums">${Number(item.details.entryPrice).toLocaleString()}</span>
                              </span>
                            )}
                            {item.details.initialSl && (
                              <>
                                <span className="text-dim/30">|</span>
                                <span>
                                  SL: <span className="text-text font-bold tabular-nums">${Number(item.details.initialSl).toLocaleString()}</span>
                                </span>
                              </>
                            )}
                            {item.details.exitRr !== undefined && (
                              <>
                                <span className="text-dim/30">|</span>
                                <span>
                                  R:R: <span className={cn("font-bold tabular-nums", Number(item.details.exitRr) >= 0 ? "text-green" : "text-red")}>
                                    {Number(item.details.exitRr) >= 0 ? '+' : ''}{Number(item.details.exitRr).toFixed(2)}R
                                  </span>
                                </span>
                              </>
                            )}
                            {item.details.pnl !== undefined && (
                              <>
                                <span className="text-dim/30">|</span>
                                <span>
                                  PnL: <span className={cn("font-bold tabular-nums", Number(item.details.pnl) >= 0 ? "text-green" : "text-red")}>
                                    {fmtUSD(item.details.pnl)}
                                  </span>
                                </span>
                              </>
                            )}
                            {item.details.missingSignals && item.details.missingSignals.length > 0 && (
                              <>
                                <span className="text-dim/30">|</span>
                                <span className="text-amber">
                                  Missing: {item.details.missingSignals.join(', ')}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

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
