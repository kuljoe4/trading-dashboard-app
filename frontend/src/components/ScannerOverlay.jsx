import React, { useState, useMemo, useEffect, useRef } from 'react'
import { fmtVol } from '../lib/theme'
import { formatDuration, calculateOpportunityProximity } from '../lib/formatters'
import { PulseDot, Sparkline, cn, CopyButton, Tooltip, MonitoredBadge, InPosBadge, SmartCandidateBadge } from './ui/primitives'
import { useTradingStore } from '../store/trading'
import { useResourceFocus } from '../hooks/useResourceFocus'
import { useNow } from '../hooks/useNow'
import { getMarketRegimeInfo } from '../utils/marketRegime'
import { X, Shield, ChevronDown, ChevronUp, Activity, Clock, RefreshCw, PauseCircle, Eye, Layers, Target, Filter } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { shallow } from 'zustand/shallow'
import { WatchlistManager } from './WatchlistManager'
import { ScannerRowsSkeleton } from './ui/Skeletons'

export const StrategySelectorDropdown = React.memo(({
  allStrategies = [],
  effectiveStrategyLabel,
  onSelectStrategy,
  variantScannerResults = {},
  scannerResults = [],
  strategyGateStates = {},
  gateState,
  pausedStrategies = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeStrategy = useMemo(() => {
    return allStrategies.find(s => s.label === effectiveStrategyLabel) || allStrategies[0] || {
      label: effectiveStrategyLabel,
      timeframe: '5m',
      isVariant: false,
    };
  }, [allStrategies, effectiveStrategyLabel]);

  const activeCount = activeStrategy.isVariant
    ? ((variantScannerResults && variantScannerResults[activeStrategy.label]) || []).length
    : (scannerResults || []).length;

  const activeGate = strategyGateStates?.[activeStrategy.label]?.gateState || (!activeStrategy.isVariant ? gateState : null);
  const activeIsGated = activeGate && ['max_trades', 'sl_guard', 'max_trades_period'].includes(activeGate);
  const activeIsPaused = (pausedStrategies || []).includes(activeStrategy.label);

  return (
    <div className="relative shrink-0 min-w-0" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "h-7 flex items-center gap-1.5 px-2 rounded-lg text-[11px] font-bold transition-all border outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer shadow-xs select-none",
          isOpen
            ? "bg-accent/20 border-accent text-accent"
            : "bg-surface/90 border-border/80 text-text hover:border-accent/50 hover:bg-surface"
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Strategy Selector: Current strategy ${activeStrategy.label}`}
      >
        <Layers size={11} className="text-accent shrink-0" />
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-black text-[11px] tracking-tight truncate max-w-[92px] sm:max-w-[160px]">
            {activeStrategy.label}
          </span>
          <span className="text-[8px] px-1 py-0.2 rounded bg-black/40 border border-white/10 font-mono text-accent font-bold shrink-0">
            {activeStrategy.timeframe}
          </span>
          <span className="hidden xs:inline text-[8px] px-1 py-0.2 rounded bg-white/10 font-mono text-dim font-bold shrink-0">
            {activeCount}
          </span>
          {activeIsGated && (
            <span className="text-[7.5px] px-1 py-0.2 rounded bg-amber/20 text-amber border border-amber/40 font-mono font-black shrink-0">
              {activeGate === 'max_trades' ? 'MAX' : 'GATED'}
            </span>
          )}
          {activeIsPaused && (
            <span className="text-[7.5px] px-1 py-0.2 rounded bg-red/20 text-red border border-red/40 font-mono font-black shrink-0">
              PAUSED
            </span>
          )}
        </div>
        <ChevronDown size={11} className={cn("text-dim transition-transform duration-200 shrink-0", isOpen && "rotate-180 text-accent")} />
      </button>

      {/* Accessible Strategy Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full mt-1.5 w-64 sm:w-72 bg-surface/95 backdrop-blur-xl border border-border/80 rounded-xl shadow-2xl z-50 overflow-hidden p-1.5 flex flex-col gap-1"
            role="listbox"
          >
            <div className="px-2 py-1 text-[8.5px] font-black uppercase tracking-wider text-dim border-b border-border/20 flex items-center justify-between">
              <span>Select Active Strategy</span>
              <span className="text-[7.5px] text-accent/80 font-mono">{allStrategies.length} Available</span>
            </div>

            <div className="max-h-60 overflow-y-auto no-scrollbar flex flex-col gap-0.5">
              {allStrategies.map((s, idx) => {
                const isSelected = s.label === effectiveStrategyLabel;
                const count = s.isVariant
                  ? ((variantScannerResults && variantScannerResults[s.label]) || []).length
                  : (scannerResults || []).length;
                const gate = strategyGateStates?.[s.label]?.gateState || (!s.isVariant ? gateState : null);
                const isGated = gate && ['max_trades', 'sl_guard', 'max_trades_period'].includes(gate);
                const isPaused = (pausedStrategies || []).includes(s.label);

                return (
                  <button
                    key={s.label}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelectStrategy(s.label);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-all outline-none cursor-pointer",
                      isSelected
                        ? "bg-accent/15 border border-accent/40 text-text"
                        : "hover:bg-white/5 border border-transparent text-dim hover:text-text"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        isSelected ? "bg-accent animate-pulse" : "bg-dim/30"
                      )} />
                      <div className="flex flex-col min-w-0">
                        <span className={cn(
                          "text-xs font-bold truncate",
                          isSelected ? "text-accent font-black" : "text-text"
                        )}>
                          {s.label}
                        </span>
                        <span className="text-[8.5px] text-dim/70 font-mono">
                          {s.isVariant ? `Strategy Variant #${idx}` : 'Primary Base Strategy'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 font-mono text-[8.5px]">
                      <span className="px-1.5 py-0.5 rounded bg-black/40 text-accent font-bold border border-white/5">
                        {s.timeframe}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-white/5 text-text font-bold">
                        {count} opps
                      </span>
                      {isGated && (
                        <span className="px-1 py-0.5 rounded bg-amber/20 text-amber font-black border border-amber/30 text-[7.5px]">
                          {gate === 'max_trades' ? 'MAX' : 'GATED'}
                        </span>
                      )}
                      {isPaused && (
                        <span className="px-1 py-0.5 rounded bg-red/20 text-red font-black border border-red/30 text-[7.5px]">
                          PAUSED
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
  );
});
StrategySelectorDropdown.displayName = 'StrategySelectorDropdown';

const DISCOVERY_MODES = [
  { id: 'all', label: 'All', color: 'accent', shortLabel: 'All', desc: 'All scanned symbols' },
  { id: 'volume', label: 'Top Volume', color: 'green', shortLabel: 'Volume', desc: 'Top 15 by 24h volume' },
  { id: 'change_pct', label: 'Top Gainers', color: 'purple', shortLabel: 'Gainers', desc: 'Top 15 signed gainers' },
  { id: 'losers', label: 'Top Losers', color: 'amber', shortLabel: 'Losers', desc: 'Top 15 signed losers' }
];

export const DiscoveryModeDropdown = React.memo(({
  discoveryMode,
  onSelectDiscoveryMode,
  isPureStatic,
  strategyConfig,
  effectiveStrategyLabel,
  onEnableDiscovery,
  isWatchlistCollapsed,
  onToggleWatchlist
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizedMode = discoveryMode === 'pct_change' ? 'change_pct' : discoveryMode === 'loss_pct' ? 'losers' : discoveryMode;
  const activeOption = DISCOVERY_MODES.find(m => m.id === normalizedMode) || DISCOVERY_MODES[0];

  const buttonLabel = isPureStatic
    ? (strategyConfig?.watchlist_max_symbols === 1 && strategyConfig?.symbols?.length === 1
      ? `Solo: ${strategyConfig.symbols[0].replace('USDT', '')}`
      : `Static (${strategyConfig?.symbols?.length || 0})`)
    : activeOption.shortLabel;

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "h-7 flex items-center gap-1 px-2 rounded-lg text-[10.5px] font-mono font-bold transition-all border outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer shadow-xs select-none whitespace-nowrap",
          isOpen
            ? "bg-accent/20 border-accent text-accent"
            : isPureStatic
            ? "bg-accent/10 border-accent/40 text-accent"
            : normalizedMode !== 'all'
            ? "bg-accent/15 border-accent/40 text-accent"
            : "bg-surface/90 border-border/80 text-dim hover:text-text hover:border-accent/50"
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Discovery Filter Menu: ${buttonLabel}`}
      >
        {isPureStatic ? <Shield size={10} className="text-accent shrink-0" /> : <Filter size={10} className="text-accent shrink-0" />}
        <span className="truncate max-w-[76px] sm:max-w-[110px]">{buttonLabel}</span>
        <ChevronDown size={11} className={cn("text-dim transition-transform duration-200 shrink-0", isOpen && "rotate-180 text-accent")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-56 bg-surface/95 backdrop-blur-xl border border-border/80 rounded-xl shadow-2xl z-50 overflow-hidden p-1.5 flex flex-col gap-1 text-left"
            role="listbox"
          >
            <div className="px-2 py-1 text-[8px] font-black uppercase tracking-wider text-dim border-b border-border/20 flex items-center justify-between">
              <span>Discovery Mode</span>
              <span className="text-[7.5px] text-accent font-mono truncate max-w-[95px]">{effectiveStrategyLabel}</span>
            </div>

            {isPureStatic && (
              <div className="px-2 py-1.5 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-between gap-2 mb-0.5">
                <div className="flex flex-col min-w-0">
                  <span className="text-[9.5px] font-bold text-accent truncate">Static Whitelist Active</span>
                  <span className="text-[8px] text-dim font-mono">{strategyConfig?.symbols?.length || 0} fixed pair(s)</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onEnableDiscovery();
                    setIsOpen(false);
                  }}
                  className="px-2 py-1 rounded bg-accent text-background text-[8px] font-black uppercase tracking-wider shrink-0 cursor-pointer hover:opacity-90"
                >
                  Enable Discovery
                </button>
              </div>
            )}

            {DISCOVERY_MODES.map(m => {
              const isSelected = !isPureStatic && (normalizedMode === m.id || discoveryMode === m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelectDiscoveryMode(m.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer",
                    isSelected
                      ? "bg-accent/15 border border-accent/40 text-accent"
                      : "hover:bg-white/5 border border-transparent text-dim hover:text-text"
                  )}
                >
                  <div className="flex flex-col min-w-0">
                    <span className={cn("text-[10.5px] font-bold", isSelected ? "text-accent font-black" : "text-text")}>
                      {m.label}
                    </span>
                    <span className="text-[8px] text-dim/70 font-mono">{m.desc}</span>
                  </div>
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                </button>
              );
            })}

            <div className="border-t border-border/30 pt-1 mt-0.5">
              <button
                type="button"
                onClick={() => {
                  onToggleWatchlist();
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[9.5px] font-mono font-bold text-dim hover:text-text hover:bg-white/5 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Target size={10} className="text-accent" />
                  <span>{isWatchlistCollapsed ? 'Open Watchlist Manager' : 'Hide Watchlist Manager'}</span>
                </span>
                <span className="text-[8px] px-1.5 py-0.2 rounded bg-white/5 text-text font-mono">
                  {strategyConfig?.symbols?.length || 0}
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
DiscoveryModeDropdown.displayName = 'DiscoveryModeDropdown';

export const StrategyWatchlistPicker = React.memo(({ symbol, effectiveStrategyLabel, compact = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const config = useTradingStore(state => state.config || {});
  const addToWatchlist = useTradingStore(state => state.addToWatchlist);
  const removeFromWatchlist = useTradingStore(state => state.removeFromWatchlist);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const variants = useMemo(() => {
    return Array.isArray(config.strategy_variants) ? config.strategy_variants : [];
  }, [config.strategy_variants]);

  const baseLabel = config.strategy_label || 'Base Strategy';
  const baseSymbols = useMemo(() => Array.isArray(config.symbols) ? config.symbols : [], [config.symbols]);
  const isInBase = baseSymbols.includes(symbol);

  const activeStrategyLabel = effectiveStrategyLabel || baseLabel;

  const isVariantActive = activeStrategyLabel !== baseLabel;
  const activeVariant = useMemo(() => {
    return variants.find(v => v.strategy_label === activeStrategyLabel);
  }, [variants, activeStrategyLabel]);
  const activeSymbols = useMemo(() => {
    if (isVariantActive) return Array.isArray(activeVariant?.symbols) ? activeVariant.symbols : [];
    return baseSymbols;
  }, [isVariantActive, activeVariant, baseSymbols]);
  const isInActive = activeSymbols.includes(symbol);

  return (
    <div className={cn("relative inline-flex items-center shrink-0 align-middle", isOpen ? "z-40" : "z-0")} ref={dropdownRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isInActive) removeFromWatchlist(symbol, activeStrategyLabel);
          else addToWatchlist(symbol, activeStrategyLabel);
        }}
        className={cn(
          "h-[22px] rounded-l-md text-[10px] font-mono font-bold inline-flex items-center justify-center gap-1 leading-none transition-all cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent border border-r-0",
          compact ? "w-[22px] px-0" : "px-2",
          isInActive
            ? "text-accent bg-accent/20 border-accent/40"
            : "bg-surface border-border text-dim hover:text-text hover:border-accent/40"
        )}
        aria-label={isInActive ? `Remove ${symbol} from watchlist for ${activeStrategyLabel}` : `Add ${symbol} to watchlist for ${activeStrategyLabel}`}
      >
        <Eye size={11} className={isInActive ? "text-accent fill-accent/20" : ""} />
        {!compact && <span>{isInActive ? 'In Watchlist' : 'Add to Watchlist'}</span>}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={cn(
          "h-[22px] rounded-r-md text-[10px] font-mono font-bold inline-flex items-center justify-center leading-none transition-all cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent border",
          compact ? "w-[18px] px-0" : "px-1.5",
          isInActive
            ? "text-accent bg-accent/25 border-accent/40 hover:bg-accent/35"
            : "bg-surface border-border text-dim hover:text-text hover:border-accent/40"
        )}
        aria-label={`Select strategy watchlist target for ${symbol}`}
      >
        <ChevronDown size={10} className={cn("transition-transform duration-150", isOpen && "rotate-180 text-accent")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            className="absolute right-0 top-full mt-1 w-56 bg-surface/95 backdrop-blur-xl border border-border/80 rounded-xl shadow-2xl z-50 p-1.5 flex flex-col gap-1 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 text-[8px] font-black uppercase tracking-wider text-dim border-b border-border/30 flex justify-between">
              <span>Import Target Strategy</span>
              <span>Watchlist</span>
            </div>

            <button
              type="button"
              onClick={() => {
                if (isInBase) removeFromWatchlist(symbol, baseLabel);
                else addToWatchlist(symbol, baseLabel);
                setIsOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] font-mono font-bold transition-all text-left outline-none cursor-pointer",
                isInBase
                  ? "bg-accent/20 border border-accent/40 text-accent"
                  : "hover:bg-white/5 border border-transparent text-dim hover:text-text"
              )}
            >
              <div className="flex flex-col min-w-0 pr-1">
                <span className="text-text font-black truncate">{baseLabel}</span>
                <span className="text-[8px] text-dim/70">Base Strategy ({baseSymbols.length})</span>
              </div>
              <span className={cn(
                "text-[8.5px] px-1.5 py-0.2 rounded font-black border shrink-0",
                isInBase ? "bg-accent text-background border-accent" : "bg-white/5 border-border/40 text-dim"
              )}>
                {isInBase ? 'ADDED' : 'ADD +'}
              </span>
            </button>

            {variants.map((v, idx) => {
              const vSymbols = Array.isArray(v.symbols) ? v.symbols : [];
              const isInVariant = vSymbols.includes(symbol);
              const label = v.strategy_label || `Variant #${idx + 1}`;

              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    if (isInVariant) removeFromWatchlist(symbol, label);
                    else addToWatchlist(symbol, label);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[10.5px] font-mono font-bold transition-all text-left outline-none cursor-pointer",
                    isInVariant
                      ? "bg-purple/20 border border-purple/40 text-purple"
                      : "hover:bg-white/5 border border-transparent text-dim hover:text-text"
                  )}
                >
                  <div className="flex flex-col min-w-0 pr-1">
                    <span className="text-text font-black truncate">{label}</span>
                    <span className="text-[8px] text-dim/70">Variant #{idx + 1} ({vSymbols.length})</span>
                  </div>
                  <span className={cn(
                    "text-[8.5px] px-1.5 py-0.2 rounded font-black border shrink-0",
                    isInVariant ? "bg-purple/80 text-white border-purple" : "bg-white/5 border-border/40 text-dim"
                  )}>
                    {isInVariant ? 'ADDED' : 'ADD +'}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
StrategyWatchlistPicker.displayName = 'StrategyWatchlistPicker';

export const FreshnessPill = React.memo(({ ts }) => {
  const now = useNow();
  if (!ts || ts <= 0) return null;
  const age = Math.max(0, now - ts);
  const ageSec = Math.floor(age / 1000);
  const label = age < 2000 ? 'Live' : ageSec < 60 ? `${ageSec}s` : formatDuration(age);

  const colorClass = age < 5000
    ? 'bg-green/10 text-green border-green/30'
    : age < 15000
    ? 'bg-surface text-dim border-border/50'
    : 'bg-amber/10 text-amber border-amber/30';

  return (
    <Tooltip content={`Telemetry & quote timestamped ${formatDuration(age)} ago`}>
      <span className={cn(
        "px-1 py-0.2 rounded text-[7px] font-mono font-black uppercase tracking-tighter border transition-colors cursor-help leading-none hidden xs:inline-flex items-center gap-1 shrink-0 select-none",
        colorClass
      )}>
        <span className={cn("w-1 h-1 rounded-full shrink-0", age < 5000 ? "bg-green animate-pulse" : age < 15000 ? "bg-dim/60" : "bg-amber")} />
        {label}
      </span>
    </Tooltip>
  );
});
FreshnessPill.displayName = 'FreshnessPill';

const ActiveWindowsList = React.memo(() => {
  const activeWindows = useTradingStore(state => state.activeWindows || []);

  const filteredWindows = useMemo(() => {
    return Array.isArray(activeWindows) ? activeWindows.filter(Boolean) : [];
  }, [activeWindows]);

  if (filteredWindows.length === 0) return null;

  return (
    <div className="bg-accent/5 border-b border-border overflow-x-auto no-scrollbar shrink-0 px-2.5 py-1.5">
      <div className="flex gap-2">
        {filteredWindows.map((window) => (
          <div key={window.symbol} className="flex items-center gap-1.5 px-2 py-0.5 bg-surface border border-border rounded whitespace-nowrap">
            <strong className={cn("text-[10px] font-mono", window.direction === 'long' ? "text-green" : "text-red")}>
              {window.symbol}
            </strong>
            <span className="text-[9px] text-dim font-mono">{Math.round(window.remaining_ms / 1000)}s</span>
          </div>
        ))}
      </div>
    </div>
  );
});
ActiveWindowsList.displayName = 'ActiveWindowsList';

const ScanStatus = React.memo(() => {
  const { lastScanTs, nextScanTs, scanIntervalMs, configIntervalSec } = useTradingStore(state => ({
    lastScanTs: state.lastScanTs,
    nextScanTs: state.nextScanTs,
    scanIntervalMs: state.scanIntervalMs,
    configIntervalSec: state.config?.scan_check_interval_sec || 15
  }), shallow);

  const now = useNow();
  const lastUpdateRef = useRef(lastScanTs);
  const isUpdating = lastScanTs !== lastUpdateRef.current;
  if (isUpdating) lastUpdateRef.current = lastScanTs;

  const scanAge = lastScanTs > 0 ? Math.max(0, now - lastScanTs) : null;
  let nextSlotSec = 0;
  if (nextScanTs && nextScanTs > now) {
    nextSlotSec = Math.max(0, Math.ceil((nextScanTs - now) / 1000));
  } else if (lastScanTs > 0) {
    const intervalSec = scanIntervalMs ? Math.round(scanIntervalMs / 1000) : (configIntervalSec || 15);
    nextSlotSec = Math.max(0, intervalSec - Math.floor((scanAge || 0) / 1000));
  }

  return (
    <div className="hidden xl:flex items-center gap-2 shrink-0">
      {lastScanTs > 0 && (
        <>
          <div className="flex items-center gap-1">
            <Clock size={10} className="text-dim/40" />
            <span className={cn(
              "text-[8.5px] text-dim font-bold uppercase tracking-wider transition-colors duration-500",
              scanAge < 5000 && "text-green"
            )}>
              {scanAge < 2000 ? 'Now' : `${formatDuration(scanAge)}`}
            </span>
          </div>
          <div className="w-1 h-1 rounded-full bg-border/40" />
          <div className="flex items-center gap-1">
            <RefreshCw size={10} className={cn("text-dim/40", nextSlotSec <= 1 && "animate-spin text-accent/60")} />
            <span className={cn(
              "text-[8.5px] font-black uppercase tracking-widest tabular-nums",
              nextSlotSec <= 1 ? "text-accent" : "text-dim/60"
            )}>
              {nextSlotSec}s
            </span>
          </div>
        </>
      )}
    </div>
  );
});
ScanStatus.displayName = 'ScanStatus';

const ScannerRow = React.memo(({ opp, i, config, isInPosition, isMonitored, effectiveStrategyLabel }) => {
  const threshold = config?.scan_pct_threshold || 2.0;
  const dir = (opp.dir || opp.direction || '').toLowerCase();
  const isLong = dir ? dir === 'long' : opp.pct >= 0;
  const passing = Math.abs(opp.pct) >= threshold;
  const isSingleMonitor = isMonitored;

  const getStatus = () => {
    if (opp.score > 85 && opp.signalResult?.allFired) return { label: 'TRIGGERED', color: 'bg-green/10 text-green border-green/20' };
    if (opp.signalResult?.allFired) return { label: 'TRIGGERED', color: 'bg-green/10 text-green border-green/20' };
    if (passing) return { label: 'PENDING', color: 'bg-amber/10 text-amber border-amber/20' };
    return { label: 'WAITING', color: 'bg-surface text-dim border-border' };
  };

  const status = getStatus();

  return (
    <div className="flex flex-col border-b border-border/40 w-full max-w-full min-w-0">
      <div
        role="row"
        tabIndex={0}
        aria-label={`Toggle details for ${opp.symbol}, ${isLong ? 'Long' : 'Short'} ${Math.abs(opp.pct || 0).toFixed(2)}%, score ${Number(opp.score || 0).toFixed(0)}, status ${status.label}`}
        className={cn(
          "flex md:grid md:grid-cols-[28px_1.5fr_1fr_1.2fr_110px] items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1 transition-colors h-[38px] md:h-[40px] group outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none focus-visible:bg-white/5 w-full max-w-full min-w-0",
          !passing && "opacity-45 grayscale-[0.5]",
          isSingleMonitor && "bg-accent/5",
          passing && "hover:bg-white/5"
        )}>
        <div className="w-5 md:w-auto shrink-0 flex items-center text-[9px] text-dim font-black font-mono leading-none opacity-45 group-hover:opacity-100 transition-opacity">
          {(i + 1).toString().padStart(2, '0')}
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 md:flex-none overflow-hidden">
          <span className="text-[11.5px] md:text-[12.5px] font-bold font-mono truncate min-w-0">
            {opp.symbol.replace("USDT", "")}
          </span>
          {isInPosition && <InPosBadge className="shrink-0 scale-90" />}
          {isSingleMonitor && <MonitoredBadge className="shrink-0 scale-90" />}
          <CopyButton value={opp.symbol} className="hidden sm:inline-flex md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 p-0.5 scale-75 shrink-0" />
          <StrategyWatchlistPicker
            symbol={opp.symbol}
            effectiveStrategyLabel={effectiveStrategyLabel}
            compact={true}
          />
          {opp.is_smart_candidate && <SmartCandidateBadge className="hidden lg:inline-flex shrink-0" />}
          <div className="hidden lg:block ml-1 opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
            <Sparkline data={opp.history} color={isLong ? "green" : "red"} width={38} height={13} />
          </div>
        </div>

        <div className="flex flex-col items-end w-14 sm:w-16 shrink-0 md:w-auto md:shrink md:items-start md:pl-2">
          <span className={cn(
            "text-[11px] md:text-[12px] font-bold font-mono leading-none tabular-nums",
            isLong ? "text-green" : "text-red"
          )}>
            {isLong ? "+" : "-"}{Number(Math.abs(opp.pct || 0)).toFixed(2)}%
          </span>
          <span className="text-[8.5px] font-mono text-dim/80 mt-0.5 tabular-nums truncate max-w-full">
            ${opp.price ? (opp.price >= 1 ? opp.price.toFixed(2) : opp.price.toPrecision(4)) : '--'}
          </span>
        </div>

        <div className="hidden md:flex items-center justify-between gap-3 overflow-hidden pr-2 min-w-0">
          <span className="text-[10px] text-dim font-mono font-bold leading-none truncate">{fmtVol(opp.vol)}</span>
          <Tooltip content={
            <div className="flex flex-col gap-1.5 p-1 min-w-[120px]">
              <div className="text-[9px] font-black uppercase tracking-widest border-b border-white/10 pb-1">Score Breakdown</div>
              <div className="flex justify-between items-center text-[9px]">
                <span className="text-dim uppercase font-bold">Momentum</span>
                <span className="font-mono text-accent">{Number(opp.score_breakdown?.momentum || 0).toFixed(1)}</span>
              </div>
              <div className="flex justify-between items-center text-[9px]">
                <span className="text-dim uppercase font-bold">Trend</span>
                <span className="font-mono text-purple-400">{Number(opp.score_breakdown?.trend || 0).toFixed(1)}</span>
              </div>
              <div className="border-t border-white/10 pt-1 flex justify-between items-center font-black">
                <span className="text-[8px] uppercase tracking-tighter">Total</span>
                <span className={cn("text-[10px] font-mono", opp.score > 85 ? "text-accent" : "text-white")}>{Number(opp.score || 0).toFixed(1)}</span>
              </div>
            </div>
          }>
            <div className="flex items-center gap-1.5 cursor-help shrink-0" aria-label="Score breakdown bar">
              <span className={cn(
                "text-[10px] font-mono font-black tabular-nums",
                opp.score > 85 ? "text-accent" : "text-text"
              )}>
                {Number(opp.score || 0).toFixed(0)}
              </span>
              <div className="w-7 h-1 bg-white/5 rounded-full overflow-hidden flex border border-white/5">
                <div className="h-full bg-accent/80" style={{ width: `${opp.score_breakdown?.momentum || 0}%` }} />
                <div className="h-full bg-purple/80" style={{ width: `${opp.score_breakdown?.trend || 0}%` }} />
              </div>
            </div>
          </Tooltip>
        </div>

        <div className="flex justify-end items-center w-16 sm:w-18 shrink-0 md:w-auto md:shrink">
          <span className={cn("px-1.5 py-0.5 rounded text-[7.5px] sm:text-[8px] font-black uppercase tracking-wider border w-full md:w-auto md:min-w-[64px] text-center transition-colors leading-none truncate", status.color)}>
            {status.label}
          </span>
        </div>
      </div>
    </div>
  );
});
ScannerRow.displayName = 'ScannerRow';

export const ScannerOverlay = React.memo(({ onClose, selectedStrategyLabel }) => {
  useResourceFocus('scanner');
  const {
    scannerResults,
    variantScannerResults,
    config,
    scannerPaused,
    hibernating,
    hibernationMode,
    activeTrades,
    sessionActive,
    isThrottled,
    wsStatus,
    isSyncingOnResume,
    gateState,
    gateReason,
    strategyGateStates,
    pausedStrategies,
    sessionPaused,
    patchConfig
  } = useTradingStore(state => ({
    scannerResults: state.scannerResults,
    variantScannerResults: state.variantScannerResults || {},
    config: state.config,
    scannerPaused: state.scannerPaused,
    hibernating: state.hibernating,
    hibernationMode: state.hibernationMode,
    activeTrades: state.activeTrades,
    sessionActive: state.sessionActive,
    isThrottled: state.isThrottled,
    wsStatus: state.wsStatus,
    isSyncingOnResume: state.isSyncingOnResume,
    gateState: state.gateState,
    gateReason: state.gateReason,
    strategyGateStates: state.strategyGateStates || {},
    pausedStrategies: state.pausedStrategies || [],
    sessionPaused: state.sessionPaused,
    patchConfig: state.patchConfig,
  }), shallow)

  const [activeStrategyTab, setActiveStrategyTab] = useState(selectedStrategyLabel || config?.strategy_label || 'Base Strategy')

  useEffect(() => {
    if (selectedStrategyLabel) {
      setActiveStrategyTab(selectedStrategyLabel)
    }
  }, [selectedStrategyLabel])

  const effectiveStrategyLabel = activeStrategyTab || selectedStrategyLabel || config?.strategy_label || 'Base Strategy'
  const isVariant = Boolean(config?.strategy_label && effectiveStrategyLabel !== config.strategy_label)

  const allStrategies = useMemo(() => {
    const list = []
    if (config?.strategy_label) {
      list.push({
        label: config.strategy_label,
        isVariant: false,
        timeframe: config.scan_interval || config.timeframe || '5m',
      })
    }
    if (Array.isArray(config?.strategy_variants)) {
      config.strategy_variants.forEach(v => {
        if (v && v.strategy_label && v.enabled !== false) {
          list.push({
            label: v.strategy_label,
            isVariant: true,
            timeframe: v.scan_interval || v.timeframe || config?.scan_interval || config?.timeframe || '5m',
          })
        }
      })
    }
    return list
  }, [config])

  const strategyConfig = useMemo(() => {
    if (!config) return {};
    if (!effectiveStrategyLabel || effectiveStrategyLabel === config.strategy_label) return config;
    const variant = config.strategy_variants?.find(v => v.strategy_label === effectiveStrategyLabel);
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
      ...config,
      ...variant,
      signal_params: {
        ...(config.signal_params || {}),
        ...(variant.signal_params || {}),
      },
      signal_timeframes: {
        ...(config.signal_timeframes || {}),
        ...(variant.signal_timeframes || {}),
      },
      symbols: variantSymbols,
    };
  }, [config, effectiveStrategyLabel]);

  const strategyScannerResults = useMemo(() => {
    if (isVariant) {
      return (variantScannerResults && variantScannerResults[effectiveStrategyLabel]) || [];
    }
    return scannerResults || [];
  }, [variantScannerResults, scannerResults, effectiveStrategyLabel, isVariant]);

  const currentGateInfo = strategyGateStates?.[effectiveStrategyLabel] || (!isVariant ? { gateState, gateReason } : null);
  const currentGateState = currentGateInfo?.gateState || (!isVariant ? gateState : null);
  const currentGateReason = currentGateInfo?.gateReason || (!isVariant ? gateReason : null);
  const isStrategyPaused = (pausedStrategies || []).includes(effectiveStrategyLabel) || (!isVariant && sessionPaused);
  const isStrategyGated = Boolean(
    isStrategyPaused ||
    (currentGateState && ['max_trades', 'sl_guard', 'max_trades_period', 'sleeping', 'risk_pct', 'tod_risk', 'risk'].includes(currentGateState))
  );

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showResumingFeedback = sessionActive && isResuming;

  const activeTradeSymbols = useMemo(() => new Set((activeTrades || []).map(t => t.symbol)), [activeTrades])
  const [discoveryMode, setDiscoveryMode] = useState('all') // 'all' | 'volume' | 'pct_change'
  const [sortBy, setSortBy] = useState('score') // 'score' | 'score_asc' | 'pct_desc' | 'pct_asc' | 'vol_desc' | 'vol_asc' | 'symbol_asc' | 'symbol_desc' | 'proximity' | 'proximity_asc'
  const [rangeFilter, setRangeFilter] = useState('all') // 'all' | 'pos' | 'neg' | 'movers' | 'extreme'

  const [isWatchlistCollapsed, setIsWatchlistCollapsed] = useState(() => {
    const hasExplicitSymbols = Array.isArray(strategyConfig?.symbols) && strategyConfig.symbols.length > 0;
    const isGlobalOff = strategyConfig?.global_scanner_enabled === false;
    return !(isGlobalOff && !hasExplicitSymbols);
  });

  const handleToggleSort = React.useCallback((columnKey) => {
    setSortBy(prev => {
      if (columnKey === 'symbol') {
        return prev === 'symbol_asc' ? 'symbol_desc' : 'symbol_asc';
      }
      if (columnKey === 'pct') {
        return prev === 'pct_desc' ? 'pct_asc' : 'pct_desc';
      }
      if (columnKey === 'vol') {
        return prev === 'vol_desc' ? 'vol_asc' : 'vol_desc';
      }
      if (columnKey === 'score') {
        return prev === 'score' || prev === 'score_desc' ? 'score_asc' : 'score_desc';
      }
      if (columnKey === 'proximity' || columnKey === 'status') {
        return prev === 'proximity' ? 'proximity_asc' : 'proximity';
      }
      return 'score';
    });
  }, []);

  const isPureStatic = useMemo(() => {
    const hasExplicitSymbols = Array.isArray(strategyConfig.symbols) && strategyConfig.symbols.length > 0;
    const isGlobalOff = strategyConfig.global_scanner_enabled === false;
    const isNoAutoRotate = !strategyConfig.watchlist_auto_rotate;
    return (hasExplicitSymbols && isNoAutoRotate) || isGlobalOff;
  }, [strategyConfig]);

  const handleSelectDiscoveryMode = React.useCallback((modeId) => {
    setDiscoveryMode(modeId);
    if (modeId === 'all') return;
    const targetMode = modeId === 'losers' ? 'loss_pct' : modeId === 'pct_change' ? 'change_pct' : modeId;
    if (isVariant) {
      const updatedVariants = (config?.strategy_variants || []).map(v =>
        v.strategy_label === effectiveStrategyLabel ? { ...v, discovery_mode: targetMode } : v
      );
      if (typeof patchConfig === 'function') {
        patchConfig({ strategy_variants: updatedVariants });
      }
    } else {
      if (typeof patchConfig === 'function') {
        patchConfig({ discovery_mode: targetMode });
      }
    }
  }, [config, effectiveStrategyLabel, isVariant, patchConfig]);

  const handleEnableDiscovery = React.useCallback(() => {
    if (isVariant) {
      const updated = (config?.strategy_variants || []).map(v =>
        v.strategy_label === effectiveStrategyLabel
          ? { ...v, global_scanner_enabled: true, symbols: [] }
          : v
      );
      patchConfig?.({ strategy_variants: updated });
    } else {
      patchConfig?.({ global_scanner_enabled: true, symbols: [] });
    }
  }, [config?.strategy_variants, effectiveStrategyLabel, isVariant, patchConfig]);

  const filteredResults = useMemo(() => {
    let results = Array.isArray(strategyScannerResults) ? strategyScannerResults.filter(Boolean) : []

    // Pre-calculate full lists for ranking reference
    const sortedByVolume = [...results].sort((a, b) => (b.vol || b.volume || 0) - (a.vol || a.volume || 0));
    const sortedByChange = [...results].sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0));

    // BOLT OPTIMIZATION: Convert O(N) findIndex calls into O(1) Map lookups to eliminate quadratic complexity O(N^2)
    const volRankMap = new Map();
    for (let i = 0; i < sortedByVolume.length; i++) {
      volRankMap.set(sortedByVolume[i].symbol, i + 1);
    }

    const chgRankMap = new Map();
    for (let i = 0; i < sortedByChange.length; i++) {
      chgRankMap.set(sortedByChange[i].symbol, i + 1);
    }

    // 1. Map ranks so they remain consistent regardless of secondary search/range filters
    results = results.map(r => {
      const volRank = volRankMap.get(r.symbol);
      const chgRank = chgRankMap.get(r.symbol);
      return {
        ...r,
        volume_rank: volRank !== undefined ? volRank : r.volume_rank,
        change_rank: chgRank
      };
    });

    // BOLT OPTIMIZATION: Range filter in a single-pass loop
    const filtered = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];

      if (rangeFilter === 'usdt' && !(r.symbol || '').toUpperCase().endsWith('USDT')) continue;
      if (rangeFilter === 'non_usdt' && (r.symbol || '').toUpperCase().endsWith('USDT')) continue;
      if (rangeFilter === 'pos' && (r.pct || 0) <= 0) continue;
      if (rangeFilter === 'neg' && (r.pct || 0) >= 0) continue;
      if (rangeFilter === 'movers' && Math.abs(r.pct || 0) < 2.0) continue;
      if (rangeFilter === 'extreme' && Math.abs(r.pct || 0) < 5.0) continue;

      filtered.push(r);
    }

    results = filtered;

    // 4. Apply Discovery Mode Slicing (Top 15)
    if (discoveryMode === 'volume') {
      results = results
        .sort((a, b) => (a.volume_rank || 999) - (b.volume_rank || 999))
        .slice(0, 15);
    } else if (discoveryMode === 'pct_change' || discoveryMode === 'change_pct') {
      const side = String(strategyConfig?.entry_side || 'both').toLowerCase();
      results = results
        .sort((a, b) => side === 'short' ? (a.pct || 0) - (b.pct || 0) : (b.pct || 0) - (a.pct || 0))
        .slice(0, 15);
    } else if (discoveryMode === 'losers' || discoveryMode === 'loss_pct') {
      results = results
        .sort((a, b) => (a.pct || 0) - (b.pct || 0))
        .slice(0, 15);
    } else if (discoveryMode === 'abs_change_pct') {
      results = results
        .sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0))
        .slice(0, 15);
    }

    // 5. Apply sorting
    if (sortBy === 'proximity') {
      const proxMap = new Map();
      for (const r of results) {
        proxMap.set(r.symbol, calculateOpportunityProximity(r, strategyConfig));
      }
      results = [...results].sort((a, b) => proxMap.get(b.symbol) - proxMap.get(a.symbol));
    } else if (sortBy === 'proximity_asc') {
      const proxMap = new Map();
      for (const r of results) {
        proxMap.set(r.symbol, calculateOpportunityProximity(r, strategyConfig));
      }
      results = [...results].sort((a, b) => proxMap.get(a.symbol) - proxMap.get(b.symbol));
    } else if (sortBy === 'score' || sortBy === 'score_desc') {
      results = [...results].sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sortBy === 'score_asc') {
      results = [...results].sort((a, b) => (a.score || 0) - (b.score || 0));
    } else if (sortBy === 'pct_desc') {
      results = [...results].sort((a, b) => (b.pct || 0) - (a.pct || 0));
    } else if (sortBy === 'pct_asc') {
      results = [...results].sort((a, b) => (a.pct || 0) - (b.pct || 0));
    } else if (sortBy === 'vol_desc') {
      results = [...results].sort((a, b) => (b.vol || b.volume || 0) - (a.vol || a.volume || 0));
    } else if (sortBy === 'vol_asc') {
      results = [...results].sort((a, b) => (a.vol || a.volume || 0) - (b.vol || b.volume || 0));
    } else if (sortBy === 'symbol_asc') {
      results = [...results].sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
    } else if (sortBy === 'symbol_desc') {
      results = [...results].sort((a, b) => (b.symbol || '').localeCompare(a.symbol || ''));
    }

    return results;
  }, [strategyScannerResults, rangeFilter, discoveryMode, sortBy, strategyConfig])

  // BOLT OPTIMIZATION: Pre-calculate a Set of monitored symbols to avoid O(N*M) lookup in the render loop.
  const monitoredSymbols = useMemo(() => {
    const set = new Set();
    (strategyConfig?.single_symbol_configs || []).forEach(sc => {
      if (sc.enabled) set.add(sc.symbol);
    });
    return set;
  }, [strategyConfig?.single_symbol_configs]);

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 w-full max-w-full min-w-0 bg-surface text-text overflow-hidden">
      {/* ==================== FIXED ROW 1: STRATEGY SWITCHER, DISCOVERY MENU DROPDOWN, COUNTER & CLOSE ==================== */}
      <div className="px-2.5 sm:px-3 py-1 border-b border-border bg-surface flex items-center justify-between gap-1.5 sm:gap-2 shrink-0 h-[38px] min-h-[38px] relative z-30 w-full max-w-full min-w-0">
        {/* Left: Status Dot, Title, Strategy Switcher Dropdown & Discovery Mode Dropdown */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
          <div className="relative flex items-center justify-center w-3 h-3 shrink-0">
            <PulseDot color={showResumingFeedback ? "bg-accent" : hibernating ? (hibernationMode === 'light' ? "bg-accent" : "bg-amber") : scannerPaused ? "bg-red" : "bg-green"} />
          </div>
          <span className="text-[11px] font-black tracking-tight uppercase leading-none shrink-0 whitespace-nowrap hidden md:inline">
            {showResumingFeedback ? 'Resuming...' : 'Live Scanner'}
          </span>

          {/* Strategy Switcher Dropdown */}
          {allStrategies.length > 0 && (
            <StrategySelectorDropdown
              allStrategies={allStrategies}
              effectiveStrategyLabel={effectiveStrategyLabel}
              onSelectStrategy={setActiveStrategyTab}
              variantScannerResults={variantScannerResults}
              scannerResults={scannerResults}
              strategyGateStates={strategyGateStates}
              gateState={gateState}
              pausedStrategies={pausedStrategies}
            />
          )}

          {/* Discovery Mode Dropdown Menu (Consolidated from old Row 2 into Row 1) */}
          <DiscoveryModeDropdown
            discoveryMode={discoveryMode}
            onSelectDiscoveryMode={handleSelectDiscoveryMode}
            isPureStatic={isPureStatic}
            strategyConfig={strategyConfig}
            effectiveStrategyLabel={effectiveStrategyLabel}
            onEnableDiscovery={handleEnableDiscovery}
            isWatchlistCollapsed={isWatchlistCollapsed}
            onToggleWatchlist={() => setIsWatchlistCollapsed(prev => !prev)}
          />

          <ScanStatus />
        </div>

        {/* Screen-Reader Only Telemetry Regions (Zero Visual Footprint) */}
        {(() => {
          const overlayRegime = getMarketRegimeInfo(strategyScannerResults, strategyConfig, { scannerPaused: scannerPaused || isStrategyGated, hibernating });
          return (
            <div className="sr-only">
              <div
                tabIndex={0}
                role="region"
                aria-label={`Market Activity Status: ${overlayRegime.label}. Average momentum ${overlayRegime.avgMomentum.toFixed(2)}%, ${overlayRegime.passingCount} of ${overlayRegime.totalCount} candidates passing threshold. 24h Universe Range Min ${overlayRegime.minPct >= 0 ? '+' : ''}${overlayRegime.minPct.toFixed(2)}%, Max ${overlayRegime.maxPct >= 0 ? '+' : ''}${overlayRegime.maxPct.toFixed(2)}%`}
              >
                Min {overlayRegime.minPct.toFixed(1)}% Max {overlayRegime.maxPct.toFixed(1)}%
              </div>
              {overlayRegime.regime === 'active' && (
                <div aria-live="polite">
                  <span>🔥 Fast Market Expansion</span>
                  <button type="button" onClick={() => {}}>Focus Movers</button>
                </div>
              )}
            </div>
          );
        })()}

        {/* Right: Gate Status, Candidate Count & Close Button */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {isStrategyGated && (
            <div className="flex items-center gap-1 px-1.5 h-6 rounded-md bg-amber/10 border border-amber/30 text-amber font-mono text-[8px] font-bold shrink-0 truncate max-w-[96px] sm:max-w-[140px]">
              <PauseCircle size={10} className="text-amber animate-pulse shrink-0" />
              <span className="font-bold text-amber uppercase tracking-wider truncate">
                {isStrategyPaused
                  ? 'Paused'
                  : currentGateState === 'max_trades'
                  ? 'Max Trades'
                  : `Gated`}
              </span>
            </div>
          )}

          {/* Aligned Candidate Counter Badge */}
          <div className="h-6 flex items-center text-[9px] font-mono text-dim font-bold px-1.5 rounded-md bg-background/60 border border-border/50 whitespace-nowrap shrink-0 tabular-nums">
            <span className="text-text font-black">{filteredResults.length}</span>
            <span className="text-dim/60 ml-0.5">/{strategyScannerResults.length}</span>
          </div>

          <Tooltip content="Close Scanner">
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg transition-colors shrink-0 cursor-pointer text-dim hover:text-text"
              aria-label="Close scanner"
            >
              <X size={15} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ==================== FIXED ROW 2: SORTABLE COLUMN HEADERS (ONLY OTHER STICKY/FIXED ROW) ==================== */}
      <div className="border-b border-border bg-surface/95 shrink-0 relative z-20 w-full max-w-full min-w-0">
        {/* Desktop Column Header with Click-to-Sort */}
        <div className="hidden md:grid md:grid-cols-[28px_1.5fr_1fr_1.2fr_110px] items-center px-3.5 h-[28px] text-[8.5px] text-dim font-bold tracking-widest uppercase select-none">
          <button
            type="button"
            onClick={() => handleToggleSort('score')}
            className="text-left text-dim hover:text-accent outline-none cursor-pointer"
            title="Reset to Score Sort"
          >
            #
          </button>

          <button
            type="button"
            onClick={() => handleToggleSort('symbol')}
            className="flex items-center gap-1 text-left text-dim hover:text-accent outline-none cursor-pointer"
          >
            <span>Symbol</span>
            {sortBy === 'symbol_asc' && <ChevronUp size={10} className="text-accent" />}
            {sortBy === 'symbol_desc' && <ChevronDown size={10} className="text-accent" />}
          </button>

          <button
            type="button"
            onClick={() => handleToggleSort('pct')}
            className="flex items-center gap-1 pl-2 text-left text-dim hover:text-accent outline-none cursor-pointer"
          >
            <span>24h Move</span>
            {sortBy === 'pct_asc' && <ChevronUp size={10} className="text-accent" />}
            {sortBy === 'pct_desc' && <ChevronDown size={10} className="text-accent" />}
          </button>

          <div className="flex items-center justify-between pr-2">
            <button
              type="button"
              onClick={() => handleToggleSort('vol')}
              className="flex items-center gap-1 text-dim hover:text-accent outline-none cursor-pointer"
            >
              <span>Volume</span>
              {sortBy === 'vol_asc' && <ChevronUp size={10} className="text-accent" />}
              {sortBy === 'vol_desc' && <ChevronDown size={10} className="text-accent" />}
            </button>
            <button
              type="button"
              onClick={() => handleToggleSort('score')}
              className="flex items-center gap-1 text-dim hover:text-accent outline-none cursor-pointer"
            >
              <span>Score</span>
              {sortBy === 'score_asc' && <ChevronUp size={10} className="text-accent" />}
              {(sortBy === 'score' || sortBy === 'score_desc') && <ChevronDown size={10} className="text-accent" />}
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleToggleSort('proximity')}
            className="flex items-center justify-end gap-1 text-dim hover:text-accent outline-none cursor-pointer"
          >
            <span>Status</span>
            {sortBy === 'proximity_asc' && <ChevronUp size={10} className="text-accent" />}
            {sortBy === 'proximity' && <ChevronDown size={10} className="text-accent" />}
          </button>
        </div>

        {/* Mobile Column Header with Click-to-Sort */}
        <div className="flex md:hidden items-center gap-1.5 px-2.5 h-[28px] text-[8.5px] text-dim font-bold tracking-widest uppercase select-none w-full max-w-full min-w-0">
          <span className="w-5 shrink-0">#</span>
          <button
            type="button"
            onClick={() => handleToggleSort('symbol')}
            className="flex-1 flex items-center gap-0.5 text-left text-dim hover:text-accent outline-none cursor-pointer min-w-0"
          >
            <span>Symbol</span>
            {sortBy === 'symbol_asc' && <ChevronUp size={10} className="text-accent" />}
            {sortBy === 'symbol_desc' && <ChevronDown size={10} className="text-accent" />}
          </button>
          <button
            type="button"
            onClick={() => handleToggleSort('pct')}
            className="w-14 sm:w-16 shrink-0 text-right flex items-center justify-end gap-0.5 text-dim hover:text-accent outline-none cursor-pointer"
          >
            <span>Move</span>
            {sortBy === 'pct_asc' && <ChevronUp size={10} className="text-accent" />}
            {sortBy === 'pct_desc' && <ChevronDown size={10} className="text-accent" />}
          </button>
          <button
            type="button"
            onClick={() => handleToggleSort('score')}
            className="w-16 sm:w-18 shrink-0 text-right flex items-center justify-end gap-0.5 text-dim hover:text-accent outline-none cursor-pointer"
          >
            <span>Status</span>
            {sortBy === 'score_asc' && <ChevronUp size={10} className="text-accent" />}
            {(sortBy === 'score' || sortBy === 'score_desc') && <ChevronDown size={10} className="text-accent" />}
          </button>
        </div>
      </div>

      {/* ==================== SCROLLABLE BODY (NON-STICKY WATCHLIST BAR + CANDIDATE ROWS) ==================== */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden touch-pan-y no-scrollbar min-h-0 pb-6 overscroll-contain relative z-0 w-full max-w-full min-w-0" data-vaul-no-drag>
        {/* Non-Sticky Target Strategy & Watchlist Summary Strip (scrolls away cleanly on mobile) */}
        <div className="border-b border-border/50 bg-background/25 w-full max-w-full min-w-0">
          <div className="flex items-center justify-between px-2.5 sm:px-3.5 py-1.5 min-h-[34px] gap-2 w-full max-w-full min-w-0">
            <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-1">
              <Target size={12} className="text-accent shrink-0" />
              <span className="text-[11px] font-semibold text-text truncate max-w-[130px] sm:max-w-[200px]">
                {effectiveStrategyLabel || config?.strategy_label || 'Base Strategy'}
              </span>
              {strategyConfig.watchlist_max_symbols === 1 && strategyConfig.symbols?.length === 1 ? (
                <span className="px-1.5 py-0.5 rounded bg-accent/12 border border-accent/30 text-accent font-mono text-[10px] font-medium shrink-0">
                  Solo: {strategyConfig.symbols[0].replace(/USDT$/, '')}
                </span>
              ) : (
                <span className="text-[11px] font-mono text-muted shrink-0 tabular-nums">
                  Static: <strong className="text-text">{strategyConfig.symbols?.length || 0}</strong>{strategyConfig.watchlist_max_symbols ? `/${strategyConfig.watchlist_max_symbols}` : ''}
                </span>
              )}
              {isWatchlistCollapsed && Array.isArray(strategyConfig.symbols) && strategyConfig.symbols.length > 0 && (
                <div className="hidden sm:flex items-center gap-1 min-w-0 overflow-hidden">
                  {strategyConfig.symbols.slice(0, 4).map((sym) => (
                    <span
                      key={sym}
                      className="px-1.5 py-0.5 rounded bg-surface border border-border/60 text-[10px] font-mono text-text shrink-0"
                    >
                      {sym.replace(/USDT$/, '')}
                    </span>
                  ))}
                  {strategyConfig.symbols.length > 4 && (
                    <span className="text-[10px] font-mono text-muted shrink-0">
                      +{strategyConfig.symbols.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsWatchlistCollapsed(!isWatchlistCollapsed)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer shrink-0",
                !isWatchlistCollapsed
                  ? "bg-accent/15 border-accent/40 text-accent"
                  : "bg-surface border-border text-text hover:border-accent/40 hover:text-accent"
              )}
              aria-label={isWatchlistCollapsed ? "Expand Watchlist Manager" : "Collapse Watchlist Manager"}
            >
              <span>{isWatchlistCollapsed ? 'Add / Manage Watchlist' : 'Hide Watchlist'}</span>
              {isWatchlistCollapsed ? <ChevronDown size={12} className="text-accent" /> : <ChevronUp size={12} />}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {!isWatchlistCollapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden border-t border-border/40 p-2.5 sm:p-3 bg-surface/40"
              >
                <WatchlistManager
                  activeStrategyLabel={effectiveStrategyLabel}
                  onSelectStrategy={setActiveStrategyTab}
                  defaultPickerOpen={true}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <ActiveWindowsList />

        {strategyScannerResults.length === 0 ? (
          isStrategyGated ? (
            <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center p-6 gap-2.5 animate-in fade-in duration-300">
              <div className="w-10 h-10 rounded-xl bg-amber/10 border border-amber/30 flex items-center justify-center text-amber">
                <PauseCircle size={20} />
              </div>
              <div className="text-xs font-semibold text-amber">
                Scanning Paused for {effectiveStrategyLabel}
              </div>
              <p className="text-[11px] text-muted max-w-md">
                {currentGateState === 'max_trades'
                  ? 'Maximum open trades reached for this strategy. Candidate evaluation resumes once a trade closes.'
                  : currentGateReason || 'Risk gating is active for this strategy. Scanning resumes once conditions normalize.'}
              </p>
              {isWatchlistCollapsed && (
                <button
                  type="button"
                  onClick={() => setIsWatchlistCollapsed(false)}
                  className="mt-1 px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/35 text-accent text-xs font-medium hover:bg-accent/25 transition-colors cursor-pointer"
                >
                  Open Watchlist & Market Catalog
                </button>
              )}
            </div>
          ) : isPureStatic ? (
            <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-muted gap-2.5 py-12 px-4 text-center">
              <div className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center text-accent/70">
                <Layers size={18} />
              </div>
              <div className="text-xs font-medium text-text/85">
                Static watchlist mode — add pairs directly from the market catalog.
              </div>
              <p className="text-[11px] text-muted max-w-sm">
                Browse all Binance Futures pairs or copy a curated watchlist from another strategy right away.
              </p>
              {isWatchlistCollapsed && (
                <button
                  type="button"
                  onClick={() => setIsWatchlistCollapsed(false)}
                  className="mt-1 px-3.5 py-1.5 rounded-lg bg-accent/15 border border-accent/35 text-accent text-xs font-medium hover:bg-accent/25 transition-colors cursor-pointer"
                >
                  Browse Market Catalog &amp; Copy From Strategy
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-[260px]">
              <div className="px-4 py-2.5 border-b border-border/30 bg-surface/25 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-text/85">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse motion-reduce:animate-none shrink-0" />
                  <span>
                    {isVariant
                      ? `Scanning live candidates for ${effectiveStrategyLabel}...`
                      : 'Synchronizing live market candidates...'}
                  </span>
                </div>
                {isWatchlistCollapsed && (
                  <button
                    type="button"
                    onClick={() => setIsWatchlistCollapsed(false)}
                    className="px-2.5 py-1 rounded-md bg-accent/15 border border-accent/30 text-accent text-[11px] font-medium hover:bg-accent/25 transition-colors cursor-pointer"
                  >
                    Browse Catalog / Copy Strategy
                  </button>
                )}
              </div>
              <ScannerRowsSkeleton
                rows={6}
                showHeader={false}
                label={isVariant ? `Scanning candidates for ${effectiveStrategyLabel}` : 'Synchronizing scanner results'}
              />
            </div>
          )
        ) : filteredResults.length === 0 ? (
          <div className="h-full min-h-[320px] flex flex-col items-center justify-center py-16 text-center animate-in fade-in zoom-in duration-300">
            <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center mb-3 text-dim/20">
              <Activity size={20} />
            </div>
            <div className="text-[12px] text-dim font-bold uppercase tracking-widest">No matching symbols</div>
            <p className="text-[10.5px] text-dim/60 mt-1">No candidates match current discovery criteria.</p>
            <button
              type="button"
              onClick={() => {
                setRangeFilter('all');
                setDiscoveryMode('all');
              }}
              className="mt-4 px-5 py-1.5 bg-accent/10 border border-accent/20 text-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent/20 transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filteredResults.map((opp, i) => (
            <ScannerRow
              key={opp.symbol}
              opp={opp}
              i={i}
              config={strategyConfig}
              isInPosition={activeTradeSymbols.has(opp.symbol)}
              isMonitored={monitoredSymbols.has(opp.symbol)}
              effectiveStrategyLabel={effectiveStrategyLabel}
            />
          ))
        )}
      </div>
    </div>
  )
})
