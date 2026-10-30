import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Eye, Shield, RefreshCw, Lock, Unlock, Plus, X, Sparkles, ChevronDown, ChevronUp, Clock, AlertCircle, Layers, Target, ArrowRightLeft } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { cn, Tooltip } from './ui/primitives'

const LIMIT_PRESETS = [
  { label: '1 (Solo)', value: 1 },
  { label: '2 Pairs', value: 2 },
  { label: '3 Pairs', value: 3 },
  { label: '5 Pairs', value: 5 },
  { label: '10 Pairs', value: 10 },
  { label: 'Unlimited', value: 0 },
];

const INTERVAL_PRESETS = [
  { label: '5m', value: 5 },
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
  { label: '1d', value: 1440 },
];

const POPULAR_MARKET_PAIRS = [
  { symbol: 'BTCUSDT', price: 65420.0, pct: 1.8, score: 85 },
  { symbol: 'ETHUSDT', price: 3480.0, pct: 2.4, score: 88 },
  { symbol: 'SOLUSDT', price: 152.4, pct: 3.5, score: 92 },
  { symbol: 'BNBUSDT', price: 588.5, pct: 0.9, score: 78 },
  { symbol: 'DOGEUSDT', price: 0.128, pct: -1.2, score: 65 },
  { symbol: 'ADAUSDT', price: 0.385, pct: 0.5, score: 70 },
  { symbol: 'XRPUSDT', price: 0.584, pct: -0.8, score: 68 },
  { symbol: 'AVAXUSDT', price: 28.9, pct: 4.1, score: 89 },
  { symbol: 'LINKUSDT', price: 13.2, pct: 1.2, score: 74 },
  { symbol: 'NEARUSDT', price: 5.12, pct: 2.8, score: 81 },
  { symbol: 'SUIUSDT', price: 1.85, pct: 5.2, score: 94 },
  { symbol: 'PEPEUSDT', price: 0.0000092, pct: 6.8, score: 91 },
  { symbol: 'SHIBUSDT', price: 0.000018, pct: 1.1, score: 72 },
  { symbol: 'LITUSDT', price: 2.84, pct: 2.4, score: 86 },
  { symbol: 'APTUSDT', price: 8.45, pct: 3.1, score: 83 },
  { symbol: 'FETUSDT', price: 1.42, pct: 4.8, score: 90 },
  { symbol: 'RENDERUSDT', price: 5.65, pct: 2.1, score: 79 },
  { symbol: 'INJUSDT', price: 21.30, pct: -1.5, score: 66 },
  { symbol: 'ARBUSDT', price: 0.54, pct: 0.8, score: 71 },
  { symbol: 'OPUSDT', price: 1.55, pct: 1.9, score: 76 },
  { symbol: 'TIAUSDT', price: 5.10, pct: -2.3, score: 62 },
  { symbol: 'WIFUSDT', price: 2.35, pct: 7.4, score: 95 },
];

export const WatchlistManager = React.memo(({
  className,
  compact = false,
  activeStrategyLabel,
  onSelectStrategy
}) => {
  const config = useTradingStore(state => state.config || {});
  const scannerResults = useTradingStore(state => state.scannerResults || []);
  const activeTrades = useTradingStore(state => state.activeTrades || []);
  const patchConfig = useTradingStore(state => state.patchConfig);
  const addToWatchlist = useTradingStore(state => state.addToWatchlist);
  const removeFromWatchlist = useTradingStore(state => state.removeFromWatchlist);
  const setWatchlistLimit = useTradingStore(state => state.setWatchlistLimit);
  const setWatchlistScheduler = useTradingStore(state => state.setWatchlistScheduler);
  const rotateWatchlistNow = useTradingStore(state => state.rotateWatchlistNow);
  const addAlert = useTradingStore(state => state.addAlert);

  const [internalActiveTab, setInternalActiveTab] = useState('base'); // 'base' or variant strategy_label
  const [search, setSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);

  const variants = useMemo(() => {
    return Array.isArray(config.strategy_variants) ? config.strategy_variants : [];
  }, [config.strategy_variants]);

  // Single source of truth: sync with activeStrategyLabel if provided from parent (ScannerOverlay)
  const activeTab = useMemo(() => {
    if (activeStrategyLabel !== undefined) {
      if (!activeStrategyLabel || activeStrategyLabel === (config.strategy_label || 'Momentum')) {
        return 'base';
      }
      return activeStrategyLabel;
    }
    return internalActiveTab;
  }, [activeStrategyLabel, config.strategy_label, internalActiveTab]);

  const handleSelectTab = (tab) => {
    setInternalActiveTab(tab);
    if (onSelectStrategy) {
      const targetLabel = tab === 'base' ? (config.strategy_label || 'Momentum') : tab;
      onSelectStrategy(targetLabel);
    }
  };

  // Determine current active target strategy config
  const activeVariantIdx = useMemo(() => {
    if (activeTab === 'base') return -1;
    return variants.findIndex(v => v.strategy_label === activeTab);
  }, [variants, activeTab]);

  const activeStrategyConfig = useMemo(() => {
    if (activeVariantIdx >= 0 && variants[activeVariantIdx]) {
      return variants[activeVariantIdx];
    }
    return config;
  }, [config, variants, activeVariantIdx]);

  const symbols = useMemo(() => {
    return Array.isArray(activeStrategyConfig.symbols) ? activeStrategyConfig.symbols : [];
  }, [activeStrategyConfig.symbols]);

  const maxLimit = Number(activeStrategyConfig.watchlist_max_symbols ?? config.watchlist_max_symbols) || 0;
  const isAutoRotate = !!(activeStrategyConfig.watchlist_auto_rotate ?? config.watchlist_auto_rotate);
  const isLocked = !!(activeStrategyConfig.watchlist_locked ?? config.watchlist_locked);
  const intervalMin = Number(activeStrategyConfig.watchlist_rotate_interval_min ?? config.watchlist_rotate_interval_min) || 15;

  const activeTradeSymbols = useMemo(() => {
    return new Set(activeTrades.map(t => t.symbol));
  }, [activeTrades]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Consolidate live opportunities and market candidate pool
  const availableCandidates = useMemo(() => {
    const q = search.trim().toUpperCase();
    const currentSet = new Set(symbols);

    const candidatesMap = new Map();

    // 1. Add popular market pairs as baseline pool
    POPULAR_MARKET_PAIRS.forEach(p => {
      candidatesMap.set(p.symbol, { ...p });
    });

    // 2. Overlay live scanner opportunities if available
    (scannerResults || []).forEach(opp => {
      if (opp && opp.symbol) {
        const existing = candidatesMap.get(opp.symbol) || {};
        candidatesMap.set(opp.symbol, {
          ...existing,
          symbol: opp.symbol,
          price: opp.price ?? existing.price,
          pct: opp.pct ?? opp.momentum ?? existing.pct ?? 0,
          score: opp.score ?? existing.score ?? 70,
        });
      }
    });

    return Array.from(candidatesMap.values())
      .filter(item => {
        if (!item || !item.symbol) return false;
        if (currentSet.has(item.symbol)) return false;
        if (!q) return true;
        return item.symbol.includes(q);
      })
      .slice(0, 10);
  }, [scannerResults, symbols, search]);

  // Target-aware Watchlist Update Handler (Supports Strategy Variant Isolation)
  const handleUpdateTargetSymbols = async (nextSymbols) => {
    if (activeVariantIdx >= 0) {
      const updatedVariants = [...variants];
      updatedVariants[activeVariantIdx] = {
        ...updatedVariants[activeVariantIdx],
        symbols: nextSymbols,
      };
      await patchConfig({ strategy_variants: updatedVariants });
    } else {
      await patchConfig({ symbols: nextSymbols });
    }
  };

  const handleAddSymbol = async (targetSymbol) => {
    const sym = String(targetSymbol || '').trim().toUpperCase();
    if (!sym) return;
    const cleanSym = sym.endsWith('USDT') ? sym : `${sym}USDT`;

    const currentSymbols = [...symbols];
    if (currentSymbols.includes(cleanSym)) {
      setSearch('');
      setIsDropdownOpen(false);
      return;
    }

    let nextSymbols = [...currentSymbols];
    let replacedSymbol = null;

    if (maxLimit > 0 && nextSymbols.length >= maxLimit) {
      // Find a symbol that is NOT in an active position to replace
      const replaceableIndex = nextSymbols.findIndex(s => !activeTradeSymbols.has(s));
      if (replaceableIndex !== -1) {
        replacedSymbol = nextSymbols[replaceableIndex];
        nextSymbols.splice(replaceableIndex, 1, cleanSym);
      } else {
        // Fallback: replace first
        replacedSymbol = nextSymbols[0];
        nextSymbols = [cleanSym];
      }
    } else {
      nextSymbols.push(cleanSym);
    }

    await handleUpdateTargetSymbols(nextSymbols);

    addAlert({
      level: 'success',
      title: 'Watchlist Updated',
      message: replacedSymbol
        ? `Replaced ${replacedSymbol} with ${cleanSym}${maxLimit === 1 ? ' (Single-Symbol Mode)' : ''}.`
        : `Added ${cleanSym} to ${activeVariantIdx >= 0 ? activeTab : 'Static Watchlist'}.`
    });

    setSearch('');
    setIsDropdownOpen(false);
  };

  const handleRemoveSymbol = async (sym) => {
    const nextSymbols = symbols.filter(s => s !== sym);
    await handleUpdateTargetSymbols(nextSymbols);
    addAlert({
      level: 'info',
      title: 'Symbol Removed',
      message: `Removed ${sym} from ${activeVariantIdx >= 0 ? activeTab : 'Static Watchlist'}.`
    });
  };

  const handleSetTargetLimit = async (limitVal) => {
    const limit = Math.max(0, parseInt(limitVal, 10) || 0);
    let nextSymbols = [...symbols];

    if (limit > 0 && symbols.length > limit) {
      const inPos = symbols.filter(s => activeTradeSymbols.has(s));
      const notInPos = symbols.filter(s => !activeTradeSymbols.has(s));
      nextSymbols = [...inPos, ...notInPos].slice(0, limit);
    }

    if (activeVariantIdx >= 0) {
      const updatedVariants = [...variants];
      updatedVariants[activeVariantIdx] = {
        ...updatedVariants[activeVariantIdx],
        watchlist_max_symbols: limit,
        symbols: nextSymbols,
      };
      await patchConfig({ strategy_variants: updatedVariants });
    } else {
      await setWatchlistLimit(limit);
    }
  };

  const handleApplyPresetTemplate = async (preset) => {
    let targetSymbols = [...symbols];
    if (preset.maxLimit > 0 && targetSymbols.length > preset.maxLimit) {
      const inPos = targetSymbols.filter(s => activeTradeSymbols.has(s));
      const notInPos = targetSymbols.filter(s => !activeTradeSymbols.has(s));
      targetSymbols = [...inPos, ...notInPos].slice(0, preset.maxLimit);
    }
    const updatePayload = {
      watchlist_max_symbols: preset.maxLimit,
      watchlist_auto_rotate: preset.autoRotate,
      watchlist_rotate_interval_min: preset.intervalMin,
      watchlist_locked: preset.locked,
      symbols: targetSymbols,
    };

    if (activeVariantIdx >= 0) {
      const updatedVariants = [...variants];
      updatedVariants[activeVariantIdx] = {
        ...updatedVariants[activeVariantIdx],
        ...updatePayload,
      };
      await patchConfig({ strategy_variants: updatedVariants });
    } else {
      await patchConfig(updatePayload);
    }

    addAlert({
      level: 'success',
      title: `${preset.title} Applied`,
      message: `${preset.title} configured for ${activeVariantIdx >= 0 ? activeTab : (config.strategy_label || 'Base Strategy')}. ${preset.desc}`,
    });
  };

  const handleSetTargetScheduler = async (settings) => {
    if (activeVariantIdx >= 0) {
      const updatedVariants = [...variants];
      updatedVariants[activeVariantIdx] = {
        ...updatedVariants[activeVariantIdx],
        ...settings,
      };
      await patchConfig({ strategy_variants: updatedVariants });
    } else {
      await setWatchlistScheduler(settings);
    }
  };

  const handleManualRotate = async () => {
    setIsRotating(true);
    try {
      await rotateWatchlistNow();
    } finally {
      setTimeout(() => setIsRotating(false), 400);
    }
  };

  return (
    <div className={cn(
      "bg-surface/70 border border-border/70 rounded-2xl p-3 sm:p-4 transition-all shadow-sm",
      isLocked && "border-amber/30 bg-amber/[0.02]",
      className
    )}>
      {/* Strategy Selector Tabs (only shown if not unified with parent dropdown and variants exist) */}
      {!activeStrategyLabel && variants.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 pb-2.5 border-b border-border/30 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-dim shrink-0 mr-1">
            <Layers size={11} className="text-accent" />
            <span>Target Strategy:</span>
          </div>
          <button
            type="button"
            onClick={() => handleSelectTab('base')}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[9.5px] font-mono font-bold uppercase tracking-wider transition-all border shrink-0 outline-none focus-visible:ring-1 focus-visible:ring-accent",
              activeTab === 'base'
                ? "bg-accent text-background font-black border-accent shadow-sm"
                : "bg-surface border-border/60 text-dim hover:text-text hover:border-border"
            )}
          >
            Base: {config.strategy_label || 'Momentum'}
          </button>
          {variants.map((v, i) => (
            <button
              key={v.strategy_label || i}
              type="button"
              onClick={() => handleSelectTab(v.strategy_label)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[9.5px] font-mono font-bold uppercase tracking-wider transition-all border shrink-0 outline-none focus-visible:ring-1 focus-visible:ring-accent",
                activeTab === v.strategy_label
                  ? "bg-violet-500 text-white font-black border-violet-400 shadow-sm"
                  : "bg-surface border-border/60 text-dim hover:text-violet-200 hover:border-violet-500/40"
              )}
            >
              Variant #{i + 1}: {v.strategy_label}
            </button>
          ))}
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
            <Eye size={15} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-text">
                {activeVariantIdx >= 0 ? `${activeTab} Watchlist` : 'Static Watchlist'}
              </span>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-mono font-black border",
                maxLimit > 0 && symbols.length >= maxLimit ? "bg-amber/10 border-amber/30 text-amber" : "bg-accent/10 border-accent/30 text-accent"
              )}>
                {symbols.length}{maxLimit > 0 ? ` / ${maxLimit} Max` : ' (Unlimited)'}
              </span>
            </div>
            <p className="text-[9.5px] text-dim font-medium leading-none mt-0.5">
              {activeStrategyConfig.global_scanner_enabled === false
                ? "Static mode: strictly evaluating monitored symbols below"
                : "Strict symbol routing & dynamic scanner market discovery"}
            </p>
          </div>
        </div>

        {/* Status Indicators & Fast Actions */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {/* Lock / Freeze Status Pill */}
          <Tooltip content={isLocked ? "Watchlist is Locked: Automated rotation is disabled" : "Watchlist is Unlocked: Click to Lock/Freeze"}>
            <button
              type="button"
              onClick={() => handleSetTargetScheduler({ watchlist_locked: !isLocked })}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent",
                isLocked
                  ? "bg-amber/15 border-amber/30 text-amber hover:bg-amber/20"
                  : "bg-surface border-border text-dim hover:text-text hover:border-border-hover"
              )}
            >
              {isLocked ? <Lock size={11} className="text-amber" /> : <Unlock size={11} />}
              {isLocked ? "Locked (No Change)" : "Unlocked"}
            </button>
          </Tooltip>

          {/* Auto-Rotate Status Pill */}
          <Tooltip content={isAutoRotate ? `Auto-Rotate: Every ${intervalMin >= 1440 ? '24h' : `${intervalMin}m`} picks top favorable opportunity` : "Auto-Rotate is Off"}>
            <button
              type="button"
              onClick={() => handleSetTargetScheduler({ watchlist_auto_rotate: !isAutoRotate })}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent",
                isAutoRotate && !isLocked
                  ? "bg-green/15 border-green/30 text-green hover:bg-green/20"
                  : "bg-surface border-border text-dim hover:text-text hover:border-border-hover"
              )}
            >
              <span className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                isAutoRotate && !isLocked ? "bg-green animate-pulse" : "bg-dim/40"
              )} />
              {isAutoRotate ? `Rotate: ${intervalMin >= 1440 ? '1d' : `${intervalMin}m`}` : "Rotate: Off"}
            </button>
          </Tooltip>

          {/* Manual Rotate Button */}
          <Tooltip content="Promote top favorable scanner candidate into watchlist now">
            <button
              type="button"
              disabled={isLocked || isRotating}
              onClick={handleManualRotate}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent",
                isLocked
                  ? "opacity-50 cursor-not-allowed bg-surface border-border text-dim"
                  : "bg-accent/15 border-accent/40 text-accent hover:bg-accent/25 active:scale-95"
              )}
            >
              <Sparkles size={11} className={cn("text-accent", isRotating && "animate-spin")} />
              <span>Rotate Now</span>
            </button>
          </Tooltip>

          {/* Toggle Advanced Settings */}
          <Tooltip content="Configure capacity limits, intervals, and thresholds">
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className="p-1 rounded-lg bg-surface border border-border text-dim hover:text-text hover:border-border-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Toggle Watchlist Settings"
            >
              {showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Expandable Settings Drawer */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border/30 bg-background/30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 mb-3"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Capacity Limit Selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black uppercase tracking-wider text-dim">
                  Watchlist Limit (Enforced)
                </label>
                <div className="flex flex-wrap gap-1">
                  {LIMIT_PRESETS.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => handleSetTargetLimit(p.value)}
                      className={cn(
                        "px-2 py-1 rounded text-[9px] font-mono font-bold uppercase transition-all outline-none focus-visible:ring-1 focus-visible:ring-accent",
                        maxLimit === p.value
                          ? "bg-accent text-background font-black shadow-sm"
                          : "bg-surface border border-border/40 text-dim hover:text-text"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <span className="text-[8px] text-dim/80">
                  {maxLimit === 1
                    ? "Strict single-symbol mode: selecting any candidate replaces the current symbol."
                    : maxLimit > 0
                    ? `Strict ceiling: only up to ${maxLimit} symbols stay on the list.`
                    : "Uncapped: symbols can be added freely."}
                </span>
              </div>

              {/* Rotation Scheduler Interval */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black uppercase tracking-wider text-dim">
                  Rotation Frequency
                </label>
                <div className="flex flex-wrap gap-1">
                  {INTERVAL_PRESETS.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleSetTargetScheduler({ watchlist_rotate_interval_min: p.value })}
                      className={cn(
                        "px-2 py-1 rounded text-[9px] font-mono font-bold uppercase transition-all outline-none focus-visible:ring-1 focus-visible:ring-accent",
                        intervalMin === p.value
                          ? "bg-green text-background font-black shadow-sm"
                          : "bg-surface border border-border/40 text-dim hover:text-text",
                        isLocked && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <span className="text-[8px] text-dim/80">
                  Cadence for promoting top favorable scanner opportunities (5m up to 1d / 24h).
                </span>
              </div>

              {/* Mode & Safeguard Notice */}
              <div className="flex flex-col gap-1.5 bg-surface/40 p-2.5 rounded-xl border border-border/30">
                <div className="flex items-center gap-1.5 text-accent text-[9px] font-black uppercase tracking-wider">
                  <Shield size={12} /> SRE Capital Safeguard
                </div>
                <p className="text-[8.5px] text-dim leading-relaxed">
                  Symbols with active open positions are <span className="text-text font-bold">never evicted</span> during auto-rotation or capacity enforcement.
                </p>
              </div>

              {/* 1-Click Practical Setup Recommendations */}
              <div className="md:col-span-3 flex flex-col gap-2 pt-2 border-t border-border/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-wider text-accent">
                    <Sparkles size={12} className="text-accent" />
                    <span>1-Click Practical Setup Recommendations</span>
                  </div>
                  <span className="text-[8px] text-dim font-mono">
                    Instant rule configuration for {activeVariantIdx >= 0 ? activeTab : (config.strategy_label || 'Base Strategy')}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    {
                      id: 'solo_scalper',
                      title: 'Solo Scalper',
                      badge: '1 Coin • Locked',
                      desc: 'Strictly monitors & trades 1 locked pair. Zero rotation drift.',
                      maxLimit: 1,
                      autoRotate: false,
                      intervalMin: 15,
                      locked: true,
                    },
                    {
                      id: 'daily_trend',
                      title: 'Daily Trend',
                      badge: '1 Coin • 1d Rotate',
                      desc: 'Tracks top daily performer, refreshed every 24 hours (1d).',
                      maxLimit: 1,
                      autoRotate: true,
                      intervalMin: 1440,
                      locked: false,
                    },
                    {
                      id: 'momentum_basket',
                      title: 'Momentum Basket',
                      badge: '3 Coins • 1h Rotate',
                      desc: 'Top 3 high-volume momentum pairs rotated hourly.',
                      maxLimit: 3,
                      autoRotate: true,
                      intervalMin: 60,
                      locked: false,
                    },
                  ].map(preset => {
                    const isActive =
                      maxLimit === preset.maxLimit &&
                      isAutoRotate === preset.autoRotate &&
                      isLocked === preset.locked &&
                      (!preset.autoRotate || intervalMin === preset.intervalMin);

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleApplyPresetTemplate(preset)}
                        className={cn(
                          "flex flex-col text-left p-2.5 rounded-xl border transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer group",
                          isActive
                            ? "bg-accent/15 border-accent text-text shadow-xs"
                            : "bg-surface/60 border-border/50 hover:bg-surface hover:border-border text-dim hover:text-text"
                        )}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <span className="text-[10.5px] font-black font-mono text-text group-hover:text-accent transition-colors">
                            {preset.title}
                          </span>
                          <span className={cn(
                            "px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider border",
                            isActive ? "bg-accent text-background border-accent" : "bg-white/5 border-border/40 text-dim"
                          )}>
                            {preset.badge}
                          </span>
                        </div>
                        <p className="text-[8.5px] leading-relaxed text-dim/90">
                          {preset.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Symbols Strip / Solo Mode Hero Card */}
      <div className="pt-3">
        {maxLimit === 1 && symbols.length === 1 ? (
          (() => {
            const sym = symbols[0];
            const opp = scannerResults.find(r => r?.symbol === sym) || POPULAR_MARKET_PAIRS.find(p => p.symbol === sym);
            const inPosition = activeTradeSymbols.has(sym);
            const pct = opp?.pct !== undefined ? opp.pct : opp?.momentum;
            const isLong = (pct || 0) >= 0;
            const price = opp?.price;

            return (
              <div className="bg-surface/90 border border-accent/40 rounded-xl p-3 shadow-sm relative overflow-hidden flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">
                    <Target size={20} className="text-accent" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-black font-mono text-text">
                        {sym.replace('USDT', '')}
                        <span className="text-dim/60 text-[10px] ml-0.5">/USDT</span>
                      </span>
                      <span className="px-2 py-0.2 rounded-full text-[8px] font-black uppercase tracking-wider bg-accent/20 border border-accent/40 text-accent font-mono">
                        Solo Focus
                      </span>
                      {inPosition && (
                        <span className="px-2 py-0.2 rounded-full text-[8px] font-black uppercase tracking-wider bg-green/20 border border-green/40 text-green font-mono flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
                          In Active Trade
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10.5px] font-mono flex-wrap">
                      {price !== undefined && (
                        <span className="text-text font-bold">
                          ${price >= 1 ? price.toFixed(2) : price.toPrecision(4)}
                        </span>
                      )}
                      {pct !== undefined && (
                        <span className={cn("font-bold flex items-center gap-0.5", isLong ? "text-green" : "text-red")}>
                          {isLong ? '+' : ''}{Number(pct).toFixed(2)}%
                        </span>
                      )}
                      {opp?.score !== undefined && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 border border-white/10 text-accent font-bold">
                          Score: ★{Number(opp.score).toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0 pt-2 sm:pt-0 border-t border-border/20 sm:border-0">
                  <Tooltip content="Quick swap this solo coin with another market candidate">
                    <button
                      type="button"
                      onClick={() => {
                        inputRef.current?.focus();
                        setIsDropdownOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 text-xs font-mono font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                    >
                      <ArrowRightLeft size={13} />
                      <span>Swap Coin</span>
                    </button>
                  </Tooltip>
                  <Tooltip content={inPosition ? `Warning: ${sym} has an open position` : `Remove ${sym} from Watchlist`}>
                    <button
                      type="button"
                      onClick={() => handleRemoveSymbol(sym)}
                      className="p-1.5 rounded-lg text-dim hover:text-red hover:bg-white/5 border border-border/40 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-red cursor-pointer"
                      aria-label={`Remove ${sym}`}
                    >
                      <X size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })()
        ) : symbols.length === 0 ? (
          <div className="border border-dashed border-border/60 rounded-xl p-3 text-center bg-background/20">
            <p className="text-[10px] text-dim font-bold uppercase tracking-wider">
              No symbols in {activeVariantIdx >= 0 ? activeTab : 'Static Watchlist'}
            </p>
            <p className="text-[9px] text-dim/60 mt-0.5">
              Add a pair below from the candidate picker or type any USDT perpetual contract symbol.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {symbols.map((sym) => {
              const opp = scannerResults.find(r => r?.symbol === sym) || POPULAR_MARKET_PAIRS.find(p => p.symbol === sym);
              const inPosition = activeTradeSymbols.has(sym);
              const pct = opp?.pct !== undefined ? opp.pct : opp?.momentum;
              const isLong = (pct || 0) >= 0;
              const price = opp?.price;

              return (
                <div
                  key={sym}
                  className={cn(
                    "flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-xl border transition-all shadow-sm",
                    inPosition
                      ? "bg-accent/10 border-accent/40 text-text"
                      : "bg-surface border-border/70 hover:border-accent/40 text-text"
                  )}
                >
                  <div className="flex flex-col leading-none">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-black">{sym}</span>
                      {inPosition && (
                        <span className="px-1 py-0.2 rounded text-[7.5px] font-black uppercase bg-green/20 text-green border border-green/30">
                          In Position
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[9px] font-mono">
                      {price !== undefined && (
                        <span className="text-dim/80">
                          ${price >= 1 ? price.toFixed(2) : price.toPrecision(4)}
                        </span>
                      )}
                      {pct !== undefined && (
                        <span className={cn("font-bold", isLong ? "text-green" : "text-red")}>
                          {isLong ? '+' : ''}{Number(pct).toFixed(2)}%
                        </span>
                      )}
                      {opp?.score !== undefined && (
                        <span className="text-[8px] text-accent font-black">
                          ★{Number(opp.score).toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>

                  <Tooltip content={inPosition ? `Warning: ${sym} has an open position` : `Remove ${sym} from Watchlist`}>
                    <button
                      type="button"
                      onClick={() => handleRemoveSymbol(sym)}
                      className="p-1 rounded-md text-dim hover:text-red hover:bg-white/5 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-red"
                      aria-label={`Remove ${sym}`}
                    >
                      <X size={12} />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Add Search & Full Candidate Picker */}
      <div className="mt-3 pt-3 border-t border-border/30 relative" ref={dropdownRef}>
        {maxLimit === 1 && (
          <div className="mb-2 px-2.5 py-1 rounded-lg bg-amber/10 border border-amber/20 text-[8.5px] font-bold text-amber flex items-center justify-between">
            <span>Single-Symbol Mode (Limit: 1)</span>
            <span className="font-mono text-amber/80">Selecting any symbol below automatically swaps the active static pair</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search candidate symbol... (e.g. LIT, SOL, BTC, ETH)"
              value={search}
              onFocus={() => setIsDropdownOpen(true)}
              onChange={(e) => {
                setSearch(e.target.value.toUpperCase());
                setIsDropdownOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search) {
                  handleAddSymbol(search);
                } else if (e.key === 'Escape') {
                  setIsDropdownOpen(false);
                }
              }}
              className="w-full bg-background/40 border border-border/60 rounded-xl px-3 py-1.5 text-xs font-mono text-text placeholder:text-dim/40 focus:border-accent focus-visible:ring-1 focus-visible:ring-accent outline-none transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dim hover:text-text"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={!search}
            onClick={() => handleAddSymbol(search)}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold font-mono transition-colors border outline-none focus-visible:ring-2 focus-visible:ring-accent",
              search
                ? "bg-accent text-background font-black border-accent hover:bg-accent/90 cursor-pointer"
                : "bg-surface border-border text-dim/40 cursor-not-allowed"
            )}
          >
            <Plus size={13} />
            <span>{maxLimit === 1 && symbols.length > 0 ? 'Swap' : 'Add'}</span>
          </button>
        </div>

        {/* Autocomplete Candidate Dropdown */}
        <AnimatePresence>
          {isDropdownOpen && availableCandidates.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="absolute left-0 right-0 top-full mt-1.5 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden max-h-56 overflow-y-auto"
            >
              <div className="p-1.5 flex flex-col gap-0.5">
                <div className="px-2 py-1 text-[8.5px] font-black uppercase tracking-wider text-dim border-b border-border/20 flex justify-between">
                  <span>Candidate Symbols (USDT Perpetual)</span>
                  <span>Momentum / Score</span>
                </div>
                {availableCandidates.map(opp => {
                  const isLong = (opp.pct || opp.momentum || 0) >= 0;
                  return (
                    <button
                      key={opp.symbol}
                      type="button"
                      onClick={() => handleAddSymbol(opp.symbol)}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/5 text-left text-xs font-mono transition-colors outline-none focus-visible:bg-white/10"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-text">{opp.symbol}</span>
                        {opp.price && (
                          <span className="text-[10px] text-dim/70">
                            ${opp.price >= 1 ? opp.price.toFixed(2) : opp.price.toPrecision(4)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("text-[10px] font-bold", isLong ? "text-green" : "text-red")}>
                          {isLong ? '+' : ''}{Number(opp.pct || opp.momentum || 0).toFixed(2)}%
                        </span>
                        {opp.score !== undefined && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-accent/10 border border-accent/20 text-accent font-black">
                            {Number(opp.score).toFixed(0)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

WatchlistManager.displayName = 'WatchlistManager';
