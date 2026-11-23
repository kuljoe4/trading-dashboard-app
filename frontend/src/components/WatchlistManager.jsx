import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Eye,
  Shield,
  Lock,
  Unlock,
  X,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  Target,
  ArrowRightLeft,
  SlidersHorizontal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTradingStore } from '../store/trading';
import { cn, Tooltip } from './ui/primitives';
import { SymbolCatalogPicker } from './SymbolCatalogPicker';

const LIMIT_PRESETS = [
  { label: '1 (Solo)', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: '10', value: 10 },
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

const SCHEDULER_PRESETS = [
  {
    id: 'solo_scalper',
    title: 'Solo Scalper',
    meta: '1 pair · Locked',
    desc: 'Strictly monitors 1 pinned pair with zero rotation drift.',
    maxLimit: 1,
    autoRotate: false,
    intervalMin: 15,
    locked: true,
  },
  {
    id: 'daily_trend',
    title: 'Daily Trend',
    meta: '1 pair · 24h rotate',
    desc: 'Tracks the leading performer and refreshes every 24 hours.',
    maxLimit: 1,
    autoRotate: true,
    intervalMin: 1440,
    locked: false,
  },
  {
    id: 'momentum_basket',
    title: 'Momentum Basket',
    meta: '3 pairs · 1h rotate',
    desc: 'Maintains a focused 3-pair basket rotated every hour.',
    maxLimit: 3,
    autoRotate: true,
    intervalMin: 60,
    locked: false,
  },
];

const formatPrice = (p) => {
  const n = Number(p || 0);
  if (!n || n <= 0) return null;
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
};

export const WatchlistManager = React.memo(({
  className,
  compact = false,
  activeStrategyLabel,
  onSelectStrategy,
  defaultPickerOpen = true,
}) => {
  const config = useTradingStore((state) => state.config || {});
  const scannerResults = useTradingStore((state) => state.scannerResults || []);
  const variantScannerResults = useTradingStore((state) => state.variantScannerResults || {});
  const availableSymbols = useTradingStore((state) => state.availableSymbols || []);
  const fetchAvailableSymbols = useTradingStore((state) => state.fetchAvailableSymbols);
  const activeTrades = useTradingStore((state) => state.activeTrades || []);
  const patchConfig = useTradingStore((state) => state.patchConfig);
  const importBulkToWatchlist = useTradingStore((state) => state.importBulkToWatchlist);
  const setWatchlistLimit = useTradingStore((state) => state.setWatchlistLimit);
  const setWatchlistScheduler = useTradingStore((state) => state.setWatchlistScheduler);
  const rotateWatchlistNow = useTradingStore((state) => state.rotateWatchlistNow);
  const addAlert = useTradingStore((state) => state.addAlert);

  const [internalActiveTab, setInternalActiveTab] = useState('base');
  const [showScheduler, setShowScheduler] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (typeof fetchAvailableSymbols === 'function') {
      fetchAvailableSymbols(false);
    }
  }, [fetchAvailableSymbols]);

  const variants = useMemo(() => {
    return Array.isArray(config.strategy_variants) ? config.strategy_variants : [];
  }, [config.strategy_variants]);

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

  const activeVariantIdx = useMemo(() => {
    if (activeTab === 'base') return -1;
    return variants.findIndex((v) => v.strategy_label === activeTab);
  }, [variants, activeTab]);

  const activeStrategyConfig = useMemo(() => {
    if (activeVariantIdx >= 0 && variants[activeVariantIdx]) {
      return variants[activeVariantIdx];
    }
    return config;
  }, [config, variants, activeVariantIdx]);

  const targetStrategyDisplay = activeVariantIdx >= 0
    ? activeTab
    : (config.strategy_label || 'Base Strategy');

  const symbols = useMemo(() => {
    return Array.isArray(activeStrategyConfig.symbols) ? activeStrategyConfig.symbols : [];
  }, [activeStrategyConfig.symbols]);

  const maxLimit = Number(activeStrategyConfig.watchlist_max_symbols ?? config.watchlist_max_symbols) || 0;
  const isAutoRotate = !!(activeStrategyConfig.watchlist_auto_rotate ?? config.watchlist_auto_rotate);
  const isLocked = !!(activeStrategyConfig.watchlist_locked ?? config.watchlist_locked);
  const intervalMin = Number(activeStrategyConfig.watchlist_rotate_interval_min ?? config.watchlist_rotate_interval_min) || 15;

  const activeTradeSymbols = useMemo(() => {
    return new Set(activeTrades.map((t) => t.symbol));
  }, [activeTrades]);

  // Live metadata lookup map (Catalog + Scanner + Variant Scanners)
  const symbolMetaMap = useMemo(() => {
    const map = new Map();
    for (const s of availableSymbols) {
      if (s?.symbol) map.set(s.symbol, s);
    }
    for (const opp of scannerResults) {
      if (opp?.symbol) {
        const prev = map.get(opp.symbol) || {};
        map.set(opp.symbol, {
          ...prev,
          ...opp,
          pct: opp.pct ?? opp.momentum ?? prev.pct,
        });
      }
    }
    Object.values(variantScannerResults || {}).forEach((arr) => {
      if (Array.isArray(arr)) {
        for (const opp of arr) {
          if (opp?.symbol) {
            const prev = map.get(opp.symbol) || {};
            map.set(opp.symbol, {
              ...prev,
              ...opp,
              pct: opp.pct ?? opp.momentum ?? prev.pct,
            });
          }
        }
      }
    });
    return map;
  }, [availableSymbols, scannerResults, variantScannerResults]);

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
    if (currentSymbols.includes(cleanSym)) return;

    let nextSymbols = [...currentSymbols];
    let replacedSymbol = null;

    if (maxLimit > 0 && nextSymbols.length >= maxLimit) {
      const replaceableIndex = nextSymbols.findIndex((s) => !activeTradeSymbols.has(s));
      if (replaceableIndex !== -1) {
        replacedSymbol = nextSymbols[replaceableIndex];
        nextSymbols.splice(replaceableIndex, 1, cleanSym);
      } else {
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
        ? `Swapped ${replacedSymbol} with ${cleanSym} on ${targetStrategyDisplay}.`
        : `Added ${cleanSym} to ${targetStrategyDisplay}.`,
    });
  };

  const handleAddBulkSymbols = async (symbolsToAdd) => {
    if (!Array.isArray(symbolsToAdd) || symbolsToAdd.length === 0) return;
    await importBulkToWatchlist(symbolsToAdd, activeVariantIdx >= 0 ? activeTab : null);
  };

  const handleRemoveSymbol = async (sym) => {
    const nextSymbols = symbols.filter((s) => s !== sym);
    await handleUpdateTargetSymbols(nextSymbols);
    addAlert({
      level: 'info',
      title: 'Symbol Removed',
      message: `Removed ${sym} from ${targetStrategyDisplay}.`,
    });
  };

  const handleSetTargetLimit = async (limitVal) => {
    await setWatchlistLimit(limitVal, activeVariantIdx >= 0 ? activeTab : null);
  };

  const handleSetTargetScheduler = async (settings) => {
    await setWatchlistScheduler(settings, activeVariantIdx >= 0 ? activeTab : null);
  };

  const handleApplyPresetTemplate = async (preset) => {
    let targetSymbols = [...symbols];
    if (preset.maxLimit > 0 && targetSymbols.length > preset.maxLimit) {
      const inPos = targetSymbols.filter((s) => activeTradeSymbols.has(s));
      const notInPos = targetSymbols.filter((s) => !activeTradeSymbols.has(s));
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
      message: `${preset.title} applied to ${targetStrategyDisplay}.`,
    });
  };

  const handleManualRotate = async () => {
    setIsRotating(true);
    try {
      await rotateWatchlistNow(activeVariantIdx >= 0 ? activeTab : null);
    } finally {
      setTimeout(() => setIsRotating(false), 400);
    }
  };

  return (
    <div
      className={cn(
        'w-full max-w-full min-w-0 bg-surface border border-border/70 rounded-xl p-3 sm:p-4 transition-colors',
        isLocked && 'border-amber/35',
        className
      )}
    >
      {/* Strategy Switcher Tabs (only shown when standalone and variants exist) */}
      {!activeStrategyLabel && variants.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-2.5 border-b border-border/50">
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted shrink-0 mr-1">
            <Layers size={12} className="text-accent" />
            Strategy:
          </span>
          <button
            type="button"
            aria-pressed={activeTab === 'base'}
            onClick={() => handleSelectTab('base')}
            className={cn(
              'min-h-[36px] sm:min-h-[28px] px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors border shrink-0 cursor-pointer',
              activeTab === 'base'
                ? 'bg-accent/15 text-accent border-accent/40'
                : 'bg-background/40 border-border/60 text-muted hover:text-text'
            )}
          >
            {config.strategy_label || 'Base Strategy'}
          </button>
          {variants.map((v, i) => (
            <button
              key={v.strategy_label || i}
              type="button"
              aria-pressed={activeTab === v.strategy_label}
              onClick={() => handleSelectTab(v.strategy_label)}
              className={cn(
                'min-h-[36px] sm:min-h-[28px] px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors border shrink-0 cursor-pointer',
                activeTab === v.strategy_label
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'bg-background/40 border-border/60 text-muted hover:text-text'
              )}
            >
              {v.strategy_label}
            </button>
          ))}
        </div>
      )}

      {/* Clean Single-Row Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <Eye size={15} className="text-accent shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-text truncate">
                {activeVariantIdx >= 0 ? `${activeTab} Watchlist` : 'Static Watchlist'}
              </span>
              <span className="text-[11px] font-mono tabular-nums text-muted">
                {symbols.length}
                {maxLimit > 0 ? ` / ${maxLimit}` : ' pinned'}
              </span>
              {isLocked && (
                <span className="text-[10px] font-medium text-amber flex items-center gap-1">
                  <Lock size={10} /> Frozen
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted truncate">
              {activeStrategyConfig.global_scanner_enabled === false
                ? 'Static routing — trades only the pairs pinned below.'
                : 'Pin pairs from the Binance Futures catalog or copy from another strategy.'}
            </p>
          </div>
        </div>

        {/* Concise Utility Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tooltip content={isLocked ? 'Unlock watchlist to allow auto-rotation' : 'Lock watchlist to freeze changes'}>
            <button
              type="button"
              onClick={() => handleSetTargetScheduler({ watchlist_locked: !isLocked })}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer',
                isLocked
                  ? 'bg-amber/15 border-amber/35 text-amber'
                  : 'bg-background/50 border-border/70 text-muted hover:text-text'
              )}
            >
              {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
              <span>{isLocked ? 'Locked' : 'Lock'}</span>
            </button>
          </Tooltip>

          <Tooltip content="Promote the top favorable market candidate into this watchlist now">
            <button
              type="button"
              disabled={isLocked || isRotating}
              onClick={handleManualRotate}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer',
                isLocked
                  ? 'opacity-45 cursor-not-allowed bg-background/40 border-border/50 text-muted'
                  : 'bg-background/50 border-border/70 text-text hover:border-accent/40 hover:text-accent'
              )}
            >
              <Sparkles size={11} className={cn('text-accent', isRotating && 'animate-spin')} />
              <span>Rotate Now</span>
            </button>
          </Tooltip>

          <button
            type="button"
            onClick={() => setShowScheduler((prev) => !prev)}
            aria-expanded={showScheduler}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer',
              showScheduler || isAutoRotate
                ? 'bg-accent/12 border-accent/35 text-accent'
                : 'bg-background/50 border-border/70 text-muted hover:text-text'
            )}
          >
            <SlidersHorizontal size={11} />
            <span>
              Scheduler{isAutoRotate && !isLocked ? ` · ${intervalMin >= 1440 ? '1d' : `${intervalMin}m`}` : ''}
            </span>
            {showScheduler ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Expandable Watchlist Scheduler & Capacity Panel */}
      <AnimatePresence initial={false}>
        {showScheduler && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-b border-border/50"
          >
            <div className="py-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Capacity Limit */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-text">Capacity Limit</span>
                    <span className="text-[11px] font-mono text-muted tabular-nums">
                      {maxLimit > 0 ? `Max ${maxLimit}` : 'Unlimited'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {LIMIT_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => handleSetTargetLimit(p.value)}
                        className={cn(
                          'px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors cursor-pointer',
                          maxLimit === p.value
                            ? 'bg-accent text-background font-semibold border-accent'
                            : 'bg-background/50 border-border/60 text-muted hover:text-text'
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Auto-Rotate Schedule */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-text flex items-center gap-1.5">
                      <Clock size={12} className="text-accent" />
                      Auto-Rotate Cadence
                    </span>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleSetTargetScheduler({ watchlist_auto_rotate: !isAutoRotate })}
                      className={cn(
                        'px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer disabled:opacity-45',
                        isAutoRotate && !isLocked
                          ? 'bg-green/15 border-green/35 text-green'
                          : 'bg-background/50 border-border/60 text-muted hover:text-text'
                      )}
                    >
                      {isAutoRotate ? 'Enabled' : 'Off'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {INTERVAL_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        disabled={isLocked}
                        onClick={() =>
                          handleSetTargetScheduler({
                            watchlist_auto_rotate: true,
                            watchlist_rotate_interval_min: p.value,
                          })
                        }
                        className={cn(
                          'px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors cursor-pointer disabled:opacity-45',
                          isAutoRotate && intervalMin === p.value
                            ? 'bg-green/15 border-green/40 text-green font-semibold'
                            : 'bg-background/50 border-border/60 text-muted hover:text-text'
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 1-Click Scheduler Presets */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                {SCHEDULER_PRESETS.map((preset) => {
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
                        'text-left p-2.5 rounded-lg border transition-colors cursor-pointer',
                        isActive
                          ? 'bg-accent/10 border-accent/45 text-text'
                          : 'bg-background/40 border-border/60 hover:border-border text-muted hover:text-text'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-text">{preset.title}</span>
                        <span className="text-[10px] font-mono text-muted">{preset.meta}</span>
                      </div>
                      <p className="text-[11px] text-muted mt-1 leading-snug">{preset.desc}</p>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                <Shield size={12} className="text-accent shrink-0" />
                <span>Symbols with active open positions are never evicted during rotation or capacity updates.</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Pinned Symbols Strip */}
      <div className="py-3">
        {maxLimit === 1 && symbols.length === 1 ? (
          (() => {
            const sym = symbols[0];
            const meta = symbolMetaMap.get(sym);
            const inPosition = activeTradeSymbols.has(sym);
            const pct = meta?.pct;
            const isLong = (pct || 0) >= 0;
            const priceStr = formatPrice(meta?.price);

            return (
              <div className="bg-background/50 border border-accent/35 rounded-lg p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Target size={16} className="text-accent shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold font-mono text-text">
                        {sym.replace(/USDT$/, '')}
                        <span className="text-muted text-[11px] font-normal">/USDT</span>
                      </span>
                      <span className="text-[11px] text-accent font-medium">Solo Focus</span>
                      {meta?.assetClass === 'tradfi' && (
                        <span className="text-[10px] font-mono text-amber">TradFi</span>
                      )}
                      {inPosition && (
                        <span className="text-[11px] text-green font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green" />
                          In Position
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 mt-0.5 text-xs font-mono tabular-nums text-muted">
                      {priceStr && <span className="text-text">{priceStr}</span>}
                      {pct !== undefined && meta?.price > 0 && (
                        <span className={cn(isLong ? 'text-green' : 'text-red')}>
                          {isLong ? '+' : ''}{Number(pct).toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => searchInputRef.current?.focus()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/12 border border-accent/35 text-accent hover:bg-accent/20 text-xs font-medium cursor-pointer"
                  >
                    <ArrowRightLeft size={12} />
                    <span>Swap Pair</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveSymbol(sym)}
                    aria-label={`Remove ${sym}`}
                    className="p-1.5 rounded-md text-muted hover:text-red border border-border/60 hover:border-red/40 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            );
          })()
        ) : symbols.length === 0 ? (
          <div className="px-3 py-2.5 rounded-lg border border-dashed border-border/60 bg-background/25 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-muted">
              No symbols pinned to <strong className="text-text font-medium">{targetStrategyDisplay}</strong>. Pick from the catalog or copy from another strategy below.
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {symbols.map((sym) => {
              const meta = symbolMetaMap.get(sym);
              const inPosition = activeTradeSymbols.has(sym);
              const pct = meta?.pct;
              const isLong = (pct || 0) >= 0;
              const priceStr = formatPrice(meta?.price);

              return (
                <div
                  key={sym}
                  className={cn(
                    'flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-lg border text-xs font-mono transition-colors',
                    inPosition
                      ? 'bg-accent/10 border-accent/40 text-text'
                      : 'bg-background/50 border-border/70 text-text'
                  )}
                >
                  <span className="font-semibold">{sym.replace(/USDT$/, '')}</span>
                  {meta?.assetClass === 'tradfi' && (
                    <span className="text-[9px] text-amber">TradFi</span>
                  )}
                  {priceStr && <span className="text-[11px] text-muted tabular-nums">{priceStr}</span>}
                  {pct !== undefined && meta?.price > 0 && (
                    <span className={cn('text-[11px] tabular-nums', isLong ? 'text-green' : 'text-red')}>
                      {isLong ? '+' : ''}{Number(pct).toFixed(1)}%
                    </span>
                  )}
                  {inPosition && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green shrink-0" title="Active position" />
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveSymbol(sym)}
                    aria-label={`Remove ${sym}`}
                    className="p-0.5 rounded text-muted hover:text-red transition-colors cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Unified Market Catalog & Copy-from-Strategy Picker (works immediately without dynamic scan!) */}
      <div className="pt-2.5 border-t border-border/50">
        <SymbolCatalogPicker
          selectedSymbols={symbols}
          onAddSymbol={handleAddSymbol}
          onAddBulkSymbols={handleAddBulkSymbols}
          onRemoveSymbol={handleRemoveSymbol}
          currentStrategyLabel={targetStrategyDisplay}
          maxLimit={maxLimit}
          compact={compact}
          defaultExpanded={defaultPickerOpen || symbols.length === 0}
          inputRef={searchInputRef}
        />
      </div>
    </div>
  );
});

WatchlistManager.displayName = 'WatchlistManager';
export default WatchlistManager;
