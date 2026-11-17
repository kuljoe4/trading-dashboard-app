import { resolveStrategyConfig } from '../utils/strategyConfig.js';
import React, { useMemo, useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { shallow } from 'zustand/shallow'
import { pnlClass, fmtUSD } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { getMarketRegimeInfo } from '../utils/marketRegime'
import {
  SIGNAL_LABELS,
  formatSignalLabel,
  formatSignalValue,
  getStrategyRulesDiagnostics,
  buildStrategyNarrative,
  formatDiagnosticDetailEntry,
} from '../utils/strategyDiagnostics'
import {
  StatCard, SectionLabel, StatusBadge,
  CopyButton, cn, ViewHeader, Tooltip
} from '../components/ui/primitives'
import { CandidateConditionsGauge } from '../components/ui/CandidateConditionsGauge'
import { calculateOpportunityProximity } from '../lib/formatters'
import { calculatePerformanceMetrics } from '../lib/analytics'
import { ScannerPreview } from '../components/ScannerPreview'
import {
  Activity, BarChart3, Zap, Pause, Play, Edit3, Loader2, Calendar as CalendarIcon,
  ChevronDown, Turtle, Flame, RefreshCw, Clock, Radio, Search,
  Copy, Check, FileText, X, ShieldCheck, AlertTriangle, CheckCircle2, Ban
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

const VerdictTag = React.memo(({ status, customLabel }) => {
  const map = {
    allowed: { label: customLabel || 'ALLOWED', cls: 'text-green font-semibold' },
    firing: { label: customLabel || 'FIRED', cls: 'text-green font-semibold' },
    rejected: { label: customLabel || 'REJECTED', cls: 'text-red font-semibold' },
    clamped: { label: customLabel || 'CLAMPED', cls: 'text-amber font-semibold' },
    warning: { label: customLabel || 'WARNING', cls: 'text-amber font-semibold' },
    warming: { label: customLabel || 'WARMING', cls: 'text-amber font-semibold' },
    waiting: { label: customLabel || 'WAITING', cls: 'text-dim font-medium' },
    configured: { label: customLabel || 'ARMED', cls: 'text-dim font-medium' },
    neutral: { label: customLabel || 'INFO', cls: 'text-dim font-medium' },
  };
  const item = map[status] || map.neutral;
  return (
    <span className={cn("text-[11px] font-mono uppercase tracking-wide whitespace-nowrap inline-flex items-center gap-1", item.cls)}>
      {(status === 'allowed' || status === 'firing') && <CheckCircle2 size={11} className="shrink-0" />}
      {status === 'rejected' && <Ban size={11} className="shrink-0" />}
      {(status === 'clamped' || status === 'warning' || status === 'warming') && <AlertTriangle size={11} className="shrink-0" />}
      <span>{item.label}</span>
    </span>
  );
});
VerdictTag.displayName = 'VerdictTag';

const LiveStreamAge = React.memo(({ lastUpdateTs, compact = false }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const ageSec = Math.max(0, ((now - (lastUpdateTs || now)) / 1000)).toFixed(1);
  const fresh = Number(ageSec) < 5.0;
  return (
    <span className="inline-flex items-center gap-1 text-text/80 shrink-0">
      <Radio size={11} className={fresh ? "text-green animate-pulse" : "text-amber"} />
      <span className="tabular-nums">{compact ? `${ageSec}s` : (fresh ? `Live ${ageSec}s` : `Sync ${ageSec}s`)}</span>
    </span>
  );
});
LiveStreamAge.displayName = 'LiveStreamAge';

const formatRelativeAge = (ts, refNow) => {
  if (!ts) return 'just now';
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(ms) || ms <= 0) return 'just now';
  const diffSec = Math.max(0, Math.floor((refNow - ms) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
};

const LiveRelativeTime = React.memo(({ ts, nowMs }) => {
  return <>{formatRelativeAge(ts, nowMs || Date.now())}</>;
});
LiveRelativeTime.displayName = 'LiveRelativeTime';

const entrySnapshotOpportunity = (trade) => {
  const snapshot = trade?.entry_signal_snapshot;
  if (!snapshot?.signalResult) return null;
  return {
    symbol: trade.symbol,
    pct: Number(snapshot.candidate_momentum || 0),
    momentum: Number(snapshot.candidate_momentum || 0),
    price: Number(snapshot.candidate_price || trade.entry_price || 0),
    close: Number(snapshot.candidate_price || trade.entry_price || 0),
    dir: String(snapshot.direction || trade.direction || 'LONG').toLowerCase(),
    direction: String(snapshot.direction || trade.direction || 'LONG').toLowerCase(),
    score: Number(snapshot.candidate_score || 0),
    signalResult: snapshot.signalResult,
    breakout_rank: snapshot.breakout_rank,
    capRespected: snapshot.cap_respected,
    snapshotConfig: snapshot.config,
    snapshotCapturedAt: snapshot.captured_at_ms,
    isEntrySnapshot: true,
    snapshotTradeStatus: trade.status,
    snapshotTradeId: trade.id,
  };
};

const StrategyDetailView = ({ s, onBack, onEdit, onPause, onOpenScanner }) => {
  const {
    config, scannerResults, variantScannerResults, analytics, wsStatus, isSyncing,
    isThrottled, isSyncingOnResume, sessionActive, pausedStrategies, sessionPaused,
    activeTrades, tradeHistory, logs, strategyGateStates, lastAuthoritativeUpdateTs,
    lastScanTs, gateState, gateReason, storeBalance, totalSessionPnl, healthEnabled
  } = useTradingStore(state => ({
    config: state.config,
    scannerResults: state.scannerResults,
    variantScannerResults: state.variantScannerResults,
    analytics: state.analytics,
    wsStatus: state.wsStatus,
    isSyncing: state.isSyncing,
    isThrottled: state.isThrottled,
    isSyncingOnResume: state.isSyncingOnResume,
    sessionActive: state.sessionActive,
    pausedStrategies: state.pausedStrategies || [],
    sessionPaused: state.sessionPaused,
    activeTrades: state.activeTrades,
    tradeHistory: state.tradeHistory,
    logs: state.logs || [],
    strategyGateStates: state.strategyGateStates || {},
    lastAuthoritativeUpdateTs: state.lastAuthoritativeUpdateTs || Date.now(),
    lastScanTs: state.lastScanTs,
    gateState: state.gateState || 'ACTIVE',
    gateReason: state.gateReason || 'OK',
    storeBalance: state.balance,
    totalSessionPnl: state.totalPnl || 0,
    healthEnabled: state.healthEnabled,
  }), shallow)
  const [selectedTradeId, setSelectedTradeId] = useState(null)
  const [selectedFocusSymbol, setSelectedFocusSymbol] = useState(null)
  const [showPnl, setShowPnl] = useState(true)
  const [showHitRate, setShowHitRate] = useState(true)
  const [showPf, setShowPf] = useState(false)
  const [showSharpe, setShowSharpe] = useState(false)
  const [showSortino, setShowSortino] = useState(false)
  const [isPausing, setIsPausing] = useState(false)
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)
  const [syncingTfMap, setSyncingTfMap] = useState({})
  const [isBatchSyncing, setIsBatchSyncing] = useState(false)
  const [activeTab, setActiveTab] = useState('pipeline') // 'pipeline' | 'decisions' | 'performance'
  const [rulesMobileSection, setRulesMobileSection] = useState('all') // 'all' | 'entry' | 'exit' | 'risk'
  const [showAllStaticSymbols, setShowAllStaticSymbols] = useState(false)
  const [showWarmupDebug, setShowWarmupDebug] = useState(null)
  const [showScannerPreview, setShowScannerPreview] = useState(false)
  const [showComplianceNotes, setShowComplianceNotes] = useState(false)
  const [expandedReasonIds, setExpandedReasonIds] = useState({})
  const [visibleReasonsLimit, setVisibleReasonsLimit] = useState(25)
  const [decisionLogNowMs, setDecisionLogNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (typeof useTradingStore.getState().fetchLogs === 'function') {
      useTradingStore.getState().fetchLogs(200);
    }
  }, [s?.strategy_label]);

  useEffect(() => {
    if (activeTab !== 'decisions') return undefined;
    setDecisionLogNowMs(Date.now());
    const timer = setInterval(() => setDecisionLogNowMs(Date.now()), 10000);
    return () => clearInterval(timer);
  }, [activeTab]);
  const toggleReasonDetails = useCallback((id) => {
    setExpandedReasonIds(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Journey Map & Faceted Decision Log State
  const [activeJourneyMilestone, setActiveJourneyMilestone] = useState(null)
  const [reasonsOutcome, setReasonsOutcome] = useState('all') // 'all' | 'allowed' | 'rejected' | 'waiting'
  const [reasonsStage, setReasonsStage] = useState('all') // 'all' | '1'..'6'
  const [reasonsSymbol, setReasonsSymbol] = useState('all')
  const [hideRoutineMisses, setHideRoutineMisses] = useState(true)
  const [reasonsViewMode, setReasonsViewMode] = useState('timeline') // 'timeline' | 'story'
  const [reasonsSearch, setReasonsSearch] = useState('')
  const [copiedReasonId, setCopiedReasonId] = useState(null)

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
      variant.watchlist_offset !== undefined ||
      variant.discovery_mode !== undefined ||
      variant.scan_interval !== undefined ||
      variant.global_scanner_enabled !== undefined ||
      variant.smart_watchlist_enabled !== undefined ||
      variant.smart_watchlist_sensitivity !== undefined;

    const variantSymbols = hasVariantSymbols
      ? variant.symbols
      : (hasVariantScannerOverride ? [] : baseSymbols);

    return {
      ...resolveStrategyConfig(config, variant),
      symbols: variantSymbols
    };
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
    if (isVariant) {
      return [];
    }
    return scannerResults || [];
  }, [variantScannerResults, scannerResults, s?.strategy_label, isVariant]);

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume
  const showResumingFeedback = sessionActive && isResuming

  // Lifecycle-scoped subscription contract
  useResourceFocus('strategy', s.strategy_label);

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

  const strategyTrades = useMemo(() => {
    const trades = Array.isArray(tradeHistory) ? tradeHistory : [];
    return trades.filter(t => (t.strategy_label || 'Momentum Strategy') === s.strategy_label);
  }, [tradeHistory, s.strategy_label]);

  // Per-strategy performance metrics calculation
  const stratPerformance = useMemo(() => {
    const metrics = calculatePerformanceMetrics(strategyTrades, startingBal);
    const total = strategyTrades.length;

    const rawHitRate = total > 0 ? (metrics.wins / total) * 100 : 0;
    const hitRate = Math.min(100, Math.max(0, rawHitRate));
    const overallWr = typeof analytics?.overallWinRate === 'number' ? analytics.overallWinRate : 50;
    const hitRateRatio = overallWr > 0 ? hitRate / overallWr : 1.0;

    const targetRr = strategyConfig.exit_rr_target || strategyConfig.min_rr || strategyConfig.tp_ratio || 1.5;
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
  }, [strategyTrades, analytics, strategyConfig, startingBal]);

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
    .sort((a, b) => b.proximity - a.proximity);
  }, [strategyScannerResults, strategyConfig]);

  const focusedOpp = useMemo(() => {
    if (selectedFocusSymbol) {
      if (selectedFocusSymbol.startsWith('trade:')) {
        const tradeId = selectedFocusSymbol.slice(6);
        const selectedSnapshotTrade = [...strategyActiveTrades, ...strategyTrades]
          .find(t => String(t.id) === tradeId);
        const snapshotOpp = entrySnapshotOpportunity(selectedSnapshotTrade);
        if (snapshotOpp) return snapshotOpp;
      } else {
        const found = proximityLeaderboard.find(r => r.symbol === selectedFocusSymbol)
          || strategyScannerResults.find(r => r.symbol === selectedFocusSymbol);
        if (found) return found;
        const activeT = strategyActiveTrades.find(t => t.symbol === selectedFocusSymbol);
        if (activeT) {
          const snapshotOpp = entrySnapshotOpportunity(activeT);
          if (snapshotOpp) return snapshotOpp;
        }
        return { symbol: selectedFocusSymbol, pct: 0, dir: '---', signalResult: { allFired: false, firedSignals: [] } };
      }
    }
    if (proximityLeaderboard[0]) return proximityLeaderboard[0];
    if (strategyScannerResults[0]) return strategyScannerResults[0];
    if (strategyActiveTrades[0]) {
      const snapshotOpp = entrySnapshotOpportunity(strategyActiveTrades[0]);
      if (snapshotOpp) return snapshotOpp;
      return {
        symbol: strategyActiveTrades[0].symbol,
        pct: 0,
        dir: String(strategyActiveTrades[0].direction || 'LONG').toLowerCase(),
        close: Number(strategyActiveTrades[0].current_price || strategyActiveTrades[0].entry_price || 0),
      };
    }
    return { symbol: '---', pct: 0, dir: '---' };
  }, [selectedFocusSymbol, strategyScannerResults, proximityLeaderboard, strategyActiveTrades, strategyTrades]);

  const bestOpp = focusedOpp;
  const diagnosticStrategyConfig = useMemo(() => (
    bestOpp?.isEntrySnapshot && bestOpp.snapshotConfig
      ? { ...strategyConfig, ...bestOpp.snapshotConfig }
      : strategyConfig
  ), [bestOpp, strategyConfig]);
  const focusedActiveTrade = useMemo(() => {
    return strategyActiveTrades.find(t => t.symbol === focusedOpp.symbol) || strategyActiveTrades[0] || null;
  }, [strategyActiveTrades, focusedOpp.symbol]);
  const isClosedHistorySnapshot = Boolean(
    bestOpp?.isEntrySnapshot && bestOpp?.snapshotTradeStatus && bestOpp.snapshotTradeStatus !== 'OPEN'
  );
  const focusedTradeForGauge = useMemo(() => {
    if (isClosedHistorySnapshot || !bestOpp?.symbol || bestOpp.symbol === '---') return null;
    if (selectedFocusSymbol?.startsWith('trade:')) {
      const tid = selectedFocusSymbol.slice(6);
      const byId = strategyActiveTrades.find(t => String(t.id) === tid);
      if (byId) return byId;
    }
    return strategyActiveTrades.find(t => t.symbol === bestOpp.symbol) || null;
  }, [isClosedHistorySnapshot, bestOpp?.symbol, selectedFocusSymbol, strategyActiveTrades]);

  const scanMet = bestOpp.symbol !== '---' && Math.abs(bestOpp.pct || 0) >= (strategyConfig.scan_pct_threshold ?? 2.0);
  const signalResult = bestOpp.signalResult || { allFired: false, firedSignals: [] };
  const entryMet = scanMet && Boolean(signalResult.allFired);
  const signalsCount = strategyConfig.enabled_signals?.length || 0;
  const firedCount = signalResult.firedSignals?.length || 0;
  const signalLogic = strategyConfig.signal_logic || 'all';
  const requiredSignals = strategyConfig.required_signals || [];

  // Single-pass signal label classification (preserved for BOLT test invariant)
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
    ? `${reqLabels.length > 0 ? `Req(${reqLabels.join(' & ')})` : 'Req(Base)'} & ${optLabels.length > 0 ? `Any(${optLabels.join(' | ')})` : 'Any'}`
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
        map[sym] = { state: 'POSITION', label: 'In Position', trade: activeTrade };
        continue;
      }
      const opp = proximityLeaderboard.find(r => r.symbol === sym) || strategyScannerResults.find(r => r.symbol === sym);
      if (opp?.signalResult?.allFired) {
        map[sym] = { state: 'TRIGGERED', label: 'Fired', opp };
        continue;
      }
      if (opp) {
        map[sym] = { state: 'EVALUATING', label: `${opp.proximity ?? 0}%`, opp };
        continue;
      }
      map[sym] = { state: 'MONITORING', label: 'Watching' };
    }
    return map;
  }, [staticSymbols, strategyActiveTrades, proximityLeaderboard, strategyScannerResults]);

  // Active Trade / Candidate End-to-End Lifecycle Stage Resolution
  const currentLifecycleStage = useMemo(() => {
    const activeTrade = strategyActiveTrades.find(t => t.symbol === focusedOpp.symbol);
    if (activeTrade) {
      const sl = Number(activeTrade.current_sl ?? activeTrade.sl_price ?? 0);
      const entry = Number(activeTrade.entry_price || 0);
      const isLong = activeTrade.direction === 'LONG';
      const isSlAtBreakeven = sl > 0 && (isLong ? sl >= entry - 1e-6 : sl <= entry + 1e-6);

      if (activeTrade.exit_signals_status && Object.values(activeTrade.exit_signals_status).some(st => st?.fired)) {
        return {
          stageNumber: 6,
          title: 'Stage 6: Exit Signal Triggered',
          statusLabel: 'Exit Fired',
          toneClass: 'text-red',
          desc: 'Exit condition crossed; order close pending.'
        };
      }
      if (isSlAtBreakeven || activeTrade.risk_usdt === 0) {
        return {
          stageNumber: 5,
          title: 'Stage 5: Risk Protected Position',
          statusLabel: 'Protected 0R',
          toneClass: 'text-green',
          desc: 'Stop loss ratcheted to breakeven or better.'
        };
      }
      return {
        stageNumber: 4,
        title: 'Stage 4: Active Managed Position',
        statusLabel: 'In Position',
        toneClass: 'text-accent',
        desc: 'Position open on exchange with active SL/TP.'
      };
    }

    if (entryMet) {
      return {
        stageNumber: 3,
        title: 'Stage 3: Risk Guard & Execution',
        statusLabel: effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK' ? 'Gated' : 'Checking Risk',
        toneClass: effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK' ? 'text-red' : 'text-amber',
        desc: 'Entry signals matched; evaluating SL bounds & risk caps.'
      };
    }

    if (scanMet || firedCount > 0) {
      return {
        stageNumber: 2,
        title: 'Stage 2: Technical Signal Evaluation',
        statusLabel: `${firedCount}/${signalsCount} Fired`,
        toneClass: 'text-accent',
        desc: `Evaluating technical signal formula (${conditionFormula}).`
      };
    }

    return {
      stageNumber: 1,
      title: 'Stage 1: Scope & Discovery',
      statusLabel: 'Monitoring',
      toneClass: 'text-dim',
      desc: isStaticWatchlist ? 'Monitoring configured Static Watchlist targets.' : 'Scanning Smart Watchlist discovery feed.'
    };
  }, [focusedOpp.symbol, strategyActiveTrades, entryMet, scanMet, firedCount, signalsCount, isStaticWatchlist, effectiveGate, conditionFormula]);

  // Single-shot pipeline stage transition feedback (fires only when focused symbol shifts stage)
  const prevStageRef = useRef({ symbol: null, stageNumber: null });
  const [stageTransition, setStageTransition] = useState(null);
  useEffect(() => {
    const sym = focusedOpp?.symbol;
    const prev = prevStageRef.current;
    prevStageRef.current = { symbol: sym, stageNumber: currentLifecycleStage.stageNumber };

    if (!sym || sym === '---' || prev.symbol !== sym || prev.stageNumber === null || prev.stageNumber === currentLifecycleStage.stageNumber) {
      return undefined;
    }

    setStageTransition({
      symbol: sym,
      fromStage: prev.stageNumber,
      stageNumber: currentLifecycleStage.stageNumber,
      statusLabel: currentLifecycleStage.statusLabel,
    });
    const timer = setTimeout(() => setStageTransition(null), 1800);
    return () => clearTimeout(timer);
  }, [focusedOpp?.symbol, currentLifecycleStage.stageNumber, currentLifecycleStage.statusLabel]);

  // Evaluation Timeframe Debug Table Data Construction (kept before journeyMilestones for TDZ test invariant)
  const timeframeDebugItems = useMemo(() => {
    const enabled = [
      ...(strategyConfig.enabled_signals || []),
      ...(strategyConfig.exit_signals || []),
      ...(strategyConfig.trigger_candle_exit_enabled ? ['trigger_candle_exit'] : []),
    ];
    const scanTf = strategyConfig.scan_interval || '1m';
    const items = [];

    const hasCand = bestOpp.symbol && bestOpp.symbol !== '---';
    // ohlc_history/history are intentionally sliced to SPARKLINE_HISTORY_LEN (20) by the backend for bandwidth savings;
    // never treat the 20-bar UI sparkline as klineStore depth. Use explicit candle_count when provided.
    const knownCandleCount = typeof bestOpp.candle_count === 'number' && Number.isFinite(bestOpp.candle_count)
      ? bestOpp.candle_count
      : null;
    const reqScanWarmup = Math.max(2, Number(strategyConfig.scan_lookback || 1) + 1);
    const scannerWarming = knownCandleCount !== null && knownCandleCount < reqScanWarmup;
    const isEvaluated = Boolean(hasCand && (bestOpp.signalResult || (bestOpp.ohlc_history?.length || bestOpp.history?.length || 0) > 0 || knownCandleCount !== null));

    items.push({
      key: 'scanner',
      label: 'Scanner Velocity',
      tf: scanTf,
      candles: knownCandleCount,
      required: scannerWarming ? reqScanWarmup : null,
      isWarming: scannerWarming,
      statusMsg: !hasCand
        ? 'Standby'
        : scannerWarming
          ? `${knownCandleCount}/${reqScanWarmup}`
          : (knownCandleCount !== null ? `${knownCandleCount} bars` : (isEvaluated ? 'Engine Synced' : 'Standby'))
    });

    if (strategyConfig.sl_lookback_timeframe && strategyConfig.sl_lookback_timeframe !== 'default') {
      const slTf = strategyConfig.sl_lookback_timeframe;
      const slPeriod = Number(strategyConfig.sl_lookback_period || 20);
      items.push({
        key: 'sl_lookback',
        label: 'SL Lookback Range',
        tf: slTf,
        candles: knownCandleCount,
        required: slPeriod,
        isWarming: false,
        statusMsg: `${slPeriod} bars`
      });
    }

    const uniqueSigs = Array.from(new Set(enabled));
    for (const sig of uniqueSigs) {
      let baseSig = sig;
      const lastUnderscore = sig.lastIndexOf('_');
      if (lastUnderscore > 0) {
        const potentialBase = sig.substring(0, lastUnderscore);
        baseSig = potentialBase;
      }
      const rawTf = (strategyConfig.signal_timeframes || {})[sig] || (strategyConfig.signal_timeframes || {})[baseSig];
      const tf = (!rawTf || rawTf === 'default') ? scanTf : rawTf;
      const sigDetail = signalResult.signals?.[sig] || signalResult.signals?.[baseSig] || {};

      const isWarming = sigDetail.insufficientData === true;
      const candles = typeof sigDetail.candleCount === 'number'
        ? sigDetail.candleCount
        : (!isWarming && tf === scanTf && knownCandleCount !== null ? knownCandleCount : null);
      const required = isWarming && typeof sigDetail.requiredCandles === 'number'
        ? sigDetail.requiredCandles
        : null;

      items.push({
        key: sig,
        label: formatSignalLabel(sig),
        tf,
        candles,
        required,
        isWarming,
        statusMsg: !hasCand
          ? 'Standby'
          : isWarming
            ? (candles !== null && required !== null ? `${candles}/${required}` : 'Warming')
            : (candles !== null ? `${candles} bars` : (isEvaluated ? 'Engine Synced' : 'Standby'))
      });
    }

    return items;
  }, [strategyConfig, bestOpp, signalResult]);

  const anyWarming = useMemo(() => timeframeDebugItems.some(i => i.isWarming), [timeframeDebugItems]);
  const isWarmupOpen = showWarmupDebug === null ? anyWarming : showWarmupDebug;

  // 6-Milestone Interactive Journey Map Specification
  const journeyMilestones = useMemo(() => {
    return [
      {
        num: 1,
        title: '1. Scope & Discovery',
        short: 'Scope',
        status: isStaticWatchlist ? `Static (${staticSymbols.length})` : `Top ${strategyConfig.watchlist_size || 15}`,
        tone: 'neutral',
        desc: isStaticWatchlist
          ? `Fixed universe of ${staticSymbols.length} pairs explicitly monitored.`
          : `Smart discovery scanning 24h ${strategyConfig.discovery_mode || 'volume'} universe on ${strategyConfig.scan_interval || '5m'}.`,
        criteria: [
          { label: 'Universe', value: isStaticWatchlist ? `${staticSymbols.length} Static Symbols` : `Top ${strategyConfig.watchlist_size || 15} (${strategyConfig.discovery_mode || 'volume'})` },
          { label: 'Min 24h Vol', value: `$${((strategyConfig.scan_min_volume_usdt || 500000) / 1000).toLocaleString()}k` },
          { label: 'Scan TF / Lookback', value: `${strategyConfig.scan_interval || '5m'} · ${strategyConfig.scan_lookback || 3} bars` },
          { label: 'Velocity Threshold', value: `±${strategyConfig.scan_pct_threshold || 2.0}%` }
        ]
      },
      {
        num: 2,
        title: '2. Technical Entry Rules',
        short: 'Signals',
        status: entryMet ? 'Triggered' : (firedCount > 0 ? `${firedCount}/${signalsCount} Fired` : 'Evaluating'),
        tone: entryMet ? 'positive' : firedCount > 0 ? 'accent' : 'neutral',
        desc: `Evaluating ${signalsCount} entry signal(s) with ${signalLogic.toUpperCase()} logic on ${strategyConfig.entry_side || 'both'} side.`,
        criteria: [
          { label: 'Entry Side', value: (strategyConfig.entry_side || 'both').toUpperCase() },
          { label: 'Formula Logic', value: conditionFormula },
          { label: 'Required (AND)', value: reqLabels.join(', ') || 'All equal' },
          { label: 'Candle Warmup', value: `${timeframeDebugItems.filter(i => !i.isWarming).length}/${timeframeDebugItems.length} Ready` }
        ]
      },
      {
        num: 3,
        title: '3. Pre-Trade Risk & SL Bounds',
        short: 'Risk & SL',
        status: isStrategyPaused ? 'Paused' : (effectiveGate === 'ACTIVE' || effectiveGate === 'OK') ? 'Ready' : 'Blocked',
        tone: isStrategyPaused ? 'warning' : (effectiveGate === 'ACTIVE' || effectiveGate === 'OK') ? 'positive' : 'danger',
        desc: 'Validates SL bounds, anti-whipsaw delay, trade frequency, and portfolio exposure caps.',
        criteria: [
          { label: 'SL Model & Bounds', value: `${strategyConfig.sl_type || 'pct'} (${strategyConfig.sl_min_pct ?? 0.3}%–${strategyConfig.sl_max_pct ?? 3.0}% · ${strategyConfig.sl_out_of_bounds_action || 'clamp'})` },
          { label: 'Risk Per Trade', value: `${strategyConfig.risk_pct_per_trade || 1.0}% ($${((startingBal * (strategyConfig.risk_pct_per_trade || 1.0)) / 100).toFixed(2)})` },
          { label: 'Max Risk / Slots', value: `${strategyConfig.max_total_risk_pct || 5.0}% Cap · ${strategyConfig.max_open_trades || 3} Open` },
          { label: 'Anti-Whipsaw', value: `${strategyConfig.anti_whipsaw_candle_delay ?? 1}c (≤${strategyConfig.anti_whipsaw_max_tf || '4h'})` }
        ]
      },
      {
        num: 4,
        title: '4. Order Execution',
        short: 'Execution',
        status: strategyActiveTrades.length > 0 ? `${activeTradeCount} Open` : 'Standby',
        tone: strategyActiveTrades.length > 0 ? 'accent' : 'neutral',
        desc: 'Places entry order and protective stop-loss simultaneously with precision filters.',
        criteria: [
          { label: 'Initial SL', value: `${strategyConfig.sl_distance_pct || 0.8}% (${strategyConfig.sl_type || 'pct'})` },
          { label: 'Order Sizing', value: strategyConfig.auto_scale_min_notional !== false ? `Risk + Min-Notional (≤${strategyConfig.auto_scale_max_overshoot ?? 3}x)` : 'Strict Risk' },
          { label: 'Slippage Abort', value: `${strategyConfig.slippage_abort_threshold ?? 1.5}%` },
          { label: 'Active Positions', value: `${activeTradeCount} Open` }
        ],
        protocolNote: 'Uses Algo Conditional API with mandatory STOP_MARKET (explicit LOT_SIZE quantity) fallback.'
      },
      {
        num: 5,
        title: '5. Protection & Trailing',
        short: 'Protection',
        status: strategyActiveTrades.some(t => t.current_sl && Number(t.current_sl) >= Number(t.entry_price)) ? 'Protected 0R' : 'Monitoring',
        tone: strategyActiveTrades.some(t => t.current_sl && Number(t.current_sl) >= Number(t.entry_price)) ? 'positive' : 'neutral',
        desc: 'Automated SL ratcheting along R:R ladder and optional trailing stop.',
        criteria: [
          { label: 'Trailing Stop', value: strategyConfig.trailing_stop_enabled ? `${strategyConfig.trailing_stop_distance_pct || 1.0}% (Act ≥ ${strategyConfig.trailing_activation_rr ?? 0}R)` : 'Disabled' },
          { label: 'Guard Ladder', value: (strategyConfig.live_rr_sequence || [1, 2, 4]).map((v, i) => `${v}R→${(strategyConfig.exit_rr_sequence || [0, 1, 2])[i] ?? 0}R`).join(', ') },
          { label: 'Risk Release', value: strategyConfig.force_risk_release ? 'Force ON' : 'At Breakeven SL' },
          { label: 'Guard Buffer', value: `${strategyConfig.trailing_guard_buffer_pct ?? 0.1}%` }
        ],
        protocolNote: 'Gapless Cancel-then-Replace SL updates with automatic re-arm rollback and 0.01% min delta guard.'
      },
      {
        num: 6,
        title: '6. Exit & Resolution',
        short: 'Exit',
        status: stratPerformance.total > 0 ? `${stratPerformance.wins}W / ${stratPerformance.losses}L` : 'Ready',
        tone: stratPerformance.total > 0 ? (stratPerformance.sumPnl >= 0 ? 'positive' : 'danger') : 'neutral',
        desc: 'Closes positions on technical exit signals, TP targets, or stop-loss.',
        criteria: [
          { label: 'TP Mode / Target', value: `${strategyConfig.tp_mode || 'fixed'} (${strategyConfig.tp_ratio || 2.0}R)` },
          { label: 'Exit Signals', value: (strategyConfig.exit_signals || []).map(sig => formatSignalLabel(sig)).join(', ') || 'SL / TP Only' },
          { label: 'Realized PnL', value: fmtUSD(stratPerformance.sumPnl) },
          { label: 'Win Rate', value: `${stratPerformance.hitRate.toFixed(1)}% (${stratPerformance.total})` }
        ]
      }
    ];
  }, [
    isStaticWatchlist, staticSymbols.length, strategyConfig, entryMet, firedCount, signalsCount,
    signalLogic, conditionFormula, reqLabels, timeframeDebugItems, isStrategyPaused, effectiveGate,
    startingBal, strategyActiveTrades, activeTradeCount, stratPerformance
  ]);

  // Rule & Constraint Diagnostics (Entries, Exits, Params, Timeframes, Risk & SL Allowed/Rejected)
  const rulesDiagnostics = useMemo(() => {
    return getStrategyRulesDiagnostics({
      strategyConfig: diagnosticStrategyConfig,
      focusedOpp: bestOpp,
      activeTrade: focusedActiveTrade,
      activeTradeCount,
      totalRiskPct: Number(s.totalRiskPct || 0),
      startingBal,
      effectiveGate,
      effectiveReason,
      isStrategyPaused,
    });
  }, [
    diagnosticStrategyConfig, bestOpp, focusedActiveTrade, activeTradeCount, s.totalRiskPct,
    startingBal, effectiveGate, effectiveReason, isStrategyPaused
  ]);

  const formatClockTime = useCallback((ts) => {
    if (!ts) return '--:--:--';
    const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
    if (isNaN(ms) || ms <= 0) return '--:--:--';
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, []);

  const formatTimeAgo = useCallback((ts) => {
    return formatRelativeAge(ts, lastAuthoritativeUpdateTs || Date.now());
  }, [lastAuthoritativeUpdateTs]);

  const regimeInfo = getMarketRegimeInfo(strategyScannerResults, strategyConfig, { scannerPaused: isStrategyPaused });

  const handleCopyReason = useCallback((item) => {
    try {
      const payload = JSON.stringify({
        outcome: item.outcome,
        stage: item.stage,
        symbol: item.symbol,
        title: item.title,
        reason: item.reason,
        timestamp: new Date(item.timestamp).toISOString(),
        details: item.details
      }, null, 2);
      navigator.clipboard.writeText(payload);
      setCopiedReasonId(item.id);
      setTimeout(() => setCopiedReasonId(null), 1800);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  }, []);

  // Stable fallback timestamp so entries don't drift on 1s timer ticks
  const stableFallbackTs = lastScanTs || lastAuthoritativeUpdateTs;

  // Track latest Stage 3 cooldown/anti-whipsaw/skip blocks per symbol so Stage 2 doesn't contradict Stage 3 with ALLOWED
  const activeStage3BlockBySymbol = useMemo(() => {
    const map = new Map();
    const otherStrategyLabels = [
      config?.strategy_label,
      ...((config?.strategy_variants || []).map(v => v?.strategy_label)),
    ].filter(lbl => lbl && lbl !== stratName);

    for (let i = 0; i < (logs || []).length; i++) {
      const log = logs[i];
      const msg = typeof log.message === 'string' ? log.message : (typeof log.msg === 'string' ? log.msg : '');
      if (!msg) continue;
      if (!msg.includes('Entry skipped') && !msg.includes('Entry Rejected') && !msg.includes('Anti-Whipsaw')) continue;
      const isStrategyLog = msg.includes(`(${stratName})`) || msg.includes(stratName);
      const isOtherStrategyLog = !isStrategyLog && otherStrategyLabels.some(lbl => msg.includes(`(${lbl})`));
      if (isOtherStrategyLog) continue;

      const symMatch = msg.match(/\b([A-Z0-9]{2,12}USDT)\b/);
      if (!symMatch) continue;
      const sym = symMatch[1];
      const logTs = log.ts_ms || (log.timestamp ? new Date(log.timestamp).getTime() : (log.ts ? new Date(log.ts).getTime() : 0));
      if (!logTs) continue;

      const remMatch = msg.match(/\((\d+)s remaining/i);
      const expiresAt = remMatch ? logTs + Number(remMatch[1]) * 1000 : logTs + 90_000;
      const existing = map.get(sym);
      if (!existing || logTs > existing.logTs) {
        const cleaned = msg.replace(/\[(Decision|Anti-Whipsaw|Execution)\]\s*/g, '').trim();
        map.set(sym, { logTs, expiresAt, reason: cleaned });
      }
    }
    return map;
  }, [logs, stratName, config?.strategy_label, config?.strategy_variants]);

  // Aggregated Strategy Reasons & Causal Decision Log
  const liveStrategyReasons = useMemo(() => {
    const list = [];
    const scanThr = Number(strategyConfig.scan_pct_threshold ?? 2.0);
    const entrySide = (strategyConfig.entry_side || 'both').toLowerCase();
    const slMaxPct = Number(strategyConfig.sl_max_pct ?? 3.0);
    const slOobAction = strategyConfig.sl_out_of_bounds_action || (strategyConfig.reject_entry_if_sl_exceeds_max === false ? 'clamp' : 'reject');

    // 1. Live Candidate Signal & Pre-Trade Evaluations
    const opps = proximityLeaderboard.length > 0 ? proximityLeaderboard : (strategyScannerResults || []);
    opps.slice(0, 12).forEach(opp => {
      const candTs = opp.lastUpdate || opp.ts || opp.timestamp || stableFallbackTs;
      const candDir = (opp.dir || (opp.pct >= 0 ? 'LONG' : 'SHORT')).toUpperCase();
      const oppPctAbs = Math.abs(opp.pct || 0);
      const scanMetLocal = oppPctAbs >= scanThr;
      const sigRes = opp.signalResult || {};
      const sigMap = sigRes.signals || {};
      const allFired = !!sigRes.allFired;

      // Side rejection
      if (entrySide !== 'both' && entrySide.toUpperCase() !== candDir) {
        list.push({
          id: `cand-side-${opp.symbol}`,
          outcome: 'rejected',
          isRoutine: false,
          stageNum: '2',
          stage: '2. Signals',
          symbol: opp.symbol,
          direction: candDir,
          title: `Direction Rejected (${candDir} blocked by entry_side=${entrySide})`,
          reason: `Candidate moved ${Number(opp.pct || 0).toFixed(2)}% (${candDir}), rejected because strategy entry_side is restricted to ${entrySide.toUpperCase()}.`,
          timestamp: candTs,
          details: { direction: candDir, allowedSide: entrySide, velocity: `${Number(opp.pct || 0).toFixed(2)}%`, timeframe: strategyConfig.scan_interval || '5m' }
        });
        return;
      }

      // Check individual rejected signal filters (e.g. MACD filter rejection, max expansion cap)
      const rejectedSignals = Object.entries(sigMap).filter(([, d]) => d?.rejected || d?.status === 'blocked');
      if (rejectedSignals.length > 0) {
        const [rKey, rDet] = rejectedSignals[0];
        list.push({
          id: `cand-sig-rej-${opp.symbol}-${rKey}`,
          outcome: 'rejected',
          isRoutine: false,
          stageNum: '2',
          stage: '2. Signals',
          symbol: opp.symbol,
          direction: candDir,
          title: `Signal Filter Rejected: ${formatSignalLabel(rKey)}`,
          reason: rDet.description || `${formatSignalLabel(rKey)} crossed trigger but was rejected by secondary filter.`,
          timestamp: candTs,
          details: {
            signal: rKey,
            value: formatSignalValue(rDet.value, rDet.unit, rDet.threshold_is_price),
            threshold: formatSignalValue(rDet.threshold, rDet.unit, rDet.threshold_is_price),
            timeframe: strategyConfig.signal_timeframes?.[rKey] || strategyConfig.scan_interval || '5m',
          }
        });
      }

      // Prospective SL bound rejection/clamp
      if (typeof opp.sl_dist_pct === 'number' && opp.sl_dist_pct > slMaxPct) {
        list.push({
          id: `cand-sl-${opp.symbol}`,
          outcome: slOobAction === 'reject' ? 'rejected' : 'waiting',
          isRoutine: false,
          stageNum: '3',
          stage: '3. Risk & SL',
          symbol: opp.symbol,
          direction: candDir,
          title: slOobAction === 'reject'
            ? `SL Distance Rejected (${opp.sl_dist_pct.toFixed(2)}% > ${slMaxPct}% Max)`
            : `SL Distance Clamped (${opp.sl_dist_pct.toFixed(2)}% → ${slMaxPct}% Max)`,
          reason: `Prospective ${strategyConfig.sl_type || 'pct'} SL distance of ${opp.sl_dist_pct.toFixed(2)}% exceeds configured sl_max_pct (${slMaxPct}%). Action: ${slOobAction.toUpperCase()}.`,
          timestamp: candTs,
          details: { slType: strategyConfig.sl_type || 'pct', prospectiveSlPct: `${opp.sl_dist_pct.toFixed(2)}%`, maxSlPct: `${slMaxPct}%`, action: slOobAction }
        });
      }

      if (!scanMetLocal) {
        list.push({
          id: `cand-scan-${opp.symbol}`,
          outcome: 'waiting',
          isRoutine: true,
          stageNum: '1',
          stage: '1. Discovery',
          symbol: opp.symbol,
          direction: candDir,
          title: `Velocity Below Threshold (${oppPctAbs.toFixed(2)}% < ±${scanThr}%)`,
          reason: `${opp.symbol} move (${oppPctAbs.toFixed(2)}%) on ${strategyConfig.scan_interval || '5m'} has not reached the ±${scanThr}% entry velocity threshold.`,
          timestamp: candTs,
          details: { velocity: `${Number(opp.pct || 0).toFixed(2)}%`, threshold: `±${scanThr}%`, timeframe: strategyConfig.scan_interval || '5m', markPrice: opp.close }
        });
      } else if (!allFired) {
        const fired = sigRes.firedSignals || [];
        const missing = (strategyConfig.enabled_signals || []).filter(sig => !fired.includes(sig));
        const missingLabels = missing.map(m => formatSignalLabel(m)).join(', ');
        list.push({
          id: `cand-sig-${opp.symbol}`,
          outcome: 'waiting',
          isRoutine: false,
          stageNum: '2',
          stage: '2. Signals',
          symbol: opp.symbol,
          direction: candDir,
          title: `Signals Pending (${fired.length}/${(strategyConfig.enabled_signals || []).length} Fired)`,
          reason: `Velocity passed (${oppPctAbs.toFixed(2)}%). Waiting for: ${missingLabels || 'formula confirmation'}.`,
          timestamp: candTs,
          details: { firedSignals: fired.map(formatSignalLabel), missingSignals: missing.map(formatSignalLabel), formula: conditionFormula }
        });
      } else {
        const stage3Block = activeStage3BlockBySymbol.get(opp.symbol);
        const nowCheck = lastAuthoritativeUpdateTs || stableFallbackTs || Date.now();
        const hasActiveSkip = stage3Block && (nowCheck < stage3Block.expiresAt || stage3Block.logTs >= candTs - 15_000);
        const isStage3Blocked = isStrategyPaused
          || (effectiveGate && effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK')
          || Boolean(hasActiveSkip);
        const blockCause = isStrategyPaused
          ? 'Strategy automation paused'
          : (effectiveGate && effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK')
            ? `Risk gate ${effectiveGate}: ${effectiveReason || 'blocked'}`
            : (stage3Block?.reason || 'Execution gate active');

        list.push({
          id: `cand-fired-${opp.symbol}`,
          outcome: isStage3Blocked ? 'waiting' : 'allowed',
          isRoutine: false,
          stageNum: '2',
          stage: '2. Signals',
          symbol: opp.symbol,
          direction: candDir,
          title: isStage3Blocked
            ? `Signals Matched (${candDir}) — Held by Stage 3`
            : `Entry Formula Allowed (${candDir})`,
          reason: isStage3Blocked
            ? `Stage 2 conditions matched [${conditionFormula}] on ${strategyConfig.scan_interval || '5m'}, held at Stage 3 (${blockCause}).`
            : `All required conditions matched [${conditionFormula}] on ${strategyConfig.scan_interval || '5m'}; routed to risk engine.`,
          timestamp: candTs,
          details: { formula: conditionFormula, firedSignals: (sigRes.firedSignals || []).map(formatSignalLabel), prospectiveSlPct: opp.sl_dist_pct ? `${opp.sl_dist_pct.toFixed(2)}%` : undefined, ...(isStage3Blocked ? { stage3Hold: blockCause } : {}) }
        });
      }
    });

    // 2. Risk Gating reasons
    if (isStrategyPaused) {
      list.push({
        id: `gate-paused-${stratName}`,
        outcome: 'rejected',
        isRoutine: false,
        stageNum: '3',
        stage: '3. Risk & SL',
        symbol: 'STRATEGY',
        title: 'Strategy Automation Paused',
        reason: 'Manual pause is active — new entries are blocked while open positions continue SL and exit tracking.',
        timestamp: stratGate.updatedAt ? new Date(stratGate.updatedAt).getTime() : stableFallbackTs,
        details: { gateState: 'PAUSED' }
      });
    } else if (effectiveGate && effectiveGate !== 'ACTIVE' && effectiveGate !== 'OK') {
      list.push({
        id: `gate-blocked-${stratName}`,
        outcome: 'rejected',
        isRoutine: false,
        stageNum: '3',
        stage: '3. Risk & SL',
        symbol: 'STRATEGY',
        title: `Risk Gate Blocked (${effectiveGate.toUpperCase()})`,
        reason: `Entry orders blocked by ${effectiveGate}: ${effectiveReason || 'Risk cap or frequency guard reached'}.`,
        timestamp: stratGate.updatedAt ? new Date(stratGate.updatedAt).getTime() : stableFallbackTs,
        details: { gateState: effectiveGate, gateReason: effectiveReason }
      });
    }

    // 3. Active Trades entry, ratchet events & exit triggers
    strategyActiveTrades.forEach(trade => {
      const entryTs = trade.entry_ts_ms || (trade.entry_ts ? new Date(trade.entry_ts).getTime() : (trade.createdAt ? new Date(trade.createdAt).getTime() : stableFallbackTs));
      list.push({
        id: `entry-${trade.id || trade.symbol}`,
        outcome: 'allowed',
        isRoutine: false,
        stageNum: '4',
        stage: '4. Execution',
        symbol: trade.symbol,
        direction: trade.direction,
        title: `Entry Allowed @ $${Number(trade.entry_price || 0).toLocaleString()}`,
        reason: trade.entry_reason || trade.signal_reason || 'Entry signals and SL/risk checks passed; order filled.',
        timestamp: entryTs,
        details: {
          entryPrice: trade.entry_price,
          qty: trade.qty,
          riskUsdt: trade.risk_usdt,
          initialSl: trade.initial_sl,
          signalReason: trade.signal_reason
        }
      });

      if (Array.isArray(trade.active_trade_events)) {
        trade.active_trade_events.forEach((evt, idx) => {
          list.push({
            id: `event-${trade.id || trade.symbol}-${idx}`,
            outcome: 'allowed',
            isRoutine: false,
            stageNum: '5',
            stage: '5. Protection',
            symbol: trade.symbol,
            direction: trade.direction,
            title: evt.title || `SL Protected (${evt.type || 'Ratchet'})`,
            reason: evt.reason || evt.message || 'Stop loss updated along protection ladder.',
            timestamp: evt.timestamp_ms || (evt.timestamp ? new Date(evt.timestamp).getTime() : entryTs + (idx + 1) * 1000),
            details: evt
          });
        });
      }

      if (trade.exit_signals_status) {
        Object.entries(trade.exit_signals_status).forEach(([sigKey, status]) => {
          if (status?.fired) {
            list.push({
              id: `exit-sig-${trade.id || trade.symbol}-${sigKey}`,
              outcome: 'allowed',
              isRoutine: false,
              stageNum: '6',
              stage: '6. Exit',
              symbol: trade.symbol,
              direction: trade.direction,
              title: `Exit Signal Triggered: ${formatSignalLabel(sigKey)}`,
              reason: status.description || `Exit condition crossed (${formatSignalLabel(sigKey)}). Position closure triggered.`,
              timestamp: status?.fired_ts || (trade.exit_signals_status_ts ? new Date(trade.exit_signals_status_ts).getTime() : stableFallbackTs),
              details: { signal: sigKey, value: status.value, threshold: status.threshold }
            });
          } else if (status?.rejected || status?.status === 'blocked') {
            list.push({
              id: `exit-sig-rej-${trade.id || trade.symbol}-${sigKey}`,
              outcome: 'rejected',
              isRoutine: false,
              stageNum: '6',
              stage: '6. Exit',
              symbol: trade.symbol,
              direction: trade.direction,
              title: `Exit Signal Blocked: ${formatSignalLabel(sigKey)}`,
              reason: status.description || 'Exit signal crossed but blocked by filter or delay.',
              timestamp: stableFallbackTs,
              details: { signal: sigKey, value: status.value, threshold: status.threshold }
            });
          }
        });
      }
    });

    return list;
  }, [
    stratName, stratGate.updatedAt, proximityLeaderboard, strategyScannerResults, strategyConfig,
    isStrategyPaused, effectiveGate, effectiveReason, strategyActiveTrades,
    staticSymbols, stableFallbackTs, conditionFormula, activeStage3BlockBySymbol, lastAuthoritativeUpdateTs
  ]);

  // Memoize closed trades & log regex parsing separately from high-frequency scanner ticks
  const closedAndLogReasons = useMemo(() => {
    const list = [];

    // 4. Closed Trades exit resolutions
    strategyTrades.slice(0, 30).forEach((trade, idx) => {
      const isWin = Number(trade.pnl || 0) >= 0;
      const exitTs = trade.exit_ts_ms || (trade.exit_ts ? new Date(trade.exit_ts).getTime() : (trade.closed_at ? new Date(trade.closed_at).getTime() : stableFallbackTs - idx * 60000));
      list.push({
        id: `closed-${trade.id || trade.symbol}-${exitTs}-${idx}`,
        outcome: isWin ? 'allowed' : 'rejected',
        isRoutine: false,
        stageNum: '6',
        stage: '6. Exit',
        symbol: trade.symbol,
        direction: trade.direction,
        title: `Closed (${isWin ? 'WIN' : 'LOSS'} ${fmtUSD(trade.pnl)}): ${trade.exit_reason || (isWin ? 'Target Hit' : 'Stop Loss')}`,
        reason: `${trade.entry_reason ? `Entry: ${trade.entry_reason} → ` : ''}Exit: ${trade.exit_reason || 'Standard exit'}${trade.risk_lock_reason ? ` · Lock: ${trade.risk_lock_reason}` : ''}`,
        timestamp: exitTs,
        details: {
          entryPrice: trade.entry_price,
          exitPrice: trade.exit_price,
          initialSl: trade.initial_sl,
          exitRr: trade.exit_rr,
          pnl: trade.pnl,
          fees: trade.funding_fee
        }
      });
    });

    // 5. Relevant Engine & Scanner Diagnostic Logs
    const stratInterval = strategyConfig.scan_interval || '5m';
    const seenLogIds = new Set();
    const otherStrategyLabels = [
      config?.strategy_label,
      ...((config?.strategy_variants || []).map(v => v?.strategy_label)),
    ].filter(lbl => lbl && lbl !== stratName);

    (logs || []).forEach((log, idx) => {
      const msg = typeof log.message === 'string' ? log.message : (typeof log.msg === 'string' ? log.msg : '');
      if (!msg) return;

      const symMatch = msg.match(/\b([A-Z0-9]{2,12}USDT)\b/);
      const itemSymbol = symMatch ? symMatch[1] : 'STRATEGY';
      const isStrategyLog = msg.includes(`(${stratName})`) || msg.includes(stratName);
      const isOtherStrategyLog = !isStrategyLog && otherStrategyLabels.some(lbl => msg.includes(`(${lbl})`));
      if (isOtherStrategyLog) return;

      const isScannerDiag = msg.includes('[Scanner Diagnostic]');
      const isIntervalMatch = msg.includes(`(${stratInterval} timeframe)`) || msg.includes(`interval ${stratInterval}`) || msg.includes(`for interval ${stratInterval}`);
      const isStaticMatch = itemSymbol !== 'STRATEGY' && staticSymbols.includes(itemSymbol);

      if (!isStrategyLog && !isStaticMatch && !(isScannerDiag && isIntervalMatch)) {
        return;
      }

      const logId = log.id || `diag-${idx}-${log.ts_ms || log.timestamp || idx}`;
      if (seenLogIds.has(logId)) return;
      seenLogIds.add(logId);

      let outcome = 'waiting';
      let stageNum = '1';
      let stage = '1. Discovery';
      let title = `Engine Log: ${(log.level || 'info').toUpperCase()}`;
      let isRoutine = false;

      if (msg.includes('Candidate removed') || msg.includes('dropped from top-N watchlist')) {
        const isHardReject = msg.includes('prospective SL') || msg.includes('SL dist') || msg.includes('sl_bounds');
        outcome = isHardReject ? 'rejected' : 'waiting';
        isRoutine = !isHardReject;
        stageNum = '1';
        stage = '1. Discovery';
        const parenMatch = msg.match(/Candidate removed\s*\(([^;)]+)/i);
        const dropCause = parenMatch ? parenMatch[1].trim() : '';
        title = dropCause ? `Candidate Removed: ${itemSymbol} — ${dropCause}` : `Candidate Removed: ${itemSymbol}`;
      } else if (msg.includes('pre-filtered: prospective SL distance') || msg.includes('sl_out_of_bounds') || msg.includes('Lookback SL') || msg.includes('SL distance') || msg.includes('Invalid SL')) {
        outcome = 'rejected';
        stageNum = '3';
        stage = '3. Risk & SL';
        title = `SL Bounds Rejected: ${itemSymbol}`;
      } else if (msg.includes('[Decision]') && (msg.includes('Warmup') || msg.includes('candles'))) {
        outcome = 'rejected';
        stageNum = '1';
        stage = '1. Discovery';
        title = `Warmup Skipped: ${itemSymbol}`;
      } else if (msg.includes('Entry skipped') || msg.includes('Entry Rejected') || msg.includes('rejected') || msg.includes('anti-whipsaw') || msg.includes('Cooldown') || msg.includes('Fee Drag')) {
        outcome = 'rejected';
        stageNum = '3';
        stage = '3. Risk & SL';
        const skipMatch = msg.match(/Entry skipped\s*-\s*([^.]+)/i);
        const skipCause = skipMatch ? skipMatch[1].trim() : '';
        title = skipCause ? `Entry Skipped: ${itemSymbol} — ${skipCause}` : `Entry Skipped: ${itemSymbol}`;
      } else if (msg.includes('disallowed by entry_side') || msg.includes('entry_side')) {
        outcome = 'rejected';
        stageNum = '2';
        stage = '2. Signals';
        title = `Direction Disallowed: ${itemSymbol}`;
      } else if (msg.includes('skipped: momentum') && msg.includes('below threshold')) {
        outcome = 'waiting';
        stageNum = '1';
        stage = '1. Discovery';
        title = `Velocity Below Threshold: ${itemSymbol}`;
        isRoutine = true;
      } else if (msg.includes('skipped: insufficient candles')) {
        outcome = 'waiting';
        stageNum = '1';
        stage = '1. Discovery';
        title = `Warming Candles: ${itemSymbol}`;
        isRoutine = true;
      } else if (log.level === 'error' || log.level === 'warn') {
        outcome = 'rejected';
        stageNum = '3';
        stage = '3. Risk & SL';
        title = `Risk / Engine Alert: ${itemSymbol}`;
      }

      const logTs = log.ts_ms || (log.timestamp ? new Date(log.timestamp).getTime() : (log.ts ? new Date(log.ts).getTime() : stableFallbackTs));

      list.push({
        id: logId,
        outcome,
        isRoutine,
        stageNum,
        stage,
        symbol: itemSymbol,
        title,
        reason: msg.replace(/\[(Scanner Diagnostic|Scanner|Decision|MomentumScannerService|Execution)\]\s*/g, ''),
        timestamp: logTs,
        details: log
      });
    });

    return list;
  }, [
    config?.strategy_label, config?.strategy_variants,
    stratName, strategyConfig.scan_interval, strategyTrades, logs,
    staticSymbols, stableFallbackTs
  ]);

  const strategyReasons = useMemo(() => {
    return [...liveStrategyReasons, ...closedAndLogReasons].sort((a, b) => b.timestamp - a.timestamp);
  }, [liveStrategyReasons, closedAndLogReasons]);

  const recentSkipItems = useMemo(() => {
    const cutoff = (lastAuthoritativeUpdateTs || stableFallbackTs || Date.now()) - 15 * 60 * 1000;
    const seen = new Set();
    const out = [];
    for (const r of strategyReasons) {
      if (
        r.outcome === 'rejected' &&
        !r.isRoutine &&
        r.symbol &&
        r.symbol !== 'STRATEGY' &&
        r.symbol !== '---' &&
        r.stageNum !== '6' &&
        r.timestamp >= cutoff
      ) {
        const cleaned = String(r.reason || r.title || '')
          .replace(new RegExp(`^${r.symbol}\\s*(?:\\([^)]*\\))?:?\\s*`, 'i'), '')
          .replace(/^(Candidate removed|Entry skipped)\s*[-:]\s*/i, '')
          .trim();
        const shortReason = cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : (cleaned || r.title);
        const dedupKey = `${r.symbol}:${shortReason}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          out.push({ id: r.id, symbol: r.symbol, shortReason, stageNum: r.stageNum, timestamp: r.timestamp });
          if (out.length >= 3) break;
        }
      }
    }
    return out;
  }, [strategyReasons, lastAuthoritativeUpdateTs, stableFallbackTs]);

  const recentSkipEvent = recentSkipItems[0] || null;

  const narrative = useMemo(() => buildStrategyNarrative({
    isStrategyPaused,
    effectiveGate,
    effectiveReason,
    gateUpdatedAt: stratGate.updatedAt,
    timeframeDebugItems,
    strategyActiveTrades,
    bestOpp,
    entryMet,
    firedCount,
    signalsCount,
    strategyConfig,
    isStaticWatchlist,
    staticSymbols,
    lastScanTs,
    streamAgeSec: '0.0',
    recentSkipEvent,
    formatTimeAgo,
    formatClockTime,
  }), [
    isStrategyPaused, effectiveGate, effectiveReason, stratGate.updatedAt,
    timeframeDebugItems, strategyActiveTrades, bestOpp, entryMet, firedCount,
    signalsCount, strategyConfig, isStaticWatchlist, staticSymbols, lastScanTs,
    recentSkipEvent, formatTimeAgo, formatClockTime
  ]);

  const reasonOutcomeCounts = useMemo(() => {
    const counts = { all: 0, allowed: 0, rejected: 0, waiting: 0, routineHidden: 0 };
    for (const r of strategyReasons) {
      if (hideRoutineMisses && r.isRoutine) {
        counts.routineHidden++;
        continue;
      }
      counts.all++;
      if (r.outcome === 'allowed') counts.allowed++;
      else if (r.outcome === 'rejected') counts.rejected++;
      else counts.waiting++;
    }
    return counts;
  }, [strategyReasons, hideRoutineMisses]);

  const availableReasonSymbols = useMemo(() => {
    const set = new Set();
    for (const r of strategyReasons) {
      if (r.symbol && r.symbol !== '---') set.add(r.symbol);
    }
    return Array.from(set).sort();
  }, [strategyReasons]);

  const filteredReasons = useMemo(() => {
    const q = reasonsSearch.trim().toLowerCase();
    return strategyReasons.filter(r => {
      if (hideRoutineMisses && r.isRoutine) return false;
      if (reasonsOutcome !== 'all' && r.outcome !== reasonsOutcome) return false;
      if (reasonsStage !== 'all' && r.stageNum !== reasonsStage) return false;
      if (reasonsSymbol !== 'all' && r.symbol !== reasonsSymbol) return false;
      if (q) {
        const hit =
          (r.symbol && r.symbol.toLowerCase().includes(q)) ||
          (r.title && r.title.toLowerCase().includes(q)) ||
          (r.reason && r.reason.toLowerCase().includes(q)) ||
          (r.stage && r.stage.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [strategyReasons, hideRoutineMisses, reasonsOutcome, reasonsStage, reasonsSymbol, reasonsSearch]);

  const groupedStories = useMemo(() => {
    if (reasonsViewMode !== 'story') return [];
    const map = new Map();
    for (const item of filteredReasons) {
      const key = item.symbol || 'STRATEGY';
      if (!map.has(key)) {
        map.set(key, {
          symbol: key,
          events: [],
          latestTs: item.timestamp,
          latestOutcome: item.outcome,
        });
      }
      const g = map.get(key);
      g.events.push(item);
      if (item.timestamp > g.latestTs) {
        g.latestTs = item.timestamp;
        g.latestOutcome = item.outcome;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latestTs - a.latestTs);
  }, [filteredReasons, reasonsViewMode]);

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
      const scanTf = strategyConfig.scan_interval || '1m';
      const timeframes = new Set([scanTf]);
      const enabled = [
        ...(strategyConfig.enabled_signals || []),
        ...(strategyConfig.exit_signals || []),
        ...(strategyConfig.trigger_candle_exit_enabled ? ['trigger_candle_exit'] : []),
      ];

      if (strategyConfig.sl_lookback_timeframe && strategyConfig.sl_lookback_timeframe !== 'default') {
        timeframes.add(strategyConfig.sl_lookback_timeframe);
      }

      for (const sig of enabled) {
        let baseSig = sig;
        const lastUnderscore = sig.lastIndexOf('_');
        if (lastUnderscore > 0) {
          const potentialBase = sig.substring(0, lastUnderscore);
          baseSig = potentialBase;
        }
        const rawTf = (strategyConfig.signal_timeframes || {})[sig] || (strategyConfig.signal_timeframes || {})[baseSig];
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

  // Live Watchlist & Static Candidate Chips (never shadowed by historical closed trade snapshots)
  const { liveCandidateChips, closedSnapshotChips } = useMemo(() => {
    const seenLive = new Set();
    const live = [];
    const nowCheck = lastAuthoritativeUpdateTs || stableFallbackTs || Date.now();
    const onScannerSet = new Set(proximityLeaderboard.map(o => o.symbol));

    const getCooldownBadge = (sym, oppLastUpdate) => {
      const block = activeStage3BlockBySymbol.get(sym);
      if (!block) return null;
      const active = nowCheck < block.expiresAt || block.logTs >= (oppLastUpdate || 0) - 15_000;
      if (!active) return null;
      const remSec = block.expiresAt > nowCheck ? Math.ceil((block.expiresAt - nowCheck) / 1000) : null;
      const isCooldown = /cooldown|anti-whipsaw/i.test(block.reason);
      return {
        label: isCooldown ? (remSec ? `Cooldown ${remSec}s` : 'Cooldown') : 'Stage 3 Block',
        reason: block.reason
      };
    };

    for (const t of strategyActiveTrades) {
      if (!seenLive.has(t.symbol)) {
        const inScanner = onScannerSet.has(t.symbol);
        seenLive.add(t.symbol);
        live.push({
          symbol: t.symbol,
          focusKey: inScanner ? t.symbol : `trade:${t.id}`,
          tag: 'In Pos',
          tone: 'text-green',
          title: `Open ${t.direction || 'LONG'} position (Exit Monitor)`
        });
      }
    }

    const maxStatic = showAllStaticSymbols ? staticSymbols.length : 8;
    for (const sym of staticSymbols.slice(0, maxStatic)) {
      if (!seenLive.has(sym)) {
        seenLive.add(sym);
        const info = staticSymbolStatuses[sym];
        const block = getCooldownBadge(sym, info?.opp?.lastUpdate);
        live.push({
          symbol: sym,
          focusKey: sym,
          tag: block ? `${block.label} · ${info?.label || 'Static'}` : (info?.label || 'Static'),
          tone: block ? 'text-amber' : (info?.state === 'TRIGGERED' ? 'text-green' : info?.state === 'EVALUATING' ? 'text-accent' : 'text-dim'),
          title: block?.reason || undefined
        });
      }
    }

    for (const opp of proximityLeaderboard.slice(0, 8)) {
      if (!seenLive.has(opp.symbol)) {
        seenLive.add(opp.symbol);
        const block = getCooldownBadge(opp.symbol, opp.lastUpdate);
        const proxTag = opp.signalResult?.allFired ? 'Fired' : `${opp.proximity ?? 0}%`;
        live.push({
          symbol: opp.symbol,
          focusKey: opp.symbol,
          tag: block ? `${block.label} · ${proxTag}` : proxTag,
          tone: block ? 'text-amber' : (opp.signalResult?.allFired ? 'text-green' : opp.proximity >= 80 ? 'text-accent' : 'text-dim'),
          title: block?.reason || undefined
        });
      }
    }

    const snapshots = [];
    for (const t of strategyTrades) {
      if (snapshots.length >= 4) break;
      if (!t.entry_signal_snapshot?.signalResult) continue;
      const isWin = Number(t.pnl || 0) >= 0;
      snapshots.push({
        symbol: t.symbol,
        focusKey: `trade:${t.id}`,
        tag: `${isWin ? 'Win' : 'Loss'} ${fmtUSD(t.pnl || 0)}`,
        tone: isWin ? 'text-green' : 'text-red',
        title: `Historical closed trade entry snapshot (${t.exit_reason || t.status || 'CLOSED'})`
      });
    }

    return { liveCandidateChips: live, closedSnapshotChips: snapshots };
  }, [
    strategyActiveTrades,
    strategyTrades,
    staticSymbols,
    showAllStaticSymbols,
    staticSymbolStatuses,
    proximityLeaderboard,
    activeStage3BlockBySymbol,
    lastAuthoritativeUpdateTs,
    stableFallbackTs
  ]);

  const riskPerTradePct = Number(strategyConfig.risk_pct_per_trade ?? 1.0);
  const riskPerTradeUsdt = (startingBal * riskPerTradePct) / 100;

  const displayedTimelineReasons = useMemo(() => {
    return filteredReasons.slice(0, visibleReasonsLimit);
  }, [filteredReasons, visibleReasonsLimit]);

  return (
    <div className={cn(
      "max-w-[1300px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-5 md:pt-5 lg:px-6 lg:pt-6 animate-in fade-in duration-300",
      healthEnabled ? "pb-48 sm:pb-48 md:pb-48 lg:pb-16" : "pb-36 sm:pb-36 md:pb-36 lg:pb-16"
    )}>
      <ViewHeader
        icon={Activity}
        title={s.strategy_label}
        subTitle={`${isVariant ? 'Variant' : 'Base'} · ${strategyConfig.scan_interval || '5m'} · ${(strategyConfig.entry_side || 'both').toUpperCase()}`}
        backAction={onBack}
        sticky={false}
        hideMetrics
        mobileOneRow
      >
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 justify-end flex-nowrap">
          <CopyButton value={s.strategyId} className="p-1.5 hidden sm:inline-flex" />

          {/* Unboxed live telemetry metadata (Desktop) */}
          <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-dim px-2 shrink-0">
            <StatusBadge status={s.sessionActive} />
            <span className="text-dim/40" aria-hidden="true">·</span>
            <LiveStreamAge lastUpdateTs={lastAuthoritativeUpdateTs} />
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-nowrap">
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
                    "px-2 sm:px-3 py-1.5 min-h-[38px] sm:min-h-[34px] rounded-xl border text-[11px] font-semibold flex items-center gap-1 sm:gap-1.5 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0 cursor-pointer whitespace-nowrap",
                    isPausing ? "cursor-wait opacity-60 text-dim bg-surface border-border" : (
                      isStrategyPaused
                        ? "bg-green/10 text-green border-green/25 hover:bg-green/20"
                        : "bg-amber/10 text-amber border-amber/25 hover:bg-amber/20"
                    )
                  )}
                  aria-label={isPausing ? (isStrategyPaused ? "Resuming strategy..." : "Pausing strategy...") : (isStrategyPaused ? "Resume strategy" : "Pause strategy")}
                >
                  {isPausing ? <Loader2 size={12} className="animate-spin text-accent shrink-0" /> : (isStrategyPaused ? <Play size={12} fill="currentColor" className="shrink-0" /> : <Pause size={12} fill="currentColor" className="shrink-0" />)}
                  <span>{isPausing ? (isStrategyPaused ? "Resuming..." : "Pausing...") : (isStrategyPaused ? "Resume" : "Pause")}</span>
                </button>
              </Tooltip>
            )}

            <Tooltip content={isVariant ? "Edit Strategy Variant Configuration" : "Edit Base Strategy Configuration"}>
              <button
                type="button"
                onClick={onEdit}
                className="px-2 sm:px-3 py-1.5 min-h-[38px] sm:min-h-[34px] bg-surface border border-border text-text/90 hover:text-accent hover:border-accent/40 rounded-xl text-[11px] font-semibold flex items-center gap-1 sm:gap-1.5 transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none shrink-0 cursor-pointer whitespace-nowrap"
                aria-label={isVariant ? "Edit strategy variant configuration" : "Edit base strategy configuration"}
              >
                <Edit3 size={12} className="shrink-0" />
                <span className="sm:hidden">Edit</span>
                <span className="hidden sm:inline">{isVariant ? 'Edit Variant' : 'Edit Config'}</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </ViewHeader>

      {/* Unboxed live telemetry metadata strip below header on mobile/small-tablet so Row 1 stays cleanly single-row */}
      <div className="flex md:hidden items-center justify-between gap-2 px-1 mb-2.5 text-[10.5px] font-mono text-dim min-w-0">
        <span className="truncate uppercase font-bold tracking-wider opacity-80 sm:hidden">
          {isVariant ? 'Variant' : 'Base'} · {strategyConfig.scan_interval || '5m'} · {(strategyConfig.entry_side || 'both').toUpperCase()}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 sm:ml-auto">
          <StatusBadge status={s.sessionActive} />
          <span className="text-dim/40" aria-hidden="true">·</span>
          <LiveStreamAge lastUpdateTs={lastAuthoritativeUpdateTs} compact />
        </div>
      </div>

      {/* Compact 4-Card KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-fr items-stretch gap-2 sm:gap-2.5 mb-2.5 sm:mb-3">
        <StatCard
          compact
          label="Active P&L"
          value={fmtUSD(s.activePnl)}
          color={pnlClass(s.activePnl)}
          subValue={`Session: ${fmtUSD(s.totalPnl)} · Realized: ${fmtUSD((s.totalPnl || 0) - (s.activePnl || 0))}`}
          syncing={showResumingFeedback || isSyncing}
          tooltipText="Unrealized P&L on active positions, total Session Return (realized + unrealized), and cumulative realized strategy P&L."
        />
        <StatCard
          compact
          label="Exposure & Slots"
          value={`${Number(s.totalRiskPct || 0).toFixed(1)}% / ${strategyConfig.max_total_risk_pct || 5}%`}
          color={s.totalRiskPct > (strategyConfig.max_total_risk_pct || 5) * 0.8 ? "text-amber" : "text-text"}
          subValue={`${activeTradeCount}/${strategyConfig.max_open_trades || 3} Open · $${riskPerTradeUsdt.toFixed(0)}/tr`}
          tooltipText="Total active risk exposure against portfolio cap, open trade slots, and configured risk per trade."
        />
        <StatCard
          compact
          label="Win Rate"
          value={`${stratPerformance.hitRate.toFixed(1)}%`}
          color={stratPerformance.hitRate >= stratPerformance.recommendedWr ? "text-green" : "text-amber"}
          subValue={`${stratPerformance.wins}W/${stratPerformance.losses}L · Target ≥${stratPerformance.recommendedWr}%`}
          tooltipText={`Strategy Win Rate (${stratPerformance.total} trades). Breakeven >= ${stratPerformance.breakevenWr}% at ${stratPerformance.targetRr}R, Recommended >= ${stratPerformance.recommendedWr}%.`}
        />
        <StatCard
          compact
          label="Profit Factor"
          value={stratPerformance.total > 0 ? stratPerformance.profitFactor.toFixed(2) : '---'}
          color={stratPerformance.profitFactor >= 1.5 ? "text-green" : stratPerformance.profitFactor >= 1.0 ? "text-amber" : "text-text"}
          subValue="Target ≥ 1.50"
          tooltipText="Profit Factor (Gross Wins / Gross Losses). Recommended: > 1.00 (Profitable), >= 1.50 (Solid), >= 2.00 (Excellent)."
        />
      </div>

      {/* Live Diagnostic Narrative Strip ("What, Why & When") */}
      <div
        role="status"
        className={cn(
          "mb-3 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl border text-left transition-colors",
          narrative.tone === 'danger' ? "bg-red/5 border-red/30" :
          narrative.tone === 'warning' ? "bg-amber/5 border-amber/30" :
          narrative.tone === 'positive' ? "bg-green/5 border-green/30" :
          "bg-surface/60 border-border/50"
        )}
      >
        <div className="flex items-start sm:items-center justify-between gap-2">
          <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
            {narrative.tone === 'danger' && <Ban size={14} className="text-red shrink-0 mt-0.5 sm:mt-0" />}
            {narrative.tone === 'warning' && <AlertTriangle size={14} className="text-amber shrink-0 mt-0.5 sm:mt-0" />}
            {narrative.tone === 'positive' && <CheckCircle2 size={14} className="text-green shrink-0 mt-0.5 sm:mt-0" />}
            {narrative.tone === 'neutral' && <Activity size={14} className="text-accent shrink-0 mt-0.5 sm:mt-0" />}
            <div className="text-xs leading-snug min-w-0">
              <span className="font-semibold text-text">{narrative.headline}</span>
              <span className="text-dim mx-1.5 hidden sm:inline" aria-hidden="true">—</span>
              <span className="text-dim hidden sm:inline">{narrative.detail}</span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-dim tabular-nums whitespace-nowrap shrink-0">
            {narrative.when}
          </span>
        </div>
        <p className="text-[11px] text-dim leading-snug mt-1 pl-[22px] sm:hidden">
          {narrative.detail}
        </p>
      </div>

      {/* Promoted Active Positions Section (Always visible when in position) */}
      {activeTradeCount > 0 && (
        <div className="mb-3 sm:mb-4 animate-in fade-in duration-300 text-left">
          <SectionLabel>Active Positions ({activeTradeCount})</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 auto-rows-fr items-stretch gap-2.5 sm:gap-3">
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

      {/* Segmented Navigation Tabs (Zero horizontal overflow even on 320px screens) */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-surface/50 border border-border/50 rounded-xl mb-3 sm:mb-4 text-left" role="tablist" aria-label="Strategy Navigation">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pipeline'}
          onClick={() => setActiveTab('pipeline')}
          className={cn(
            "min-h-[42px] sm:min-h-[38px] py-1.5 px-1.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1 sm:gap-2 transition-all cursor-pointer whitespace-nowrap min-w-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
            activeTab === 'pipeline'
              ? "bg-background text-text border border-border/60 shadow-xs"
              : "text-dim hover:text-text hover:bg-surface/40"
          )}
        >
          <ShieldCheck size={13} className={cn("shrink-0", activeTab === 'pipeline' ? "text-accent" : "text-dim")} />
          <span className="sm:hidden truncate">Rules</span>
          <span className="hidden sm:inline">Rules &amp; Diagnostics</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'decisions'}
          onClick={() => setActiveTab('decisions')}
          className={cn(
            "min-h-[42px] sm:min-h-[38px] py-1.5 px-1.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1 sm:gap-2 transition-all cursor-pointer whitespace-nowrap min-w-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
            activeTab === 'decisions'
              ? "bg-background text-text border border-border/60 shadow-xs"
              : "text-dim hover:text-text hover:bg-surface/40"
          )}
        >
          <FileText size={13} className={cn("shrink-0", activeTab === 'decisions' ? "text-accent" : "text-dim")} />
          <span className="sm:hidden truncate">Log</span>
          <span className="hidden sm:inline">Decision Log</span>
          <span className="text-[10px] sm:text-[11px] font-mono text-dim tabular-nums">({strategyReasons.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'performance'}
          onClick={() => setActiveTab('performance')}
          className={cn(
            "min-h-[42px] sm:min-h-[38px] py-1.5 px-1.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1 sm:gap-2 transition-all cursor-pointer whitespace-nowrap min-w-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
            activeTab === 'performance'
              ? "bg-background text-text border border-border/60 shadow-xs"
              : "text-dim hover:text-text hover:bg-surface/40"
          )}
        >
          <BarChart3 size={13} className={cn("shrink-0", activeTab === 'performance' ? "text-accent" : "text-dim")} />
          <span className="sm:hidden truncate">Perf</span>
          <span className="hidden sm:inline">Performance &amp; Charts</span>
          <span className="text-[10px] sm:text-[11px] font-mono text-dim tabular-nums">({stratPerformance.total})</span>
        </button>
      </div>

      {/* TAB 1: Rules & Diagnostics */}
      {activeTab === 'pipeline' && (
        <div className="space-y-3 sm:space-y-4 animate-in fade-in duration-200 text-left">
          {/* Single-elevation Diagnostic Surface */}
          <div className="border border-border/50 bg-surface/30 rounded-2xl overflow-hidden">

            {/* Row 1: Compact Candidate Switcher + Buffer Warmup Status */}
            <div className="px-3 py-2.5 sm:px-3.5 bg-surface/50 border-b border-border/30 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-dim whitespace-nowrap shrink-0">Inspect Candidate:</span>
                  {isStaticWatchlist && staticSymbols.length > 8 && (
                    <button
                      type="button"
                      onClick={() => setShowAllStaticSymbols(!showAllStaticSymbols)}
                      className="sm:hidden text-[11px] font-mono text-accent hover:underline cursor-pointer"
                    >
                      {showAllStaticSymbols ? 'Less' : `+${staticSymbols.length - 8} more`}
                    </button>
                  )}
                </div>
                {liveCandidateChips.length > 0 ? (
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar sm:flex-wrap pb-0.5 sm:pb-0">
                    {liveCandidateChips.map(c => {
                      const isSelected = selectedFocusSymbol
                        ? selectedFocusSymbol === c.focusKey
                        : bestOpp.symbol === c.symbol && !isClosedHistorySnapshot;
                      return (
                        <button
                          key={c.focusKey || c.symbol}
                          type="button"
                          title={c.title}
                          onClick={() => setSelectedFocusSymbol(c.focusKey || c.symbol)}
                          className={cn(
                            "min-h-[34px] sm:min-h-0 px-2.5 sm:px-2 py-1 rounded-lg sm:rounded-md text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 border shrink-0",
                            isSelected
                              ? "bg-accent/15 border-accent/50 text-accent font-semibold"
                              : "bg-background/40 border-border/40 text-text/80 hover:border-border hover:text-text"
                          )}
                        >
                          <span>{c.symbol.replace('USDT', '')}<span className="hidden sm:inline text-dim/70">USDT</span></span>
                          <span className={cn("text-[10px] tabular-nums", isSelected ? "text-accent" : c.tone)}>{c.tag}</span>
                        </button>
                      );
                    })}
                    {isStaticWatchlist && staticSymbols.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllStaticSymbols(!showAllStaticSymbols)}
                        className="hidden sm:inline-flex px-2 py-1 text-[11px] font-mono text-accent hover:underline cursor-pointer shrink-0"
                      >
                        {showAllStaticSymbols ? 'Less' : `+${staticSymbols.length - 8} more`}
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-xs font-mono text-dim">
                    {isStaticWatchlist ? `${staticSymbols.length} static targets · awaiting scan tick` : `Top ${strategyConfig.watchlist_size || 15} by ${strategyConfig.discovery_mode || 'volume'} · awaiting candidate`}
                  </span>
                )}
              </div>

              {/* Right: Warmup Summary & Sync */}
              <div className="flex items-center justify-between lg:justify-end gap-3 text-[11px] font-mono text-dim shrink-0 pt-1.5 lg:pt-0 border-t border-border/20 lg:border-t-0">
                <button
                  type="button"
                  onClick={() => setShowWarmupDebug(prev => !(prev === null ? anyWarming : prev))}
                  className={cn(
                    "min-h-[34px] sm:min-h-0 flex items-center gap-1.5 cursor-pointer hover:text-text transition-colors whitespace-nowrap",
                    anyWarming ? "text-amber font-semibold" : "text-dim"
                  )}
                  aria-expanded={isWarmupOpen}
                >
                  <Clock size={12} className={anyWarming ? "text-amber" : "text-accent"} />
                  <span>
                    Buffers: {timeframeDebugItems.filter(i => !i.isWarming).length}/{timeframeDebugItems.length} Ready
                  </span>
                  <ChevronDown size={12} className={cn("transition-transform duration-150", isWarmupOpen && "rotate-180")} />
                </button>
                <span className="text-border hidden lg:inline" aria-hidden="true">|</span>
                <button
                  type="button"
                  disabled={isBatchSyncing || bestOpp.symbol === '---'}
                  onClick={handleBatchSyncTimeframes}
                  className={cn(
                    "min-h-[34px] sm:min-h-0 text-accent hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap",
                    isBatchSyncing && "opacity-60 cursor-wait"
                  )}
                  aria-label="Batch sync all evaluation timeframes"
                >
                  <RefreshCw size={11} className={cn(isBatchSyncing && "animate-spin")} />
                  <span>{isBatchSyncing ? 'Syncing...' : 'Sync Klines'}</span>
                </button>
              </div>
            </div>

            {/* Secondary Row: Historical Trade Entry Snapshots (separate from Live Scanner Watchlist) + Recent Skip Summary */}
            {(closedSnapshotChips.length > 0 || recentSkipItems.length > 0) && (
              <div className="px-3 py-2 sm:px-3.5 bg-background/25 border-b border-border/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-mono">
                {closedSnapshotChips.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar sm:flex-wrap min-w-0">
                    <span className="text-dim/90 font-semibold whitespace-nowrap shrink-0">History Snapshots:</span>
                    {closedSnapshotChips.map(c => {
                      const isSelected = selectedFocusSymbol === c.focusKey;
                      return (
                        <button
                          key={c.focusKey}
                          type="button"
                          title={c.title}
                          onClick={() => setSelectedFocusSymbol(c.focusKey)}
                          className={cn(
                            "min-h-[30px] sm:min-h-0 px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 border shrink-0",
                            isSelected
                              ? "bg-accent/15 border-accent/50 text-accent font-semibold"
                              : "bg-surface/40 border-border/40 text-dim hover:text-text hover:border-border"
                          )}
                        >
                          <span>{c.symbol.replace('USDT', '')}</span>
                          <span className={cn("text-[10px] tabular-nums", isSelected ? "text-accent" : c.tone)}>{c.tag}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {recentSkipItems.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar sm:ml-auto shrink-0">
                    <span className="text-amber font-semibold whitespace-nowrap shrink-0 flex items-center gap-1">
                      <Ban size={11} className="shrink-0" />
                      Recent Skips:
                    </span>
                    {recentSkipItems.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setActiveTab('decisions');
                          setReasonsOutcome('rejected');
                          setReasonsSymbol(item.symbol);
                          setVisibleReasonsLimit(25);
                        }}
                        title={`${item.symbol}: ${item.shortReason} (click to open Decision Log)`}
                        className="min-h-[30px] sm:min-h-0 px-2 py-0.5 rounded-md border border-amber/30 bg-amber/5 text-amber/90 hover:bg-amber/15 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 shrink-0"
                      >
                        <span className="font-semibold">{item.symbol.replace('USDT', '')}</span>
                        <span className="text-[10px] text-dim max-w-[140px] truncate">{item.shortReason}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('decisions');
                        setReasonsOutcome('rejected');
                        setReasonsSymbol('all');
                        setVisibleReasonsLimit(25);
                      }}
                      className="text-[10px] text-accent hover:underline cursor-pointer whitespace-nowrap shrink-0 px-1"
                    >
                      All skips →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Expandable Warmup Strip (Auto-highlighted when warming, always collapsible by user) */}
            {isWarmupOpen && (
              <div className="px-3 py-2.5 sm:px-3.5 bg-background/40 border-b border-border/30 grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-2 sm:gap-3 font-mono text-[11px]">
                {timeframeDebugItems.map(item => {
                  const pct = item.isWarming && item.required > 0 && typeof item.candles === 'number'
                    ? Math.min(100, Math.round((item.candles / item.required) * 100))
                    : null;
                  const isSyncingThis = syncingTfMap[item.tf];
                  return (
                    <div key={item.key} className="flex items-center justify-between sm:justify-start gap-2 sm:pr-3 sm:border-r sm:border-border/30 sm:last:border-r-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-text font-medium truncate">{item.label}</span>
                        <span className="text-dim shrink-0">({item.tf})</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn("tabular-nums font-semibold", item.isWarming ? "text-amber" : "text-green")}>
                          {item.statusMsg}{pct !== null ? ` · ${pct}%` : ''}
                        </span>
                        <button
                          type="button"
                          disabled={isSyncingThis || bestOpp.symbol === '---'}
                          onClick={() => handleSyncTimeframe(item.tf, bestOpp.symbol)}
                          className="text-accent hover:underline cursor-pointer disabled:opacity-40 text-[11px] px-1.5 py-0.5"
                          aria-label={`Sync ${item.tf} candles for ${bestOpp.symbol}`}
                        >
                          {isSyncingThis ? 'Syncing' : 'Sync'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Row 2: Compact Interactive 6-Stage Lifecycle Stepper with GPU Progress Rail */}
            <div className="px-3 py-2.5 sm:px-3.5 bg-background/25 border-b border-border/30">
              <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[16px]">
                <div className="h-1 flex-1 bg-background/70 rounded-full overflow-hidden border border-border/25" aria-hidden="true">
                  <div
                    className={cn(
                      "h-full w-full origin-left transition-transform duration-500 ease-out will-change-transform rounded-full",
                      currentLifecycleStage.stageNumber >= 6 ? "bg-red" :
                      currentLifecycleStage.stageNumber >= 4 ? "bg-green" :
                      currentLifecycleStage.stageNumber === 3 ? "bg-amber" : "bg-accent"
                    )}
                    style={{ transform: `scaleX(${Math.max(0.08, currentLifecycleStage.stageNumber / 6)})` }}
                  />
                </div>
                {stageTransition && stageTransition.symbol === bestOpp.symbol && (
                  <span className="text-[10px] font-mono font-semibold text-green whitespace-nowrap shrink-0 animate-handoff-slide">
                    Stage {stageTransition.fromStage} → Stage {stageTransition.stageNumber} · {stageTransition.statusLabel}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {journeyMilestones.map(m => {
                  const isSelected = activeJourneyMilestone === m.num;
                  const isCurrent = currentLifecycleStage.stageNumber === m.num;
                  const isPassed = currentLifecycleStage.stageNumber > m.num;
                  const justArrived = stageTransition && stageTransition.symbol === bestOpp.symbol && stageTransition.stageNumber === m.num;
                  return (
                    <button
                      key={m.num}
                      type="button"
                      onClick={() => setActiveJourneyMilestone(isSelected ? null : m.num)}
                      aria-expanded={isSelected}
                      aria-label={`Milestone ${m.num}: ${m.title} (${m.status})`}
                      className={cn(
                        "px-2 py-1.5 sm:px-2.5 min-h-[44px] sm:min-h-[34px] rounded-lg border text-left transition-all cursor-pointer flex flex-col items-start justify-center sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-1.5 min-w-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                        isSelected
                          ? "bg-accent/15 border-accent text-accent"
                          : isCurrent
                          ? "bg-accent/10 border-accent/50 text-text"
                          : isPassed
                          ? "bg-green/5 border-green/25 text-green"
                          : "bg-surface/40 border-border/40 text-dim hover:text-text hover:border-border",
                        justArrived && "animate-event-arrive ring-1 ring-green/50"
                      )}
                    >
                      <span className="text-[11px] font-semibold truncate w-full sm:w-auto leading-tight">{m.num}. {m.short}</span>
                      <span className="text-[10px] font-mono tabular-nums opacity-85 truncate w-full sm:w-auto shrink-0 leading-tight">{m.status}</span>
                    </button>
                  );
                })}
              </div>

              {/* Inline Milestone Inspector Drawer */}
              {activeJourneyMilestone && (() => {
                const milestone = journeyMilestones.find(m => m.num === activeJourneyMilestone);
                if (!milestone) return null;
                return (
                  <div className="mt-2.5 pt-2.5 border-t border-border/30 flex flex-col gap-2 animate-in fade-in duration-150">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs leading-snug">
                        <span className="font-semibold text-text">{milestone.title}</span>
                        <span className="text-dim mx-1.5 hidden sm:inline" aria-hidden="true">·</span>
                        <span className="text-dim block sm:inline mt-0.5 sm:mt-0">{milestone.desc}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveJourneyMilestone(null)}
                        className="p-1.5 text-dim hover:text-text cursor-pointer rounded shrink-0"
                        aria-label="Close milestone inspection"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3 text-xs font-mono pt-1">
                      {milestone.criteria.map((crit, idx) => (
                        <div key={idx} className="min-w-0">
                          <div className="text-[10px] text-dim truncate">{crit.label}</div>
                          <div className="font-semibold text-text truncate" title={crit.value}>{crit.value}</div>
                        </div>
                      ))}
                    </div>
                    {milestone.protocolNote && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setShowComplianceNotes(!showComplianceNotes)}
                          className="text-[11px] text-dim hover:text-accent cursor-pointer flex items-center gap-1 py-1"
                        >
                          <span>{showComplianceNotes ? 'Hide Execution Protocol Note' : 'Show Execution Protocol Note'}</span>
                          <ChevronDown size={11} className={cn("transition-transform", showComplianceNotes && "rotate-180")} />
                        </button>
                        {showComplianceNotes && (
                          <p className="text-[11px] text-dim mt-1">{milestone.protocolNote}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Mobile-only Section Focus Bar (All / Entry / Exit / Risk) */}
            <div className="xl:hidden px-3 py-2 bg-surface/35 border-b border-border/30">
              <div className="grid grid-cols-4 gap-1 p-0.5 bg-background/60 border border-border/40 rounded-lg">
                {[
                  { id: 'all', label: 'All Rules' },
                  { id: 'entry', label: `Entry (${rulesDiagnostics.entryRules.length})` },
                  { id: 'exit', label: `Exit (${rulesDiagnostics.exitRules.length})` },
                  { id: 'risk', label: `Risk (${rulesDiagnostics.riskChecks.length})` },
                ].map(sec => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setRulesMobileSection(sec.id)}
                    className={cn(
                      "min-h-[34px] px-1 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer truncate",
                      rulesMobileSection === sec.id
                        ? "bg-surface text-text border border-border/60 shadow-xs"
                        : "text-dim hover:text-text"
                    )}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Live Capitalize.ai Entry/Exit & Anti-Whipsaw Target Meters */}
            <div className={cn(
              "px-3 py-2.5 sm:px-3.5 border-b border-border/30 bg-background/15",
              rulesMobileSection === 'risk' && "hidden xl:block"
            )}>
              <CandidateConditionsGauge
                opp={bestOpp}
                strategyConfig={diagnosticStrategyConfig}
                activeTrade={focusedTradeForGauge}
                closedTrades={tradeHistory}
                isPaused={isStrategyPaused}
                gateState={effectiveGate}
                gateReason={effectiveReason}
                lastScanTs={lastScanTs}
              />
            </div>

            {/* Unified Risk, Stop-Loss & Guard Meters (No duplicate Entry/Exit condition tables) */}
            <div className={cn(
              "p-3 sm:p-4 flex flex-col gap-2.5 min-w-0",
              (rulesMobileSection === 'entry' || rulesMobileSection === 'exit') && "hidden xl:flex"
            )}>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-border/30">
                <div className="flex items-center gap-2 text-xs font-mono min-w-0 flex-wrap">
                  <span className="font-bold uppercase tracking-wider text-text font-sans">Risk, SL &amp; Guard Limits</span>
                  <span className="text-dim/40" aria-hidden="true">·</span>
                  <span className="text-[11px] text-dim">{bestOpp.symbol !== '---' ? bestOpp.symbol : 'Portfolio'}</span>
                </div>
                {(() => {
                  const tpRule = rulesDiagnostics.exitRules.find(r => r.key === '_tp_ladder');
                  if (!tpRule) return null;
                  return (
                    <Tooltip content={tpRule.reasonText}>
                      <span className="text-[11px] font-mono text-dim cursor-help tabular-nums">
                        {tpRule.label}: <strong className="text-text">{tpRule.paramsText}</strong>
                      </span>
                    </Tooltip>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-2.5">
                {rulesDiagnostics.riskChecks.map(check => {
                  const hasAlert = check.status === 'rejected' || check.status === 'clamped' || check.status === 'warning';
                  let fillScale = null;
                  let barTone = 'bg-accent';
                  if (check.key === 'sl_bounds') {
                    const liveVal = parseFloat(check.liveText);
                    const maxSl = Math.max(0.1, Number(strategyConfig.sl_max_pct ?? 3.0));
                    if (Number.isFinite(liveVal)) {
                      fillScale = Math.max(0, Math.min(1, liveVal / maxSl));
                      barTone = check.status === 'rejected' ? 'bg-red' : check.status === 'clamped' ? 'bg-amber' : 'bg-green';
                    }
                  } else if (check.key === 'risk_cap') {
                    const maxCap = Math.max(0.1, Number(strategyConfig.max_total_risk_pct ?? 5.0));
                    fillScale = Math.max(0, Math.min(1, Number(s.totalRiskPct || 0) / maxCap));
                    barTone = check.status === 'rejected' ? 'bg-red' : check.status === 'warning' ? 'bg-amber' : 'bg-green';
                  } else if (check.key === 'concurrency_whipsaw') {
                    const maxOpen = Math.max(1, Number(strategyConfig.max_open_trades ?? 3));
                    fillScale = Math.max(0, Math.min(1, activeTradeCount / maxOpen));
                    barTone = check.status === 'rejected' ? 'bg-red' : 'bg-accent';
                  }

                  return (
                    <div key={check.key} className="py-1 flex flex-col gap-1 text-xs min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <Tooltip content={`${check.configuredText}${check.reasonText ? ` — ${check.reasonText}` : ''}`}>
                          <span className="font-semibold text-text truncate cursor-help">{check.label}</span>
                        </Tooltip>
                        <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                          <span className="text-[11px] font-semibold text-text">{check.liveText}</span>
                          <VerdictTag status={check.status} />
                        </div>
                      </div>

                      {fillScale !== null && (
                        <div className="h-1.5 w-full bg-background/80 rounded-full overflow-hidden border border-border/30">
                          <div
                            className={cn('h-full w-full origin-left transition-transform duration-200 will-change-transform rounded-full', barTone)}
                            style={{ transform: `scaleX(${fillScale})` }}
                          />
                        </div>
                      )}

                      <div className={cn(
                        "text-[11px] font-mono truncate leading-snug",
                        check.status === 'rejected' ? "text-red font-medium" :
                        (check.status === 'clamped' || check.status === 'warning') ? "text-amber" :
                        "text-dim/85"
                      )}>
                        {hasAlert ? check.reasonText : check.configuredText}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Collapsible Live Scanner Preview Bar */}
          <div className="bg-surface/30 border border-border/50 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowScannerPreview(!showScannerPreview)}
              className="w-full px-3 py-3 sm:px-4 min-h-[44px] flex items-center justify-between hover:bg-surface/50 transition-colors text-left cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none gap-2"
              aria-expanded={showScannerPreview}
            >
              <div className="flex items-center gap-2 text-xs font-mono min-w-0">
                <Zap size={14} className="text-accent shrink-0" />
                <span className="font-semibold text-text truncate">Live Scanner</span>
                <span className="text-dim shrink-0">· {strategyScannerResults.length} pairs</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-accent shrink-0">
                <span>{showScannerPreview ? 'Collapse' : 'Expand'}</span>
                <ChevronDown size={13} className={cn("transition-transform duration-150", showScannerPreview && "rotate-180")} />
              </div>
            </button>
            {showScannerPreview && (
              <div className="border-t border-border/30 animate-in fade-in duration-150">
                <ScannerPreview
                  embedded
                  scannerResults={strategyScannerResults}
                  config={strategyConfig}
                  onOpen={() => onOpenScanner(s.strategy_label)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Decision Log (Causal Filtering & Trade Story) */}
      {activeTab === 'decisions' && (
        <div className="space-y-2.5 sm:space-y-3 animate-in fade-in duration-200 text-left">
          {/* Faceted Filter Bar */}
          <div className="p-2.5 sm:p-3 bg-surface/40 border border-border/50 rounded-xl flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              {/* Outcome Segmented Filter */}
              <div className="grid grid-cols-4 sm:inline-flex items-center gap-0.5 sm:gap-1 p-0.5 bg-background/60 border border-border/40 rounded-lg w-full sm:w-auto">
                {[
                  { id: 'all', short: 'All', label: 'All', count: reasonOutcomeCounts.all },
                  { id: 'allowed', short: 'Allow', label: 'Allowed / Fired', count: reasonOutcomeCounts.allowed },
                  { id: 'rejected', short: 'Reject', label: 'Rejected / Blocked', count: reasonOutcomeCounts.rejected },
                  { id: 'waiting', short: 'Wait', label: 'Waiting / Miss', count: reasonOutcomeCounts.waiting },
                ].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setReasonsOutcome(tab.id);
                      setVisibleReasonsLimit(25);
                    }}
                    className={cn(
                      "min-h-[38px] sm:min-h-0 px-1.5 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 min-w-0",
                      reasonsOutcome === tab.id
                        ? "bg-surface text-text border border-border/60 shadow-xs"
                        : "text-dim hover:text-text"
                    )}
                  >
                    <span className="sm:hidden truncate">{tab.short}</span>
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="text-[10px] sm:text-[11px] font-mono text-dim tabular-nums">{tab.count}</span>
                  </button>
                ))}
              </div>

              {/* View Mode & Noise Filter */}
              <div className="flex items-center justify-between sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setHideRoutineMisses(!hideRoutineMisses)}
                  aria-pressed={hideRoutineMisses}
                  className={cn(
                    "min-h-[36px] sm:min-h-0 px-2.5 py-1 rounded-lg border text-[11px] sm:text-xs font-medium cursor-pointer transition-colors whitespace-nowrap",
                    hideRoutineMisses
                      ? "bg-accent/10 border-accent/40 text-accent"
                      : "bg-background/50 border-border/40 text-dim hover:text-text"
                  )}
                >
                  {hideRoutineMisses
                    ? `Misses Hidden (${reasonOutcomeCounts.routineHidden})`
                    : 'Show Misses'}
                </button>

                <div className="inline-flex items-center gap-0.5 p-0.5 bg-background/60 border border-border/40 rounded-lg shrink-0">
                  <button
                    type="button"
                    onClick={() => setReasonsViewMode('timeline')}
                    className={cn(
                      "min-h-[34px] sm:min-h-0 px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md cursor-pointer transition-colors",
                      reasonsViewMode === 'timeline' ? "bg-surface text-text shadow-xs" : "text-dim hover:text-text"
                    )}
                  >
                    Timeline
                  </button>
                  <button
                    type="button"
                    onClick={() => setReasonsViewMode('story')}
                    className={cn(
                      "min-h-[34px] sm:min-h-0 px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md cursor-pointer transition-colors",
                      reasonsViewMode === 'story' ? "bg-surface text-text shadow-xs" : "text-dim hover:text-text"
                    )}
                  >
                    By Symbol
                  </button>
                </div>
              </div>
            </div>

            {/* Secondary Facets: Stage, Symbol & Search */}
            <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center">
              <div className="col-span-1 sm:col-span-3">
                <select
                  aria-label="Filter by lifecycle stage"
                  value={reasonsStage}
                  onChange={(e) => {
                    setReasonsStage(e.target.value);
                    setVisibleReasonsLimit(25);
                  }}
                  className="w-full min-h-[38px] sm:min-h-0 px-2.5 py-1.5 bg-background/70 border border-border/50 rounded-lg text-xs font-mono text-text focus:outline-none focus:border-accent"
                >
                  <option value="all">All Stages</option>
                  <option value="1">1. Discovery</option>
                  <option value="2">2. Entry Signals</option>
                  <option value="3">3. Risk &amp; SL</option>
                  <option value="4">4. Execution</option>
                  <option value="5">5. Protection</option>
                  <option value="6">6. Exit</option>
                </select>
              </div>

              <div className="col-span-1 sm:col-span-3">
                <select
                  aria-label="Filter by symbol"
                  value={reasonsSymbol}
                  onChange={(e) => {
                    setReasonsSymbol(e.target.value);
                    setVisibleReasonsLimit(25);
                  }}
                  className="w-full min-h-[38px] sm:min-h-0 px-2.5 py-1.5 bg-background/70 border border-border/50 rounded-lg text-xs font-mono text-text focus:outline-none focus:border-accent"
                >
                  <option value="all">All Pairs ({availableReasonSymbols.length})</option>
                  {availableReasonSymbols.map(sym => (
                    <option key={sym} value={sym}>{sym}</option>
                  ))}
                </select>
              </div>

              <div className="col-span-2 sm:col-span-4 relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
                <input
                  type="text"
                  value={reasonsSearch}
                  onChange={(e) => setReasonsSearch(e.target.value)}
                  placeholder="Filter keyword (SL, MACD, ETH)..."
                  className="w-full min-h-[38px] sm:min-h-0 pl-8 pr-8 py-1.5 bg-background/70 border border-border/50 rounded-lg text-xs font-mono text-text placeholder:text-dim/60 focus:outline-none focus:border-accent"
                />
                {reasonsSearch && (
                  <button
                    type="button"
                    onClick={() => setReasonsSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-text cursor-pointer p-1"
                    aria-label="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="col-span-2 sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 text-[11px] font-mono text-dim px-0.5">
                <span className="tabular-nums">{filteredReasons.length} shown</span>
                {(reasonsOutcome !== 'all' || reasonsStage !== 'all' || reasonsSymbol !== 'all' || reasonsSearch) && (
                  <button
                    type="button"
                    onClick={() => {
                      setReasonsOutcome('all');
                      setReasonsStage('all');
                      setReasonsSymbol('all');
                      setReasonsSearch('');
                      setVisibleReasonsLimit(25);
                    }}
                    className="text-accent hover:underline cursor-pointer py-0.5"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Decision Results */}
          {filteredReasons.length === 0 ? (
            <div className="p-6 sm:p-8 text-center bg-surface/30 border border-border/40 rounded-xl">
              <FileText size={22} className="mx-auto text-dim/40 mb-2" />
              <div className="text-xs font-semibold text-text mb-1">No matching decision events</div>
              <p className="text-xs text-dim max-w-md mx-auto">
                Try toggling &ldquo;Show Misses&rdquo; or resetting the stage/pair filters.
              </p>
            </div>
          ) : reasonsViewMode === 'timeline' ? (
            <div className="border border-border/50 bg-surface/20 rounded-xl divide-y divide-border/25 sm:max-h-[540px] sm:overflow-y-auto">
              {displayedTimelineReasons.map(item => {
                const isCopied = copiedReasonId === item.id;
                const isExpanded = !!expandedReasonIds[item.id];
                return (
                  <div key={item.id} className="px-3 py-2.5 sm:px-3.5 hover:bg-surface/40 transition-colors group">
                    {/* Mobile-clean top row: Outcome + Symbol + Direction on left, Age + Copy on right */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0 font-mono truncate">
                        <VerdictTag status={item.outcome} />
                        {item.symbol && item.symbol !== '---' && (
                          <span className="font-semibold text-text truncate">{item.symbol}</span>
                        )}
                        {item.direction && (
                          <span className={cn("font-semibold shrink-0", item.direction === 'LONG' || item.direction === 'long' ? "text-green" : "text-red")}>
                            {item.direction.toUpperCase()}
                          </span>
                        )}
                        <span className="text-dim hidden sm:inline" aria-hidden="true">·</span>
                        <span className="text-dim hidden sm:inline shrink-0">{item.stage}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] text-dim">
                        <time dateTime={new Date(item.timestamp).toISOString()} title={new Date(item.timestamp).toLocaleString()} className="tabular-nums cursor-help">
                          <span className="hidden sm:inline">{formatClockTime(item.timestamp)} · </span><LiveRelativeTime ts={item.timestamp} nowMs={decisionLogNowMs} />
                        </time>
                        <button
                          type="button"
                          onClick={() => handleCopyReason(item)}
                          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1.5 sm:p-1 text-dim hover:text-text cursor-pointer"
                          title="Copy decision details"
                          aria-label="Copy decision details"
                        >
                          {isCopied ? <Check size={12} className="text-green" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    {/* Title + Stage on compact mobile row */}
                    <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-text leading-snug">{item.title}</span>
                      <span className="sm:hidden text-[10px] font-mono text-dim">{item.stage}</span>
                    </div>

                    <p className="text-xs text-text/80 leading-relaxed mt-0.5 break-words">
                      {item.reason}
                    </p>

                    {item.details && Object.keys(item.details).length > 0 && (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={() => toggleReasonDetails(item.id)}
                          className="text-[11px] font-mono text-dim hover:text-accent flex items-center gap-1 cursor-pointer py-0.5"
                        >
                          <span>{isExpanded ? 'Hide parameters' : 'Parameters & values'}</span>
                          <ChevronDown size={11} className={cn("transition-transform", isExpanded && "rotate-180")} />
                        </button>
                        {isExpanded && (
                          <div className="mt-1.5 pt-1.5 border-t border-border/20 grid grid-cols-1 xs:grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-dim">
                            {Object.entries(item.details).map(([k, v]) => {
                              const formatted = formatDiagnosticDetailEntry(k, v);
                              if (!formatted) return null;
                              return (
                                <span key={k} className="min-w-0 truncate">
                                  <span className="text-dim/80">{formatted.label}:</span>{' '}
                                  <strong className="text-text tabular-nums">{formatted.value}</strong>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredReasons.length > displayedTimelineReasons.length && (
                <div className="p-2.5 text-center bg-surface/30">
                  <button
                    type="button"
                    onClick={() => setVisibleReasonsLimit(prev => prev + 25)}
                    className="min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                  >
                    Show more ({filteredReasons.length - displayedTimelineReasons.length} remaining)
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Grouped By Symbol Story Mode */
            <div className="space-y-2.5 sm:space-y-3 sm:max-h-[540px] sm:overflow-y-auto sm:pr-0.5">
              {groupedStories.map(group => (
                <div key={group.symbol} className="border border-border/50 bg-surface/25 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 sm:px-3.5 bg-surface/50 border-b border-border/30 flex items-center justify-between gap-2 text-xs font-mono">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-text truncate">{group.symbol}</span>
                      <span className="text-dim shrink-0">· {group.events.length}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <VerdictTag status={group.latestOutcome} />
                      <span className="text-dim tabular-nums"><LiveRelativeTime ts={group.latestTs} nowMs={decisionLogNowMs} /></span>
                    </div>
                  </div>
                  <div className="divide-y divide-border/20">
                    {group.events.map(item => (
                      <div key={item.id} className="px-3 py-2 sm:px-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <div className="min-w-0">
                          <div className="flex items-center justify-between sm:justify-start gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <VerdictTag status={item.outcome} />
                              <span className="font-mono text-dim shrink-0">{item.stage}</span>
                            </div>
                            <time className="sm:hidden text-[10px] font-mono text-dim tabular-nums shrink-0">
                              {formatClockTime(item.timestamp)}
                            </time>
                          </div>
                          <div className="font-semibold text-text mt-0.5 leading-snug">{item.title}</div>
                          <p className="text-text/80 mt-0.5 leading-snug break-words">{item.reason}</p>
                        </div>
                        <time className="hidden sm:block text-[11px] font-mono text-dim tabular-nums shrink-0">
                          {formatClockTime(item.timestamp)}
                        </time>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Performance & Charts */}
      {activeTab === 'performance' && (
        <div className="space-y-3 sm:space-y-4 animate-in fade-in duration-200">
          {/* Quant Metrics Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-fr items-stretch gap-2 sm:gap-2.5">
            <StatCard
              compact
              label="Hit Rate Ratio"
              value={hitRateRatioText}
              color={stratPerformance.hitRateRatio >= 1.15 ? "text-green" : stratPerformance.hitRateRatio <= 0.85 ? "text-amber" : "text-text"}
              subValue={`Base: ${(typeof analytics?.overallWinRate === 'number' ? analytics.overallWinRate : 50).toFixed(0)}% · BE: ${stratPerformance.breakevenWr}%`}
              tooltipText="Hit rate ratio relative to overall performance baseline. Thresholds: >= 1.15 Expansion, <= 0.85 Contraction."
            />
            <StatCard
              compact
              label="Sharpe (Sh)"
              value={stratPerformance.total > 1 ? stratPerformance.sharpe.toFixed(2) : '---'}
              color={stratPerformance.sharpe >= 1.5 ? "text-green" : stratPerformance.sharpe >= 1.0 ? "text-amber" : stratPerformance.sharpe < 0 ? "text-red" : "text-text"}
              subValue="Target: >= 1.50"
              tooltipText="Sharpe Ratio (Risk-Adjusted Return). Recommended: >= 1.00 (Acceptable), >= 1.50 (Good), >= 2.00 (Excellent)."
            />
            <StatCard
              compact
              label="Sortino (So)"
              value={stratPerformance.total > 1 ? stratPerformance.sortino.toFixed(2) : '---'}
              color={stratPerformance.sortino >= 2.0 ? "text-green" : stratPerformance.sortino >= 1.0 ? "text-amber" : stratPerformance.sortino < 0 ? "text-red" : "text-text"}
              subValue="Target: >= 2.00"
              tooltipText="Sortino Ratio (Downside Risk-Adjusted Return). Recommended: >= 1.00 (Acceptable), >= 2.00 (Good), >= 3.00 (Excellent)."
            />
            <StatCard
              compact
              label="Closed Trades"
              value={`${stratPerformance.total}`}
              color="text-text"
              subValue={`${stratPerformance.wins}W · ${stratPerformance.losses}L`}
              tooltipText="Total closed historical executions attributed to this strategy."
            />
          </div>

          <div className="border border-border/50 bg-surface/30 rounded-2xl overflow-hidden flex flex-col gap-3 p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-border/20">
              <div className="flex items-center gap-2 text-left">
                <BarChart3 size={15} className="text-accent shrink-0" />
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-text">Strategy Performance Overlay</span>
                  <p className="text-[11px] text-dim">Cumulative PnL ($) and rolling Hit Rate (%)</p>
                </div>
              </div>

              <div className="grid grid-cols-5 sm:inline-flex items-center p-0.5 bg-surface/60 rounded-xl border border-border/40 text-dim gap-0.5 sm:gap-1 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setShowPnl(!showPnl)}
                  aria-pressed={showPnl}
                  className={cn(
                    "min-h-[36px] sm:min-h-0 px-1.5 sm:px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    showPnl ? "bg-background border border-border/60 text-green" : "text-dim hover:text-text"
                  )}
                >
                  PnL
                </button>
                <button
                  type="button"
                  onClick={() => setShowHitRate(!showHitRate)}
                  aria-pressed={showHitRate}
                  className={cn(
                    "min-h-[36px] sm:min-h-0 px-1.5 sm:px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    showHitRate ? "bg-background border border-border/60 text-accent" : "text-dim hover:text-text"
                  )}
                >
                  <span className="sm:hidden">WR%</span>
                  <span className="hidden sm:inline">Hit Rate</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPf(!showPf)}
                  aria-pressed={showPf}
                  className={cn(
                    "min-h-[36px] sm:min-h-0 px-1.5 sm:px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    showPf ? "bg-background border border-border/60 text-purple" : "text-dim hover:text-text"
                  )}
                >
                  PF
                </button>
                <button
                  type="button"
                  onClick={() => setShowSharpe(!showSharpe)}
                  aria-pressed={showSharpe}
                  className={cn(
                    "min-h-[36px] sm:min-h-0 px-1.5 sm:px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    showSharpe ? "bg-background border border-border/60 text-amber" : "text-dim hover:text-text"
                  )}
                >
                  Sh
                </button>
                <button
                  type="button"
                  onClick={() => setShowSortino(!showSortino)}
                  aria-pressed={showSortino}
                  className={cn(
                    "min-h-[36px] sm:min-h-0 px-1.5 sm:px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    showSortino ? "bg-background border border-border/60 text-cyan-400" : "text-dim hover:text-text"
                  )}
                >
                  So
                </button>
              </div>
            </div>

            {(showPnl || showHitRate || showPf || showSharpe || showSortino) ? (
              <Suspense fallback={
                <div className="h-[210px] w-full flex items-center justify-center bg-background/20 rounded-xl border border-border/30">
                  <Loader2 size={18} className="animate-spin text-accent" />
                </div>
              }>
                <LazyStrategyPerformanceOverlayChart
                  trades={strategyTrades}
                  height={220}
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
                <span className="text-xs font-medium text-dim">Chart layers hidden</span>
              </div>
            )}

            <div className="pt-2 border-t border-border/20">
              <button
                type="button"
                onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                aria-expanded={isCalendarOpen}
                aria-controls="calendar-content"
                className="w-full min-h-[42px] py-2 flex items-center justify-between text-left hover:bg-surface/50 transition-colors cursor-pointer rounded-xl px-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <div className="flex items-center gap-2">
                  <CalendarIcon size={13} className="text-accent" />
                  <span className="text-xs font-semibold text-text">Daily Calendar Breakdown</span>
                </div>
                <ChevronDown size={14} className={cn("text-dim transition-transform duration-150", isCalendarOpen && "rotate-180")} />
              </button>
              {isCalendarOpen && (
                <div id="calendar-content" className="pt-2 overflow-x-auto animate-in fade-in duration-150">
                  <Suspense fallback={
                    <div className="h-[120px] w-full flex items-center justify-center bg-background/20 rounded-xl border border-border/30">
                      <Loader2 size={16} className="animate-spin text-accent" />
                    </div>
                  }>
                    <LazyStrategyCalendarPnL trades={strategyTrades} strategyFilter="ALL" />
                  </Suspense>
                </div>
              )}
            </div>
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
