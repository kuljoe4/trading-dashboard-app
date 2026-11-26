import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { SmoothCollapse, MotionSegmentedPill, MOTION_EASE } from './ui/SmoothMotion'
import { fmtUSD, pnlClass } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { sessionAPI, presetsAPI } from '../api/client'
import { EquityCurve } from './Analytics'
import {
  SectionLabel, StatCard, cn, Tooltip, Btn, CandlestickChart
} from './ui/primitives'
import { SkeletonBlock, BacktestResultsSkeleton } from './ui/Skeletons'
import { formatStopLossDescriptor, formatTakeProfitDescriptor } from '../utils/strategySummary.js'
import {
  BarChart3, Play, RefreshCw, CheckCircle2, AlertCircle, Clock, Search,
  Sliders, ShieldCheck, Zap, Layers, Award, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, Check, X
} from 'lucide-react'

export const BacktestPanel = ({ onApplyConfig }) => {
  const { config, addAlert } = useTradingStore()

  // Strategy Selection State
  const [strategyType, setStrategyType] = useState('active') // 'active' | 'preset' | 'variant'
  const [presets, setPresets] = useState([])
  const [loadingPresets, setLoadingPresets] = useState(false)
  const [selectedPresetName, setSelectedPresetName] = useState('')
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0)

  // Resolve symbols from static watchlist + enabled solo single_symbol_configs
  const resolveStrategySymbols = useCallback((cfg) => {
    const out = []
    if (Array.isArray(cfg?.symbols)) {
      cfg.symbols.forEach(s => { if (s) out.push(String(s).trim().toUpperCase()) })
    }
    if (Array.isArray(cfg?.single_symbol_configs)) {
      cfg.single_symbol_configs.forEach(sc => {
        if (sc && sc.enabled !== false && sc.symbol) {
          out.push(String(sc.symbol).trim().toUpperCase())
        }
      })
    }
    const unique = Array.from(new Set(out.filter(s => s.endsWith('USDT'))))
    return unique.length > 0 ? unique : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']
  }, [])

  // Simulation Horizon Controls
  const [days, setDays] = useState(() => (config?.scan_interval === '1d' ? 180 : 14))
  const [startingBalance, setStartingBalance] = useState(10000)
  const [scanInterval, setScanInterval] = useState(config?.scan_interval || '5m')
  const [symbolsInput, setSymbolsInput] = useState(() => resolveStrategySymbols(config).join(', '))
  const [useGlobalScanner, setUseGlobalScanner] = useState(() => config?.global_scanner_enabled !== false)

  // Execution & Output State
  const [isExecuting, setIsExecuting] = useState(false)
  const [results, setResults] = useState(null)
  const [executionErr, setExecutionErr] = useState(null)
  const [tradeFilter, setTradeFilter] = useState('all') // 'all' | 'win' | 'loss'
  const [expandedSymbol, setExpandedSymbol] = useState(null)

  // Fetch presets on mount
  useEffect(() => {
    let isMounted = true
    setLoadingPresets(true)
    presetsAPI.list()
      .then(res => {
        if (!isMounted) return
        const list = Array.isArray(res.data) ? res.data : []
        setPresets(list)
        if (list.length > 0) {
          setSelectedPresetName(list[0].name)
        }
      })
      .catch(err => {
        console.warn('Failed to load strategy presets for backtest:', err)
      })
      .finally(() => {
        if (isMounted) setLoadingPresets(false)
      })
    return () => { isMounted = false }
  }, [])

  // Resolve currently active target SessionConfig for the backtest
  const targetStrategyConfig = useMemo(() => {
    if (!config) return {}
    if (strategyType === 'preset') {
      const p = presets.find(item => item.name === selectedPresetName)
      return p?.config || config
    }
    if (strategyType === 'variant') {
      const variants = config.strategy_variants || []
      const v = variants[selectedVariantIndex]
      if (v) {
        return { ...config, ...v }
      }
    }
    return config
  }, [config, strategyType, presets, selectedPresetName, selectedVariantIndex])

  // Sync interval, symbols, scanner gate, and sensible horizon when switching strategy source
  useEffect(() => {
    if (!targetStrategyConfig || Object.keys(targetStrategyConfig).length === 0) return
    const nextInterval = targetStrategyConfig.scan_interval || '5m'
    setScanInterval(nextInterval)
    setSymbolsInput(resolveStrategySymbols(targetStrategyConfig).join(', '))
    setUseGlobalScanner(targetStrategyConfig.global_scanner_enabled !== false)
    if (nextInterval === '1d' || nextInterval === '3d' || nextInterval === '1w') {
      setDays(prev => (prev < 180 ? 365 : prev))
    }
  }, [strategyType, selectedPresetName, selectedVariantIndex, targetStrategyConfig, resolveStrategySymbols])

  // Current Strategy Display Title & Meta
  const strategyTitle = useMemo(() => {
    if (strategyType === 'preset') {
      return selectedPresetName ? `Preset: ${selectedPresetName}` : 'Strategy Preset'
    }
    if (strategyType === 'variant') {
      const v = (config?.strategy_variants || [])[selectedVariantIndex]
      return v?.strategy_label ? `Variant: ${v.strategy_label}` : `Strategy Variant #${selectedVariantIndex + 1}`
    }
    return targetStrategyConfig.strategy_label || 'Active Session Strategy'
  }, [strategyType, selectedPresetName, selectedVariantIndex, targetStrategyConfig, config])

  // Parse symbols array from text input
  const parsedSymbols = useMemo(() => {
    if (!symbolsInput || !symbolsInput.trim()) {
      return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
    }
    return symbolsInput
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length >= 3 && s.endsWith('USDT'))
  }, [symbolsInput])

  // Active signal badges with resolved per-signal timeframes
  const signalBadges = useMemo(() => {
    const sigs = Array.isArray(targetStrategyConfig?.enabled_signals) ? targetStrategyConfig.enabled_signals : []
    const tfs = targetStrategyConfig?.signal_timeframes || {}
    return sigs.map(sig => {
      const base = sig.replace(/_\d+$/, '')
      const rawTf = tfs[sig] || tfs[base]
      const tf = (!rawTf || rawTf === 'default') ? scanInterval : rawTf
      return { sig, tf }
    })
  }, [targetStrategyConfig, scanInterval])

  // Execute Backtest
  const handleRunBacktest = useCallback(async () => {
    setIsExecuting(true)
    setExecutionErr(null)

    try {
      const effectiveConfig = {
        ...targetStrategyConfig,
        scan_interval: scanInterval
      }

      const payload = {
        config: effectiveConfig,
        scanInterval,
        symbols: parsedSymbols,
        days: Number(days) || 14,
        startingBalance: Number(startingBalance) || 10000,
        useGlobalScanner
      }

      if (strategyType === 'preset' && selectedPresetName) {
        payload.presetId = selectedPresetName
      } else if (strategyType === 'variant') {
        payload.variantIndex = selectedVariantIndex
      }

      const response = await sessionAPI.backtest(payload)
      const data = response.data
      setResults(data)

      addAlert({
        level: 'success',
        title: 'Backtest Complete',
        message: `Simulated ${data.totalTrades} trades over ${days} days in ${data.executionTimeMs}ms.`
      })
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Backtest execution failed'
      setExecutionErr(msg)
      addAlert({
        level: 'error',
        title: 'Backtest Failed',
        message: msg
      })
    } finally {
      setIsExecuting(false)
    }
  }, [targetStrategyConfig, scanInterval, parsedSymbols, days, startingBalance, useGlobalScanner, strategyType, selectedPresetName, selectedVariantIndex, addAlert])

  // State for search query and selected trade candlestick modal
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTradeForChart, setSelectedTradeForChart] = useState(null)

  // Format date helper
  const fmtDateTime = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const fmtDurationMs = (ms) => {
    if (!ms || ms <= 0) return '< 1m';
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const getTradeCandles = (trade) => {
    if (Array.isArray(trade.candles) && trade.candles.length >= 2) {
      return trade.candles;
    }
    const entryTs = Number(trade.entry_ts || (Date.now() - 3600000));
    const exitTs = Number(trade.exit_ts || Date.now());
    const entryPrice = Number(trade.entry_price || 100);
    const exitPrice = Number(trade.exit_price || 100);
    const slPrice = Number(trade.initial_sl || (trade.direction === 'LONG' ? entryPrice * 0.98 : entryPrice * 1.02));

    const count = 20;
    const stepMs = Math.max(1000, Math.floor((exitTs - entryTs) / (count - 1)));
    const result = [];

    for (let i = 0; i < count; i++) {
      const time = entryTs + (i * stepMs);
      const progress = i / (count - 1);
      const midPrice = entryPrice + (exitPrice - entryPrice) * progress;
      const noise = (Math.sin(i * 1.5) * 0.002) * entryPrice;
      const open = i === 0 ? entryPrice : result[i - 1].close;
      const close = i === count - 1 ? exitPrice : midPrice + noise;
      const high = Math.max(open, close) + Math.abs(noise) * 1.2;
      const low = Math.min(open, close, slPrice) - Math.abs(noise) * 0.5;
      result.push({ time, open, high, low, close });
    }
    return result;
  };

  // Filter closed trades
  const filteredTrades = useMemo(() => {
    if (!results || !Array.isArray(results.trades)) return []
    let list = results.trades;
    if (tradeFilter === 'win') list = list.filter(t => t.pnl > 0)
    else if (tradeFilter === 'loss') list = list.filter(t => t.pnl <= 0)

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(t =>
        t.symbol?.toLowerCase().includes(q) ||
        t.exit_reason?.toLowerCase().includes(q) ||
        t.direction?.toLowerCase().includes(q)
      );
    }
    return list
  }, [results, tradeFilter, searchQuery])

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1200px] mx-auto select-none">
      {/* Header & Strategy Selection Control Bar */}
      <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-xs flex flex-col gap-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/20 pb-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-accent" />
              <h2 className="text-lg font-bold text-text tracking-tight">Backtest Strategy Engine</h2>
            </div>
            <p className="text-xs text-dim font-medium">
              Run event-driven historical simulations with zero-allocation candle caching & multi-strategy resolution
            </p>
          </div>

          {/* Strategy Type Selector (Active / Preset / Variant) */}
          <div className="flex items-center gap-1 p-1 bg-background/50 border border-border/30 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => setStrategyType('active')}
              className={cn(
                "relative px-3 py-1.5 rounded-lg text-xs font-bold transition-colors duration-200 whitespace-nowrap cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                strategyType === 'active' ? "text-white" : "text-dim hover:text-text"
              )}
            >
              {strategyType === 'active' && (
                <MotionSegmentedPill layoutId="backtest-source-pill" className="rounded-lg bg-accent shadow-xs" />
              )}
              <span className="relative z-10">Active Strategy</span>
            </button>
            <button
              type="button"
              onClick={() => setStrategyType('preset')}
              className={cn(
                "relative px-3 py-1.5 rounded-lg text-xs font-bold transition-colors duration-200 whitespace-nowrap cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none flex items-center gap-1.5",
                strategyType === 'preset' ? "text-white" : "text-dim hover:text-text"
              )}
            >
              {strategyType === 'preset' && (
                <MotionSegmentedPill layoutId="backtest-source-pill" className="rounded-lg bg-accent shadow-xs" />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Layers size={13} />
                Saved Presets {presets.length > 0 && `(${presets.length})`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStrategyType('variant')}
              disabled={!config?.strategy_variants || config.strategy_variants.length === 0}
              className={cn(
                "relative px-3 py-1.5 rounded-lg text-xs font-bold transition-colors duration-200 whitespace-nowrap cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none flex items-center gap-1.5",
                strategyType === 'variant' ? "text-white" : "text-dim hover:text-text",
                (!config?.strategy_variants || config.strategy_variants.length === 0) && "opacity-40 cursor-not-allowed"
              )}
            >
              {strategyType === 'variant' && (
                <MotionSegmentedPill layoutId="backtest-source-pill" className="rounded-lg bg-accent shadow-xs" />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Sliders size={13} />
                Variants {config?.strategy_variants?.length ? `(${config.strategy_variants.length})` : ''}
              </span>
            </button>
          </div>
        </div>

        {/* Selected Strategy Details & Specific Pickers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          {strategyType === 'preset' && (
            <div className="flex flex-col gap-1.5 md:col-span-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Choose Strategy Preset</label>
              {loadingPresets ? (
                <SkeletonBlock className="h-[34px] w-full rounded-xl" />
              ) : presets.length === 0 ? (
                <div className="text-xs text-dim py-2">No saved presets found in database.</div>
              ) : (
                <select
                  value={selectedPresetName}
                  onChange={(e) => setSelectedPresetName(e.target.value)}
                  className="bg-background border border-border/50 rounded-xl px-3 py-2 text-xs font-semibold text-text focus:border-accent focus-visible:outline-none"
                >
                  {presets.map(p => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.config?.strategy_label || 'Preset'})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {strategyType === 'variant' && (
            <div className="flex flex-col gap-1.5 md:col-span-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Choose Custom Variant</label>
              <select
                value={selectedVariantIndex}
                onChange={(e) => setSelectedVariantIndex(Number(e.target.value))}
                className="bg-background border border-border/50 rounded-xl px-3 py-2 text-xs font-semibold text-text focus:border-accent focus-visible:outline-none"
              >
                {(config?.strategy_variants || []).map((v, idx) => (
                  <option key={idx} value={idx}>
                    Variant #{idx + 1}: {v.strategy_label || `Variant ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Strategy Summary Badge */}
          <div className={cn(
            "bg-background/40 border border-border/30 rounded-xl p-3 flex flex-col gap-1",
            strategyType === 'active' ? "md:col-span-3" : "md:col-span-2"
          )}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text truncate">{strategyTitle}</span>
              <span className="text-[10px] font-mono text-accent font-semibold uppercase">
                {targetStrategyConfig.entry_side || 'both'} side
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-dim font-mono flex-wrap">
              <span>Risk: <strong className="text-text">{targetStrategyConfig.risk_pct_per_trade || 1.0}%</strong></span>
              <span>·</span>
              <span>SL: <strong className="text-text">{formatStopLossDescriptor(targetStrategyConfig).fullText}</strong></span>
              <span>·</span>
              <span>TP: <strong className="text-text">{formatTakeProfitDescriptor(targetStrategyConfig).fullText}</strong></span>
              <span>·</span>
              <span>Interval: <strong className="text-text">{scanInterval}</strong></span>
              {signalBadges.length > 0 && (
                <>
                  <span>·</span>
                  <span>
                    Signals ({targetStrategyConfig.signal_logic || 'all'}):{' '}
                    <strong className="text-text">
                      {signalBadges.map(b => `${b.sig}@${b.tf}`).join(', ')}
                    </strong>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Backtest Simulation Parameters Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-border/20">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Duration</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-background border border-border/40 rounded-xl px-3 py-1.5 text-xs font-mono font-semibold text-text focus:border-accent focus-visible:outline-none"
            >
              <option value={1}>1 Day</option>
              <option value={7}>7 Days</option>
              <option value={14}>14 Days</option>
              <option value={30}>30 Days</option>
              <option value={60}>60 Days</option>
              <option value={90}>90 Days</option>
              <option value={180}>180 Days (6M)</option>
              <option value={365}>365 Days (1Y)</option>
              <option value={730}>730 Days (2Y)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Starting USDT</label>
            <input
              type="number"
              value={startingBalance}
              onChange={(e) => setStartingBalance(Number(e.target.value))}
              className="bg-background border border-border/40 rounded-xl px-3 py-1.5 text-xs font-mono font-semibold text-text focus:border-accent focus-visible:outline-none"
              min={10}
              max={10000000}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Scan Interval</label>
            <select
              value={scanInterval}
              onChange={(e) => {
                const next = e.target.value
                setScanInterval(next)
                if ((next === '1d' || next === '3d' || next === '1w') && days < 180) {
                  setDays(365)
                }
              }}
              className="bg-background border border-border/40 rounded-xl px-3 py-1.5 text-xs font-mono font-semibold text-text focus:border-accent focus-visible:outline-none"
            >
              <option value="1m">1 minute</option>
              <option value="3m">3 minutes</option>
              <option value="5m">5 minutes</option>
              <option value="15m">15 minutes</option>
              <option value="30m">30 minutes</option>
              <option value="1h">1 hour</option>
              <option value="2h">2 hours</option>
              <option value="4h">4 hours</option>
              <option value="6h">6 hours</option>
              <option value="8h">8 hours</option>
              <option value="12h">12 hours</option>
              <option value="1d">1 day</option>
              <option value="3d">3 days</option>
              <option value="1w">1 week</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 col-span-2 sm:col-span-2 lg:col-span-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Target Symbols (USDT)</label>
            <input
              type="text"
              value={symbolsInput}
              onChange={(e) => setSymbolsInput(e.target.value)}
              placeholder="BTCUSDT (solo) or BTCUSDT, ETHUSDT"
              className="bg-background border border-border/40 rounded-xl px-3 py-1.5 text-xs font-mono font-semibold text-text focus:border-accent focus-visible:outline-none"
            />
          </div>

          <div className="flex items-end col-span-2 sm:col-span-1 lg:col-span-1">
            <button
              type="button"
              onClick={handleRunBacktest}
              disabled={isExecuting}
              className={cn(
                "w-full h-[34px] rounded-xl text-xs font-bold uppercase tracking-wider transition-[background-color,transform,opacity] duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                isExecuting
                  ? "bg-accent/50 text-white cursor-wait"
                  : "bg-accent text-white hover:bg-accent-hover active:scale-[0.98]"
              )}
            >
              {isExecuting ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Simulating...
                </>
              ) : (
                <>
                  <Play size={14} fill="currentColor" />
                  Run Backtest
                </>
              )}
            </button>
          </div>
        </div>

        {/* Scanner Pre-Filter Toggle for Solo vs Momentum-Gated Backtests */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/15">
          <div className="flex items-center gap-2 text-[11px] text-dim">
            <span className="font-semibold text-text">Momentum Scanner Pre-Filter</span>
            <span className="hidden sm:inline">
              (Gate entries by {targetStrategyConfig.scan_pct_threshold ?? 2.0}% move over {targetStrategyConfig.scan_lookback || 3} bars; disable for pure solo-symbol signal testing)
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={useGlobalScanner}
            onClick={() => setUseGlobalScanner(v => !v)}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-[background-color,border-color,color] duration-200 cursor-pointer",
              useGlobalScanner
                ? "bg-accent/15 border-accent/40 text-accent"
                : "bg-background border-border/40 text-dim hover:text-text"
            )}
          >
            {useGlobalScanner ? 'Enabled' : 'Disabled (Direct Signals)'}
          </button>
        </div>
      </div>

      {/* Execution Error Banner */}
      {executionErr && (
        <div className="bg-red/10 border border-red/30 rounded-2xl p-4 flex items-center gap-3 text-red">
          <AlertCircle size={18} className="shrink-0" />
          <span className="text-xs font-semibold">{executionErr}</span>
        </div>
      )}

      {/* Results Workspace View */}
      {isExecuting ? (
        <BacktestResultsSkeleton />
      ) : results && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: MOTION_EASE.outExpo }}
          className="flex flex-col gap-6 [contain:layout_style]"
        >
          {/* KPI Cards Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 auto-rows-fr items-stretch gap-3">
            <StatCard
              label="Net P&L"
              value={`${fmtUSD(results.totalPnl)} (${results.pnlPct >= 0 ? '+' : ''}${results.pnlPct}%)`}
              color={pnlClass(results.totalPnl)}
              subValue={`Started ${fmtUSD(results.startingBalance)}`}
            />
            <StatCard
              label="Win Rate"
              value={`${results.winRate}%`}
              color={results.winRate >= 50 ? "text-green" : "text-amber"}
              subValue={`${results.wins}W / ${results.losses}L (${results.totalTrades} trades)`}
            />
            <StatCard
              label="Profit Factor"
              value={`${results.profitFactor} PF`}
              color={results.profitFactor >= 1.2 ? "text-green" : "text-red"}
              subValue={`Avg win ${fmtUSD(results.avgWin)} / loss ${fmtUSD(results.avgLoss)}`}
            />
            <StatCard
              label="Max Drawdown"
              value={`${fmtUSD(results.maxDrawdown)}`}
              color="text-red"
              subValue={`${results.maxDrawdownPct}% peak-to-trough`}
            />
            <StatCard
              label="Sharpe Ratio"
              value={`${results.sharpeRatio}`}
              color={results.sharpeRatio >= 1.0 ? "text-accent" : "text-dim"}
              subValue="Annualized Risk-Adj"
            />
            <StatCard
              label="Expectancy"
              value={`${fmtUSD(results.expectancy)}`}
              color={results.expectancy >= 0 ? "text-green" : "text-red"}
              subValue="Per-Trade Expectancy"
            />
            <StatCard
              label="Execution"
              value={`${results.executionTimeMs}ms`}
              color="text-text"
              subValue={`Fees: ${fmtUSD(-results.totalFees)}`}
            />
          </div>

          {/* Equity Curve & Drawdown Chart */}
          <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-xs flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-text uppercase tracking-wider">Equity Curve & Balance Trajectory</span>
                <span className="text-[10px] text-dim font-mono font-medium">
                  {results.equityCurve?.length || 0} sampled timeline intervals across {results.totalTrades} simulated trades
                </span>
              </div>

              {onApplyConfig && (
                <button
                  type="button"
                  onClick={() => onApplyConfig(targetStrategyConfig)}
                  className="px-3 py-1.5 bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 rounded-xl text-xs font-bold transition-[background-color,border-color,color] duration-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <Check size={14} />
                  Apply Strategy to Session
                </button>
              )}
            </div>

            <div className="h-[220px] w-full pt-2">
              <EquityCurve data={results.equityCurve?.map(p => ({ ts: p.timestamp, pnl: p.balance - results.startingBalance })) || []} height={220} />
            </div>
          </div>

          {/* Symbol Performance Breakdown */}
          {results.symbolPerformance && results.symbolPerformance.length > 0 && (
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-xs flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text uppercase tracking-wider">Per-Symbol Performance Breakdown</span>
                <span className="text-[10px] text-dim font-mono">
                  {results.symbolPerformance.filter(s => s.isRecommended).length} Recommended Pair(s)
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border/30 text-dim text-[10px] font-bold uppercase tracking-wider">
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-3 text-right">Trades</th>
                      <th className="py-2 px-3 text-right">Win Rate</th>
                      <th className="py-2 px-3 text-right">Total P&L</th>
                      <th className="py-2 px-3 text-right">Profit Factor</th>
                      <th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {results.symbolPerformance.map(sym => (
                      <tr key={sym.symbol} className="hover:bg-background/40 transition-colors">
                        <td className="py-2.5 px-3 font-bold text-text">{sym.symbol}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{sym.totalTrades}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{sym.winRate}%</td>
                        <td className={cn("py-2.5 px-3 text-right tabular-nums font-bold", pnlClass(sym.totalPnl))}>
                          {fmtUSD(sym.totalPnl)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{sym.profitFactor}</td>
                        <td className="py-2.5 px-3 text-center">
                          {sym.isRecommended ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-green/15 text-green border border-green/30">
                              <CheckCircle2 size={10} /> Recommended
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[9px] font-medium uppercase px-2 py-0.5 rounded-full bg-dim/10 text-dim">
                              Underperforming
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trade Log View & Candlestick Modal */}
          <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-xs flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-text uppercase tracking-wider">Simulated Trade Log & Execution History</span>
                <span className="text-[10px] font-mono text-dim">({filteredTrades.length} trades)</span>
              </div>

              {/* Search & Win / Loss Filter Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by symbol or reason..."
                    className="bg-background/60 border border-border/40 rounded-lg pl-7 pr-3 py-1 text-xs font-mono text-text placeholder:text-dim/50 focus:border-accent focus-visible:outline-none w-44"
                  />
                </div>

                <div className="flex items-center gap-1 p-0.5 bg-background/50 border border-border/30 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setTradeFilter('all')}
                    className={cn(
                      "relative px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-colors duration-200 cursor-pointer",
                      tradeFilter === 'all' ? "text-white" : "text-dim hover:text-text"
                    )}
                  >
                    {tradeFilter === 'all' && (
                      <MotionSegmentedPill layoutId="backtest-trade-filter" className="rounded bg-accent" />
                    )}
                    <span className="relative z-10">All ({results.trades?.length || 0})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradeFilter('win')}
                    className={cn(
                      "relative px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-colors duration-200 cursor-pointer",
                      tradeFilter === 'win' ? "text-white" : "text-dim hover:text-text"
                    )}
                  >
                    {tradeFilter === 'win' && (
                      <MotionSegmentedPill layoutId="backtest-trade-filter" className="rounded bg-green" />
                    )}
                    <span className="relative z-10">Wins ({results.wins ?? 0})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradeFilter('loss')}
                    className={cn(
                      "relative px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-colors duration-200 cursor-pointer",
                      tradeFilter === 'loss' ? "text-white" : "text-dim hover:text-text"
                    )}
                  >
                    {tradeFilter === 'loss' && (
                      <MotionSegmentedPill layoutId="backtest-trade-filter" className="rounded bg-red" />
                    )}
                    <span className="relative z-10">Losses ({results.losses ?? 0})</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Selected Trade Candlestick Chart View Overlay */}
            <SmoothCollapse isOpen={Boolean(selectedTradeForChart)} duration={0.26}>
              {selectedTradeForChart && (
                <div className="bg-background/90 border border-accent/30 rounded-2xl p-4 flex flex-col gap-3 shadow-md">
                  <div className="flex items-center justify-between border-b border-border/30 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-extrabold font-mono text-text">{selectedTradeForChart.symbol}</span>
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-black uppercase flex items-center gap-1",
                        selectedTradeForChart.direction === 'LONG' ? "bg-green/15 text-green border border-green/30" : "bg-red/15 text-red border border-red/30"
                      )}>
                        {selectedTradeForChart.direction === 'LONG' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        {selectedTradeForChart.direction}
                      </span>
                      <span className={cn("text-xs font-mono font-bold", pnlClass(selectedTradeForChart.pnl))}>
                        {fmtUSD(selectedTradeForChart.pnl)} ({selectedTradeForChart.pnl_pct >= 0 ? '+' : ''}{selectedTradeForChart.pnl_pct}%)
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedTradeForChart(null)}
                      className="p-1 hover:bg-surface rounded-lg text-dim hover:text-text transition-colors cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Trade Execution Metadata Line */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-surface/50 p-2.5 rounded-xl border border-border/20">
                    <div>
                      <span className="text-[9px] text-dim font-bold uppercase block">Entry Time</span>
                      <span className="font-semibold text-text">{fmtDateTime(selectedTradeForChart.entry_ts)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-dim font-bold uppercase block">Exit Time</span>
                      <span className="font-semibold text-text">{fmtDateTime(selectedTradeForChart.exit_ts)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-dim font-bold uppercase block">Holding Duration</span>
                      <span className="font-semibold text-accent">{fmtDurationMs(selectedTradeForChart.holding_duration_ms)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-dim font-bold uppercase block">Exit Reason</span>
                      <span className="font-semibold text-text truncate block">{selectedTradeForChart.exit_reason}</span>
                    </div>
                  </div>

                  {/* Interactive Candlestick Chart Plotting */}
                  <div className="flex flex-col gap-1.5 pt-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-dim px-1">
                      <span>Candlestick OHLC Execution Plot (Entry: ${selectedTradeForChart.entry_price} · Exit: ${selectedTradeForChart.exit_price})</span>
                      <span className="text-accent font-semibold">R:R Achieved: {selectedTradeForChart.rr > 0 ? `+${selectedTradeForChart.rr}R` : `${selectedTradeForChart.rr}R`}</span>
                    </div>

                    <div className="h-[200px] w-full bg-background border border-border/30 rounded-xl p-2 relative">
                      <CandlestickChart
                        data={getTradeCandles(selectedTradeForChart)}
                        height={180}
                        entryPrice={selectedTradeForChart.entry_price}
                        slPrice={selectedTradeForChart.initial_sl}
                        isLong={selectedTradeForChart.direction === 'LONG'}
                        decisionMarkers={[
                          {
                            time: selectedTradeForChart.entry_ts,
                            price: selectedTradeForChart.entry_price,
                            type: selectedTradeForChart.direction === 'LONG' ? 'BUY' : 'SELL',
                            label: `Entry $${selectedTradeForChart.entry_price}`
                          },
                          {
                            time: selectedTradeForChart.exit_ts,
                            price: selectedTradeForChart.exit_price,
                            type: selectedTradeForChart.pnl >= 0 ? 'TP' : 'SL',
                            label: `Exit $${selectedTradeForChart.exit_price}`
                          }
                        ]}
                      />
                    </div>
                  </div>
                </div>
              )}
            </SmoothCollapse>

            {filteredTrades.length === 0 ? (
              <div className="text-center py-8 text-xs text-dim font-medium">
                No trades match the selected filter or search query.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="sticky top-0 bg-surface border-b border-border/40 text-dim text-[10px] font-bold uppercase tracking-wider z-10">
                    <tr>
                      <th className="py-2.5 px-3">Symbol</th>
                      <th className="py-2.5 px-3">Direction</th>
                      <th className="py-2.5 px-3">Entry Time</th>
                      <th className="py-2.5 px-3 text-right">Entry Fill</th>
                      <th className="py-2.5 px-3">Exit Time</th>
                      <th className="py-2.5 px-3 text-right">Exit Fill</th>
                      <th className="py-2.5 px-3 text-right">Duration</th>
                      <th className="py-2.5 px-3 text-right">P&L ($)</th>
                      <th className="py-2.5 px-3 text-right">P&L (%)</th>
                      <th className="py-2.5 px-3 text-right">R:R</th>
                      <th className="py-2.5 px-3">Exit Reason</th>
                      <th className="py-2.5 px-3 text-center">Chart</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {filteredTrades.map(trade => {
                      const isSelected = selectedTradeForChart?.id === trade.id;
                      return (
                        <tr
                          key={trade.id}
                          className={cn(
                            "hover:bg-background/50 transition-colors cursor-pointer group",
                            isSelected && "bg-accent/10 border-l-2 border-l-accent"
                          )}
                          onClick={() => setSelectedTradeForChart(trade)}
                        >
                          <td className="py-2.5 px-3 font-bold text-text group-hover:text-accent transition-colors">
                            {trade.symbol}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase flex items-center gap-0.5 w-fit",
                              trade.direction === 'LONG' ? "bg-green/15 text-green" : "bg-red/15 text-red"
                            )}>
                              {trade.direction === 'LONG' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                              {trade.direction}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-dim text-[10px] whitespace-nowrap">
                            {fmtDateTime(trade.entry_ts)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">${trade.entry_price}</td>
                          <td className="py-2.5 px-3 text-dim text-[10px] whitespace-nowrap">
                            {fmtDateTime(trade.exit_ts)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">${trade.exit_price}</td>
                          <td className="py-2.5 px-3 text-right text-dim text-[10px] whitespace-nowrap">
                            {fmtDurationMs(trade.holding_duration_ms || (trade.exit_ts && trade.entry_ts ? trade.exit_ts - trade.entry_ts : 0))}
                          </td>
                          <td className={cn("py-2.5 px-3 text-right tabular-nums font-bold", pnlClass(trade.pnl))}>
                            {fmtUSD(trade.pnl)}
                          </td>
                          <td className={cn("py-2.5 px-3 text-right tabular-nums font-bold", pnlClass(trade.pnl_pct))}>
                            {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct}%
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-accent">
                            {trade.rr > 0 ? `+${trade.rr}R` : `${trade.rr}R`}
                          </td>
                          <td className="py-2.5 px-3 text-dim truncate max-w-[150px]" title={trade.exit_reason}>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-medium uppercase truncate block",
                              trade.exit_reason?.includes('SL') ? "bg-red/10 text-red" :
                              trade.exit_reason?.includes('TP') ? "bg-green/10 text-green" :
                              "bg-dim/10 text-dim"
                            )}>
                              {trade.exit_reason?.replace(/_/g, ' ') || 'Closed'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTradeForChart(isSelected ? null : trade);
                              }}
                              className={cn(
                                "p-1.5 rounded-lg border transition-[background-color,border-color,color] duration-200 cursor-pointer inline-flex items-center justify-center",
                                isSelected ? "bg-accent text-white border-accent" : "bg-background border-border/40 text-dim hover:text-accent hover:border-accent/40"
                              )}
                              title="Plot Candlestick Chart"
                            >
                              <BarChart3 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  )
}
