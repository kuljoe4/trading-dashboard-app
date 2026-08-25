import React, { useEffect, useMemo, useState, useId, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, Save, FolderOpen, Search, Settings2, ShieldCheck, Clock, CheckCircle2, Zap, XCircle, Activity, LayoutGrid, Briefcase, TrendingUp, Target, ArrowRight, Copy, RefreshCw, ClipboardPaste, Download, Upload, Info, AlertTriangle, Lock } from 'lucide-react'
import { cn, Btn, Tooltip, PaperBadge, DemoBadge, LiveBadge, CopyButton, VisuallyHidden, ModalAlertTicker } from './ui/primitives'
import * as Switch from '@radix-ui/react-switch'
import { ConfirmationModal } from './ConfirmationModal'
import { CONFIG_LIMITS } from '../constants/configLimits'
import { settingsAPI, presetsAPI } from '../api/client'
import { useTradingStore } from '../store/trading'
import { ChevronDown, ChevronRight } from 'lucide-react'

const fmtUSD = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CollapsibleSection = ({ id, icon, title, subtitle, children, isOpen, onToggle }) => {
  return (
    <section className="bg-background/40 rounded-xl border border-border/40 overflow-hidden transition-all">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-2.5 hover:bg-white/[0.02] transition-colors group"
      >
        <SectionHeader icon={icon} title={title} subtitle={subtitle} className="mb-0" />
        <div className={cn(
          "w-6 h-6 rounded-md border border-border/40 flex items-center justify-center text-dim transition-all group-hover:border-accent/40 group-hover:text-accent",
          isOpen && "rotate-180 bg-accent/5 border-accent/20 text-accent"
        )}>
          <ChevronDown size={14} />
        </div>
      </button>
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

const TAB_ERROR_MAP = {
  scan_interval: 'scan',
  scan_lookback: 'scan',
  scan_mode: 'scan',
  trading_mode: 'env',
  risk_pct_per_trade: 'risk',
  max_open_trades: 'risk',
  sl_distance_pct: 'risk',
  scanner_weights_momentum: 'scan',
  scanner_weights_volatility: 'scan',
  scanner_weights_trend: 'scan',
};

const SIGNALS = [
  ['momentum_pct', '% Momentum', 'Entry when momentum exceeds threshold.'],
  ['breakout_hl', 'Breakout H/L', 'Entry when price breaks highest high or lowest low.'],
  ['ema_price_cross', 'EMA Price Cross', 'Entry when price crosses EMA.'],
  ['ema_dual_cross', 'EMA Dual Cross', 'Entry when fast EMA crosses slow EMA.'],
  ['ema_close', 'EMA Close', 'Entry when candle closes favorable side of EMA.'],
  ['ema_dual_close', 'EMA Dual Close', 'Entry when candle closes above both EMAs.'],
  ['ma', 'MA Cross', 'Entry when price crosses simple Moving Average.'],
  ['engulfing', 'Engulfing', 'Entry on bullish or bearish engulfing pattern.'],
  ['macd_impulse', 'MACD Impulse', 'Phase 4 momentum pullback entry.'],
  ['macd_fade', 'MACD Fade', 'Phase 5 momentum exit when histogram weakens.'],
  ['macd_pbc', 'MACD PBC', 'Premium Pullback-to-Continuation pullback entry.'],
  ['supertrend', 'Supertrend', 'Entry & Exit trend follower based on ATR.'],
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

const getSignalParamsSchema = (sigKey, baseType) => {
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
    addParam('entry_ema_period', 'number', 12, null, { min: 1 }, 'Entry Period');
    addParam('exit_ema_period', 'number', 12, null, { min: 1 }, 'Exit Period');
  } else if (['ema_dual_cross', 'ema_dual_close'].includes(baseType)) {
    addParam('entry_ema_fast', 'number', 9, null, { min: 1 }, 'Entry Fast');
    addParam('entry_ema_slow', 'number', 21, null, { min: 1 }, 'Entry Slow');
    addParam('exit_ema_fast', 'number', 9, null, { min: 1 }, 'Exit Fast');
    addParam('exit_ema_slow', 'number', 21, null, { min: 1 }, 'Exit Slow');
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
  } else if (['macd_impulse', 'macd_fade', 'macd_pbc'].includes(baseType)) {
    addParam('macd_fast', 'number', 12, null, { min: 1 }, 'MACD Fast');
    addParam('macd_slow', 'number', 26, null, { min: 1 }, 'MACD Slow');
    addParam('macd_signal', 'number', 9, null, { min: 1 }, 'MACD Signal');
    if (sigKey.includes('impulse')) {
      addParam('macd_strict_expansion', 'boolean', true, null, {}, 'Strict Expanding');
    }
    if (sigKey.includes('pbc')) {
      addParam('macd_pbc_trend_ema', 'number', 50, null, { min: 1 }, 'PBC Trend EMA');
      addParam('macd_pbc_lookback', 'number', 10, null, { min: 1 }, 'PBC Lookback');
    }
  } else if (baseType === 'supertrend') {
    addParam('supertrend_period', 'number', 10, null, { min: 1, max: 39 }, 'ATR Period');
    addParam('supertrend_multiplier', 'number', 3, null, { min: 0.1, step: 0.1 }, 'Multiplier');
    addParam('supertrend_mode', 'text', 'trend', [
      { value: 'trend', label: 'Trend State' },
      { value: 'crossover', label: 'Crossover Trigger' }
    ], {}, 'Supertrend Mode');
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
  macd_fast: "The fast EMA period for MACD line calculation.",
  macd_slow: "The slow EMA period for MACD line calculation.",
  macd_signal: "The signal line EMA period.",
  macd_strict_expansion: "When enabled, consecutive MACD histogram bars must strictly increase (bullish) or decrease (bearish) in magnitude.",
  macd_pbc_trend_ema: "The EMA period used as the trend filter. Price must be above this for long entries, and below for short entries.",
  macd_pbc_lookback: "The number of previous candles scanned to find a valid histogram contraction pullback.",
  supertrend_period: "The ATR lookback period for calculating band offsets.",
  supertrend_multiplier: "The multiplier value applied to the ATR.",
  supertrend_mode: "Trend State: Signal fires while trend matches side. Crossover Trigger: Signal fires only on the crossover candle."
};

const SectionHeader = React.memo(({ icon: Icon, title, subtitle, className }) => (
  <div className={cn("flex items-center gap-2 mb-2", className)}>
    <div className="w-6 h-6 rounded-md bg-accent/10 flex items-center justify-center text-accent">
      <Icon size={14} />
    </div>
    <div className="text-left">
      <h3 className="text-xs font-bold uppercase tracking-tight">{title}</h3>
      {subtitle && <p className="text-[9px] text-dim font-medium uppercase">{subtitle}</p>}
    </div>
  </div>
))
SectionHeader.displayName = 'SectionHeader'

const Toggle = React.memo(({ value, onChange, label, color = "bg-accent" }) => (
  <label className="flex items-center gap-3 cursor-pointer group">
    <Switch.Root checked={value} onCheckedChange={onChange} className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-offset-1 focus-visible:ring-offset-surface", value ? color : "bg-border")}>
      <Switch.Thumb className={cn("pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform", value ? "translate-x-5" : "translate-x-0")} />
    </Switch.Root>
    {label && <span className={cn("text-sm font-bold transition-colors", value ? "text-text" : "text-dim group-hover:text-dim/80")}>{label}</span>}
  </label>
))
Toggle.displayName = 'Toggle'

const Chip = React.forwardRef(({ active, onClick, children, activeClass = "border-accent text-accent bg-accent/10", ...props }, ref) => (
  <button ref={ref} type="button" onClick={onClick} aria-pressed={active} className={cn("px-3 py-1.5 rounded-md border text-[11px] font-bold tracking-wider transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none", active ? activeClass : "border-border text-dim hover:border-dim/50")} {...props}>{children}</button>
))
Chip.displayName = 'Chip'

const ConfigField = React.memo(({ label, id, name, type, value, onChange, error, warning, opts, attrs }) => {
  // BOLT-PERF: Local-Sync pattern. Maintains local state for rapid typing to avoid
  // expensive full-modal re-renders on every keystroke. Syncs to parent on blur or enter.
  const [localValue, setLocalValue] = useState(value ?? '');

  useEffect(() => {
    setLocalValue(value ?? '');
  }, [value]);

  const commit = () => {
    const val = type === 'number' ? Number(localValue) : localValue;
    if (val !== value) {
      onChange(name, val);
    }
  };

  const handleChange = (e) => {
    setLocalValue(e.target.value);
  };

  const handleSelectChange = (e) => {
    const val = type === 'number' ? Number(e.target.value) : e.target.value;
    onChange(name, val);
  };

  return (
    <div className="flex flex-col gap-1 group/field">
      <div className="flex justify-between items-center">
        <label htmlFor={id} className="text-[9px] text-dim group-hover/field:text-accent font-black tracking-widest uppercase transition-colors">{label}</label>
        {error && <span role="alert" className="text-[9px] text-red font-bold uppercase">{error}</span>}
        {warning && !error && <span role="alert" className="text-[9px] text-amber font-bold uppercase">{warning}</span>}
      </div>
      {opts ? (
        <select
          id={id}
          value={localValue ?? ''}
          onChange={handleSelectChange}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs font-bold text-text focus:border-accent outline-none appearance-none transition-all cursor-pointer hover:border-border-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          {opts.map((o) => {
            const val = typeof o === 'string' ? o : o.value;
            const lbl = typeof o === 'string' ? o : o.label;
            return <option key={val} value={val}>{lbl}</option>;
          })}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          value={localValue ?? ''}
          {...attrs}
          onChange={handleChange}
          onBlur={(e) => { commit(); attrs.onBlur?.(e); }}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-text focus:border-accent outline-none transition-all hover:border-border-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        />
      )}
    </div>
  );
})
ConfigField.displayName = 'ConfigField'


const ExitSignalCard = React.memo(({
  signal,
  active,
  layers,
  delays,
  actions,
  timeframes,
  onToggle,
  onAddLayer,
  onRemoveLayer,
  onUpdateLayer,
  engulfingMode
}) => {
  const [key, label, desc] = signal;

  return (
    <div className={cn("flex flex-col gap-2.5 p-3.5 bg-surface/50 border rounded-2xl hover:border-border-hover transition-all", active ? "border-red/30 bg-red/[0.01]" : "border-border")}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col text-left">
          <span className={cn("text-xs font-bold", active ? "text-red" : "text-text")}>{label}</span>
          <span className="text-[9px] text-dim font-medium uppercase mt-0.5">{desc}</span>
        </div>
        <Switch.Root
          checked={active}
          onCheckedChange={() => onToggle(key, active)}
          className={cn("h-5 w-9 rounded-full transition-colors relative outline-none focus-visible:ring-2 focus-visible:ring-accent", active ? "bg-red" : "bg-border")}
          aria-label={`Toggle ${label} exit signal`}
        >
          <Switch.Thumb className={cn("block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-100", active ? "translate-x-4" : "translate-x-1")} />
        </Switch.Root>
      </div>

      {active && (
        <div className="space-y-3.5 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {key === 'engulfing' && (engulfingMode === 'soft_range' || engulfingMode === 'soft_body') && (
            <div className="text-[9.5px] font-semibold text-amber bg-amber/10 border border-amber/20 rounded-xl p-2.5 flex items-start gap-2 leading-snug text-left">
              <AlertTriangle className="shrink-0 text-amber mt-0.5 animate-pulse" size={13} />
              <span>
                <strong>Whipsaw Risk:</strong> Soft engulfing modes evaluate off live candles. Without an exit delay, tick-by-tick fluctuations can cause rapid enter/exit oscillation. Suggest adding a delay (e.g. 15-30s).
              </span>
            </div>
          )}
          {layers.map((layerKey, idx) => {
            const isBase = layerKey === key;
            const delayValue = delays[layerKey] || 0;
            const actionValue = actions[layerKey] || 'close';
            const tfValue = timeframes[layerKey] || 'default';
            const isCandleType = typeof delayValue === 'string' && /^\d+c$/.test(delayValue);
            const candleCountValue = isCandleType ? parseInt(delayValue.slice(0, -1), 10) : 1;

            return (
              <div key={layerKey} className="p-3 bg-background/50 border border-border/30 rounded-xl space-y-2.5 relative group/layer">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-red">
                    Layer {idx + 1} {isBase ? "(Base)" : `(Chain: _${layerKey.split('_').pop()})`}
                  </span>
                  {!isBase && (
                    <button
                      type="button"
                      onClick={() => onRemoveLayer(layerKey)}
                      aria-label={`Remove Layer ${idx + 1}`}
                      className="p-1 text-dim hover:text-red transition-colors opacity-0 group-hover/layer:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {/* Timeframe Selection */}
                  <div className="flex flex-col gap-1 text-left">
                    <label htmlFor={`tf-${layerKey}`} className="text-[8px] text-dim uppercase tracking-wider font-bold">Timeframe</label>
                    <select
                      id={`tf-${layerKey}`}
                      value={tfValue}
                      onChange={(e) => onUpdateLayer(layerKey, 'timeframe', e.target.value)}
                      className="bg-surface border border-border/40 rounded-lg px-2 py-1 text-[10px] font-bold text-text focus:border-accent outline-none cursor-pointer h-7 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    >
                      <option value="default">Default</option>
                      <option value="1m">1m</option>
                      <option value="3m">3m</option>
                      <option value="5m">5m</option>
                      <option value="15m">15m</option>
                      <option value="30m">30m</option>
                      <option value="1h">1h</option>
                      <option value="4h">4h</option>
                      <option value="1d">1d</option>
                    </select>
                  </div>

                  {/* Delay Input (Time or Candles) */}
                  <div className="flex flex-col gap-1 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-[8px] text-dim uppercase tracking-wider font-bold">Delay</span>
                      <div className="flex bg-surface border border-border/40 rounded-md p-0.5" role="group" aria-label="Delay mode selection">
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateLayer(layerKey, 'delay', 0);
                          }}
                          className={cn(
                            "px-1 py-0.5 text-[7px] font-black uppercase rounded transition-all focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                            !isCandleType
                              ? "bg-accent/10 text-accent"
                              : "text-dim hover:text-text"
                          )}
                          aria-pressed={!isCandleType}
                        >
                          Time
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateLayer(layerKey, 'delay', "1c");
                          }}
                          className={cn(
                            "px-1 py-0.5 text-[7px] font-black uppercase rounded transition-all focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                            isCandleType
                              ? "bg-accent/10 text-accent"
                              : "text-dim hover:text-text"
                          )}
                          aria-pressed={isCandleType}
                        >
                          Candle
                        </button>
                      </div>
                    </div>

                    {!isCandleType ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          placeholder="0h"
                          value={Math.floor((Number(delayValue) || 0) / 3600) || ''}
                          onChange={(e) => {
                            const h = parseInt(e.target.value) || 0;
                            const m = Math.floor(((Number(delayValue) || 0) % 3600) / 60);
                            onUpdateLayer(layerKey, 'delay', (h * 3600) + (m * 60));
                          }}
                          className="bg-surface border border-border/40 rounded-lg px-1.5 py-1 text-[10px] font-mono font-bold focus:border-accent outline-none text-right h-7 w-12 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                        />
                        <span className="text-dim font-bold">:</span>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          placeholder="0m"
                          value={Math.floor(((Number(delayValue) || 0) % 3600) / 60) || ''}
                          onChange={(e) => {
                            const h = Math.floor((Number(delayValue) || 0) / 3600);
                            const m = parseInt(e.target.value) || 0;
                            onUpdateLayer(layerKey, 'delay', (h * 3600) + (m * 60));
                          }}
                          className="bg-surface border border-border/40 rounded-lg px-1.5 py-1 text-[10px] font-mono font-bold focus:border-accent outline-none text-right h-7 w-12 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                        />
                      </div>
                    ) : (
                      <div className="relative flex items-center h-7">
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          placeholder="1"
                          value={candleCountValue}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value) || 1);
                            onUpdateLayer(layerKey, 'delay', `${val}c`);
                          }}
                          className="bg-surface border border-border/40 rounded-lg px-1.5 py-1 text-[10px] font-mono font-bold focus:border-accent outline-none text-right h-7 w-full pr-6 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                          aria-label="Number of candles delay"
                        />
                        <span className="absolute right-2 text-[8px] font-bold text-dim/60 font-mono pointer-events-none">c</span>
                      </div>
                    )}
                  </div>

                  {/* Action Selection */}
                  <div className="flex flex-col gap-1 text-left">
                    <label htmlFor={`action-${layerKey}`} className="text-[8px] text-dim uppercase tracking-wider font-bold">Action</label>
                    <select
                      id={`action-${layerKey}`}
                      value={actionValue}
                      onChange={(e) => onUpdateLayer(layerKey, 'action', e.target.value)}
                      className={cn(
                        "border rounded-lg px-1.5 py-1 text-[10px] font-black uppercase tracking-tight focus:outline-none cursor-pointer h-7 text-center focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                        actionValue === 'lock_sl'
                          ? "bg-purple/10 border-purple/30 text-purple focus:border-purple"
                          : "bg-red/10 border-red/30 text-red focus:border-red"
                      )}
                    >
                      <option value="close">🛑 Close</option>
                      <option value="lock_sl">🔒 Lock SL</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => onAddLayer(key)}
            className="w-full py-1.5 border border-dashed border-border rounded-xl text-[9px] font-black uppercase tracking-wider text-dim hover:text-red hover:border-red/40 hover:bg-red/5 transition-all flex items-center justify-center gap-1.5"
          >
            <Plus size={11} /> Add Chained Layer
          </button>
        </div>
      )}
    </div>
  );
})
ExitSignalCard.displayName = 'ExitSignalCard'

const EntrySignalCard = React.memo(({
  signal,
  active,
  layers,
  timeframes,
  onToggle,
  onAddLayer,
  onRemoveLayer,
  onUpdateLayer
}) => {
  const [key, label, desc] = signal;

  return (
    <div className={cn("flex flex-col gap-2.5 p-3.5 bg-surface/50 border rounded-2xl hover:border-border-hover transition-all", active ? "border-accent/30 bg-accent/[0.01]" : "border-border")}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col text-left">
          <span className={cn("text-xs font-bold", active ? "text-accent" : "text-text")}>{label}</span>
          <span className="text-[9px] text-dim font-medium uppercase mt-0.5">{desc}</span>
        </div>
        <Switch.Root
          checked={active}
          onCheckedChange={() => onToggle(key, active)}
          className={cn("h-5 w-9 rounded-full transition-colors relative outline-none focus-visible:ring-2 focus-visible:ring-accent", active ? "bg-accent" : "bg-border")}
          aria-label={`Toggle ${label} entry signal`}
        >
          <Switch.Thumb className={cn("block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-100", active ? "translate-x-4" : "translate-x-1")} />
        </Switch.Root>
      </div>

      {active && (
        <div className="space-y-3 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {layers.map((layerKey, idx) => {
            const isBase = layerKey === key;
            const tfValue = timeframes[layerKey] || 'default';

            return (
              <div key={layerKey} className="p-2.5 bg-background/50 border border-border/30 rounded-xl space-y-2 relative group/layer flex items-center justify-between gap-3">
                <div className="flex flex-col text-left">
                  <span className="text-[9px] font-black uppercase tracking-wider text-accent">
                    Layer {idx + 1} {isBase ? "(Base)" : `(Chain: _${layerKey.split('_').pop()})`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 text-left">
                    <label htmlFor={`tf-${layerKey}`} className="text-[8px] text-dim uppercase tracking-wider font-bold">Timeframe</label>
                    <select
                      id={`tf-${layerKey}`}
                      value={tfValue}
                      onChange={(e) => onUpdateLayer(layerKey, 'timeframe', e.target.value)}
                      className="bg-surface border border-border/40 rounded-lg px-2 py-0.5 text-[10px] font-bold text-text focus:border-accent outline-none cursor-pointer h-7 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    >
                      <option value="default">Default</option>
                      <option value="1m">1m</option>
                      <option value="3m">3m</option>
                      <option value="5m">5m</option>
                      <option value="15m">15m</option>
                      <option value="30m">30m</option>
                      <option value="1h">1h</option>
                      <option value="4h">4h</option>
                      <option value="1d">1d</option>
                    </select>
                  </div>

                  {!isBase && (
                    <button
                      type="button"
                      onClick={() => onRemoveLayer(layerKey)}
                      aria-label={`Remove Layer ${idx + 1}`}
                      className="p-1 text-dim hover:text-red transition-colors opacity-0 group-hover/layer:opacity-100 focus-visible:opacity-100 animate-in fade-in duration-200"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => onAddLayer(key)}
            className="w-full py-1 border border-dashed border-border rounded-xl text-[9px] font-black uppercase tracking-wider text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all flex items-center justify-center gap-1.5"
          >
            <Plus size={11} /> Add Chained Layer
          </button>
        </div>
      )}
    </div>
  );
})
EntrySignalCard.displayName = 'EntrySignalCard'

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
          className="w-full bg-surface border border-border rounded-xl pl-4 pr-10 py-3 text-sm font-mono focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none hover:border-border-hover transition-colors"
        />
        {value && (
          <Tooltip content="Clear Input">
            <button
              type="button"
              onClick={() => { setValue(''); setIsOpen(false); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md p-0.5 transition-colors"
              aria-label="Clear Input"
            >
              <X size={16} />
            </button>
          </Tooltip>
        )}

        <AnimatePresence>
          {isOpen && options.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-full left-0 right-0 mt-2 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            >
              {options.map(o => (
                <button
                  key={o.symbol}
                  type="button"
                  onClick={() => handleAdd(o.symbol)}
                  className="w-full px-4 py-2.5 text-left text-sm font-mono hover:bg-white/5 transition-colors border-b border-border/50 last:border-0"
                >
                  {o.symbol}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Btn variant="primary" onClick={() => handleAdd()} className="aspect-square p-0 w-12 h-12 flex items-center justify-center shrink-0"><Plus size={20} /></Btn>
      {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}
    </div>
  );
})
ManualMonitorInput.displayName = 'ManualMonitorInput'

const SavePresetInput = React.memo(({ onSave, isSaving, success, defaultName }) => {
  const [name, setName] = useState(defaultName || '');
  const inputId = useId();

  useEffect(() => {
    if (defaultName) setName(defaultName);
  }, [defaultName]);

  return (
    <div className="flex gap-2">
      <VisuallyHidden>
        <label htmlFor={inputId}>Preset Name</label>
      </VisuallyHidden>
      <input
        id={inputId}
        type="text"
        placeholder="Preset name (e.g. Scalp High Vol)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      />
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
            className="aspect-square p-0 w-12 h-12 flex items-center justify-center"
            aria-label={success ? "Preset saved successfully" : "Save current configuration as preset"}
          >
            {success ? <CheckCircle2 size={20} /> : <Save size={20} />}
          </Btn>
        </div>
      </Tooltip>
    </div>
  );
})
SavePresetInput.displayName = 'SavePresetInput'

const WatchlistDropdownInput = React.memo(({ value = [], onChange }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [rangeFilter, setRangeFilter] = useState('all'); // 'all' | 'pos' | 'neg' | 'high_mover' | 'extreme'
  const scannerResults = useTradingStore(state => state.scannerResults || []);
  const watchlistSearchInputRef = useRef(null);

  const filteredOptions = useMemo(() => {
    const safeResults = Array.isArray(scannerResults) ? scannerResults : [];

    // Sort all opportunities by 24h change pct descending
    const sorted = [...safeResults].sort((a, b) => (b.pct || 0) - (a.pct || 0));

    return sorted.filter(opp => {
      if (!opp || !opp.symbol) return false;

      const matchesSearch = opp.symbol.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      if (rangeFilter === 'pos') {
        return (opp.pct || 0) > 0;
      }
      if (rangeFilter === 'neg') {
        return (opp.pct || 0) < 0;
      }
      if (rangeFilter === 'high_mover') {
        return Math.abs(opp.pct || 0) >= 2.0;
      }
      if (rangeFilter === 'extreme') {
        return Math.abs(opp.pct || 0) >= 5.0;
      }

      return true;
    });
  }, [scannerResults, searchTerm, rangeFilter]);

  const handleSelect = (symbol) => {
    if (symbol && !value.includes(symbol)) {
      onChange([...value, symbol]);
    }
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleRemove = (symbol) => {
    onChange(value.filter(s => s !== symbol));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1 group">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
          <input
            ref={watchlistSearchInputRef}
            type="text"
            placeholder="Search symbol to add... (e.g. BTCUSDT)"
            value={searchTerm}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => { setSearchTerm(e.target.value.toUpperCase()); setIsOpen(true); }}
            className="w-full bg-surface border border-border rounded-xl pl-10 pr-10 py-3 text-sm font-mono focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none hover:border-border-hover transition-colors"
          />
          {searchTerm ? (
            <Tooltip content="Clear Search">
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  watchlistSearchInputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md p-0.5 transition-colors"
                aria-label="Clear Search symbol"
              >
                <X size={16} />
              </button>
            </Tooltip>
          ) : (
            <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-surface/50 border border-border/80 text-[9px] font-black text-accent/80 shadow-sm font-mono px-1.5 py-0.5 rounded pointer-events-none select-none transition-opacity duration-200 group-focus-within:opacity-0">
              /
            </kbd>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 items-center bg-background/40 p-1.5 rounded-xl border border-border/40">
          <span className="text-[9px] font-black text-dim uppercase tracking-wider px-1.5">Filters:</span>
          {[
            { id: 'all', label: 'All' },
            { id: 'pos', label: 'Positive' },
            { id: 'neg', label: 'Negative' },
            { id: 'high_mover', label: 'Movers >2%' },
            { id: 'extreme', label: 'Extreme >5%' }
          ].map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => { setRangeFilter(f.id); setIsOpen(true); }}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all focus-visible:ring-2 focus-visible:ring-accent outline-none",
                rangeFilter === f.id
                  ? "bg-accent/15 border border-accent/30 text-accent font-black"
                  : "bg-surface/50 border border-border/30 text-dim hover:text-text"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="relative bg-surface border border-border rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto no-scrollbar"
          >
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center text-xs text-dim">No matching symbols found</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1 p-2">
                {filteredOptions.map(opp => {
                  const isSelected = value.includes(opp.symbol);
                  const isPos = opp.pct >= 0;
                  return (
                    <button
                      key={opp.symbol}
                      type="button"
                      disabled={isSelected}
                      onClick={() => handleSelect(opp.symbol)}
                      className={cn(
                        "flex justify-between items-center px-3 py-2 rounded-lg text-xs font-mono border transition-all text-left focus-visible:ring-2 focus-visible:ring-accent outline-none",
                        isSelected
                          ? "bg-white/5 border-border/30 text-dim/40 cursor-not-allowed"
                          : "bg-background/20 border-border/30 hover:border-accent/40 hover:bg-white/5 text-text"
                      )}
                    >
                      <span className="font-bold">{opp.symbol}</span>
                      <span className={cn(
                        "text-[10px] font-bold",
                        isSelected ? "text-dim/30" : isPos ? "text-green" : "text-red"
                      )}>
                        {isPos ? '+' : ''}{Number(opp.pct || 0).toFixed(2)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap gap-2 mt-4">
        {value.length === 0 ? (
          <p className="text-[10px] text-dim/40 font-bold uppercase tracking-widest p-4 border border-dashed border-border/40 rounded-xl w-full text-center">
            No symbols in Static Watchlist (Global discovery will be used)
          </p>
        ) : (
          value.map((sym, i) => {
            const opp = scannerResults.find(r => r?.symbol === sym);
            const pctText = opp ? ` (${(opp.pct >= 0 ? '+' : '') + Number(opp.pct).toFixed(2)}%)` : '';
            return (
              <Chip
                key={sym}
                active
                activeClass="bg-accent/10 border-accent/40 text-accent font-bold"
                aria-label={`Remove ${sym}`}
                onClick={() => handleRemove(sym)}
              >
                {sym}{pctText} <X size={10} className="inline ml-1" />
              </Chip>
            );
          })
        )}
      </div>
    </div>
  );
});
WatchlistDropdownInput.displayName = 'WatchlistDropdownInput';

const ListInput = React.memo(({ value, onChange, placeholder }) => {
  const [localValue, setLocalValue] = useState(() => value?.join(', ') || '');

  // Update local value when external value changes (e.g. on preset load)
  useEffect(() => {
    setLocalValue(value?.join(', ') || '');
  }, [value]);

  const handleBlur = () => {
    const list = localValue.split(',').map(s => s.trim()).filter(Boolean);
    onChange(list);
  };

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => { if (e.key === 'Enter') handleBlur(); }}
      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none hover:border-border-hover transition-colors"
    />
  );
})
ListInput.displayName = 'ListInput'

const SectionTab = React.memo(({ id, label, icon: Icon, active, onClick, hasError }) => (
  <Chip
    active={active}
    onClick={() => onClick(id)}
    className={cn("flex items-center gap-2 relative", hasError && !active && "border-red/40")}
    role="tab"
    aria-selected={active}
    aria-invalid={hasError}
    aria-controls={`config-panel-${id}`}
    id={`config-tab-${id}`}
    tabIndex={active ? 0 : -1}
  >
    <Icon size={12} className={cn(active ? "text-accent" : "text-dim", hasError && !active && "text-red")} />
    {label}
    {hasError && !active && (
      <span className="absolute -top-1 -right-1 flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red"></span>
      </span>
    )}
  </Chip>
))
SectionTab.displayName = 'SectionTab'

const SectionTabs = React.memo(({ section, onSectionChange, errors }) => {
  const tabs = useMemo(() => [
    { id: 'scan', label: 'Scanner', icon: Search },
    { id: 'strategy', label: 'Strategy', icon: Zap },
    { id: 'risk', label: 'Risk', icon: ShieldCheck },
    { id: 'env', label: 'Env', icon: Briefcase },
    { id: 'presets', label: 'Presets', icon: FolderOpen }
  ], []);

  const tabHasError = React.useCallback((tabId) => {
    return Object.keys(errors).some(key => TAB_ERROR_MAP[key] === tabId);
  }, [errors]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const currentIndex = tabs.findIndex(t => t.id === section);
      let nextIndex;
      if (e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      }
      onSectionChange(tabs[nextIndex].id);

      // Focus the new tab
      setTimeout(() => {
        const nextTab = document.getElementById(`config-tab-${tabs[nextIndex].id}`);
        nextTab?.focus();
      }, 0);
    }
  };

  return (
    <div
      className="flex gap-2 p-4 overflow-x-auto no-scrollbar touch-pan-x outline-none"
      data-vaul-no-drag
      role="tablist"
      aria-label="Configuration sections"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {tabs.map((tab) => (
        <SectionTab
          key={tab.id}
          {...tab}
          active={section === tab.id}
          onClick={onSectionChange}
          hasError={tabHasError(tab.id)}
        />
      ))}
    </div>
  );
})
SectionTabs.displayName = 'SectionTabs'

const EnvironmentButton = React.memo(({ mode, isSelected, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(mode)}
    className={cn("p-4 rounded-xl border-2 text-left transition-all relative group", isSelected ? "border-accent bg-accent/10 ring-2 ring-accent/20" : "border-border bg-surface hover:border-border-hover")}
  >
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs font-black uppercase tracking-tighter capitalize">{mode}</span>
      {isSelected && <CheckCircle2 size={16} className="text-accent" />}
    </div>
    <p className="text-[9px] text-dim font-bold uppercase tracking-widest">
      {mode === 'paper' ? 'Simulated' : mode === 'testnet' ? 'Demo API' : 'Real Capital'}
    </p>
  </button>
))
EnvironmentButton.displayName = 'EnvironmentButton'

const PresetItem = React.memo(React.forwardRef(({ preset, isLoaded, isDirty, onLoad, onToggleVariant, onDelete, isVariant, sessionActive }, ref) => {
  const pMode = preset.config.trading_mode || (preset.config.paper_mode ? 'paper' : 'live');
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={cn(
        "flex items-center justify-between p-4 bg-background border rounded-2xl transition-all group/preset relative overflow-hidden cursor-pointer",
        isLoaded
          ? "border-accent/40 shadow-[0_0_12px_rgba(var(--accent-rgb),0.06)] bg-accent/[0.01]"
          : isVariant
          ? "border-purple/40 shadow-[0_0_12px_rgba(168,85,247,0.06)] bg-purple/[0.01]"
          : "border-border hover:border-border-hover hover:bg-white/[0.01]"
      )}
    >
      <button
        type="button"
        onClick={() => onLoad(preset)}
        className="flex-1 flex items-center gap-4 text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl p-1 transition-all"
        aria-label={`Load preset ${preset.name}`}
      >
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-300",
          isLoaded
            ? "bg-accent/15 border-accent/30 text-accent shadow-[0_0_8px_rgba(var(--accent-rgb),0.15)]"
            : isVariant
            ? "bg-purple/15 border-purple/30 text-purple shadow-[0_0_8px_rgba(168,85,247,0.15)]"
            : "bg-surface border-border text-dim group-hover/preset:border-accent/20 group-hover/preset:text-accent group-hover/preset:scale-105"
        )}>
          {isLoaded ? <CheckCircle2 size={18} /> : isVariant ? <ShieldCheck size={18} /> : <Zap size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold group-hover/preset:text-accent transition-colors flex items-center gap-2 flex-wrap">
             <span className="truncate">{preset.name}</span>
             <div className="flex items-center gap-1 scale-[0.7] origin-left shrink-0">
               {pMode === 'paper' && <PaperBadge />}
               {pMode === 'testnet' && <DemoBadge />}
               {pMode === 'live' && <LiveBadge />}
             </div>
             {isLoaded && (
               <span className={cn("text-[9px] px-1.5 py-0.5 rounded shrink-0 font-black tracking-widest uppercase", isDirty ? "bg-amber/10 text-amber" : "bg-accent/10 text-accent")}>
                 {isDirty ? "Modified" : "Active"}
               </span>
             )}
             {isVariant && !isLoaded && (
               <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0 font-black tracking-widest uppercase bg-purple/10 text-purple">
                 Variant
               </span>
             )}
          </div>
          <div className="text-[10px] text-dim font-bold uppercase tracking-tight mt-0.5">
            {preset.config.scan_interval} · {preset.config.scan_pct_threshold}% · {preset.config.risk_pct_per_trade}% Risk
          </div>
        </div>
      </button>

      <div className="flex items-center gap-2">
        <Tooltip content={isVariant ? "Remove Variant" : "Add as Variant"}>
          <button
            type="button"
            onClick={(e) => onToggleVariant(e, preset)}
            aria-label={isVariant ? `Remove ${preset.name} from variants` : `Add ${preset.name} as variant`}
            className={cn(
              "p-2 rounded-lg transition-all active:scale-95 border focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
              isVariant
                ? "bg-purple/10 text-purple border-purple/20 hover:bg-purple/20"
                : "bg-surface border-border text-dim hover:text-accent hover:border-accent/20"
            )}
          >
            {isVariant ? <XCircle size={16} /> : <Plus size={16} />}
          </button>
        </Tooltip>
        <Tooltip content={sessionActive ? "Preset deletion is locked while a session is active. Disable or remove from active strategy variants instead." : "Delete Preset"}>
          <button
            type="button"
            disabled={sessionActive}
            onClick={(e) => {
              if (sessionActive) return;
              onDelete(e, preset.name);
            }}
            aria-label={sessionActive ? `Preset deletion is locked for ${preset.name}` : `Delete preset ${preset.name}`}
            className={cn(
              "p-2 transition-colors rounded-lg focus-visible:ring-2 focus-visible:outline-none",
              sessionActive
                ? "text-dim/30 bg-surface/5 border border-border/20 cursor-not-allowed"
                : "text-dim hover:text-red hover:bg-red/5 focus-visible:ring-red"
            )}
          >
            {sessionActive ? <Lock size={16} className="opacity-60" /> : <Trash2 size={16} />}
          </button>
        </Tooltip>
      </div>
    </motion.div>
  );
}))
PresetItem.displayName = 'PresetItem'

const flattenConfig = (config) => {
  if (!config) return {};
  try {
    const params = typeof config.signal_params === 'string' ? JSON.parse(config.signal_params || '{}') : config.signal_params || {};
    const weights = config.scanner_weights || { momentum: 0.5, volatility: 0.3, trend: 0.2 };

    const flattened = {
      ...config,
      trading_mode: config.trading_mode || (config.paper_mode ? 'paper' : 'live'),
      scanner_weights_momentum: weights.momentum * 100,
      scanner_weights_volatility: weights.volatility * 100,
      scanner_weights_trend: weights.trend * 100,
      live_rr_sequence: Array.isArray(config.live_rr_sequence) ? config.live_rr_sequence : [1.0, 2.0, 4.0],
      exit_rr_sequence: Array.isArray(config.exit_rr_sequence) ? config.exit_rr_sequence : [0.0, 1.0, 2.0],
      trailing_guard_buffer_pct: config.trailing_guard_buffer_pct !== undefined ? config.trailing_guard_buffer_pct : CONFIG_LIMITS.TRAILING_GUARD_DEFAULT,
      slippage_warning_threshold: config.slippage_warning_threshold !== undefined ? config.slippage_warning_threshold * 100 : (CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT * 100 || 0.1),
      leverage: config.leverage !== undefined ? Number(config.leverage) : CONFIG_LIMITS.LEVERAGE_DEFAULT,
      slippage_abort_threshold: config.slippage_abort_threshold !== undefined ? Number(config.slippage_abort_threshold) : (CONFIG_LIMITS.SLIPPAGE_ABORT_DEFAULT || 0.05),
      hibernation_mode: config.hibernation_mode || 'adaptive',
      hibernation_grace_period_sec: config.hibernation_grace_period_sec || 30,
      sl_out_of_bounds_action: config.sl_out_of_bounds_action !== undefined ? config.sl_out_of_bounds_action : 'clamp',
      trailing_stop_enabled: !!config.trailing_stop_enabled,
      trailing_stop_distance_pct: config.trailing_stop_distance_pct || 1.0,
      release_risk_on_est_pnl_be: !!config.release_risk_on_est_pnl_be,
      smart_watchlist_enabled: !!config.smart_watchlist_enabled,
      smart_watchlist_sensitivity: config.smart_watchlist_sensitivity || 0.7,
      scanner_signal_depth: config.scanner_signal_depth || 10,
      auto_scale_min_notional: config.auto_scale_min_notional !== undefined ? config.auto_scale_min_notional : true,
      risk_hardening_enabled: !!config.risk_hardening_enabled,
      max_single_trade_risk_pct: config.max_single_trade_risk_pct !== undefined ? config.max_single_trade_risk_pct : 20.0,
      engulfing_mode: config.engulfing_mode || 'range',
      engulfing_timing: config.engulfing_timing || 'is_opportunity',
      engulfing_volume_confirm: !!config.engulfing_volume_confirm,
      engulfing_lookback: config.engulfing_lookback || 1,
      engulfing_streak: config.engulfing_streak || 1,
      engulfing_sequential: config.engulfing_sequential !== false,
    };

    // Dynamically map all params (including suffixes) directly to flattened keys
    Object.keys(params).forEach(k => {
      flattened[`signal_params_${k}`] = params[k];
    });

    return flattened;
  } catch (e) { return { ...config }; }
};

const coerceAndSanitizeConfig = (rawConfig) => {
  if (!rawConfig) return {};
  try {
    const flat = flattenConfig(rawConfig);
    const c = { ...flat, strategy_label: (flat.strategy_label || '').trim() };

    // Dynamically reconstruct the signal_params map from any flat keys prefix-matched with signal_params_
    const sp = {};
    Object.keys(flat).forEach(k => {
      if (k.startsWith('signal_params_') && k !== 'signal_params') {
        const paramKey = k.substring('signal_params_'.length);
        const val = flat[k];
        if (val !== undefined && val !== null) {
          // If the parameter is supposed to be boolean, parse as boolean, otherwise coerce to number or string
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
      'scan_pct_threshold', 'scan_lookback', 'scan_min_volume_usdt', 'watchlist_size',
      'watchlist_offset', 'sl_distance_pct', 'sl_min_pct', 'sl_max_pct', 'trailing_guard_buffer_pct',
      'tp_ratio', 'max_trades_per_period', 'trades_period_min', 'max_trades_24h',
      'scanner_signal_depth',
      'engulfing_lookback', 'engulfing_streak',
      'min_trade_interval_min', 'trades_jitter_pct', 'paper_starting_balance',
      'testnet_starting_balance', 'live_starting_balance', 'hot_loop_interval_ms',
      'main_loop_interval_ms', 'sl_lookback_period', 'sl_pct_limit',
      'max_open_trades_per_symbol', 'tod_min_winrate', 'leverage',
      'slippage_abort_threshold'
    ];

    numericFields.forEach(f => {
      if (c[f] !== undefined && c[f] !== null) {
        c[f] = Number(c[f]);
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

    if (c.hibernation_grace_period_sec !== undefined) {
      c.hibernation_grace_period_sec = Number(c.hibernation_grace_period_sec);
    }

    // UI Conversion: UI percentage back to backend decimal
    if (c.slippage_warning_threshold !== undefined) {
      c.slippage_warning_threshold = Number(c.slippage_warning_threshold) / 100;
    }

    // Zero out nested variants to prevent runaway nesting
    c.strategy_variants = [];

    // Clean up temporary UI fields
    Object.keys(c).forEach(k => {
      if (k.startsWith('signal_params_') && k !== 'signal_params') {
        delete c[k];
      }
    });

    return c;
  } catch (e) {
    return { ...rawConfig };
  }
};
export const ConfigModal = ({ initialConfig, onSave, onClose, isEdit = false, loading = false }) => {
  const { addAlert, isThrottled, wsStatus, isSyncingOnResume, sessionActive, lifetimeAnalytics, fetchLifetimeAnalytics } = useTradingStore(state => ({
    addAlert: state.addAlert,
    isThrottled: state.isThrottled,
    wsStatus: state.wsStatus,
    isSyncingOnResume: state.isSyncingOnResume,
    sessionActive: state.sessionActive,
    lifetimeAnalytics: state.lifetimeAnalytics,
    fetchLifetimeAnalytics: state.fetchLifetimeAnalytics
  }));

  const presetSearchInputRef = useRef(null);

  const isResuming = isThrottled || wsStatus !== 'live' || isSyncingOnResume;
  const showResumingFeedback = sessionActive && isResuming;
  // UX-MOBILE: Ensure inputs scroll into view when keyboard is active
  const handleInputFocus = React.useCallback((e) => {
    requestAnimationFrame(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  const [cfg, setCfg] = useState(() => {
    const savedDraft = sessionStorage.getItem('config_draft');
    if (savedDraft) {
      try {
        return JSON.parse(savedDraft);
      } catch (e) {
        console.error('[ConfigModal] Failed to parse draft:', e);
      }
    }
    return flattenConfig(initialConfig);
  });

  useEffect(() => {
    fetchLifetimeAnalytics(cfg?.paper_mode ? 'paper' : 'live');
  }, [fetchLifetimeAnalytics, cfg?.paper_mode]);
  const [isDirty, setIsDirty] = useState(() => {
    const savedDraft = sessionStorage.getItem('config_draft');
    return !!savedDraft;
  });

  const [section, setSection] = useState(isEdit ? 'presets' : 'scan')
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
  const [loadedPresetName, setLoadedPresetName] = useState(() => sessionStorage.getItem('loaded_preset_name'));
  const [presetToDelete, setPresetToDelete] = useState(null);
  const [presetSearch, setPresetSearch] = useState('');
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [showPasteOverlay, setShowPasteOverlay] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState(null);
  const [openSectionId, setOpenSectionId] = useState('scan_general');

  // Accordion behavior: auto-expand the first section of the selected tab on tab change
  useEffect(() => {
    const defaults = {
      scan: 'scan_general',
      strategy: 'strategy_entry',
      risk: 'risk_guards',
      env: 'adv_env',
    };
    if (defaults[section]) {
      setOpenSectionId(defaults[section]);
    }
  }, [section]);

  const modalRef = React.useRef(null);

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

  const partitionedPresets = useMemo(() => {
    const searchLower = presetSearch.toLowerCase().trim();
    const filtered = presets.filter(p =>
      !searchLower || p.name.toLowerCase().includes(searchLower)
    );

    const active = [];
    const available = [];

    filtered.forEach(p => {
      const isLoaded = loadedPresetName === p.name;
      const isVar = (cfg.strategy_variants || []).some(v => v.strategy_label === p.name);
      if (isLoaded || isVar) {
        active.push(p);
      } else {
        available.push(p);
      }
    });

    return { active, available };
  }, [presets, presetSearch, loadedPresetName, cfg.strategy_variants]);

  // Use a debounced effect for sessionStorage to avoid heavy stringify on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      sessionStorage.setItem('config_draft', JSON.stringify(cfg));
      if (loadedPresetName) sessionStorage.setItem('loaded_preset_name', loadedPresetName);
      else sessionStorage.removeItem('loaded_preset_name');
    }, 1000);
    return () => clearTimeout(timer);
  }, [cfg, loadedPresetName]);

  const validate = React.useCallback((c) => {
    const errs = {}; if (!c.scan_interval) errs.scan_interval = 'Required'; if (c.scan_lookback < 1) errs.scan_lookback = 'Min 1';
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

    if (c.risk_pct_per_trade > 2) {
      errs.risk_pct_per_trade_warn = 'Aggressive (>2%)'
    }

    if (c.sl_distance_pct > 5) {
      errs.sl_distance_pct_warn = 'Aggressive (>5%)'
    }

    const totalWeight = Number(c.scanner_weights_momentum || 0) + Number(c.scanner_weights_volatility || 0) + Number(c.scanner_weights_trend || 0);
    if (Math.abs(totalWeight - 100) > 0.1) {
       errs.scanner_weights_momentum = 'Sum must be 100%';
    }
    if (c.scanner_signal_depth < 1) errs.scanner_signal_depth = 'Min 1';

    setErrors(errs); return Object.keys(errs).length === 0;
  }, [testnetConfigured, liveConfigured]);

  const generatedPresetName = useMemo(() => {
    const i = cfg.scan_interval || 'Custom'; const r = cfg.risk_pct_per_trade ? `${cfg.risk_pct_per_trade}% risk` : '';
    const parts = [i, r].filter(Boolean); return parts.join(' · ') || 'New session preset';
  }, [cfg.scan_interval, cfg.risk_pct_per_trade])

  useEffect(() => {
    const loadPresets = async () => {
      try {
        console.log('[ConfigModal] Loading presets...');
        const res = await presetsAPI.list();
        if (res && res.data) {
          setPresets(res.data);
          console.log(`[ConfigModal] Loaded ${res.data.length} presets.`);
        } else {
          console.warn('[ConfigModal] No presets data returned from API.');
        }
      } catch (e) {
        console.error('[ConfigModal] Error loading presets:', e);
        if (addAlert) {
          addAlert({ level: 'error', title: 'Load Failed', message: 'Failed to load strategy presets. Check network connection.' });
        }
      }
    };
    loadPresets();
  }, [addAlert])

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
    setIsDirty(true);
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

  const handleToggleExitSignal = React.useCallback((baseKey, active) => {
    setIsDirty(true);
    setCfg(prev => {
      const next = { ...prev };
      const currentExitSignals = prev.exit_signals || [];

      if (active) {
        // Toggling OFF: remove base signal AND all its chained layers
        next.exit_signals = currentExitSignals.filter(sig => sig !== baseKey && !sig.startsWith(`${baseKey}_`));

        // Clean up delays, actions, and timeframes
        const nextDelays = { ...(prev.exit_signal_delays || {}) };
        const nextActions = { ...(prev.exit_signal_actions || {}) };
        const nextTimeframes = { ...(prev.signal_timeframes || {}) };

        delete nextDelays[baseKey];
        delete nextActions[baseKey];
        delete nextTimeframes[baseKey];

        Object.keys(nextDelays).forEach(k => {
          if (k.startsWith(`${baseKey}_`)) delete nextDelays[k];
        });
        Object.keys(nextActions).forEach(k => {
          if (k.startsWith(`${baseKey}_`)) delete nextActions[k];
        });
        Object.keys(nextTimeframes).forEach(k => {
          if (k.startsWith(`${baseKey}_`)) delete nextTimeframes[k];
        });

        next.exit_signal_delays = nextDelays;
        next.exit_signal_actions = nextActions;
        next.signal_timeframes = nextTimeframes;
      } else {
        // Toggling ON: add base signal
        next.exit_signals = [...currentExitSignals, baseKey];

        // Initialize base signal delay, action, timeframe
        next.exit_signal_delays = { ...(prev.exit_signal_delays || {}), [baseKey]: 0 };
        next.exit_signal_actions = { ...(prev.exit_signal_actions || {}), [baseKey]: 'close' };
        next.signal_timeframes = { ...(prev.signal_timeframes || {}), [baseKey]: 'default' };
      }
      return next;
    });
  }, []);

  const handleAddLayer = React.useCallback((baseKey) => {
    setIsDirty(true);
    setCfg(prev => {
      const currentExitSignals = prev.exit_signals || [];
      let suffixNum = 2;
      while (currentExitSignals.includes(`${baseKey}_${suffixNum}`)) {
        suffixNum++;
      }
      const newLayerKey = `${baseKey}_${suffixNum}`;

      return {
        ...prev,
        exit_signals: [...currentExitSignals, newLayerKey],
        exit_signal_delays: { ...(prev.exit_signal_delays || {}), [newLayerKey]: 0 },
        exit_signal_actions: { ...(prev.exit_signal_actions || {}), [newLayerKey]: 'close' },
        signal_timeframes: { ...(prev.signal_timeframes || {}), [newLayerKey]: 'default' }
      };
    });
  }, []);

  const handleRemoveLayer = React.useCallback((layerKey) => {
    setIsDirty(true);
    setCfg(prev => {
      const nextDelays = { ...(prev.exit_signal_delays || {}) };
      delete nextDelays[layerKey];

      const nextActions = { ...(prev.exit_signal_actions || {}) };
      delete nextActions[layerKey];

      const nextTimeframes = { ...(prev.signal_timeframes || {}) };
      delete nextTimeframes[layerKey];

      return {
        ...prev,
        exit_signals: (prev.exit_signals || []).filter(sig => sig !== layerKey),
        exit_signal_delays: nextDelays,
        exit_signal_actions: nextActions,
        signal_timeframes: nextTimeframes
      };
    });
  }, []);

  const handleUpdateLayer = React.useCallback((layerKey, field, value) => {
    setIsDirty(true);
    setCfg(prev => {
      const next = { ...prev };
      if (field === 'timeframe') {
        const nextTimeframes = { ...(prev.signal_timeframes || {}) };
        if (value === 'default') {
          delete nextTimeframes[layerKey];
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
    setIsDirty(true);
    setCfg(prev => {
      const next = { ...prev };
      const currentEntrySignals = prev.enabled_signals || [];

      if (active) {
        next.enabled_signals = currentEntrySignals.filter(sig => sig !== baseKey && !sig.startsWith(`${baseKey}_`));

        const nextTimeframes = { ...(prev.signal_timeframes || {}) };
        delete nextTimeframes[baseKey];
        Object.keys(nextTimeframes).forEach(k => {
          if (k.startsWith(`${baseKey}_`)) delete nextTimeframes[k];
        });

        next.signal_timeframes = nextTimeframes;
      } else {
        next.enabled_signals = [...currentEntrySignals, baseKey];
        next.signal_timeframes = { ...(prev.signal_timeframes || {}), [baseKey]: 'default' };
      }
      return next;
    });
  }, []);

  const handleAddEntryLayer = React.useCallback((baseKey) => {
    setIsDirty(true);
    setCfg(prev => {
      const currentEntrySignals = prev.enabled_signals || [];
      let suffixNum = 2;
      while (currentEntrySignals.includes(`${baseKey}_${suffixNum}`)) {
        suffixNum++;
      }
      const newLayerKey = `${baseKey}_${suffixNum}`;

      return {
        ...prev,
        enabled_signals: [...currentEntrySignals, newLayerKey],
        signal_timeframes: { ...(prev.signal_timeframes || {}), [newLayerKey]: 'default' }
      };
    });
  }, []);

  const handleRemoveEntryLayer = React.useCallback((layerKey) => {
    setIsDirty(true);
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
    setIsDirty(true);
    setCfg(prev => {
      const next = { ...prev };
      if (field === 'timeframe') {
        const nextTimeframes = { ...(prev.signal_timeframes || {}) };
        if (value === 'default') {
          delete nextTimeframes[layerKey];
        } else {
          nextTimeframes[layerKey] = value;
        }
        next.signal_timeframes = nextTimeframes;
      }
      return next;
    });
  }, []);
  
  const resetToLastSaved = React.useCallback(() => {
    sessionStorage.removeItem('config_draft');
    setCfg(flattenConfig(initialConfig));
    setIsDirty(false);
    setErrors({});
  }, [initialConfig]);
  
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
    const c = { ...cfg, strategy_label: (cfg.strategy_label || presetName || generatedPresetName || 'Momentum Strategy').trim() };

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
      'scan_pct_threshold', 'scan_lookback', 'scan_min_volume_usdt', 'watchlist_size',
      'watchlist_offset', 'sl_distance_pct', 'sl_min_pct', 'sl_max_pct', 'trailing_guard_buffer_pct',
      'tp_ratio', 'max_trades_per_period', 'trades_period_min', 'max_trades_24h',
      'scanner_signal_depth',
      'engulfing_lookback', 'engulfing_streak',
      'min_trade_interval_min', 'trades_jitter_pct', 'paper_starting_balance',
      'testnet_starting_balance', 'live_starting_balance', 'hot_loop_interval_ms',
      'main_loop_interval_ms', 'sl_lookback_period', 'sl_pct_limit',
      'max_open_trades_per_symbol', 'tod_min_winrate', 'leverage',
      'slippage_abort_threshold'
    ];

    numericFields.forEach(f => {
      if (c[f] !== undefined && c[f] !== null) {
        c[f] = Number(c[f]);
      }
    });

    c.scanner_weights = {
      momentum: Number(cfg.scanner_weights_momentum || 0) / 100,
      volatility: Number(cfg.scanner_weights_volatility || 0) / 100,
      trend: Number(cfg.scanner_weights_trend || 0) / 100
    };

    // Remove flattened UI fields after bundling into scanner_weights object
    delete c.scanner_weights_momentum;
    delete c.scanner_weights_volatility;
    delete c.scanner_weights_trend;

    if (c.hibernation_grace_period_sec !== undefined) {
      c.hibernation_grace_period_sec = Number(c.hibernation_grace_period_sec);
    }

    // UI Conversion: UI percentage back to backend decimal
    if (c.slippage_warning_threshold !== undefined) {
      c.slippage_warning_threshold = Number(c.slippage_warning_threshold) / 100;
    }
    c.strategy_variants = (cfg.strategy_variants || []).map((v) => {
      return coerceAndSanitizeConfig({ ...v, strategy_label: v.strategy_label || 'Variant' });
    });

    // Clean up temporary UI fields
    Object.keys(c).forEach(k => {
      if (k.startsWith('signal_params_') && k !== 'signal_params') {
        delete c[k];
      }
    });

    return c;
  }, [cfg, presetName, generatedPresetName]);

  const savePreset = React.useCallback(async (explicitName) => {
    // SRE name-resolution helper: cleanly resolves the preset name with strict precedence.
    // 1. explicitName: provided when user specifies a name in the Save dialog (e.g., Save As).
    // 2. presetName: the state field from the preset input box.
    // 3. loadedPresetName: the active preset if explicitName is not explicitly skipped (undefined).
    // 4. generatedPresetName: fallback auto-generated label based on scan interval & risk distance.
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
      let pc;
      try {
        pc = buildConfigToSave();
      } catch (buildErr) {
        console.error('[ConfigModal] Critical error building config:', buildErr);
        addAlert({ level: 'error', title: 'Internal Error', message: 'Failed to construct configuration object. Check console for details.' });
        setIsSaving(false);
        return;
      }

      console.log(`[ConfigModal] Sending save request to API for "${name}"...`);

      const res = await presetsAPI.save(name, { ...pc, strategy_label: name });

      if (res && res.data) {
        console.log(`[ConfigModal] Preset "${name}" saved successfully.`);
        setPresets(prev => {
          const nextPresets = [...prev.filter(p => p.name !== name), res.data];
          return nextPresets.sort((a, b) => a.name.localeCompare(b.name));
        });
        setPresetName('');
        setLoadedPresetName(name);
        sessionStorage.removeItem('config_draft');
        setIsDirty(false);
        setSaveSuccess(true);
        addAlert({ level: 'success', title: 'Preset Saved', message: `Strategy "${name}" has been stored in the database.` });
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (e) {
      console.error('[ConfigModal] Error saving preset:', e);

      let errMsg = 'Could not store strategy preset in the database.';
      if (e.response?.data?.detail && Array.isArray(e.response.data.detail)) {
        // Format class-validator errors for better readability
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
  }, [validate, cfg, presetName, loadedPresetName, generatedPresetName, buildConfigToSave, addAlert]);

  const loadPreset = React.useCallback((p) => {
    // Exclude saved strategy_variants and old paused states from the loaded preset config to avoid bringing along old/stale variants/states
    const cleanedConfig = {
      ...(p.config || {}),
      strategy_variants: []
    };
    delete cleanedConfig.paused;
    delete cleanedConfig.paused_strategies;

    const next = flattenConfig(cleanedConfig);
    setCfg(next);
    setLoadedPresetName(p.name);
    setPresetName(p.name);
    setPresetLoaded(true);
    validate(next);
    setIsDirty(false);
    addAlert({ level: 'success', title: 'Preset Loaded', message: `Active configuration set to "${p.name}".` });
  }, [validate, addAlert]);

  const deletePreset = React.useCallback(async (name) => {
    if (sessionActive) {
      addAlert({ level: 'error', title: 'Action Blocked', message: 'Cannot delete presets while a live session is active.' });
      return;
    }
    try {
      setIsDeleting(true);
      await presetsAPI.delete(name);
      setPresets(prev => prev.filter(p => p.name !== name));

      // Clear active preset/loaded references if the deleted preset was active/loaded
      if (loadedPresetName === name) {
        setLoadedPresetName(null);
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('loaded_preset_name');
        }
      }
      if (presetName === name) {
        setPresetName('');
      }

      // Automatically prune this configuration from active variants to prevent it from bleeding into new sessions
      setCfg(prev => {
        const variants = (prev.strategy_variants || []).filter(v => v.strategy_label !== name);
        return {
          ...prev,
          strategy_variants: variants
        };
      });

      addAlert({ level: 'info', title: 'Preset Deleted', message: `"${name}" has been removed from the database.` });
    } catch (e) {
      console.error('[ConfigModal] Error deleting preset:', e);
      addAlert({ level: 'error', title: 'Delete Failed', message: `Could not remove preset "${name}".` });
    } finally {
      setIsDeleting(false);
      setPresetToDelete(null);
    }
  }, [addAlert, loadedPresetName, presetName, setCfg, setLoadedPresetName, setPresetName, sessionActive]);

  const handleClearActiveConfig = React.useCallback(() => {
    let baseline;
    if (isEdit) {
      baseline = flattenConfig(initialConfig);
    } else {
      baseline = flattenConfig({
        paper_mode: true,
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
        discovery_mode: 'volume',
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
        sl_min_pct: 0.3,
        sl_max_pct: 3,
        trading_mode: 'paper',
        risk_pct_per_trade: CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT,
        max_open_trades: CONFIG_LIMITS.MAX_OPEN_TRADES_DEFAULT,
        max_trades_per_period: 10,
        trades_period_min: 60,
        max_trades_24h: CONFIG_LIMITS.MAX_TRADES_24H_DEFAULT,
        min_trade_interval_min: CONFIG_LIMITS.MIN_TRADE_INTERVAL_DEFAULT,
        trades_jitter_pct: CONFIG_LIMITS.TRADES_JITTER_DEFAULT
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

  const handleFileImport = React.useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const flattened = flattenConfig(parsed);
        setCfg(flattened);
        setIsDirty(true);
        validate(flattened);
        addAlert({ level: 'success', title: 'Import Successful', message: 'Configuration imported from file.' });
      } catch (err) {
        console.error('[ConfigModal] File import failed:', err);
        addAlert({ level: 'error', title: 'Import Failed', message: 'Invalid JSON configuration file.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [validate, addAlert]);

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
      setCfg(flattened);
      setIsDirty(true);
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
    e.stopPropagation()
    const variants = cfg.strategy_variants || []
    const exists = variants.some((v) => v.strategy_label === p.name)

    if (!exists && variants.length >= CONFIG_LIMITS.MAX_VARIANTS) {
      addAlert({
        level: 'warn',
        title: 'Limit Reached',
        message: `Maximum of ${CONFIG_LIMITS.MAX_VARIANTS} strategy variants allowed.`
      });
      return;
    }

    setField('strategy_variants', exists
      ? variants.filter((v) => v.strategy_label !== p.name)
      : [...variants, coerceAndSanitizeConfig({ ...p.config, strategy_label: p.name })])
  }, [cfg.strategy_variants, setField]);

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
    <div ref={modalRef} tabIndex={-1} className="flex flex-col h-full bg-surface text-text overflow-hidden relative outline-none">
      <div className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md border-b border-border">
        <div className="py-3 px-4 flex justify-between items-center">
          <div className="min-w-0 flex-1 mr-4">
             <div className="text-md font-black tracking-tight truncate uppercase flex items-center gap-2">
               {cfg.strategy_label || 'Configure Engine'}
               {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />}
             </div>
             <div className="text-[9px] text-dim font-bold uppercase tracking-widest flex items-center gap-1.5 truncate">
               {showResumingFeedback ? (
                 <span className="text-accent flex items-center gap-1 shrink-0">
                   <RefreshCw size={9} className="animate-spin" /> Resuming Feed...
                 </span>
               ) : isDirty ? (
                 <span className="text-accent flex items-center gap-1 shrink-0">
                   <Activity size={9} className="animate-pulse" /> Unsaved Changes
                 </span>
               ) : (
                 <span className="flex items-center gap-1 shrink-0">
                   <ShieldCheck size={9} className="text-green/60" /> Strategy Synced
                 </span>
               )}
               <span className="opacity-40">/</span>
               <span className="truncate">Orchestration Center</span>
             </div>
          </div>
          <Tooltip content="Close Configuration">
            <button type="button" onClick={onClose} aria-label="Close Configuration" className="p-1.5 hover:bg-white/5 rounded-full transition-colors shrink-0"><X size={16} className="text-dim" /></button>
          </Tooltip>
        </div>
        <SectionTabs section={section} onSectionChange={setSection} errors={errors} />
      </div>
      <ModalAlertTicker />

      <div className="flex-1 overflow-y-auto no-scrollbar p-3 md:p-4 pb-24 overscroll-contain" data-vaul-no-drag>
        {section === 'scan' && (
          <div
            id="config-panel-scan"
            role="tabpanel"
            aria-labelledby="config-tab-scan"
            className="space-y-3 animate-in fade-in duration-300"
          >
            <CollapsibleSection
              id="scan_general"
              icon={Settings2}
              title="General"
              subtitle="Basic strategy identification"
              isOpen={openSectionId === 'scan_general'}
              onToggle={() => setOpenSectionId(openSectionId === 'scan_general' ? null : 'scan_general')}
            >
              {renderField('Strategy label', 'strategy_label', 'text', null, { placeholder: 'Momentum Strategy' })}
            </CollapsibleSection>

            <CollapsibleSection
              id="scan_global"
              icon={Search}
              title="Global Scanner"
              subtitle="Automatic discovery settings"
              isOpen={openSectionId === 'scan_global'}
              onToggle={() => setOpenSectionId(openSectionId === 'scan_global' ? null : 'scan_global')}
            >
              <div className="p-4 bg-accent/5 border border-accent/20 rounded-2xl flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                    <Search size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-bold">Global Scanner</div>
                    <div className="text-[10px] text-dim font-medium uppercase">Automatic discovery</div>
                  </div>
                </div>
                <Toggle value={cfg.global_scanner_enabled !== false} onChange={(v) => setField('global_scanner_enabled', v)} />
              </div>

              <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6", cfg.global_scanner_enabled === false && "opacity-40 pointer-events-none")}>
                {renderField('Timeframe', 'scan_interval', 'text', ['1m', '5m', '15m', '1h', '4h', '1d'])}
                {renderField('% Threshold', 'scan_pct_threshold', 'number', null, { min: CONFIG_LIMITS.SCAN_PCT_THRESHOLD_MIN, step: 0.1 })}
                {renderField('Watchlist size', 'watchlist_size', 'number', null, { min: CONFIG_LIMITS.WATCHLIST_MIN, max: CONFIG_LIMITS.WATCHLIST_MAX })}
                {renderField('Watchlist Offset', 'watchlist_offset', 'number', null, { min: 0, max: 100 })}
                {renderField('Discovery Mode', 'discovery_mode', 'text', ['volume', 'change_pct'])}
                {renderField('Entry side', 'entry_side', 'text', ['both', 'long', 'short'])}
                <Tooltip content="Number of recent candles evaluated for price momentum percentage change. Shorter lookback captures immediate price velocity, while longer lookback filters short-term wicks.">
                  {renderField('Momentum Lookback', 'scan_lookback', 'number', null, { min: 1, max: 100 })}
                </Tooltip>
                <Tooltip content="CRITICAL FOR TARGET EXITS: Evaluates average candle range expansion over recent candles. A higher number of candles (e.g. recommended 48) is advised so volatility measurement is smooth and trades have sufficient price room to reach profit targets (TP/RR) and absorb spread/fees rather than stalling in consolidation.">
                  {renderField('Volatility Lookback', 'volatility_lookback', 'number', null, { min: 1, max: 100 })}
                </Tooltip>
                <Tooltip content="Number of recent candles evaluated for consecutive close-to-close directional consistency. Ensures momentum moves have solid trend confirmation instead of single-wick noise.">
                  {renderField('Trend Lookback', 'trend_lookback', 'number', null, { min: 2, max: 100 })}
                </Tooltip>
                <Tooltip content="The scanner will check signals for top candidates up to this depth. If top candidates fail signals, it moves to the next. Set higher for strict signal strategies to prevent stalling.">
                  {renderField('Signal Depth', 'scanner_signal_depth', 'number', null, { min: 1, max: 50 })}
                </Tooltip>

                <div className="md:col-span-2 mt-4 space-y-4">
                  <div className="p-4 bg-background/50 rounded-2xl border border-border/50 flex items-center justify-between group hover:border-accent/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent"><Zap size={20} /></div>
                      <div>
                        <div className="text-sm font-bold flex items-center gap-2">
                          Smart Watchlist
                          <Tooltip content="Event-driven discovery: Monitors the real-time !miniTicker stream to catch symbols with high momentum BEFORE they enter the top volume lists. Increases discovery range without extra API weight.">
                            <Info size={12} className="text-dim/60" />
                          </Tooltip>
                        </div>
                        <div className="text-[10px] text-dim font-medium uppercase tracking-tight">Event-driven discovery via !miniTicker</div>
                      </div>
                    </div>
                    <Toggle value={cfg.smart_watchlist_enabled === true} onChange={(v) => setField('smart_watchlist_enabled', v)} />
                  </div>

                  {cfg.smart_watchlist_enabled && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-5 bg-accent/5 rounded-2xl border border-accent/20 space-y-4 shadow-sm">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-accent mb-2">
                        <TrendingUp size={12} /> Predictive Discovery
                      </div>
                      {renderField('Discovery Sensitivity', 'smart_watchlist_sensitivity', 'number', null, { min: 0.1, max: 1.0, step: 0.1 })}
                      <p className="text-[9px] text-dim/60 italic leading-snug border-l-2 border-accent/20 pl-3">
                        Expands the candidate pool by identifying movers in the real-time mini-ticker stream before they enter the top volume lists. Lower values are more inclusive.
                      </p>
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

            <CollapsibleSection
              id="scan_watchlist"
              icon={Plus}
              title="Static Watchlist"
              subtitle="Rank only these symbols"
              isOpen={openSectionId === 'scan_watchlist'}
              onToggle={() => setOpenSectionId(openSectionId === 'scan_watchlist' ? null : 'scan_watchlist')}
            >
              <div className="space-y-4">
                <WatchlistDropdownInput value={cfg.symbols || []} onChange={(val) => setField('symbols', val)} />
                <div className="pt-4 border-t border-border/40">
                  <span className="text-[10px] font-black text-dim uppercase tracking-wider mb-2 block">Edit Comma-Separated List (Advanced)</span>
                  <ListInput placeholder="BTCUSDT, ETHUSDT, SOLUSDT..." value={cfg.symbols} onChange={(val) => setField('symbols', val)} />
                </div>
              </div>
            </CollapsibleSection>

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

            <section className="pt-6 border-t border-border/40">
               <div className="flex justify-between items-center mb-4">
                 <SectionHeader icon={ShieldCheck} title="Manual Monitors" subtitle="Specific symbols to track" />
                 {(cfg.single_symbol_configs || []).length > 0 && <button type="button" onClick={() => setField('single_symbol_configs', [])} className="text-[10px] font-black uppercase tracking-widest text-red/60 hover:text-red transition-colors flex items-center gap-1.5"><Trash2 size={12} /> Clear All</button>}
               </div>
               <ManualMonitorInput
                 onAdd={(val) => setField('single_symbol_configs', [...(cfg.single_symbol_configs || []), { symbol: val, enabled: true, follow_schedule: true }])}
               />
               <div className="flex flex-wrap gap-2 mt-4">
                 {(cfg.single_symbol_configs || []).length === 0 ? (
                   <p className="text-[10px] text-dim/40 font-bold uppercase tracking-widest p-4 border border-dashed border-border/40 rounded-xl w-full text-center">No symbols tracked manually</p>
                 ) : cfg.single_symbol_configs.map((sc, i) => (
                   <Chip key={i} active activeClass="bg-accent/10 border-accent/40 text-accent" aria-label={`Remove ${sc.symbol}`} onClick={() => setField('single_symbol_configs', cfg.single_symbol_configs.filter((_, idx) => idx !== i))}>{sc.symbol} <X size={10} className="inline ml-1" /></Chip>
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
            className="space-y-4 lg:space-y-6 animate-in fade-in duration-300"
          >
            <CollapsibleSection
              id="strategy_entry"
              icon={Zap}
              title="Entry Signals"
              subtitle="Triggers for opening positions"
              isOpen={openSectionId === 'strategy_entry'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_entry' ? null : 'strategy_entry')}
            >
              <div className="flex justify-end mb-4">
                <div className="flex bg-background p-1 rounded-lg border border-border shadow-inner">
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'any' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'any')}>ANY</button>
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'all' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'all')}>ALL</button>
                 </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SIGNALS.map((signal) => (
                  <EntrySignalCard
                    key={signal[0]}
                    signal={signal}
                    active={(cfg.enabled_signals || []).includes(signal[0])}
                    layers={(cfg.enabled_signals || []).filter(sig => sig === signal[0] || sig.startsWith(`${signal[0]}_`))}
                    timeframes={cfg.signal_timeframes || {}}
                    onToggle={handleToggleEntrySignal}
                    onAddLayer={handleAddEntryLayer}
                    onRemoveLayer={handleRemoveEntryLayer}
                    onUpdateLayer={handleUpdateEntryLayer}
                  />
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              id="strategy_params"
              icon={Activity}
              title="Signal Parameters"
              subtitle="Technical indicator periods"
              isOpen={openSectionId === 'strategy_params'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_params' ? null : 'strategy_params')}
            >
              <div className="space-y-6">
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
                    const schema = getSignalParamsSchema(sigKey, baseType);
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
                    <div className="space-y-6 text-left">
                      {/* Global fallback parameters */}
                      <div className="bg-background/20 p-4 rounded-2xl border border-border/50">
                        <div className="text-[9px] font-black text-dim uppercase tracking-[0.2em] mb-4">Global Parameters</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                          {globalSchema.map(field => {
                            const render = () => (
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
                                attrs={{ ...field.attrs, onFocus: handleInputFocus }}
                              />
                            );
                            if (field.tooltip) {
                              return (
                                <Tooltip key={field.key} content={field.tooltip}>
                                  <div>{render()}</div>
                                </Tooltip>
                              );
                            }
                            return render();
                          })}
                        </div>
                      </div>

                      {/* Active signal-specific dynamic parameter cards */}
                      {cards.map(card => {
                        const isBooleanOnly = card.schema.every(s => s.type === 'boolean');
                        return (
                          <div key={card.key} className={cn(
                            "p-4 rounded-2xl border transition-all space-y-4 animate-in fade-in slide-in-from-top-2 duration-300",
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
                                const renderInput = () => {
                                  if (field.type === 'boolean') {
                                    return (
                                      <div className="flex flex-col gap-1.5 justify-center h-full min-h-[44px]">
                                        <div className="flex justify-between items-center">
                                          <label className="text-[10px] text-dim font-black tracking-widest uppercase">{field.label}</label>
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
                                      label={field.label}
                                      id={`config-${field.key}`}
                                      name={field.key}
                                      type={field.type}
                                      value={cfg[field.key] !== undefined ? cfg[field.key] : field.defaultValue}
                                      onChange={setField}
                                      error={errors[field.key]}
                                      warning={errors[`${field.key}_warn`]}
                                      opts={field.opts}
                                      attrs={{ ...field.attrs, onFocus: handleInputFocus }}
                                    />
                                  );
                                };

                                const tooltipText = TOOLTIPS[field.baseParamKey];
                                if (tooltipText) {
                                  return (
                                    <Tooltip key={field.key} content={tooltipText}>
                                      <div>{renderInput()}</div>
                                    </Tooltip>
                                  );
                                }

                                return <React.Fragment key={field.key}>{renderInput()}</React.Fragment>;
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {(cfg.enabled_signals || []).includes('ema_dual_close') && (
                <div className="mt-8 p-5 bg-accent/5 border border-accent/20 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-500 shadow-[0_4px_24px_rgba(var(--accent-rgb),0.04)]">
                   <div className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-[0.15em] text-accent">
                      <div className="p-1.5 bg-accent/10 rounded-lg">
                        <Zap size={14} className="fill-accent/20" />
                      </div>
                      EMA Dual Close Logic
                   </div>
                   <div className="space-y-2.5">
                      <p className="text-[11px] text-dim leading-relaxed font-medium">
                         An authoritative trend-following strategy that requires absolute alignment across two time horizons.
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                         <div className="p-3 bg-background/40 border border-border/30 rounded-xl">
                            <div className="text-[9px] font-black text-green uppercase tracking-wider mb-1">Long Entry</div>
                            <div className="text-[10px] font-mono text-text/80">Price {'>'} Fast EMA<br/>Price {'>'} Slow EMA</div>
                         </div>
                         <div className="p-3 bg-background/40 border border-border/30 rounded-xl">
                            <div className="text-[9px] font-black text-red uppercase tracking-wider mb-1">Short Entry</div>
                            <div className="text-[10px] font-mono text-text/80">Price {'<'} Fast EMA<br/>Price {'<'} Slow EMA</div>
                         </div>
                      </div>
                      <p className="text-[10px] text-dim/60 italic leading-snug border-l-2 border-accent/20 pl-3">
                         The engine interprets this as a "one-way door": if the price crosses back through <span className="text-text font-bold">either</span> EMA, the trend is considered broken and the position is closed.
                      </p>
                   </div>
                </div>
              )}

              {lifetimeAnalytics?.rrOptimization?.recommendedExitSignals && lifetimeAnalytics.rrOptimization.recommendedExitSignals.length > 0 && (
                <div className="mt-8 p-5 bg-background/20 border border-border/50 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-accent">
                    <Target size={14} className="text-accent" />
                    Optimal Exit Parameters (Statistical Recommendation)
                  </div>
                  <p className="text-[11px] text-dim leading-relaxed font-medium">
                    Based on your actual history of <span className="text-text font-bold">{lifetimeAnalytics.rrOptimization.sampleSize}</span> closed trades, the statistical model recommends the following optimized parameter settings:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {lifetimeAnalytics.rrOptimization.recommendedExitSignals.map((rec) => (
                      <div key={rec.signalType} className="p-3 bg-surface/30 border border-border/40 rounded-xl flex flex-col gap-1.5 hover:border-accent/20 transition-all relative group/rec">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-text font-black uppercase tracking-wider">{rec.signalType.replace(/_/g, ' ')}</span>
                          <span className="text-[8px] text-dim font-black uppercase bg-accent/5 border border-accent/20 px-1.5 py-0.5 rounded">Conf: {rec.confidence}%</span>
                        </div>
                        <div className="flex items-baseline gap-1.5 mt-0.5">
                          <span className="text-xs font-bold text-accent font-mono">{rec.recommendedValue}</span>
                          <span className="text-[8.5px] text-dim font-medium uppercase font-mono">({rec.parameterName})</span>
                        </div>
                        <p className="text-[8.5px] text-dim/70 leading-normal font-medium">{rec.reasoning}</p>
                        <button
                          type="button"
                          onClick={() => {
                            if (rec.signalType === 'ema_close') {
                              setField('signal_params_exit_ema_period', rec.recommendedValue);
                              addAlert({ level: 'success', title: 'Applied EMA Period', message: `Set exit EMA period to ${rec.recommendedValue}.` });
                            } else if (rec.signalType === 'ema_dual_close') {
                              const [fast, slow] = rec.recommendedValue.split(' / ').map(Number);
                              setField('signal_params_exit_ema_fast', fast);
                              setField('signal_params_exit_ema_slow', slow);
                              addAlert({ level: 'success', title: 'Applied Dual EMAs', message: `Set exit fast/slow EMAs to ${fast}/${slow}.` });
                            } else if (rec.signalType === 'supertrend') {
                              const [period, mult] = rec.recommendedValue.split(' / ').map(Number);
                              setField('signal_params_supertrend_period', period);
                              setField('signal_params_supertrend_multiplier', mult);
                              addAlert({ level: 'success', title: 'Applied Supertrend', message: `Set ATR Period/Multiplier to ${period}/${mult}.` });
                            } else if (rec.signalType === 'macd_fade') {
                              const [fast, slow, signal] = rec.recommendedValue.split(' / ').map(Number);
                              setField('signal_params_macd_fast', fast);
                              setField('signal_params_macd_slow', slow);
                              setField('signal_params_macd_signal', signal);
                              addAlert({ level: 'success', title: 'Applied MACD Parameters', message: `Set MACD to ${fast}/${slow}/${signal}.` });
                            }
                          }}
                          className="absolute bottom-2 right-2 opacity-0 group-hover/rec:opacity-100 transition-opacity bg-accent text-white px-2 py-1 rounded text-[8px] font-black uppercase tracking-wider hover:bg-accent/80 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                        >
                          Apply
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              id="strategy_exit"
              icon={XCircle}
              title="Exit Signals"
              subtitle="Automated early closures"
              isOpen={openSectionId === 'strategy_exit'}
              onToggle={() => setOpenSectionId(openSectionId === 'strategy_exit' ? null : 'strategy_exit')}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 mb-4 bg-surface/40 border border-border/30 rounded-xl hover:border-accent/15 transition-all">
                <div className="flex flex-col text-left">
                  <span className="text-[10px] font-black text-dim uppercase tracking-widest">Exit Logic Override</span>
                  <p className="text-[9px] text-dim/75 font-semibold uppercase mt-0.5 max-w-md">Bypass ratcheting/trailing, immediately cancel SL, and drop exit signal delays to 0 when trade profit exceeds exit targets.</p>
                </div>
                <Toggle
                  value={cfg.exit_signals_override_ratchet || false}
                  onChange={(v) => setField('exit_signals_override_ratchet', v)}
                />
              </div>
              <div className="flex justify-end mb-4">
                 <div className="flex bg-background p-1 rounded-lg border border-border shadow-inner">
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.exit_signal_logic || 'any') === 'any' ? "bg-red text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('exit_signal_logic', 'any')}>ANY</button>
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", cfg.exit_signal_logic === 'all' ? "bg-red text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('exit_signal_logic', 'all')}>ALL</button>
                 </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SIGNALS.map((signal) => (
                  <ExitSignalCard
                    key={signal[0]}
                    signal={signal}
                    active={(cfg.exit_signals || []).includes(signal[0])}
                    layers={(cfg.exit_signals || []).filter(sig => sig === signal[0] || sig.startsWith(`${signal[0]}_`))}
                    delays={cfg.exit_signal_delays || {}}
                    actions={cfg.exit_signal_actions || {}}
                    timeframes={cfg.signal_timeframes || {}}
                    onToggle={handleToggleExitSignal}
                    onAddLayer={handleAddLayer}
                    onRemoveLayer={handleRemoveLayer}
                    onUpdateLayer={handleUpdateLayer}
                    engulfingMode={cfg.engulfing_mode}
                  />
                ))}
              </div>
            </CollapsibleSection>

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
                    <div className="flex flex-col items-center justify-center p-6 text-center border border-dashed border-border rounded-2xl bg-surface/30">
                      <Clock className="text-dim mb-2 opacity-50" size={20} />
                      <span className="text-[10px] text-dim font-bold uppercase tracking-wider">No Active Signals</span>
                      <p className="text-[9px] text-dim/80 mt-1 max-w-xs">
                        Enable Entry or Exit signals above to configure custom timeframe overrides for them.
                      </p>
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
                                  delete updated[signalKey];
                                } else {
                                  updated[signalKey] = val;
                                }
                                setField('signal_timeframes', updated);
                              }}
                              className="bg-background border border-border rounded-lg pl-3 pr-8 py-1 text-[11px] font-bold text-text focus:border-accent outline-none appearance-none cursor-pointer transition-all hover:border-border-hover h-8 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
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
          </div>
        )}

        {section === 'risk' && (
          <div
            id="config-panel-risk"
            role="tabpanel"
            aria-labelledby="config-tab-risk"
            className="space-y-4 lg:space-y-6 animate-in fade-in duration-300"
          >
            <CollapsibleSection
              id="risk_guards"
              icon={ShieldCheck}
              title="Capital Guards"
              subtitle="Global safety limits"
              isOpen={openSectionId === 'risk_guards'}
              onToggle={() => setOpenSectionId(openSectionId === 'risk_guards' ? null : 'risk_guards')}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {renderField('Risk % Per Trade', 'risk_pct_per_trade', 'number', null, { min: CONFIG_LIMITS.RISK_PER_TRADE_MIN, max: CONFIG_LIMITS.RISK_PER_TRADE_MAX, step: 0.1 })}
                {renderField('Max Total Risk %', 'max_total_risk_pct', 'number', null, { min: CONFIG_LIMITS.MAX_TOTAL_RISK_MIN, max: CONFIG_LIMITS.MAX_TOTAL_RISK_MAX })}
                {renderField('Max Open Trades', 'max_open_trades', 'number', null, { min: CONFIG_LIMITS.MAX_OPEN_TRADES_MIN })}
                {renderField('SL Guard (USDT)', 'total_sl_guard_usdt', 'number', null, { min: 0 })}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 my-4 bg-surface/40 border border-border/30 rounded-xl hover:border-accent/15 transition-all">
                <div className="flex flex-col text-left">
                  <span className="text-[10px] font-black text-dim uppercase tracking-widest">Est. P&L Risk Release</span>
                  <p className="text-[9px] text-dim/75 font-semibold uppercase mt-0.5 max-w-md">Release risk lock (risk_usdt = 0) when active estimated P&L reaches or exceeds breakeven, even before physical SL ratchets.</p>
                </div>
                <Toggle
                  value={cfg.release_risk_on_est_pnl_be || false}
                  onChange={(v) => setField('release_risk_on_est_pnl_be', v)}
                />
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
                  "p-4 border rounded-2xl flex flex-col justify-center gap-1",
                  cfg.auto_scale_min_notional !== false && (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) < 5.05
                    ? "bg-amber/5 border-amber/20 shadow-[0_0_20px_rgba(245,166,35,0.05)]"
                    : "bg-background/40 border-border/40"
                )}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-dim uppercase font-bold tracking-widest">Min Notional Guard</span>
                      <div className="w-1 h-1 rounded-full bg-dim/30" />
                      <span className="text-[8px] text-accent font-bold uppercase tracking-tight">$5.05 Floor</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Toggle value={cfg.auto_scale_min_notional !== false} onChange={(v) => setField('auto_scale_min_notional', v)} color="bg-accent" />
                      <Tooltip content="Binance Futures requires a minimum position size of 5 USDT. When enabled, the engine automatically scales UP small positions to $5.05 to avoid exchange rejections.">
                        <Activity size={10} className="text-dim cursor-help" />
                      </Tooltip>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 mt-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className={cn(
                        "text-sm font-bold font-mono transition-colors",
                        cfg.auto_scale_min_notional !== false && (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) < 5.05 ? "text-amber" : "text-text"
                      )}>
                        {fmtUSD(cfg.auto_scale_min_notional !== false ? Math.max(5.05, riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) : (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)))}
                        <span className="text-[9px] ml-1.5 opacity-40 font-medium uppercase tracking-tight">Execution</span>
                      </span>
                      {(cfg.auto_scale_min_notional !== false && (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) < 5.05) && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-amber text-black font-black rounded-sm uppercase animate-pulse">Auto-Scaled</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 border-l border-border/50 pl-2 py-0.5">
                      <p className="text-[8px] text-dim/60 font-mono leading-tight">
                        Math: {fmtUSD(riskAmount)} Target Risk / {Number(cfg.sl_distance_pct || 0.8).toFixed(1)}% SL = {fmtUSD(riskAmount / ((cfg.sl_distance_pct || 0.8) / 100))} Notional
                      </p>
                      <p className="text-[7px] text-dim/40 font-bold uppercase tracking-tighter">
                        Exchange Rule: $5.00 (Min) + $0.05 (Buffer) = $5.05 Requirement
                      </p>
                      <p className="text-[7px] font-black text-accent uppercase tracking-widest mt-0.5">
                        Status: {cfg.auto_scale_min_notional === false ? "❌ Scaling disabled, risk of rejection" : (riskAmount / ((cfg.sl_distance_pct || 0.8) / 100)) < 5.05 ? "⚠️ Scaling up to meet exchange minimum" : "✅ Threshold met, using precise sizing"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className={cn(
                  "p-4 border rounded-2xl flex flex-col justify-center gap-1",
                  cfg.auto_scale_min_notional === false && cfg.risk_hardening_enabled
                    ? "bg-red/5 border-red/20 shadow-[0_0_20px_rgba(239,68,68,0.05)]"
                    : "bg-background/40 border-border/40",
                  cfg.auto_scale_min_notional !== false && "opacity-40 grayscale grayscale-[50%]"
                )}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-dim uppercase font-bold tracking-widest">Risk Hardening</span>
                      <div className="w-1 h-1 rounded-full bg-dim/30" />
                      <span className="text-[8px] text-red font-bold uppercase tracking-tight">Small Account Guard</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Toggle
                        value={cfg.risk_hardening_enabled === true}
                        onChange={(v) => setField('risk_hardening_enabled', v)}
                        color="bg-red"
                      />
                      <Tooltip content="When Auto-Scaling is DISABLED, risk hardening protects small accounts from entering positions where the exchange's $5.00 minimum forces risk to exceed a safe percentage of your balance.">
                        <ShieldCheck size={10} className="text-dim cursor-help" />
                      </Tooltip>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 mt-1">
                    <div className={cn(cfg.risk_hardening_enabled ? "block" : "hidden")}>
                      {renderField('Max Single Trade Risk (%)', 'max_single_trade_risk_pct', 'number', null, { min: 0.1, max: 100, step: 0.5 })}
                    </div>
                    <p className="text-[8px] text-dim/60 italic leading-tight">
                      {cfg.auto_scale_min_notional !== false
                        ? "Only available when Auto-Scale is OFF."
                        : cfg.risk_hardening_enabled
                        ? `Trades will be REJECTED if they force > ${cfg.max_single_trade_risk_pct}% account risk.`
                        : "Account at risk of oversized exposure on small balances."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-4 bg-surface/50 border border-border/40 rounded-xl space-y-3">
                 <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-accent">
                    <Target size={12} /> Sizing Guide
                 </div>
                 <div className="space-y-2">
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
              </div>

              {cfg.tp_mode === 'exp_rr_seq' && (
                <div className="space-y-2 mt-6 bg-background/50 p-5 rounded-2xl border border-border/40 shadow-inner">
                  <div className="flex justify-between text-[10px] text-dim font-bold uppercase tracking-widest mb-3 px-1">
                    <span>RR Milestone (Target)</span>
                    <span>Adjust SL to (R)</span>
                  </div>
                  {sequence.map(([live, exit], i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="relative flex-1">
                        <input type="number" step="0.1" value={live} onChange={(e) => {
                          const next = [...(Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [1.0, 2.0, 4.0])];
                          next[i] = Number(e.target.value);
                          setField('live_rr_sequence', next);
                        }} onBlur={handleSortMilestones} className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs font-mono text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none pr-7" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim/40">R</span>
                      </div>
                      <ArrowRight size={14} className="text-dim/20 shrink-0" />
                      <div className="relative flex-1">
                        <input type="number" step="0.1" value={exit} onChange={(e) => {
                          const next = [...(Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [0.0, 1.0, 2.0])];
                          next[i] = Number(e.target.value);
                          setField('exit_rr_sequence', next);
                        }} onBlur={handleSortMilestones} className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs font-mono text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none pr-7" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim/40">R</span>
                      </div>
                      <Tooltip content="Remove Milestone">
                        <button type="button" onClick={() => {
                          const nextL = [...(cfg.live_rr_sequence || [])];
                          const nextE = [...(cfg.exit_rr_sequence || [])];
                          nextL.splice(i, 1);
                          nextE.splice(i, 1);
                          setCfg(prev => ({ ...prev, live_rr_sequence: nextL, exit_rr_sequence: nextE }));
                        }} aria-label="Remove Milestone" className="p-2 text-dim hover:text-red transition-colors rounded-lg hover:bg-red/5"><Trash2 size={16} /></button>
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
                  }} className="w-full py-3 border border-dashed border-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all mt-2 group flex items-center justify-center gap-2"><Plus size={14} className="group-hover:scale-110 transition-transform" /> Add RR Milestone</button>
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              id="risk_sl"
              icon={ShieldCheck}
              title="Stop Loss Strategy"
              subtitle="Risk truncation parameters"
              isOpen={openSectionId === 'risk_sl'}
              onToggle={() => setOpenSectionId(openSectionId === 'risk_sl' ? null : 'risk_sl')}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {renderField('Strategy Type', 'sl_type', 'text', [
                  { value: 'pct', label: 'Fixed Percentage' },
                  { value: 'lookback_low/high', label: 'High/Low Stop' },
                  { value: 'streak_extreme', label: 'Streak Extreme' },
                  { value: 'supertrend', label: 'Supertrend Line' }
                ])}
                {renderField('Out of Bounds', 'sl_out_of_bounds_action', 'text', [
                  { value: 'clamp', label: 'Clamp to Limits' },
                  { value: 'reject', label: 'Reject Entry' }
                ])}
                {cfg.sl_type === 'pct' ? (
                  renderField('Distance %', 'sl_distance_pct', 'number', null, { min: CONFIG_LIMITS.SL_DISTANCE_MIN, max: CONFIG_LIMITS.SL_DISTANCE_MAX, step: 0.1 })
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {renderField('Lookback Period', 'sl_lookback_period', 'number', null, { min: 1 })}
                    {renderField('Lookback TF', 'sl_lookback_timeframe', 'text', ['1m', '5m', '15m', '1h', '4h', '1d'])}
                  </div>
                )}
                {cfg.sl_type !== 'pct' && renderField('Max Allowed SL %', 'sl_pct_limit', 'number', null, { min: 0.1, step: 0.1 })}
                <div className="grid grid-cols-2 gap-4">
                  {renderField('Floor Min %', 'sl_min_pct', 'number', null, { min: 0.1, step: 0.1 })}
                  {renderField('Ceiling Max %', 'sl_max_pct', 'number', null, { min: 0.1, step: 0.1 })}
                </div>
                <div className="md:col-span-2">
                  <Tooltip content="Safety buffer that prevents trailing stops from being placed too close to the market price. This avoids 'Order would immediately trigger' errors and instant fills during high volatility. Recommended: 0.03% to 0.05%.">
                    {renderField('Trailing Guard (%)', 'trailing_guard_buffer_pct', 'number', null, { min: CONFIG_LIMITS.TRAILING_GUARD_MIN, max: CONFIG_LIMITS.TRAILING_GUARD_MAX, step: 0.01 })}
                  </Tooltip>
                </div>
              </div>

              <div className="mt-6 p-5 bg-accent/5 border border-accent/20 rounded-2xl space-y-3.5 shadow-sm">
                 <div className="flex items-center gap-2.5 text-[10px] font-black uppercase tracking-[0.15em] text-accent">
                    <div className="p-1.5 bg-accent/10 rounded-lg group">
                      <ShieldCheck size={14} className="fill-accent/20 group-hover:animate-pulse" />
                    </div>
                    Trailing Safety Guide
                 </div>
                 <div className="space-y-3">
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
                          <div className="space-y-1">
                             <div className="text-[8px] text-dim/40 font-bold uppercase tracking-tighter text-dim/60">Current Market</div>
                             <div className="text-xs font-mono font-bold text-text/90">0.14302</div>
                          </div>
                          <div className="space-y-1 text-right">
                             <div className="text-[8px] text-dim/40 font-bold uppercase tracking-tighter text-dim/60">Engine Response</div>
                             <div className="text-xs font-mono font-bold text-amber">0.14305</div>
                          </div>
                       </div>
                    </div>
                    <p className="text-[10px] text-dim/60 italic leading-snug border-l-2 border-accent/20 pl-3">
                       Essential for SHORT trades near entry and high-volatility LONG trades. Prevents "instant fills" caused by the market spread touching your stop exactly at the moment of update.
                    </p>
                 </div>
              </div>
            </CollapsibleSection>

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
                  { value: 'exp_rr_seq', label: 'Dynamic RR Milestone' }
                ])}
                {cfg.tp_mode === 'fixed' ? renderField('Fixed Ratio (R)', 'tp_ratio', 'number', null, { min: 0.1, step: 0.1 }) : <div />}
              </div>

              <OptimizationPanel analytics={lifetimeAnalytics} cfg={cfg} setField={setField} type="rr" />

              <div className="mt-8 pt-6 border-t border-border/40 space-y-6">
                 <div className="p-4 bg-background/50 rounded-2xl border border-border/50 flex items-center justify-between group hover:border-accent/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent"><Activity size={20} /></div>
                      <div>
                        <div className="text-sm font-bold">Dynamic Trailing Stop</div>
                        <div className="text-[10px] text-dim font-medium uppercase tracking-tight">Active price chasing to protect unrealized PnL</div>
                      </div>
                    </div>
                    <Toggle value={cfg.trailing_stop_enabled === true} onChange={(v) => setField('trailing_stop_enabled', v)} />
                 </div>

                 {cfg.trailing_stop_enabled && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {renderField('Trailing Distance (%)', 'trailing_stop_distance_pct', 'number', null, { min: 0.1, max: 10, step: 0.1 })}
                       </div>
                       <OptimizationPanel analytics={lifetimeAnalytics} cfg={cfg} setField={setField} type="trailing" />
                    </motion.div>
                 )}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              id="risk_temporal"
              icon={Clock}
              title="Frequency & Temporal Risk"
              subtitle="Execution windows & frequency shaping"
              isOpen={openSectionId === 'risk_temporal'}
              onToggle={() => setOpenSectionId(openSectionId === 'risk_temporal' ? null : 'risk_temporal')}
            >

              <div className="space-y-4 mb-8">
                <div className="p-4 bg-background/50 rounded-2xl border border-border/50 flex items-center justify-between group hover:border-accent/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent"><Activity size={20} /></div>
                    <div>
                      <div className="text-sm font-bold">Frequency Shaping</div>
                      <div className="text-[10px] text-dim font-medium uppercase tracking-tight">Control trade distribution and rolling limits</div>
                    </div>
                  </div>
                  <Toggle value={cfg.frequency_shaping_enabled === true} onChange={(v) => setField('frequency_shaping_enabled', v)} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 p-5 bg-surface/30 rounded-2xl border border-border/40 mb-6">
                  {renderField('Period Limit', 'max_trades_per_period', 'number', null, { min: 0 })}
                  {renderField('Period (min)', 'trades_period_min', 'number', null, { min: 1 })}
                  {renderField('Max 24h', 'max_trades_24h', 'number', null, { min: 0 })}
                </div>

                {cfg.frequency_shaping_enabled && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 p-5 bg-surface/30 rounded-2xl border border-border/40 mb-6">
                    <div className="grid grid-cols-2 md:grid-cols-2 gap-6">
                      {renderField('Min Interval (m)', 'min_trade_interval_min', 'number', null, { min: 0 })}
                      {renderField('Window Jitter (%)', 'trades_jitter_pct', 'number', null, { min: 0, max: 100 })}
                    </div>
                    <div className={cn("flex items-center justify-between pt-4 border-t border-border/40 transition-opacity duration-300", cfg.trades_jitter_pct <= 0 && "opacity-40 pointer-events-none")}>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                          <Target size={12} className="text-accent" /> Market-Aware Jitter
                        </span>
                        <span className="text-[9px] text-dim font-medium uppercase tracking-tight">Prioritize high-quality signals with less random delay</span>
                      </div>
                      <Toggle value={cfg.trades_jitter_market_aware === true} onChange={(v) => setField('trades_jitter_market_aware', v)} color="bg-accent" />
                    </div>
                  </motion.div>
                )}

                <div className="p-4 bg-background/50 rounded-2xl border border-border/50 flex items-center justify-between group hover:border-accent/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent"><LayoutGrid size={20} /></div>
                    <div>
                      <div className="text-sm font-bold">Time-of-Day Guard</div>
                      <div className="text-[10px] text-dim font-medium uppercase tracking-tight">Adaptive risk management based on hour stats</div>
                    </div>
                  </div>
                  <Toggle value={cfg.risk_use_tod_stats === true} onChange={(v) => setField('risk_use_tod_stats', v)} />
                </div>

                {cfg.risk_use_tod_stats && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-5 bg-surface/30 rounded-2xl border border-border/40 space-y-4">
                    {renderField('Minimum Required TOD Winrate %', 'tod_min_winrate', 'number', null, { min: 0, max: 100 })}

                    {cfg.frequency_shaping_enabled && (
                      <div className="flex items-center justify-between pt-4 border-t border-border/40">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold">Integrated Frequency Guard</span>
                          <span className="text-[10px] text-dim font-medium uppercase">Adaptive spacing when winrate is low</span>
                        </div>
                        <Toggle value={cfg.frequency_tod_integration === true} onChange={(v) => setField('frequency_tod_integration', v)} color="bg-amber" />
                      </div>
                    )}
                  </motion.div>
                )}

                <div className="grid grid-cols-2 gap-6 pt-4">
                  {renderField('Max Per Sym', 'max_open_trades_per_symbol', 'number', null, { min: 1 })}
                </div>
              </div>

              <div className="space-y-3">
                 <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex items-center gap-2 px-1"><Clock size={12} /> Daily Execution Windows (UTC)</div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   {(cfg.trading_windows || []).map((w, i) => (
                     <div key={i} className="flex gap-2 p-3 bg-surface/50 border border-border rounded-xl items-center shadow-sm">
                       <input type="text" value={w.start} onChange={(e) => { const wins = [...(cfg.trading_windows || [])]; wins[i].start = e.target.value; setField('trading_windows', wins); }} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-center focus:border-accent outline-none" />
                       <span className="text-dim/40 font-mono text-[10px]">to</span>
                       <input type="text" value={w.end} onChange={(e) => { const wins = [...(cfg.trading_windows || [])]; wins[i].end = e.target.value; setField('trading_windows', wins); }} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-center focus:border-accent outline-none" />
                       <Tooltip content="Remove Window">
                        <button type="button" onClick={() => setField('trading_windows', cfg.trading_windows.filter((_, idx) => idx !== i))} aria-label="Remove Window" className="p-2 text-dim hover:text-red transition-colors"><Trash2 size={16} /></button>
                       </Tooltip>
                     </div>
                   ))}
                   <button type="button" onClick={() => setField('trading_windows', [...(cfg.trading_windows || []), { start: '09:00', end: '17:00' }])} className="w-full py-3 border border-dashed border-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all flex items-center justify-center gap-2"><Plus size={14} /> Add Window</button>
                 </div>
               </div>
            </CollapsibleSection>
          </div>
        )}

        {section === 'env' && (
          <div
            id="config-panel-env"
            role="tabpanel"
            aria-labelledby="config-tab-env"
            className="space-y-4 lg:space-y-6 animate-in fade-in duration-300"
          >
            <CollapsibleSection
              id="adv_env"
              icon={Briefcase}
              title="Execution Environment"
              subtitle="Target exchange and mode"
              isOpen={openSectionId === 'adv_env'}
              onToggle={() => setOpenSectionId(openSectionId === 'adv_env' ? null : 'adv_env')}
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {['paper', 'testnet', 'live'].map(m => (
                  <EnvironmentButton
                    key={m}
                    mode={m}
                    isSelected={cfg.trading_mode === m || (m === 'paper' && cfg.paper_mode && !cfg.trading_mode)}
                    onClick={handleModeSelect}
                  />
                ))}
              </div>
              {modeWarning && (
                <div className="mt-4 p-3 bg-orange/10 border border-orange/30 rounded-lg flex items-start gap-3 animate-in slide-in-from-top">
                  <XCircle size={16} className="text-orange mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-orange">{modeWarning}</div>
                </div>
              )}
            </CollapsibleSection>

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
          </div>
        )}


        {section === 'presets' && (
          <div
            id="config-panel-presets"
            role="tabpanel"
            aria-labelledby="config-tab-presets"
            className="space-y-6 lg:space-y-8 animate-in fade-in duration-300"
          >
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <SectionHeader icon={Save} title="Save Strategy" subtitle="Store current configuration as a preset" />
                <SavePresetInput defaultName={loadedPresetName} onSave={(name) => { savePreset(name); }} isSaving={isSaving} success={saveSuccess} />
              </div>
              <div className="space-y-4">
                <SectionHeader icon={RefreshCw} title="Transfer Config" subtitle="Portable strategy definitions" />
                <div className="grid grid-cols-2 gap-3">
                  <Btn variant="ghost" onClick={handleExportToFile} className="flex items-center justify-center gap-2 py-3 border-border hover:bg-accent/5 hover:border-accent/40">
                    <Download size={16} /> Export JSON
                  </Btn>
                  <label className="relative focus-within:ring-2 focus-within:ring-accent focus-within:outline-none rounded-xl block">
                    <input type="file" accept=".json" aria-label="Import JSON config file" onChange={handleFileImport} className="absolute inset-0 opacity-0 cursor-pointer z-10 outline-none" />
                    <div className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-border bg-transparent text-xs font-bold transition-all hover:bg-accent/5 hover:border-accent/40 cursor-pointer">
                      <Upload size={16} /> Import JSON
                    </div>
                  </label>
                </div>
              </div>
              <div className="space-y-4">
                <SectionHeader icon={XCircle} title="Reset Slate" subtitle={isEdit ? "Restore original session configuration" : "Prune active custom configurations"} />
                <Btn
                  variant="ghost"
                  onClick={handleClearActiveConfig}
                  className="w-full flex items-center justify-center gap-2 border-red/20 text-dim hover:text-red hover:bg-red/5 hover:border-red/40 py-3 text-xs font-bold"
                  aria-label={isEdit ? "Reset to initial configuration" : "Clear Active Configuration"}
                >
                  <RefreshCw size={14} className="text-red/80 animate-spin-hover" /> {isEdit ? "Reset to Saved State" : "Clear Active Config"}
                </Btn>
              </div>
            </section>

            {/* Premium, glassmorphic UI/UX notice describing clean slate state management */}
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-accent/[0.02] border border-border/60 text-xs text-dim shadow-sm backdrop-blur-sm select-none animate-in fade-in duration-300">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Info size={14} />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-text/90 flex items-center gap-1.5 leading-none">
                  Intuitive Preset State Management
                </h4>
                <p className="leading-relaxed text-dim/90 font-medium">
                  To ensure a completely clean slate and prevent configuration pollution, any active loaded preset name and temporary drafts are automatically cleared from memory when a session is closed. Starting a new session will always begin with a fresh configuration.
                </p>
              </div>
            </div>

            <section className="pt-6 border-t border-border/40 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex justify-between items-center w-full sm:w-auto">
                  <SectionHeader icon={FolderOpen} title="Manage Presets" subtitle="Load or combine strategies" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 sm:w-64 group">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/50 group-focus-within:text-accent transition-colors" />
                    <input
                      ref={presetSearchInputRef}
                      type="text"
                      placeholder="Search preset by name..."
                      value={presetSearch}
                      onChange={(e) => setPresetSearch(e.target.value)}
                      className="w-full bg-surface border border-border rounded-xl pl-9 pr-10 py-2 text-xs focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none hover:border-border-hover transition-colors"
                    />
                    {presetSearch ? (
                      <Tooltip content="Clear Preset Search">
                        <button
                          type="button"
                          onClick={() => {
                            setPresetSearch('');
                            presetSearchInputRef.current?.focus();
                          }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dim hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md p-0.5 transition-colors"
                          aria-label="Clear Preset Search"
                        >
                          <X size={12} />
                        </button>
                      </Tooltip>
                    ) : (
                      <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 bg-surface/50 border border-border/80 text-[9px] font-black text-accent/80 shadow-sm font-mono px-1.5 py-0.5 rounded pointer-events-none select-none transition-opacity duration-200 group-focus-within:opacity-0">
                        /
                      </kbd>
                    )}
                  </div>
                  <div className="text-[9px] text-dim font-black uppercase bg-background px-2.5 py-1.5 rounded-lg border border-border shrink-0">
                    {cfg.strategy_variants?.length || 0} / {CONFIG_LIMITS.MAX_VARIANTS} Variants
                  </div>
                </div>
              </div>

              {presets.length === 0 ? (
                <div className="p-12 border-2 border-dashed border-border rounded-2xl text-center">
                  <FolderOpen size={32} className="mx-auto mb-4 text-dim/20" />
                  <div className="text-xs font-bold text-dim uppercase">No saved presets</div>
                </div>
              ) : partitionedPresets.active.length === 0 && partitionedPresets.available.length === 0 ? (
                <div className="p-10 border border-dashed border-border rounded-2xl text-center space-y-3">
                  <Search size={28} className="mx-auto text-dim/30" />
                  <div className="text-xs font-bold text-dim uppercase">No matching presets found</div>
                  <Btn variant="ghost" onClick={() => setPresetSearch('')} className="text-accent hover:bg-accent/5 py-1 px-3 text-[10px] uppercase font-black tracking-widest">
                    Clear Filter
                  </Btn>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Active Orchestration Section */}
                  {partitionedPresets.active.length > 0 && (
                    <div className="space-y-2.5 animate-in fade-in duration-300">
                      <div className="flex items-center gap-2 px-1 text-[9px] font-black uppercase tracking-widest text-accent">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        Active Strategy & Enabled Variants
                      </div>
                      <motion.div layout className="space-y-2.5">
                        <AnimatePresence mode="popLayout">
                          {partitionedPresets.active.map(p => (
                            <PresetItem
                              key={p.name}
                              preset={p}
                              isLoaded={loadedPresetName === p.name}
                              isDirty={isDirty}
                              onLoad={loadPreset}
                              onToggleVariant={toggleVariant}
                              onDelete={(e, name) => { e.stopPropagation(); setPresetToDelete(name); }}
                              isVariant={(cfg.strategy_variants || []).some(v => v.strategy_label === p.name)}
                              sessionActive={sessionActive}
                            />
                          ))}
                        </AnimatePresence>
                      </motion.div>
                    </div>
                  )}

                  {/* Preset Library Section */}
                  {partitionedPresets.available.length > 0 && (() => {
                    const isLibraryOpen = libraryExpanded || !!presetSearch;
                    return (
                      <div className="space-y-2.5">
                        <button
                          type="button"
                          onClick={() => setLibraryExpanded(!libraryExpanded)}
                          className="flex items-center justify-between w-full px-1 text-[9px] font-black uppercase tracking-widest text-dim hover:text-text transition-colors group/lib-btn focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded py-1"
                          aria-expanded={isLibraryOpen}
                          aria-controls="presets-library-content"
                        >
                          <span className="flex items-center gap-1.5">
                            Preset Library ({partitionedPresets.available.length})
                          </span>
                          <div className={cn(
                            "w-4 h-4 rounded border border-border/60 flex items-center justify-center text-dim group-hover/lib-btn:text-text transition-all",
                            isLibraryOpen && "rotate-180 text-accent border-accent/30"
                          )}>
                            <ChevronDown size={10} />
                          </div>
                        </button>

                        <AnimatePresence initial={false}>
                          {isLibraryOpen && (
                            <motion.div
                              id="presets-library-content"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              className="overflow-hidden"
                            >
                              <motion.div layout className="space-y-2.5 pt-1">
                                <AnimatePresence mode="popLayout">
                                  {partitionedPresets.available.map(p => (
                                    <PresetItem
                                      key={p.name}
                                      preset={p}
                                      isLoaded={loadedPresetName === p.name}
                                      isDirty={isDirty}
                                      onLoad={loadPreset}
                                      onToggleVariant={toggleVariant}
                                      onDelete={(e, name) => { e.stopPropagation(); setPresetToDelete(name); }}
                                      isVariant={(cfg.strategy_variants || []).some(v => v.strategy_label === p.name)}
                                      sessionActive={sessionActive}
                                    />
                                  ))}
                                </AnimatePresence>
                              </motion.div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })()}
                </div>
              )}

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
            </section>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border bg-surface flex flex-col sm:flex-row gap-3 sticky bottom-0 items-stretch sm:items-center">
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
           <Btn variant="ghost" onClick={onClose} className="flex-1 sm:flex-initial min-w-[70px] h-9 py-1.5 px-3 text-xs">Cancel</Btn>
           {isDirty && <Btn variant="ghost" onClick={resetToLastSaved} className="text-red hover:bg-red/5 flex-1 sm:flex-initial h-9 py-1.5 px-3 text-xs">Reset</Btn>}
           <div className="flex gap-1.5 items-center">
             <Tooltip content="Copy Configuration to Clipboard">
               <CopyButton
                  getValue={() => JSON.stringify(buildConfigToSave(), null, 2)}
                  className="w-9 h-9 flex items-center justify-center border border-border rounded-lg hover:bg-white/5 transition-all"
               />
             </Tooltip>
             <Tooltip content="Paste Configuration from Clipboard">
                <Btn
                  variant="ghost"
                  onClick={handlePasteConfig}
                  aria-label="Paste Configuration from Clipboard"
                  className="w-9 h-9 p-0 flex items-center justify-center border border-border rounded-lg hover:bg-accent/5 hover:border-accent/40 transition-all"
                >
                  <ClipboardPaste size={14} className="text-dim group-hover:text-accent" />
                </Btn>
             </Tooltip>
           </div>
        </div>
        <Btn variant="primary" loading={loading} onClick={() => {
          if (validate(cfg)) {
             onSave({ ...buildConfigToSave(), _presetLoaded: presetLoaded });
             sessionStorage.removeItem('config_draft');
             setIsDirty(false);
          }
        }} className="w-full sm:w-auto sm:flex-[1.5] h-9 py-1.5 px-4 flex items-center justify-center gap-2 text-xs">
          {isEdit ? 'Apply Changes' : 'Start Session'}
          {isDirty && <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />}
        </Btn>
      </div>

      <AnimatePresence>
        {showPasteOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-lg bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden p-5 space-y-4"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                    <ClipboardPaste size={16} />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-black uppercase tracking-tight">Paste Configuration</h3>
                    <p className="text-[9px] text-dim font-medium uppercase">Direct clipboard fallback editor</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowPasteOverlay(false); setPasteValue(''); setPasteError(null); }}
                  className="p-1 hover:bg-white/5 rounded-full transition-colors"
                >
                  <X size={16} className="text-dim" />
                </button>
              </div>

              <div className="space-y-2 text-left">
                <p className="text-xs text-dim leading-relaxed">
                  Paste your strategy configuration JSON below. The engine will instantly parse, validate, and hot-reload your active fields.
                </p>
                <div className="relative">
                  <textarea
                    value={pasteValue}
                    onChange={(e) => handlePasteAreaChange(e.target.value)}
                    placeholder='{ "strategy_label": "Scalp Momentum", ... }'
                    className={cn(
                      "w-full h-48 bg-background border rounded-xl p-3 text-xs font-mono focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all resize-none",
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
                      setCfg(flattened);
                      setIsDirty(true);
                      validate(flattened);
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
  if (!analytics?.rrOptimization) return null;
  const opt = analytics.rrOptimization;
  const sampleSize = opt.sampleSize || 0;
  const needed = Math.max(0, 20 - sampleSize);
  const isOptimal = opt.status === 'OPTIMAL';

  if (type === 'rr') {
    return (
      <div className="mt-4 p-4 bg-accent/5 border border-accent/20 rounded-2xl space-y-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
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
     return (
       <div className="mt-4 p-4 bg-purple/5 border border-purple/20 rounded-2xl space-y-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-purple-400">
              <Activity size={12} /> Volatility Recommendation
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
             <div className="flex flex-col">
                <span className="text-[8px] text-dim font-black uppercase tracking-widest mb-0.5">Statistical Distance</span>
                <span className="text-lg font-black font-mono tracking-tighter text-text leading-none">{opt.recommendedTrailingDistance.toFixed(2)}%</span>
             </div>
             <Btn
               variant="ghost"
               onClick={() => setField('trailing_stop_distance_pct', opt.recommendedTrailingDistance)}
               className="px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest bg-purple/10 text-purple-400 border-purple/20 hover:bg-purple/20"
             >
               Use Recommended
             </Btn>
          </div>
          <p className="text-[8px] text-dim/60 italic leading-snug border-l-2 border-purple/20 pl-3">
             Based on historical Maximum Adverse Excursion (MAE). Designed to survive normal volatility while locking gains.
          </p>
       </div>
     );
  }

  return null;
};
