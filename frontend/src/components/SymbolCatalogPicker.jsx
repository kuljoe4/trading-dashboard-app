import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  Check,
  X,
  RefreshCw,
  Layers,
  Copy,
  Sparkles,
  Globe,
  TrendingUp,
  Filter,
  ChevronDown,
} from 'lucide-react';
import { useTradingStore } from '../store/trading';
import { cn, Tooltip } from './ui/primitives';
import { SmoothCollapse } from './ui/SmoothMotion';
import {
  extractHtfEmaCross,
  matchesHtfCrossFilters,
  compareByHtfEmaCross,
  formatHtfCrossCompact,
} from '../utils/htfEmaCross';

const STARTER_SYMBOLS = [
  { symbol: 'BTCUSDT', baseAsset: 'BTC', assetClass: 'crypto' },
  { symbol: 'ETHUSDT', baseAsset: 'ETH', assetClass: 'crypto' },
  { symbol: 'SOLUSDT', baseAsset: 'SOL', assetClass: 'crypto' },
  { symbol: 'BNBUSDT', baseAsset: 'BNB', assetClass: 'crypto' },
  { symbol: 'XRPUSDT', baseAsset: 'XRP', assetClass: 'crypto' },
  { symbol: 'DOGEUSDT', baseAsset: 'DOGE', assetClass: 'crypto' },
  { symbol: 'XAUUSDT', baseAsset: 'XAU', assetClass: 'tradfi', underlyingType: 'COMMODITY' },
  { symbol: 'XAGUSDT', baseAsset: 'XAG', assetClass: 'tradfi', underlyingType: 'COMMODITY' },
];

const formatCompactVol = (v) => {
  const n = Number(v || 0);
  if (!n || n <= 0) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const formatPrice = (p) => {
  const n = Number(p || 0);
  if (!n || n <= 0) return null;
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${n.toPrecision(4)}`;
};

/**
 * Unified Binance Futures Symbol Catalog & Strategy-to-Strategy Static Watchlist Picker.
 * Works immediately without requiring a prior dynamic scan by reading cached exchange symbols
 * from GET /session/symbols combined with live scanner results and other strategies' watchlists.
 */
export const SymbolCatalogPicker = React.memo(({
  selectedSymbols = [],
  onAddSymbol,
  onAddBulkSymbols,
  onRemoveSymbol,
  currentStrategyLabel = null,
  strategiesOverride = null,
  maxLimit = 0,
  compact = false,
  defaultExpanded = false,
  inputRef: externalInputRef = null,
}) => {
  const availableSymbols = useTradingStore((s) => s.availableSymbols || []);
  const availableSymbolsLoading = useTradingStore((s) => s.availableSymbolsLoading);
  const availableSymbolsHtfIncluded = useTradingStore((s) => s.availableSymbolsHtfIncluded);
  const fetchAvailableSymbols = useTradingStore((s) => s.fetchAvailableSymbols);
  const scannerResults = useTradingStore((s) => s.scannerResults || []);
  const variantScannerResults = useTradingStore((s) => s.variantScannerResults || {});
  const storeConfig = useTradingStore((s) => s.config || {});
  const htfCatalogEnabled = Boolean(storeConfig?.htf_ema_cross_catalog_enabled);
  const preferFresh = storeConfig?.htf_ema_cross_prefer_fresh !== false;

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('catalog'); // 'catalog' | 'strategies'
  const [category, setCategory] = useState('all'); // 'all' | 'crypto' | 'tradfi' | 'movers'
  const [sortBy, setSortBy] = useState('volume'); // 'volume' | 'ema_cross' | 'change' | 'alpha'
  const [showHtfFilters, setShowHtfFilters] = useState(false);
  const [htfFreshnessFilter, setHtfFreshnessFilter] = useState('all'); // 'all' | 'actionable' | 'fresh' | 'approaching' | 'early' | 'extended_or_stale'
  const [htfDirectionFilter, setHtfDirectionFilter] = useState('all'); // 'all' | 'LONG' | 'SHORT'
  const [htfMinScoreFilter, setHtfMinScoreFilter] = useState(0); // 0 | 55 | 70 | 80
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  const [copiedSourceKey, setCopiedSourceKey] = useState(null);

  const hasActiveHtfFilter =
    htfFreshnessFilter !== 'all' || htfDirectionFilter !== 'all' || htfMinScoreFilter > 0;
  const activeHtfFilterCount =
    (htfFreshnessFilter !== 'all' ? 1 : 0) +
    (htfDirectionFilter !== 'all' ? 1 : 0) +
    (htfMinScoreFilter > 0 ? 1 : 0);
  const isHtfMode = sortBy === 'ema_cross' || showHtfFilters || hasActiveHtfFilter;

  const internalInputRef = useRef(null);
  const resolvedInputRef = externalInputRef || internalInputRef;

  useEffect(() => {
    if (typeof fetchAvailableSymbols === 'function') {
      fetchAvailableSymbols(false, {
        includeHtfCross: sortBy === 'ema_cross' || htfCatalogEnabled || showHtfFilters || hasActiveHtfFilter,
      });
    }
  }, [fetchAvailableSymbols, sortBy, htfCatalogEnabled, showHtfFilters, hasActiveHtfFilter]);

  const selectedSet = useMemo(() => {
    return new Set((Array.isArray(selectedSymbols) ? selectedSymbols : []).map((s) => String(s || '').toUpperCase()));
  }, [selectedSymbols]);

  // Unified symbol universe: Exchange Catalog + Base Scanner + All Variant Scanners
  const universe = useMemo(() => {
    const map = new Map();

    // 1. Exchange catalog from backend (all active Binance USDS-M Futures including TradFi/Overnight)
    for (const item of availableSymbols) {
      if (!item?.symbol) continue;
      const sym = String(item.symbol).toUpperCase();
      map.set(sym, {
        symbol: sym,
        baseAsset: item.baseAsset || sym.replace(/USDT$/, ''),
        assetClass: item.assetClass === 'tradfi' ? 'tradfi' : 'crypto',
        underlyingType: item.underlyingType || 'COIN',
        contractType: item.contractType || 'PERPETUAL',
        price: Number(item.price || 0),
        pct: Number(item.pct || 0),
        volume_24h: Number(item.volume_24h || 0),
        score: undefined,
        htf_ema_cross: extractHtfEmaCross(item),
      });
    }

    // 2. Overlay live scanner results (base + variants) for live score & freshest price/pct/HTF cross telemetry
    const overlayOpp = (opp) => {
      if (!opp?.symbol) return;
      const sym = String(opp.symbol).toUpperCase();
      if (!sym.endsWith('USDT')) return;
      const existing = map.get(sym);
      const pctVal = opp.pct !== undefined ? Number(opp.pct) : (opp.momentum !== undefined ? Number(opp.momentum) : existing?.pct ?? 0);
      const oppHtf = extractHtfEmaCross(opp);
      map.set(sym, {
        symbol: sym,
        baseAsset: existing?.baseAsset || sym.replace(/USDT$/, ''),
        assetClass: existing?.assetClass || 'crypto',
        underlyingType: existing?.underlyingType || 'COIN',
        contractType: existing?.contractType || 'PERPETUAL',
        price: Number(opp.price || existing?.price || 0),
        pct: pctVal,
        volume_24h: Number(opp.vol || opp.volume || opp.volume_24h || existing?.volume_24h || 0),
        score: opp.score !== undefined ? Number(opp.score) : existing?.score,
        htf_ema_cross: oppHtf || existing?.htf_ema_cross || null,
      });
    };

    for (const opp of scannerResults) overlayOpp(opp);
    Object.values(variantScannerResults || {}).forEach((arr) => {
      if (Array.isArray(arr)) {
        for (const opp of arr) overlayOpp(opp);
      }
    });

    // 3. Minimal offline fallback ONLY if catalog & scanner are both completely empty
    if (map.size === 0) {
      for (const s of STARTER_SYMBOLS) {
        map.set(s.symbol, {
          ...s,
          contractType: 'PERPETUAL',
          price: 0,
          pct: 0,
          volume_24h: 0,
          score: undefined,
          htf_ema_cross: null,
        });
      }
    }

    return Array.from(map.values());
  }, [availableSymbols, scannerResults, variantScannerResults]);

  const tradFiCount = useMemo(() => universe.filter((u) => u.assetClass === 'tradfi').length, [universe]);
  const cryptoCount = universe.length - tradFiCount;
  const htfEvaluatedCount = useMemo(() => universe.filter((u) => Boolean(u.htf_ema_cross)).length, [universe]);

  const htfRankMap = useMemo(() => {
    const scored = universe.filter((u) => Boolean(u.htf_ema_cross));
    scored.sort(compareByHtfEmaCross);
    const rankMap = new Map();
    scored.forEach((item, idx) => {
      rankMap.set(item.symbol, idx + 1);
    });
    return rankMap;
  }, [universe]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toUpperCase();
    let list = universe.filter((item) => {
      if (category === 'crypto' && item.assetClass !== 'crypto') return false;
      if (category === 'tradfi' && item.assetClass !== 'tradfi') return false;
      if (category === 'movers' && Math.abs(item.pct || 0) < 2.0) return false;
      if (hasActiveHtfFilter && !matchesHtfCrossFilters(item, {
        freshness: htfFreshnessFilter,
        direction: htfDirectionFilter,
        minScore: htfMinScoreFilter,
      })) {
        return false;
      }
      if (q && !item.symbol.includes(q) && !(item.underlyingType || '').includes(q)) return false;
      return true;
    });

    if (sortBy === 'ema_cross' || (hasActiveHtfFilter && sortBy === 'volume')) {
      list = [...list].sort(compareByHtfEmaCross);
    } else if (sortBy === 'change') {
      list = [...list].sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));
    } else if (sortBy === 'alpha') {
      list = [...list].sort((a, b) => a.symbol.localeCompare(b.symbol));
    } else {
      list = [...list].sort((a, b) => {
        if ((b.volume_24h || 0) !== (a.volume_24h || 0)) return (b.volume_24h || 0) - (a.volume_24h || 0);
        if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
        return a.symbol.localeCompare(b.symbol);
      });
    }

    return list.slice(0, q ? 60 : 48);
  }, [universe, query, category, sortBy, hasActiveHtfFilter, htfFreshnessFilter, htfDirectionFilter, htfMinScoreFilter]);

  // Build other strategies' symbol lists (both their Static Watchlist & Live Scanned symbols)
  const otherStrategies = useMemo(() => {
    const baseCfg = strategiesOverride?.baseConfig || storeConfig || {};
    const variants = Array.isArray(strategiesOverride?.variants)
      ? strategiesOverride.variants
      : (Array.isArray(baseCfg.strategy_variants) ? baseCfg.strategy_variants : []);

    const list = [];
    const baseLabel = baseCfg.strategy_label || 'Base Strategy';
    const normalizedCurrent = String(currentStrategyLabel || '').trim();

    if (!normalizedCurrent || normalizedCurrent !== baseLabel) {
      const staticSyms = Array.isArray(baseCfg.symbols) ? baseCfg.symbols.filter(Boolean) : [];
      const liveSyms = (scannerResults || []).map((r) => r?.symbol).filter(Boolean);
      list.push({
        id: 'base',
        label: baseLabel,
        isBase: true,
        timeframe: baseCfg.scan_interval || '5m',
        staticSymbols: Array.from(new Set(staticSyms)),
        liveSymbols: Array.from(new Set(liveSyms)).slice(0, 15),
      });
    }

    variants.forEach((v, idx) => {
      if (!v) return;
      const vLabel = v.strategy_label || `Variant #${idx + 1}`;
      if (normalizedCurrent && vLabel === normalizedCurrent) return;
      const staticSyms = Array.isArray(v.symbols) ? v.symbols.filter(Boolean) : [];
      const liveArr = variantScannerResults?.[vLabel] || [];
      const liveSyms = Array.isArray(liveArr) ? liveArr.map((r) => r?.symbol).filter(Boolean) : [];
      list.push({
        id: `variant-${idx}`,
        label: vLabel,
        isBase: false,
        timeframe: v.scan_interval || baseCfg.scan_interval || '5m',
        staticSymbols: Array.from(new Set(staticSyms)),
        liveSymbols: Array.from(new Set(liveSyms)).slice(0, 15),
      });
    });

    return list;
  }, [strategiesOverride, storeConfig, currentStrategyLabel, scannerResults, variantScannerResults]);

  const directTypedSymbol = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!q || q.length < 2) return null;
    const candidate = q.endsWith('USDT') ? q : `${q}USDT`;
    if (selectedSet.has(candidate)) return null;
    return candidate;
  }, [query, selectedSet]);

  const handleToggleSymbol = (sym) => {
    const clean = String(sym || '').trim().toUpperCase();
    if (!clean) return;
    const finalSym = clean.endsWith('USDT') ? clean : `${clean}USDT`;
    if (selectedSet.has(finalSym)) {
      onRemoveSymbol?.(finalSym);
    } else {
      onAddSymbol?.(finalSym);
    }
  };

  const handleCopyBulk = (symbolsList, sourceKey) => {
    const toAdd = (symbolsList || []).filter((s) => s && !selectedSet.has(String(s).toUpperCase()));
    if (toAdd.length === 0) return;
    if (typeof onAddBulkSymbols === 'function') {
      onAddBulkSymbols(toAdd);
    } else if (typeof onAddSymbol === 'function') {
      toAdd.forEach((s) => onAddSymbol(s));
    }
    setCopiedSourceKey(sourceKey);
    setTimeout(() => setCopiedSourceKey(null), 1500);
  };

  return (
    <div className="flex flex-col gap-2.5 w-full min-w-0">
      {/* Top Search & Source Switcher Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            ref={resolvedInputRef}
            type="text"
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value.toUpperCase());
              setIsOpen(true);
              if (activeTab !== 'catalog') setActiveTab('catalog');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && directTypedSymbol) {
                e.preventDefault();
                onAddSymbol?.(directTypedSymbol);
                setQuery('');
              } else if (e.key === 'Escape') {
                setQuery('');
              }
            }}
            placeholder="Search any Binance Futures pair (BTC, SOL, XAU, TSLA)..."
            aria-label="Search symbols to add to static watchlist"
            className="w-full bg-background/60 border border-border rounded-lg pl-8 pr-28 py-1.5 text-xs font-mono text-text placeholder:text-muted/50 focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 transition-colors"
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {directTypedSymbol && (
              <button
                type="button"
                onClick={() => {
                  onAddSymbol?.(directTypedSymbol);
                  setQuery('');
                }}
                className="px-1.5 py-0.5 rounded bg-accent text-background text-[10px] font-mono font-semibold hover:bg-accent/90 transition-colors flex items-center gap-0.5 cursor-pointer shrink-0"
              >
                <Plus size={11} />
                <span>Add</span>
              </button>
            )}
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear symbol search"
                className="text-muted hover:text-text p-0.5 cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Toggle Catalog vs From Strategy */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Segmented Source Tabs: Market Catalog vs Copy from Strategy */}
          <div className="inline-flex items-center rounded-lg border border-border/70 bg-background/50 p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveTab('catalog');
                setIsOpen(true);
              }}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5 cursor-pointer',
                activeTab === 'catalog' && isOpen
                  ? 'bg-surface text-text shadow-xs'
                  : 'text-muted hover:text-text'
              )}
            >
              <Globe size={12} className="text-accent" />
              <span>Catalog</span>
              <span className="font-mono text-[10px] text-muted tabular-nums">{universe.length}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('strategies');
                setIsOpen(true);
              }}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1.5 cursor-pointer',
                activeTab === 'strategies' && isOpen
                  ? 'bg-surface text-text shadow-xs'
                  : 'text-muted hover:text-text'
              )}
            >
              <Layers size={12} className="text-accent" />
              <span>From Strategy</span>
              {otherStrategies.length > 0 && (
                <span className="font-mono text-[10px] text-muted tabular-nums">{otherStrategies.length}</span>
              )}
            </button>
          </div>

          <Tooltip content="Refresh Binance Futures symbol catalog">
            <button
              type="button"
              onClick={() => fetchAvailableSymbols?.(true, {
                includeHtfCross: sortBy === 'ema_cross' || htfCatalogEnabled || showHtfFilters || hasActiveHtfFilter,
              })}
              disabled={availableSymbolsLoading}
              aria-label="Refresh symbol catalog"
              className="p-1.5 rounded-lg border border-border/70 bg-background/50 text-muted hover:text-text hover:border-border transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={cn(availableSymbolsLoading && 'animate-spin text-accent')} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Expandable Picker Body */}
      {isOpen && (
        <div className="rounded-xl border border-border/70 bg-background/40 overflow-hidden">
          {activeTab === 'catalog' ? (
            <>
              {/* Mobile-First Filter & Sort Strip */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 border-b border-border/50 bg-surface/40">
                <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 sm:flex-wrap w-full sm:w-auto">
                  {[
                    { id: 'all', label: `All (${universe.length})` },
                    { id: 'crypto', label: `Crypto (${cryptoCount})` },
                    { id: 'tradfi', label: `TradFi (${tradFiCount})` },
                    { id: 'movers', label: 'Movers >2%' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      aria-pressed={category === tab.id}
                      onClick={() => setCategory(tab.id)}
                      className={cn(
                        'min-h-[38px] sm:min-h-[28px] px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center',
                        category === tab.id
                          ? 'bg-accent/15 text-accent border border-accent/35'
                          : 'bg-background/40 sm:bg-transparent text-muted hover:text-text border border-border/40 sm:border-transparent hover:bg-white/5'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-1.5 text-[11px] text-muted w-full sm:w-auto">
                  <div className="grid grid-cols-2 sm:inline-flex items-center gap-1 bg-background/50 border border-border/40 p-0.5 rounded-lg flex-1 sm:flex-initial">
                    <span className="hidden md:inline px-1.5 text-[10px] font-semibold">Sort</span>
                    {[
                      { id: 'volume', label: 'Volume' },
                      { id: 'ema_cross', label: 'EMA Cross' },
                      { id: 'change', label: '24h %' },
                      { id: 'alpha', label: 'A–Z' },
                    ].map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={sortBy === s.id}
                        onClick={() => setSortBy(s.id)}
                        className={cn(
                          'min-h-[38px] sm:min-h-[24px] px-2 py-0.5 rounded-md text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center',
                          sortBy === s.id ? 'text-text font-semibold bg-surface border border-border/60 shadow-xs' : 'text-muted hover:text-text'
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-expanded={showHtfFilters}
                    onClick={() => setShowHtfFilters((prev) => !prev)}
                    className={cn(
                      'min-h-[38px] sm:min-h-[26px] px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 cursor-pointer shrink-0 transition-colors',
                      showHtfFilters || hasActiveHtfFilter
                        ? 'bg-accent/15 border-accent/40 text-accent'
                        : 'bg-background/50 border-border/60 text-muted hover:text-text'
                    )}
                    title="Filter symbols by EMA Cross state, direction & score"
                  >
                    <Filter size={12} />
                    <span className="hidden xs:inline sm:inline">EMA Filters</span>
                    {activeHtfFilterCount > 0 && (
                      <span className="font-mono text-[10px] font-bold tabular-nums">{activeHtfFilterCount}</span>
                    )}
                    <ChevronDown size={12} className={cn('transition-transform duration-200', showHtfFilters && 'rotate-180')} />
                  </button>
                  {!defaultExpanded && (
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      aria-label="Close symbol browser"
                      className="min-w-[38px] min-h-[38px] sm:min-w-[26px] sm:min-h-[26px] flex items-center justify-center rounded-lg text-muted hover:text-text hover:bg-white/5 cursor-pointer shrink-0"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {isHtfMode && !showHtfFilters && (
                <div className="px-3 py-1.5 border-b border-border/40 bg-background/30 flex items-center justify-between gap-2 text-[11px] font-mono text-muted">
                  <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap min-w-0">
                    <span>
                      EMA:{' '}
                      <strong className="text-text font-semibold">
                        {htfFreshnessFilter === 'all' ? 'All states' : htfFreshnessFilter}
                      </strong>
                    </span>
                    {htfDirectionFilter !== 'all' && (
                      <>
                        <span aria-hidden="true" className="opacity-40">·</span>
                        <span className={htfDirectionFilter === 'LONG' ? 'text-green font-semibold' : 'text-red font-semibold'}>
                          {htfDirectionFilter}
                        </span>
                      </>
                    )}
                    {htfMinScoreFilter > 0 && (
                      <>
                        <span aria-hidden="true" className="opacity-40">·</span>
                        <span className="text-accent font-semibold tabular-nums">Score {htfMinScoreFilter}+</span>
                      </>
                    )}
                    {htfEvaluatedCount > 0 && (
                      <>
                        <span aria-hidden="true" className="opacity-40">·</span>
                        <span className="text-accent tabular-nums">{htfEvaluatedCount} scored · {filteredCatalog.length} shown</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasActiveHtfFilter && (
                      <button
                        type="button"
                        onClick={() => {
                          setHtfFreshnessFilter('all');
                          setHtfDirectionFilter('all');
                          setHtfMinScoreFilter(0);
                        }}
                        className="text-red font-sans font-semibold hover:underline cursor-pointer"
                      >
                        Reset
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowHtfFilters(true)}
                      className="text-accent font-sans font-semibold hover:underline cursor-pointer"
                    >
                      Adjust
                    </button>
                  </div>
                </div>
              )}

              <SmoothCollapse isOpen={showHtfFilters}>
                <div className="px-3 py-2.5 border-b border-border/40 bg-background/30 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                    <span className="leading-snug">
                      {preferFresh
                        ? 'Ranked by fresh, profitable HTF EMA crossovers — stale & extended runs are demoted.'
                        : 'Ranked by historical HTF EMA crossover profitability across cached bars.'}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {htfEvaluatedCount > 0 ? (
                        <span className="font-mono text-[10px] tabular-nums text-accent whitespace-nowrap">
                          {htfEvaluatedCount} scored · {filteredCatalog.length} shown
                        </span>
                      ) : !availableSymbolsHtfIncluded && availableSymbolsLoading ? (
                        <span className="font-mono text-[10px] text-muted whitespace-nowrap">
                          Scoring…
                        </span>
                      ) : null}
                      {hasActiveHtfFilter && (
                        <button
                          type="button"
                          onClick={() => {
                            setHtfFreshnessFilter('all');
                            setHtfDirectionFilter('all');
                            setHtfMinScoreFilter(0);
                          }}
                          className="text-[10px] font-semibold text-accent hover:underline cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Mobile-First EMA Cross Filter Types */}
                  <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-1.5" role="group" aria-label="EMA Cross freshness filter">
                    {[
                      { id: 'all', label: 'All States' },
                      { id: 'actionable', label: 'Non-Stale' },
                      { id: 'fresh', label: 'Fresh' },
                      { id: 'approaching', label: 'Near Cross' },
                      { id: 'early', label: 'Early' },
                      { id: 'extended_or_stale', label: 'Ext / Stale' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={htfFreshnessFilter === f.id}
                        onClick={() => setHtfFreshnessFilter(f.id)}
                        className={cn(
                          'min-h-[38px] sm:min-h-[26px] px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center',
                          htfFreshnessFilter === f.id
                            ? 'bg-accent/15 border-accent/40 text-accent font-semibold'
                            : 'bg-surface/40 border-border/50 text-muted hover:text-text'
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <div className="grid grid-cols-3 gap-1" role="group" aria-label="EMA Cross direction filter">
                      {[
                        { id: 'all', label: 'Any Side' },
                        { id: 'LONG', label: 'Long' },
                        { id: 'SHORT', label: 'Short' },
                      ].map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          aria-pressed={htfDirectionFilter === d.id}
                          onClick={() => setHtfDirectionFilter(d.id)}
                          className={cn(
                            'min-h-[38px] sm:min-h-[26px] px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center',
                            htfDirectionFilter === d.id
                              ? d.id === 'SHORT'
                                ? 'bg-red/15 border-red/40 text-red font-semibold'
                                : d.id === 'LONG'
                                ? 'bg-green/15 border-green/40 text-green font-semibold'
                                : 'bg-surface border-border text-text font-semibold'
                              : 'bg-surface/40 border-border/50 text-muted hover:text-text'
                          )}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-4 gap-1" role="group" aria-label="Minimum EMA Cross score filter">
                      {[
                        { id: 0, label: 'Score: Any' },
                        { id: 55, label: '55+' },
                        { id: 70, label: '70+' },
                        { id: 80, label: '80+' },
                      ].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          aria-pressed={htfMinScoreFilter === m.id}
                          onClick={() => setHtfMinScoreFilter(m.id)}
                          className={cn(
                            'min-h-[38px] sm:min-h-[26px] px-2 py-1 rounded-lg border text-[11px] font-mono tabular-nums transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center',
                            htfMinScoreFilter === m.id
                              ? 'bg-accent/15 border-accent/40 text-accent font-semibold'
                              : 'bg-surface/40 border-border/50 text-muted hover:text-text'
                          )}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </SmoothCollapse>

              {/* Symbol Grid (Fixed height eliminates CLS during async catalog load and category switches) */}
              <div className={cn('p-2 overflow-y-auto no-scrollbar', compact ? 'h-52' : 'h-64')}>
                {availableSymbolsLoading && universe.length === 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5" aria-busy="true" aria-label="Loading Binance Futures symbol catalog">
                    {Array.from({ length: 8 }).map((_, idx) => (
                      <div
                        key={idx}
                        className="h-[54px] rounded-lg border border-border/40 bg-surface/50 px-2.5 py-2 flex items-center justify-between gap-2 animate-pulse"
                      >
                        <div className="flex flex-col gap-1.5 flex-1">
                          <div className="h-3 w-16 rounded bg-border/60" />
                          <div className="h-2.5 w-28 rounded bg-border/40" />
                        </div>
                        <div className="h-3 w-10 rounded bg-border/50" />
                      </div>
                    ))}
                  </div>
                ) : filteredCatalog.length === 0 ? (
                  <div className="py-6 text-center space-y-2">
                    <p className="text-xs text-muted">
                      {hasActiveHtfFilter
                        ? 'No pairs match the selected EMA Cross filters.'
                        : category === 'tradfi'
                        ? 'No TradFi / Overnight contracts loaded yet. Refresh catalog or type a symbol (e.g. XAUUSDT, TSLAUSDT) to pin directly.'
                        : 'No matching pairs found.'}
                    </p>
                    {hasActiveHtfFilter && (
                      <button
                        type="button"
                        onClick={() => {
                          setHtfFreshnessFilter('all');
                          setHtfDirectionFilter('all');
                          setHtfMinScoreFilter(0);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/30 text-accent text-xs font-medium hover:bg-accent/25 cursor-pointer"
                      >
                        Clear EMA filters
                      </button>
                    )}
                    {directTypedSymbol && (
                      <button
                        type="button"
                        onClick={() => {
                          onAddSymbol?.(directTypedSymbol);
                          setQuery('');
                        }}
                        className="px-3 py-1 rounded-lg bg-accent/15 border border-accent/30 text-accent text-xs font-mono font-medium hover:bg-accent/25 cursor-pointer"
                      >
                        + Add {directTypedSymbol} manually
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={cn(
                    'grid gap-1.5',
                    isHtfMode || htfCatalogEnabled || htfEvaluatedCount > 0
                      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                      : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
                  )}>
                    {filteredCatalog.map((item) => {
                      const isAdded = selectedSet.has(item.symbol);
                      const isPos = (item.pct || 0) >= 0;
                      const volStr = formatCompactVol(item.volume_24h);
                      const priceStr = formatPrice(item.price);
                      const base = item.symbol.replace(/USDT$/, '');
                      const htfCompact = formatHtfCrossCompact(item.htf_ema_cross);
                      const htfRank = htfRankMap.get(item.symbol);
                      const htfScore = htfCompact ? htfCompact.score : null;
                      const htfToneClass = htfCompact?.tone === 'fresh'
                        ? 'text-green font-medium'
                        : htfCompact?.tone === 'approaching'
                        ? 'text-accent font-medium'
                        : htfCompact?.tone === 'early'
                        ? 'text-text'
                        : htfCompact?.tone === 'extended' || htfCompact?.tone === 'stale'
                        ? 'text-amber/80'
                        : 'text-muted';
                      const scoreToneClass = htfScore === null
                        ? 'text-muted'
                        : htfScore >= 70
                        ? 'text-green'
                        : htfScore >= 55
                        ? 'text-accent'
                        : 'text-amber';

                      return (
                        <button
                          key={item.symbol}
                          type="button"
                          onClick={() => handleToggleSymbol(item.symbol)}
                          className={cn(
                            'min-h-[54px] flex flex-col justify-between gap-1 px-2.5 py-2 rounded-lg border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            isAdded
                              ? 'bg-accent/12 border-accent/45 text-text'
                              : 'bg-surface/60 border-border/50 hover:border-accent/40 hover:bg-surface text-text'
                          )}
                        >
                          <div className="flex items-center justify-between gap-1.5 w-full min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {htfRank && (
                                <span className="text-[10.5px] font-mono font-bold text-accent tabular-nums shrink-0">
                                  #{htfRank}
                                </span>
                              )}
                              <span className="font-mono text-xs font-semibold truncate">{base}</span>
                              {item.assetClass === 'tradfi' && (
                                <span className="text-[9px] font-mono font-medium text-amber shrink-0">
                                  {item.underlyingType === 'COMMODITY'
                                    ? 'CMD'
                                    : item.underlyingType === 'EQUITY'
                                    ? 'EQ'
                                    : item.underlyingType === 'INDEX'
                                    ? 'IDX'
                                    : 'TradFi'}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {htfScore !== null && (
                                <span
                                  className={cn('text-[11px] font-mono font-bold tabular-nums', scoreToneClass)}
                                  aria-label={`EMA Cross score ${htfScore} out of 100`}
                                >
                                  {htfScore}/100
                                </span>
                              )}
                              {item.price > 0 && (
                                <span className={cn('text-[10.5px] font-mono font-medium tabular-nums', isPos ? 'text-green' : 'text-red')}>
                                  {isPos ? '+' : ''}{Number(item.pct || 0).toFixed(1)}%
                                </span>
                              )}
                              <span className={cn('text-muted', isAdded && 'text-accent')}>
                                {isAdded ? <Check size={13} /> : <Plus size={13} />}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 w-full text-[10.5px] font-mono tabular-nums text-muted">
                            {htfCompact ? (
                              <>
                                <span className={htfToneClass}>
                                  {htfCompact.label}
                                  {htfCompact.avgProfitPct !== null ? ` · ${htfCompact.avgProfitPct >= 0 ? '+' : ''}${htfCompact.avgProfitPct.toFixed(1)}%` : ''}
                                  {htfCompact.avgPeakRr !== null ? ` · ${htfCompact.avgPeakRr.toFixed(1)}R` : ''}
                                </span>
                                <span className="opacity-75">
                                  {priceStr || ''}{priceStr && volStr ? ' · ' : ''}{volStr || ''}
                                </span>
                              </>
                            ) : (
                              <>
                                <span>{priceStr ? priceStr : 'USDT Perp'}</span>
                                <span className="opacity-75">
                                  {isHtfMode ? 'No HTF bars' : (volStr || '')}
                                </span>
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {maxLimit === 1 && (
                <div className="px-3 py-1.5 border-t border-border/40 bg-amber/5 text-[11px] text-amber flex items-center justify-between">
                  <span>Solo mode active (limit 1)</span>
                  <span className="text-muted font-mono text-[10px]">Clicking a symbol swaps the active pair</span>
                </div>
              )}
            </>
          ) : (
            /* Copy / Import from Other Strategies Tab (fixed height matches Market Catalog for 0 CLS on tab toggle) */
            <div className={cn('p-3 space-y-2.5 overflow-y-auto no-scrollbar', compact ? 'h-[246px]' : 'h-[294px]')}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text flex items-center gap-1.5">
                  <Copy size={12} className="text-accent" />
                  Import static or scanned pairs from other strategies
                </span>
                {!defaultExpanded && (
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close strategy import"
                    className="p-0.5 rounded text-muted hover:text-text cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {otherStrategies.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted border border-dashed border-border/50 rounded-lg">
                  No other strategies configured yet. Add a strategy variant to share static watchlists between strategies.
                </div>
              ) : (
                <div className="space-y-2">
                  {otherStrategies.map((strat) => {
                    const unaddedStatic = strat.staticSymbols.filter((s) => !selectedSet.has(s));
                    const unaddedLive = strat.liveSymbols.filter((s) => !selectedSet.has(s));
                    const staticKey = `${strat.id}-static`;
                    const liveKey = `${strat.id}-live`;

                    return (
                      <div
                        key={strat.id}
                        className="p-2.5 rounded-lg border border-border/60 bg-surface/60 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-semibold text-text truncate">{strat.label}</span>
                            <span className="text-[10px] font-mono text-muted">{strat.timeframe}</span>
                            {strat.isBase && (
                              <span className="text-[10px] text-accent font-medium">Base</span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {strat.staticSymbols.length > 0 && (
                              <button
                                type="button"
                                disabled={unaddedStatic.length === 0}
                                onClick={() => handleCopyBulk(unaddedStatic, staticKey)}
                                className={cn(
                                  'px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed',
                                  copiedSourceKey === staticKey
                                    ? 'bg-green/15 border-green/35 text-green'
                                    : 'bg-accent/12 border-accent/35 text-accent hover:bg-accent/20'
                                )}
                              >
                                {copiedSourceKey === staticKey ? <Check size={11} /> : <Copy size={11} />}
                                <span>
                                  {copiedSourceKey === staticKey
                                    ? 'Copied'
                                    : unaddedStatic.length > 0
                                    ? `Copy Static (${unaddedStatic.length})`
                                    : 'Static Synced'}
                                </span>
                              </button>
                            )}

                            {strat.liveSymbols.length > 0 && (
                              <button
                                type="button"
                                disabled={unaddedLive.length === 0}
                                onClick={() => handleCopyBulk(unaddedLive, liveKey)}
                                className={cn(
                                  'px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed',
                                  copiedSourceKey === liveKey
                                    ? 'bg-green/15 border-green/35 text-green'
                                    : 'bg-surface border-border text-text hover:border-accent/40'
                                )}
                              >
                                {copiedSourceKey === liveKey ? <Check size={11} /> : <TrendingUp size={11} />}
                                <span>
                                  {copiedSourceKey === liveKey
                                    ? 'Copied'
                                    : unaddedLive.length > 0
                                    ? `Copy Live (${unaddedLive.length})`
                                    : 'Live Synced'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Individual Symbol Chips (Static first, then Live) */}
                        {strat.staticSymbols.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {strat.staticSymbols.map((sym) => {
                              const alreadyIn = selectedSet.has(sym);
                              return (
                                <button
                                  key={sym}
                                  type="button"
                                  onClick={() => handleToggleSymbol(sym)}
                                  className={cn(
                                    'px-2 py-0.5 rounded text-[11px] font-mono border transition-colors flex items-center gap-1 cursor-pointer',
                                    alreadyIn
                                      ? 'bg-accent/15 border-accent/40 text-accent'
                                      : 'bg-background/60 border-border/60 text-text hover:border-accent/40'
                                  )}
                                >
                                  <span>{sym.replace(/USDT$/, '')}</span>
                                  {alreadyIn ? <Check size={10} /> : <Plus size={10} className="text-muted" />}
                                </button>
                              );
                            })}
                          </div>
                        ) : strat.liveSymbols.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {strat.liveSymbols.slice(0, 10).map((sym) => {
                              const alreadyIn = selectedSet.has(sym);
                              return (
                                <button
                                  key={sym}
                                  type="button"
                                  onClick={() => handleToggleSymbol(sym)}
                                  className={cn(
                                    'px-2 py-0.5 rounded text-[11px] font-mono border transition-colors flex items-center gap-1 cursor-pointer',
                                    alreadyIn
                                      ? 'bg-accent/15 border-accent/40 text-accent'
                                      : 'bg-background/60 border-border/60 text-muted hover:text-text hover:border-accent/40'
                                  )}
                                >
                                  <span>{sym.replace(/USDT$/, '')}</span>
                                  {alreadyIn ? <Check size={10} /> : <Plus size={10} />}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted">No static or scanned symbols on this strategy yet.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

SymbolCatalogPicker.displayName = 'SymbolCatalogPicker';
export default SymbolCatalogPicker;
