import React, { useEffect, useMemo, useState, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, Save, FolderOpen, Search, Settings2, ShieldCheck, Clock, CheckCircle2, Check, Zap, XCircle, Activity, LayoutGrid, Briefcase, TrendingUp, Target, ArrowRight, Copy, RefreshCw, ClipboardPaste, Download, Upload, Info, AlertTriangle, Lock, Sparkles, Award, MoreHorizontal, MoreVertical, SlidersHorizontal, ChevronDown, ChevronRight, Layers, Edit3 } from 'lucide-react'
import { cn, Btn, Tooltip, PaperBadge, DemoBadge, LiveBadge, CopyButton, VisuallyHidden, ModalAlertTicker, StatCard } from './ui/primitives'
import * as Switch from '@radix-ui/react-switch'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ConfirmationModal } from './ConfirmationModal'
import { CONFIG_LIMITS } from '../constants/configLimits'
import { settingsAPI, presetsAPI, sessionAPI, smartOptimizerAPI } from '../api/client'
import { useTradingStore } from '../store/trading'
import { isSignalLayer } from '../utils/signalIdentity.js'
import { resolveStrategyConfig } from '../utils/strategyConfig.js'
import { EntrySignalCard, ExitSignalCard } from './config/SignalCards'
import { ActiveSummaryPanel } from './config/ActiveSummaryPanel'
import { SmartStrategyNameControl, WatchlistScopeSelector } from './config/SmartNamingAndScope'
import { SymbolCatalogPicker } from './SymbolCatalogPicker'
import {
  STRATEGY_NAME_CHAR_LIMITS,
  generateSmartNameSuggestions,
  generateSmartStrategyName,
  getWatchlistScopeDescriptor,
  isGenericStrategyName,
  sanitizeStrategyLabel,
} from '../utils/smartStrategyNaming.js'

const fmtUSD = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const InfoHelpButton = React.memo(({ open, onToggle, label = 'details', className }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onToggle?.();
    }}
    aria-expanded={!!open}
    aria-label={`Toggle info for ${label}`}
    title={`Toggle info for ${label}`}
    className={cn(
      "p-1 rounded-md transition-colors shrink-0 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent",
      open ? "text-accent bg-accent/15" : "text-dim/70 hover:text-accent hover:bg-white/5",
      className
    )}
  >
    <Info size={12} />
  </button>
));
InfoHelpButton.displayName = 'InfoHelpButton';

const InfoDropdownBox = React.memo(({ children, className }) => (
  <div className={cn("px-2.5 py-2 bg-background/75 border border-border/60 rounded-lg text-[10px] text-dim font-medium leading-relaxed text-left animate-in fade-in duration-150", className)}>
    {children}
  </div>
));
InfoDropdownBox.displayName = 'InfoDropdownBox';

const CollapsibleHelpTitle = React.memo(({ title, helpText, icon: ItemIcon, titleClassName, className, badge }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("flex flex-col text-left min-w-0", className)}>
      <div className="flex items-center gap-1.5 min-w-0">
        {ItemIcon && <ItemIcon size={12} className="shrink-0" />}
        <span className={cn("text-xs font-bold text-text leading-snug break-words", titleClassName)}>{title}</span>
        {badge}
        {helpText && <InfoHelpButton open={open} onToggle={() => setOpen(v => !v)} label={typeof title === 'string' ? title : 'details'} />}
      </div>
      {open && helpText && (
        <InfoDropdownBox className="mt-1.5 max-w-xl">
          {helpText}
        </InfoDropdownBox>
      )}
    </div>
  );
});
CollapsibleHelpTitle.displayName = 'CollapsibleHelpTitle';

const CollapsibleSection = ({ id, icon: Icon, title, subtitle, children, isOpen, onToggle, hasError = false, errorCount = 0, onInteract }) => {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <section
      id={id}
      aria-invalid={hasError}
      onFocusCapture={onInteract}
      className={cn(
        "rounded-xl border shadow-sm overflow-hidden transition-all",
        hasError
          ? "border-red/60 bg-red/[0.03]"
          : "bg-background/60 border-border/80"
      )}
    >
      <div className="w-full flex items-center justify-between gap-2 p-2.5 hover:bg-white/[0.02] transition-colors group">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-invalid={hasError}
          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
        >
          <div className={cn(
            "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
            hasError ? "bg-red/15 text-red" : "bg-accent/10 text-accent"
          )}>
            <Icon size={14} />
          </div>
          <h3 className={cn("text-xs font-bold uppercase tracking-tight truncate", hasError && "text-red")}>{title}</h3>
          {hasError && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red tabular-nums shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" aria-hidden="true" />
              {errorCount > 0 ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}` : 'Error'}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {subtitle && (
            <InfoHelpButton
              open={showInfo}
              onToggle={() => setShowInfo(v => !v)}
              label={title}
            />
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-label={`Toggle ${title}`}
            aria-expanded={isOpen}
            className={cn(
              "w-6 h-6 rounded-md border flex items-center justify-center transition-all cursor-pointer",
              hasError
                ? "border-red/40 text-red hover:border-red"
                : "border-border/40 text-dim group-hover:border-accent/40 group-hover:text-accent",
              isOpen && (hasError ? "rotate-180 bg-red/10 border-red/50 text-red" : "rotate-180 bg-accent/5 border-accent/20 text-accent")
            )}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
      {subtitle && showInfo && (
        <div className="px-2.5 pb-2.5">
          <InfoDropdownBox>{subtitle}</InfoDropdownBox>
        </div>
      )}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <div className="p-3 pt-0 border-t border-border/5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

const SignalListWithCollapse = React.memo(({
  signals,
  activeSet,
  commonSet,
  renderCard
}) => {
  const [showAll, setShowAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('active'); // 'all' | 'active' | 'momentum' | 'trend' | 'breakout'

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active Only' },
    { id: 'momentum', label: 'Momentum / MACD' },
    { id: 'trend', label: 'Trend / EMA' },
    { id: 'breakout', label: 'Breakout / Vol' },
  ];

  const filteredSignals = useMemo(() => {
    return signals.filter(([key, label, desc]) => {
      const matchesSearch = !searchQuery || 
        label.toLowerCase().includes(searchQuery.toLowerCase()) || 
        desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
        key.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;

      if (categoryFilter === 'active') {
        return activeSet.has(key);
      }
      if (categoryFilter === 'momentum') {
        return key.includes('momentum') || key.includes('macd') || key.includes('engulfing');
      }
      if (categoryFilter === 'trend') {
        return key.includes('ema') || key.includes('ma') || key.includes('supertrend');
      }
      if (categoryFilter === 'breakout') {
        return key.includes('breakout') || key.includes('knife');
      }
      return true;
    });
  }, [signals, searchQuery, categoryFilter, activeSet]);

  const sorted = [...filteredSignals].sort((a, b) => {
    const aActive = activeSet.has(a[0]);
    const bActive = activeSet.has(b[0]);
    if (aActive !== bActive) return aActive ? -1 : 1;
    const aCommon = commonSet.has(a[0]);
    const bCommon = commonSet.has(b[0]);
    if (aCommon !== bCommon) return aCommon ? -1 : 1;
    return 0;
  });

  const isFiltering = Boolean(searchQuery.trim() || categoryFilter !== 'all');
  const visibleSignals = (showAll || isFiltering) ? sorted : sorted.filter(s => activeSet.has(s[0]) || commonSet.has(s[0]));
  const hiddenCount = sorted.length - visibleSignals.length;

  return (
    <div className="flex flex-col gap-3">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between bg-surface/40 p-2.5 rounded-xl border border-border/50">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim/50 pointer-events-none" />
          <input
            type="text"
            placeholder="Search signals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface border border-border/80 rounded-lg pl-7 pr-7 py-1 min-h-[32px] text-xs font-mono focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dim hover:text-accent p-0.5 rounded"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar shrink-0">
          {categories.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryFilter(c.id)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer",
                categoryFilter === c.id
                  ? "bg-accent/15 border border-accent/30 text-accent font-black"
                  : "bg-surface/50 border border-border/30 text-dim hover:text-text"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visibleSignals.map(signal => renderCard(signal))}
      </div>

      {visibleSignals.length === 0 && (
        <div className="p-6 text-center text-xs text-dim bg-surface/30 rounded-xl border border-dashed border-border/40 font-medium">
          No matching signals found for "{searchQuery || categoryFilter}"
        </div>
      )}

      {hiddenCount > 0 && !showAll && !isFiltering && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="py-2.5 px-3 bg-surface/60 hover:bg-surface border border-border/80 rounded-xl text-[10px] font-black uppercase tracking-wider text-dim hover:text-text transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
        >
          <span>Show {hiddenCount} more inactive signals</span>
          <ChevronDown size={12} />
        </button>
      )}
      {showAll && sorted.length > visibleSignals.length && !isFiltering && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="py-2.5 px-3 bg-surface/60 hover:bg-surface border border-border/80 rounded-xl text-[10px] font-black uppercase tracking-wider text-dim hover:text-text transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
        >
          <span>Show less</span>
          <ChevronDown size={12} className="rotate-180" />
        </button>
      )}
    </div>
  );
});
SignalListWithCollapse.displayName = 'SignalListWithCollapse';

const TAB_ERROR_MAP = {
  slippage_warning_threshold: 'risk',
  release_risk_est_pnl_min_usdt: 'risk',
  release_risk_est_pnl_min_rr: 'risk',
  scan_interval: 'scan',
  discovery_mode: 'scan',
  scan_lookback: 'scan',
  scan_mode: 'scan',
  trading_mode: 'env',
  risk_pct_per_trade: 'risk',
  martingale_multiplier: 'risk',
  martingale_reset_threshold_pct: 'risk',
  martingale_max_steps: 'risk',
  martingale_post_reset_behavior: 'risk',
  max_open_trades: 'risk',
  sl_distance_pct: 'risk',
  scanner_weights_momentum: 'scan',
  scanner_weights_volatility: 'scan',
  scanner_weights_trend: 'scan',
  scanner_signal_depth: 'scan',
};

const SECTION_ERROR_MAP = {
  scan_interval: 'scan_global',
  discovery_mode: 'scan_global',
  scan_lookback: 'scan_global',
  scan_mode: 'scan_global',
  scanner_weights_momentum: 'scan_global',
  scanner_weights_volatility: 'scan_global',
  scanner_weights_trend: 'scan_global',
  scanner_signal_depth: 'scan_global',
  slippage_warning_threshold: 'risk_guards',
  release_risk_est_pnl_min_usdt: 'risk_guards',
  release_risk_est_pnl_min_rr: 'risk_guards',
  risk_pct_per_trade: 'risk_guards',
  max_open_trades: 'risk_guards',
  martingale_multiplier: 'risk_martingale',
  martingale_reset_threshold_pct: 'risk_martingale',
  martingale_max_steps: 'risk_martingale',
  martingale_post_reset_behavior: 'risk_martingale',
  sl_distance_pct: 'risk_sl',
  trading_mode: 'adv_env',
};

const SECTION_LABELS = {
  scan_global: 'Scanner -> Global Scanner',
  risk_guards: 'Risk -> Capital Guards',
  risk_martingale: 'Risk -> Martingale Recovery',
  risk_sl: 'Risk -> Stop Loss Strategy',
  adv_env: 'Environment -> Execution Environment',
};

const TAB_SECTION_DEFAULTS = {
  scan: ['scan_general', 'scan_htf_cross', 'scan_global', 'scan_watchlist', 'scan_exclusion'],
  strategy: ['strategy_entry', 'strategy_params', 'strategy_exit', 'strategy_whipsaw', 'strategy_knife', 'strategy_timeframes'],
  risk: ['risk_guards', 'risk_martingale', 'risk_sl', 'risk_tp', 'risk_temporal'],
  env: ['adv_env', 'adv_capital'],
};

const SIGNALS = [
  ['momentum_pct', '% Momentum', 'Entry when momentum exceeds threshold.'],
  ['breakout_hl', 'Breakout H/L', 'Entry when price breaks highest high or lowest low.'],
  ['ema_price_cross', 'EMA Price Cross', 'Entry when price crosses EMA.'],
  ['ema_dual', 'EMA Dual', 'Entry when fast EMA is favorable to slow EMA.'],
  ['ema_dual_cross', 'EMA Dual Cross', 'Entry when fast EMA crosses slow EMA.'],
  ['ema_close', 'EMA Close', 'Entry when candle closes favorable side of EMA.'],
  ['ema_dual_close', 'EMA Dual Close', 'Entry when fast EMA is favorable to slow EMA at candle close.'],
  ['ma', 'MA Cross', 'Entry when price crosses simple Moving Average.'],
  ['engulfing', 'Engulfing', 'Entry on bullish or bearish engulfing pattern.'],
  ['macd_impulse', 'MACD Impulse', 'Phase 4 momentum pullback entry.'],
  ['macd_fade', 'MACD Fade', 'Phase 5 momentum exit when histogram weakens.'],
  ['macd_pbc', 'MACD PBC', 'Premium Pullback-to-Continuation pullback entry.'],
  ['supertrend', 'Supertrend', 'Entry & Exit trend follower based on ATR.'],
  ['knife_catch', 'Knife Catch', 'Velocity ROC & wick rejection burst entry.'],
  ['htf_breakout', 'HTF / Prev-Day Breakout', 'Trigger candle close vs higher-timeframe extreme (e.g. 1h close > prev 1d high).'],
  ['trigger_candle_exit', 'Trigger Candle Exit', 'Exit when candle closes beyond trigger candle low (long) or high (short), or ±N surrounding candles.'],
]

const getBaseSignalType = (signalType) => {
  if (SIGNALS.some(s => s[0] === signalType)) return signalType;
  const lastUnderscore = signalType.lastIndexOf('_');
  if (lastUnderscore > 0) {
    const potentialBase = signalType.substring(0, lastUnderscore);
    if (SIGNALS.some(s => s[0] === potentialBase)) {
      return potentialBase;
    }
  }
  return signalType;
};

const getSignalParamsSchema = (sigKey, baseType, isEntry = true, isExit = true) => {
  const suffix = sigKey === baseType ? '' : sigKey.substring(baseType.length); // e.g. '_2'
  const schema = [];

  const addParam = (baseParamKey, type, defaultValue, opts = null, attrs = {}, label = null) => {
    let paramKey = baseParamKey;
    if (suffix) {
      if (baseParamKey.startsWith(baseType)) {
        paramKey = sigKey + baseParamKey.substring(baseType.length); // e.g. 'supertrend_2_period'
      } else {
        paramKey = `${baseParamKey}${suffix}`; // e.g. 'ema_period_2'
      }
    }
    schema.push({
      key: `signal_params_${paramKey}`,
      baseParamKey,
      type,
      defaultValue,
      opts,
      attrs,
      label: label || baseParamKey.replace(/_/g, ' ').toUpperCase()
    });
  };

  if (baseType === 'ma') {
    addParam('ma_period', 'number', 20, null, { min: 1 }, 'MA Period');
  } else if (['ema', 'ema_cross', 'ema_price_cross', 'ema_close'].includes(baseType)) {
    addParam('ema_period', 'number', 12, null, { min: 1 }, 'EMA Period');
    if (isEntry || (!isEntry && !isExit)) addParam('entry_ema_period', 'number', 12, null, { min: 1 }, 'Entry Period');
    if (isExit || (!isEntry && !isExit)) addParam('exit_ema_period', 'number', 12, null, { min: 1 }, 'Exit Period');
  } else if (['ema_dual', 'ema_dual_cross', 'ema_dual_close'].includes(baseType)) {
    if (isEntry || (!isEntry && !isExit)) {
      addParam('entry_ema_fast', 'number', 9, null, { min: 1 }, 'Entry Fast');
      addParam('entry_ema_slow', 'number', 21, null, { min: 1 }, 'Entry Slow');
    }
    if (isExit || (!isEntry && !isExit)) {
      addParam('exit_ema_fast', 'number', 9, null, { min: 1 }, 'Exit Fast');
      addParam('exit_ema_slow', 'number', 21, null, { min: 1 }, 'Exit Slow');
    }
    addParam('ema_dual_macd_filter', 'boolean', false, null, {}, 'MACD Filter');
    addParam('macd_fast', 'number', 12, null, { min: 1 }, 'MACD Fast');
    addParam('macd_slow', 'number', 26, null, { min: 1 }, 'MACD Slow');
    addParam('macd_signal', 'number', 9, null, { min: 1 }, 'MACD Signal');
  } else if (baseType === 'engulfing') {
    addParam('engulfing_lookback', 'number', 1, null, { min: 1, max: 20 }, 'Search Window');
    addParam('engulfing_streak', 'number', 1, null, { min: 1, max: 10 }, 'Required Streak');
    addParam('engulfing_mode', 'text', 'range', [
      { value: 'range', label: 'Range (H/L)' },
      { value: 'body', label: 'Body (O/C)' },
      { value: 'strict', label: 'Strict (Both)' },
      { value: 'close_range', label: 'Close > H/L (Closed)' },
      { value: 'close_body', label: 'Close > Body (Closed)' },
      { value: 'soft_range', label: 'Partial Range (Close > H/L)' },
      { value: 'soft_body', label: 'Partial Body (Close > Body)' }
    ], {}, 'Engulfing Mode');
    addParam('engulfing_timing', 'text', 'is_opportunity', [
      { value: 'is_opportunity', label: 'Is Opportunity' },
      { value: 'after_opportunity', label: 'After Opportunity' }
    ], {}, 'Timing');
    addParam('engulfing_sequential', 'boolean', true, null, {}, 'Sequential');
    addParam('engulfing_volume_confirm', 'boolean', false, null, {}, 'Vol Confirmation');
    addParam('engulfing_max_expansion_pct', 'number', 0, null, { min: 0, max: 100, step: 0.5 }, 'Max Expansion Cap %');
  } else if (['macd_impulse', 'macd_fade', 'macd_pbc'].includes(baseType)) {
    addParam('macd_fast', 'number', 12, null, { min: 1 }, 'MACD Fast');
    addParam('macd_slow', 'number', 26, null, { min: 1 }, 'MACD Slow');
    addParam('macd_signal', 'number', 9, null, { min: 1 }, 'MACD Signal');
    if (sigKey.includes('impulse')) {
      addParam('macd_strict_expansion', 'boolean', true, null, {}, 'Strict Expanding');
      addParam('macd_impulse_max_entry_candle', 'number', 2, [
        { value: 1, label: 'First color-change candle only' },
        { value: 2, label: 'First or second color-change candle' },
      ], {}, 'Latest Entry Candle');
    }
    if (sigKey.includes('pbc')) {
      addParam('macd_pbc_trend_ema', 'number', 50, null, { min: 1 }, 'PBC Trend EMA');
      addParam('macd_pbc_lookback', 'number', 10, null, { min: 1 }, 'PBC Lookback');
      addParam('macd_pbc_max_continuation', 'number', 2, null, { min: 1, max: 50 }, 'Max Continuation Window');
    }
  } else if (baseType === 'supertrend') {
    addParam('supertrend_period', 'number', 10, null, { min: 1, max: 39 }, 'ATR Period');
    addParam('supertrend_multiplier', 'number', 3, null, { min: 0.1, step: 0.1 }, 'Multiplier');
    addParam('supertrend_mode', 'text', 'trend', [
      { value: 'trend', label: 'Trend State' },
      { value: 'crossover', label: 'Crossover Trigger' }
    ], {}, 'Supertrend Mode');
  } else if (['htf_breakout', 'prev_day_breakout'].includes(baseType)) {
    addParam('htf_breakout_ref_timeframe', 'text', '1d', [
      { value: '15m', label: '15m' },
      { value: '30m', label: '30m' },
      { value: '1h', label: '1h' },
      { value: '2h', label: '2h' },
      { value: '4h', label: '4h' },
      { value: '6h', label: '6h' },
      { value: '8h', label: '8h' },
      { value: '12h', label: '12h' },
      { value: '1d', label: '1d (Daily)' },
      { value: '3d', label: '3d' },
      { value: '1w', label: '1w (Weekly)' },
    ], {}, 'Ref Timeframe');
    addParam('htf_breakout_trigger_timeframe', 'text', '1h', [
      { value: 'default', label: 'Default (Scan TF)' },
      { value: '1m', label: '1m' },
      { value: '3m', label: '3m' },
      { value: '5m', label: '5m' },
      { value: '15m', label: '15m' },
      { value: '30m', label: '30m' },
      { value: '1h', label: '1h (Hourly)' },
      { value: '2h', label: '2h' },
      { value: '4h', label: '4h' },
    ], {}, 'Trigger Timeframe');
    addParam('htf_breakout_mode', 'text', 'close_break', [
      { value: 'close_break', label: 'Close > Extreme (1h Close)' },
      { value: 'closed_candle_confirm', label: 'Confirmed Closed Candle' },
      { value: 'wick_break', label: 'Live Wick / Touch' },
    ], {}, 'Breakout Mode');
    addParam('htf_breakout_reference_level', 'text', 'high_low', [
      { value: 'high_low', label: 'High / Low (Wicks)' },
      { value: 'open_close_body', label: 'Body (Open / Close)' },
      { value: 'close_only', label: 'Close Only' },
    ], {}, 'Reference Level');
    addParam('htf_breakout_lookback', 'number', 1, null, { min: 1, max: 30 }, 'Ref Lookback (Bars)');
    addParam('htf_breakout_buffer_pct', 'number', 0, null, { min: 0, max: 10, step: 0.05 }, 'Breakout Buffer %');
    addParam('htf_breakout_max_expansion_pct', 'number', 0, null, { min: 0, max: 100, step: 0.1 }, 'Max Expansion Cap (% of Ref)');
  }

  if (baseType === 'trigger_candle_exit') {
    addParam('trigger_candle_exit_n', 'number', 0, null, { min: 0, max: 20 }, 'Surrounding Candles (±N)');
    addParam('trigger_candle_exit_offset_mode', 'text', 'prev_and_next', [
      { value: 'prev_and_next', label: 'Prev & Next (±N)' },
      { value: 'prev_only', label: 'Previous Only (-N)' },
      { value: 'next_only', label: 'Next Only (+N)' },
    ], {}, 'Window Direction');
    addParam('trigger_candle_exit_mode', 'text', 'close', [
      { value: 'close', label: 'Candle Close' },
      { value: 'wick', label: 'Wick / Touch' },
    ], {}, 'Exit Evaluation');
    addParam('trigger_candle_exit_timeframe', 'text', 'default', [
      { value: 'default', label: 'Default (Trigger TF)' },
      { value: '1m', label: '1m' },
      { value: '3m', label: '3m' },
      { value: '5m', label: '5m' },
      { value: '15m', label: '15m' },
      { value: '30m', label: '30m' },
      { value: '1h', label: '1h (Hourly)' },
      { value: '2h', label: '2h' },
      { value: '4h', label: '4h' },
    ], {}, 'Exit Timeframe');
    addParam('trigger_candle_exit_buffer_pct', 'number', 0, null, { min: 0, max: 5, step: 0.05 }, 'Exit Buffer %');
  }

  return schema;
};

const TOOLTIPS = {
  ma_period: "The period of the simple moving average.",
  ema_period: "Global fallback period used if specific Entry/Exit EMA is not set.",
  engulfing_mode: "Body: Open/Close must engulf. Range: High/Low must engulf. Strict: Both must engulf. Close > H/L (Closed) waits for a closed confirmation candle. Partial Range/Body (Soft modes) evaluate off the live candle, which trades whipsaw protection for earlier execution.",
  engulfing_timing: "Is Opportunity: Signal fires on the momentum candle itself. After Opportunity: Signal must fire on the NEXT candle after momentum.",
  engulfing_lookback: "Maximum search window: Number of previous candles to scan for a reversal streak.",
  engulfing_streak: "Required streak: Number of consecutive reversal candles to find within the window.",
  engulfing_sequential: "If enabled, the reversal streak MUST be immediately adjacent to the signal candle. If disabled, finds the NEAREST streak within the window.",
  engulfing_volume_confirm: "When enabled, the engulfing candle MUST have higher volume than the engulfed candle.",
  engulfing_max_expansion_pct: "Maximum allowed expansion percentage beyond the lookback extreme/boundary (0 = disabled). If signal candle close extends beyond this cap %, entry is rejected to prevent overextended/late entries.",
  ema_dual_macd_filter: "When enabled, requires MACD histogram to be Red (bearish) when fast EMA crosses below slow EMA for SHORT, or Green (bullish) when fast EMA crosses above slow EMA for LONG.",
  macd_fast: "The fast EMA period for MACD line calculation.",
  macd_slow: "The slow EMA period for MACD line calculation.",
  macd_signal: "The signal line EMA period.",
  macd_strict_expansion: "When enabled, consecutive MACD histogram bars must strictly increase (bullish) or decrease (bearish) in magnitude.",
  macd_impulse_max_entry_candle: "Limits MACD Impulse entry to the first histogram color-change candle, or allows the first and second candles. Later same-color bars are rejected as late entries.",
  macd_pbc_trend_ema: "The EMA period used as the trend filter. Price must be above this for long entries, and below for short entries.",
  macd_pbc_lookback: "The number of previous candles scanned to find a valid histogram contraction pullback.",
  macd_pbc_max_continuation: "Maximum allowed continuation candle index after MACD histogram slope reversal (e.g. 1 limits entry strictly to the 1st candle of continuation, 2 allows 1st or 2nd candle).",
  supertrend_period: "The ATR lookback period for calculating band offsets.",
  supertrend_multiplier: "The multiplier value applied to the ATR.",
  supertrend_mode: "Trend State: Signal fires while trend matches side. Crossover Trigger: Signal fires only on the crossover candle.",
  htf_breakout_ref_timeframe: "The higher timeframe used to identify key price extremes (e.g. 1d for Previous Day High/Low).",
  htf_breakout_trigger_timeframe: "The lower timeframe evaluated for the breakout (e.g. 1h candle close).",
  htf_breakout_mode: "Close > Extreme: Fires when trigger candle close breaches the level. Confirmed Closed Candle: Strictly waits for the completed candle close. Live Wick: Triggers as soon as price wicks past.",
  htf_breakout_reference_level: "High/Low uses candle wicks. Body uses max/min of Open and Close. Close Only uses previous candle close.",
  htf_breakout_lookback: "Number of completed higher-timeframe candles to scan (1 = previous 1 day/bar; >1 scans the highest high/lowest low of past N bars).",
  htf_breakout_buffer_pct: "Required percentage above/below the HTF level before a breakout is confirmed, filtering false wicks.",
  htf_breakout_max_expansion_pct: "Maximum allowed price expansion beyond the breakout level expressed as a percentage of the HTF reference candle range (e.g. 10 = 10% of a 6% reference candle range, allowing +0.6% expansion). Entry is rejected if price expands further (0 = disabled).",
  trigger_candle_exit_n: "Number of candles adjacent to the trigger candle to include when computing the exit boundary. 0 uses only the trigger candle; N > 0 uses the lowest low (long) or highest high (short) within the ±N window.",
  trigger_candle_exit_offset_mode: "Window direction around trigger candle: Prev & Next (both sides), Previous Only (candles prior to entry), or Next Only (candles after entry).",
  trigger_candle_exit_mode: "Candle Close requires the bar to close beyond the level. Wick / Touch fires immediately upon touching or wicking past the boundary.",
  trigger_candle_exit_timeframe: "Timeframe used to monitor the trigger candle exit boundary (default uses the entry trigger timeframe, e.g. 1h).",
  trigger_candle_exit_buffer_pct: "Additional safety buffer percentage beyond the boundary before triggering exit."
};

const SectionHeader = React.memo(({ icon: Icon, title, subtitle, className }) => {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className={cn("flex flex-col gap-1.5 mb-2", className)}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-accent/10 flex items-center justify-center text-accent shrink-0">
          <Icon size={14} />
        </div>
        <div className="flex items-center gap-1.5 text-left min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-tight truncate">{title}</h3>
          {subtitle && (
            <InfoHelpButton
              open={showInfo}
              onToggle={() => setShowInfo(v => !v)}
              label={title}
            />
          )}
        </div>
      </div>
      {subtitle && showInfo && (
        <InfoDropdownBox>{subtitle}</InfoDropdownBox>
      )}
    </div>
  );
})
SectionHeader.displayName = 'SectionHeader'

const CollapsibleInfoCard = React.memo(({ icon: Icon = Info, title, children, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={cn("flex flex-col gap-1.5 my-3", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 bg-surface/50 hover:bg-surface border border-border/60 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer w-full justify-between shadow-xs text-accent"
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center text-accent">
            <Icon size={13} />
          </div>
          <span>{title}</span>
        </div>
        <div className="flex items-center gap-1.5 text-dim font-bold">
          <span>{isOpen ? 'Hide Guide' : 'View Guide'}</span>
          <ChevronDown size={14} className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
        </div>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3.5 bg-background/60 border border-border/50 rounded-xl flex flex-col gap-3 text-left animate-in fade-in duration-200">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
CollapsibleInfoCard.displayName = 'CollapsibleInfoCard';

const Toggle = React.memo(({ value, onChange, label, color = "bg-accent" }) => {
  const isChecked = value === true || value === 'true' || value === 1 || value === '1';
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <Switch.Root checked={isChecked} onCheckedChange={onChange} className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-offset-1 focus-visible:ring-offset-surface", isChecked ? color : "bg-border")}>
        <Switch.Thumb className={cn("pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform", isChecked ? "translate-x-5" : "translate-x-0.5")} />
      </Switch.Root>
      {label && <span className={cn("text-xs font-bold transition-colors", isChecked ? "text-text" : "text-dim group-hover:text-dim/80")}>{label}</span>}
    </label>
  );
})
Toggle.displayName = 'Toggle'

const Chip = React.forwardRef(({ active, onClick, children, activeClass = "border-accent text-accent bg-accent/10", className, ...props }, ref) => (
  <button ref={ref} type="button" onClick={onClick} aria-pressed={active} className={cn("px-3 py-1.5 rounded-md border text-[11px] font-bold tracking-wider transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none", active ? activeClass : "border-border text-dim hover:border-dim/50", className)} {...props}>{children}</button>
))
Chip.displayName = 'Chip'

const ConfigField = React.memo(({ label, id, name, type, value, onChange, error, warning, opts, attrs, helpText }) => {
  // BOLT-PERF: Local-Sync pattern with debounced idle commit + iOS blur safety.
  // Maintains instant local state while typing and commits safely on pause, blur, or Enter.
  const [localValue, setLocalValue] = useState(value ?? '');
  const [showHelp, setShowHelp] = useState(false);
  const isFocusedRef = useRef(false);
  const commitTimerRef = useRef(null);

  const { tooltip: attrTooltip, helpText: attrHelpText, ...cleanAttrs } = attrs || {};
  const resolvedHelp = helpText || attrHelpText || attrTooltip || null;

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalValue(value ?? '');
    }
  }, [value]);

  useEffect(() => () => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
  }, []);

  const commit = React.useCallback((rawVal) => {
    const candidate = rawVal !== undefined ? rawVal : localValue;
    const val = type === 'number' ? Number(candidate) : candidate;
    if (type === 'number' && (candidate === '' || Number.isNaN(val))) return;
    if (val !== value) {
      onChange(name, val);
    }
  }, [localValue, name, onChange, type, value]);

  const handleChange = (e) => {
    const nextRaw = e.target.value;
    setLocalValue(nextRaw);
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    // Avoid overwriting mid-decimal typing like "2." or "-"; commit cleanly once settled
    const isPartialNumeric = type === 'number' && (nextRaw === '' || /[.\-]$/.test(nextRaw));
    if (!isPartialNumeric) {
      commitTimerRef.current = setTimeout(() => {
        commit(nextRaw);
      }, 280);
    }
  };

  const handleSelectChange = (e) => {
    const val = type === 'number' ? Number(e.target.value) : e.target.value;
    onChange(name, val);
  };

  const resolvedInputMode = attrs?.inputMode ?? (type === 'number' ? 'decimal' : undefined);
  const resolvedEnterKeyHint = attrs?.enterKeyHint ?? (type === 'number' || type === 'text' ? 'next' : undefined);

  return (
    <div className="flex flex-col gap-1 group/field min-w-0">
      <div className="flex justify-between items-center gap-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <label htmlFor={id} className="text-[10px] sm:text-[9px] text-dim group-hover/field:text-accent font-black tracking-widest uppercase transition-colors truncate">{label}</label>
          {resolvedHelp && (
            <InfoHelpButton
              open={showHelp}
              onToggle={() => setShowHelp(v => !v)}
              label={label}
              className="p-0.5"
            />
          )}
        </div>
        {error && <span role="alert" className="text-[9px] text-red font-bold uppercase shrink-0">{error}</span>}
        {warning && !error && <span role="alert" className="text-[9px] text-amber font-bold uppercase shrink-0">{warning}</span>}
      </div>
      {Array.isArray(opts) ? (
        <select
          id={id}
          value={localValue ?? ''}
          {...cleanAttrs}
          onChange={handleSelectChange}
          className="bg-surface/90 border border-border/80 rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-bold text-text focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none appearance-none transition-all cursor-pointer hover:border-border-hover w-full"
        >
          {opts.map((o) => {
            const val = typeof o === 'string' ? o : o?.value;
            const lbl = typeof o === 'string' ? o : o?.label;
            return <option key={val} value={val}>{lbl}</option>;
          })}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          inputMode={resolvedInputMode}
          enterKeyHint={resolvedEnterKeyHint}
          autoCapitalize={type === 'text' && cleanAttrs?.autoCapitalize === undefined ? 'none' : cleanAttrs?.autoCapitalize}
          autoCorrect={type === 'text' && cleanAttrs?.autoCorrect === undefined ? 'off' : cleanAttrs?.autoCorrect}
          value={localValue ?? ''}
          {...cleanAttrs}
          onFocus={(e) => {
            isFocusedRef.current = true;
            cleanAttrs?.onFocus?.(e);
          }}
          onChange={handleChange}
          onBlur={(e) => {
            isFocusedRef.current = false;
            if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
            commit(e.target.value);
            cleanAttrs?.onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
              commit(e.currentTarget.value);
              if (typeof window !== 'undefined' && window.innerWidth < 768) {
                e.currentTarget.blur();
              }
            }
            cleanAttrs?.onKeyDown?.(e);
          }}
          className="bg-surface/90 border border-border/80 rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold text-text focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none transition-all hover:border-border-hover w-full tabular-nums"
        />
      )}
      {showHelp && resolvedHelp && (
        <InfoDropdownBox className="mt-0.5">{resolvedHelp}</InfoDropdownBox>
      )}
    </div>
  );
})
ConfigField.displayName = 'ConfigField'




const ManualMonitorInput = React.memo(({ onAdd }) => {
  const [value, setValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const scannerResults = useTradingStore(state => state.scannerResults || []);
  const inputRef = useRef(null);

  const options = useMemo(() => {
    const safeResults = Array.isArray(scannerResults) ? scannerResults : [];
    if (!value) return safeResults.slice(0, 5);
    return safeResults
      .filter(r => r && r.symbol && r.symbol.toLowerCase().includes(value.toLowerCase()))
      .slice(0, 5);
  }, [value, scannerResults]);

  const handleAdd = (symbol) => {
    const val = symbol || value;
    if (val.trim()) {
      onAdd(val.trim().toUpperCase());
      setValue('');
      setIsOpen(false);
    }
  };

  return (
    <div className="flex gap-2 relative">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          placeholder="BTCUSDT"
          value={value}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => { setValue(e.target.value.toUpperCase()); setIsOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
            if (e.key === 'Escape') {
              setValue('');
              setIsOpen(false);
            }
          }}
          className="w-full bg-surface border border-border rounded-lg pl-3 pr-7 py-1 min-h-[32px] text-xs font-mono focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none hover:border-border-hover transition-colors"
        />
        {value && (
          <Tooltip content="Clear Input">
            <button
              type="button"
              onClick={() => { setValue(''); setIsOpen(false); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md p-0.5 transition-colors"
              aria-label="Clear Input"
            >
              <XCircle size={13} />
            </button>
          </Tooltip>
        )}

        <AnimatePresence>
          {isOpen && options.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-full left-0 right-0 mt-1.5 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            >
              {options.map(o => (
                <button
                  key={o.symbol}
                  type="button"
                  onClick={() => handleAdd(o.symbol)}
                  className="w-full px-3 py-2 text-left text-xs font-mono hover:bg-white/5 transition-colors border-b border-border/50 last:border-0"
                >
                  {o.symbol}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Btn variant="primary" onClick={() => handleAdd()} className="aspect-square p-0 w-8 h-8 flex items-center justify-center shrink-0"><Plus size={14} /></Btn>
      {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}
    </div>
  );
})
ManualMonitorInput.displayName = 'ManualMonitorInput'

const SavePresetInput = React.memo(({ onSave, isSaving, success, defaultName }) => {
  const [name, setName] = useState(defaultName || '');
  const [isUserEdited, setIsUserEdited] = useState(false);
  const inputId = useId();
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isUserEdited && defaultName) {
      setName(defaultName);
    }
  }, [defaultName, isUserEdited]);

  return (
    <div className="flex gap-2">
      <VisuallyHidden>
        <label htmlFor={inputId}>Preset Name</label>
      </VisuallyHidden>
      <div className="relative flex-1 group">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          placeholder="Preset name (e.g. Scalp High Vol)"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setIsUserEdited(true);
          }}
          className="w-full bg-surface border border-border rounded-lg pl-3 pr-7 py-1 min-h-[32px] text-xs font-mono font-bold focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        />
        {name && (
          <Tooltip content="Clear Preset Name">
            <button
              type="button"
              onClick={() => {
                setName('');
                setIsUserEdited(true);
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md p-0.5 transition-colors"
              aria-label="Clear Preset Name"
            >
              <XCircle size={13} />
            </button>
          </Tooltip>
        )}
      </div>
      <Tooltip
        content={
          isSaving
            ? "Saving configuration as preset..."
            : success
            ? "Preset saved successfully!"
            : !name.trim()
            ? "Enter a name to save this configuration as a preset"
            : `Save current configuration as preset: "${name.trim()}"`
        }
      >
        <div className="flex shrink-0">
          <Btn
            variant="primary"
            onClick={() => { if (name.trim()) { onSave(name); } }}
            disabled={isSaving || !name.trim()}
            loading={isSaving}
            className="aspect-square p-0 w-8 h-8 flex items-center justify-center"
            aria-label={success ? "Preset saved successfully" : "Save current configuration as preset"}
          >
            {success ? <CheckCircle2 size={14} /> : <Save size={14} />}
          </Btn>
        </div>
      </Tooltip>
    </div>
  );
})
SavePresetInput.displayName = 'SavePresetInput'

const WatchlistDropdownInput = React.memo(({
  value = [],
  onChange,
  currentStrategyLabel = null,
  strategiesOverride = null,
  maxLimit = 0,
}) => {
  const scannerResults = useTradingStore(state => state.scannerResults || []);
  const availableSymbols = useTradingStore(state => state.availableSymbols || []);

  const metaMap = useMemo(() => {
    const map = new Map();
    for (const s of availableSymbols) {
      if (s?.symbol) map.set(s.symbol, s);
    }
    for (const r of scannerResults) {
      if (r?.symbol) map.set(r.symbol, { ...(map.get(r.symbol) || {}), ...r });
    }
    return map;
  }, [availableSymbols, scannerResults]);

  const safeValue = Array.isArray(value) ? value : [];

  const handleAdd = (symbol) => {
    const clean = String(symbol || '').trim().toUpperCase();
    if (!clean) return;
    const finalSym = clean.endsWith('USDT') ? clean : `${clean}USDT`;
    if (safeValue.includes(finalSym)) return;
    if (maxLimit > 0 && safeValue.length >= maxLimit) {
      onChange([...safeValue.slice(0, Math.max(0, maxLimit - 1)), finalSym]);
    } else {
      onChange([...safeValue, finalSym]);
    }
  };

  const handleAddBulk = (symbolsList) => {
    const incoming = (symbolsList || [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter((s) => s && !safeValue.includes(s));
    if (incoming.length === 0) return;
    let next = [...safeValue, ...incoming];
    if (maxLimit > 0 && next.length > maxLimit) {
      next = next.slice(0, maxLimit);
    }
    onChange(next);
  };

  const handleRemove = (symbol) => {
    onChange(safeValue.filter((s) => s !== symbol));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Pinned Symbols Strip */}
      <div className="flex flex-wrap gap-1.5">
        {safeValue.length === 0 ? (
          <div className="p-2.5 border border-dashed border-border/50 rounded-lg w-full flex items-center justify-center">
            <CollapsibleHelpTitle
              title="No static symbols pinned"
              titleClassName="text-xs text-muted font-medium"
              helpText="Global discovery is used when no symbols are pinned to the static watchlist."
            />
          </div>
        ) : (
          safeValue.map((sym) => {
            const meta = metaMap.get(sym);
            const pct = meta?.pct;
            const hasLivePct = meta?.price > 0 && pct !== undefined && Number.isFinite(Number(pct));
            const isPos = Number(pct || 0) >= 0;
            return (
              <div
                key={sym}
                className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-accent/10 border border-accent/35 text-xs font-mono text-text"
              >
                <span className="font-semibold text-accent">{sym.replace(/USDT$/, '')}</span>
                {meta?.assetClass === 'tradfi' && (
                  <span className="text-[9px] text-amber">TradFi</span>
                )}
                {hasLivePct && (
                  <span className={cn('text-[10px] tabular-nums', isPos ? 'text-green' : 'text-red')}>
                    {isPos ? '+' : ''}{Number(pct).toFixed(1)}%
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${sym}`}
                  onClick={() => handleRemove(sym)}
                  className="p-0.5 rounded text-muted hover:text-red transition-colors cursor-pointer"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Unified Market Catalog & Copy-from-Strategy Picker */}
      <SymbolCatalogPicker
        selectedSymbols={safeValue}
        onAddSymbol={handleAdd}
        onAddBulkSymbols={handleAddBulk}
        onRemoveSymbol={handleRemove}
        currentStrategyLabel={currentStrategyLabel}
        strategiesOverride={strategiesOverride}
        maxLimit={maxLimit}
        defaultExpanded={true}
      />
    </div>
  );
});
WatchlistDropdownInput.displayName = 'WatchlistDropdownInput';

const ListInput = React.memo(({ id, value, onChange, placeholder }) => {
  const getStr = (val) => {
    if (Array.isArray(val)) return val.join(', ');
    if (typeof val === 'string') return val;
    return '';
  };
  const parseTokens = (str) => String(str || '').split(',').map(s => s.trim()).filter(Boolean);
  const [localValue, setLocalValue] = useState(() => getStr(value));

  // Update local value when external value tokens differ (e.g. on preset load) without wiping trailing commas while typing
  useEffect(() => {
    const extTokens = Array.isArray(value) ? value.map(s => String(s).trim()).filter(Boolean) : parseTokens(value);
    const localTokens = parseTokens(localValue);
    const same = extTokens.length === localTokens.length && extTokens.every((t, i) => t === localTokens[i]);
    if (!same) {
      setLocalValue(getStr(value));
    }
  }, [value]);

  const handleChange = (e) => {
    const nextVal = e.target.value;
    setLocalValue(nextVal);
    const extTokens = Array.isArray(value) ? value.map(s => String(s).trim()).filter(Boolean) : parseTokens(value);
    const nextTokens = parseTokens(nextVal);
    const same = extTokens.length === nextTokens.length && extTokens.every((t, i) => t === nextTokens[i]);
    if (!same) {
      onChange(nextTokens);
    }
  };

  const handleBlur = () => {
    const list = parseTokens(localValue);
    setLocalValue(list.join(', '));
    onChange(list);
  };

  return (
    <input
      id={id}
      type="text"
      placeholder={placeholder}
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={(e) => { if (e.key === 'Enter') handleBlur(); }}
      className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none hover:border-border-hover transition-colors"
    />
  );
})
ListInput.displayName = 'ListInput'

const SectionTab = React.memo(({ id, label, icon: Icon, active, onClick, hasError }) => (
  <Chip
    active={active}
    onClick={() => onClick(id)}
    className={cn(
      "flex items-center justify-center gap-1 relative transition-all duration-200 min-h-[26px] sm:min-h-[30px] px-1.5 sm:px-3 py-0.5 rounded-lg text-[10px] sm:text-xs font-bold tracking-tight sm:tracking-wider min-w-0 w-full sm:w-auto sm:shrink-0 snap-center cursor-pointer",
      active
        ? "bg-accent text-white font-black border-accent shadow-[0_2px_10px_rgba(var(--accent-rgb),0.3)]"
        : "border-border/70 bg-background/40 text-dim hover:border-dim/50 hover:text-text",
      hasError && !active && "border-red/50 text-red/90"
    )}
    role="tab"
    aria-selected={active}
    aria-invalid={hasError}
    aria-controls={`config-panel-${id}`}
    id={`config-tab-${id}`}
    tabIndex={active ? 0 : -1}
  >
    <Icon size={11} className={cn("hidden min-[420px]:inline sm:inline shrink-0", active ? "text-white" : "text-dim", hasError && !active && "text-red")} />
    <span className="truncate whitespace-nowrap">{label}</span>
    {hasError && !active && (
      <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse shrink-0" aria-hidden="true" />
    )}
  </Chip>
))
SectionTab.displayName = 'SectionTab'

const SectionTabs = React.memo(({ section, onSectionChange, errors }) => {
  const listRef = useRef(null);

  const primaryTabs = useMemo(() => [
    { id: 'summary', label: 'Active', icon: SlidersHorizontal },
    { id: 'scan', label: 'Scanner', icon: Search },
    { id: 'strategy', label: 'Strategy', icon: Zap },
    { id: 'risk', label: 'Risk', icon: ShieldCheck },
    { id: 'presets', label: 'Presets', icon: FolderOpen },
  ], []);

  const overflowTabs = useMemo(() => [
    { id: 'env', label: 'Env', menuLabel: 'Environment', icon: Briefcase },
    { id: 'smart', label: 'Smart', menuLabel: 'Smart Auto-Discovery', icon: Sparkles },
    { id: 'backtest', label: 'Backtest', menuLabel: 'Backtest', icon: TrendingUp }
  ], []);

  const allTabs = useMemo(() => [...primaryTabs, ...overflowTabs], [primaryTabs, overflowTabs]);

  const tabHasError = React.useCallback((tabId) => {
    return Object.keys(errors).some(key => TAB_ERROR_MAP[key] === tabId);
  }, [errors]);

  const activeOverflowTab = useMemo(
    () => overflowTabs.find(t => t.id === section) || null,
    [overflowTabs, section]
  );

  const overflowHasError = useMemo(
    () => overflowTabs.some(t => tabHasError(t.id)),
    [overflowTabs, tabHasError]
  );

  // Keep active tab centered horizontally inside the tab strip without triggering vertical ancestor scroll
  useEffect(() => {
    const container = listRef.current;
    const el = document.getElementById(`config-tab-${section}`);
    if (container && el) {
      try {
        const targetLeft = el.offsetLeft - (container.clientWidth - el.offsetWidth) / 2;
        if (typeof container.scrollTo === 'function') {
          container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        } else {
          container.scrollLeft = Math.max(0, targetLeft);
        }
      } catch {
        // Ignore in jsdom/non-DOM environments
      }
    }
  }, [section]);

  const handleKeyDownNav = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const currentIndex = allTabs.findIndex(t => t.id === section);
      const nextIndex = e.key === 'ArrowRight'
        ? (currentIndex + 1) % allTabs.length
        : (currentIndex - 1 + allTabs.length) % allTabs.length;
      onSectionChange(allTabs[nextIndex].id);

      setTimeout(() => {
        const nextTab = document.getElementById(`config-tab-${allTabs[nextIndex].id}`);
        nextTab?.focus();
      }, 0);
    }
  };

  const TriggerIcon = activeOverflowTab ? activeOverflowTab.icon : MoreHorizontal;

  return (
    <div
      className="flex items-center justify-between gap-1 sm:gap-1.5 px-1.5 sm:px-3.5 py-1 relative z-40 w-full min-w-0"
      data-vaul-no-drag
      role="tablist"
      aria-label="Configuration sections"
      onKeyDown={handleKeyDownNav}
      tabIndex={-1}
    >
      <div
        ref={listRef}
        className="grid grid-cols-5 sm:flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar snap-x snap-proximity outline-none flex-1 min-w-0"
      >
        {primaryTabs.map((tab) => (
          <SectionTab
            key={tab.id}
            {...tab}
            active={section === tab.id}
            onClick={onSectionChange}
            hasError={tabHasError(tab.id)}
          />
        ))}
      </div>

      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            id={activeOverflowTab ? `config-tab-${activeOverflowTab.id}` : 'config-tab-more'}
            aria-label="More configuration sections"
            aria-invalid={overflowHasError}
            className={cn(
              "flex items-center justify-center gap-0.5 sm:gap-1 relative transition-all duration-200 min-h-[26px] sm:min-h-[30px] px-1.5 sm:px-2.5 py-0.5 rounded-lg text-[10px] sm:text-xs font-bold shrink-0 border cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
              activeOverflowTab
                ? "bg-accent text-white font-black border-accent shadow-[0_2px_10px_rgba(var(--accent-rgb),0.3)]"
                : "border-border/70 bg-background/40 text-dim hover:border-dim/50 hover:text-text",
              overflowHasError && !activeOverflowTab && "border-red/50 text-red/90"
            )}
          >
            <TriggerIcon size={12} className={cn("shrink-0", activeOverflowTab ? "text-white" : "text-dim", overflowHasError && !activeOverflowTab && "text-red")} />
            <span className={cn("whitespace-nowrap", !activeOverflowTab && "hidden sm:inline")}>
              {activeOverflowTab ? activeOverflowTab.label : 'More'}
            </span>
            <ChevronDown size={10} className={cn("shrink-0 opacity-75 hidden sm:inline", activeOverflowTab ? "text-white" : "text-dim")} />
            {overflowHasError && !activeOverflowTab && (
              <span className="w-1.5 h-1.5 rounded-full bg-red animate-pulse shrink-0" aria-hidden="true" />
            )}
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            data-vaul-no-drag
            className="z-[200] min-w-[190px] rounded-xl border border-border/80 bg-surface/95 backdrop-blur-md p-1 shadow-xl text-text animate-in fade-in duration-150"
          >
            {overflowTabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = section === tab.id;
              const hasErr = tabHasError(tab.id);
              return (
                <DropdownMenu.Item
                  key={tab.id}
                  id={`config-menu-${tab.id}`}
                  onSelect={() => onSectionChange(tab.id)}
                  className={cn(
                    "flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold outline-none cursor-pointer transition-colors select-none",
                    isSelected
                      ? "bg-accent/15 text-accent font-bold"
                      : "text-text/90 hover:bg-white/5 focus:bg-white/5"
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon size={13} className={cn("shrink-0", isSelected ? "text-accent" : "text-dim", hasErr && !isSelected && "text-red")} />
                    <span className="truncate">{tab.menuLabel}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {hasErr && <span className="w-1.5 h-1.5 rounded-full bg-red" aria-hidden="true" />}
                    {isSelected && <Check size={12} className="text-accent" />}
                  </span>
                </DropdownMenu.Item>
              );
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
})
SectionTabs.displayName = 'SectionTabs';

const SmartAutoDiscoveryPanel = React.memo(({ cfg, buildConfigToSave, onLoadRecommendation, savePreset, onOpenSaveAsNew }) => {
  const [iterations, setIterations] = useState(15);
  const [days, setDays] = useState(14);
  const [startingBalance, setStartingBalance] = useState(10000);
  const [symbolsText, setSymbolsText] = useState('BTCUSDT, ETHUSDT, SOLUSDT');
  const [isRunning, setIsRunning] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [error, setError] = useState(null);
  const [showHeaderInfo, setShowHeaderInfo] = useState(false);
  const [showEmptyInfo, setShowEmptyInfo] = useState(false);
  const addAlert = useTradingStore(state => state.addAlert);

  useEffect(() => {
    const fetchRecs = async () => {
      try {
        const res = await smartOptimizerAPI.getRecommendations();
        if (res?.data?.recommendations) {
          setRecommendations(res.data.recommendations);
        }
      } catch (err) {
        console.warn('[SmartOptimizer] Failed to fetch top recommendations:', err);
      }
    };
    fetchRecs();
  }, []);

  const handleRunOptimization = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const parsedSymbols = symbolsText.split(',').map(s => s.trim().toUpperCase()).filter(s => s.endsWith('USDT'));
      const sanitizedBaseConfig = typeof buildConfigToSave === 'function' ? buildConfigToSave() : cfg;
      const res = await smartOptimizerAPI.run({
        iterations: Number(iterations),
        days: Number(days),
        startingBalance: Number(startingBalance),
        symbols: parsedSymbols.length > 0 ? parsedSymbols : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
        baseConfig: sanitizedBaseConfig,
        topCount: 5,
      });

      if (res?.data?.topRecommendations) {
        setRecommendations(res.data.topRecommendations);
        if (addAlert) {
          addAlert({
            level: 'success',
            title: 'Smart Optimization Complete',
            message: `Evaluated ${res.data.testedCount} randomized strategy candidates in ${res.data.executionTimeMs}ms! Top strategy recommendations updated in memory.`,
          });
        }
      }
    } catch (err) {
      console.error('[SmartOptimizer] Run error:', err);
      const msg = err.response?.data?.message || err.message || 'Smart optimization failed.';
      setError(msg);
      if (addAlert) {
        addAlert({ level: 'error', title: 'Optimizer Error', message: msg });
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleClear = async () => {
    try {
      await smartOptimizerAPI.clearRecommendations();
      setRecommendations([]);
      if (addAlert) {
        addAlert({ level: 'info', title: 'Recommendations Cleared', message: 'In-memory top strategy recommendations cleared.' });
      }
    } catch (err) {
      console.error('[SmartOptimizer] Clear error:', err);
    }
  };

  return (
    <div
      id="config-panel-smart"
      role="tabpanel"
      aria-labelledby="config-tab-smart"
      className="flex flex-col gap-4 lg:gap-6 animate-in fade-in duration-300"
    >
      <div className="p-4 bg-background/50 border border-border/60 rounded-2xl flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent shrink-0">
              <Sparkles size={16} />
            </div>
            <h3 className="text-xs font-black uppercase tracking-tight truncate">Smart Auto-Optimizer</h3>
            <InfoHelpButton
              open={showHeaderInfo}
              onToggle={() => setShowHeaderInfo(v => !v)}
              label="Smart Auto-Optimizer"
            />
          </div>
          <Btn
            variant="primary"
            onClick={handleRunOptimization}
            loading={isRunning}
            className="px-4 py-2 text-xs font-bold bg-accent text-white hover:bg-accent/90 shadow-[0_0_20px_rgba(91,111,255,0.2)] shrink-0"
          >
            {isRunning ? 'Testing...' : '⚡ Run Optimizer'}
          </Btn>
        </div>
        {showHeaderInfo && (
          <InfoDropdownBox>
            Generates & paper-tests randomized strategy variations to find top performers.
          </InfoDropdownBox>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2 border-t border-border/40">
          <div>
            <label htmlFor="smart-iterations" className="text-[9px] text-dim font-black uppercase tracking-widest block mb-1">Randomized Variations</label>
              <select
              id="smart-iterations"
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
              className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold text-text outline-none focus:border-accent cursor-pointer"
            >
              <option value={10}>10 Variations (Fast)</option>
              <option value={15}>15 Variations (Recommended)</option>
              <option value={25}>25 Variations (Thorough)</option>
              <option value={50}>50 Variations (Deep Search)</option>
            </select>
          </div>

          <div>
            <label htmlFor="smart-days" className="text-[9px] text-dim font-black uppercase tracking-widest block mb-1">Testing Period (Days)</label>
            <select
              id="smart-days"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold text-text outline-none focus:border-accent cursor-pointer"
            >
              <option value={7}>7 Days (1 Week)</option>
              <option value={14}>14 Days (2 Weeks)</option>
              <option value={30}>30 Days (1 Month)</option>
              <option value={60}>60 Days (2 Months)</option>
            </select>
          </div>

          <div>
            <label htmlFor="smart-balance" className="text-[9px] text-dim font-black uppercase tracking-widest block mb-1">Paper Capital ($)</label>
            <input
              id="smart-balance"
              type="number"
              inputMode="decimal"
              min={10}
              step={1000}
              value={startingBalance}
              onChange={(e) => setStartingBalance(Number(e.target.value))}
              className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold text-text outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="smart-symbols" className="text-[9px] text-dim font-black uppercase tracking-widest block mb-1">Target Symbols</label>
            <input
              id="smart-symbols"
              type="text"
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="BTCUSDT, ETHUSDT..."
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold text-text outline-none focus:border-accent"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red/10 border border-red/30 rounded-xl text-xs text-red font-semibold flex items-center gap-2">
            <XCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Leaderboard of Top In-Memory Recommendations */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Award size={14} className="text-accent" />
            <span className="text-xs font-black uppercase tracking-widest text-text">Top Recommended Strategies (In-Memory Leaderboard)</span>
            <span className="text-[9px] text-dim font-bold font-mono">({recommendations.length})</span>
          </div>
          {recommendations.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[9px] font-black uppercase tracking-widest text-red/70 hover:text-red transition-colors flex items-center gap-1"
            >
              <Trash2 size={11} /> Clear Leaderboard
            </button>
          )}
        </div>

        {recommendations.length === 0 ? (
          <div className="p-6 border border-dashed border-border/60 rounded-2xl text-center flex flex-col items-center gap-2">
            <Sparkles size={24} className="text-dim/30 animate-pulse" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-dim uppercase">No Recommendations Yet</span>
              <InfoHelpButton
                open={showEmptyInfo}
                onToggle={() => setShowEmptyInfo(v => !v)}
                label="Empty Recommendations"
              />
            </div>
            {showEmptyInfo && (
              <InfoDropdownBox className="max-w-sm">
                Click Run Optimizer above to paper-test randomized setting candidates and discover top strategy configurations.
              </InfoDropdownBox>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {recommendations.map((rec) => {
              const isTopRank = rec.rank === 1;
              return (
                <div
                  key={rec.id}
                  className={cn(
                    "p-4 rounded-2xl border transition-all flex flex-col gap-3 bg-background/60",
                    isTopRank
                      ? "border-accent/50 shadow-[0_0_20px_rgba(91,111,255,0.1)] bg-accent/[0.02]"
                      : "border-border/60 hover:border-border-hover"
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/30 pb-2">
                    <div className="flex items-center gap-2.5">
                      <span className={cn(
                        "w-6 h-6 rounded-lg text-xs font-black flex items-center justify-center font-mono",
                        isTopRank ? "bg-accent text-white" : "bg-surface border border-border text-dim"
                      )}>
                        #{rec.rank}
                      </span>
                      <div>
                        <h4 className="text-xs font-bold font-mono text-text flex items-center gap-2">
                          {rec.name}
                          {isTopRank && (
                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-black uppercase">
                              ★ Top Recommendation
                            </span>
                          )}
                        </h4>
                        <p className="text-[9px] text-dim/80 font-mono">
                          Score: <strong className="text-accent">{rec.score}</strong> · Timeframe: <strong className="text-text">{rec.config.scan_interval}</strong> · SL: <strong className="text-text">{rec.config.sl_distance_pct}%</strong> ({rec.config.sl_type}) · TP: <strong className="text-text">{rec.config.tp_ratio}R</strong>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Btn
                        variant="primary"
                        onClick={() => onLoadRecommendation(rec.config)}
                        className="px-3 py-1.5 text-[10px] font-bold bg-accent text-white hover:bg-accent/90 flex items-center gap-1"
                      >
                        <Zap size={12} /> Apply Settings
                      </Btn>

                      <Btn
                        variant="ghost"
                        onClick={() => {
                          if (onOpenSaveAsNew) {
                            onOpenSaveAsNew({ name: rec.name, config: rec.config });
                          } else {
                            savePreset(rec.name);
                          }
                        }}
                        className="px-3 py-1.5 text-[10px] font-bold border border-border hover:border-accent/40 text-dim hover:text-text flex items-center gap-1"
                      >
                        <Save size={12} /> Save as Preset
                      </Btn>
                    </div>
                  </div>

                  {/* Metrics Badges Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 pt-1">
                    <div className="bg-surface/50 p-2 rounded-xl border border-border/30 text-center">
                      <span className="text-[8px] text-dim font-black uppercase block tracking-wider">Win Rate</span>
                      <span className="text-xs font-bold font-mono text-accent">{rec.metrics.winRate}%</span>
                    </div>

                    <div className="bg-surface/50 p-2 rounded-xl border border-border/30 text-center">
                      <span className="text-[8px] text-dim font-black uppercase block tracking-wider">Profit Factor</span>
                      <span className="text-xs font-bold font-mono text-purple-400">{rec.metrics.profitFactor}</span>
                    </div>

                    <div className="bg-surface/50 p-2 rounded-xl border border-border/30 text-center">
                      <span className="text-[8px] text-dim font-black uppercase block tracking-wider">Total PnL</span>
                      <span className={cn("text-xs font-bold font-mono", rec.metrics.totalPnl >= 0 ? "text-green" : "text-red")}>
                        {fmtUSD(rec.metrics.totalPnl)}
                      </span>
                    </div>

                    <div className="bg-surface/50 p-2 rounded-xl border border-border/30 text-center">
                      <span className="text-[8px] text-dim font-black uppercase block tracking-wider">Expectancy</span>
                      <span className="text-xs font-bold font-mono text-text">${rec.metrics.expectancy}</span>
                    </div>

                    <div className="bg-surface/50 p-2 rounded-xl border border-border/30 text-center">
                      <span className="text-[8px] text-dim font-black uppercase block tracking-wider">Max Drawdown</span>
                      <span className="text-xs font-bold font-mono text-red">{rec.metrics.maxDrawdownPct}%</span>
                    </div>

                    <div className="bg-surface/50 p-2 rounded-xl border border-border/30 text-center">
                      <span className="text-[8px] text-dim font-black uppercase block tracking-wider">Sharpe Ratio</span>
                      <span className="text-xs font-bold font-mono text-text">{rec.metrics.sharpeRatio}</span>
                    </div>

                    <div className="bg-surface/50 p-2 rounded-xl border border-border/30 text-center col-span-2 sm:col-span-1">
                      <span className="text-[8px] text-dim font-black uppercase block tracking-wider">Trades Count</span>
                      <span className="text-xs font-bold font-mono text-text">{rec.metrics.totalTrades} ({rec.metrics.wins}W/{rec.metrics.losses}L)</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
SmartAutoDiscoveryPanel.displayName = 'SmartAutoDiscoveryPanel';

const EnvironmentButton = React.memo(({ mode, isSelected, onClick, disabled = false }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onClick(mode)}
    className={cn(
      "p-3.5 rounded-xl border-2 text-left transition-all relative group cursor-pointer",
      isSelected ? "border-accent bg-accent/10 ring-2 ring-accent/20" : "border-border bg-surface hover:border-border-hover",
      disabled && !isSelected && "opacity-50 cursor-not-allowed hover:border-border"
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-black uppercase tracking-tighter capitalize">{mode}</span>
      {isSelected ? <CheckCircle2 size={15} className="text-accent shrink-0" /> : disabled ? <Lock size={13} className="text-dim shrink-0" /> : null}
    </div>
  </button>
))
EnvironmentButton.displayName = 'EnvironmentButton'

const BacktestWorkbenchPanel = React.memo(({ cfg, setField, buildConfigToSave, onSave, onOpenSaveAsNew }) => {
  const [days, setDays] = useState(14);
  const [startingBalance, setStartingBalance] = useState(10000);
  const [symbolText, setSymbolSearchText] = useState(() => (Array.isArray(cfg?.symbols) && cfg.symbols.length > 0 ? cfg.symbols.join(', ') : typeof cfg?.symbols === 'string' ? cfg.symbols : 'BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT'));
  const [useGlobalScanner, setUseGlobalScanner] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressStatus, setProgressStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showBacktestInfo, setShowBacktestInfo] = useState(false);
  const abortControllerRef = useRef(null);
  const addAlert = useTradingStore(state => state.addAlert);

  const handleStopBacktest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsRunning(false);
    setProgressStatus('Backtest simulation cancelled.');
    if (addAlert) {
      addAlert({ level: 'info', title: 'Backtest Cancelled', message: 'Historical simulation stopped by user.' });
    }
  };

  const handleRunBacktest = async () => {
    setIsRunning(true);
    setProgressPct(5);
    setProgressStatus('Fetching historical klines from Binance...');
    setError(null);

    abortControllerRef.current = new AbortController();

    const progressTimer = setInterval(() => {
      setProgressPct((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.floor(Math.random() * 15) + 5;
      });
    }, 250);

    try {
      const configToRun = buildConfigToSave();
      const parsedSymbols = symbolText.split(',').map(s => s.trim().toUpperCase()).filter(s => s.endsWith('USDT'));
      const res = await sessionAPI.backtest({
        config: configToRun,
        symbols: parsedSymbols.length > 0 ? parsedSymbols : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
        days: Number(days),
        startingBalance: Number(startingBalance),
        useGlobalScanner: Boolean(useGlobalScanner),
      });

      clearInterval(progressTimer);
      setProgressPct(100);
      setProgressStatus('Simulation complete.');

      if (res && res.data) {
        setResult(res.data);
        if (addAlert) {
          addAlert({
            level: 'success',
            title: 'Backtest Completed',
            message: `Completed in ${res.data.executionTimeMs}ms across ${res.data.totalTrades} trades! Total PnL: ${fmtUSD(res.data.totalPnl)}`,
          });
        }
      }
    } catch (err) {
      clearInterval(progressTimer);
      if (err.name === 'CanceledError' || err.name === 'AbortError') {
        setProgressStatus('Backtest cancelled.');
      } else {
        console.error('[Backtest] Run error:', err);
        const msg = err.response?.data?.message || err.message || 'Backtest failed.';
        setError(msg);
        if (addAlert) {
          addAlert({ level: 'error', title: 'Backtest Error', message: msg });
        }
      }
    } finally {
      clearInterval(progressTimer);
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  };

  const handleInjectSymbol = (sym) => {
    const currentSymbols = cfg.symbols || [];
    if (!currentSymbols.includes(sym)) {
      const updated = [...currentSymbols, sym];
      setField('symbols', updated);
      if (addAlert) {
        addAlert({ level: 'success', title: 'Symbol Injected', message: `Added ${sym} to Static Watchlist.` });
      }
    }
  };

  const handleAutoInjectRecommended = () => {
    if (!result?.symbolPerformance) return;
    const recommendedList = result.symbolPerformance.filter(sp => sp.isRecommended).map(sp => sp.symbol);
    if (recommendedList.length === 0) {
      if (addAlert) {
        addAlert({ level: 'info', title: 'No Recommendations', message: 'No backtested symbols met top recommendation threshold.' });
      }
      return;
    }
    const currentSymbols = cfg.symbols || [];
    const merged = Array.from(new Set([...currentSymbols, ...recommendedList]));
    setField('symbols', merged);
    if (addAlert) {
      addAlert({
        level: 'success',
        title: 'Auto-Injected Recommended Symbols',
        message: `Injected ${recommendedList.length} top performing symbol(s) [${recommendedList.join(', ')}] into Static Watchlist.`,
      });
    }
  };

  return (
    <div
      id="config-panel-backtest"
      role="tabpanel"
      aria-labelledby="config-tab-backtest"
      className="flex flex-col gap-4 lg:gap-6 animate-in fade-in duration-300"
    >
      <div className="p-4 bg-background/50 border border-border/60 rounded-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent shrink-0">
              <TrendingUp size={16} />
            </div>
            <h3 className="text-xs font-black uppercase tracking-tight truncate">Backtesting Workbench</h3>
            <InfoHelpButton
              open={showBacktestInfo}
              onToggle={() => setShowBacktestInfo(v => !v)}
              label="Backtesting Workbench"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenSaveAsNew && (
              <Btn
                variant="ghost"
                onClick={() => onOpenSaveAsNew(null)}
                className="px-3 py-2 text-xs font-bold border border-border hover:border-accent/40 text-dim hover:text-text flex items-center gap-1.5"
                title="Save current configuration as a preset"
              >
                <Save size={13} />
                <span className="hidden sm:inline">Save As</span>
              </Btn>
            )}
            {isRunning ? (
              <Btn
                variant="ghost"
                onClick={handleStopBacktest}
                className="px-4 py-2 text-xs font-bold bg-red/10 border border-red/30 text-red hover:bg-red/20 flex items-center gap-1.5"
              >
                <XCircle size={14} /> Stop Simulation
              </Btn>
            ) : (
              <Btn
                variant="primary"
                onClick={handleRunBacktest}
                className="px-4 py-2 text-xs font-bold bg-accent text-white hover:bg-accent/90 shadow-[0_0_20px_rgba(91,111,255,0.2)]"
              >
                Run Backtest
              </Btn>
            )}
          </div>
        </div>
        {showBacktestInfo && (
          <InfoDropdownBox>Simulate strategy on Binance historical klines</InfoDropdownBox>
        )}

        {isRunning && (
          <div className="p-3 bg-accent/5 border border-accent/20 rounded-xl flex flex-col gap-2 animate-in fade-in duration-200">
            <div className="flex items-center justify-between text-xs font-mono font-bold">
              <span className="text-accent flex items-center gap-1.5">
                <RefreshCw size={12} className="animate-spin" /> {progressStatus || 'Processing historical klines...'}
              </span>
              <span className="text-text">{progressPct}%</span>
            </div>
            <div className="w-full bg-surface/80 rounded-full h-2 overflow-hidden border border-border/40">
              <div
                className="bg-accent h-full transition-all duration-300 rounded-full"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border/40">
          <div>
            <label htmlFor="backtest-days" className="text-[9px] text-dim font-black uppercase tracking-widest block mb-1">Time Horizon (Days)</label>
            <select
              id="backtest-days"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold text-text outline-none focus:border-accent cursor-pointer"
            >
              <option value={7}>7 Days (1 Week)</option>
              <option value={14}>14 Days (2 Weeks)</option>
              <option value={30}>30 Days (1 Month)</option>
              <option value={60}>60 Days (2 Months)</option>
              <option value={90}>90 Days (3 Months)</option>
            </select>
          </div>

          <div>
            <label htmlFor="backtest-balance" className="text-[9px] text-dim font-black uppercase tracking-widest block mb-1">Starting Capital ($)</label>
            <input
              id="backtest-balance"
              type="number"
              inputMode="decimal"
              min={10}
              step={100}
              value={startingBalance}
              onChange={(e) => setStartingBalance(Number(e.target.value))}
              className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold text-text outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="backtest-symbols" className="text-[9px] text-dim font-black uppercase tracking-widest block mb-1">Target Symbol(s)</label>
            <input
              id="backtest-symbols"
              type="text"
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="BTCUSDT, ETHUSDT..."
              disabled={useGlobalScanner}
              value={symbolText}
              onChange={(e) => setSymbolSearchText(e.target.value)}
              className={cn(
                "w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono font-bold text-text outline-none focus:border-accent",
                useGlobalScanner && "opacity-50 cursor-not-allowed"
              )}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-3 bg-surface/40 border border-border/30 rounded-xl">
          <CollapsibleHelpTitle
            title="Market-Wide Global Scanner"
            titleClassName="text-[10px] font-black uppercase tracking-widest text-text"
            helpText="Filter & rank candidate opportunities across candidate symbols dynamically during historical simulation."
          />
          <Toggle value={useGlobalScanner} onChange={setUseGlobalScanner} color="bg-accent" />
        </div>

        {error && (
          <div className="p-3 bg-red/10 border border-red/30 rounded-xl text-xs text-red font-semibold flex items-center gap-2">
            <XCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {result && (
        <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 auto-rows-fr items-stretch gap-3">
            <StatCard label="Total PnL" value={`${fmtUSD(result.totalPnl)}`} subValue={`${result.pnlPct >= 0 ? '+' : ''}${result.pnlPct}%`} color={result.totalPnl >= 0 ? 'text-green' : 'text-red'} />
            <StatCard label="Win Rate" value={`${result.winRate}%`} subValue={`${result.wins}W / ${result.losses}L (${result.totalTrades} Total)`} color="text-accent" />
            <StatCard label="Profit Factor" value={`${result.profitFactor}`} subValue={`Avg Win: $${result.avgWin}`} color="text-purple-400" />
            <StatCard label="Max Drawdown" value={`${result.maxDrawdownPct}%`} subValue={`$${result.maxDrawdown}`} color="text-red" />
            <StatCard label="Expectancy" value={`$${result.expectancy}`} subValue={`Avg Trade: $${result.avgTradePnl}`} color="text-text" />
            <StatCard label="Sharpe Ratio" value={`${result.sharpeRatio}`} subValue={`Fees: $${result.totalFees}`} color="text-text" />
          </div>

          {result.equityCurve && result.equityCurve.length > 0 && (
            <div className="p-4 bg-background/50 border border-border/60 rounded-2xl flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-dim">Simulated Equity Curve ($)</span>
                <span className="text-[10px] font-mono text-accent font-bold">End Balance: {fmtUSD(result.endingBalance)}</span>
              </div>
              <div className="h-28 w-full flex items-end gap-1 pt-2 px-1">
                {result.equityCurve.map((pt, idx) => {
                  const minBal = Math.min(...result.equityCurve.map(p => p.equity));
                  const maxBal = Math.max(...result.equityCurve.map(p => p.equity));
                  const range = Math.max(1, maxBal - minBal);
                  const heightPct = Math.max(8, ((pt.equity - minBal) / range) * 100);
                  const isUp = pt.equity >= result.startingBalance;

                  return (
                    <Tooltip key={idx} content={`$${pt.equity} (${pt.drawdownPct}% DD)`}>
                      <div
                        className={cn(
                          "flex-1 rounded-t-sm transition-all hover:opacity-100 opacity-70",
                          isUp ? "bg-accent" : "bg-red"
                        )}
                        style={{ height: `${heightPct}%` }}
                      />
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}

          {/* Symbol Performance Breakdown & Auto/Manual Injection Leaderboard */}
          {result.symbolPerformance && result.symbolPerformance.length > 0 && (
            <div className="p-4 bg-background/50 border border-border/60 rounded-2xl flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CollapsibleHelpTitle
                  title="Symbol Performance & Recommendations"
                  titleClassName="text-[10px] font-black uppercase tracking-widest text-dim"
                  helpText="Inject top backtested symbols into your active strategy watchlist."
                />

                {result.symbolPerformance.some(sp => sp.isRecommended) && (
                  <Btn
                    variant="primary"
                    onClick={handleAutoInjectRecommended}
                    className="px-3 py-1.5 text-[10px] font-bold bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 flex items-center gap-1 shrink-0"
                  >
                    <Plus size={12} /> Auto-Inject Top Recommended
                  </Btn>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
                {result.symbolPerformance.map((sp) => {
                  const inWatchlist = (cfg.symbols || []).includes(sp.symbol);
                  return (
                    <div
                      key={sp.symbol}
                      className={cn(
                        "p-3 rounded-xl border flex flex-col justify-between gap-2 transition-all bg-surface/50",
                        sp.isRecommended ? "border-accent/40 bg-accent/[0.02]" : "border-border/40"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-bold text-text">{sp.symbol}</span>
                          {sp.isRecommended && (
                            <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">
                              ★ Recommended
                            </span>
                          )}
                        </div>
                        <span className={cn("text-xs font-mono font-bold", sp.totalPnl >= 0 ? "text-green" : "text-red")}>
                          {sp.totalPnl >= 0 ? '+' : ''}${sp.totalPnl}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[9px] font-mono text-dim/80 pt-1 border-t border-border/20">
                        <span>{sp.winRate}% WR ({sp.wins}W/{sp.losses}L)</span>
                        <span>PF: {sp.profitFactor}</span>
                      </div>

                      <div className="pt-1">
                        {inWatchlist ? (
                          <span className="w-full block py-1 text-center text-[9px] font-bold uppercase text-dim/50 bg-surface rounded-lg border border-border/20 select-none">
                            In Watchlist
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleInjectSymbol(sp.symbol)}
                            className="w-full py-1 rounded-lg text-[9px] font-black uppercase tracking-wider bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-all cursor-pointer focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none flex items-center justify-center gap-1"
                          >
                            <Plus size={10} /> Inject Symbol
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {result.trades && result.trades.length > 0 && (
            <div className="p-4 bg-background/50 border border-border/60 rounded-2xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-dim">Simulated Trade Log ({result.trades.length})</span>
                <span className="text-[9px] text-dim font-bold">Taker Fee: 0.04% / side</span>
              </div>

              <div className="max-h-64 overflow-y-auto no-scrollbar flex flex-col gap-1.5 pr-1">
                {result.trades.map((t) => {
                  const isWin = t.pnl >= 0;
                  return (
                    <div key={t.id} className="flex items-center justify-between p-2.5 bg-surface/60 border border-border/40 rounded-xl text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider",
                          t.direction === 'LONG' ? "bg-green/10 text-green" : "bg-red/10 text-red"
                        )}>
                          {t.direction}
                        </span>
                        <span className="font-bold text-text">{t.symbol}</span>
                        {t.is_knife && <span className="text-[9px]">🔪</span>}
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-[9px] text-dim/70 truncate max-w-[120px]">{t.exit_reason}</span>
                        <span className={cn("font-bold font-mono", isWin ? "text-green" : "text-red")}>
                          {isWin ? '+' : ''}${t.pnl} ({t.pnl_pct}%)
                        </span>
                        <span className="text-[9px] text-dim/60 font-mono w-10 text-right">{t.rr}R</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
BacktestWorkbenchPanel.displayName = 'BacktestWorkbenchPanel';


const computePresetDiff = (current, saved) => {
  const diffs = [];

  if ((current.scan_interval || '1m') !== (saved.scan_interval || '1m')) {
    diffs.push({ label: 'Timeframe', old: saved.scan_interval || '1m', new: current.scan_interval || '1m' });
  }

  if ((current.entry_side || 'both') !== (saved.entry_side || 'both')) {
    diffs.push({ label: 'Side', old: (saved.entry_side || 'both').toUpperCase(), new: (current.entry_side || 'both').toUpperCase() });
  }

  // Risk per trade
  const rCurr = current.risk_pct_per_trade;
  const rSaved = saved.risk_pct_per_trade;
  if (rCurr !== rSaved) diffs.push({ label: 'Risk per trade', old: `${rSaved}%`, new: `${rCurr}%` });

  // Stop loss
  if ((current.sl_type || 'pct') !== (saved.sl_type || 'pct')) {
    diffs.push({ label: 'SL model', old: saved.sl_type || 'pct', new: current.sl_type || 'pct' });
  }
  const slCurr = current.sl_distance_pct;
  const slSaved = saved.sl_distance_pct;
  if (slCurr !== slSaved) diffs.push({ label: 'Stop loss', old: `${slSaved}%`, new: `${slCurr}%` });

  // Trailing stop (matches canonical SessionConfig fields)
  const formatTrail = (c) => {
    const enabled = c.trailing_stop_enabled === true || c.sl_type === 'trailing';
    if (!enabled) return 'off';
    return c.trailing_stop_type === 'rr'
      ? `${c.trailing_stop_rr ?? 1.0}R`
      : `${c.trailing_stop_distance_pct ?? 1.0}%`;
  };
  const tCurr = formatTrail(current);
  const tSaved = formatTrail(saved);
  if (tCurr !== tSaved) diffs.push({ label: 'Trailing stop', old: tSaved, new: tCurr });

  if ((current.tp_mode || 'exp_rr_seq') !== (saved.tp_mode || 'exp_rr_seq')) {
    diffs.push({ label: 'TP mode', old: saved.tp_mode || 'exp_rr_seq', new: current.tp_mode || 'exp_rr_seq' });
  }

  return diffs;
};

const SavePresetModal = ({ isOpen, onClose, onSave, defaultName = '', configSummary = null, targetConfig = null }) => {
  const [charLimit, setCharLimit] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' && Number(localStorage.getItem('strategy_name_char_limit'));
      if (saved === 20 || saved === 28 || saved === 50) return saved;
    } catch (e) {}
    return STRATEGY_NAME_CHAR_LIMITS.STANDARD;
  });
  const [name, setName] = useState(defaultName);
  const [isAutoGenerated, setIsAutoGenerated] = useState(true);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const suggestions = useMemo(
    () => (targetConfig ? generateSmartNameSuggestions(targetConfig, charLimit) : []),
    [targetConfig, charLimit],
  );

  useEffect(() => {
    if (isOpen) {
      const initialLimit = (() => {
        try {
          const saved = typeof localStorage !== 'undefined' && Number(localStorage.getItem('strategy_name_char_limit'));
          if (saved === 20 || saved === 28 || saved === 50) return saved;
        } catch (e) {}
        return STRATEGY_NAME_CHAR_LIMITS.STANDARD;
      })();
      setCharLimit(initialLimit);
      const initialName = defaultName
        ? sanitizeStrategyLabel(defaultName, initialLimit)
        : (targetConfig ? generateSmartStrategyName(targetConfig, { maxLen: initialLimit, style: 'standard' }) : '');
      setName(initialName);
      setIsAutoGenerated(true);
      setError('');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, defaultName, targetConfig]);

  if (!isOpen) return null;

  const handleSelectLimit = (nextLimit) => {
    setCharLimit(nextLimit);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('strategy_name_char_limit', String(nextLimit));
      }
    } catch (e) {}
    if (targetConfig && isAutoGenerated) {
      const smart = generateSmartStrategyName(targetConfig, { maxLen: nextLimit, style: 'standard' });
      setName(smart);
    } else if (name.length > nextLimit) {
      setName(sanitizeStrategyLabel(name, nextLimit));
    }
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    const trimmed = sanitizeStrategyLabel(name, charLimit).trim();
    if (!trimmed) {
      setError('Please enter a preset name');
      return;
    }
    onSave(trimmed);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[120] flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200" data-vaul-no-drag>
      <div
        role="dialog"
        aria-labelledby="save-preset-modal-title"
        aria-modal="true"
        className="w-full max-w-md bg-surface border border-border/80 rounded-2xl p-3.5 sm:p-5 shadow-2xl flex flex-col gap-3 relative my-auto animate-in zoom-in-95 duration-200 overflow-hidden"
      >
        <div className="flex items-center justify-between pb-2 border-b border-border/40 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 rounded-lg bg-accent/15 text-accent shrink-0">
              <Save size={15} />
            </span>
            <h3 id="save-preset-modal-title" className="text-sm sm:text-base font-bold text-text truncate">Save As New Preset</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center text-dim hover:text-text rounded-lg hover:bg-white/5 transition-colors cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 min-w-0">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
              <label htmlFor="save-new-preset-input" className="text-xs font-semibold text-dim">
                Preset Name
              </label>
              <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums shrink-0">
                <span className={cn("font-semibold", name.length >= charLimit - 2 ? "text-amber" : "text-dim")}>
                  {name.length}/{charLimit}
                </span>
                <span className="text-dim/40">·</span>
                {[
                  { label: '20c', val: STRATEGY_NAME_CHAR_LIMITS.COMPACT },
                  { label: '28c', val: STRATEGY_NAME_CHAR_LIMITS.STANDARD },
                  { label: '50c', val: STRATEGY_NAME_CHAR_LIMITS.MAX },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => handleSelectLimit(opt.val)}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold transition-colors cursor-pointer",
                      charLimit === opt.val ? "bg-accent text-background font-bold" : "text-dim hover:text-text"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5 min-w-0 w-full">
              <input
                id="save-new-preset-input"
                ref={inputRef}
                type="text"
                maxLength={charLimit}
                value={name}
                onChange={(e) => {
                  setIsAutoGenerated(false);
                  setName(sanitizeStrategyLabel(e.target.value, charLimit));
                  if (error) setError('');
                }}
                placeholder="e.g. Top 1h HL 2/5 EMA"
                className={cn(
                  "flex-1 min-w-0 w-full min-h-[34px] bg-background border rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-text focus:outline-none transition-colors",
                  error ? "border-red focus:border-red" : "border-border focus:border-accent"
                )}
              />
              {targetConfig && (
                <button
                  type="button"
                  onClick={() => {
                    const smart = generateSmartStrategyName(targetConfig, { maxLen: charLimit, style: 'standard' });
                    setIsAutoGenerated(true);
                    setName(smart);
                    if (error) setError('');
                  }}
                  title="Auto-generate smart name from strategy parameters"
                  className="min-h-[34px] px-2.5 rounded-lg border border-border bg-background hover:border-accent/50 hover:text-accent text-dim inline-flex items-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
                >
                  <Sparkles size={12} />
                  <span>Auto-Name</span>
                </button>
              )}
            </div>
            {suggestions.length > 0 && (
              <div className="grid grid-cols-3 sm:flex sm:items-center sm:flex-wrap gap-1.5 pt-0.5 w-full min-w-0">
                <span className="hidden sm:inline text-[10px] text-dim font-medium">Smart:</span>
                {suggestions.map((sug) => (
                  <button
                    key={sug.id}
                    type="button"
                    onClick={() => {
                      setIsAutoGenerated(true);
                      setName(sug.value);
                      if (error) setError('');
                    }}
                    className={cn(
                      "min-w-0 w-full sm:w-auto px-2 py-0.5 rounded-md font-mono text-[10px] border transition-colors cursor-pointer truncate text-center sm:max-w-[180px]",
                      name === sug.value
                        ? "bg-accent/15 border-accent/40 text-accent font-bold"
                        : "bg-background/60 border-border/50 text-dim hover:text-text"
                    )}
                  >
                    {sug.value}
                  </button>
                ))}
              </div>
            )}
            {error && <span className="text-xs text-red font-medium">{error}</span>}
          </div>

          {configSummary && (
            <div className="bg-background/60 border border-border/40 rounded-xl p-2.5 flex flex-col gap-0.5 text-[11px] text-dim">
              <span className="font-semibold text-text uppercase tracking-wider text-[10px]">Strategy Overview</span>
              <div className="flex items-center gap-1.5 flex-wrap font-mono text-text/90">
                <span className="px-1.5 py-0.5 rounded bg-surface border border-border/40 text-[10px] font-bold">{configSummary.mode}</span>
                {configSummary.scope && (
                  <>
                    <span>·</span>
                    <span className="text-accent font-semibold">{configSummary.scope}</span>
                  </>
                )}
                <span>·</span>
                <span>{configSummary.interval}</span>
                <span>·</span>
                <span>{configSummary.risk}% risk</span>
                {configSummary.sl !== undefined && configSummary.sl !== null && (
                  <>
                    <span>·</span>
                    <span>SL {configSummary.sl}%</span>
                  </>
                )}
                {configSummary.tp !== undefined && configSummary.tp !== null && (
                  <>
                    <span>·</span>
                    <span>TP {configSummary.tp}R</span>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/30">
            <Btn type="button" variant="ghost" onClick={onClose} className="h-9 px-3.5 text-xs font-semibold">
              Cancel
            </Btn>
            <Btn type="submit" variant="primary" className="h-9 px-4 text-xs font-bold bg-accent text-white">
              Save Preset
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
};

const PresetItem = React.memo(React.forwardRef(({
  preset,
  isLoaded,
  isDirty,
  onLoad,
  onToggleVariant,
  onDelete,
  isVariant,
  variantIndex,
  isEditingVariant,
  onEditVariant,
  sessionActive,
  isSelected,
  onToggleSelect,
  currentCfg,
  onSave,
  onSaveAsNew,
  onRevert,
  onDuplicate,
  onPromoteVariant
}, ref) => {
  const [manualExpanded, setManualExpanded] = useState(false);
  const pMode = preset.config.trading_mode || (preset.config.paper_mode ? 'paper' : 'live');
  const isExpanded = manualExpanded || isEditingVariant;

  let modeColor = "bg-dim";
  let modeLabel = "Paper";
  if (pMode === 'live') { modeColor = "bg-green"; modeLabel = "Live"; }
  else if (pMode === 'testnet') { modeColor = "bg-cyan-500"; modeLabel = "Testnet"; }

  const tpRatio = (preset.config.tp_mode === 'fixed' || preset.config.tp_mode === undefined)
    ? preset.config.tp_ratio || 2.0
    : (preset.config.exit_rr_sequence && preset.config.exit_rr_sequence.length > 0)
        ? preset.config.exit_rr_sequence[preset.config.exit_rr_sequence.length - 1]
        : 2.0;

  const diffs = (isExpanded && isLoaded && isDirty && currentCfg) ? computePresetDiff(currentCfg, preset.config) : [];

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.16, ease: "easeInOut" }}
      className={cn(
        "flex flex-col border-b border-border/40 hover:bg-white/[0.02] transition-all relative overflow-hidden group/preset",
        isSelected && "bg-accent/[0.06] border-accent/30",
        isVariant && "border-violet-500/30 bg-violet-500/[0.03] hover:bg-violet-500/[0.06]",
        isEditingVariant && "ring-1 ring-violet-500 bg-violet-500/[0.08]",
        isExpanded && !isVariant && "bg-surface/30 border-b-border"
      )}
    >
      <div
        className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 cursor-pointer"
        onClick={(e) => {
          if (e.target.closest('button') || e.target.closest('input')) return;
          if (onToggleSelect && (isSelected || e.metaKey || e.ctrlKey)) {
             onToggleSelect(preset.name);
          } else if (isVariant && onEditVariant) {
             onEditVariant(preset, variantIndex);
          } else {
             onLoad(preset);
          }
        }}
      >
        {/* Checkbox for batch select */}
        {onToggleSelect && (
           <button
             type="button"
             onClick={(e) => { e.stopPropagation(); onToggleSelect(preset.name); }}
             aria-label={`Select ${preset.name}`}
             className="shrink-0 p-1 rounded-md focus-visible:ring-2 focus-visible:ring-accent"
           >
             <div className={cn(
               "w-4 h-4 rounded border flex items-center justify-center transition-all",
               isSelected ? "bg-accent border-accent text-black font-bold" : "border-border/60 hover:border-accent/40"
             )}>
               {isSelected && <Check size={10} className="stroke-[3]" />}
             </div>
           </button>
        )}

        <div className="flex-1 min-w-0 flex items-center gap-2 sm:gap-2.5">
          {/* Status dots */}
          <div className="flex items-center gap-1 shrink-0">
            <span className={cn("w-2 h-2 rounded-full", modeColor)} title={`Mode: ${modeLabel}`} />
            {isVariant && (
              <span
                className="w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]"
                title={`Running as Variant #${(variantIndex ?? 0) + 1}`}
              />
            )}
          </div>

          <div className="flex flex-col gap-0.5 min-w-0 flex-1 leading-snug">
             <div className="flex items-center gap-1.5 min-w-0">
                <span className={cn(
                  "text-xs sm:text-[13px] font-bold truncate tracking-tight transition-colors min-w-0 leading-snug",
                  isVariant ? "text-violet-200 group-hover/preset:text-violet-100" : "text-text group-hover/preset:text-accent"
                )}>
                  {preset.name}
                </span>

                {/* Variant Color-Coded Badge */}
                {isVariant && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 flex items-center gap-1 shrink-0 leading-none">
                    <Layers size={9} className="text-violet-400 hidden sm:inline" />
                    {variantIndex !== undefined && variantIndex >= 0 ? (
                      <>
                        <span className="sm:hidden">V{variantIndex + 1}</span>
                        <span className="hidden sm:inline">{`Variant #${variantIndex + 1}`}</span>
                      </>
                    ) : 'Variant'}
                  </span>
                )}

                {isEditingVariant && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/30 text-violet-200 border border-violet-400 shrink-0 leading-none">
                    Editing
                  </span>
                )}

                {/* Active Base Badge */}
                {isLoaded && !isVariant && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/40 shrink-0 leading-none">
                    <span className="sm:hidden">Base</span>
                    <span className="hidden sm:inline">Active Base</span>
                  </span>
                )}

                {isLoaded && isDirty && !isVariant && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber shrink-0 sm:hidden" title="Modified" />
                )}
             </div>

             <div className="text-[10.5px] text-dim font-mono tracking-tight truncate leading-snug">
               {`${getWatchlistScopeDescriptor(preset.config).badge} · ${preset.config.scan_interval || '1m'} · ${preset.config.risk_pct_per_trade}% · SL ${preset.config.sl_distance_pct}%${tpRatio ? ` · ${Number(tpRatio).toFixed(1)}R` : ''} · ${modeLabel}`}
             </div>
          </div>
        </div>

        {/* Right Actions: Compact & Zero-Overlap on Narrow Screens */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isVariant ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditVariant?.(preset, variantIndex);
                }}
                className="h-8 px-2.5 sm:px-3 rounded-lg text-[11px] font-bold bg-violet-600/20 hover:bg-violet-600/30 text-violet-200 border border-violet-500/40 transition-all flex items-center gap-1 cursor-pointer"
                title="Edit this variant's parameters without altering base strategy"
              >
                <Edit3 size={11} className="text-violet-400 shrink-0" />
                <span className="hidden sm:inline">Edit Variant</span>
                <span className="sm:hidden">Edit</span>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleVariant(e, preset); }}
                aria-label={`Remove variant ${preset.name}`}
                className="h-8 px-2.5 rounded-lg border border-border/60 text-[11px] font-medium text-dim hover:text-red hover:border-red/40 transition-colors cursor-pointer"
                title="Remove from active variants"
              >
                <span className="hidden sm:inline">Remove</span>
                <X size={12} className="sm:hidden" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleVariant(e, preset); }}
                className="h-8 px-2.5 sm:px-3 rounded-lg border border-border/80 text-[11px] font-bold text-text hover:border-accent hover:text-accent hover:bg-accent/5 transition-all cursor-pointer whitespace-nowrap"
                title="Add as secondary trading variant"
              >
                <span className="hidden sm:inline">+ Variant</span>
                <span className="sm:hidden">+ Var</span>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onLoad(preset); }}
                className={cn(
                  "hidden sm:inline-flex h-8 items-center px-3 rounded-lg text-[11px] font-bold transition-all cursor-pointer",
                  isLoaded ? "bg-accent/15 text-accent border border-accent/40" : "text-dim hover:text-text hover:bg-white/5 border border-transparent"
                )}
                title="Load as primary base strategy"
              >
                {isLoaded ? 'Loaded' : 'Load Base'}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setManualExpanded(prev => !prev); }}
            aria-label={isExpanded ? `Collapse ${preset.name} actions` : `Expand ${preset.name} actions`}
            aria-expanded={isExpanded}
            className={cn(
              "h-8 w-8 flex items-center justify-center rounded-lg border border-transparent text-dim hover:text-text hover:bg-white/5 transition-all cursor-pointer shrink-0",
              isExpanded && "bg-white/5 text-accent rotate-180"
            )}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {/* Inline Expansion */}
      {isExpanded && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 sm:px-4 pb-3 flex flex-col gap-2.5 overflow-hidden bg-background/20 border-t border-border/20 pt-2.5"
          >
            {isLoaded && isDirty && diffs.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                 {diffs.map((d, i) => (
                    <div key={i} className="bg-background/60 border border-border/40 rounded-lg p-2 flex flex-col gap-0.5">
                       <span className="text-[10px] text-dim">{d.label}</span>
                       <div className="text-[11px] font-mono tracking-tight flex items-center gap-1.5">
                         <span className="text-dim/80">{d.old}</span>
                         <span className="text-dim/40">→</span>
                         <span className="text-amber font-semibold">{d.new}</span>
                       </div>
                    </div>
                 ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
               {isVariant ? (
                 <>
                   <Btn
                     variant="primary"
                     onClick={() => onEditVariant?.(preset, variantIndex)}
                     className="h-8 px-3 text-[11px] bg-violet-600 hover:bg-violet-500 text-white font-bold flex items-center gap-1"
                   >
                     <Edit3 size={12} /> Edit Variant
                   </Btn>
                   <Btn
                     type="button"
                     variant="ghost"
                     onClick={() => onPromoteVariant ? onPromoteVariant(variantIndex) : onLoad(preset)}
                     className="h-8 px-3 text-[11px] border border-border text-dim hover:text-text font-bold"
                     title="Make this variant your main base strategy"
                   >
                     Promote to Base
                   </Btn>
                 </>
               ) : (
                 <>
                   {isLoaded && (
                     <Btn
                       variant="primary"
                       onClick={() => onSave(preset.name)}
                       className="h-8 px-3 text-[11px] bg-accent text-white font-bold"
                     >
                       Update preset
                     </Btn>
                   )}
                   <Btn
                     variant="ghost"
                     onClick={() => onLoad(preset)}
                     className="h-8 px-3 text-[11px] border border-border text-dim hover:text-text font-bold"
                   >
                     {isLoaded ? 'Reload Base' : 'Load as Base'}
                   </Btn>
                 </>
               )}

               <Btn
                 variant="ghost"
                 onClick={() => onSaveAsNew(preset)}
                 className="h-8 px-2.5 text-[11px] border border-border text-dim hover:text-accent font-bold flex items-center gap-1"
               >
                 <Copy size={11} /> Save as new
               </Btn>

               {isLoaded && isDirty && (
                 <Btn
                   variant="ghost"
                   onClick={onRevert}
                   className="h-8 px-2.5 text-[11px] text-amber hover:text-amber-300 font-bold"
                 >
                   Revert
                 </Btn>
               )}

               <div className="flex-1" />

               <Btn
                 variant="ghost"
                 onClick={onDuplicate}
                 className="h-8 px-2.5 text-[11px] text-dim hover:text-text flex font-bold"
               >
                 Duplicate
               </Btn>

               <Btn
                 variant="ghost"
                 disabled={sessionActive}
                 onClick={(e) => onDelete(e, preset.name)}
                 className={cn("h-8 px-2.5 text-[11px] font-bold", sessionActive ? "text-dim/30 cursor-not-allowed" : "text-red hover:bg-red/10")}
               >
                 Delete
               </Btn>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </motion.div>
  );
}));
PresetItem.displayName = 'PresetItem'


const flattenConfig = (config) => {
  if (!config) return {};
  try {
    const params = typeof config.signal_params === 'string' ? JSON.parse(config.signal_params || '{}') : config.signal_params || {};
    const weights = config.scanner_weights || { momentum: 0.5, volatility: 0.3, trend: 0.2 };
    const isAlreadyFlattened = config.__flattened === true || (
      config.scanner_weights_momentum !== undefined &&
      config.scanner_weights_volatility !== undefined &&
      config.scanner_weights_trend !== undefined
    );

    const flattened = {
      ...config,
      __flattened: true,
      trading_mode: config.trading_mode || (config.paper_mode ? 'paper' : 'live'),
      discovery_mode: config.discovery_mode || 'volume',
      scanner_weights_momentum: isAlreadyFlattened ? Number(config.scanner_weights_momentum) : (weights.momentum * 100),
      scanner_weights_volatility: isAlreadyFlattened ? Number(config.scanner_weights_volatility) : (weights.volatility * 100),
      scanner_weights_trend: isAlreadyFlattened ? Number(config.scanner_weights_trend) : (weights.trend * 100),
      live_rr_sequence: Array.isArray(config.live_rr_sequence) ? config.live_rr_sequence : [1.0, 2.0, 4.0],
      exit_rr_sequence: Array.isArray(config.exit_rr_sequence) ? config.exit_rr_sequence : [0.0, 1.0, 2.0],
      trailing_guard_buffer_pct: config.trailing_guard_buffer_pct !== undefined ? config.trailing_guard_buffer_pct : CONFIG_LIMITS.TRAILING_GUARD_DEFAULT,
      slippage_warning_threshold: isAlreadyFlattened
        ? (config.slippage_warning_threshold !== undefined ? Number(config.slippage_warning_threshold) : (CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT * 100 || 0.1))
        : (config.slippage_warning_threshold !== undefined ? config.slippage_warning_threshold * 100 : (CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT * 100 || 0.1)),
      leverage: config.leverage !== undefined ? Number(config.leverage) : CONFIG_LIMITS.LEVERAGE_DEFAULT,
      slippage_abort_threshold: config.slippage_abort_threshold !== undefined ? Number(config.slippage_abort_threshold) : (CONFIG_LIMITS.SLIPPAGE_ABORT_DEFAULT || 0.05),
      hibernation_mode: config.hibernation_mode || 'adaptive',
      hibernation_grace_period_sec: config.hibernation_grace_period_sec || 30,
      sl_out_of_bounds_action: config.sl_out_of_bounds_action !== undefined ? config.sl_out_of_bounds_action : 'clamp',
      trailing_stop_enabled: !!config.trailing_stop_enabled,
      trailing_stop_type: config.trailing_stop_type || 'pct',
      trailing_execution_mode: config.trailing_execution_mode || 'local',
      trailing_stop_distance_pct: config.trailing_stop_distance_pct || 1.0,
      trailing_stop_rr: config.trailing_stop_rr !== undefined ? Number(config.trailing_stop_rr) : 1.0,
      trailing_activation_rr: config.trailing_activation_rr !== undefined ? Number(config.trailing_activation_rr) : 0.0,
      knife_trailing_enabled: config.knife_trailing_enabled !== false,
      knife_trailing_distance_pct: config.knife_trailing_distance_pct !== undefined ? config.knife_trailing_distance_pct : 0.5,
      knife_auto_ratchet_be_rr: config.knife_auto_ratchet_be_rr !== undefined ? config.knife_auto_ratchet_be_rr : 0.5,
      knife_auto_ratchet_lock_rr: config.knife_auto_ratchet_lock_rr !== undefined ? config.knife_auto_ratchet_lock_rr : 1.0,
      anti_whipsaw_allow_knife: !!config.anti_whipsaw_allow_knife,
      anti_whipsaw_per_strategy: config.anti_whipsaw_per_strategy !== undefined ? !!config.anti_whipsaw_per_strategy : true,
      allow_knife_when_gated: !!config.allow_knife_when_gated,
      anti_whipsaw_candle_delay: config.anti_whipsaw_candle_delay !== undefined ? config.anti_whipsaw_candle_delay : 1,
      anti_whipsaw_tf_delay_min: config.anti_whipsaw_tf_delay_min !== undefined ? config.anti_whipsaw_tf_delay_min : 0,
      anti_whipsaw_max_tf: config.anti_whipsaw_max_tf || '4h',
      anti_whipsaw_timeframes: Array.isArray(config.anti_whipsaw_timeframes)
        ? config.anti_whipsaw_timeframes
        : (typeof config.anti_whipsaw_timeframes === 'string' && config.anti_whipsaw_timeframes
            ? config.anti_whipsaw_timeframes.split(',').map(s => s.trim()).filter(Boolean)
            : []),
      release_risk_on_est_pnl_be: !!config.release_risk_on_est_pnl_be,
      release_risk_est_pnl_mode: config.release_risk_est_pnl_mode === 'rr' ? 'rr' : 'usdt',
      release_risk_est_pnl_min_usdt: config.release_risk_est_pnl_min_usdt !== undefined && config.release_risk_est_pnl_min_usdt !== null && config.release_risk_est_pnl_min_usdt !== '' ? Number(config.release_risk_est_pnl_min_usdt) : 0,
      release_risk_est_pnl_min_rr: config.release_risk_est_pnl_min_rr !== undefined && config.release_risk_est_pnl_min_rr !== null && config.release_risk_est_pnl_min_rr !== '' ? Number(config.release_risk_est_pnl_min_rr) : 0,
      smart_watchlist_enabled: !!config.smart_watchlist_enabled,
      smart_watchlist_sensitivity: config.smart_watchlist_sensitivity || 0.7,
      scanner_signal_depth: config.scanner_signal_depth || 10,
      auto_scale_min_notional: config.auto_scale_min_notional !== undefined ? config.auto_scale_min_notional : true,
      auto_scale_max_overshoot: config.auto_scale_max_overshoot !== undefined ? config.auto_scale_max_overshoot : 3.0,
      risk_hardening_enabled: !!config.risk_hardening_enabled,
      max_single_trade_risk_pct: config.max_single_trade_risk_pct !== undefined ? config.max_single_trade_risk_pct : 20.0,
      engulfing_mode: config.engulfing_mode || 'range',
      engulfing_timing: config.engulfing_timing || 'is_opportunity',
      engulfing_volume_confirm: !!config.engulfing_volume_confirm,
      engulfing_lookback: config.engulfing_lookback || 1,
      engulfing_streak: config.engulfing_streak || 1,
      engulfing_sequential: config.engulfing_sequential !== false,
      engulfing_max_expansion_pct: config.engulfing_max_expansion_pct || 0,
      macd_pbc_trend_ema: config.macd_pbc_trend_ema || 50,
      macd_pbc_lookback: config.macd_pbc_lookback || 10,
      macd_pbc_max_continuation: config.macd_pbc_max_continuation || 2,
      required_signals: Array.isArray(config.required_signals) ? config.required_signals : [],
      required_exit_signals: Array.isArray(config.required_exit_signals) ? config.required_exit_signals : [],
      exit_signals: Array.isArray(config.exit_signals) ? config.exit_signals : [],
      enabled_signals: Array.isArray(config.enabled_signals) ? config.enabled_signals : [],
      symbols: Array.isArray(config.symbols) ? config.symbols : [],
      watchlist_max_symbols: config.watchlist_max_symbols !== undefined ? config.watchlist_max_symbols : 0,
      watchlist_auto_rotate: !!config.watchlist_auto_rotate,
      watchlist_rotate_interval_min: config.watchlist_rotate_interval_min || 15,
      watchlist_locked: !!config.watchlist_locked,
      watchlist_min_score: config.watchlist_min_score !== undefined ? config.watchlist_min_score : 75,
      trading_windows: Array.isArray(config.trading_windows) ? config.trading_windows : [],
      single_symbol_configs: Array.isArray(config.single_symbol_configs) ? config.single_symbol_configs : [],
      strategy_variants: Array.isArray(config.strategy_variants) ? config.strategy_variants : [],
      reject_entry_if_sl_exceeds_max: config.reject_entry_if_sl_exceeds_max !== false,
      htf_ema_cross_boost_enabled: config.htf_ema_cross_boost_enabled !== false,
      htf_ema_cross_interval: config.htf_ema_cross_interval || '4h',
      htf_ema_cross_count: config.htf_ema_cross_count || 4,
      htf_ema_fast_period: config.htf_ema_fast_period || 9,
      htf_ema_slow_period: config.htf_ema_slow_period || 21,
      htf_ema_cross_max_boost: config.htf_ema_cross_max_boost !== undefined ? config.htf_ema_cross_max_boost : 25.0,
      htf_ema_cross_rr_weight: config.htf_ema_cross_rr_weight !== undefined ? config.htf_ema_cross_rr_weight : 1.5,
    };

    // Dynamically map params without overwriting live UI edits on already-flattened configs
    Object.keys(params).forEach(k => {
      if (!isAlreadyFlattened || flattened[`signal_params_${k}`] === undefined) {
        flattened[`signal_params_${k}`] = params[k];
      }
    });

    // Populate active signal schema defaults and resolve alias fallbacks
    const activeSignals = Array.from(new Set([
      ...(Array.isArray(config.enabled_signals) ? config.enabled_signals : []),
      ...(Array.isArray(config.exit_signals) ? config.exit_signals : [])
    ]));

    activeSignals.forEach(sigKey => {
      const baseType = getBaseSignalType(sigKey);
      const isEntry = (config.enabled_signals || []).includes(sigKey);
      const isExit = (config.exit_signals || []).includes(sigKey);
      const schema = getSignalParamsSchema(sigKey, baseType, isEntry, isExit);

      schema.forEach(field => {
        if (flattened[field.key] === undefined || flattened[field.key] === null) {
          const pKey = field.baseParamKey;
          let aliasVal = undefined;

          if (pKey === 'entry_ema_fast' || pKey === 'exit_ema_fast') {
            aliasVal = params.exit_ema_fast ?? params.entry_ema_fast ?? params.ema_dual_fast ?? params.ema_fast ?? params.fast_ema;
          } else if (pKey === 'entry_ema_slow' || pKey === 'exit_ema_slow') {
            aliasVal = params.exit_ema_slow ?? params.entry_ema_slow ?? params.ema_dual_slow ?? params.ema_slow ?? params.slow_ema;
          } else if (pKey === 'entry_ema_period' || pKey === 'exit_ema_period') {
            aliasVal = params.exit_ema_period ?? params.entry_ema_period ?? params.ema_period;
          }

          flattened[field.key] = aliasVal !== undefined && aliasVal !== null ? aliasVal : field.defaultValue;
        }
      });
    });

    return flattened;
  } catch (e) { return { ...config }; }
};

const coerceAndSanitizeConfig = (rawConfig, isNestedVariant = false) => {
  if (!rawConfig) return {};
  try {
    const flat = flattenConfig(rawConfig);
    const c = { ...flat, strategy_label: (flat.strategy_label || '').trim(), discovery_mode: flat.discovery_mode || 'volume' };
    delete c.__flattened;

    // Dynamically reconstruct the signal_params map from any flat keys prefix-matched with signal_params_
    const sp = {};
    Object.keys(flat).forEach(k => {
      if (k.startsWith('signal_params_') && k !== 'signal_params') {
        const paramKey = k.substring('signal_params_'.length);
        const val = flat[k];
        if (val !== undefined && val !== null) {
          if (val === 'true' || val === true) {
            sp[paramKey] = true;
          } else if (val === 'false' || val === false) {
            sp[paramKey] = false;
          } else if (!Number.isNaN(Number(val)) && typeof val !== 'boolean') {
            sp[paramKey] = Number(val);
          } else {
            sp[paramKey] = val;
          }
        }
      }
    });
    c.signal_params = sp;

    // Synchronize duplicate top-level signal keys with signal_params so signal_params is the single source of truth
    const syncTopLevelKeys = [
      'htf_breakout_ref_timeframe', 'htf_breakout_trigger_timeframe', 'htf_breakout_mode',
      'htf_breakout_reference_level', 'htf_breakout_lookback', 'htf_breakout_buffer_pct', 'htf_breakout_max_expansion_pct',
      'engulfing_mode', 'engulfing_timing', 'engulfing_volume_confirm', 'engulfing_lookback',
      'engulfing_streak', 'engulfing_sequential', 'engulfing_max_expansion_pct',
      'macd_pbc_trend_ema', 'macd_pbc_lookback', 'macd_pbc_max_continuation',
    ];
    syncTopLevelKeys.forEach(k => {
      if (sp[k] !== undefined && sp[k] !== null && sp[k] !== '') {
        c[k] = sp[k];
      }
    });

    // Ensure numeric values where expected
    const numericFields = [
      'risk_pct_per_trade', 'max_total_risk_pct', 'max_open_trades', 'total_sl_guard_usdt',
      'max_single_trade_risk_pct',
      'smart_watchlist_sensitivity',
      'trailing_stop_distance_pct',
      'trailing_stop_rr',
      'knife_trailing_distance_pct',
      'knife_auto_ratchet_be_rr',
      'knife_auto_ratchet_lock_rr',
      'anti_whipsaw_candle_delay',
      'anti_whipsaw_tf_delay_min',
      'scan_pct_threshold', 'scan_lookback', 'scan_min_volume_usdt', 'watchlist_size',
      'watchlist_offset', 'sl_distance_pct', 'sl_min_pct', 'sl_max_pct', 'trailing_guard_buffer_pct',
      'tp_ratio', 'max_trades_per_period', 'trades_period_min', 'max_trades_24h',
      'scanner_signal_depth',
      'engulfing_lookback', 'engulfing_streak', 'engulfing_max_expansion_pct',
      'htf_breakout_lookback', 'htf_breakout_buffer_pct', 'htf_breakout_max_expansion_pct',
      'macd_pbc_trend_ema', 'macd_pbc_lookback', 'macd_pbc_max_continuation',
      'min_trade_interval_min', 'trades_jitter_pct', 'paper_starting_balance',
      'testnet_starting_balance', 'live_starting_balance', 'hot_loop_interval_ms',
      'main_loop_interval_ms', 'sl_lookback_period', 'sl_pct_limit',
      'max_open_trades_per_symbol', 'tod_min_winrate', 'leverage',
      'slippage_abort_threshold', 'htf_ema_cross_count', 'htf_ema_fast_period',
      'htf_ema_slow_period', 'htf_ema_cross_max_boost', 'htf_ema_cross_rr_weight',
      'watchlist_max_symbols', 'watchlist_rotate_interval_min', 'watchlist_min_score',
      'switched_sl_distance_pct', 'peak_rr_switch_threshold', 'peak_rr_switch_count',
      'trailing_activation_rr', 'auto_scale_max_overshoot',
      'auto_adjust_max_trades_min', 'auto_adjust_max_trades_max', 'auto_adjust_max_trades_step',
      'release_risk_est_pnl_min_usdt',
      'release_risk_est_pnl_min_rr',
      'scan_window_duration_sec', 'scan_check_interval_sec',
      'martingale_multiplier', 'martingale_max_steps', 'martingale_reset_threshold_pct'
    ];

    numericFields.forEach(f => {
      if (c[f] !== undefined && c[f] !== null) {
        if (c[f] === '' || (typeof c[f] === 'string' && c[f].trim() === '')) {
          delete c[f];
        } else {
          const num = Number(c[f]);
          if (Number.isFinite(num)) c[f] = num;
          else delete c[f];
        }
      }
    });

    c.scanner_weights = {
      momentum: Number(flat.scanner_weights_momentum || 0) / 100,
      volatility: Number(flat.scanner_weights_volatility || 0) / 100,
      trend: Number(flat.scanner_weights_trend || 0) / 100
    };

    // Remove flattened UI fields after bundling into scanner_weights object
    delete c.scanner_weights_momentum;
    delete c.scanner_weights_volatility;
    delete c.scanner_weights_trend;

    if (c.hibernation_grace_period_sec !== undefined && c.hibernation_grace_period_sec !== null && c.hibernation_grace_period_sec !== '') {
      const num = Number(c.hibernation_grace_period_sec);
      if (Number.isFinite(num)) c.hibernation_grace_period_sec = num;
      else delete c.hibernation_grace_period_sec;
    } else {
      delete c.hibernation_grace_period_sec;
    }

    // UI Conversion: UI percentage back to backend decimal
    if (c.slippage_warning_threshold !== undefined && c.slippage_warning_threshold !== null && c.slippage_warning_threshold !== '') {
      const num = Number(c.slippage_warning_threshold);
      if (Number.isFinite(num)) c.slippage_warning_threshold = num / 100;
      else delete c.slippage_warning_threshold;
    } else {
      delete c.slippage_warning_threshold;
    }

    // Format anti_whipsaw_timeframes as an array of strings
    if (typeof c.anti_whipsaw_timeframes === 'string') {
      c.anti_whipsaw_timeframes = c.anti_whipsaw_timeframes.split(',').map(s => s.trim()).filter(Boolean);
    } else if (!Array.isArray(c.anti_whipsaw_timeframes)) {
      c.anti_whipsaw_timeframes = [];
    }

    if (c.anti_whipsaw_max_tf) {
      c.anti_whipsaw_max_tf = String(c.anti_whipsaw_max_tf).trim();
    }

    // Clean up temporary signal_params_* UI fields
    Object.keys(c).forEach(k => {
      if (k.startsWith('signal_params_') && k !== 'signal_params') {
        delete c[k];
      }
    });

    let variantsSource = rawConfig?.strategy_variants || flat?.strategy_variants;
    if (typeof variantsSource === 'string') {
      try {
        variantsSource = JSON.parse(variantsSource);
      } catch {
        variantsSource = [];
      }
    }

    if (isNestedVariant) {
      // Zero out nested variants within a variant to prevent runaway nesting
      c.strategy_variants = [];
    } else if (Array.isArray(variantsSource)) {
      c.strategy_variants = variantsSource
        .filter(Boolean)
        .map(v => coerceAndSanitizeConfig({ ...v, strategy_label: v.strategy_label || 'Variant' }, true));
    } else {
      c.strategy_variants = [];
    }

    return c;
  } catch (e) {
    return { ...rawConfig };
  }
};
export const ConfigModal = ({ initialConfig, onSave, onClose, isEdit = false, loading = false, initialEditingVariantIndex = null, baseConfig = null }) => {
  const { addAlert, isThrottled, wsStatus, isSyncingOnResume, sessionActive, lifetimeAnalytics, fetchLifetimeAnalytics, apiStatus, sessionList } = useTradingStore(state => ({
    addAlert: state.addAlert,
    isThrottled: state.isThrottled,
    wsStatus: state.wsStatus,
    isSyncingOnResume: state.isSyncingOnResume,
    sessionActive: state.sessionActive,
    lifetimeAnalytics: state.lifetimeAnalytics,
    fetchLifetimeAnalytics: state.fetchLifetimeAnalytics,
    apiStatus: state.apiStatus,
    sessionList: state.sessionList,
  }));

  const presetSearchInputRef = useRef(null);

  // Variant editing state: enables editing a variant's configuration while strictly preserving base config
  const [editingVariantIdx, setEditingVariantIdx] = useState(initialEditingVariantIndex ?? null);
  const [baseConfigBackup, setBaseConfigBackup] = useState(() => {
    if (initialEditingVariantIndex !== null && baseConfig) {
      return flattenConfig(baseConfig);
    }
    return null;
  });

  // Save As New Preset dialog state
  const [saveModalState, setSaveModalState] = useState({
    isOpen: false,
    preset: null,
    defaultName: '',
    configSummary: null
  });

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showResumingFeedback = sessionActive && isResuming;
  // UX-MOBILE: Virtual-keyboard-aware viewport + isolated scrollBody centering + outer scroll lock + Prev/Next/Done stepper
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [vvHeight, setVvHeight] = useState(null);
  const [vvOffsetTop, setVvOffsetTop] = useState(0);
  const blurCheckTimerRef = useRef(null);
  const modalRef = React.useRef(null);
  const scrollBodyRef = React.useRef(null);

  const resetOuterScroll = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    const root = modalRef.current;
    if (root) {
      if (root.scrollTop !== 0) root.scrollTop = 0;
      if (root.scrollLeft !== 0) root.scrollLeft = 0;
      let ancestor = root.parentElement;
      while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        if (ancestor.scrollTop !== 0) ancestor.scrollTop = 0;
        if (ancestor.scrollLeft !== 0) ancestor.scrollLeft = 0;
        if (ancestor.getAttribute?.('role') === 'dialog' || ancestor.hasAttribute?.('data-vaul-drawer')) {
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }
    if (window.innerWidth < 768 && (window.scrollY !== 0 || window.scrollX !== 0 || document.documentElement.scrollTop !== 0 || document.body.scrollTop !== 0)) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, []);

  const scrollFieldIntoBody = React.useCallback((target) => {
    resetOuterScroll();
    const container = scrollBodyRef.current;
    if (!target || !container || !container.contains(target)) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const padding = 14;
    const isComfortablyVisible =
      targetRect.top >= containerRect.top + padding &&
      targetRect.bottom <= containerRect.bottom - padding;
    if (!isComfortablyVisible) {
      const offsetWithinScroll = targetRect.top - containerRect.top;
      const desiredTop = Math.max(0, container.scrollTop + offsetWithinScroll - Math.max(24, (container.clientHeight - targetRect.height) * 0.35));
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: desiredTop, behavior: 'smooth' });
      } else {
        container.scrollTop = desiredTop;
      }
    }
  }, [resetOuterScroll]);

  const handleInputFocus = React.useCallback((e) => {
    const target = e?.target;
    if (!target) return;
    requestAnimationFrame(() => {
      try {
        scrollFieldIntoBody(target);
      } catch {}
    });
    // Re-clamp outer containers and re-center inside scrollBody after mobile keyboard / dropdown animation settles
    setTimeout(() => {
      resetOuterScroll();
      if (document.activeElement === target) {
        try {
          scrollFieldIntoBody(target);
        } catch {}
      }
    }, 220);
  }, [resetOuterScroll, scrollFieldIntoBody]);

  useEffect(() => {
    const root = modalRef.current;
    if (!root) return;

    const dialogAncestor = root.closest?.('[role="dialog"], [data-vaul-drawer]') || root.parentElement;

    const isEditableTarget = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const handleViewportResize = () => {
      if (!vv) return;
      const isSmallScreen = window.innerWidth < 768;
      if (!isSmallScreen) {
        setVvHeight(null);
        setVvOffsetTop(0);
        return;
      }
      const heightDiff = Math.round(window.innerHeight - vv.height);
      const offsetTop = Math.max(0, Math.round(vv.offsetTop || 0));
      const viewportShrunkOrPanned = heightDiff > 90 || offsetTop > 2;
      const clampedHeight = Math.max(240, Math.min(Math.round(vv.height), Math.max(240, window.innerHeight - offsetTop)));
      setVvHeight(viewportShrunkOrPanned ? clampedHeight : null);
      setVvOffsetTop(offsetTop);
      requestAnimationFrame(resetOuterScroll);
    };

    const onFocusIn = (e) => {
      if (isEditableTarget(e.target)) {
        if (blurCheckTimerRef.current) clearTimeout(blurCheckTimerRef.current);
        setIsInputFocused(true);
        handleInputFocus(e);
        setTimeout(handleViewportResize, 80);
      }
    };

    const onFocusOut = () => {
      if (blurCheckTimerRef.current) clearTimeout(blurCheckTimerRef.current);
      blurCheckTimerRef.current = setTimeout(() => {
        const active = document.activeElement;
        const stillFocused = isEditableTarget(active) && root.contains(active);
        setIsInputFocused(stillFocused);
        if (!stillFocused) {
          resetOuterScroll();
          handleViewportResize();
        }
      }, 120);
    };

    // Native <select> pickers on mobile can pan visualViewport / raise outer containers without blurring after selection
    const onNativeSelectChange = (e) => {
      if (e.target?.tagName === 'SELECT') {
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
          setTimeout(() => {
            if (document.activeElement === e.target && typeof e.target.blur === 'function') {
              e.target.blur();
            }
            resetOuterScroll();
            handleViewportResize();
          }, 60);
        } else {
          resetOuterScroll();
        }
      }
    };

    const onOuterScrollGuard = (e) => {
      const target = e.target;
      if (target && target !== scrollBodyRef.current && !scrollBodyRef.current?.contains(target)) {
        if (target === root || target === root.parentElement || target === dialogAncestor) {
          if (target.scrollTop !== 0) target.scrollTop = 0;
          if (target.scrollLeft !== 0) target.scrollLeft = 0;
        }
      }
    };

    const onWindowScrollGuard = () => {
      if (typeof window !== 'undefined' && window.innerWidth < 768) {
        resetOuterScroll();
      }
    };

    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('change', onNativeSelectChange);
    root.addEventListener('scroll', onOuterScrollGuard, true);
    if (dialogAncestor && dialogAncestor !== root) {
      dialogAncestor.addEventListener('scroll', onOuterScrollGuard, true);
    }
    window.addEventListener('scroll', onWindowScrollGuard, { passive: true });

    if (vv) {
      vv.addEventListener('resize', handleViewportResize);
      vv.addEventListener('scroll', handleViewportResize);
    }

    return () => {
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('change', onNativeSelectChange);
      root.removeEventListener('scroll', onOuterScrollGuard, true);
      if (dialogAncestor && dialogAncestor !== root) {
        dialogAncestor.removeEventListener('scroll', onOuterScrollGuard, true);
      }
      window.removeEventListener('scroll', onWindowScrollGuard);
      if (blurCheckTimerRef.current) clearTimeout(blurCheckTimerRef.current);
      if (vv) {
        vv.removeEventListener('resize', handleViewportResize);
        vv.removeEventListener('scroll', handleViewportResize);
      }
    };
  }, [handleInputFocus, resetOuterScroll]);

  const stepFocusedField = React.useCallback((direction) => {
    const root = modalRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'))
      .filter(el => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const currentIdx = focusables.indexOf(document.activeElement);
    const nextIdx = currentIdx === -1
      ? 0
      : (currentIdx + direction + focusables.length) % focusables.length;
    const nextEl = focusables[nextIdx];
    nextEl?.focus();
    if (nextEl?.tagName === 'INPUT' && typeof nextEl.select === 'function') {
      try { nextEl.select(); } catch {}
    }
  }, []);

  const dismissMobileKeyboard = React.useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setIsInputFocused(false);
    setTimeout(resetOuterScroll, 60);
  }, [resetOuterScroll]);

  const [expandedHelpMap, setExpandedHelpMap] = useState({});
  const toggleHelpKey = React.useCallback((key) => {
    setExpandedHelpMap(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const [initialDraftData] = useState(() => {
    if (isEdit || initialEditingVariantIndex !== null) return null;
    try {
      const savedDraft = sessionStorage.getItem('config_draft');
      if (!savedDraft) return null;
      const parsed = JSON.parse(savedDraft);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.error('[ConfigModal] Failed to parse draft:', e);
    }
    return null;
  });

  const initialDraftRestored = !!initialDraftData;

  const [cfg, setCfg] = useState(() => {
    if (initialDraftData) {
      return flattenConfig(initialDraftData);
    }
    return flattenConfig(initialConfig);
  });

  const [isDirty, setIsDirty] = useState(initialDraftRestored);
  const [hasPendingSessionChanges, setHasPendingSessionChanges] = useState(initialDraftRestored);
  const isDirtyRef = useRef(isDirty);
  const hasPendingSessionChangesRef = useRef(hasPendingSessionChanges);
  const hasUserLocalOverrideRef = useRef(initialDraftRestored);
  const prevInitialVariantPropRef = useRef(initialEditingVariantIndex);
  const prevIsEditPropRef = useRef(isEdit);
  const suppressDraftSaveRef = useRef(false);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    hasPendingSessionChangesRef.current = hasPendingSessionChanges;
  }, [hasPendingSessionChanges]);

  useEffect(() => {
    const propModeChanged =
      initialEditingVariantIndex !== prevInitialVariantPropRef.current ||
      isEdit !== prevIsEditPropRef.current;
    prevInitialVariantPropRef.current = initialEditingVariantIndex;
    prevIsEditPropRef.current = isEdit;

    if (propModeChanged) {
      hasUserLocalOverrideRef.current = false;
      setHasPendingSessionChanges(false);
      setEditingVariantIdx(initialEditingVariantIndex ?? null);
      setBaseConfigBackup(initialEditingVariantIndex !== null && baseConfig ? flattenConfig(baseConfig) : null);
      if (initialConfig) {
        setCfg(flattenConfig(initialConfig));
      }
      if (isEdit || initialEditingVariantIndex !== null) {
        setSection('summary');
      }
      return;
    }

    if (
      !hasUserLocalOverrideRef.current &&
      !hasPendingSessionChangesRef.current &&
      !isDirtyRef.current &&
      editingVariantIdx === null
    ) {
      if (initialConfig) {
        setCfg(flattenConfig(initialConfig));
      }
    }
  }, [initialConfig, initialEditingVariantIndex, baseConfig, isEdit, editingVariantIdx]);

  useEffect(() => {
    fetchLifetimeAnalytics(cfg?.paper_mode ? 'paper' : 'live');
  }, [fetchLifetimeAnalytics, cfg?.paper_mode]);

  const [section, setSection] = useState('summary')
  const [presetLoaded, setPresetLoaded] = useState(false)
  const [presets, setPresets] = useState([])
  const [presetName, setPresetName] = useState('')
  const [errors, setErrors] = useState({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')
  const [testnetConfigured, setTestnetConfigured] = useState(false)
  const [liveConfigured, setLiveConfigured] = useState(false)
  const [modeWarning, setModeWarning] = useState(null)
  const [loadedPresetName, setLoadedPresetName] = useState(() => {
    if (initialEditingVariantIndex !== null) {
      return baseConfig?.strategy_label || null;
    }
    const stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('loaded_preset_name') : null;
    if (isEdit) {
      return stored && stored === initialConfig?.strategy_label ? stored : null;
    }
    if (initialDraftRestored) {
      return stored || null;
    }
    if (stored && (!initialConfig?.strategy_label || initialConfig.strategy_label === stored)) {
      return stored;
    }
    return null;
  });
  const [presetToDelete, setPresetToDelete] = useState(null);
  const [presetSearch, setPresetSearch] = useState('');
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [selectedPresetNames, setSelectedPresetNames] = useState(new Set());
  const [presetTabFilter, setPresetTabFilter] = useState('all'); // 'all' | 'in_use'
  const [recentlyUsedNames, setRecentlyUsedNames] = useState(() => {
    try {
      const stored = localStorage.getItem('recently_used_presets');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  });

  const recordRecentlyUsed = React.useCallback((name) => {
    if (!name) return;
    setRecentlyUsedNames((prev) => {
      const updated = [name, ...prev.filter(n => n !== name)].slice(0, 10);
      try {
        localStorage.setItem('recently_used_presets', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  }, []);
  const [showPasteOverlay, setShowPasteOverlay] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState(null);
  const [openSectionId, setOpenSectionId] = useState(null);
  const [recentSectionIds, setRecentSectionIds] = useState(() => {
    try {
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('recent_config_sections') : null;
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  const recentSectionIdsRef = useRef(recentSectionIds);
  useEffect(() => {
    recentSectionIdsRef.current = recentSectionIds;
  }, [recentSectionIds]);

  const recordRecentSection = React.useCallback((sectionId) => {
    if (!sectionId) return;
    setRecentSectionIds(prev => {
      if (prev[0] === sectionId) return prev;
      const updated = [sectionId, ...prev.filter(id => id !== sectionId)].slice(0, 24);
      recentSectionIdsRef.current = updated;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('recent_config_sections', JSON.stringify(updated));
        }
      } catch {}
      return updated;
    });
  }, []);

  const computeTabSectionOrder = React.useCallback((tabId, recentIds, errsObj, activeOpenId = null) => {
    const defaults = TAB_SECTION_DEFAULTS[tabId] || [];
    const errSections = new Set(
      Object.keys(errsObj || {})
        .filter(k => !k.endsWith('_warn'))
        .map(k => SECTION_ERROR_MAP[k])
        .filter(Boolean)
    );
    return [...defaults].sort((a, b) => {
      const aErr = errSections.has(a);
      const bErr = errSections.has(b);
      if (aErr !== bErr) return aErr ? -1 : 1;

      if (activeOpenId) {
        if (a === activeOpenId && b !== activeOpenId) return -1;
        if (b === activeOpenId && a !== activeOpenId) return 1;
      }

      const idxA = recentIds.indexOf(a);
      const idxB = recentIds.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;

      return defaults.indexOf(a) - defaults.indexOf(b);
    });
  }, []);

  const [sectionOrderMap, setSectionOrderMap] = useState(() => ({
    scan: computeTabSectionOrder('scan', recentSectionIds, {}),
    strategy: computeTabSectionOrder('strategy', recentSectionIds, {}),
    risk: computeTabSectionOrder('risk', recentSectionIds, {}),
    env: computeTabSectionOrder('env', recentSectionIds, {}),
  }));

  const refreshSectionOrders = React.useCallback((nextRecentIds, errsObj, activeOpenId = null) => {
    setSectionOrderMap({
      scan: computeTabSectionOrder('scan', nextRecentIds, errsObj, activeOpenId),
      strategy: computeTabSectionOrder('strategy', nextRecentIds, errsObj, activeOpenId),
      risk: computeTabSectionOrder('risk', nextRecentIds, errsObj, activeOpenId),
      env: computeTabSectionOrder('env', nextRecentIds, errsObj, activeOpenId),
    });
  }, [computeTabSectionOrder]);

  const blockingErrorSignature = useMemo(
    () => Object.keys(errors).filter(k => !k.endsWith('_warn')).sort().join('|'),
    [errors]
  );

  useEffect(() => {
    if (blockingErrorSignature) {
      refreshSectionOrders(recentSectionIdsRef.current, errors, openSectionId);
    }
  }, [blockingErrorSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSectionChange = React.useCallback((nextTab, targetSectionId = null) => {
    setSection(nextTab);
    let nextRecent = recentSectionIdsRef.current;
    if (targetSectionId) {
      nextRecent = [targetSectionId, ...nextRecent.filter(id => id !== targetSectionId)].slice(0, 24);
      recordRecentSection(targetSectionId);
      setOpenSectionId(targetSectionId);
    }
    refreshSectionOrders(nextRecent, errors, targetSectionId || openSectionId);
  }, [errors, openSectionId, recordRecentSection, refreshSectionOrders]);

  const handleToggleSection = React.useCallback((sectionId) => {
    setOpenSectionId(prev => {
      const willOpen = prev !== sectionId;
      if (willOpen) recordRecentSection(sectionId);
      return willOpen ? sectionId : null;
    });
  }, [recordRecentSection]);

  const orderSectionEntries = React.useCallback((tabId, sectionsMap) => {
    const order = sectionOrderMap[tabId] || TAB_SECTION_DEFAULTS[tabId] || Object.keys(sectionsMap);
    return order.map((id) => {
      const el = sectionsMap[id];
      if (!el) return null;
      return React.cloneElement(el, {
        key: id,
        onToggle: () => handleToggleSection(id),
        onInteract: () => recordRecentSection(id),
      });
    }).filter(Boolean);
  }, [sectionOrderMap, handleToggleSection, recordRecentSection]);

  const openFullSection = React.useCallback((tabId, collapsibleId = null) => {
    handleSectionChange(tabId, collapsibleId);
    resetOuterScroll();
  }, [handleSectionChange, resetOuterScroll]);

  // Canonical list of staged variants across base & variant-editing views
  const activeVariants = useMemo(() => {
    if (editingVariantIdx !== null && baseConfigBackup) {
      return Array.isArray(baseConfigBackup.strategy_variants) ? baseConfigBackup.strategy_variants : [];
    }
    return Array.isArray(cfg.strategy_variants) ? cfg.strategy_variants : [];
  }, [editingVariantIdx, baseConfigBackup, cfg.strategy_variants]);

  const persistDraft = React.useCallback((nextCfg, nextLoadedName) => {
    if (isEdit || typeof sessionStorage === 'undefined' || suppressDraftSaveRef.current) return;
    try {
      sessionStorage.setItem('config_draft', JSON.stringify(nextCfg));
      if (nextLoadedName) {
        sessionStorage.setItem('loaded_preset_name', nextLoadedName);
      } else {
        sessionStorage.removeItem('loaded_preset_name');
      }
    } catch (e) {
      console.error('[ConfigModal] Failed to persist draft:', e);
    }
  }, [isEdit]);

  // Auto-focus container on mount for accessible keyboard navigation
  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  // Dismiss modal on Escape key globally, avoiding conflicts with active inputs
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        const activeTag = document.activeElement?.tagName;
        if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [onClose]);


  const sessionRecency = useMemo(() => {
    const activeNames = new Set();
    const lastUsedTsByName = new Map();
    const sessions = Array.isArray(sessionList) ? sessionList : [];
    for (const s of sessions) {
      if (!s) continue;
      const baseLabel = s.strategyLabel || s.config?.strategy_label;
      const ts = Math.max(
        Number(s.startTimeMs) || 0,
        s.endTime ? (new Date(s.endTime).getTime() || 0) : 0,
        s.startTime ? (new Date(s.startTime).getTime() || 0) : 0,
      );
      const isRunning = s.status === 'active' || (sessionActive && !s.endTime);
      const variantLabels = Array.isArray(s.config?.strategy_variants)
        ? s.config.strategy_variants.map(v => v?.strategy_label).filter(Boolean)
        : [];
      for (const lbl of [baseLabel, ...variantLabels]) {
        if (!lbl) continue;
        if (isRunning) activeNames.add(lbl);
        if (ts > (lastUsedTsByName.get(lbl) || 0)) {
          lastUsedTsByName.set(lbl, ts);
        }
      }
    }
    return { activeNames, lastUsedTsByName };
  }, [sessionList, sessionActive]);

  const activeBasePresetName = useMemo(() => {
    if (baseConfigBackup) {
      return baseConfigBackup.strategy_label || loadedPresetName || null;
    }
    return loadedPresetName || (isEdit ? (initialConfig?.strategy_label || cfg.strategy_label) : null);
  }, [baseConfigBackup, loadedPresetName, isEdit, initialConfig?.strategy_label, cfg.strategy_label]);

  const filteredPresets = useMemo(() => {
    let list = Array.isArray(presets) ? presets : [];

    const searchLower = presetSearch.toLowerCase().trim();
    if (searchLower) {
      list = list.filter(p => p && typeof p.name === 'string' && p.name.toLowerCase().includes(searchLower));
    }

    if (presetTabFilter !== 'all') {
      if (presetTabFilter === 'variants') {
        const variantsSet = new Set(activeVariants.map(v => v?.strategy_label));
        list = list.filter(p => variantsSet.has(p.name));
      } else {
        list = list.filter(p => {
          const pMode = p.config?.trading_mode || (p.config?.paper_mode ? 'paper' : 'live');
          return pMode === presetTabFilter;
        });
      }
    }

    const variantOrderMap = new Map();
    activeVariants.forEach((v, idx) => {
      if (v?.strategy_label && !variantOrderMap.has(v.strategy_label)) {
        variantOrderMap.set(v.strategy_label, idx);
      }
    });

    const getBubbleTier = (p) => {
      if (activeBasePresetName && p.name === activeBasePresetName && !variantOrderMap.has(p.name)) return 0; // Active Base
      if (variantOrderMap.has(p.name)) return 1; // Active Variants
      if (sessionRecency.activeNames.has(p.name)) return 2; // Active Session(s)
      if (recentlyUsedNames.includes(p.name) || sessionRecency.lastUsedTsByName.has(p.name)) return 3; // Latest Used
      return 4;
    };

    // Bubble active base, active variants, active sessions, and latest used sessions/presets to the top
    return [...list].sort((a, b) => {
      const tierA = getBubbleTier(a);
      const tierB = getBubbleTier(b);
      if (tierA !== tierB) return tierA - tierB;

      if (tierA === 1) {
        return variantOrderMap.get(a.name) - variantOrderMap.get(b.name);
      }

      if (tierA === 3) {
        const idxA = recentlyUsedNames.indexOf(a.name);
        const idxB = recentlyUsedNames.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        const tsA = sessionRecency.lastUsedTsByName.get(a.name) || 0;
        const tsB = sessionRecency.lastUsedTsByName.get(b.name) || 0;
        if (tsA !== tsB) return tsB - tsA;
      }

      return a.name.localeCompare(b.name);
    });
  }, [presets, presetSearch, presetTabFilter, activeVariants, recentlyUsedNames, activeBasePresetName, sessionRecency]);


  // Persist uncommitted New Session drafts with short debounce so closing right after edits never loses state
  useEffect(() => {
    if (isEdit || editingVariantIdx !== null || suppressDraftSaveRef.current) return;
    if (!isDirty && !hasPendingSessionChanges && !loadedPresetName) return;
    const timer = setTimeout(() => {
      persistDraft(cfg, loadedPresetName);
    }, 200);
    return () => clearTimeout(timer);
  }, [cfg, loadedPresetName, isDirty, hasPendingSessionChanges, isEdit, editingVariantIdx, persistDraft]);

  const getValidationErrors = React.useCallback((c) => {
    const errs = {}; if (!c.scan_interval) errs.scan_interval = 'Required'; if (c.scan_lookback < 1) errs.scan_lookback = 'Min 1';
    if (!Number.isFinite(Number(c.slippage_warning_threshold)) || Number(c.slippage_warning_threshold) < 0 || Number(c.slippage_warning_threshold) > 100) {
      errs.slippage_warning_threshold = 'Saved value is invalid. Enter a warning percentage between 0 and 100.';
    }
    if (c.scan_mode === 'active_window' && (!c.scan_window_duration_sec || !c.scan_check_interval_sec)) errs.scan_mode = 'Params missing';

    // DEPLOY-05: Harden validation against missing API keys for chosen trading mode
    const mode = c.trading_mode || (c.paper_mode ? 'paper' : 'live');
    if (mode === 'testnet' && !testnetConfigured) {
      errs.trading_mode = 'Testnet API keys required';
    } else if (mode === 'live' && !liveConfigured) {
      errs.trading_mode = 'Live API keys required';
    }

    if (c.risk_pct_per_trade > c.max_total_risk_pct) {
      errs.risk_pct_per_trade = 'Exceeds max total risk'
    }

    if (!c.max_open_trades || c.max_open_trades < 1) {
      errs.max_open_trades = 'Min 1';
    }

    if (c.sl_distance_pct <= 0) {
      errs.sl_distance_pct = 'Must be > 0';
    }

    if (c.risk_pct_per_trade > 4) {
      errs.risk_pct_per_trade_warn = 'Aggressive (>4%)'
    }

    if (c.release_risk_on_est_pnl_be) {
      const releaseMode = c.release_risk_est_pnl_mode === 'rr' ? 'rr' : 'usdt';
      const thresholdKey = releaseMode === 'rr' ? 'release_risk_est_pnl_min_rr' : 'release_risk_est_pnl_min_usdt';
      const minEstVal = c[thresholdKey];
      const limit = releaseMode === 'rr' ? 1000 : 100000;
      if (minEstVal !== undefined && minEstVal !== null && minEstVal !== '' && (!Number.isFinite(Number(minEstVal)) || Number(minEstVal) < -limit || Number(minEstVal) > limit)) {
        errs[thresholdKey] = releaseMode === 'rr' ? 'Invalid R:R' : 'Invalid USDT';
      }
    }

    if (c.martingale_enabled) {
      if (c.martingale_multiplier < 1 || c.martingale_multiplier > 10) errs.martingale_multiplier = 'Must be 1-10';
      if (c.martingale_reset_threshold_pct < CONFIG_LIMITS.RISK_PER_TRADE_MIN || c.martingale_reset_threshold_pct > CONFIG_LIMITS.RISK_PER_TRADE_MAX) errs.martingale_reset_threshold_pct = `Must be ${CONFIG_LIMITS.RISK_PER_TRADE_MIN}-${CONFIG_LIMITS.RISK_PER_TRADE_MAX}`;
      if (c.martingale_max_steps < 1 || c.martingale_max_steps > 20) errs.martingale_max_steps = 'Must be 1-20';
    }

    if (c.sl_distance_pct > 5) {
      errs.sl_distance_pct_warn = 'Aggressive (>5%)'
    }

    const totalWeight = Number(c.scanner_weights_momentum || 0) + Number(c.scanner_weights_volatility || 0) + Number(c.scanner_weights_trend || 0);
    if (Math.abs(totalWeight - 100) > 0.1) {
       errs.scanner_weights_momentum = 'Sum must be 100%';
    }
    if (c.scanner_signal_depth < 1) errs.scanner_signal_depth = 'Min 1';

    setErrors(errs);
    return errs;
  }, [testnetConfigured, liveConfigured]);

  const validate = React.useCallback((c) => {
    const errs = getValidationErrors(c);
    return Object.keys(errs).filter(k => !k.endsWith('_warn')).length === 0;
  }, [getValidationErrors]);

  const getSectionErrorInfo = React.useCallback((sectionId) => {
    let errorCount = 0;
    for (const key of Object.keys(errors)) {
      if (key.endsWith('_warn')) continue;
      if (SECTION_ERROR_MAP[key] === sectionId) {
        errorCount += 1;
      }
    }
    return { hasError: errorCount > 0, errorCount };
  }, [errors]);

  const generatedPresetName = useMemo(() => {
    if (loadedPresetName && typeof loadedPresetName === 'string' && loadedPresetName.trim()) {
      return loadedPresetName.trim();
    }
    return generateSmartStrategyName(cfg, {
      maxLen: STRATEGY_NAME_CHAR_LIMITS.STANDARD,
      style: 'standard',
    });
  }, [cfg, loadedPresetName]);

  const fetchPresets = React.useCallback(async () => {
    try {
      console.log('[ConfigModal] Loading presets...');
      const res = await presetsAPI.list();
      let rawData = res?.data;
      if (rawData && !Array.isArray(rawData)) {
        if (Array.isArray(rawData.presets)) {
          rawData = rawData.presets;
        } else if (Array.isArray(rawData.data)) {
          rawData = rawData.data;
        }
      }
      if (Array.isArray(rawData)) {
        const validPresets = rawData.filter(p => p && typeof p === 'object' && typeof p.name === 'string');
        setPresets(validPresets);
        if (isEdit && initialEditingVariantIndex === null && initialConfig?.strategy_label) {
          const matching = validPresets.find(p => p.name === initialConfig.strategy_label);
          if (matching) {
            setLoadedPresetName(prev => prev || matching.name);
          }
        }
        console.log(`[ConfigModal] Loaded ${validPresets.length} presets.`);
      } else {
        const msg = typeof res?.data === 'string' && (res.data.includes('<!DOCTYPE') || res.data.includes('<html'))
          ? 'Presets request returned HTML (non-JSON). Reverse proxy or backend route /presets may not be routed correctly.'
          : 'Presets response was invalid or not a JSON array.';
        console.warn('[ConfigModal]', msg, res?.data);
        setPresets([]);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('system-api-error', {
            detail: {
              type: 'non-json',
              url: '/presets',
              message: msg,
            }
          }));
        }
      }
    } catch (e) {
      console.error('[ConfigModal] Error loading presets:', e);
      setPresets([]);
      const isHtml = e.isNonJson || (e.response && typeof e.response.data === 'string' && (e.response.data.includes('<!DOCTYPE') || e.response.data.includes('<html')));
      const msg = isHtml
        ? 'Presets endpoint /presets returned non-JSON (HTML response). Check backend connectivity.'
        : (e.message || 'Failed to load strategy presets.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('system-api-error', {
          detail: {
            type: isHtml ? 'non-json' : 'network-error',
            url: '/presets',
            status: e.response?.status,
            message: msg,
          }
        }));
      }
      if (addAlert) {
        addAlert({ level: 'error', title: 'Load Failed', message: msg });
      }
    }
  }, [addAlert]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  // Check API key configuration for testnet and live modes
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await settingsAPI.getKeys()
        const tn = !!res.data.testnet_api_key
        const ln = !!res.data.api_key
        setTestnetConfigured(tn)
        setLiveConfigured(ln)
      } catch (e) {
        console.log('[ConfigModal] Error checking keys:', e.message)
        setTestnetConfigured(false)
        setLiveConfigured(false)
      }
    }
    checkConfig()
  }, [])

  // Fetch lifetime analytics for the current mode
  useEffect(() => {
    if (fetchLifetimeAnalytics) {
      const mode = cfg.trading_mode || (cfg.paper_mode ? 'paper' : 'live');
      fetchLifetimeAnalytics(mode);
    }
  }, [fetchLifetimeAnalytics, cfg.trading_mode, cfg.paper_mode]);

  const setField = React.useCallback((key, value) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const next = { ...prev, [key]: value };
      // BOLT: Floating-point precision guard for weights to prevent intermittent sum warnings
      if (key.startsWith('scanner_weights_')) {
        const w1 = Number(next.scanner_weights_momentum || 0);
        const w2 = Number(next.scanner_weights_volatility || 0);
        const w3 = Number(next.scanner_weights_trend || 0);
        const total = w1 + w2 + w3;
        if (Math.abs(total - 100) < 0.01 && total !== 100) {
           // Auto-adjust trend weight to hit exactly 100 if we are within 0.01 tolerance
           next.scanner_weights_trend = Number((100 - w1 - w2).toFixed(2));
        }
      }
      return next;
    });
  }, []);

  const handleToggleRequiredEntry = React.useCallback((sigKey) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const currentReq = Array.isArray(prev.required_signals) ? prev.required_signals : [];
      const isReq = currentReq.includes(sigKey);
      const nextReq = isReq ? currentReq.filter(s => s !== sigKey) : [...currentReq, sigKey];
      return { ...prev, required_signals: nextReq };
    });
  }, []);

  const handleToggleRequiredExit = React.useCallback((sigKey) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const currentReq = Array.isArray(prev.required_exit_signals) ? prev.required_exit_signals : [];
      const isReq = currentReq.includes(sigKey);
      const nextReq = isReq ? currentReq.filter(s => s !== sigKey) : [...currentReq, sigKey];
      return { ...prev, required_exit_signals: nextReq };
    });
  }, []);

  const handleToggleExitSignal = React.useCallback((baseKey, active) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const next = { ...prev };
      const currentExitSignals = Array.isArray(prev.exit_signals) ? prev.exit_signals : [];

      if (active) {
        // Toggling OFF: remove base signal AND all its chained layers
        next.exit_signals = currentExitSignals.filter(sig => sig !== baseKey && !isSignalLayer(sig, baseKey));

        // Clean up delays, actions, and timeframes
        const nextDelays = { ...(prev.exit_signal_delays || {}) };
        const nextActions = { ...(prev.exit_signal_actions || {}) };
        const nextTimeframes = { ...(prev.signal_timeframes || {}) };

        delete nextDelays[baseKey];
        delete nextActions[baseKey];
        delete nextTimeframes[baseKey];

        Object.keys(nextDelays).forEach(k => {
          if (isSignalLayer(k, baseKey)) delete nextDelays[k];
        });
        Object.keys(nextActions).forEach(k => {
          if (isSignalLayer(k, baseKey)) delete nextActions[k];
        });
        Object.keys(nextTimeframes).forEach(k => {
          if (isSignalLayer(k, baseKey)) delete nextTimeframes[k];
        });

        next.exit_signal_delays = nextDelays;
        next.exit_signal_actions = nextActions;
        next.signal_timeframes = nextTimeframes;
      } else {
        // Toggling ON: add base signal
        next.exit_signals = [...currentExitSignals, baseKey];

        // Initialize base signal delay, action, timeframe, and schema defaults
        next.exit_signal_delays = { ...(prev.exit_signal_delays || {}), [baseKey]: 0 };
        next.exit_signal_actions = { ...(prev.exit_signal_actions || {}), [baseKey]: 'close' };
        next.signal_timeframes = { ...(prev.signal_timeframes || {}), [baseKey]: 'default' };

        const schema = getSignalParamsSchema(baseKey, baseKey, (prev.enabled_signals || []).includes(baseKey), true);
        schema.forEach(field => {
          if (next[field.key] === undefined) {
            next[field.key] = field.defaultValue;
          }
        });
      }
      return next;
    });
  }, []);

  const handleAddLayer = React.useCallback((baseKey) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const currentExitSignals = Array.isArray(prev.exit_signals) ? prev.exit_signals : [];
      let suffixNum = 2;
      while (currentExitSignals.includes(`${baseKey}_${suffixNum}`)) {
        suffixNum++;
      }
      const newLayerKey = `${baseKey}_${suffixNum}`;

      const next = {
        ...prev,
        exit_signals: [...currentExitSignals, newLayerKey],
        exit_signal_delays: { ...(prev.exit_signal_delays || {}), [newLayerKey]: 0 },
        exit_signal_actions: { ...(prev.exit_signal_actions || {}), [newLayerKey]: 'close' },
        signal_timeframes: { ...(prev.signal_timeframes || {}), [newLayerKey]: 'default' }
      };

      const schema = getSignalParamsSchema(newLayerKey, baseKey, (prev.enabled_signals || []).includes(newLayerKey), true);
      schema.forEach(field => {
        if (next[field.key] === undefined) {
          next[field.key] = field.defaultValue;
        }
      });

      return next;
    });
  }, []);

  const handleRemoveLayer = React.useCallback((layerKey) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const nextDelays = { ...(prev.exit_signal_delays || {}) };
      delete nextDelays[layerKey];

      const nextActions = { ...(prev.exit_signal_actions || {}) };
      delete nextActions[layerKey];

      const nextTimeframes = { ...(prev.signal_timeframes || {}) };
      delete nextTimeframes[layerKey];

      return {
        ...prev,
        exit_signals: (Array.isArray(prev.exit_signals) ? prev.exit_signals : []).filter(sig => sig !== layerKey),
        exit_signal_delays: nextDelays,
        exit_signal_actions: nextActions,
        signal_timeframes: nextTimeframes
      };
    });
  }, []);

  const handleUpdateLayer = React.useCallback((layerKey, field, value) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const next = { ...prev };
      if (field === 'timeframe') {
        const nextTimeframes = { ...(prev.signal_timeframes || {}) };
        if (value === 'default') {
          nextTimeframes[layerKey] = 'default';
        } else {
          nextTimeframes[layerKey] = value;
        }
        next.signal_timeframes = nextTimeframes;
      } else if (field === 'delay') {
        next.exit_signal_delays = { ...(prev.exit_signal_delays || {}), [layerKey]: value };
      } else if (field === 'action') {
        next.exit_signal_actions = { ...(prev.exit_signal_actions || {}), [layerKey]: value };
      }
      return next;
    });
  }, []);

  const handleToggleEntrySignal = React.useCallback((baseKey, active) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const next = { ...prev };
      const currentEntrySignals = Array.isArray(prev.enabled_signals) ? prev.enabled_signals : [];

      if (active) {
        next.enabled_signals = currentEntrySignals.filter(sig => sig !== baseKey && !isSignalLayer(sig, baseKey));

        const nextTimeframes = { ...(prev.signal_timeframes || {}) };
        delete nextTimeframes[baseKey];
        Object.keys(nextTimeframes).forEach(k => {
          if (isSignalLayer(k, baseKey)) delete nextTimeframes[k];
        });

        next.signal_timeframes = nextTimeframes;
      } else {
        next.enabled_signals = [...currentEntrySignals, baseKey];
        next.signal_timeframes = { ...(prev.signal_timeframes || {}), [baseKey]: 'default' };

        const schema = getSignalParamsSchema(baseKey, baseKey, true, (prev.exit_signals || []).includes(baseKey));
        schema.forEach(field => {
          if (next[field.key] === undefined) {
            next[field.key] = field.defaultValue;
          }
        });
      }
      return next;
    });
  }, []);

  const handleAddEntryLayer = React.useCallback((baseKey) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const currentEntrySignals = Array.isArray(prev.enabled_signals) ? prev.enabled_signals : [];
      let suffixNum = 2;
      while (currentEntrySignals.includes(`${baseKey}_${suffixNum}`)) {
        suffixNum++;
      }
      const newLayerKey = `${baseKey}_${suffixNum}`;

      const next = {
        ...prev,
        enabled_signals: [...currentEntrySignals, newLayerKey],
        signal_timeframes: { ...(prev.signal_timeframes || {}), [newLayerKey]: 'default' }
      };

      const schema = getSignalParamsSchema(newLayerKey, baseKey, true, (prev.exit_signals || []).includes(newLayerKey));
      schema.forEach(field => {
        if (next[field.key] === undefined) {
          next[field.key] = field.defaultValue;
        }
      });

      return next;
    });
  }, []);

  const handleRemoveEntryLayer = React.useCallback((layerKey) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const nextTimeframes = { ...(prev.signal_timeframes || {}) };
      delete nextTimeframes[layerKey];

      return {
        ...prev,
        enabled_signals: (prev.enabled_signals || []).filter(sig => sig !== layerKey),
        signal_timeframes: nextTimeframes
      };
    });
  }, []);

  const handleUpdateEntryLayer = React.useCallback((layerKey, field, value) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const next = { ...prev };
      if (field === 'timeframe') {
        const nextTimeframes = { ...(prev.signal_timeframes || {}) };
        if (value === 'default') {
          nextTimeframes[layerKey] = 'default';
        } else {
          nextTimeframes[layerKey] = value;
        }
        next.signal_timeframes = nextTimeframes;
      }
      return next;
    });
  }, []);
  
  const resetToLastSaved = React.useCallback(() => {
    suppressDraftSaveRef.current = true;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('config_draft');
    }
    const restoredIdx = initialEditingVariantIndex ?? null;
    setEditingVariantIdx(restoredIdx);
    setBaseConfigBackup(restoredIdx !== null && baseConfig ? flattenConfig(baseConfig) : null);
    setCfg(flattenConfig(initialConfig));
    hasUserLocalOverrideRef.current = false;
    setHasPendingSessionChanges(false);
    setIsDirty(false);
    setErrors({});
  }, [initialConfig, initialEditingVariantIndex, baseConfig]);
  
  const handleModeSelect = React.useCallback((mode) => {
    setModeWarning(null)
    if (mode === 'testnet' && !testnetConfigured) {
      setModeWarning('Testnet API keys not configured. Please add them in Settings first.')
      return
    }
    if (mode === 'live' && !liveConfigured) {
      setModeWarning('Live API keys not configured. Please add them in Settings first.')
      return
    }
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    setCfg(prev => {
      const next = {
        ...prev,
        trading_mode: mode,
        paper_mode: mode === 'paper'
      }
      validate(next)
      return next
    })
  }, [testnetConfigured, liveConfigured, validate]);

  const buildConfigToSave = React.useCallback(() => {
    // If currently editing a variant, merge variant into baseConfigBackup to preserve base strategy
    if (editingVariantIdx !== null && baseConfigBackup) {
      const base = { ...baseConfigBackup };
      const variants = [...(base.strategy_variants || [])];
      const sanitizedVariant = coerceAndSanitizeConfig(cfg, true);
      delete sanitizedVariant.strategy_variants;
      const vLabel = cfg.strategy_label || `Variant ${editingVariantIdx + 1}`;
      sanitizedVariant.strategy_label = vLabel;
      if (editingVariantIdx >= 0 && editingVariantIdx < variants.length) {
        variants[editingVariantIdx] = sanitizedVariant;
      } else {
        variants.push(sanitizedVariant);
      }
      base.strategy_variants = variants;
      return coerceAndSanitizeConfig(base, false);
    }

    const rawLabel = (cfg.strategy_label && cfg.strategy_label.trim())
      ? cfg.strategy_label.trim()
      : (presetName || loadedPresetName || generatedPresetName || initialConfig?.strategy_label || 'Base Strategy');
    const c = { ...cfg, strategy_label: rawLabel };
    delete c.__flattened;

    // Dynamically reconstruct the signal_params map from any flat keys prefix-matched with signal_params_
    const sp = {};
    Object.keys(cfg).forEach(k => {
      if (k.startsWith('signal_params_') && k !== 'signal_params') {
        const paramKey = k.substring('signal_params_'.length);
        const val = cfg[k];
        if (val !== undefined && val !== null) {
          if (val === 'true' || val === true) {
            sp[paramKey] = true;
          } else if (val === 'false' || val === false) {
            sp[paramKey] = false;
          } else if (!Number.isNaN(Number(val)) && typeof val !== 'boolean') {
            sp[paramKey] = Number(val);
          } else {
            sp[paramKey] = val;
          }
        }
      }
    });
    c.signal_params = sp;

    // Ensure numeric values where expected
    const numericFields = [
      'risk_pct_per_trade', 'max_total_risk_pct', 'max_open_trades', 'total_sl_guard_usdt',
      'max_single_trade_risk_pct',
      'smart_watchlist_sensitivity',
      'trailing_stop_distance_pct',
      'trailing_stop_rr',
      'knife_trailing_distance_pct',
      'knife_auto_ratchet_be_rr',
      'knife_auto_ratchet_lock_rr',
      'anti_whipsaw_candle_delay',
      'anti_whipsaw_tf_delay_min',
      'scan_pct_threshold', 'scan_lookback', 'scan_min_volume_usdt', 'watchlist_size',
      'watchlist_offset', 'sl_distance_pct', 'sl_min_pct', 'sl_max_pct', 'trailing_guard_buffer_pct',
      'tp_ratio', 'max_trades_per_period', 'trades_period_min', 'max_trades_24h',
      'scanner_signal_depth',
      'engulfing_lookback', 'engulfing_streak', 'engulfing_max_expansion_pct',
      'htf_breakout_lookback', 'htf_breakout_buffer_pct', 'htf_breakout_max_expansion_pct',
      'macd_pbc_trend_ema', 'macd_pbc_lookback', 'macd_pbc_max_continuation',
      'min_trade_interval_min', 'trades_jitter_pct', 'paper_starting_balance',
      'testnet_starting_balance', 'live_starting_balance', 'hot_loop_interval_ms',
      'main_loop_interval_ms', 'sl_lookback_period', 'sl_pct_limit',
      'max_open_trades_per_symbol', 'tod_min_winrate', 'leverage',
      'slippage_abort_threshold', 'htf_ema_cross_count', 'htf_ema_fast_period',
      'htf_ema_slow_period', 'htf_ema_cross_max_boost', 'htf_ema_cross_rr_weight',
      'watchlist_max_symbols', 'watchlist_rotate_interval_min', 'watchlist_min_score',
      'switched_sl_distance_pct', 'peak_rr_switch_threshold', 'peak_rr_switch_count',
      'trailing_activation_rr', 'auto_scale_max_overshoot',
      'auto_adjust_max_trades_min', 'auto_adjust_max_trades_max', 'auto_adjust_max_trades_step',
      'release_risk_est_pnl_min_usdt',
      'release_risk_est_pnl_min_rr',
      'scan_window_duration_sec', 'scan_check_interval_sec',
      'martingale_multiplier', 'martingale_max_steps', 'martingale_reset_threshold_pct'
    ];

    numericFields.forEach(f => {
      if (c[f] !== undefined && c[f] !== null) {
        if (c[f] === '' || (typeof c[f] === 'string' && c[f].trim() === '')) {
          delete c[f];
        } else {
          const num = Number(c[f]);
          if (Number.isFinite(num)) c[f] = num;
          else delete c[f];
        }
      }
    });

    if (typeof c.anti_whipsaw_timeframes === 'string') {
      c.anti_whipsaw_timeframes = c.anti_whipsaw_timeframes.split(',').map(s => s.trim()).filter(Boolean);
    } else if (!Array.isArray(c.anti_whipsaw_timeframes)) {
      c.anti_whipsaw_timeframes = [];
    }
    if (c.anti_whipsaw_max_tf) {
      c.anti_whipsaw_max_tf = String(c.anti_whipsaw_max_tf).trim();
    }
    c.anti_whipsaw_per_strategy = c.anti_whipsaw_per_strategy !== false;

    c.htf_ema_cross_boost_enabled = c.htf_ema_cross_boost_enabled !== false;
    c.htf_ema_cross_interval = c.htf_ema_cross_interval || '4h';

    c.scanner_weights = {
      momentum: Number(cfg.scanner_weights_momentum || 0) / 100,
      volatility: Number(cfg.scanner_weights_volatility || 0) / 100,
      trend: Number(cfg.scanner_weights_trend || 0) / 100
    };

    // Remove flattened UI fields after bundling into scanner_weights object
    delete c.scanner_weights_momentum;
    delete c.scanner_weights_volatility;
    delete c.scanner_weights_trend;

    if (c.hibernation_grace_period_sec !== undefined && c.hibernation_grace_period_sec !== null && c.hibernation_grace_period_sec !== '') {
      const num = Number(c.hibernation_grace_period_sec);
      if (Number.isFinite(num)) c.hibernation_grace_period_sec = num;
      else delete c.hibernation_grace_period_sec;
    } else {
      delete c.hibernation_grace_period_sec;
    }

    // UI Conversion: UI percentage back to backend decimal
    if (c.slippage_warning_threshold !== undefined && c.slippage_warning_threshold !== null && c.slippage_warning_threshold !== '') {
      const num = Number(c.slippage_warning_threshold);
      if (Number.isFinite(num)) c.slippage_warning_threshold = num / 100;
      else delete c.slippage_warning_threshold;
    } else {
      delete c.slippage_warning_threshold;
    }
    c.strategy_variants = (cfg.strategy_variants || []).filter(Boolean).map((v) => {
      return coerceAndSanitizeConfig({ ...v, strategy_label: v.strategy_label || 'Variant' }, true);
    });

    // Clean up temporary UI fields
    Object.keys(c).forEach(k => {
      if (k.startsWith('signal_params_') && k !== 'signal_params') {
        delete c[k];
      }
    });

    return c;
  }, [cfg, presetName, loadedPresetName, generatedPresetName, editingVariantIdx, baseConfigBackup, initialConfig?.strategy_label]);

  // Atomically sync variant list updates across both cfg and baseConfigBackup (and keep editingVariantIdx valid)
  const updateVariantsList = React.useCallback((updater) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setIsDirty(true);
    setHasPendingSessionChanges(true);

    const sourceList = (editingVariantIdx !== null && baseConfigBackup)
      ? (baseConfigBackup.strategy_variants || [])
      : (cfg.strategy_variants || []);
    const nextVariants = updater(Array.isArray(sourceList) ? sourceList : []);
    const editingTarget = (editingVariantIdx !== null) ? sourceList[editingVariantIdx] : null;

    if (editingVariantIdx !== null && baseConfigBackup) {
      const updatedBackup = { ...baseConfigBackup, strategy_variants: nextVariants };
      const survivingIdx = editingTarget
        ? (nextVariants.indexOf(editingTarget) !== -1
            ? nextVariants.indexOf(editingTarget)
            : nextVariants.findIndex(v => v?.strategy_label === editingTarget.strategy_label))
        : -1;

      if (survivingIdx === -1) {
        setBaseConfigBackup(null);
        setEditingVariantIdx(null);
        const restoredBase = flattenConfig(updatedBackup);
        setCfg(restoredBase);
        if (!isEdit) persistDraft(restoredBase, loadedPresetName);
      } else {
        setEditingVariantIdx(survivingIdx);
        setBaseConfigBackup(updatedBackup);
        setCfg(prev => ({ ...prev, strategy_variants: nextVariants }));
      }
    } else {
      const nextCfg = { ...cfg, strategy_variants: nextVariants };
      setCfg(nextCfg);
      if (!isEdit) persistDraft(nextCfg, loadedPresetName);
    }
  }, [editingVariantIdx, baseConfigBackup, cfg, isEdit, persistDraft, loadedPresetName]);

  const savePreset = React.useCallback(async (explicitName) => {
    const resolvePresetName = () => {
      if (explicitName) return explicitName;
      if (presetName) return presetName;
      if (explicitName === undefined && loadedPresetName) return loadedPresetName;
      return generatedPresetName || '';
    };

    const name = resolvePresetName().trim();
    console.log(`[ConfigModal] Attempting to save preset: "${name}"`);

    try {
      if (!validate(cfg)) {
        console.warn('[ConfigModal] Validation failed for preset save. Check other tabs for errors.');
        addAlert({
          level: 'error',
          title: 'Validation Failed',
          message: 'The strategy configuration has errors. Please check the Scanner, Strategy, and Risk tabs before saving.'
        });
        return;
      }

      if (!name) {
        addAlert({ level: 'warn', title: 'Missing Name', message: 'Please provide a name for this strategy preset.' });
        return;
      }

      setIsSaving(true);
      const isEditingVariant = editingVariantIdx !== null;
      let sourceConfig;
      try {
        sourceConfig = isEditingVariant ? coerceAndSanitizeConfig(cfg, true) : buildConfigToSave();
      } catch (buildErr) {
        console.error('[ConfigModal] Critical error building config:', buildErr);
        addAlert({ level: 'error', title: 'Internal Error', message: 'Failed to construct configuration object. Check console for details.' });
        setIsSaving(false);
        return;
      }

      console.log(`[ConfigModal] Sending save request to API for "${name}"...`);

      const presetVariants = isEditingVariant
        ? []
        : (Array.isArray(sourceConfig.strategy_variants)
            ? sourceConfig.strategy_variants.map(v => coerceAndSanitizeConfig(v, true))
            : []);
      const presetPayload = {
        ...sourceConfig,
        strategy_label: name,
        strategy_variants: presetVariants
      };

      const res = await presetsAPI.save(name, presetPayload);

      if (res && res.data) {
        console.log(`[ConfigModal] Preset "${name}" saved successfully.`);
        setPresets(prev => {
          const safePrev = Array.isArray(prev) ? prev : [];
          const savedPreset = res.data?.preset || res.data;
          if (!savedPreset || typeof savedPreset !== 'object' || !savedPreset.name) {
            return safePrev;
          }
          const nextPresets = [...safePrev.filter(p => p && p.name !== name), savedPreset];
          return nextPresets.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        });
        setPresetName('');
        hasUserLocalOverrideRef.current = true;
        if (!isEditingVariant) {
          setLoadedPresetName(name);
          setCfg(prev => {
            const nextCfg = { ...prev, strategy_label: name };
            if (!isEdit) persistDraft(nextCfg, name);
            return nextCfg;
          });
        } else {
          // Sync updated variant back into baseConfigBackup and cfg.strategy_variants so Done/Apply keeps the update
          const stagedCopy = { ...sourceConfig, strategy_label: name, strategy_variants: [] };
          setBaseConfigBackup(prevBackup => {
            if (!prevBackup) return prevBackup;
            const variants = [...(prevBackup.strategy_variants || [])];
            if (editingVariantIdx >= 0 && editingVariantIdx < variants.length) {
              variants[editingVariantIdx] = stagedCopy;
            }
            return { ...prevBackup, strategy_variants: variants };
          });
          setCfg(prev => {
            const variants = [...(prev.strategy_variants || [])];
            if (editingVariantIdx >= 0 && editingVariantIdx < variants.length) {
              variants[editingVariantIdx] = stagedCopy;
            }
            return { ...prev, strategy_label: name, strategy_variants: variants };
          });
          setHasPendingSessionChanges(true);
        }
        recordRecentlyUsed(name);
        if (isEdit && !isEditingVariant) {
          setHasPendingSessionChanges(true);
        }
        setIsDirty(false);
        setSaveSuccess(true);
        addAlert({ level: 'success', title: 'Preset Saved', message: `Strategy "${name}" has been stored in the database.` });
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (e) {
      console.error('[ConfigModal] Error saving preset:', e);

      let errMsg = 'Could not store strategy preset in the database.';
      if (e.response?.data?.detail && Array.isArray(e.response.data.detail)) {
        const extractConstraints = (errs) => {
          return errs.flatMap(err => {
            const current = err.constraints ? [`${err.property}: ${Object.values(err.constraints).join(', ')}`] : [];
            const nested = err.children ? extractConstraints(err.children) : [];
            return [...current, ...nested];
          });
        };
        errMsg = extractConstraints(e.response.data.detail).join('; ');
      } else {
        errMsg = e.response?.data?.message || e.message || errMsg;
      }

      addAlert({
        level: 'error',
        title: 'Save Failed',
        message: errMsg
      });
    } finally {
      setIsSaving(false);
    }
  }, [validate, cfg, presetName, loadedPresetName, generatedPresetName, buildConfigToSave, addAlert, editingVariantIdx, recordRecentlyUsed, isEdit, persistDraft]);

  const loadPreset = React.useCallback((p) => {
    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    setEditingVariantIdx(null);
    setBaseConfigBackup(null);

    const presetLabel = p.name || p.config?.strategy_label;
    const baseSourceVariants = baseConfigBackup?.strategy_variants || cfg.strategy_variants || [];

    // Load variants from the preset if present, otherwise fall back to non-conflicting existing variants
    const targetVariants = (Array.isArray(p.config?.strategy_variants) && p.config.strategy_variants.length > 0)
      ? p.config.strategy_variants
      : baseSourceVariants;

    // Deduplicate: If promoting preset "X" to base, strip any matching variant entry from strategy_variants
    const filteredVariants = targetVariants
      .filter(v => v && v.strategy_label !== p.name && v.strategy_label !== presetLabel)
      .map(v => coerceAndSanitizeConfig(v, true));
    const wasDeduplicated = targetVariants.length !== filteredVariants.length;

    const cleanedConfig = {
      ...(p.config || {}),
      strategy_label: p.name || presetLabel || cfg.strategy_label,
      strategy_variants: filteredVariants
    };
    delete cleanedConfig.paused;
    delete cleanedConfig.paused_strategies;

    if (isEdit || sessionActive) {
      cleanedConfig.trading_mode = cfg.trading_mode;
      cleanedConfig.paper_mode = cfg.paper_mode;
    }

    const next = flattenConfig(cleanedConfig);
    setCfg(next);
    setLoadedPresetName(p.name);
    setPresetName(p.name);
    setPresetLoaded(true);
    recordRecentlyUsed(p.name);
    validate(next);
    setIsDirty(false);
    setHasPendingSessionChanges(true);
    if (!isEdit) persistDraft(next, p.name);

    const dedupNote = wasDeduplicated ? ` (Removed "${p.name}" from variants list)` : '';
    addAlert({
      level: 'success',
      title: 'Preset Loaded',
      message: (isEdit || sessionActive)
        ? `Preset "${p.name}" strategy parameters loaded into active ${cfg.trading_mode ? cfg.trading_mode.toUpperCase() : 'PAPER'} session.${dedupNote}`
        : `Active base configuration set to "${p.name}".${dedupNote}`
    });
  }, [validate, addAlert, isEdit, sessionActive, cfg.trading_mode, cfg.paper_mode, cfg.strategy_variants, cfg.strategy_label, baseConfigBackup, recordRecentlyUsed, persistDraft]);

  // Variant editing handlers - allows customizing a variant without replacing or losing the base configuration
  const startEditingVariant = React.useCallback((variantPresetOrObj, vIndex) => {
    // If user clicks Edit on the variant already being tuned, preserve unsaved edits and switch to Active tab
    if (editingVariantIdx !== null && editingVariantIdx === vIndex) {
      handleSectionChange('summary');
      return;
    }

    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;

    let cleanBase;
    if (editingVariantIdx === null) {
      cleanBase = coerceAndSanitizeConfig(cfg, false);
    } else {
      // Switching directly from one variant to another: commit current variant edits into base first
      const rawBase = coerceAndSanitizeConfig(baseConfigBackup || cfg, false);
      const variants = [...(rawBase.strategy_variants || [])];
      const currentSanitized = coerceAndSanitizeConfig(cfg, true);
      delete currentSanitized.strategy_variants;
      currentSanitized.strategy_label = cfg.strategy_label || `Variant ${editingVariantIdx + 1}`;
      if (editingVariantIdx >= 0 && editingVariantIdx < variants.length) {
        variants[editingVariantIdx] = currentSanitized;
      }
      rawBase.strategy_variants = variants;
      cleanBase = rawBase;
    }

    const currentBase = flattenConfig(cleanBase);
    setBaseConfigBackup(currentBase);

    let vData = null;
    if (cleanBase.strategy_variants && cleanBase.strategy_variants[vIndex]) {
      vData = { ...cleanBase.strategy_variants[vIndex] };
    } else if (variantPresetOrObj) {
      vData = { ...(variantPresetOrObj.config || variantPresetOrObj) };
    }

    if (!vData) return;
    const cleanVariant = vData.__flattened ? coerceAndSanitizeConfig(vData, true) : { ...vData };
    const label = variantPresetOrObj?.name || cleanVariant.strategy_label || `Variant ${vIndex + 1}`;
    cleanVariant.strategy_label = label;

    setEditingVariantIdx(vIndex);
    const fullVariantCfg = {
      ...resolveStrategyConfig(cleanBase, cleanVariant),
      strategy_label: label,
      strategy_variants: currentBase.strategy_variants || [] // CRITICAL: Preserve base variants list!
    };
    delete fullVariantCfg.__flattened;

    setCfg(flattenConfig(fullVariantCfg));
    // CRITICAL: loadedPresetName is strictly for the active base preset. DO NOT overwrite with variant name.
    setIsDirty(false);
    handleSectionChange('summary');

    addAlert({
      level: 'info',
      title: 'Variant Editing Active',
      message: `Tuning variant "${label}". Base strategy "${currentBase.strategy_label || 'Base'}" is preserved.`
    });
  }, [cfg, editingVariantIdx, baseConfigBackup, addAlert, handleSectionChange]);

  const saveVariantChanges = React.useCallback(() => {
    const errs = getValidationErrors(cfg);
    const errKeys = Object.keys(errs).filter(k => !k.endsWith('_warn'));
    if (errKeys.length > 0) {
      const firstKey = errKeys[0];
      const targetTab = TAB_ERROR_MAP[firstKey];
      const targetSection = SECTION_ERROR_MAP[firstKey];
      if (targetTab) {
        handleSectionChange(targetTab, targetSection || null);
      } else if (targetSection) {
        recordRecentSection(targetSection);
        setOpenSectionId(targetSection);
      }
      return;
    }

    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;

    const base = baseConfigBackup || cfg;
    const currentVariants = [...(base.strategy_variants || [])].filter(Boolean);
    const sanitizedVariant = coerceAndSanitizeConfig(cfg, true);
    delete sanitizedVariant.strategy_variants;

    const variantLabel = cfg.strategy_label || (editingVariantIdx !== null ? `Variant ${editingVariantIdx + 1}` : 'Variant');
    sanitizedVariant.strategy_label = variantLabel;

    if (editingVariantIdx !== null && editingVariantIdx >= 0 && editingVariantIdx < currentVariants.length) {
      currentVariants[editingVariantIdx] = sanitizedVariant;
    } else {
      currentVariants.push(sanitizedVariant);
    }

    const updatedBase = flattenConfig({
      ...base,
      strategy_variants: currentVariants
    });

    setCfg(updatedBase);
    setBaseConfigBackup(null);
    setEditingVariantIdx(null);
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    if (!isEdit) persistDraft(updatedBase, loadedPresetName);

    addAlert({
      level: 'success',
      title: 'Variant Changes Staged',
      message: `Updated "${variantLabel}". Apply Changes to persist this update.`
    });
    setSection('presets');
  }, [cfg, baseConfigBackup, editingVariantIdx, validate, addAlert, isEdit, persistDraft, loadedPresetName]);

  const exitVariantEditing = React.useCallback(() => {
    if (baseConfigBackup) {
      setCfg(flattenConfig(baseConfigBackup));
    }
    setBaseConfigBackup(null);
    setEditingVariantIdx(null);
    setIsDirty(hasPendingSessionChangesRef.current);
    setSection('presets');
    addAlert({
      level: 'info',
      title: 'Exited Variant Editing',
      message: 'Returned to base strategy.'
    });
  }, [baseConfigBackup, addAlert]);

  const promoteVariantToBaseByIndex = React.useCallback((targetIdx = editingVariantIdx) => {
    const cleanBase = baseConfigBackup ? coerceAndSanitizeConfig(baseConfigBackup, false) : coerceAndSanitizeConfig(cfg, false);
    const variantsList = [...(cleanBase.strategy_variants || [])].filter(Boolean);

    const isEditingTarget = editingVariantIdx !== null && (targetIdx === null || targetIdx === editingVariantIdx);
    const rawTargetVariant = isEditingTarget
      ? coerceAndSanitizeConfig(cfg, true)
      : (variantsList[targetIdx] ? coerceAndSanitizeConfig(variantsList[targetIdx], true) : null);

    if (!rawTargetVariant) return;

    const variantLabel = rawTargetVariant.strategy_label || 'Promoted Strategy';
    const remainingVariants = variantsList
      .filter((v, i) => i !== targetIdx && v.strategy_label !== variantLabel)
      .map(v => coerceAndSanitizeConfig(v, true));

    const resolvedTarget = resolveStrategyConfig(cleanBase, rawTargetVariant);
    const newBaseConfig = {
      ...resolvedTarget,
      strategy_label: variantLabel,
      strategy_variants: remainingVariants
    };
    if (isEdit || sessionActive) {
      newBaseConfig.trading_mode = cleanBase.trading_mode;
      newBaseConfig.paper_mode = cleanBase.paper_mode;
    }

    hasUserLocalOverrideRef.current = true;
    suppressDraftSaveRef.current = false;
    const flattenedBase = flattenConfig(newBaseConfig);
    setCfg(flattenedBase);
    setBaseConfigBackup(null);
    setEditingVariantIdx(null);
    setLoadedPresetName(variantLabel);
    setPresetName(variantLabel);
    setIsDirty(true);
    setHasPendingSessionChanges(true);
    if (!isEdit) persistDraft(flattenedBase, variantLabel);

    addAlert({
      level: 'success',
      title: 'Promoted to Base Strategy',
      message: `"${variantLabel}" is now the active base strategy.`
    });
    setSection('presets');
  }, [baseConfigBackup, cfg, editingVariantIdx, isEdit, sessionActive, persistDraft, addAlert]);

  const promoteVariantToBase = React.useCallback(() => {
    promoteVariantToBaseByIndex(editingVariantIdx);
  }, [promoteVariantToBaseByIndex, editingVariantIdx]);

  const handleOpenSaveAsNew = React.useCallback((presetToCopy = null) => {
    const targetConfig = presetToCopy ? presetToCopy.config : cfg;
    const rawTargetName = presetToCopy ? presetToCopy.name : cfg.strategy_label;
    const savedLimit = (() => {
      try {
        const s = typeof localStorage !== 'undefined' && Number(localStorage.getItem('strategy_name_char_limit'));
        if (s === 20 || s === 28 || s === 50) return s;
      } catch (e) {}
      return STRATEGY_NAME_CHAR_LIMITS.STANDARD;
    })();

    const smartStandard = generateSmartStrategyName(targetConfig, {
      maxLen: savedLimit,
      style: 'standard',
    });
    const smartDetailed = generateSmartStrategyName(targetConfig, {
      maxLen: savedLimit,
      style: 'detailed',
    });

    const existingNames = new Set((Array.isArray(presets) ? presets : []).map(p => p?.name).filter(Boolean));
    let suggestedName;

    if (presetToCopy) {
      // Cloning an existing preset row: use smart name if different, otherwise clean suffix within limit
      if (smartStandard && !existingNames.has(smartStandard)) {
        suggestedName = smartStandard;
      } else if (smartDetailed && !existingNames.has(smartDetailed)) {
        suggestedName = smartDetailed;
      } else {
        const base = sanitizeStrategyLabel(rawTargetName || smartStandard, Math.max(10, savedLimit - 5));
        suggestedName = `${base} v2`;
      }
    } else {
      // "Save As" from active editor: if current label is generic OR still matches the loaded preset name,
      // automatically generate a fresh smart name reflecting the current parameters!
      const isUnchangedLoadedName = loadedPresetName && rawTargetName === loadedPresetName;
      if (!rawTargetName || isGenericStrategyName(rawTargetName) || isUnchangedLoadedName) {
        if (smartStandard && (!existingNames.has(smartStandard) || smartStandard !== loadedPresetName)) {
          suggestedName = smartStandard;
        } else if (smartDetailed && (!existingNames.has(smartDetailed) || smartDetailed !== loadedPresetName)) {
          suggestedName = smartDetailed;
        } else {
          suggestedName = smartStandard;
        }
      } else {
        suggestedName = sanitizeStrategyLabel(rawTargetName, savedLimit);
      }
    }

    const scopeInfo = getWatchlistScopeDescriptor(targetConfig);
    const mode = targetConfig.trading_mode || (targetConfig.paper_mode ? 'paper' : 'live');
    const interval = targetConfig.scan_interval || '1m';
    const risk = targetConfig.risk_pct_per_trade || 1.0;
    const sl = targetConfig.sl_distance_pct;
    const tp = (targetConfig.tp_mode === 'fixed' || targetConfig.tp_mode === undefined)
      ? targetConfig.tp_ratio || 2.0
      : (targetConfig.exit_rr_sequence && targetConfig.exit_rr_sequence.length > 0)
          ? targetConfig.exit_rr_sequence[targetConfig.exit_rr_sequence.length - 1]
          : 2.0;

    setSaveModalState({
      isOpen: true,
      preset: presetToCopy,
      targetConfig,
      defaultName: suggestedName,
      configSummary: {
        mode: mode ? mode.toUpperCase() : 'PAPER',
        scope: scopeInfo.badge,
        interval,
        risk,
        sl,
        tp: tp ? Number(tp).toFixed(1) : undefined
      }
    });
  }, [cfg, loadedPresetName, presets]);

  const handleConfirmSaveAsNew = React.useCallback(async (newName) => {
    if (saveModalState.preset) {
      try {
        setIsSaving(true);
        const sourceVariants = Array.isArray(saveModalState.preset.config?.strategy_variants)
          ? saveModalState.preset.config.strategy_variants.map(v => coerceAndSanitizeConfig(v, true))
          : (Array.isArray(activeVariants) ? activeVariants.map(v => coerceAndSanitizeConfig(v, true)) : []);
        const payload = {
          ...coerceAndSanitizeConfig(saveModalState.preset.config, false),
          strategy_label: newName,
          strategy_variants: sourceVariants
        };
        const res = await presetsAPI.save(newName, payload);
        if (res && res.data) {
          const savedPreset = res.data?.preset || res.data;
          setPresets(prev => {
            const safe = Array.isArray(prev) ? prev : [];
            return [...safe.filter(p => p && p.name !== newName), savedPreset].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          });
          addAlert({
            level: 'success',
            title: 'Preset Saved',
            message: `Created preset "${newName}" successfully.`
          });
        }
      } catch (err) {
        addAlert({
          level: 'error',
          title: 'Save Failed',
          message: err.response?.data?.message || err.message || 'Failed to save preset.'
        });
      } finally {
        setIsSaving(false);
      }
    } else {
      await savePreset(newName);
    }
  }, [saveModalState.preset, savePreset, activeVariants, addAlert]);

  const duplicatePreset = React.useCallback(async (p) => {
    if (!p?.name) return;
    try {
      setIsSaving(true);
      const existingNames = new Set((Array.isArray(presets) ? presets : []).map(x => x?.name));
      let copyName = `${p.name} (Copy)`;
      let counter = 2;
      while (existingNames.has(copyName)) {
        copyName = `${p.name} (Copy ${counter++})`;
      }
      const sourceConfig = coerceAndSanitizeConfig({ ...(p.config || {}), strategy_label: copyName }, false);
      const res = await presetsAPI.save(copyName, sourceConfig);
      if (res && res.data) {
        const savedPreset = res.data?.preset || res.data;
        setPresets(prev => {
          const safe = Array.isArray(prev) ? prev : [];
          return [...safe.filter(x => x && x.name !== copyName), savedPreset].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        });
        addAlert({
          level: 'success',
          title: 'Preset Duplicated',
          message: `Created duplicate preset "${copyName}".`
        });
      }
    } catch (err) {
      addAlert({
        level: 'error',
        title: 'Duplicate Failed',
        message: err.response?.data?.message || err.message || 'Failed to duplicate preset.'
      });
    } finally {
      setIsSaving(false);
    }
  }, [presets, addAlert]);

  const deletePreset = React.useCallback(async (name) => {
    if (sessionActive) {
      addAlert({ level: 'error', title: 'Action Blocked', message: 'Cannot delete presets while a live session is active.' });
      return;
    }
    try {
      setIsDeleting(true);
      await presetsAPI.delete(name);
      setPresets(prev => (Array.isArray(prev) ? prev.filter(p => p && p.name !== name) : []));

      if (loadedPresetName === name) {
        setLoadedPresetName(null);
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('loaded_preset_name');
        }
      }
      if (presetName === name) {
        setPresetName('');
      }

      // Prune deleted preset from both active variants and base backup
      updateVariantsList(variants => variants.filter(v => v?.strategy_label !== name));

      addAlert({ level: 'info', title: 'Preset Deleted', message: `"${name}" has been removed from the database.` });
    } catch (e) {
      console.error('[ConfigModal] Error deleting preset:', e);
      addAlert({ level: 'error', title: 'Delete Failed', message: `Could not remove preset "${name}".` });
    } finally {
      setIsDeleting(false);
      setPresetToDelete(null);
    }
  }, [addAlert, loadedPresetName, presetName, sessionActive, updateVariantsList]);

  const handleClearActiveConfig = React.useCallback(() => {
    suppressDraftSaveRef.current = true;
    hasUserLocalOverrideRef.current = false;
    setEditingVariantIdx(null);
    setBaseConfigBackup(null);
    setSelectedPresetNames(new Set());

    let baseline;
    if (isEdit) {
      baseline = flattenConfig(initialConfig);
    } else {
      baseline = flattenConfig({
        paper_mode: true,
        global_scanner_enabled: true,
        strategy_label: 'Momentum Strategy',
        strategy_variants: [],
        max_total_risk_pct: CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT,
        total_sl_guard_usdt: CONFIG_LIMITS.TOTAL_SL_GUARD_DEFAULT,
        scan_interval: '5m',
        scan_pct_threshold: 2.0,
        scan_lookback: 3,
        scan_min_volume_usdt: 500000,
        scan_mode: 'interval',
        scan_window_duration_sec: 90,
        scan_check_interval_sec: 5,
        entry_side: 'both',
        watchlist_size: CONFIG_LIMITS.WATCHLIST_DEFAULT,
        watchlist_offset: 0,
        discovery_mode: 'abs_change_pct',
        enabled_signals: ['momentum_pct'],
        signal_logic: 'all',
        tp_mode: 'fixed',
        tp_ratio: CONFIG_LIMITS.TP_RATIO_DEFAULT,
        live_rr_sequence: [1, 2, 4],
        exit_rr_sequence: [0, 1, 2],
        sl_type: 'pct',
        sl_distance_pct: CONFIG_LIMITS.SL_DISTANCE_DEFAULT,
        sl_lookback_timeframe: '5m',
        sl_lookback_period: 5,
        sl_include_forming_candle: false,
        sl_min_pct: 0.3,
        sl_max_pct: 3,
        trading_mode: 'paper',
        risk_pct_per_trade: CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT,
        max_open_trades: CONFIG_LIMITS.MAX_OPEN_TRADES_DEFAULT,
        max_trades_per_period: 10,
        trades_period_min: 60,
        max_trades_24h: CONFIG_LIMITS.MAX_TRADES_24H_DEFAULT,
        min_trade_interval_min: CONFIG_LIMITS.MIN_TRADE_INTERVAL_DEFAULT,
        trades_jitter_pct: CONFIG_LIMITS.TRADES_JITTER_DEFAULT,
        release_risk_on_est_pnl_be: false,
        release_risk_est_pnl_mode: 'usdt',
        release_risk_est_pnl_min_usdt: 0,
        release_risk_est_pnl_min_rr: 0,
      });
    }

    setCfg(baseline);
    setLoadedPresetName(null);
    setPresetName('');
    setPresetLoaded(false);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('config_draft');
      sessionStorage.removeItem('loaded_preset_name');
    }
    setHasPendingSessionChanges(false);
    setIsDirty(false);
    setErrors({});
    addAlert({
      level: 'info',
      title: isEdit ? 'Config Reset' : 'Configuration Cleared',
      message: isEdit
        ? 'Active configuration parameters reset back to last saved session state.'
        : 'All variants and customized strategy parameters have been cleared to default baseline.'
    });
  }, [addAlert, isEdit, initialConfig]);

  const handleExportToFile = React.useCallback(() => {
    try {
      const configToSave = buildConfigToSave();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(configToSave, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      const filename = `${(configToSave.strategy_label || 'momentum_strategy').replace(/\s+/g, '_').toLowerCase()}_config.json`;
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      addAlert({ level: 'success', title: 'Export Successful', message: `Configuration exported as ${filename}.` });
    } catch (e) {
      console.error('[ConfigModal] Export failed:', e);
      addAlert({ level: 'error', title: 'Export Failed', message: 'Could not export configuration.' });
    }
  }, [buildConfigToSave, addAlert]);

  const handleCopyActiveToClipboard = React.useCallback(async () => {
    try {
      const configToSave = buildConfigToSave();
      await navigator.clipboard.writeText(JSON.stringify(configToSave, null, 2));
      addAlert({ level: 'success', title: 'Copied to Clipboard', message: 'Active strategy configuration JSON copied to clipboard.' });
    } catch (e) {
      addAlert({ level: 'error', title: 'Copy Failed', message: 'Unable to write configuration to clipboard.' });
    }
  }, [buildConfigToSave, addAlert]);

  const handlePasteActiveFromClipboard = React.useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        addAlert({ level: 'warning', title: 'Clipboard Empty', message: 'No clipboard content found to paste.' });
        return;
      }
      const parsed = JSON.parse(text);
      const flattened = flattenConfig(parsed);
      setCfg(flattened);
      setIsDirty(true);
      validate(flattened);
      addAlert({ level: 'success', title: 'Pasted Configuration', message: 'Strategy configuration loaded successfully from clipboard.' });
    } catch (err) {
      console.error('[ConfigModal] Paste failed:', err);
      addAlert({ level: 'error', title: 'Paste Failed', message: 'Invalid JSON strategy configuration in clipboard.' });
    }
  }, [addAlert, validate]);

  const handleFileImport = React.useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (Array.isArray(parsed)) {
          const validItems = parsed.filter(item => item && item.name && item.config);
          const results = await Promise.allSettled(
            validItems.map(item => presetsAPI.save(item.name, coerceAndSanitizeConfig(item.config, true)))
          );
          const importedCount = results.filter(r => r.status === 'fulfilled').length;
          const failedCount = validItems.length - importedCount;
          await fetchPresets();
          if (importedCount > 0) {
            addAlert({
              level: failedCount > 0 ? 'warning' : 'success',
              title: 'Presets Imported',
              message: failedCount > 0
                ? `Imported ${importedCount} preset(s); ${failedCount} failed validation.`
                : `Successfully imported ${importedCount} presets into preset library.`
            });
          } else {
            addAlert({ level: 'error', title: 'Import Failed', message: 'No valid presets could be imported from file.' });
          }
        } else {
          const flattened = flattenConfig(parsed);
          setCfg(flattened);
          setIsDirty(true);
          validate(flattened);
          addAlert({ level: 'success', title: 'Import Successful', message: 'Configuration imported from file.' });
        }
      } catch (err) {
        console.error('[ConfigModal] File import failed:', err);
        addAlert({ level: 'error', title: 'Import Failed', message: 'Invalid JSON configuration file.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [addAlert, validate, fetchPresets]);

  const toggleSelectPreset = React.useCallback((name) => {
    setSelectedPresetNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleSelectAllPresets = React.useCallback(() => {
    const safePresets = Array.isArray(presets) ? presets : [];
    if (selectedPresetNames.size === safePresets.length && safePresets.length > 0) {
      setSelectedPresetNames(new Set());
    } else {
      setSelectedPresetNames(new Set(safePresets.filter(p => p && p.name).map(p => p.name)));
    }
  }, [presets, selectedPresetNames]);

  const handleCopySelectedPresets = React.useCallback(async () => {
    const safePresets = Array.isArray(presets) ? presets : [];
    const selected = safePresets.filter(p => p && p.name && selectedPresetNames.has(p.name));
    if (selected.length === 0) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
      addAlert({ level: 'success', title: 'Copied Selected Presets', message: `Copied ${selected.length} preset(s) to clipboard.` });
    } catch (e) {
      addAlert({ level: 'error', title: 'Copy Failed', message: 'Failed to write selected presets to clipboard.' });
    }
  }, [presets, selectedPresetNames, addAlert]);

  const handleExportSelectedPresets = React.useCallback(() => {
    const safePresets = Array.isArray(presets) ? presets : [];
    const selected = safePresets.filter(p => p && p.name && selectedPresetNames.has(p.name));
    if (selected.length === 0) return;
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(selected, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      const filename = `selected_presets_export_${selected.length}.json`;
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      addAlert({ level: 'success', title: 'Export Successful', message: `Exported ${selected.length} preset(s) to ${filename}.` });
    } catch (e) {
      addAlert({ level: 'error', title: 'Export Failed', message: 'Failed to export selected presets.' });
    }
  }, [presets, selectedPresetNames, addAlert]);

  const handleDeleteSelectedPresets = React.useCallback(async () => {
    const names = Array.from(selectedPresetNames);
    if (names.length === 0 || sessionActive) return;
    try {
      setIsDeleting(true);
      const results = await Promise.allSettled(names.map(name => presetsAPI.delete(name)));
      const deletedSet = new Set(names.filter((_, idx) => results[idx].status === 'fulfilled'));
      const failedCount = names.length - deletedSet.size;

      if (deletedSet.size > 0) {
        setPresets(prev => (Array.isArray(prev) ? prev.filter(p => p && !deletedSet.has(p.name)) : []));
        if (loadedPresetName && deletedSet.has(loadedPresetName)) {
          setLoadedPresetName(null);
          if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('loaded_preset_name');
        }
        if (presetName && deletedSet.has(presetName)) {
          setPresetName('');
        }
        updateVariantsList(variants => variants.filter(v => !deletedSet.has(v?.strategy_label)));
      }
      setSelectedPresetNames(new Set());

      if (failedCount === 0) {
        addAlert({ level: 'success', title: 'Presets Deleted', message: `Successfully deleted ${deletedSet.size} selected preset(s).` });
      } else if (deletedSet.size > 0) {
        addAlert({ level: 'warning', title: 'Partial Delete', message: `Deleted ${deletedSet.size} preset(s); ${failedCount} failed.` });
      } else {
        addAlert({ level: 'error', title: 'Delete Failed', message: 'Failed to delete selected presets.' });
      }
    } catch (e) {
      addAlert({ level: 'error', title: 'Delete Failed', message: 'Failed to delete selected presets.' });
    } finally {
      setIsDeleting(false);
    }
  }, [selectedPresetNames, sessionActive, loadedPresetName, presetName, updateVariantsList, addAlert]);

  const handlePasteConfig = React.useCallback(async () => {
    let text = '';
    let isPermissionError = false;

    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        throw new Error('Clipboard API is not supported in this browser environment.');
      }
      text = await navigator.clipboard.readText();
    } catch (err) {
      console.warn('[ConfigModal] Direct clipboard reading blocked by browser permissions or context:', err);
      isPermissionError = true;
    }

    if (isPermissionError) {
      setPasteValue('');
      setPasteError(null);
      setShowPasteOverlay(true);
      addAlert({
        level: 'info',
        title: 'Clipboard Action',
        message: 'Browser security requires manual paste. Fallback editor opened.'
      });
      return;
    }

    if (!text || !text.trim()) {
      addAlert({ level: 'warn', title: 'Paste Failed', message: 'Clipboard is empty.' });
      return;
    }

    try {
      const parsed = JSON.parse(text);
      const flattened = flattenConfig(parsed);
      hasUserLocalOverrideRef.current = true;
      suppressDraftSaveRef.current = false;
      setCfg(flattened);
      setIsDirty(true);
      setHasPendingSessionChanges(true);
      validate(flattened);
      addAlert({ level: 'success', title: 'Paste Successful', message: 'Configuration pasted from clipboard.' });
    } catch (err) {
      console.error('[ConfigModal] Direct paste JSON parse failed, opening fallback editor:', err);
      setPasteValue(text);
      setPasteError(err.message);
      setShowPasteOverlay(true);
      addAlert({
        level: 'warn',
        title: 'Parse Failed',
        message: 'Content is not valid JSON. Opening fallback editor to inspect.'
      });
    }
  }, [validate, addAlert]);

  const handlePasteAreaChange = React.useCallback((val) => {
    setPasteValue(val);
    if (!val.trim()) {
      setPasteError(null);
      return;
    }
    try {
      JSON.parse(val);
      setPasteError(null);
    } catch (err) {
      setPasteError(err.message);
    }
  }, []);

  const toggleVariant = React.useCallback((e, p) => {
    e.stopPropagation();

    // Guard 1: Prevent adding the current active base strategy as a variant of itself
    const currentBaseLabel = (editingVariantIdx !== null && baseConfigBackup)
      ? (baseConfigBackup.strategy_label || loadedPresetName)
      : (loadedPresetName || cfg.strategy_label);
    if (p.name === currentBaseLabel) {
      addAlert({
        level: 'warn',
        title: 'Action Blocked',
        message: `"${p.name}" is currently loaded as the base strategy and cannot be added as a variant of itself.`
      });
      return;
    }

    const exists = activeVariants.some((v) => v?.strategy_label === p.name);
    if (!exists && activeVariants.length >= CONFIG_LIMITS.MAX_VARIANTS) {
      addAlert({
        level: 'warn',
        title: 'Limit Reached',
        message: `Maximum of ${CONFIG_LIMITS.MAX_VARIANTS} strategy variants allowed.`
      });
      return;
    }

    updateVariantsList(variants => exists
      ? variants.filter((v) => v?.strategy_label !== p.name)
      : [...variants, coerceAndSanitizeConfig({ ...p.config, strategy_label: p.name }, true)]);
  }, [activeVariants, editingVariantIdx, baseConfigBackup, loadedPresetName, cfg.strategy_label, updateVariantsList, addAlert]);

  const clearAllVariants = React.useCallback(() => {
    const count = activeVariants.length;
    if (count === 0) return;
    updateVariantsList(() => []);
    addAlert({
      level: 'info',
      title: 'Variants Cleared',
      message: `Removed ${count} strategy variant${count > 1 ? 's' : ''} from active orchestration.`
    });
  }, [activeVariants.length, updateVariantsList, addAlert]);

  const currentModeBalance = cfg.trading_mode === 'paper' ? (cfg.paper_starting_balance || 10000) : cfg.trading_mode === 'testnet' ? (cfg.testnet_starting_balance || 0) : (cfg.live_starting_balance || 0);
  const riskAmount = (currentModeBalance * ((cfg.risk_pct_per_trade || 0) / 100))
  const sequence = useMemo(() => {
    const l = Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [];
    const ex = Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [];
    return l.map((t, i) => [t, ex[i] ?? 0]);
  }, [cfg.live_rr_sequence, cfg.exit_rr_sequence])

  const handleSortMilestones = React.useCallback(() => {
    const l = Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [];
    const ex = Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [];

    // Pair them up, sort by trigger ascending, then unpack
    const pairs = l.map((trigger, idx) => ({
      trigger: Number(trigger || 0),
      exit: Number(ex[idx] || 0)
    }));

    pairs.sort((a, b) => a.trigger - b.trigger);

    const sortedLive = pairs.map(p => p.trigger);
    const sortedExit = pairs.map(p => p.exit);

    setCfg(prev => ({
      ...prev,
      live_rr_sequence: sortedLive,
      exit_rr_sequence: sortedExit
    }));
  }, [cfg.live_rr_sequence, cfg.exit_rr_sequence, setCfg]);

  const renderField = React.useCallback((label, key, type = 'number', opts = null, attrs = {}) => (
    <ConfigField
      label={label}
      id={`config-${key}`}
      name={key}
      key={key}
      type={type}
      value={cfg[key]}
      onChange={setField}
      error={errors[key]}
      warning={errors[`${key}_warn`]}
      opts={opts}
      attrs={{ ...attrs, onFocus: handleInputFocus }}
    />
  ), [cfg, errors, setField, handleInputFocus]);

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      style={{
        ...(vvHeight ? { height: `${vvHeight}px`, maxHeight: `${vvHeight}px` } : {}),
        ...(vvOffsetTop > 0 ? { transform: `translateY(${vvOffsetTop}px)` } : {})
      }}
      className="signal-stack-editor flex flex-col flex-1 min-h-0 h-full bg-surface text-text overflow-hidden relative outline-none"
    >
      <div className="relative z-40 bg-surface/95 backdrop-blur-md border-b border-border shrink-0">
        <div className="px-2.5 sm:px-4 py-1 sm:py-1.5 flex justify-between items-center relative z-20 transition-all">
          <div className="min-w-0 flex-1 mr-2">
             <div className="text-xs sm:text-sm font-black tracking-tight truncate uppercase flex items-center gap-1.5">
               <span className="truncate">
                 {editingVariantIdx !== null
                   ? `Variant #${editingVariantIdx + 1}: ${cfg.strategy_label || 'Variant'}`
                   : (loadedPresetName || cfg.strategy_label || 'Configure Engine')}
               </span>
               {editingVariantIdx !== null ? (
                 <span className="text-[8.5px] px-1.5 py-0.5 rounded font-black tracking-widest uppercase bg-violet-500/20 text-violet-300 border border-violet-500/40 shrink-0 flex items-center gap-1">
                   <Layers size={9} /> V{editingVariantIdx + 1}
                 </span>
               ) : loadedPresetName ? (
                 <span className={cn(
                   "text-[8.5px] px-1.5 py-0.5 rounded font-black tracking-widest uppercase border shrink-0 hidden sm:inline-flex",
                   isDirty
                     ? "bg-amber/15 border-amber/40 text-amber"
                     : "bg-accent/15 border-accent/40 text-accent"
                 )}>
                   {isDirty ? "Modified" : "Preset"}
                 </span>
               ) : (
                 <span className="text-[8.5px] px-1.5 py-0.5 rounded font-black tracking-widest uppercase bg-surface border border-border text-dim shrink-0 hidden sm:inline-flex">
                   Draft
                 </span>
               )}
               {(isDirty || hasPendingSessionChanges) && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />}
               <InfoHelpButton
                 open={!!expandedHelpMap.header_status}
                 onToggle={() => toggleHelpKey('header_status')}
                 label="Configuration Status"
               />
             </div>
             {expandedHelpMap.header_status && (
               <InfoDropdownBox className="mt-1">
                 {editingVariantIdx !== null
                   ? `Base Preserved: ${baseConfigBackup?.strategy_label || loadedPresetName || 'Main Strategy'}`
                   : showResumingFeedback
                     ? 'Resuming Feed...'
                     : (isDirty || hasPendingSessionChanges)
                       ? `Unsaved Changes · ${loadedPresetName ? `Preset: "${loadedPresetName}"` : (cfg.strategy_label || 'Orchestration Center')}`
                       : `Strategy Synced · ${loadedPresetName ? `Preset: "${loadedPresetName}"` : (cfg.strategy_label || 'Orchestration Center')}`}
               </InfoDropdownBox>
             )}
          </div>
          <Tooltip content="Close Configuration">
            <button type="button" onClick={onClose} aria-label="Close Configuration" className="min-h-[30px] min-w-[30px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center hover:bg-white/5 rounded-lg transition-colors shrink-0 cursor-pointer"><X size={15} className="text-dim" /></button>
          </Tooltip>
        </div>
        <SectionTabs section={section} onSectionChange={handleSectionChange} errors={errors} />

        {/* Ultra-Dense, High-Clarity Sub-Header Ribbon across tabs (auto-collapses while keyboard is active) */}
        {!isInputFocused && (
          editingVariantIdx !== null ? (
            <div className="px-3 sm:px-4 py-1 bg-violet-950/35 border-t border-b border-violet-500/30 flex items-center justify-between gap-2 text-xs transition-all relative z-30 animate-in fade-in duration-150">
              {/* Left: Indicator, Variant Badge, and Full Strategy Name */}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="p-0.5 rounded bg-violet-500/20 text-violet-300 shrink-0">
                  <Layers size={11} />
                </span>
                <span className="text-[10px] font-black uppercase text-violet-300 bg-violet-500/20 px-1.5 py-0.2 rounded border border-violet-500/30 shrink-0">
                  V{editingVariantIdx + 1}
                </span>
                <span
                  className="font-mono font-bold text-xs truncate text-white min-w-0 flex-1"
                  title={cfg.strategy_label || `Variant #${editingVariantIdx + 1}`}
                >
                  {cfg.strategy_label || `Variant #${editingVariantIdx + 1}`}
                </span>
                {isDirty && (
                  <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                    Modified
                  </span>
                )}
                <span className="text-[9px] px-1.5 py-0.2 rounded font-bold bg-violet-500/15 text-violet-300/80 border border-violet-500/30 shrink-0 hidden md:inline">
                  Base Safe
                </span>
              </div>

              {/* Right: Quick Ultra-Compact Actions */}
              <div className="flex items-center gap-1 shrink-0 ml-auto">
                {isDirty && presets.some(p => p.name === cfg.strategy_label) && (
                  <button
                    type="button"
                    onClick={() => savePreset(cfg.strategy_label)}
                    disabled={isSaving}
                    className="px-2 py-1 rounded-lg text-[11px] font-bold bg-accent text-white hover:bg-accent/90 transition-all flex items-center gap-1 cursor-pointer shadow-xs active:scale-95 shrink-0"
                    title={`Update preset "${cfg.strategy_label}" in database`}
                  >
                    <RefreshCw size={10} className={cn(isSaving && "animate-spin")} />
                    <span>Update</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={saveVariantChanges}
                  className="px-2 py-1 rounded-lg text-[11px] font-bold bg-violet-600 hover:bg-violet-500 text-white shadow-xs flex items-center gap-1 transition-all cursor-pointer active:scale-95 shrink-0"
                  title="Save changes to this variant in active session"
                >
                  <Check size={10} />
                  <span>Stage variant</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenSaveAsNew(null)}
                  className="px-2 py-1 rounded-lg text-[11px] font-bold text-violet-200 hover:text-white border border-violet-500/30 hover:bg-white/5 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1"
                  title="Save this variant as a new preset in library"
                >
                  Save As
                </button>
                <button
                  type="button"
                  onClick={promoteVariantToBase}
                  className="px-2 py-1 rounded-lg text-[10px] font-medium text-violet-300 hover:text-white border border-violet-500/30 hover:bg-white/5 transition-colors cursor-pointer hidden lg:inline-flex shrink-0"
                  title="Make this variant your main base strategy"
                >
                  Promote
                </button>
                <button
                  type="button"
                  onClick={exitVariantEditing}
                  className="px-2 py-1 rounded-lg text-[11px] font-medium text-dim hover:text-text hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                  title="Exit variant editing and return to base"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            section !== 'presets' && (
              <div className={cn(
                "px-3 sm:px-4 py-1 border-t border-b flex items-center justify-between gap-2 text-xs transition-all relative z-30",
                isDirty
                  ? "bg-amber-950/20 border-amber-500/30 text-amber-200"
                  : "bg-surface/80 backdrop-blur-md border-border/60 text-text/90"
              )}>
                {/* Left: Dot/Status, Strategy Name (Full Width on Mobile), and Status Pill */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    isDirty ? "bg-amber-400 animate-pulse" : "bg-accent"
                  )} />
                  <span
                    className="font-mono font-bold text-[11px] sm:text-xs truncate text-text min-w-0 flex-1"
                    title={loadedPresetName || cfg.strategy_label || generatedPresetName || 'Draft Strategy'}
                  >
                    {loadedPresetName || cfg.strategy_label || generatedPresetName || 'Draft Strategy'}
                  </span>
                  {loadedPresetName ? (
                    isDirty ? (
                      <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                        Modified
                      </span>
                    ) : (
                      <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-green-500/10 text-green-400 border border-green-500/30 shrink-0 flex items-center gap-1">
                        <Check size={9} /> Synced
                      </span>
                    )
                  ) : (
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.2 rounded bg-white/5 text-dim border border-border/60 shrink-0">
                      Draft
                    </span>
                  )}
                </div>

                {/* Right: Quick Update and Save As Actions */}
                <div className="flex items-center gap-1 shrink-0 ml-auto">
                  {isDirty && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = loadedPresetName || (cfg.strategy_label && cfg.strategy_label !== 'Momentum Strategy' ? cfg.strategy_label : null);
                        if (target) {
                          savePreset(target);
                        } else {
                          handleOpenSaveAsNew(null);
                        }
                      }}
                      disabled={isSaving}
                      className="px-2 py-1 rounded-lg text-[11px] font-bold bg-accent text-white hover:bg-accent/90 transition-all flex items-center gap-1 cursor-pointer shadow-xs active:scale-95 shrink-0"
                      title={loadedPresetName ? `Update preset "${loadedPresetName}" in database` : 'Update strategy preset'}
                    >
                      <RefreshCw size={10} className={cn(isSaving && "animate-spin")} />
                      <span>Update</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenSaveAsNew(null)}
                    className="px-2 py-1 rounded-lg text-[11px] font-bold text-dim hover:text-accent border border-border/60 hover:border-accent/40 hover:bg-white/5 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1"
                    title="Save configuration as a new preset in library"
                  >
                    Save As
                  </button>
                </div>
              </div>
            )
          )
        )}
      </div>
      <ModalAlertTicker />

      <div ref={scrollBodyRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar px-2.5 pt-1.5 sm:px-4 sm:pt-2.5 pb-2 sm:pb-3 overscroll-contain" data-vaul-no-drag>
        {section === 'summary' && (
          <ActiveSummaryPanel
            cfg={cfg}
            setField={setField}
            renderField={renderField}
            errors={errors}
            riskAmount={riskAmount}
            activeVariants={activeVariants}
            isEdit={isEdit}
            editingVariantIdx={editingVariantIdx}
            SIGNALS={SIGNALS}
            TOOLTIPS={TOOLTIPS}
            getBaseSignalType={getBaseSignalType}
            getSignalParamsSchema={getSignalParamsSchema}
            onToggleEntrySignal={handleToggleEntrySignal}
            onRemoveEntryLayer={handleRemoveEntryLayer}
            onUpdateEntryLayer={handleUpdateEntryLayer}
            onToggleRequiredEntry={handleToggleRequiredEntry}
            onToggleExitSignal={handleToggleExitSignal}
            onRemoveExitLayer={handleRemoveLayer}
            onUpdateExitLayer={handleUpdateLayer}
            onToggleRequiredExit={handleToggleRequiredExit}
            onOpenFullSection={openFullSection}
            ConfigFieldComponent={ConfigField}
            ToggleComponent={Toggle}
            onInputFocus={handleInputFocus}
          />
        )}

        {section === 'scan' && (
          <div
            id="config-panel-scan"
            role="tabpanel"
            aria-labelledby="config-tab-scan"
            className="flex flex-col gap-3 animate-in fade-in duration-300"
          >
            {orderSectionEntries('scan', {
            scan_general: (
            <CollapsibleSection
              id="scan_general"
              icon={Settings2}
              title="General & Smart Naming"
              subtitle="Dynamic strategy identification & character limit"
              isOpen={openSectionId === 'scan_general'}
              onToggle={() => setOpenSectionId(openSectionId === 'scan_general' ? null : 'scan_general')}
            >
              <SmartStrategyNameControl
                cfg={cfg}
                setField={setField}
                onInputFocus={handleInputFocus}
              />
            </CollapsibleSection>
            ),

            scan_htf_cross: (
            <CollapsibleSection
              id="scan_htf_cross"
              icon={Award}
              title="HTF EMA Cross Ranking"
              subtitle="4H Higher-Timeframe historical performance score boost"
              isOpen={openSectionId === 'scan_htf_cross'}
              onToggle={() => setOpenSectionId(openSectionId === 'scan_htf_cross' ? null : 'scan_htf_cross')}
            >
              <div className="flex flex-col gap-4">
                <div className="p-3.5 bg-accent/5 border border-accent/20 rounded-2xl flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0">
                        <Award size={16} />
                      </div>
                      <span className="text-xs font-bold truncate">HTF EMA Cross Boost</span>
                      <InfoHelpButton
                        open={!!expandedHelpMap.scan_htf_boost}
                        onToggle={() => toggleHelpKey('scan_htf_boost')}
                        label="HTF EMA Cross Boost"
                      />
                    </div>
                    <Toggle value={cfg.htf_ema_cross_boost_enabled !== false} onChange={(v) => setField('htf_ema_cross_boost_enabled', v)} />
                  </div>
                  {expandedHelpMap.scan_htf_boost && (
                    <InfoDropdownBox>Rank symbols by historical 4H EMA cross profit % &amp; R:R.</InfoDropdownBox>
                  )}
                </div>

                <div className={cn("grid grid-cols-1 md:grid-cols-3 gap-6", cfg.htf_ema_cross_boost_enabled === false && "opacity-40 pointer-events-none")}>
                  {renderField('HTF Interval', 'htf_ema_cross_interval', 'text', ['1m', '5m', '15m', '1h', '4h', '1d'])}
                  {renderField('Cross Count', 'htf_ema_cross_count', 'number', null, { min: 1, max: 20 })}
                  {renderField('Fast EMA Period', 'htf_ema_fast_period', 'number', null, { min: 2, max: 200 })}
                  {renderField('Slow EMA Period', 'htf_ema_slow_period', 'number', null, { min: 2, max: 200 })}
                  {renderField('Max Score Boost', 'htf_ema_cross_max_boost', 'number', null, { min: 0, max: 50, step: 1 })}
                  {renderField('R:R Score Weight', 'htf_ema_cross_rr_weight', 'number', null, { min: 0, max: 10, step: 0.1 })}
                </div>
              </div>
            </CollapsibleSection>
            ),

            scan_global: (
            <CollapsibleSection
              id="scan_global"
              icon={Search}
              title="Global Scanner"
              subtitle="Automatic discovery settings"
              isOpen={openSectionId === 'scan_global'}
              onToggle={() => setOpenSectionId(openSectionId === 'scan_global' ? null : 'scan_global')}
              {...getSectionErrorInfo('scan_global')}
            >
              <div className="mb-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <CollapsibleHelpTitle
                    title="Discovery Scope & Mode"
                    open={!!expandedHelpMap.scan_global_toggle}
                    onToggle={() => toggleHelpKey('scan_global_toggle')}
                    textClassName="text-[10px] font-black uppercase tracking-widest text-dim"
                  />
                </div>
                {expandedHelpMap.scan_global_toggle && (
                  <InfoDropdownBox>
                    Choose whether this strategy scans the live Binance market dynamically (Top Volume, Gainers, Losers, or Solo #1 Mover) or restricts entries strictly to your Static Watchlist symbols.
                  </InfoDropdownBox>
                )}
                <WatchlistScopeSelector
                  cfg={cfg}
                  setField={setField}
                  onOpenWatchlistSection={() => setOpenSectionId('scan_watchlist')}
                />
              </div>

              <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6", cfg.global_scanner_enabled === false && "opacity-40 pointer-events-none")}>
                {renderField('Timeframe', 'scan_interval', 'text', ['1m', '5m', '15m', '1h', '4h', '1d'])}
                {renderField('Discovery Mode', 'discovery_mode', 'text', [
                  { value: 'volume', label: 'Top 24h Volume' },
                  { value: 'change_pct', label: 'Top 24h Gainers (%)' },
                  { value: 'loss_pct', label: 'Top 24h Losers (%)' },
                  { value: 'abs_change_pct', label: 'Top Absolute Movement (Gainers & Losers)' }
                ], {
                  helpText: "Determines how candidate symbols are selected from Binance 24h market rankings: Top Volume (liquidity-focused), Top Gainers % (rising 24h momentum), Top Losers % (falling 24h momentum), or Top Absolute Movement (volatile movers)."
                })}
                {renderField('% Threshold', 'scan_pct_threshold', 'number', null, { min: CONFIG_LIMITS.SCAN_PCT_THRESHOLD_MIN, step: 0.1 })}
                {renderField('Watchlist size', 'watchlist_size', 'number', null, { min: CONFIG_LIMITS.WATCHLIST_MIN, max: CONFIG_LIMITS.WATCHLIST_MAX })}
                {renderField('Watchlist Offset', 'watchlist_offset', 'number', null, { min: 0, max: 100 })}
                {renderField('Entry side', 'entry_side', 'text', [
                  { value: 'both', label: 'Both (Long & Short)' },
                  { value: 'long', label: 'Long Only' },
                  { value: 'short', label: 'Short Only' },
                ])}
                {renderField('Momentum Lookback', 'scan_lookback', 'number', null, {
                  min: 1,
                  max: 100,
                  helpText: "Number of recent candles evaluated for price momentum percentage change. Shorter lookback captures immediate price velocity, while longer lookback filters short-term wicks."
                })}
                {renderField('Volatility Lookback', 'volatility_lookback', 'number', null, {
                  min: 1,
                  max: 100,
                  helpText: "CRITICAL FOR TARGET EXITS: Evaluates average candle range expansion over recent candles. A higher number of candles (e.g. recommended 48) is advised so volatility measurement is smooth and trades have sufficient price room to reach profit targets (TP/RR) and absorb spread/fees rather than stalling in consolidation."
                })}
                {renderField('Trend Lookback', 'trend_lookback', 'number', null, {
                  min: 2,
                  max: 100,
                  helpText: "Number of recent candles evaluated for consecutive close-to-close directional consistency. Ensures momentum moves have solid trend confirmation instead of single-wick noise."
                })}
                {renderField('Signal Depth', 'scanner_signal_depth', 'number', null, {
                  min: 1,
                  max: 50,
                  helpText: "The scanner will check signals for top candidates up to this depth. If top candidates fail signals, it moves to the next. Set higher for strict signal strategies to prevent stalling."
                })}

                <div className="md:col-span-2 mt-2 flex flex-col gap-3">
                  <div className="p-3.5 bg-background/50 rounded-2xl border border-border/50 flex flex-col gap-2 hover:border-accent/30 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0"><Zap size={16} /></div>
                        <span className="text-xs font-bold truncate">Smart Watchlist</span>
                        <InfoHelpButton
                          open={!!expandedHelpMap.smart_watchlist}
                          onToggle={() => toggleHelpKey('smart_watchlist')}
                          label="Smart Watchlist"
                        />
                      </div>
                      <Toggle value={cfg.smart_watchlist_enabled === true} onChange={(v) => setField('smart_watchlist_enabled', v)} />
                    </div>
                    {expandedHelpMap.smart_watchlist && (
                      <InfoDropdownBox>Event-driven discovery: Monitors the real-time !miniTicker stream to catch symbols with high momentum BEFORE they enter the top volume lists without extra API weight.</InfoDropdownBox>
                    )}
                  </div>

                  {cfg.smart_watchlist_enabled && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-accent/5 rounded-2xl border border-accent/20 flex flex-col gap-3 shadow-sm">
                      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-accent">
                        <TrendingUp size={12} /> Predictive Discovery
                      </div>
                      {renderField('Discovery Sensitivity', 'smart_watchlist_sensitivity', 'number', null, {
                        min: 0.1,
                        max: 1.0,
                        step: 0.1,
                        helpText: "Expands the candidate pool by identifying movers in the real-time mini-ticker stream before they enter the top volume lists. Lower values are more inclusive."
                      })}
                    </motion.div>
                  )}
                </div>
                {renderField('Min Volume (USDT)', 'scan_min_volume_usdt', 'number', null, { min: 0, step: 100000 })}
                {renderField('Scan Mode', 'scan_mode', 'text', [
                  { value: 'interval', label: 'Fixed Interval' },
                  { value: 'active_window', label: 'Momentum Window' }
                ])}
                {cfg.scan_mode === 'active_window' && (
                  <>
                    {renderField('Window Duration (s)', 'scan_window_duration_sec', 'number', null, { min: 1 })}
                    {renderField('Check Interval (s)', 'scan_check_interval_sec', 'number', null, { min: 1 })}
                  </>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-border/40">
                <div className="flex justify-between items-start mb-4">
                  <SectionHeader icon={LayoutGrid} title="Scoring Weights" subtitle="Contribution to opportunity score (Sum: 100%)" />
                  <div className="flex flex-wrap gap-2 justify-end">
                    {[
                      { label: 'Balanced', w: [50, 30, 20] },
                      { label: 'Aggressive', w: [80, 10, 10] },
                      { label: 'Trend-Focused', w: [20, 20, 60] }
                    ].map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setField('scanner_weights_momentum', p.w[0]);
                          setField('scanner_weights_volatility', p.w[1]);
                          setField('scanner_weights_trend', p.w[2]);
                        }}
                        className="px-2 py-1 rounded bg-accent/5 border border-accent/20 text-[8px] font-black uppercase tracking-widest text-accent hover:bg-accent/10 transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {renderField('Momentum %', 'scanner_weights_momentum', 'number', null, { min: 0, max: 100 })}
                  {renderField('Volatility %', 'scanner_weights_volatility', 'number', null, { min: 0, max: 100 })}
                  {renderField('Trend %', 'scanner_weights_trend', 'number', null, { min: 0, max: 100 })}
                </div>
                <div className="mt-4 p-4 bg-background/40 rounded-xl border border-border/40">
                   <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest mb-2">
                      <span className="text-dim">Weight Distribution</span>
                      <span className={cn(Math.abs((Number(cfg.scanner_weights_momentum || 0) + Number(cfg.scanner_weights_volatility || 0) + Number(cfg.scanner_weights_trend || 0)) - 100) > 0.1 ? "text-red" : "text-green")}>
                         Sum: {Number(cfg.scanner_weights_momentum || 0) + Number(cfg.scanner_weights_volatility || 0) + Number(cfg.scanner_weights_trend || 0)}%
                      </span>
                   </div>
                   <div className="h-2 bg-white/5 rounded-full overflow-hidden flex border border-white/5">
                      <div className="h-full bg-accent transition-all duration-500" style={{ width: `${cfg.scanner_weights_momentum}%` }} />
                      <div className="h-full bg-amber transition-all duration-500" style={{ width: `${cfg.scanner_weights_volatility}%` }} />
                      <div className="h-full bg-purple transition-all duration-500" style={{ width: `${cfg.scanner_weights_trend}%` }} />
                   </div>
                </div>
              </div>
            </CollapsibleSection>
            ),

            scan_watchlist: (
            <CollapsibleSection
              id="scan_watchlist"
              icon={Plus}
              title="Static Watchlist & Scheduler"
              subtitle="Browse Binance Futures (Crypto & TradFi/Overnight), copy from strategies & set rotation cadence"
              isOpen={openSectionId === 'scan_watchlist'}
              onToggle={() => setOpenSectionId(openSectionId === 'scan_watchlist' ? null : 'scan_watchlist')}
            >
              <div className="flex flex-col gap-4">
                {/* Clean 2-Column Capacity & Rotation Scheduler Bar */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-3.5 border-b border-border/50">
                  {/* Capacity Limit */}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center gap-2">
                      <CollapsibleHelpTitle
                        title="Watchlist Limit (Strict Ceiling)"
                        titleClassName="text-xs font-semibold text-text"
                        helpText="Strict cap on pinned pairs. Limit 1 enables Solo Mode where selecting a new pair swaps the active one."
                      />
                      <span className="text-[11px] font-mono text-accent tabular-nums">
                        {Number(cfg.watchlist_max_symbols) > 0 ? `Max ${cfg.watchlist_max_symbols}` : 'Unlimited'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {[
                        { label: '1 (Solo)', val: 1 },
                        { label: '2', val: 2 },
                        { label: '3', val: 3 },
                        { label: '5', val: 5 },
                        { label: '10', val: 10 },
                        { label: 'Unlimited', val: 0 },
                      ].map(p => (
                        <button
                          key={p.val}
                          type="button"
                          onClick={() => {
                            setField('watchlist_max_symbols', p.val);
                            if (p.val > 0 && Array.isArray(cfg.symbols) && cfg.symbols.length > p.val) {
                              setField('symbols', cfg.symbols.slice(0, p.val));
                            }
                          }}
                          className={cn(
                            "px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors cursor-pointer",
                            Number(cfg.watchlist_max_symbols || 0) === p.val
                              ? "bg-accent text-background font-semibold border-accent"
                              : "bg-background/50 border-border/60 text-muted hover:text-text"
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rotation Scheduler & Freeze Lock */}
                  <div className="flex flex-col gap-2 md:border-l md:border-border/40 md:pl-4">
                    <div className="flex items-center justify-between gap-2">
                      <CollapsibleHelpTitle
                        title="Rotation Scheduler"
                        titleClassName="text-xs font-semibold text-text"
                        helpText="Periodically promotes top favorable opportunities into this watchlist unless frozen."
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setField('watchlist_auto_rotate', !cfg.watchlist_auto_rotate)}
                          className={cn(
                            "px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors cursor-pointer",
                            cfg.watchlist_auto_rotate
                              ? "bg-green/15 border-green/35 text-green"
                              : "bg-background/50 border-border/60 text-muted hover:text-text"
                          )}
                        >
                          {cfg.watchlist_auto_rotate ? 'Auto-Rotate On' : 'Auto-Rotate Off'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setField('watchlist_locked', !cfg.watchlist_locked)}
                          className={cn(
                            "px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1 cursor-pointer",
                            cfg.watchlist_locked
                              ? "bg-amber/15 border-amber/35 text-amber"
                              : "bg-background/50 border-border/60 text-muted hover:text-text"
                          )}
                        >
                          <Lock size={10} />
                          <span>{cfg.watchlist_locked ? 'Frozen' : 'Freeze'}</span>
                        </button>
                      </div>
                    </div>

                    {cfg.watchlist_auto_rotate && !cfg.watchlist_locked && (
                      <div className="flex flex-wrap gap-1">
                        {[5, 15, 30, 60, 240, 1440].map(mins => (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => setField('watchlist_rotate_interval_min', mins)}
                            className={cn(
                              "px-2 py-0.5 rounded-md text-[11px] font-mono border transition-colors cursor-pointer",
                              (Number(cfg.watchlist_rotate_interval_min) || 15) === mins
                                ? "bg-green/15 border-green/40 text-green font-semibold"
                                : "bg-background/50 border-border/60 text-muted hover:text-text"
                            )}
                          >
                            {mins >= 1440 ? '1d' : mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Unified Catalog + Copy-From-Strategy Picker */}
                <WatchlistDropdownInput
                  value={cfg.symbols || []}
                  onChange={(val) => setField('symbols', val)}
                  currentStrategyLabel={cfg.strategy_label}
                  strategiesOverride={{
                    baseConfig: baseConfigBackup || baseConfig || cfg,
                    variants: Array.isArray(activeVariants) && activeVariants.length > 0
                      ? activeVariants
                      : (Array.isArray(baseConfig?.strategy_variants) ? baseConfig.strategy_variants : []),
                  }}
                  maxLimit={Number(cfg.watchlist_max_symbols || 0)}
                />

                <div className="pt-3 border-t border-border/40 flex flex-col gap-1.5">
                  <CollapsibleHelpTitle
                    title="Bulk Paste (Comma-Separated)"
                    titleClassName="text-[11px] font-medium text-muted"
                    helpText="Paste a comma-separated list of USDT perpetual symbols (e.g. BTCUSDT, SOLUSDT, XAUUSDT)."
                  />
                  <ListInput placeholder="BTCUSDT, ETHUSDT, SOLUSDT, XAUUSDT..." value={cfg.symbols} onChange={(val) => setField('symbols', val)} />
                </div>
              </div>
            </CollapsibleSection>
            ),

            scan_exclusion: (
            <CollapsibleSection
              id="scan_exclusion"
              icon={XCircle}
              title="Exclusion List"
              subtitle="Symbols to never trade"
              isOpen={openSectionId === 'scan_exclusion'}
              onToggle={() => setOpenSectionId(openSectionId === 'scan_exclusion' ? null : 'scan_exclusion')}
            >
              <ListInput placeholder="BTCUSDT, ETHUSDT..." value={cfg.excluded_symbols} onChange={(val) => setField('excluded_symbols', val)} />
            </CollapsibleSection>
            ),
            })}

            <section className="pt-6 border-t border-border/40">
               <div className="flex justify-between items-center mb-4">
                 <SectionHeader icon={ShieldCheck} title="Manual Monitors" subtitle="Specific symbols to track" />
                 {(Array.isArray(cfg.single_symbol_configs) ? cfg.single_symbol_configs : []).length > 0 && <button type="button" onClick={() => setField('single_symbol_configs', [])} className="text-[10px] font-black uppercase tracking-widest text-red/60 hover:text-red transition-colors flex items-center gap-1.5"><Trash2 size={12} /> Clear All</button>}
               </div>
               <ManualMonitorInput
                 onAdd={(val) => setField('single_symbol_configs', [...(Array.isArray(cfg.single_symbol_configs) ? cfg.single_symbol_configs : []), { symbol: val, enabled: true, follow_schedule: true }])}
               />
               <div className="flex flex-wrap gap-2 mt-4">
                 {(Array.isArray(cfg.single_symbol_configs) ? cfg.single_symbol_configs : []).length === 0 ? (
                   <p className="text-[10px] text-dim/40 font-bold uppercase tracking-widest p-3 border border-dashed border-border/40 rounded-xl w-full text-center">No manual symbols</p>
                 ) : (Array.isArray(cfg.single_symbol_configs) ? cfg.single_symbol_configs : []).map((sc, i) => (
                   <Chip key={i} active activeClass="bg-accent/10 border-accent/40 text-accent" aria-label={`Remove ${sc?.symbol || ''}`} onClick={() => setField('single_symbol_configs', (Array.isArray(cfg.single_symbol_configs) ? cfg.single_symbol_configs : []).filter((_, idx) => idx !== i))}>{sc?.symbol} <X size={10} className="inline ml-1" /></Chip>
                 ))}
               </div>
            </section>
          </div>
        )}

        {section === 'strategy' && (
          <div
            id="config-panel-strategy"
            role="tabpanel"
            aria-labelledby="config-tab-strategy"
            className="flex flex-col gap-4 lg:gap-6 animate-in fade-in duration-300"
          >
            {orderSectionEntries('strategy', {
            strategy_entry: (
            <CollapsibleSection
              id="strategy_entry"
              icon={Zap}
              title="Entry Signals"
              subtitle="Triggers for opening positions"
              isOpen={openSectionId === 'strategy_entry'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_entry' ? null : 'strategy_entry')}
            >
              <div className="flex flex-col gap-2 mb-4">
                <div className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-black text-dim uppercase tracking-widest truncate">Entry Signal Logic</span>
                    <InfoHelpButton
                      open={!!expandedHelpMap.entry_signal_logic}
                      onToggle={() => toggleHelpKey('entry_signal_logic')}
                      label="Entry Signal Logic"
                    />
                  </div>
                  <div className="flex bg-background p-1 rounded-lg border border-border shadow-inner shrink-0">
                    <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'any' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'any')}>ANY</button>
                    <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'all' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'all')}>ALL (AND)</button>
                    <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'combo' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'combo')}>COMBO</button>
                  </div>
                </div>
                {expandedHelpMap.entry_signal_logic && (
                  <InfoDropdownBox>
                    <strong>ANY:</strong> Enters if any active signal triggers. <strong>ALL (AND):</strong> Every active signal must agree. <strong>COMBO:</strong> Enters when all Required (AND) signals fire + at least one Optional (ANY) signal fires.
                  </InfoDropdownBox>
                )}
              </div>
              <SignalListWithCollapse
                signals={SIGNALS}
                activeSet={new Set(cfg.enabled_signals || [])}
                commonSet={new Set(['momentum_pct', 'ema_dual_cross', 'supertrend', 'engulfing', 'htf_breakout'])}
                renderCard={(signal) => (
                  <EntrySignalCard
                    key={signal[0]}
                    signal={signal}
                    active={(cfg.enabled_signals || []).includes(signal[0])}
                    isComboMode={cfg.signal_logic === 'combo'}
                    isRequired={(cfg.required_signals || []).includes(signal[0])}
                    onToggleRequired={handleToggleRequiredEntry}
                    layers={(cfg.enabled_signals || []).filter(sig => sig === signal[0] || isSignalLayer(sig, signal[0]))}
                    timeframes={cfg.signal_timeframes || {}}
                    scanTimeframe={cfg.scan_interval}
                    onToggle={handleToggleEntrySignal}
                    onAddLayer={handleAddEntryLayer}
                    onRemoveLayer={handleRemoveEntryLayer}
                    onUpdateLayer={handleUpdateEntryLayer}
                  />
                )}
              />
            </CollapsibleSection>
            ),

            strategy_params: (
            <CollapsibleSection
              id="strategy_params"
              icon={Activity}
              title="Signal Parameters"
              subtitle="Technical indicator periods"
              isOpen={openSectionId === 'strategy_params'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_params' ? null : 'strategy_params')}
            >
              <div className="flex flex-col gap-6">
                {(() => {
                  const entrySignals = cfg.enabled_signals || [];
                  const exitSignals = cfg.exit_signals || [];
                  const uniqueActiveSignals = Array.from(new Set([...entrySignals, ...exitSignals]));

                  // We always ensure global parameters like ma_period and ema_period are rendered first
                  const globalSchema = [
                    { key: 'signal_params_ma_period', label: 'MA Period', type: 'number', baseParamKey: 'ma_period', defaultValue: 20, attrs: { min: 1 } },
                    { key: 'signal_params_ema_period', label: 'EMA (Global Fallback)', type: 'number', baseParamKey: 'ema_period', defaultValue: 12, attrs: { min: 1 }, tooltip: "Global fallback period used if specific Entry/Exit EMA is not set" }
                  ];

                  // Generate cards for every active signal (including any suffixed layers)
                  const cards = [];

                  uniqueActiveSignals.forEach(sigKey => {
                    const baseType = getBaseSignalType(sigKey);
                    const isEntry = entrySignals.includes(sigKey);
                    const isExit = exitSignals.includes(sigKey);
                    const schema = getSignalParamsSchema(sigKey, baseType, isEntry, isExit);
                    if (schema.length > 0) {
                      const sigInfo = SIGNALS.find(s => s[0] === baseType);
                      const displayLabel = sigInfo ? sigInfo[1] : baseType;
                      const isLayered = sigKey !== baseType;
                      const layerSuffix = isLayered ? ` (Layer: _${sigKey.split('_').pop()})` : '';

                      cards.push({
                        key: sigKey,
                        label: `${displayLabel}${layerSuffix}`,
                        isLayered,
                        schema
                      });
                    }
                  });

                  return (
                    <div className="flex flex-col gap-6 text-left">
                      {/* Global fallback parameters */}
                      <div className="bg-background/20 p-4 rounded-2xl border border-border/50">
                        <div className="text-[9px] font-black text-dim uppercase tracking-[0.2em] mb-4">Global Parameters</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                          {globalSchema.map(field => (
                            <ConfigField
                              label={field.label}
                              id={`config-${field.key}`}
                              name={field.key}
                              key={field.key}
                              type={field.type}
                              value={cfg[field.key] !== undefined ? cfg[field.key] : field.defaultValue}
                              onChange={setField}
                              error={errors[field.key]}
                              warning={errors[`${field.key}_warn`]}
                              helpText={field.tooltip || TOOLTIPS[field.baseParamKey]}
                              attrs={{ ...field.attrs, onFocus: handleInputFocus }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Active signal-specific dynamic parameter cards */}
                      {[...cards].sort((a, b) => {
                        const aActive = uniqueActiveSignals.includes(a.key) || uniqueActiveSignals.includes(getBaseSignalType(a.key));
                        const bActive = uniqueActiveSignals.includes(b.key) || uniqueActiveSignals.includes(getBaseSignalType(b.key));
                        if (aActive !== bActive) return aActive ? -1 : 1;
                        return 0;
                      }).map(card => {
                        const isBooleanOnly = card.schema.every(s => s.type === 'boolean');
                        return (
                          <div key={card.key} className={cn(
                            "p-4 rounded-2xl border transition-all flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-300",
                            card.isLayered ? "border-purple/30 bg-purple/[0.01]" : "bg-background/20 border-border/50"
                          )}>
                            <div className="flex items-center justify-between">
                              <span className={cn(
                                "text-[9px] font-black uppercase tracking-[0.2em]",
                                card.isLayered ? "text-purple-400" : "text-accent"
                              )}>
                                {card.label}
                              </span>
                            </div>

                            <div className={cn(
                              "grid gap-6",
                              isBooleanOnly ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 md:grid-cols-4"
                            )}>
                              {card.schema.map(field => {
                                const tooltipText = TOOLTIPS[field.baseParamKey];
                                if (field.type === 'boolean') {
                                  return (
                                    <div key={field.key} className="flex flex-col gap-1.5 justify-center h-full min-h-[44px]">
                                      <div className="flex justify-between items-center gap-2">
                                        <CollapsibleHelpTitle
                                          title={field.label}
                                          titleClassName="text-[10px] text-dim font-black tracking-widest uppercase"
                                          helpText={tooltipText}
                                        />
                                        <Toggle
                                          value={cfg[field.key] !== undefined ? cfg[field.key] === true : field.defaultValue}
                                          onChange={(v) => setField(field.key, v)}
                                          color={card.isLayered ? "bg-purple" : "bg-accent"}
                                        />
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <ConfigField
                                    key={field.key}
                                    label={field.label}
                                    id={`config-${field.key}`}
                                    name={field.key}
                                    type={field.type}
                                    value={cfg[field.key] !== undefined ? cfg[field.key] : field.defaultValue}
                                    onChange={setField}
                                    error={errors[field.key]}
                                    warning={errors[`${field.key}_warn`]}
                                    opts={field.opts}
                                    helpText={tooltipText}
                                    attrs={{ ...field.attrs, onFocus: handleInputFocus }}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {(cfg.enabled_signals || []).some(s => s === 'ema_dual' || s === 'ema_dual_close') && (
                <CollapsibleInfoCard title="EMA Dual Logic" icon={Zap} className="mt-5">
                  <p className="text-[11px] text-dim leading-relaxed font-medium">
                    An authoritative trend-following strategy requiring alignment across two time horizons. {cfg.enabled_signals.includes('ema_dual_close') ? 'This variant strictly evaluates at the completed candle close.' : ''}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-background/40 border border-border/30 rounded-xl">
                      <div className="text-[9px] font-black text-green uppercase tracking-wider mb-1">Long Entry</div>
                      <div className="text-[10px] font-mono text-text/80">Fast EMA {'>'} Slow EMA</div>
                    </div>
                    <div className="p-3 bg-background/40 border border-border/30 rounded-xl">
                      <div className="text-[9px] font-black text-red uppercase tracking-wider mb-1">Short Entry</div>
                      <div className="text-[10px] font-mono text-text/80">Fast EMA {'<'} Slow EMA</div>
                    </div>
                  </div>
                  <p className="text-[10px] text-dim/70 italic leading-snug border-l-2 border-accent/20 pl-3">
                    Interpreted as a &ldquo;one-way door&rdquo;: if the fast EMA crosses back through the slow EMA, the trend is considered broken and the position is closed.
                  </p>
                </CollapsibleInfoCard>
              )}

            </CollapsibleSection>
            ),

            strategy_exit: (
            <CollapsibleSection
              id="strategy_exit"
              icon={XCircle}
              title="Exit Signals"
              subtitle="Automated early closures"
              isOpen={openSectionId === 'strategy_exit'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_exit' ? null : 'strategy_exit')}
            >
              <div className="flex items-start justify-between gap-4 p-3.5 mb-4 bg-surface/40 border border-border/30 rounded-xl hover:border-accent/15 transition-all">
                <CollapsibleHelpTitle
                  title="Exit Logic Override"
                  titleClassName="text-[10px] font-black text-dim uppercase tracking-widest"
                  helpText="Bypass ratcheting/trailing, immediately cancel SL, and drop exit signal delays to 0 when trade profit exceeds exit targets."
                />
                <Toggle
                  value={cfg.exit_signals_override_ratchet || false}
                  onChange={(v) => setField('exit_signals_override_ratchet', v)}
                />
              </div>
              <div className="flex flex-col gap-2 mb-4">
                <div className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-black text-dim uppercase tracking-widest truncate">Exit Signal Logic</span>
                    <InfoHelpButton
                      open={!!expandedHelpMap.exit_signal_logic}
                      onToggle={() => toggleHelpKey('exit_signal_logic')}
                      label="Exit Signal Logic"
                    />
                  </div>
                  <div className="flex bg-background p-1 rounded-lg border border-border shadow-inner shrink-0">
                    <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.exit_signal_logic || 'any') === 'any' ? "bg-red text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('exit_signal_logic', 'any')}>ANY</button>
                    <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", cfg.exit_signal_logic === 'all' ? "bg-red text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('exit_signal_logic', 'all')}>ALL (AND)</button>
                    <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", cfg.exit_signal_logic === 'combo' ? "bg-red text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('exit_signal_logic', 'combo')}>COMBO</button>
                  </div>
                </div>
                {expandedHelpMap.exit_signal_logic && (
                  <InfoDropdownBox>
                    <strong>ANY:</strong> Closes position when any exit signal fires. <strong>ALL (AND):</strong> Requires all selected exit signals to agree. <strong>COMBO:</strong> Closes when all Required (AND) exit signals fire + at least one Optional (ANY) exit signal fires.
                  </InfoDropdownBox>
                )}
              </div>
              <SignalListWithCollapse
                signals={SIGNALS}
                activeSet={new Set(cfg.exit_signals || [])}
                commonSet={new Set(['trigger_candle_exit', 'supertrend', 'engulfing', 'macd_fade'])}
                renderCard={(signal) => (
                  <ExitSignalCard
                    key={signal[0]}
                    signal={signal}
                    active={(cfg.exit_signals || []).includes(signal[0])}
                    isComboMode={cfg.exit_signal_logic === 'combo'}
                    isRequired={(cfg.required_exit_signals || []).includes(signal[0])}
                    onToggleRequired={handleToggleRequiredExit}
                    layers={(cfg.exit_signals || []).filter(sig => sig === signal[0] || isSignalLayer(sig, signal[0]))}
                    delays={cfg.exit_signal_delays || {}}
                    actions={cfg.exit_signal_actions || {}}
                    timeframes={cfg.signal_timeframes || {}}
                    scanTimeframe={cfg.scan_interval}
                    onToggle={handleToggleExitSignal}
                    onAddLayer={handleAddLayer}
                    onRemoveLayer={handleRemoveLayer}
                    onUpdateLayer={handleUpdateLayer}
                    engulfingMode={cfg.engulfing_mode}
                  />
                )}
              />
            </CollapsibleSection>
            ),

            strategy_whipsaw: (
            <CollapsibleSection
              id="strategy_whipsaw"
              icon={ShieldCheck}
              title="Anti-Whipsaw Re-Entry Gating"
              subtitle="Execution cooldowns between consecutive trades"
              isOpen={openSectionId === 'strategy_whipsaw'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_whipsaw' ? null : 'strategy_whipsaw')}
            >
              <div className="flex flex-col gap-4">
                <div className="p-3.5 bg-surface/40 border border-border/30 rounded-xl flex flex-col gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {renderField('Anti-Whipsaw Candle Delay', 'anti_whipsaw_candle_delay', 'number', null, {
                      min: 0,
                      max: 20,
                      helpText: "Number of full candles to delay re-entry after an exit or entry on the same symbol (0 = disabled, 1 = default 1-candle delay). Applies to all standard strategy signals."
                    })}
                    {renderField('Anti-Whipsaw Timeframe Delay (min)', 'anti_whipsaw_tf_delay_min', 'number', null, {
                      min: 0,
                      max: 1440,
                      helpText: "Custom time delay (in minutes) after an exit before re-entry is permitted on the symbol. Overrides candle delay if time delay is longer."
                    })}
                    {renderField('Max Anti-Whipsaw Timeframe', 'anti_whipsaw_max_tf', 'text', [
                      { value: '1m', label: '1m' },
                      { value: '3m', label: '3m' },
                      { value: '5m', label: '5m' },
                      { value: '15m', label: '15m' },
                      { value: '30m', label: '30m' },
                      { value: '1h', label: '1h' },
                      { value: '4h', label: '4h (Default - Excludes 1d+ macro)' },
                      { value: '1d', label: '1d' },
                      { value: 'none', label: 'None (No limit)' }
                    ], {
                      helpText: "Maximum signal timeframe evaluated for anti-whipsaw same-candle gating. Signals with larger timeframes (e.g. 1d confirming entry signals) will not lock out re-entries for 24 hours. Default: 4h."
                    })}
                    <div className="flex flex-col gap-1 text-left">
                      <div className="flex items-center gap-1">
                        <label htmlFor="anti-whipsaw-tfs" className="text-[9px] text-dim font-black tracking-widest uppercase">
                          Explicit Timeframes Override
                        </label>
                        <InfoHelpButton
                          open={!!expandedHelpMap.anti_whipsaw_tfs}
                          onToggle={() => toggleHelpKey('anti_whipsaw_tfs')}
                          label="Explicit Timeframes Override"
                        />
                      </div>
                      <ListInput
                        id="anti-whipsaw-tfs"
                        placeholder="e.g. 1m, 1h (leave empty for auto)"
                        value={cfg.anti_whipsaw_timeframes}
                        onChange={(val) => setField('anti_whipsaw_timeframes', val)}
                      />
                      {expandedHelpMap.anti_whipsaw_tfs && (
                        <InfoDropdownBox>Comma-separated timeframes to explicitly enforce whipsaw cooldowns on. Leave empty for automatic detection capped by Max Timeframe.</InfoDropdownBox>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-3 pt-2 border-t border-border/20">
                    <CollapsibleHelpTitle
                      title="Per-Strategy Cooldown Isolation"
                      titleClassName="text-[10px] font-black text-text uppercase tracking-widest"
                      helpText={'When enabled (default), anti-whipsaw cooldowns apply strictly within this strategy or variant so one strategy never blocks another. Signals above Max Timeframe (e.g. 1d macro) are excluded; Knife Catch trades can bypass via "Allow Knife Re-entry".'}
                    />
                    <Toggle value={cfg.anti_whipsaw_per_strategy !== false} onChange={(v) => setField('anti_whipsaw_per_strategy', v)} />
                  </div>
                </div>
              </div>
            </CollapsibleSection>
            ),

            strategy_knife: (
            <CollapsibleSection
              id="strategy_knife"
              icon={Zap}
              title="Knife Catch & Risk Bypass"
              subtitle="Velocity ROC trailing, auto-ratchet & gating bypass"
              isOpen={openSectionId === 'strategy_knife'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_knife' ? null : 'strategy_knife')}
            >
              <div className="flex flex-col gap-4">
                <div className="p-3.5 bg-amber/5 border border-amber/20 rounded-2xl flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-amber/10 flex items-center justify-center text-amber shrink-0">
                        <Zap size={16} />
                      </div>
                      <span className="text-xs font-bold truncate">Knife Trailing Stop</span>
                      <InfoHelpButton
                        open={!!expandedHelpMap.knife_trailing_toggle}
                        onToggle={() => toggleHelpKey('knife_trailing_toggle')}
                        label="Knife Trailing Stop"
                      />
                    </div>
                    <Toggle value={cfg.knife_trailing_enabled !== false} onChange={(v) => setField('knife_trailing_enabled', v)} color="bg-amber" />
                  </div>
                  {expandedHelpMap.knife_trailing_toggle && (
                    <InfoDropdownBox>High-frequency velocity ROC trailing stop applied specifically to Knife Catch burst entries.</InfoDropdownBox>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {renderField('Knife Trailing Distance (%)', 'knife_trailing_distance_pct', 'number', null, {
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    helpText: "Dynamic trailing distance (%) applied strictly to high-velocity Knife Catch trades on fast ticks."
                  })}
                  {renderField('Auto-Ratchet Breakeven (RR)', 'knife_auto_ratchet_be_rr', 'number', null, {
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    helpText: "Target R:R threshold where Stop Loss instantly ratchets to Breakeven (0.0R) upon price crossing velocity threshold."
                  })}
                  {renderField('Auto-Ratchet Lock Profit (RR)', 'knife_auto_ratchet_lock_rr', 'number', null, {
                    min: 0.1,
                    max: 10,
                    step: 0.1,
                    helpText: "Target R:R threshold where Stop Loss instantly ratchets to Lock Profit (0.5R or configured) upon price expansion."
                  })}
                </div>

                <div className="pt-4 border-t border-border/40 flex flex-col gap-3">
                  <div className="p-3.5 bg-surface/40 border border-border/30 rounded-xl flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <CollapsibleHelpTitle
                        title="Allow Knife Re-entry (Bypass)"
                        icon={Zap}
                        titleClassName="text-[10px] font-black text-amber uppercase tracking-widest"
                        helpText="If a trade was closed by Knife Catch engine, allow re-entering the symbol in the same candle provided the candidate is still a Knife Catch trade."
                      />
                      <Toggle value={cfg.anti_whipsaw_allow_knife === true} onChange={(v) => setField('anti_whipsaw_allow_knife', v)} color="bg-amber" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/20">
                      {renderField('Anti-Whipsaw Candle Delay', 'anti_whipsaw_candle_delay', 'number', null, {
                        min: 0,
                        max: 20,
                        helpText: "Number of full candles to delay re-entry after an exit or entry on the same symbol (0 = disabled, 1 = default 1-candle delay)."
                      })}
                      {renderField('Anti-Whipsaw Timeframe Delay (min)', 'anti_whipsaw_tf_delay_min', 'number', null, {
                        min: 0,
                        max: 1440,
                        helpText: "Custom time delay (in minutes) after an exit before re-entry is permitted. Overrides candle delay if time delay is longer."
                      })}
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-3 p-3.5 bg-surface/40 border border-border/30 rounded-xl hover:border-amber/20 transition-all">
                    <CollapsibleHelpTitle
                      title="Allow 1 Knife Trade When Gated"
                      icon={Zap}
                      titleClassName="text-[10px] font-black text-amber uppercase tracking-widest"
                      helpText="Allow entering up to 1 Knife Catch trade even when strategy gating is active (e.g. max open trades, SL guard, or rolling period limits), provided 0 active knife trades exist."
                    />
                    <Toggle value={cfg.allow_knife_when_gated === true} onChange={(v) => setField('allow_knife_when_gated', v)} color="bg-amber" />
                  </div>
                </div>
              </div>
            </CollapsibleSection>
            ),

            strategy_timeframes: (
            <CollapsibleSection
              id="strategy_timeframes"
              icon={Clock}
              title="Multi-Timeframe Overrides"
              subtitle="Signal-specific timeframe overlays"
              isOpen={openSectionId === 'strategy_timeframes'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_timeframes' ? null : 'strategy_timeframes')}
            >
              {(() => {
                const activeEntrySignals = cfg.enabled_signals || [];
                const activeExitSignals = cfg.exit_signals || [];
                const allActiveSignals = Array.from(new Set([...activeEntrySignals, ...activeExitSignals]));

                if (allActiveSignals.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center p-5 text-center border border-dashed border-border rounded-2xl bg-surface/30 gap-2">
                      <div className="flex items-center gap-1.5">
                        <Clock className="text-dim opacity-50" size={16} />
                        <span className="text-[10px] text-dim font-bold uppercase tracking-wider">No Active Signals</span>
                        <InfoHelpButton
                          open={!!expandedHelpMap.mtf_empty}
                          onToggle={() => toggleHelpKey('mtf_empty')}
                          label="Multi-Timeframe Overrides"
                        />
                      </div>
                      {expandedHelpMap.mtf_empty && (
                        <InfoDropdownBox className="max-w-xs">Enable Entry or Exit signals above to configure custom timeframe overrides for them.</InfoDropdownBox>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {allActiveSignals.map((signalKey) => {
                      const sigInfo = SIGNALS.find(s => s[0] === signalKey);
                      const label = sigInfo ? sigInfo[1] : signalKey;

                      const isEntry = activeEntrySignals.includes(signalKey);
                      const isExit = activeExitSignals.includes(signalKey);

                      let usage = '';
                      if (isEntry && isExit) usage = 'Entry & Exit';
                      else if (isEntry) usage = 'Entry Only';
                      else if (isExit) usage = 'Exit Only';

                      const value = (cfg.signal_timeframes || {})[signalKey];

                      return (
                        <div key={signalKey} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-surface border border-border rounded-xl hover:border-border-hover transition-all">
                          <div className="flex flex-col items-start text-left">
                            <span className="text-xs font-bold text-text">{label}</span>
                            <span className="text-[9px] text-accent font-black tracking-wider uppercase mt-0.5">{usage}</span>
                          </div>
                          <div className="relative flex items-center">
                            <select
                              value={value || 'default'}
                              aria-label={`Timeframe override for ${label}`}
                              onChange={(e) => {
                                const val = e.target.value;
                                const current = cfg.signal_timeframes || {};
                                const updated = { ...current };
                                if (val === 'default') {
                                  updated[signalKey] = 'default';
                                } else {
                                  updated[signalKey] = val;
                                }
                                setField('signal_timeframes', updated);
                              }}
                              className="bg-background border border-border rounded-lg pl-2.5 pr-7 py-1 text-xs font-bold text-text focus:border-accent outline-none appearance-none cursor-pointer transition-all hover:border-border-hover min-h-[32px] h-8 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                            >
                              <option value="default">Default ({cfg.scan_interval || 'Default'})</option>
                              <option value="1m">1m</option>
                              <option value="3m">3m</option>
                              <option value="5m">5m</option>
                              <option value="15m">15m</option>
                              <option value="30m">30m</option>
                              <option value="1h">1h</option>
                              <option value="4h">4h</option>
                              <option value="1d">1d</option>
                            </select>
                            <div className="absolute right-2.5 pointer-events-none text-dim">
                              <ChevronDown size={12} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CollapsibleSection>
            ),
            })}
          </div>
        )}

        {section === 'risk' && (
          <div
            id="config-panel-risk"
            role="tabpanel"
            aria-labelledby="config-tab-risk"
            className="flex flex-col gap-4 lg:gap-6 animate-in fade-in duration-300"
          >
            {orderSectionEntries('risk', {
            risk_guards: (
            <CollapsibleSection
              id="risk_guards"
              icon={ShieldCheck}
              title="Capital Guards"
              subtitle="Global safety limits"
              isOpen={openSectionId === 'risk_guards'}
              onToggle={() => setOpenSectionId(openSectionId === 'risk_guards' ? null : 'risk_guards')}
              {...getSectionErrorInfo('risk_guards')}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {renderField('Risk % Per Trade', 'risk_pct_per_trade', 'number', null, { min: CONFIG_LIMITS.RISK_PER_TRADE_MIN, max: CONFIG_LIMITS.RISK_PER_TRADE_MAX, step: 0.1 })}
                {renderField('Max Total Risk %', 'max_total_risk_pct', 'number', null, { min: CONFIG_LIMITS.MAX_TOTAL_RISK_MIN, max: CONFIG_LIMITS.MAX_TOTAL_RISK_MAX })}
                {renderField('Max Open Trades', 'max_open_trades', 'number', null, { min: CONFIG_LIMITS.MAX_OPEN_TRADES_MIN })}
                {renderField('SL Guard (USDT)', 'total_sl_guard_usdt', 'number', null, { min: 0 })}
                {renderField('Slippage warning (%)', 'slippage_warning_threshold', 'number', null, {
                  min: 0,
                  max: 100,
                  step: 0.1,
                  helpText: "Warn when execution slippage exceeds this percentage. Invalid legacy values must be corrected before saving; this does not change the separate abort threshold."
                })}
              </div>

              <div className="p-4 my-4 bg-surface/40 border border-border/30 rounded-xl hover:border-accent/15 transition-all flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <CollapsibleHelpTitle
                    title="Est. P&L Risk Release"
                    titleClassName="text-[10px] font-black text-dim uppercase tracking-widest"
                    helpText="Release risk lock (risk_usdt = 0) when active estimated P&L reaches a configured USDT or R:R floor, even before the physical stop-loss ratchets."
                  />
                  <Toggle
                    value={cfg.release_risk_on_est_pnl_be || false}
                    onChange={(v) => setField('release_risk_on_est_pnl_be', v)}
                  />
                </div>

                {cfg.release_risk_on_est_pnl_be && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/20">
                    {renderField('Threshold Unit', 'release_risk_est_pnl_mode', 'text', [
                      { value: 'usdt', label: 'USDT value' },
                      { value: 'rr', label: 'Risk:Reward (R)' },
                    ], { helpText: 'Compare the estimated exit floor as absolute USDT or as a multiple of immutable initial trade risk.' })}
                    {cfg.release_risk_est_pnl_mode === 'rr'
                      ? renderField('Min Estimated R:R', 'release_risk_est_pnl_min_rr', 'number', null, {
                          min: -1000,
                          max: 1000,
                          step: 0.1,
                          inputMode: 'text',
                          placeholder: '0',
                          helpText: 'Estimated P&L divided by initial trade risk. For example, 0.5 releases at +0.5R.'
                        })
                      : renderField('Min Est. P&L (USDT)', 'release_risk_est_pnl_min_usdt', 'number', null, {
                          min: -100000,
                          max: 100000,
                          step: 0.5,
                          inputMode: 'text',
                          placeholder: '0',
                          helpText: 'Use 0 for breakeven, a positive value for a profit buffer, or a negative value to release earlier.'
                        })}
                  </div>
                )}
              </div>

              {/* Dynamic Auto-Adjust Max Open Trades on Zero Risk */}
              <div className="p-4 my-4 bg-surface/40 border border-border/30 rounded-xl flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <CollapsibleHelpTitle
                    title="Auto-Adjust Max Open Trades (Zero Risk)"
                    icon={Zap}
                    titleClassName="text-[10px] font-black text-dim uppercase tracking-widest"
                    helpText="Dynamically step up max allowed trades when strategy active risk reaches 0 (all open positions risk-protected). Step down when active risk is re-locked."
                  />
                  <Toggle
                    value={cfg.auto_adjust_max_trades_enabled || false}
                    onChange={(v) => setField('auto_adjust_max_trades_enabled', v)}
                  />
                </div>

                {cfg.auto_adjust_max_trades_enabled && (
                  <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border/20">
                    {renderField('Min Limit', 'auto_adjust_max_trades_min', 'number', null, { min: 1, max: 20 })}
                    {renderField('Max Limit', 'auto_adjust_max_trades_max', 'number', null, { min: 1, max: 50 })}
                    {renderField('Step Size', 'auto_adjust_max_trades_step', 'number', null, { min: 1, max: 5 })}
                  </div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-4 bg-accent/5 border border-accent/20 rounded-2xl flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-dim uppercase font-bold tracking-widest mb-1">Target Risk</span>
                    <span className="text-sm font-bold font-mono text-amber">{fmtUSD(riskAmount)} <span className="text-[10px] opacity-60 font-medium">USD</span></span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[9px] text-dim uppercase font-bold tracking-widest mb-1">Return Goal</span>
                    <span className="text-sm font-bold font-mono text-accent">{cfg.tp_ratio || 2.0}R <span className="text-[10px] opacity-60 font-medium">REWARD</span></span>
                  </div>
                </div>

                <div className={cn(
                  "p-3.5 border rounded-2xl flex flex-col justify-center gap-2",
                  cfg.auto_scale_min_notional !== false && (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) < 5.05
                    ? "bg-amber/5 border-amber/20 shadow-[0_0_20px_rgba(245,166,35,0.05)]"
                    : "bg-background/40 border-border/40"
                )}>
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] text-dim uppercase font-bold tracking-widest truncate">Min Notional Guard</span>
                      <span className="text-[8px] text-accent font-bold uppercase tracking-tight shrink-0">$5.05</span>
                      <InfoHelpButton
                        open={!!expandedHelpMap.risk_min_notional}
                        onToggle={() => toggleHelpKey('risk_min_notional')}
                        label="Min Notional Guard"
                      />
                    </div>
                    <Toggle value={cfg.auto_scale_min_notional !== false} onChange={(v) => setField('auto_scale_min_notional', v)} color="bg-accent" />
                  </div>
                  <div className={cn(cfg.auto_scale_min_notional !== false ? "block" : "hidden")}>
                    {renderField('Max Scaled Risk Overshoot (Multiplier)', 'auto_scale_max_overshoot', 'number', null, { min: 1.0, max: 10.0, step: 0.1 })}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={cn(
                      "text-sm font-bold font-mono transition-colors",
                      cfg.auto_scale_min_notional !== false && (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) < 5.05 ? "text-amber" : "text-text"
                    )}>
                      {fmtUSD(cfg.auto_scale_min_notional !== false ? Math.max(5.05, riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) : (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)))}
                      <span className="text-[9px] ml-1.5 opacity-40 font-medium uppercase tracking-tight">Execution</span>
                    </span>
                    {(cfg.auto_scale_min_notional !== false && (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) < 5.05) && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-amber text-black font-black rounded-sm uppercase">Auto-Scaled</span>
                    )}
                  </div>
                  {expandedHelpMap.risk_min_notional && (
                    <InfoDropdownBox className="flex flex-col gap-1">
                      <span>Binance Futures requires a minimum position size of $5.00 + $0.05 buffer ($5.05).</span>
                      <span className="font-mono text-text/80">
                        Math: {fmtUSD(riskAmount)} Target Risk / {Number(cfg.sl_distance_pct || 0.8).toFixed(1)}% SL = {fmtUSD(riskAmount / ((cfg.sl_distance_pct || 0.8) / 100))} Notional
                      </span>
                      <span className="text-accent font-bold">
                        {cfg.auto_scale_min_notional === false ? 'Scaling disabled (orders < $5 may fail).' : (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) < 5.05 ? 'Scaling up to meet exchange minimum.' : 'Threshold met, using precise sizing.'}
                      </span>
                    </InfoDropdownBox>
                  )}
                </div>

                <div className={cn(
                  "p-3.5 border rounded-2xl flex flex-col justify-center gap-2",
                  cfg.auto_scale_min_notional === false && cfg.risk_hardening_enabled
                    ? "bg-red/5 border-red/20 shadow-[0_0_20px_rgba(239,68,68,0.05)]"
                    : "bg-background/40 border-border/40",
                  cfg.auto_scale_min_notional !== false && "opacity-40 grayscale grayscale-[50%]"
                )}>
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] text-dim uppercase font-bold tracking-widest truncate">Risk Hardening</span>
                      <InfoHelpButton
                        open={!!expandedHelpMap.risk_hardening}
                        onToggle={() => toggleHelpKey('risk_hardening')}
                        label="Risk Hardening"
                      />
                    </div>
                    <Toggle
                      value={cfg.risk_hardening_enabled === true}
                      onChange={(v) => setField('risk_hardening_enabled', v)}
                      color="bg-red"
                    />
                  </div>
                  <div className={cn(cfg.risk_hardening_enabled ? "block" : "hidden")}>
                    {renderField('Max Single Trade Risk (%)', 'max_single_trade_risk_pct', 'number', null, { min: 0.1, max: 100, step: 0.5 })}
                  </div>
                  {expandedHelpMap.risk_hardening && (
                    <InfoDropdownBox>
                      {cfg.auto_scale_min_notional !== false
                        ? 'Small Account Guard: Only active when Auto-Scale Min Notional is OFF.'
                        : cfg.risk_hardening_enabled
                        ? `Protects small accounts from $5.00 exchange minimum overshoot. Trades will be rejected if they force > ${cfg.max_single_trade_risk_pct}% account risk.`
                        : 'Protects small accounts when Auto-Scale is OFF. Currently disabled — small accounts may take oversized exposure.'}
                    </InfoDropdownBox>
                  )}
                </div>
              </div>

              <CollapsibleInfoCard title="Sizing Guide" icon={Target}>
                 <div className="flex flex-col gap-2">
                    <p className="text-[10px] text-dim leading-relaxed font-medium">
                       Position size (Qty) is derived from <span className="text-text font-bold">Target Risk $ / SL Distance</span>.
                    </p>
                    <div className="bg-background/40 p-2.5 rounded-lg border border-border/30">
                       <div className="flex items-center gap-1.5 mb-1.5">
                          <Zap size={10} className="text-accent" />
                          <span className="text-[9px] text-accent font-black uppercase tracking-widest">Scaling Example</span>
                       </div>
                       <p className="text-[10px] font-mono text-dim leading-tight">
                          $0.10 risk @ 5% SL = $2.00 notional.<br/>
                          <span className={cn(cfg.auto_scale_min_notional === false ? "text-red" : "text-amber", "font-bold")}>
                            {cfg.auto_scale_min_notional === false ? "→ Exchange will REJECT order" : "→ Engine scales entry to $5.05"}
                          </span>
                       </p>
                    </div>
                    <p className="text-[9px] text-dim/60 italic leading-snug">
                       Tight SLs or higher Risk % result in larger positions. Wide SLs or low Risk % result in smaller positions. The engine protects you from exchange rejections by enforcing the $5.05 minimum.
                    </p>
                 </div>
              </CollapsibleInfoCard>

              {(cfg.tp_mode === 'exp_rr_seq' || cfg.tp_mode === 'exp_rr_seq_switch') && (
                <div className="flex flex-col gap-2 mt-6 bg-background/50 p-5 rounded-2xl border border-border/40 shadow-inner">
                  {cfg.tp_mode === 'exp_rr_seq_switch' && (
                    <div className="mb-4 grid grid-cols-2 gap-4 pb-4 border-b border-border/30">
                      {renderField('Peak RR Switch Threshold', 'peak_rr_switch_threshold', 'number', null, { min: 0.1, step: 0.1, tooltip: 'When an active trade reaches this peak RR, all new trades will switch to the alternative guards.' })}
                      {renderField('Peak RR Switch Count', 'peak_rr_switch_count', 'number', null, { min: 1, step: 1, tooltip: 'How many times the strategy must hit the threshold to activate the switch.' })}
                      {renderField('Switched SL Distance %', 'switched_sl_distance_pct', 'number', null, { min: 0.1, step: 0.1, max: 10, tooltip: 'If set, overrides the strategy SL distance % (when using High/Low or fallback Stop Loss) after the switch condition is met. Leave blank to retain default.' })}
                    </div>
                  )}
                  <div className="flex justify-between items-center text-[10px] text-dim font-bold uppercase tracking-widest mb-3 px-1">
                    <div className="flex items-center gap-2">
                      <span>{cfg.tp_mode === 'exp_rr_seq_switch' ? 'Primary RR Milestone (Target)' : 'RR Milestone (Target)'}</span>
                      <span>→ Adjust SL (R)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Tooltip content="Copy Milestones to Clipboard">
                        <button
                          type="button"
                          onClick={() => {
                            const l = Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [1.0, 2.0, 4.0];
                            const ex = Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [0.0, 1.0, 2.0];
                            let text = l.map((trig, idx) => `${trig} -> ${ex[idx] ?? 0}`).join('\n');

                            if (cfg.tp_mode === 'exp_rr_seq_switch') {
                              const swL = Array.isArray(cfg.switched_live_rr_sequence) ? cfg.switched_live_rr_sequence : [1.0, 2.0, 3.0];
                              const swEx = Array.isArray(cfg.switched_exit_rr_sequence) ? cfg.switched_exit_rr_sequence : [0.0, 1.0, 1.5];
                              const swText = swL.map((trig, idx) => `${trig} -> ${swEx[idx] ?? 0}`).join('\n');
                              text = `Baseline:\n${text}\n\nSwitched:\n${swText}`;
                            }

                            navigator.clipboard.writeText(text);
                            addAlert({ level: 'info', title: 'Milestones Copied', message: 'RR Milestones copied to clipboard.' });
                          }}
                          className="px-2 py-1 bg-surface border border-border/60 hover:border-accent/40 rounded text-[9px] font-black uppercase text-dim hover:text-accent flex items-center gap-1 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none"
                          aria-label="Copy Milestones to Clipboard"
                        >
                          <Copy size={10} /> Copy
                        </button>
                      </Tooltip>
                      <Tooltip content="Paste Milestones (e.g., 1 -> 0, 2 -> 1, 4 -> 2)">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const text = await navigator.clipboard.readText();
                              if (!text) return;
                              const lines = text.split(/[\r\n]+/);

                              const parsedBase = [];
                              const parsedSwitched = [];
                              let currentTarget = parsedBase;

                              lines.forEach(line => {
                                const trimmed = line.trim();
                                if (!trimmed) return;

                                if (trimmed.toLowerCase().includes('baseline:')) {
                                  currentTarget = parsedBase;
                                  return;
                                }
                                if (trimmed.toLowerCase().includes('switched:')) {
                                  currentTarget = parsedSwitched;
                                  return;
                                }

                                if (trimmed.includes('->') || trimmed.includes(':') || trimmed.includes(',')) {
                                  const parts = trimmed.split(/->|:|,/);
                                  const trig = parseFloat(parts[0]);
                                  const ex = parseFloat(parts[1] ?? '0');
                                  if (!isNaN(trig)) {
                                    currentTarget.push({ trigger: trig, exit: isNaN(ex) ? 0 : ex });
                                  }
                                } else {
                                  const val = parseFloat(trimmed);
                                  if (!isNaN(val)) {
                                    currentTarget.push({ trigger: val, exit: Math.max(0, val - 1) });
                                  }
                                }
                              });

                              if (parsedBase.length > 0 || parsedSwitched.length > 0) {
                                parsedBase.sort((a, b) => a.trigger - b.trigger);
                                parsedSwitched.sort((a, b) => a.trigger - b.trigger);

                                setCfg(prev => {
                                  const nextState = { ...prev };
                                  if (parsedBase.length > 0) {
                                    nextState.live_rr_sequence = parsedBase.map(p => p.trigger);
                                    nextState.exit_rr_sequence = parsedBase.map(p => p.exit);
                                  }
                                  if (parsedSwitched.length > 0) {
                                    nextState.switched_live_rr_sequence = parsedSwitched.map(p => p.trigger);
                                    nextState.switched_exit_rr_sequence = parsedSwitched.map(p => p.exit);
                                  }
                                  return nextState;
                                });
                                addAlert({ level: 'success', title: 'Milestones Imported', message: `Imported ${parsedBase.length} base and ${parsedSwitched.length} switched milestones.` });
                              }
                            } catch (err) {
                              addAlert({ level: 'warn', title: 'Paste Failed', message: 'Could not read clipboard. Please grant permission or check input.' });
                            }
                          }}
                          className="px-2 py-1 bg-surface border border-border/60 hover:border-accent/40 rounded text-[9px] font-black uppercase text-dim hover:text-accent flex items-center gap-1 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent outline-none"
                          aria-label="Paste Milestones from Clipboard"
                        >
                          <ClipboardPaste size={10} /> Paste
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                  {sequence.map(([live, exit], i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="relative flex-1">
                        <input type="number" inputMode="decimal" step="0.1" value={live} onChange={(e) => {
                          const next = [...(Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [1.0, 2.0, 4.0])];
                          next[i] = Number(e.target.value);
                          setField('live_rr_sequence', next);
                        }} onBlur={handleSortMilestones} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none pr-6" />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim/40">R</span>
                      </div>
                      <ArrowRight size={13} className="text-dim/20 shrink-0" />
                      <div className="relative flex-1">
                        <input type="number" inputMode="decimal" step="0.1" value={exit} onChange={(e) => {
                          const next = [...(Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [0.0, 1.0, 2.0])];
                          next[i] = Number(e.target.value);
                          setField('exit_rr_sequence', next);
                        }} onBlur={handleSortMilestones} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none pr-6" />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim/40">R</span>
                      </div>
                      <Tooltip content="Remove Milestone">
                        <button type="button" onClick={() => {
                          const nextL = [...(cfg.live_rr_sequence || [])];
                          const nextE = [...(cfg.exit_rr_sequence || [])];
                          nextL.splice(i, 1);
                          nextE.splice(i, 1);
                          setCfg(prev => ({ ...prev, live_rr_sequence: nextL, exit_rr_sequence: nextE }));
                        }} aria-label="Remove Milestone" className="p-1.5 text-dim hover:text-red transition-colors rounded-lg hover:bg-red/5"><Trash2 size={14} /></button>
                      </Tooltip>
                    </div>
                  ))}
                  <button type="button" onClick={() => {
                    const nextL = [...(Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [1.0, 2.0, 4.0]), 5.0];
                    const nextE = [...(Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [0.0, 1.0, 2.0]), 3.0];
                    const pairs = nextL.map((trigger, idx) => ({
                      trigger: Number(trigger || 0),
                      exit: Number(nextE[idx] || 0)
                    }));
                    pairs.sort((a, b) => a.trigger - b.trigger);
                    setCfg(prev => ({
                      ...prev,
                      live_rr_sequence: pairs.map(p => p.trigger),
                      exit_rr_sequence: pairs.map(p => p.exit)
                    }));
                  }} className="w-full py-2 border border-dashed border-border rounded-lg text-[10px] font-bold uppercase tracking-widest text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all mt-2 group flex items-center justify-center gap-2"><Plus size={13} className="group-hover:scale-110 transition-transform" /> Add RR Milestone</button>

                  {cfg.tp_mode === 'exp_rr_seq_switch' && (
                    <div className="mt-4 pt-4 border-t border-border/30">
                      <div className="flex justify-between items-center text-[10px] text-dim font-bold uppercase tracking-widest mb-3 px-1">
                        <div className="flex items-center gap-2">
                          <span>Switched RR Milestone (Target)</span>
                          <span>→ Adjust SL (R)</span>
                        </div>
                      </div>

                      {(() => {
                        const swSeq = [];
                        const liveSw = Array.isArray(cfg.switched_live_rr_sequence) ? cfg.switched_live_rr_sequence : [1.0, 2.0, 3.0];
                        const exitSw = Array.isArray(cfg.switched_exit_rr_sequence) ? cfg.switched_exit_rr_sequence : [0.0, 1.0, 1.5];
                        for (let i = 0; i < liveSw.length; i++) {
                          swSeq.push([liveSw[i], exitSw[i] !== undefined ? exitSw[i] : 0]);
                        }

                        const handleSortSwitchedMilestones = () => {
                          const pairs = swSeq.map(([trigger, exit]) => ({ trigger, exit }));
                          pairs.sort((a, b) => a.trigger - b.trigger);
                          setCfg(prev => ({
                            ...prev,
                            switched_live_rr_sequence: pairs.map(p => p.trigger),
                            switched_exit_rr_sequence: pairs.map(p => p.exit)
                          }));
                        };

                        return (
                          <div className="flex flex-col gap-2">
                            {swSeq.map(([live, exit], i) => (
                              <div key={i} className="flex items-center gap-3">
                                <div className="relative flex-1">
                                  <input type="number" inputMode="decimal" step="0.1" value={live} onChange={(e) => {
                                    const next = [...liveSw];
                                    next[i] = Number(e.target.value);
                                    setField('switched_live_rr_sequence', next);
                                  }} onBlur={handleSortSwitchedMilestones} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none pr-6" />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim/40">R</span>
                                </div>
                                <ArrowRight size={13} className="text-dim/20 shrink-0" />
                                <div className="relative flex-1">
                                  <input type="number" inputMode="decimal" step="0.1" value={exit} onChange={(e) => {
                                    const next = [...exitSw];
                                    next[i] = Number(e.target.value);
                                    setField('switched_exit_rr_sequence', next);
                                  }} onBlur={handleSortSwitchedMilestones} className="w-full bg-surface border border-border rounded-lg px-2.5 py-1 min-h-[32px] text-xs font-mono text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none pr-6" />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim/40">R</span>
                                </div>
                                <Tooltip content="Remove Switched Milestone">
                                  <button type="button" onClick={() => {
                                    const nextL = [...liveSw];
                                    const nextE = [...exitSw];
                                    nextL.splice(i, 1);
                                    nextE.splice(i, 1);
                                    setCfg(prev => ({ ...prev, switched_live_rr_sequence: nextL, switched_exit_rr_sequence: nextE }));
                                  }} aria-label="Remove Switched Milestone" className="p-1.5 text-dim hover:text-red transition-colors rounded-lg hover:bg-red/5"><Trash2 size={14} /></button>
                                </Tooltip>
                              </div>
                            ))}
                            <button type="button" onClick={() => {
                              const nextL = [...liveSw, 5.0];
                              const nextE = [...exitSw, 3.0];
                              const pairs = nextL.map((trigger, idx) => ({
                                trigger: Number(trigger || 0),
                                exit: Number(nextE[idx] || 0)
                              }));
                              pairs.sort((a, b) => a.trigger - b.trigger);
                              setCfg(prev => ({
                                ...prev,
                                switched_live_rr_sequence: pairs.map(p => p.trigger),
                                switched_exit_rr_sequence: pairs.map(p => p.exit)
                              }));
                            }} className="w-full py-2 border border-dashed border-border rounded-lg text-[10px] font-bold uppercase tracking-widest text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all mt-2 group flex items-center justify-center gap-2"><Plus size={13} className="group-hover:scale-110 transition-transform" /> Add Switched RR Milestone</button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </CollapsibleSection>
            ),

            risk_martingale: (
            <CollapsibleSection
              id="risk_martingale"
              icon={Zap}
              title="Martingale Recovery"
              subtitle="Exponential risk sizing after losses"
              isOpen={openSectionId === 'risk_martingale'}
              onToggle={() => setOpenSectionId(openSectionId === 'risk_martingale' ? null : 'risk_martingale')}
              {...getSectionErrorInfo('risk_martingale')}
            >
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4 p-3.5 bg-surface/40 border border-border/30 rounded-xl">
                  <CollapsibleHelpTitle
                    title="Enable Martingale"
                    icon={Zap}
                    titleClassName="text-[10px] font-black text-dim uppercase tracking-widest"
                    helpText="Increases position risk multiplier sequentially after each consecutive loss to accelerate recovery."
                  />
                  <Toggle value={cfg.martingale_enabled === true} onChange={(v) => setField('martingale_enabled', v)} />
                </div>

                {cfg.martingale_enabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-surface/20 border border-border/20 rounded-xl">
                    {renderField('Multiplier', 'martingale_multiplier', 'number', null, { helpText: 'e.g. 2.0 = double risk per loss', min: 1.0, max: 10.0, step: 0.1 })}
                    {renderField('Max Steps', 'martingale_max_steps', 'number', null, { helpText: 'Maximum consecutive loss multipliers', min: 1, max: 20, step: 1 })}
                    {renderField('Hard Reset Risk %', 'martingale_reset_threshold_pct', 'number', null, { helpText: 'Reset multiplier if new risk exceeds this %', min: 0.1, max: 100.0, step: 0.1 })}
                    {renderField('Post-Reset Behavior', 'martingale_post_reset_behavior', 'text', [
                        { value: 'wait', label: 'Wait for Win (No Multiplier)' },
                        { value: 'restart', label: 'Restart Sequence' }
                      ], { helpText: 'Action to take when capped' })}
                  </div>
                )}
              </div>
            </CollapsibleSection>
            ),

            risk_sl: (
            <CollapsibleSection
              id="risk_sl"
              icon={ShieldCheck}
              title="Stop Loss Strategy"
              subtitle="Risk truncation parameters"
              isOpen={openSectionId === 'risk_sl'}
              onToggle={() => setOpenSectionId(openSectionId === 'risk_sl' ? null : 'risk_sl')}
              {...getSectionErrorInfo('risk_sl')}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {renderField('Strategy Type', 'sl_type', 'text', [
                  { value: 'pct', label: 'Fixed Percentage' },
                  { value: 'lookback_low/high', label: 'High/Low Stop' },
                  { value: 'streak_extreme', label: 'Streak Extreme' },
                  { value: 'supertrend', label: 'Supertrend Line' }
                ])}
                {cfg.sl_type !== 'pct' ? renderField('Out of Bounds', 'sl_out_of_bounds_action', 'text', [
                  { value: 'clamp', label: 'Clamp to Limits' },
                  { value: 'reject', label: 'Reject Entry' }
                ]) : <div />}
                {cfg.sl_type !== 'pct' && (
                  <div className="md:col-span-2 flex items-start justify-between gap-3 p-3.5 bg-surface/40 border border-border/30 rounded-xl hover:border-accent/15 transition-all">
                    <CollapsibleHelpTitle
                      title="Reject Entry If SL Exceeds Max"
                      titleClassName="text-[10px] font-black text-dim uppercase tracking-widest"
                      helpText="Pre-filter scanner opportunities where calculated prospective SL exceeds sl_max_pct, rejecting wide high-risk moves to free up slots for better setups."
                    />
                    <Toggle
                      value={cfg.reject_entry_if_sl_exceeds_max !== false}
                      onChange={(v) => setField('reject_entry_if_sl_exceeds_max', v)}
                    />
                  </div>
                )}
                {cfg.sl_type === 'pct' ? (
                  renderField('Distance %', 'sl_distance_pct', 'number', null, { min: CONFIG_LIMITS.SL_DISTANCE_MIN, max: CONFIG_LIMITS.SL_DISTANCE_MAX, step: 0.1 })
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      {renderField('Lookback Period', 'sl_lookback_period', 'number', null, {
                        min: 0,
                        helpText: "Number of completed candles to look back for High/Low stop loss. Set to 0 to use the current (forming) candle's High/Low."
                      })}
                      {renderField('Lookback TF', 'sl_lookback_timeframe', 'text', ['1m', '5m', '15m', '1h', '4h', '1d'])}
                    </div>
                    <div className="flex items-start justify-between gap-3 p-3.5 bg-surface/40 border border-border/30 rounded-xl hover:border-accent/15 transition-all">
                      <CollapsibleHelpTitle
                        title="Include Forming Candle in SL Lookback"
                        titleClassName="text-[10px] font-black text-dim uppercase tracking-widest"
                        helpText="When enabled, incorporates the actively forming candle's wick into High/Low extremes. When disabled, uses completed candles only to avoid intrabar wick false breakouts."
                      />
                      <Toggle
                        value={Boolean(cfg.sl_include_forming_candle)}
                        onChange={(v) => setField('sl_include_forming_candle', v)}
                      />
                    </div>
                  </div>
                )}
                {cfg.sl_type !== 'pct' && (
                  <div className="grid grid-cols-2 gap-4">
                    {renderField('Floor Min %', 'sl_min_pct', 'number', null, {
                      min: 0.05,
                      step: 0.1,
                      helpText: "Minimum allowed structural SL distance (%). In Clamp mode, tighter stops widen to this floor; in Reject mode, tighter setups are skipped."
                    })}
                    {renderField('Ceiling Max %', 'sl_max_pct', 'number', null, {
                      min: 0.1,
                      step: 0.1,
                      helpText: "Maximum allowed structural SL distance (%). In Clamp mode, wider stops cap here; in Reject mode, wide setups are skipped."
                    })}
                  </div>
                )}
                <div className="md:col-span-2">
                  {renderField('Trailing Guard (%)', 'trailing_guard_buffer_pct', 'number', null, {
                    min: CONFIG_LIMITS.TRAILING_GUARD_MIN,
                    max: CONFIG_LIMITS.TRAILING_GUARD_MAX,
                    step: 0.01,
                    helpText: "Safety buffer that prevents trailing stops from being placed too close to the market price. Avoids immediate-trigger rejections during high volatility. Recommended: 0.03% to 0.05%."
                  })}
                </div>
              </div>

              <CollapsibleInfoCard title="Trailing Safety Guide" icon={ShieldCheck}>
                 <div className="flex flex-col gap-3">
                    <p className="text-[11px] text-dim leading-relaxed font-medium">
                       The <span className="text-text font-bold">Trailing Guard</span> prevents exchange rejections (Error -4120) by maintaining a mandatory gap between your Stop Loss and the active Market Price.
                    </p>
                    <div className="bg-background/40 p-3 rounded-xl border border-border/30 relative overflow-hidden group">
                       <div className="absolute top-0 left-0 w-1 h-full bg-accent/30" />
                       <div className="flex items-center gap-1.5 mb-2">
                          <Activity size={10} className="text-accent group-hover:animate-bounce" />
                          <span className="text-[9px] text-accent font-black uppercase tracking-widest">Dynamic Hard-Cap Example</span>
                       </div>
                       <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-1">
                             <div className="text-[8px] text-dim/40 font-bold uppercase tracking-tighter text-dim/60">Current Market</div>
                             <div className="text-xs font-mono font-bold text-text/90">0.14302</div>
                          </div>
                          <div className="flex flex-col gap-1 text-right">
                             <div className="text-[8px] text-dim/40 font-bold uppercase tracking-tighter text-dim/60">Engine Response</div>
                             <div className="text-xs font-mono font-bold text-amber">0.14305</div>
                          </div>
                       </div>
                    </div>
                    <p className="text-[10px] text-dim/60 italic leading-snug border-l-2 border-accent/20 pl-3">
                       Essential for SHORT trades near entry and high-volatility LONG trades. Prevents "instant fills" caused by the market spread touching your stop exactly at the moment of update.
                    </p>
                 </div>
              </CollapsibleInfoCard>
            </CollapsibleSection>
            ),

            risk_tp: (
            <CollapsibleSection
              id="risk_tp"
              icon={Target}
              title="Profit Realization"
              subtitle="Locking gains and scaling exits"
              isOpen={openSectionId === 'risk_tp'}
              onToggle={() => setOpenSectionId(openSectionId === 'risk_tp' ? null : 'risk_tp')}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {renderField('Exit Strategy', 'tp_mode', 'text', [
                  { value: 'fixed', label: 'Fixed Ratio (TP)' },
                  { value: 'exp_rr_seq', label: 'Dynamic RR Milestone' },
                  { value: 'exp_rr_seq_switch', label: 'Dynamic RR Milestone (Switch)' }
                ])}
                {cfg.tp_mode === 'fixed' ? renderField('Fixed Ratio (R)', 'tp_ratio', 'number', null, { min: 0.1, step: 0.1 }) : <div />}
              </div>

              <OptimizationPanel analytics={lifetimeAnalytics} cfg={cfg} setField={setField} type="rr" />

              <div className="mt-6 pt-5 border-t border-border/40 flex flex-col gap-5">
                 <div className="p-3.5 bg-background/50 rounded-2xl border border-border/50 flex flex-col gap-2 hover:border-accent/30 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0"><Activity size={16} /></div>
                        <span className="text-xs font-bold truncate">Dynamic Trailing Stop</span>
                        <InfoHelpButton
                          open={!!expandedHelpMap.risk_dynamic_trailing}
                          onToggle={() => toggleHelpKey('risk_dynamic_trailing')}
                          label="Dynamic Trailing Stop"
                        />
                      </div>
                      <Toggle value={cfg.trailing_stop_enabled === true} onChange={(v) => setField('trailing_stop_enabled', v)} />
                    </div>
                    {expandedHelpMap.risk_dynamic_trailing && (
                      <InfoDropdownBox>Active price chasing to protect unrealized PnL once activation R:R is reached.</InfoDropdownBox>
                    )}
                 </div>

                 {cfg.trailing_stop_enabled && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
                       <div className="mb-2">
                          {renderField("Trailing Execution Mode", "trailing_execution_mode", "text", [{ value: "local", label: "Local" }, { value: "exchange", label: "Exchange" }, { value: "native", label: "Native" }])}
                       </div>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {renderField('Trailing Method', 'trailing_stop_type', 'text', [
                            { value: 'pct', label: 'Percentage Distance (%)' },
                            { value: 'rr', label: 'Risk Multiple (R:R)' }
                          ])}
                          {renderField('Trailing Activation R:R', 'trailing_activation_rr', 'number', null, {
                            min: 0,
                            max: 10,
                            step: 0.1,
                            helpText: 'Required R:R before trailing stop activates (0 = immediate)'
                          })}
                       </div>

                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {cfg.trailing_stop_type === 'rr' ? (
                            renderField('Trailing Distance (R:R)', 'trailing_stop_rr', 'number', null, {
                              min: 0.1,
                              max: 10,
                              step: 0.1,
                              helpText: 'Distance expressed as a multiple of initial SL risk distance (e.g. 1.0R = initial risk width)'
                            })
                          ) : (
                            renderField('Trailing Distance (%)', 'trailing_stop_distance_pct', 'number', null, {
                              min: 0.1,
                              max: 10,
                              step: 0.1,
                              helpText: 'Distance expressed as percentage of price'
                            })
                          )}
                       </div>
                       <OptimizationPanel analytics={lifetimeAnalytics} cfg={cfg} setField={setField} type="trailing" />
                    </motion.div>
                 )}
              </div>
            </CollapsibleSection>
            ),

            risk_temporal: (
            <CollapsibleSection
              id="risk_temporal"
              icon={Clock}
              title="Frequency & Temporal Risk"
              subtitle="Execution windows & frequency shaping"
              isOpen={openSectionId === 'risk_temporal'}
              onToggle={() => setOpenSectionId(openSectionId === 'risk_temporal' ? null : 'risk_temporal')}
            >

              <div className="flex flex-col gap-4 mb-6">
                <div className="p-3.5 bg-background/50 rounded-2xl border border-border/50 flex flex-col gap-2 hover:border-accent/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0"><Activity size={16} /></div>
                      <span className="text-xs font-bold truncate">Frequency Shaping</span>
                      <InfoHelpButton
                        open={!!expandedHelpMap.risk_freq_shaping}
                        onToggle={() => toggleHelpKey('risk_freq_shaping')}
                        label="Frequency Shaping"
                      />
                    </div>
                    <Toggle value={cfg.frequency_shaping_enabled === true} onChange={(v) => setField('frequency_shaping_enabled', v)} />
                  </div>
                  {expandedHelpMap.risk_freq_shaping && (
                    <InfoDropdownBox>Control trade distribution, minimum entry intervals, and rolling window caps.</InfoDropdownBox>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 p-4 bg-surface/30 rounded-2xl border border-border/40">
                  {renderField('Period Limit', 'max_trades_per_period', 'number', null, { min: 0 })}
                  {renderField('Period (min)', 'trades_period_min', 'number', null, { min: 1 })}
                  {renderField('Max 24h', 'max_trades_24h', 'number', null, { min: 0 })}
                </div>

                {cfg.frequency_shaping_enabled && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 p-4 bg-surface/30 rounded-2xl border border-border/40">
                    <div className="grid grid-cols-2 md:grid-cols-2 gap-6">
                      {renderField('Min Interval (m)', 'min_trade_interval_min', 'number', null, { min: 0 })}
                      {renderField('Window Jitter (%)', 'trades_jitter_pct', 'number', null, { min: 0, max: 100 })}
                    </div>
                    <div className={cn("flex items-start justify-between gap-3 pt-3 border-t border-border/40 transition-opacity duration-300", cfg.trades_jitter_pct <= 0 && "opacity-40 pointer-events-none")}>
                      <CollapsibleHelpTitle
                        title="Market-Aware Jitter"
                        icon={Target}
                        titleClassName="text-[10px] font-black uppercase tracking-widest"
                        helpText="Prioritize high-quality signals with less random delay when window jitter is active."
                      />
                      <Toggle value={cfg.trades_jitter_market_aware === true} onChange={(v) => setField('trades_jitter_market_aware', v)} color="bg-accent" />
                    </div>
                  </motion.div>
                )}

                <div className="p-3.5 bg-background/50 rounded-2xl border border-border/50 flex flex-col gap-2 hover:border-accent/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0"><LayoutGrid size={16} /></div>
                      <span className="text-xs font-bold truncate">Time-of-Day Guard</span>
                      <InfoHelpButton
                        open={!!expandedHelpMap.risk_tod_guard}
                        onToggle={() => toggleHelpKey('risk_tod_guard')}
                        label="Time-of-Day Guard"
                      />
                    </div>
                    <Toggle value={cfg.risk_use_tod_stats === true} onChange={(v) => setField('risk_use_tod_stats', v)} />
                  </div>
                  {expandedHelpMap.risk_tod_guard && (
                    <InfoDropdownBox>Adaptive risk management based on historical hour-of-day winrate statistics.</InfoDropdownBox>
                  )}
                </div>

                {cfg.risk_use_tod_stats && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-surface/30 rounded-2xl border border-border/40 flex flex-col gap-4">
                    {renderField('Minimum Required TOD Winrate %', 'tod_min_winrate', 'number', null, { min: 0, max: 100 })}

                    {cfg.frequency_shaping_enabled && (
                      <div className="flex items-start justify-between gap-3 pt-3 border-t border-border/40">
                        <CollapsibleHelpTitle
                          title="Integrated Frequency Guard"
                          titleClassName="text-xs font-bold"
                          helpText="Adaptive trade spacing when historical winrate for the current hour is low."
                        />
                        <Toggle value={cfg.frequency_tod_integration === true} onChange={(v) => setField('frequency_tod_integration', v)} color="bg-amber" />
                      </div>
                    )}
                  </motion.div>
                )}

                <div className="grid grid-cols-2 gap-6 pt-2">
                  {renderField('Max Per Sym', 'max_open_trades_per_symbol', 'number', null, { min: 1 })}
                </div>
              </div>

              {/* Clean Daily Execution Windows Scheduler (UTC) */}
              {(() => {
                const safeWindows = Array.isArray(cfg.trading_windows) ? cfg.trading_windows : [];
                const parseToMin = (t) => {
                  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
                  if (!m) return null;
                  return Math.min(1440, Math.max(0, parseInt(m[1], 10) * 60 + parseInt(m[2], 10)));
                };
                const segments = [];
                safeWindows.forEach((w) => {
                  const s = parseToMin(w?.start);
                  const e = parseToMin(w?.end);
                  if (s === null || e === null || s === e) return;
                  if (e > s) {
                    segments.push({ left: (s / 1440) * 100, width: ((e - s) / 1440) * 100 });
                  } else {
                    // Overnight wrap-around window (e.g. 20:00 -> 04:00 UTC)
                    segments.push({ left: (s / 1440) * 100, width: ((1440 - s) / 1440) * 100 });
                    segments.push({ left: 0, width: (e / 1440) * 100 });
                  }
                });

                const SESSION_PRESETS = [
                  { label: 'Asia', start: '00:00', end: '08:00' },
                  { label: 'London', start: '07:00', end: '16:00' },
                  { label: 'New York', start: '13:30', end: '20:00' },
                  { label: 'US Overnight', start: '20:00', end: '04:00' },
                ];

                return (
                  <div className="flex flex-col gap-3 pt-3 border-t border-border/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Clock size={13} className="text-accent" />
                        <span className="text-xs font-semibold text-text">Daily Execution Windows (UTC)</span>
                        <span className="text-[11px] font-mono text-muted">
                          {safeWindows.length === 0 ? '24/7 Active' : `${safeWindows.length} window${safeWindows.length === 1 ? '' : 's'}`}
                        </span>
                      </div>

                      {/* 1-Click Session Presets */}
                      <div className="flex flex-wrap items-center gap-1">
                        {SESSION_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              const exists = safeWindows.some((w) => w?.start === preset.start && w?.end === preset.end);
                              if (!exists) {
                                setField('trading_windows', [...safeWindows, { start: preset.start, end: preset.end }]);
                              }
                            }}
                            className="px-2 py-0.5 rounded-md border border-border/60 bg-background/50 text-[11px] font-medium text-muted hover:text-text hover:border-accent/40 transition-colors cursor-pointer"
                            title={`Add ${preset.label} session (${preset.start}–${preset.end} UTC)`}
                          >
                            + {preset.label}
                          </button>
                        ))}
                        {safeWindows.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setField('trading_windows', [])}
                            className="px-2 py-0.5 rounded-md border border-border/60 bg-background/50 text-[11px] font-medium text-muted hover:text-red hover:border-red/35 transition-colors cursor-pointer"
                          >
                            24/7 Clear
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Visual 24-Hour UTC Timeline */}
                    <div className="space-y-1">
                      <div className="relative h-2.5 w-full rounded-full bg-background/80 border border-border/60 overflow-hidden">
                        {safeWindows.length === 0 ? (
                          <div className="h-full w-full bg-green/35" />
                        ) : (
                          segments.map((seg, idx) => (
                            <div
                              key={idx}
                              className="absolute top-0 bottom-0 bg-accent/70"
                              style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                            />
                          ))
                        )}
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-muted/70 tabular-nums px-0.5">
                        <span>00:00</span>
                        <span>06:00</span>
                        <span>12:00</span>
                        <span>18:00</span>
                        <span>24:00 UTC</span>
                      </div>
                    </div>

                    {/* Window Rows */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {safeWindows.map((w, i) => {
                        const s = parseToMin(w?.start);
                        const e = parseToMin(w?.end);
                        let durLabel = '';
                        if (s !== null && e !== null) {
                          const mins = e >= s ? (e - s) : (1440 - s + e);
                          const hrs = Math.floor(mins / 60);
                          const rem = mins % 60;
                          durLabel = rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
                        }
                        return (
                          <div key={i} className="flex items-center gap-2 px-2.5 py-2 bg-background/50 border border-border/70 rounded-lg">
                            <input
                              type="time"
                              value={w?.start || ''}
                              aria-label={`Window ${i + 1} start UTC`}
                              onChange={(e) => {
                                const wins = [...safeWindows];
                                wins[i] = { ...wins[i], start: e.target.value };
                                setField('trading_windows', wins);
                              }}
                              className="flex-1 min-w-0 bg-surface border border-border/70 rounded-md px-2 py-1 text-xs font-mono text-center text-text focus:border-accent focus-visible:outline-none tabular-nums"
                            />
                            <span className="text-muted text-xs shrink-0">→</span>
                            <input
                              type="time"
                              value={w?.end || ''}
                              aria-label={`Window ${i + 1} end UTC`}
                              onChange={(e) => {
                                const wins = [...safeWindows];
                                wins[i] = { ...wins[i], end: e.target.value };
                                setField('trading_windows', wins);
                              }}
                              className="flex-1 min-w-0 bg-surface border border-border/70 rounded-md px-2 py-1 text-xs font-mono text-center text-text focus:border-accent focus-visible:outline-none tabular-nums"
                            />
                            {durLabel && (
                              <span className="text-[10px] font-mono text-muted shrink-0 tabular-nums">{durLabel}</span>
                            )}
                            <Tooltip content="Remove Window">
                              <button
                                type="button"
                                onClick={() => setField('trading_windows', safeWindows.filter((_, idx) => idx !== i))}
                                aria-label="Remove Window"
                                className="p-1 text-muted hover:text-red transition-colors cursor-pointer shrink-0"
                              >
                                <Trash2 size={13} />
                              </button>
                            </Tooltip>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setField('trading_windows', [...safeWindows, { start: '09:00', end: '17:00' }])}
                        className="w-full py-2 border border-dashed border-border/70 rounded-lg text-xs font-medium text-muted hover:text-accent hover:border-accent/45 hover:bg-accent/5 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Plus size={13} /> Add Custom Window
                      </button>
                    </div>
                  </div>
                );
              })()}
            </CollapsibleSection>
            ),
            })}
          </div>
        )}

        {section === 'env' && (
          <div
            id="config-panel-env"
            role="tabpanel"
            aria-labelledby="config-tab-env"
            className="flex flex-col gap-4 lg:gap-6 animate-in fade-in duration-300"
          >
            {orderSectionEntries('env', {
            adv_env: (
            <CollapsibleSection
              id="adv_env"
              icon={Briefcase}
              title="Execution Environment"
              subtitle="Paper: Simulated · Testnet: Demo API · Live: Real Capital · Backtest: Historical Test"
              isOpen={openSectionId === 'adv_env'}
              onToggle={() => setOpenSectionId(openSectionId === 'adv_env' ? null : 'adv_env')}
              {...getSectionErrorInfo('adv_env')}
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {['paper', 'testnet', 'live', 'backtest'].map(m => (
                  <EnvironmentButton
                    key={m}
                    mode={m}
                    isSelected={cfg.trading_mode === m || (m === 'paper' && cfg.paper_mode && !cfg.trading_mode)}
                    onClick={handleModeSelect}
                    disabled={isEdit && m !== cfg.trading_mode}
                  />
                ))}
              </div>
              {isEdit && (
                <div className="mt-3 p-2.5 bg-accent/10 border border-accent/20 rounded-lg flex flex-col gap-1.5 text-xs text-text-muted">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Lock size={13} className="text-accent shrink-0" />
                      <span className="font-bold text-text-primary truncate">
                        Execution Mode Fixed ({cfg.trading_mode ? cfg.trading_mode.toUpperCase() : 'PAPER'})
                      </span>
                    </div>
                    <InfoHelpButton
                      open={!!expandedHelpMap.env_mode_fixed}
                      onToggle={() => toggleHelpKey('env_mode_fixed')}
                      label="Execution Mode Fixed"
                    />
                  </div>
                  {expandedHelpMap.env_mode_fixed && (
                    <InfoDropdownBox>
                      Trading mode ({cfg.trading_mode ? cfg.trading_mode.toUpperCase() : 'PAPER'}) is fixed while this session is running. Strategy parameters hot-reload dynamically on save.
                    </InfoDropdownBox>
                  )}
                </div>
              )}
              {modeWarning && (
                <div className="mt-4 p-3 bg-orange/10 border border-orange/30 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-in slide-in-from-top">
                  <div className="flex items-start gap-2.5">
                    <XCircle size={16} className="text-orange mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-orange">{modeWarning}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { onClose?.(); window.location.hash = '#/settings'; }}
                    className="px-3 py-1.5 rounded-lg bg-orange/15 hover:bg-orange/25 border border-orange/30 text-[11px] font-bold text-orange whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    Open Settings →
                  </button>
                </div>
              )}
            </CollapsibleSection>
            ),

            adv_capital: (
            <CollapsibleSection
              id="adv_capital"
              icon={TrendingUp}
              title="Initial Capital"
              subtitle="Starting balance for sessions"
              isOpen={openSectionId === 'adv_capital'}
              onToggle={() => setOpenSectionId(openSectionId === 'adv_capital' ? null : 'adv_capital')}
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {renderField('Paper Balance ($)', 'paper_starting_balance', 'number', null, { min: 0 })}
                {renderField('Demo Balance ($)', 'testnet_starting_balance', 'number', null, { min: 0, placeholder: '10000' })}
                {renderField('Live Balance ($)', 'live_starting_balance', 'number', null, { min: 0 })}
              </div>
            </CollapsibleSection>
            ),
            })}
          </div>
        )}

        {section === 'smart' && (
          <SmartAutoDiscoveryPanel
            cfg={cfg}
            buildConfigToSave={buildConfigToSave}
            onLoadRecommendation={(recommendedConfig) => {
              hasUserLocalOverrideRef.current = true;
              suppressDraftSaveRef.current = false;
              const flattened = flattenConfig(recommendedConfig);
              setCfg(flattened);
              setIsDirty(true);
              setHasPendingSessionChanges(true);
              validate(flattened);
              if (!isEdit) persistDraft(flattened, loadedPresetName);
              addAlert({
                level: 'success',
                title: 'Recommendation Applied',
                message: `Applied smart strategy "${recommendedConfig.strategy_label || 'Recommended'}" settings to active draft.`,
              });
            }}
            savePreset={savePreset}
            onOpenSaveAsNew={handleOpenSaveAsNew}
          />
        )}

        {section === 'backtest' && (
          <BacktestWorkbenchPanel
            cfg={cfg}
            setField={setField}
            buildConfigToSave={buildConfigToSave}
            onSave={onSave}
            onOpenSaveAsNew={handleOpenSaveAsNew}
          />
        )}

        {section === 'presets' && (
          <div id="config-panel-presets"
            role="tabpanel"
            aria-labelledby="config-tab-presets"
            className="flex flex-col gap-0 animate-in fade-in duration-200 -mx-2.5 sm:-mx-4 -mt-1.5 sm:-mt-2.5"
          >
            {/* Sticky Presets Toolbar + Inline Filter Nav */}
            <div className="sticky top-0 z-20 bg-surface/95 backdrop-blur-md flex flex-col gap-2 px-3 sm:px-4 pt-2.5 pb-2 border-b border-border/40">
               <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <div className="relative flex-1 min-w-0">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                      <input
                         ref={presetSearchInputRef}
                         type="text"
                         placeholder="Search presets by name or mode... (/)"
                         value={presetSearch}
                         onChange={(e) => setPresetSearch(e.target.value)}
                         className="w-full bg-background/70 border border-border/70 hover:border-border rounded-lg h-8 pl-8 pr-7 text-xs font-medium text-text placeholder:text-dim/60 focus:border-accent focus:bg-background focus:outline-none transition-all"
                      />
                      {presetSearch && (
                         <button
                            type="button"
                            onClick={() => setPresetSearch('')}
                            aria-label="Clear search"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-dim hover:text-text rounded-md transition-colors"
                         >
                            <X size={11} />
                         </button>
                      )}
                    </div>
                    <button
                       type="button"
                       onClick={() => handleOpenSaveAsNew(null)}
                       className="h-8 px-3 rounded-lg bg-accent hover:bg-accent/90 text-white text-[11px] font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 shrink-0"
                    >
                       <Plus size={12} />
                       <span className="hidden sm:inline">Save as Preset</span>
                       <span className="sm:hidden">Save</span>
                    </button>
                    <button
                       type="button"
                       onClick={() => setOpenSectionId(openSectionId === 'presets_tools' ? null : 'presets_tools')}
                       className={cn(
                          "h-8 px-2.5 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer shrink-0",
                          openSectionId === 'presets_tools'
                             ? "bg-accent/10 border-accent/40 text-accent"
                             : "border-border/70 text-dim hover:text-text hover:bg-background/60"
                       )}
                    >
                       Tools
                    </button>
                  </div>

                  {/* Single-Row Filter Strip (merges onto same row on sm+ desktop to maximize vertical preset space) */}
                  <div className="flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                    <div className="flex items-center gap-1">
                      {[
                         { id: 'all', label: 'All', count: Array.isArray(presets) ? presets.length : 0 },
                         { id: 'live', label: 'Live' },
                         { id: 'testnet', label: 'Testnet' },
                         { id: 'paper', label: 'Paper' },
                         { id: 'variants', label: 'Variants', count: activeVariants.length, isVariantTab: true }
                      ].map(f => (
                         <button
                            key={f.id}
                            type="button"
                            onClick={() => setPresetTabFilter(f.id)}
                            className={cn(
                               "h-7 px-2.5 text-[11px] font-bold rounded-md transition-all whitespace-nowrap flex items-center gap-1 shrink-0 cursor-pointer",
                               presetTabFilter === f.id
                                  ? f.isVariantTab
                                     ? "bg-violet-500/20 text-violet-300 border border-violet-500/40"
                                     : "bg-accent/15 text-accent border border-accent/30"
                                  : "text-dim hover:text-text hover:bg-surface/50 border border-transparent"
                            )}
                         >
                            <span>{f.label}</span>
                            {f.count !== undefined && (
                               <span className={cn(
                                  "text-[9px] px-1 rounded font-bold leading-tight",
                                  presetTabFilter === f.id
                                     ? (f.isVariantTab ? "bg-violet-500/40 text-violet-100" : "bg-accent/30 text-white")
                                     : "bg-background/60 border border-border/40 text-dim"
                               )}>
                                  {f.count}
                               </span>
                            )}
                         </button>
                      ))}
                    </div>
                  </div>
               </div>

               {/* Tools expansion */}
               <AnimatePresence>
                  {openSectionId === 'presets_tools' && (
                     <motion.div
                       initial={{ opacity: 0, height: 0 }}
                       animate={{ opacity: 1, height: 'auto' }}
                       exit={{ opacity: 0, height: 0 }}
                       className="overflow-hidden"
                     >
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 py-1.5">
                          <Btn variant="ghost" onClick={handleCopyActiveToClipboard} className="h-8 border border-border hover:border-accent text-[11px] font-bold"><Copy size={11} className="mr-1"/> Copy active</Btn>
                          <Btn variant="ghost" onClick={handlePasteActiveFromClipboard} className="h-8 border border-border hover:border-accent text-[11px] font-bold"><ClipboardPaste size={11} className="mr-1"/> Paste active</Btn>
                          <Btn variant="ghost" onClick={handleExportToFile} className="h-8 border border-border hover:border-accent text-[11px] font-bold"><Download size={11} className="mr-1"/> Export JSON</Btn>
                          <label className="relative flex items-center justify-center border border-border hover:border-accent rounded-lg text-[11px] font-bold cursor-pointer text-text hover:text-accent transition-colors h-8">
                            <input type="file" accept=".json" onChange={handleFileImport} className="absolute inset-0 opacity-0 cursor-pointer" />
                            <Upload size={11} className="mr-1"/> Import File
                          </label>
                        </div>
                     </motion.div>
                  )}
               </AnimatePresence>
            </div>

            {/* Presets List */}
            <div className="flex flex-col">
               {filteredPresets.length === 0 ? (
                  <div className="py-6 px-4 text-center text-dim text-xs flex flex-col items-center gap-1.5">
                     <p>No presets found matching your filter or search.</p>
                     {presetSearch && (
                        <button
                           type="button"
                           onClick={() => setPresetSearch('')}
                           className="text-accent text-xs font-bold underline"
                        >
                           Clear search query
                        </button>
                     )}
                  </div>
               ) : (
                  filteredPresets.map(p => {
                     const variantIndex = activeVariants.findIndex(v => v?.strategy_label === p.name);
                     const isVariant = variantIndex !== -1;
                     const isEditingVariant = editingVariantIdx === variantIndex && isVariant;
                     const isLoaded = (activeBasePresetName === p.name) && !isVariant;
                     return (
                        <PresetItem
                           key={p.name}
                           preset={p}
                           variantIndex={variantIndex}
                           isLoaded={isLoaded}
                           isDirty={isDirty}
                           onLoad={loadPreset}
                           onToggleVariant={toggleVariant}
                           onDelete={(e, name) => { e.stopPropagation(); setPresetToDelete(name); }}
                           isVariant={isVariant}
                           isEditingVariant={isEditingVariant}
                           onEditVariant={() => startEditingVariant(p, variantIndex)}
                           onPromoteVariant={() => promoteVariantToBaseByIndex(variantIndex)}
                           sessionActive={sessionActive}
                           isSelected={selectedPresetNames.has(p.name)}
                           onToggleSelect={toggleSelectPreset}
                           currentCfg={cfg}
                           onSave={(name) => savePreset(name)}
                           onSaveAsNew={() => handleOpenSaveAsNew(p)}
                           onRevert={() => {
                              const original = (Array.isArray(presets) ? presets : []).find(x => x.name === loadedPresetName);
                              if (original) loadPreset(original);
                           }}
                           onDuplicate={() => duplicatePreset(p)}
                        />
                     );
                  })
               )}
            </div>

            {/* In-flow Variants & Batch Summary Bar — Docked in content, never overlaps sticky modal footer */}
            {(!isInputFocused || selectedPresetNames.size > 0) && (
            <div className="mt-2.5 px-3 sm:px-4 pb-2">
               {selectedPresetNames.size > 0 ? (
                  <div className="p-2.5 rounded-xl bg-surface border border-accent/40 shadow-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                           <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                           <span className="text-xs font-bold text-text">
                              {selectedPresetNames.size} preset{selectedPresetNames.size === 1 ? '' : 's'} selected
                           </span>
                        </div>
                        <button
                           type="button"
                           onClick={() => setSelectedPresetNames(new Set())}
                           className="text-xs font-semibold text-dim hover:text-text sm:hidden px-2 py-0.5"
                        >
                           Clear
                        </button>
                     </div>
                     <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                           type="button"
                           onClick={() => setSelectedPresetNames(new Set())}
                           className="text-xs font-semibold text-dim hover:text-text hidden sm:inline-block px-2 py-1"
                        >
                           Clear
                        </button>
                        <Btn
                           variant="primary"
                           onClick={() => {
                              const currentBaseLabel = (editingVariantIdx !== null && baseConfigBackup)
                                ? (baseConfigBackup.strategy_label || loadedPresetName)
                                : (loadedPresetName || cfg.strategy_label);
                              let addedCount = 0;
                              updateVariantsList(existing => {
                                const newVariants = [...existing];
                                Array.from(selectedPresetNames).forEach(name => {
                                   if (name !== currentBaseLabel && !newVariants.some(v => v?.strategy_label === name)) {
                                      const p = (Array.isArray(presets) ? presets : []).find(x => x.name === name);
                                      if (p && newVariants.length < CONFIG_LIMITS.MAX_VARIANTS) {
                                         newVariants.push(coerceAndSanitizeConfig({ ...p.config, strategy_label: p.name }, true));
                                         addedCount++;
                                      }
                                   }
                                });
                                return newVariants;
                              });
                              setSelectedPresetNames(new Set());
                              if (addedCount > 0) {
                                addAlert({ level: 'success', title: 'Variants Updated', message: `Added ${addedCount} preset${addedCount === 1 ? '' : 's'} to active variants.` });
                              }
                           }}
                           className="flex-1 sm:flex-none h-8 px-3 bg-accent hover:bg-accent/90 text-white text-[11px] font-bold"
                        >
                           Set as variants
                        </Btn>
                        <Btn
                           variant="ghost"
                           onClick={handleExportSelectedPresets}
                           className="h-8 px-3 border border-border/70 hover:border-accent/40 text-text text-[11px] font-bold"
                        >
                           Export
                        </Btn>
                        <Btn
                           variant="ghost"
                           onClick={handleDeleteSelectedPresets}
                           disabled={sessionActive}
                           className={cn("h-8 px-3 text-[11px] font-bold", sessionActive ? "text-red/40 cursor-not-allowed" : "text-red hover:bg-red/10")}
                        >
                           {sessionActive ? "Delete (locked)" : "Delete"}
                        </Btn>
                     </div>
                  </div>
               ) : (
                  <div className="px-3 py-2 rounded-lg bg-background/50 border border-border/50 flex items-center justify-between gap-2 text-[11px] text-dim flex-wrap">
                     <div className="flex items-center gap-1.5 flex-wrap">
                        <Layers size={12} className="text-violet-400 shrink-0" />
                        <span className="font-medium text-text/80">
                           Variants: <strong className="text-violet-400 font-bold">{activeVariants.length}</strong>/{CONFIG_LIMITS.MAX_VARIANTS}
                        </span>
                        <span className="text-dim/40">·</span>
                        <span className="text-dim">
                           Combined: <strong className="text-text font-bold">{(activeVariants.reduce((acc, v) => acc + (Number(v?.risk_pct_per_trade) || 0), 0)).toFixed(1)}%</strong>/{cfg.max_total_risk_pct || CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT}%
                        </span>
                     </div>
                     {activeVariants.length > 0 && (
                        <button
                           type="button"
                           onClick={clearAllVariants}
                           className="text-[11px] font-bold text-red hover:text-red-400 transition-colors cursor-pointer"
                        >
                           Clear variants
                        </button>
                     )}
                  </div>
               )}
            </div>
            )}
          </div>
        )}
      </div>

      <div className="p-1.5 sm:p-2 border-t border-border bg-surface/95 backdrop-blur-md flex flex-col gap-1.5 sticky bottom-0 shrink-0 z-30">
        {/* Mobile Keyboard Accessory Bar: Prev / Next field stepper + Done dismissal while typing */}
        {isInputFocused && (
          <div className="flex sm:hidden items-center justify-between gap-2 pb-1 border-b border-border/40">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); stepFocusedField(-1); }}
                className="h-7 px-2.5 rounded-lg bg-background border border-border text-xs font-semibold text-text/90 active:scale-95 transition-transform cursor-pointer"
              >
                ↑ Prev
              </button>
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); stepFocusedField(1); }}
                className="h-7 px-2.5 rounded-lg bg-background border border-border text-xs font-semibold text-text/90 active:scale-95 transition-transform cursor-pointer"
              >
                ↓ Next
              </button>
            </div>
            <button
              type="button"
              onPointerDown={(e) => { e.preventDefault(); dismissMobileKeyboard(); }}
              className="h-7 px-3 rounded-lg bg-accent/15 border border-accent/35 text-xs font-bold text-accent active:scale-95 transition-transform cursor-pointer"
            >
              Done
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className={cn("items-center gap-1.5 shrink-0", isInputFocused ? "hidden sm:flex" : "flex")}>
             <Btn variant="ghost" onClick={onClose} className="h-9 px-2.5 sm:px-3 text-xs shrink-0">Cancel</Btn>
             {(isDirty || hasPendingSessionChanges) && <Btn variant="ghost" onClick={resetToLastSaved} className="text-red hover:bg-red/5 h-9 px-2.5 sm:px-3 text-xs shrink-0">Reset</Btn>}
             <Tooltip content="Copy Configuration to Clipboard">
               <CopyButton
                  getValue={() => JSON.stringify(buildConfigToSave(), null, 2)}
                  className="w-9 h-9 flex items-center justify-center border border-border rounded-lg hover:bg-white/5 transition-all shrink-0"
               />
             </Tooltip>
             <Tooltip content="Paste Configuration from Clipboard">
                <Btn
                  variant="ghost"
                  onClick={handlePasteConfig}
                  aria-label="Paste Configuration from Clipboard"
                  className="w-9 h-9 p-0 flex items-center justify-center border border-border rounded-lg hover:bg-accent/5 hover:border-accent/40 transition-all shrink-0"
                >
                  <ClipboardPaste size={14} className="text-dim group-hover:text-accent" />
                </Btn>
             </Tooltip>
          </div>
          <Btn
            variant="primary"
            loading={loading}
            disabled={loading || (!isEdit && apiStatus?.isBanned)}
            onPointerDown={() => {
              if (document.activeElement instanceof HTMLElement && modalRef.current?.contains(document.activeElement)) {
                document.activeElement.blur();
              }
            }}
            onClick={async () => {
              if (!isEdit && apiStatus?.isBanned) {
                addAlert?.({ level: 'error', title: 'Action Blocked', message: 'Cannot start session while API ban / geo-restriction is active.' });
                return;
              }
              const errs = getValidationErrors(cfg);
              const blockingKeys = Object.keys(errs).filter(k => !k.endsWith('_warn'));
              if (blockingKeys.length === 0) {
                 const payload = { ...buildConfigToSave(), _presetLoaded: presetLoaded, _isMergedRootConfig: true };
                 const saved = await onSave(payload);
                 if (saved === false) return;
                 if (payload.strategy_label) recordRecentlyUsed(payload.strategy_label);
                 if (Array.isArray(payload.strategy_variants)) {
                   payload.strategy_variants.forEach(v => {
                     if (v?.strategy_label) recordRecentlyUsed(v.strategy_label);
                   });
                 }
                 suppressDraftSaveRef.current = true;
                 if (typeof sessionStorage !== 'undefined') {
                   sessionStorage.removeItem('config_draft');
                 }
                 hasUserLocalOverrideRef.current = false;
                 setHasPendingSessionChanges(false);
                 setIsDirty(false);
              } else {
                 const firstKey = blockingKeys[0];
                 const targetTab = TAB_ERROR_MAP[firstKey];
                 const targetSection = SECTION_ERROR_MAP[firstKey];
                 const failingSections = Array.from(new Set(blockingKeys.map(k => SECTION_LABELS[SECTION_ERROR_MAP[k]]).filter(Boolean)));
                 if (targetTab && section !== 'summary') {
                   handleSectionChange(targetTab, targetSection || null);
                 } else if (targetSection && section === targetTab) {
                   recordRecentSection(targetSection);
                   setOpenSectionId(targetSection);
                   refreshSectionOrders([targetSection, ...recentSectionIdsRef.current.filter(id => id !== targetSection)].slice(0, 24), errs, targetSection);
                 } else if (section === 'summary') {
                   const el = document.getElementById(targetTab === 'env' ? 'summary_env' : targetTab === 'scan' ? 'summary_scan' : 'summary_risk');
                   el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
                 }
                 addAlert?.({
                   level: 'error',
                   title: 'Configuration Validation Failed',
                   message: failingSections.length > 0
                     ? `Fix errors in: ${failingSections.join(', ')}`
                     : `Please resolve ${blockingKeys.length} validation error(s) before saving.`
                 });
              }
            }}
            className={cn(
              "flex-1 h-9 py-1.5 px-3 sm:px-4 flex items-center justify-center gap-1.5 text-xs font-bold whitespace-nowrap",
              !isEdit && apiStatus?.isBanned && "opacity-50 cursor-not-allowed"
            )}
          >
            {!isEdit && apiStatus?.isBanned ? 'Disabled (API Ban)' : (isEdit ? 'Apply Changes' : 'Start Session')}
            {(isDirty || hasPendingSessionChanges) && <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse" />}
          </Btn>
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!presetToDelete}
        onClose={() => setPresetToDelete(null)}
        onConfirm={() => deletePreset(presetToDelete)}
        title="Delete Strategy Preset?"
        message={`Are you sure you want to permanently remove "${presetToDelete}"? This will delete the configuration from the database and cannot be undone.`}
        confirmText="Delete Preset"
        variant="danger"
        loading={isDeleting}
      />

      <SavePresetModal
        isOpen={saveModalState.isOpen}
        onClose={() => setSaveModalState(prev => ({ ...prev, isOpen: false }))}
        onSave={handleConfirmSaveAsNew}
        defaultName={saveModalState.defaultName}
        configSummary={saveModalState.configSummary}
        targetConfig={saveModalState.targetConfig || cfg}
      />

      <AnimatePresence>
        {showPasteOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[120] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-lg bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden p-5 flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent shrink-0">
                      <ClipboardPaste size={16} />
                    </div>
                    <h3 className="text-sm font-black uppercase tracking-tight truncate">Paste Configuration</h3>
                    <InfoHelpButton
                      open={!!expandedHelpMap.paste_overlay_help}
                      onToggle={() => toggleHelpKey('paste_overlay_help')}
                      label="Paste Configuration"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowPasteOverlay(false); setPasteValue(''); setPasteError(null); }}
                    className="p-1 hover:bg-white/5 rounded-full transition-colors shrink-0"
                  >
                    <X size={16} className="text-dim" />
                  </button>
                </div>
                {expandedHelpMap.paste_overlay_help && (
                  <InfoDropdownBox>Direct clipboard fallback editor: paste strategy configuration JSON below to parse, validate, and apply to active fields.</InfoDropdownBox>
                )}
              </div>

              <div className="flex flex-col gap-2 text-left">
                <div className="relative">
                  <textarea
                    value={pasteValue}
                    onChange={(e) => handlePasteAreaChange(e.target.value)}
                    placeholder='{ "strategy_label": "Scalp Momentum", ... }'
                    className={cn(
                      "w-full h-48 bg-background border rounded-xl p-2.5 text-xs font-mono focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all resize-none",
                      pasteError ? "border-red/40 focus:border-red focus-visible:ring-red" : pasteValue.trim() ? "border-green/40 focus:border-green focus-visible:ring-green" : "border-border focus:border-accent focus-visible:ring-accent"
                    )}
                    autoFocus
                  />
                </div>
                <div className="flex items-center justify-between min-h-[20px]">
                  {pasteError ? (
                    <span className="text-[10px] text-red font-bold flex items-center gap-1 uppercase">
                      <AlertTriangle size={12} /> {pasteError}
                    </span>
                  ) : pasteValue.trim() ? (
                    <span className="text-[10px] text-green font-bold flex items-center gap-1 uppercase">
                      <CheckCircle2 size={12} /> Valid JSON Configuration
                    </span>
                  ) : (
                    <span className="text-[9px] text-dim font-bold uppercase tracking-wider">
                      Awaiting clipboard input
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Btn
                  variant="ghost"
                  onClick={() => { setShowPasteOverlay(false); setPasteValue(''); setPasteError(null); }}
                  className="px-4 py-2 text-xs"
                >
                  Cancel
                </Btn>
                <Btn
                  variant="primary"
                  disabled={!!pasteError || !pasteValue.trim()}
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(pasteValue);
                      const flattened = flattenConfig(parsed);
                      hasUserLocalOverrideRef.current = true;
                      suppressDraftSaveRef.current = false;
                      setCfg(flattened);
                      setIsDirty(true);
                      setHasPendingSessionChanges(true);
                      validate(flattened);
                      if (!isEdit) persistDraft(flattened, loadedPresetName);
                      addAlert({ level: 'success', title: 'Paste Successful', message: 'Configuration pasted and loaded.' });
                      setShowPasteOverlay(false);
                      setPasteValue('');
                      setPasteError(null);
                    } catch (err) {
                      setPasteError(err.message);
                    }
                  }}
                  className="px-4 py-2 text-xs bg-accent text-white"
                >
                  Apply Pasted Configuration
                </Btn>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


const OptimizationPanel = ({ analytics, cfg, setField, type = 'rr' }) => {
  const [showMaeInfo, setShowMaeInfo] = useState(false);
  if (!analytics?.rrOptimization) return null;
  const opt = analytics.rrOptimization;
  const sampleSize = opt.sampleSize || 0;
  const needed = Math.max(0, 20 - sampleSize);
  const isOptimal = opt.status === 'OPTIMAL';

  if (type === 'rr') {
    return (
      <div className="mt-4 p-4 bg-accent/5 border border-accent/20 rounded-2xl flex flex-col gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-accent">
            <Target size={12} /> Statistical RR Model
          </div>
          <div className={cn("text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter border", isOptimal ? "bg-green/10 border-green/20 text-green" : "bg-amber/10 border-amber/20 text-amber")}>
            {opt.status} MODEL
          </div>
        </div>

        {needed > 0 && (
          <div className="flex items-center gap-2 p-2 bg-background/40 rounded-lg border border-border/30">
            <div className="h-1 flex-1 bg-border rounded-full overflow-hidden">
               <div className="h-full bg-accent transition-all duration-1000" style={{ width: `${(sampleSize / 20) * 100}%` }} />
            </div>
            <span className="text-[9px] font-bold text-dim uppercase tracking-tight">{needed} more trades for optimal accuracy</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Conservative', rr: opt.conservativeRr, color: 'text-green', bg: 'bg-green/10' },
            { label: 'Balanced', rr: opt.balancedRr, color: 'text-accent', bg: 'bg-accent/10' },
            { label: 'Aggressive', rr: opt.aggressiveRr, color: 'text-purple', bg: 'bg-purple/10' }
          ].map(t => (
            <button
              key={t.label}
              type="button"
              onClick={() => {
                if (cfg.tp_mode === 'fixed') setField('tp_ratio', t.rr);
                else {
                  const next = [...(cfg.exit_rr_sequence || [0, 1, 2])];
                  next[next.length - 1] = t.rr;
                  setField('exit_rr_sequence', next);
                }
              }}
              className={cn("p-2 rounded-xl border border-border/40 hover:border-accent/40 transition-all text-left bg-background/40 group", t.bg)}
            >
              <div className="text-[7px] font-black uppercase tracking-tighter text-dim/60 mb-0.5">{t.label}</div>
              <div className={cn("text-sm font-black font-mono tracking-tighter", t.color)}>{t.rr.toFixed(1)}R</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'trailing') {
     const dist = typeof opt.recommendedTrailingDistance === 'number' ? opt.recommendedTrailingDistance : null;
     if (dist === null) return null;

     return (
       <div className="mt-4 p-4 bg-purple/5 border border-purple/20 rounded-2xl flex flex-col gap-3 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-purple-400">
              <Activity size={12} /> Volatility Recommendation
            </div>
            <InfoHelpButton
              open={showMaeInfo}
              onToggle={() => setShowMaeInfo(v => !v)}
              label="Volatility Recommendation"
            />
          </div>
          {showMaeInfo && (
            <InfoDropdownBox>
              Based on historical Maximum Adverse Excursion (MAE). Designed to survive normal volatility while locking gains.
            </InfoDropdownBox>
          )}
          <div className="flex items-center justify-between gap-4">
             <div className="flex flex-col">
                <span className="text-[8px] text-dim font-black uppercase tracking-widest mb-0.5">Statistical Distance</span>
                <span className="text-lg font-black font-mono tracking-tighter text-text leading-none">{dist.toFixed(2)}%</span>
             </div>
             <Btn
               variant="ghost"
               onClick={() => setField('trailing_stop_distance_pct', dist)}
               className="px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest bg-purple/10 text-purple-400 border-purple/20 hover:bg-purple/20"
             >
               Use Recommended
             </Btn>
          </div>
       </div>
     );
  }

  return null;
};
