import React, { useState, useEffect, useMemo, memo, useRef } from 'react'
import { 
  ShieldCheck, Clock, ArrowUpRight, ArrowDownRight, Activity, Zap, 
  Info, ShieldAlert, CheckCircle2, BarChart3, TrendingUp, XCircle, Loader2, Trash2, ArrowRight,
  Edit3, Sliders, Plus, Trash
} from 'lucide-react'
import { fmtUSD, pnlColor, pnlClass, fmt } from '../../lib/theme'
import { useTradingStore } from '../../store/trading'
import { price, formatDuration, calculateProximity } from '../../lib/formatters'
import { StatCard, SectionLabel, cn, CopyButton, Tooltip, PulseDot, Btn } from '../ui/primitives'
import { SignalGauge } from '../ui/SignalGauge'
import { motion, AnimatePresence } from 'framer-motion'
import { ConfirmationModal } from '../ConfirmationModal'

const FRIENDLY_SIGNAL_NAMES = {
  ema_close: 'EMA Close',
  ema_dual_close: 'EMA Dual Close',
  macd_fade: 'MACD Fade',
  macd_impulse: 'MACD Impulse',
  macd_pbc: 'MACD PBC',
  supertrend: 'Supertrend',
  momentum_pct: 'Momentum %',
  breakout_hl: 'Breakout High/Low',
  engulfing: 'Engulfing Candle',
  ma: 'Moving Average',
  ema: 'Exponential MA',
  ema_cross: 'EMA Cross',
  ema_price_cross: 'EMA Price Cross',
};

const Metric = memo(({ label, value }) => (
  <div className="flex flex-col gap-1.5 group/metric">
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-black text-dim uppercase tracking-[0.2em]">{label}</span>
    </div>
    <span className="font-mono text-sm font-bold text-text/90">{value}</span>
  </div>
))
Metric.displayName = 'Metric'

const RRLadder = memo(({ trade, interactiveEnabled }) => {
  const triggers = trade.live_rr_sequence || []
  const exits = trade.exit_rr_sequence || []
  const maxRR = trade.max_rr || 0
  const liveRR = trade.rr || 0
  const risk = Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price))
  const activeIdx = triggers.reduce((idx, trigger, i) => maxRR >= trigger ? i : idx, -1)

  const updateActiveTradeConfig = useTradingStore(state => state.updateActiveTradeConfig);
  const [editingMilestone, setEditingMilestone] = useState(null); // { idx, type: 'trigger' | 'exit' }
  const [tempValue, setTempValue] = useState('');

  const handleSaveMilestoneTrigger = async (idx, val) => {
    const num = Number(val);
    if (isNaN(num) || num <= 0) return;

    const currentTriggers = [...triggers];
    currentTriggers[idx] = num;

    // Check strict ascending order constraint
    for (let i = 1; i < currentTriggers.length; i++) {
      if (currentTriggers[i] <= currentTriggers[i - 1]) {
        useTradingStore.getState().addAlert({
          level: 'error',
          title: 'Invalid Order',
          message: 'Guard Ladder triggers must be in strictly ascending order.'
        });
        return;
      }
    }

    const payload = {
      live_rr_sequence: currentTriggers
    };

    const success = await updateActiveTradeConfig(trade.id || trade.symbol, payload);
    if (success) {
      setEditingMilestone(null);
    }
  };

  const handleSaveMilestoneExit = async (idx, val) => {
    const num = Number(val);
    if (isNaN(num) || num < 0) return;

    const currentExits = [...exits];
    currentExits[idx] = num;

    const payload = {
      exit_rr_sequence: currentExits
    };

    const success = await updateActiveTradeConfig(trade.id || trade.symbol, payload);
    if (success) {
      setEditingMilestone(null);
    }
  };

  // Use authoritative current_sl if available, otherwise fall back to ladder recompute
  const currentSl = trade.sl_price || (activeIdx >= 0 ?
    (trade.direction === 'LONG' ? trade.entry_price + risk * exits[activeIdx] : trade.entry_price - risk * exits[activeIdx]) :
    (trade.initial_sl || trade.sl_price))

  const getEstPnl = (price) => {
    if (!price || !trade.entry_price || !trade.qty) return 0
    return (price - trade.entry_price) * trade.qty * (trade.direction === 'LONG' ? 1 : -1)
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-3 md:p-5 shadow-sm">
      <div className="flex justify-between items-center mb-3 md:mb-5">
         <SectionLabel className="mb-0">
             <Zap size={14} className="text-accent" fill="currentColor" /> Guard Ladder
          </SectionLabel>
      </div>

      <div className="relative flex items-center justify-between gap-2 overflow-x-auto no-scrollbar mb-4 md:mb-8 pb-3 pt-2 w-full">
        {/* Continuous background connector timeline */}
        <div className="absolute left-[30px] right-[30px] top-[43px] h-1 bg-border/40 rounded-full z-0 pointer-events-none" />

        {/* Dynamic colored progress fill based on activeIdx / triggers count */}
        <div
          className="absolute left-[30px] top-[43px] h-1 bg-gradient-to-r from-green to-accent rounded-full z-0 pointer-events-none transition-all duration-500"
          style={{
            width: triggers.length > 1
              ? `calc(${(Math.max(0, activeIdx) / (triggers.length - 1)) * 100}% - ${(Math.max(0, activeIdx) / (triggers.length - 1)) * 12}px)`
              : '0%'
          }}
        />

        {(triggers || []).map((trigger, i) => {
          const done = maxRR >= trigger
          const current = i === activeIdx
          return (
            <div key={`${trigger}-${i}`} className="flex flex-col items-center flex-1 min-w-[70px] z-10 relative">
              {/* Trigger Name / RR target (Inline Editable) */}
              {editingMilestone?.idx === i && editingMilestone?.type === 'trigger' ? (
                <div className="flex items-center gap-1 mb-2 bg-background/80 px-1 py-0.5 rounded border border-border/80">
                  <input
                    type="number"
                    step="any"
                    value={tempValue}
                    onChange={(e) => setTempValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveMilestoneTrigger(i, tempValue);
                      if (e.key === 'Escape') setEditingMilestone(null);
                    }}
                    className="w-10 bg-transparent text-center font-mono text-[9px] font-bold outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                    autoFocus
                  />
                  <button onClick={() => handleSaveMilestoneTrigger(i, tempValue)} className="text-green"><CheckCircle2 size={10} /></button>
                </div>
              ) : (
                <div
                  onClick={() => {
                    if (!interactiveEnabled) return;
                    setEditingMilestone({ idx: i, type: 'trigger' });
                    setTempValue(String(trigger));
                  }}
                  className={cn(
                    "text-[10px] md:text-xs font-black tracking-tighter mb-2 text-center transition-all duration-300 border-b border-dashed border-transparent flex items-center gap-1 group/trig",
                    interactiveEnabled
                      ? "cursor-pointer hover:border-accent hover:text-accent"
                      : "cursor-not-allowed opacity-90",
                    current ? "text-accent scale-110" : done ? "text-green" : "text-dim"
                  )}
                  title={interactiveEnabled ? "Click to edit Trigger R" : "Trigger R (Read-Only)"}
                >
                  {trigger}R
                  {interactiveEnabled && <Edit3 size={8} className="opacity-0 group-hover/trig:opacity-100 transition-opacity text-accent" />}
                </div>
              )}

              {/* Stepper Node Bubble */}
              <div className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all duration-500 shadow-md",
                current
                  ? "bg-surface border-accent text-accent scale-125 ring-4 ring-accent/15"
                  : done
                  ? "bg-green border-green text-surface"
                  : "bg-surface border-border text-dim/60"
              )}>
                {done && !current ? (
                  <CheckCircle2 size={10} className="text-surface fill-current" />
                ) : (
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    current ? "bg-accent animate-ping" : "bg-current"
                  )} />
                )}
              </div>

              {/* secured stop representation (Inline Editable) */}
              {editingMilestone?.idx === i && editingMilestone?.type === 'exit' ? (
                <div className="flex items-center gap-1 mt-2.5 bg-background/80 px-1 py-0.5 rounded border border-border/80">
                  <input
                    type="number"
                    step="any"
                    value={tempValue}
                    onChange={(e) => setTempValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveMilestoneExit(i, tempValue);
                      if (e.key === 'Escape') setEditingMilestone(null);
                    }}
                    className="w-10 bg-transparent text-center font-mono text-[9px] font-bold outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                    autoFocus
                  />
                  <button onClick={() => handleSaveMilestoneExit(i, tempValue)} className="text-green"><CheckCircle2 size={10} /></button>
                </div>
              ) : (
                <div
                  onClick={() => {
                    if (!interactiveEnabled) return;
                    setEditingMilestone({ idx: i, type: 'exit' });
                    setTempValue(String(exits[i] ?? 0));
                  }}
                  className={cn(
                    "text-[9px] md:text-[10px] font-bold mt-2.5 uppercase tracking-widest text-center flex flex-col leading-tight transition-all duration-300 border-b border-dashed border-transparent group/ex",
                    interactiveEnabled
                      ? "cursor-pointer hover:border-accent hover:text-accent"
                      : "cursor-not-allowed opacity-95",
                    done ? "text-text font-black" : "text-dim/60"
                  )}
                  title={interactiveEnabled ? "Click to edit Secured Stop R" : "Secured Stop R (Read-Only)"}
                >
                  <span className="flex items-center gap-1 justify-center">
                    SL {exits[i] === 0 ? 'BE' : `${exits[i]}R`}
                    {interactiveEnabled && <Edit3 size={8} className="opacity-0 group-hover/ex:opacity-100 transition-opacity text-accent" />}
                  </span>
                  <span className={cn("text-[8px] font-mono", done ? pnlClass(getEstPnl(trade.direction === 'LONG' ? trade.entry_price + risk * exits[i] : trade.entry_price - risk * exits[i])) : "opacity-30")}>
                    {fmtUSD(getEstPnl(trade.direction === 'LONG' ? trade.entry_price + risk * exits[i] : trade.entry_price - risk * exits[i]))}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

const getBaseSignalType = (key) => {
  const signalHandlers = [
    'momentum_pct', 'breakout_hl', 'engulfing', 'ma', 'ema', 'ema_cross',
    'ema_price_cross', 'ema_dual_cross', 'ema_close', 'ema_dual_close',
    'macd_impulse', 'macd_fade', 'macd_pbc', 'supertrend'
  ];
  if (signalHandlers.includes(key)) return key;
  const lastUnderscore = key.lastIndexOf('_');
  if (lastUnderscore > 0) {
    const potentialBase = key.substring(0, lastUnderscore);
    if (signalHandlers.includes(potentialBase)) {
      return potentialBase;
    }
  }
  return key;
};

const resolveSignalParam = (params, signalType, baseSignalType, paramKey, defaultValue) => {
  if (!params) return defaultValue;

  if (signalType === baseSignalType) {
    return params[paramKey] !== undefined ? params[paramKey] : defaultValue;
  }

  const suffix = signalType.substring(baseSignalType.length); // e.g. "_2"

  const suffixedKey = `${paramKey}${suffix}`;
  if (params[suffixedKey] !== undefined) {
    return params[suffixedKey];
  }

  if (paramKey.startsWith(baseSignalType)) {
    const replacedKey = signalType + paramKey.substring(baseSignalType.length);
    if (params[replacedKey] !== undefined) {
      return params[replacedKey];
    }
  }

  return params[paramKey] !== undefined ? params[paramKey] : defaultValue;
};

const getParamStoreKey = (sigKey, baseType, baseParamKey) => {
  if (sigKey === baseType) return baseParamKey;
  const suffix = sigKey.substring(baseType.length); // e.g. '_2'
  if (baseParamKey.startsWith(baseType)) {
    return sigKey + baseParamKey.substring(baseType.length);
  } else {
    return `${baseParamKey}${suffix}`;
  }
};

const getSignalInfo = (key, config) => {
  const base = getBaseSignalType(key);
  let tf = config?.signal_timeframes?.[key] || config?.scan_interval || config?.interval || '1m';
  if (tf === 'default') {
    tf = config?.scan_interval || config?.interval || '1m';
  }
  const params = [];
  const sp = config?.signal_params || {};

  const resolve = (pKey, def) => resolveSignalParam(sp, key, base, pKey, def);

  switch (base) {
    case 'macd_fade':
    case 'macd_impulse':
    case 'macd_pbc': {
      const fast = resolve('macd_fast', 12);
      const slow = resolve('macd_slow', 26);
      const sig = resolve('macd_signal', 9);
      params.push({ label: 'Fast', value: fast, key: 'macd_fast', type: 'number' });
      params.push({ label: 'Slow', value: slow, key: 'macd_slow', type: 'number' });
      params.push({ label: 'Signal', value: sig, key: 'macd_signal', type: 'number' });
      if (base === 'macd_pbc') {
        const trendEma = resolve('macd_pbc_trend_ema', 50);
        const lb = resolve('macd_pbc_lookback', 10);
        params.push({ label: 'Trend EMA', value: trendEma, key: 'macd_pbc_trend_ema', type: 'number' });
        params.push({ label: 'Lookback', value: lb, key: 'macd_pbc_lookback', type: 'number' });
      } else if (base === 'macd_impulse') {
        const strict = resolve('macd_strict_expansion', true);
        params.push({ label: 'Strict', value: strict ? 'Yes' : 'No', rawValue: strict, key: 'macd_strict_expansion', type: 'boolean' });
      }
      break;
    }
    case 'supertrend': {
      const period = resolve('supertrend_period', 10);
      const mult = resolve('supertrend_multiplier', 3);
      const mode = resolve('supertrend_mode', 'trend');
      params.push({ label: 'Period', value: period, key: 'supertrend_period', type: 'number' });
      params.push({ label: 'Mult', value: mult, key: 'supertrend_multiplier', type: 'number' });
      params.push({
        label: 'Mode',
        value: mode === 'trend' ? 'Trend State' : 'Crossover',
        rawValue: mode,
        key: 'supertrend_mode',
        type: 'select',
        options: [
          { value: 'trend', label: 'Trend State' },
          { value: 'crossover', label: 'Crossover Trigger' }
        ]
      });
      break;
    }
    case 'engulfing': {
      const lookback = resolve('engulfing_lookback', config?.engulfing_lookback ?? 1);
      const streak = resolve('engulfing_streak', config?.engulfing_streak ?? 1);
      const mode = resolve('engulfing_mode', config?.engulfing_mode ?? 'range');
      const volConfirm = resolve('engulfing_volume_confirm', config?.engulfing_volume_confirm ?? false);
      params.push({ label: 'Lookback', value: lookback, key: 'engulfing_lookback', type: 'number' });
      params.push({ label: 'Streak', value: streak, key: 'engulfing_streak', type: 'number' });
      params.push({
        label: 'Mode',
        value: mode,
        key: 'engulfing_mode',
        type: 'select',
        options: [
          { value: 'range', label: 'Range (H/L)' },
          { value: 'body', label: 'Body (O/C)' },
          { value: 'strict', label: 'Strict (Both)' },
          { value: 'close_range', label: 'Close > H/L (Closed)' },
          { value: 'close_body', label: 'Close > Body (Closed)' },
          { value: 'soft_range', label: 'Partial Range (Close > H/L)' },
          { value: 'soft_body', label: 'Partial Body (Close > Body)' }
        ]
      });
      params.push({ label: 'Vol Conf', value: volConfirm ? 'Yes' : 'No', rawValue: volConfirm, key: 'engulfing_volume_confirm', type: 'boolean' });
      break;
    }
    case 'ema':
    case 'ema_cross':
    case 'ema_price_cross':
    case 'ema_close': {
      const period = resolve('exit_ema_period', resolve('ema_period', 12));
      params.push({ label: 'Period', value: period, key: 'exit_ema_period', type: 'number' });
      break;
    }
    case 'ema_dual_cross':
    case 'ema_dual_close': {
      const fast = resolve('exit_ema_fast', resolve('entry_ema_fast', 9));
      const slow = resolve('exit_ema_slow', resolve('entry_ema_slow', 21));
      params.push({ label: 'Fast', value: fast, key: 'exit_ema_fast', type: 'number' });
      params.push({ label: 'Slow', value: slow, key: 'exit_ema_slow', type: 'number' });
      break;
    }
    case 'ma': {
      const period = resolve('ma_period', 20);
      params.push({ label: 'Period', value: period, key: 'ma_period', type: 'number' });
      break;
    }
    case 'momentum_pct': {
      const threshold = resolve('scan_pct_threshold', config?.scan_pct_threshold ?? 2.0);
      const lookback = resolve('scan_lookback', config?.scan_lookback ?? 3);
      params.push({ label: 'Threshold', value: `${threshold}%`, rawValue: threshold, key: 'scan_pct_threshold', type: 'number' });
      params.push({ label: 'Lookback', value: lookback, key: 'scan_lookback', type: 'number' });
      break;
    }
    case 'breakout_hl': {
      const lookback = resolve('scan_lookback', config?.scan_lookback ?? 3);
      params.push({ label: 'Lookback', value: lookback, key: 'scan_lookback', type: 'number' });
      break;
    }
    default:
      break;
  }

  return { timeframe: tf, params };
};

const ExitMonitor = memo(({ status, logic, trade, interactiveEnabled, setInteractiveEnabled }) => {
  const [editingDelay, setEditingDelay] = useState(null) // key being edited
  const [tempDelay, setTempDelay] = useState('')
  const [editingParam, setEditingParam] = useState(null) // { sigKey, storeKey }
  const [tempParamVal, setTempParamVal] = useState('')
  const updateActiveTradeConfig = useTradingStore(state => state.updateActiveTradeConfig);
  
  // Sort entries by proximity (triggerProgress descending)
  const entries = useMemo(() => {
    if (!status) return [];
    return Object.entries(status).map(([key, s]) => {
      const progress = s.distPct ?? 0;
      return [key, { ...s, progress }];
    }).sort((a, b) => b[1].progress - a[1].progress);
  }, [status]);
  
  // These hooks must be called unconditionally
  const handleUpdateDelay = async (key, val) => {
    let newDelay;
    if (typeof val === 'string' && /^\d+c$/.test(val)) {
      newDelay = val;
    } else {
      const parsed = Number(val);
      if (isNaN(parsed) || parsed < 0) return;
      newDelay = parsed;
    }
    
    const currentDelays = trade.strategy_config?.exit_signal_delays || {};
    const payload = {
      strategy_config: {
        exit_signal_delays: { ...currentDelays, [key]: newDelay }
      }
    };
    await updateActiveTradeConfig(trade.id || trade.symbol, payload);
    setEditingDelay(null);
    setTempDelay('');
  };

  const handleUpdateParam = async (sigKey, baseParamKey, val) => {
    const baseType = getBaseSignalType(sigKey);
    const storeKey = getParamStoreKey(sigKey, baseType, baseParamKey);

    let nextVal;
    if (val === 'true' || val === 'false') {
      nextVal = val === 'true';
    } else {
      const num = Number(val);
      nextVal = isNaN(num) || val === '' ? val : num;
    }

    const currentParams = trade.strategy_config?.signal_params || {};
    const payload = {
      strategy_config: {
        signal_params: { ...currentParams, [storeKey]: nextVal }
      }
    };

    try {
      await updateActiveTradeConfig(trade.id || trade.symbol, payload);
    } catch (e) {
      console.error(e);
    }
    setEditingParam(null);
    setTempParamVal('');
  };

  if (!status || Object.keys(status).length === 0) return null;
  const mark = Number(trade.current_price || trade.mark_price || 0)
  const isLong = trade.direction === 'LONG'
  const entryPrice = Number(trade.entry_price || 0)
  const qty = Number(trade.qty || 0)
  const riskUsdt = Number(trade.initial_risk_usdt || trade.risk_usdt || Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price)) * trade.qty || 0)

  const satisfiedCount = entries.filter(([_, s]) => s.fired && s.active).length
  const totalCount = entries.length
  const allFired = satisfiedCount === totalCount
  const criteriaMet = logic === 'all' ? allFired : satisfiedCount > 0;

  return (
    <div className="bg-surface border border-border rounded-2xl p-3 md:p-5 shadow-sm flex flex-col">
      <div className="flex items-center justify-between mb-2 md:mb-5">
        <div className="flex flex-col gap-0.5">
          <SectionLabel className={cn("mb-0 flex items-center gap-1.5", criteriaMet ? "text-red" : satisfiedCount > 0 ? "text-amber" : "text-dim")}>
            {criteriaMet ? <Zap size={11} className="fill-red" /> : satisfiedCount > 0 ? <Activity size={11} /> : <ShieldCheck size={11} />}
            <span className="md:inline hidden">{criteriaMet ? 'Ready to Exit' : satisfiedCount > 0 ? 'Risk Building' : 'Watching'}</span>
            <span className="md:hidden inline">{criteriaMet ? 'EXIT' : satisfiedCount > 0 ? 'RISK' : 'WAIT'}</span>
          </SectionLabel>
          <div className="text-[7px] md:text-[8px] text-dim font-bold uppercase tracking-widest opacity-60">
            {logic === 'all' ? 'Match All' : 'Match Any'}
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4 flex-wrap justify-end">
           {/* Interactive Mode Toggle switch */}
           <div className="flex items-center gap-1.5 bg-background/40 border border-border/30 rounded-xl px-2 py-0.5 h-6">
             <span className="text-[7px] md:text-[8px] font-black text-dim uppercase tracking-wider select-none">Interactive Editing:</span>
             <button
               type="button"
               onClick={() => setInteractiveEnabled(!interactiveEnabled)}
               className={cn(
                 "relative inline-flex h-3.5 w-6 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                 interactiveEnabled ? "bg-accent" : "bg-surface-light border-border/40"
               )}
               aria-pressed={interactiveEnabled}
               aria-label="Toggle Interactive Editing Mode"
             >
               <span
                 className={cn(
                   "pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                   interactiveEnabled ? "translate-x-2.5" : "translate-x-0"
                 )}
               />
             </button>
           </div>

           <div className="flex items-center gap-2">
             <div className="flex -space-x-1">
                {entries.map(([key, s]) => (
                   <div key={key} className={cn(
                     "w-2 h-2 md:w-3 md:h-3 rounded-full border border-surface transition-all duration-500",
                     s.fired && s.active ? "bg-green shadow-lg shadow-green/20" : "bg-dim/20"
                   )} />
                ))}
             </div>
             <span className={cn("text-[9px] md:text-[10px] font-black uppercase tracking-tighter", satisfiedCount > 0 ? (allFired ? "text-red" : "text-amber") : "text-dim")}>
                {satisfiedCount}/{totalCount}
             </span>
           </div>
        </div>
      </div>

      <div className="space-y-1.5 md:space-y-4 flex-1">
        {entries.map(([key, s]) => {
          const isFired = s.fired && s.active
          const threshold = Number(s.threshold) || 0

          // Estimated PnL at trigger
          const estPnl = s.threshold_is_price
            ? (threshold - entryPrice) * qty * (isLong ? 1 : -1)
            : null;
          const estRr = (estPnl !== null && riskUsdt > 0) ? (estPnl / riskUsdt) : null;

          const { timeframe, params } = getSignalInfo(key, trade.strategy_config);

          return (
            <div key={key} className="space-y-1 md:space-y-3 p-2 bg-white/[0.01] border border-white/[0.02] rounded-xl hover:bg-white/[0.02] hover:border-white/[0.05] transition-all">
              <div className="flex justify-between items-center text-[9px] md:text-[10px] font-black uppercase tracking-widest">
                <div className="flex items-center gap-1.5 md:gap-2">
                  <span className={isFired ? "text-red" : s.fired ? "text-amber" : "text-dim"}>{s.label || key}</span>
                  <span className="text-[8px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                    {timeframe}
                  </span>
                  {s.insufficientData ? (
                    <span className="text-dim bg-background/50 border border-border/40 px-1 rounded flex items-center gap-1 scale-90 md:scale-100">
                      Collecting
                    </span>
                  ) : s.remaining_delay > 0 && !isFired && (
                    <div className={cn(
                      "flex items-center gap-1 bg-amber/10 text-amber px-1 rounded transition-colors",
                      interactiveEnabled ? "cursor-pointer hover:bg-amber/20" : "cursor-not-allowed opacity-80"
                    )}>
                      <Clock size={8} /> 
                      {editingDelay === key && interactiveEnabled ? (
                        <div className="flex items-center gap-1">
                          <input type="text" className="w-12 bg-transparent text-amber font-mono outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded px-1" value={tempDelay}
                                 onChange={(e) => setTempDelay(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleUpdateDelay(key, tempDelay)} autoFocus />
                          <button onClick={() => handleUpdateDelay(key, tempDelay)} className="text-green"><CheckCircle2 size={10} /></button>
                        </div>
                      ) : (
                        <span
                          className={cn(interactiveEnabled ? "cursor-pointer hover:underline" : "cursor-not-allowed")}
                          onClick={() => {
                            if (!interactiveEnabled) return;
                            setEditingDelay(key);
                            setTempDelay(String(s.config_delay || Math.round(s.remaining_delay)));
                          }}
                        >
                          {s.config_delay && typeof s.config_delay === 'string' && s.config_delay.endsWith('c')
                            ? `${s.config_delay} (${formatDuration(s.remaining_delay * 1000)})`
                            : formatDuration(s.remaining_delay * 1000)
                          }
                        </span>
                      )}
                      {editingDelay !== key && interactiveEnabled && <button onClick={() => handleUpdateDelay(key, 0)} className="text-[7px] bg-red/20 px-1 rounded">SKIP</button>}
                    </div>
                  )}
                  <span className={cn(
                    "md:hidden inline text-[8px] font-mono",
                    isFired ? "text-red" : s.fired ? "text-amber" : "text-accent"
                  )}>{s.insufficientData ? '---' : `${Number(s.progress || 0).toFixed(0)}%`}</span>
                </div>
                <div className="md:flex hidden items-center gap-2 font-mono">
                  <span className="text-dim/60">Mark: {price(mark)}</span>
                  <ArrowRight size={10} className="text-dim/40" />
                  <span className={isFired ? "text-red" : "text-text"}>{price(threshold)}</span>
                </div>
              </div>

              {/* Enhanced Proximity Bar (SignalGauge Style) */}
              <div className="space-y-0.5 md:space-y-1.5">
                <div className="h-1.5 md:h-2 bg-background/80 rounded-full overflow-hidden relative border border-white/5 shadow-inner">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${s.progress}%` }}
                    transition={{ type: "spring", stiffness: 40, damping: 20 }}
                    className={cn(
                      "absolute top-0 left-0 h-full rounded-full transition-colors duration-700",
                      isFired ? "bg-red shadow-[0_0_8px_rgba(255,68,102,0.4)]" : s.fired ? "bg-amber" : "bg-accent"
                    )}
                  />
                </div>

                <div className="flex justify-between items-center px-0.5 md:px-1">
                   <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-[7.5px] md:text-[9px] text-dim uppercase font-bold md:inline-block hidden">
                        {s.insufficientData ? 'Collecting' : `${Number(s.progress || 0).toFixed(1)}% Proxy`}
                      </span>
                      <span className="text-[7.5px] md:text-[9px] text-dim/60">{price(mark)}</span>
                      <ArrowRight size={8} className="text-dim/20" />
                      <span className={cn("text-[7.5px] md:text-[9px]", isFired ? "text-red" : "text-text/80")}>{price(threshold)}</span>
                   </div>
                   {estPnl !== null && (
                      <div className={cn(
                        "text-[8px] md:text-[9px] font-mono font-black",
                        estPnl >= 0 ? "text-green" : "text-red"
                      )}>
                        {estPnl >= 0 ? '+' : ''}{fmtUSD(estPnl)} ({Number(estRr || 0).toFixed(1)}R)
                      </div>
                   )}
                </div>
              </div>

              {/* Technical signal parameters and relevant live details */}
              <div className="flex flex-col gap-1 mt-1 pt-1 border-t border-white/[0.03]">
                {/* Parameters badges */}
                {params.length > 0 && (
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-[7px] text-dim/50 uppercase font-black tracking-wider">Params:</span>
                    {params.map((p, pIdx) => {
                      const baseType = getBaseSignalType(key);
                      const storeKey = getParamStoreKey(key, baseType, p.key);
                      const isEditing = editingParam?.sigKey === key && editingParam?.storeKey === storeKey;
                      const displayVal = p.rawValue !== undefined ? p.rawValue : p.value;

                      if (isEditing) {
                        return (
                          <div
                            key={pIdx}
                            className="inline-flex items-center gap-1 bg-background border border-accent/40 rounded px-1.5 py-0.5 h-6 shadow-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[7px] text-accent font-black uppercase font-mono mr-0.5">{p.label}:</span>
                            {p.type === 'select' ? (
                              <select
                                value={tempParamVal}
                                onChange={(e) => setTempParamVal(e.target.value)}
                                onBlur={() => handleUpdateParam(key, p.key, tempParamVal)}
                                className="bg-transparent font-mono text-[8px] font-bold text-text outline-none border-b border-white/20 px-0.5 h-4 cursor-pointer focus-visible:border-accent"
                                autoFocus
                              >
                                {p.options.map(opt => (
                                  <option key={opt.value} value={opt.value} className="bg-surface text-text">{opt.label}</option>
                                ))}
                              </select>
                            ) : p.type === 'boolean' ? (
                              <select
                                value={tempParamVal}
                                onChange={(e) => setTempParamVal(e.target.value)}
                                onBlur={() => handleUpdateParam(key, p.key, tempParamVal)}
                                className="bg-transparent font-mono text-[8px] font-bold text-text outline-none border-b border-white/20 px-0.5 h-4 cursor-pointer focus-visible:border-accent"
                                autoFocus
                              >
                                <option value="true" className="bg-surface text-text">Yes</option>
                                <option value="false" className="bg-surface text-text">No</option>
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={tempParamVal}
                                onChange={(e) => setTempParamVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleUpdateParam(key, p.key, tempParamVal);
                                  if (e.key === 'Escape') setEditingParam(null);
                                }}
                                onBlur={() => handleUpdateParam(key, p.key, tempParamVal)}
                                className="w-10 bg-transparent font-mono text-[8px] font-bold text-text outline-none border-b border-white/20 px-0.5 h-4 focus-visible:border-accent"
                                autoFocus
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => handleUpdateParam(key, p.key, tempParamVal)}
                              className="text-green hover:text-green-400 p-0.5 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                              aria-label="Save parameter"
                            >
                              <CheckCircle2 size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingParam(null)}
                              className="text-red hover:text-red-400 p-0.5 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                              aria-label="Cancel editing"
                            >
                              <XCircle size={10} />
                            </button>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={pIdx}
                          type="button"
                          onClick={(e) => {
                            if (!interactiveEnabled) return;
                            e.stopPropagation();
                            setEditingParam({ sigKey: key, storeKey });
                            setTempParamVal(String(displayVal));
                          }}
                          className={cn(
                            "text-[7.5px] font-mono text-dim/80 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.05] transition-all duration-200 flex items-center gap-0.5 group/param focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                            interactiveEnabled
                              ? "hover:bg-accent/10 hover:border-accent/30 hover:text-accent hover:shadow-[0_0_8px_rgba(91,111,255,0.1)] cursor-pointer"
                              : "cursor-not-allowed opacity-90"
                          )}
                          aria-label={interactiveEnabled ? `Edit ${p.label} parameter (current: ${p.value})` : `${p.label} parameter: ${p.value}`}
                        >
                          <span className={cn("text-dim/50 uppercase mr-0.5", interactiveEnabled && "group-hover/param:text-accent/50")}>{p.label}:</span>
                          <span className={cn("font-bold text-text/80", interactiveEnabled && "group-hover/param:text-accent")}>{p.value}</span>
                          {interactiveEnabled && <span className="opacity-0 group-hover/param:opacity-100 transition-opacity duration-150 text-[6.5px] text-accent/80 ml-0.5">✎</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Live description/relevancy details */}
                {s.description && (
                  <p className="text-[8px] md:text-[9px] text-dim/70 leading-relaxed font-medium">
                    <span className="text-accent/60 mr-1 font-mono">➔</span>
                    {s.description}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-2.5 md:mt-6 flex items-center gap-2 md:gap-3 p-2.5 md:p-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
        <Info size={10} className="text-dim shrink-0" />
        <p className="text-[7px] md:text-[8px] text-dim font-bold uppercase tracking-widest leading-normal">
          {logic === 'all'
            ? 'All technical conditions must be satisfied simultaneously to trigger an automated exit.'
            : 'Any single technical signal reaching its threshold will trigger an immediate trade liquidation.'}
        </p>
      </div>
    </div>
  )
})

export const TradeDetailContent = memo(({ trade, isSyncing, onTradeClose, isClosing, confirmClose, setConfirmClose, layout = "grid" }) => {
  const activeSessionPnl = useTradingStore(state => state.totalPnl);
  const activeSessionConfig = useTradingStore(state => state.config);
  const sessionActive = useTradingStore(state => state.sessionActive);
  const activeSessionBalance = useTradingStore(state => state.balance);
  const updateActiveTradeConfig = useTradingStore(state => state.updateActiveTradeConfig);

  // Master switch to enable/disable touch/click-to-edit inline interactivity
  const [interactiveEnabled, setInteractiveEnabled] = useState(false);

  // Inline Stop Loss Editor State
  const [isEditingSl, setIsEditingSl] = useState(false)
  const [tempSl, setTempSl] = useState(trade?.sl_price || trade?.current_sl || 0)

  useEffect(() => {
    if (trade && !isEditingSl) {
      setTempSl(trade.sl_price || trade.current_sl || 0);
    }
  }, [trade, isEditingSl]);

  const handleStartEditSl = () => {
    setTempSl(trade?.sl_price || trade?.current_sl || 0);
    setIsEditingSl(true);
  };

  const handleSaveSl = async () => {
    const nextSl = Number(tempSl);
    if (isNaN(nextSl) || nextSl <= 0) return;
    try {
      const payload = { current_sl: nextSl };
      const success = await updateActiveTradeConfig(trade.id || trade.symbol, payload);
      if (success) {
        setIsEditingSl(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Ref to track if we just completed a successful configuration save to prevent stale overwrites
  const justSavedConfig = useRef(false)

  // Active Trade Customization Form State
  const [isEditing, setIsEditing] = useState(false)
  const [formSl, setFormSl] = useState(trade?.sl_price || trade?.current_sl || 0)

  // Force Risk Release State
  const [formForceRiskRelease, setFormForceRiskRelease] = useState(false)

  // Guard Ladder state representation
  const [formLadder, setFormLadder] = useState([])

  // Overrides configurations
  const [formOverrides, setFormOverrides] = useState({})

  // Exit Signal Delays state
  const [formDelays, setFormDelays] = useState({})

  const [savingConfig, setSavingConfig] = useState(false)

  const activeSignalKeys = useMemo(() => {
    const keys = new Set();
    if (trade?.exit_signals_status) {
      Object.keys(trade.exit_signals_status).forEach(k => keys.add(k));
    }
    if (trade?.strategy_config?.exit_signals) {
      trade.strategy_config.exit_signals.forEach(k => keys.add(k));
    }
    if (activeSessionConfig?.exit_signals) {
      activeSessionConfig.exit_signals.forEach(k => keys.add(k));
    }
    return Array.from(keys);
  }, [trade, activeSessionConfig]);

  // Reset editing mode when switching active trades
  useEffect(() => {
    setIsEditing(false);
  }, [trade?.id]);

  // Sync state with trade details whenever they refresh/mount (skip when actively editing)
  useEffect(() => {
    if (trade && !isEditing) {
      if (justSavedConfig.current) {
        // Skip overwriting local state because we just saved these exact values!
        justSavedConfig.current = false;
        return;
      }
      setFormSl(trade.sl_price || trade.current_sl || 0)
      setFormForceRiskRelease(trade.strategy_config?.force_risk_release === true)

      const triggers = trade.live_rr_sequence || []
      const exits = trade.exit_rr_sequence || []
      const ladderPairs = triggers.map((trigger, idx) => ({
        id: `ladder-${trigger}-${idx}-${Math.random()}`,
        trigger,
        exit: exits[idx] !== undefined ? exits[idx] : 0,
      }))
      setFormLadder(ladderPairs)

      const sc = trade.strategy_config?.signal_params || {}
      const dynamicOverrides = {};
      activeSignalKeys.forEach(sigKey => {
        const baseType = getBaseSignalType(sigKey);
        const { params } = getSignalInfo(sigKey, trade.strategy_config || {});
        params.forEach(p => {
          const storeKey = getParamStoreKey(sigKey, baseType, p.key);
          dynamicOverrides[storeKey] = sc[storeKey] !== undefined ? String(sc[storeKey]) : '';
        });
      });
      setFormOverrides(dynamicOverrides);

      // Initialize delay values for each active signal
      const localDelays = trade.strategy_config?.exit_signal_delays || {}
      const globalDelays = activeSessionConfig?.exit_signal_delays || {}
      const delaysObj = {}
      activeSignalKeys.forEach(key => {
        delaysObj[key] = localDelays[key] !== undefined ? localDelays[key] : (globalDelays[key] ?? 0);
      })
      setFormDelays(delaysObj)
    }
  }, [trade, activeSessionConfig, activeSignalKeys, isEditing])

  const ladderValidationError = useMemo(() => {
    if (formLadder.length === 0) return null;
    for (let i = 0; i < formLadder.length; i++) {
      const row = formLadder[i];
      if (isNaN(row.trigger) || isNaN(row.exit)) {
        return "All triggers and exits must be valid numbers.";
      }
      if (i > 0) {
        if (Number(row.trigger) <= Number(formLadder[i-1].trigger)) {
          return "Guard Ladder triggers must be in strictly ascending order.";
        }
      }
    }
    return null;
  }, [formLadder])

  const handleSortLadder = () => {
    setFormLadder((prev) => {
      return [...prev].sort((a, b) => Number(a.trigger || 0) - Number(b.trigger || 0));
    });
  }

  const handleAddLadderRow = () => {
    const lastRow = formLadder[formLadder.length - 1]
    const nextTrigger = lastRow ? Number(lastRow.trigger) + 1.0 : 1.0
    const nextExit = lastRow ? Number(lastRow.exit) + 0.5 : 0.5
    const newRow = { id: `ladder-add-${Date.now()}-${Math.random()}`, trigger: nextTrigger, exit: nextExit }
    setFormLadder([...formLadder, newRow].sort((a, b) => Number(a.trigger || 0) - Number(b.trigger || 0)))
  }

  const handleRemoveLadderRow = (idx) => {
    setFormLadder(formLadder.filter((_, i) => i !== idx))
  }

  const handleUpdateLadderRow = (idx, field, value) => {
    setFormLadder(formLadder.map((row, i) =>
      i === idx ? { ...row, [field]: Number(value) } : row
    ))
  }

  const handleSaveTradeConfig = async () => {
    if (ladderValidationError) return;
    setSavingConfig(true)
    try {
      const sortedLadder = [...formLadder].sort((a, b) => Number(a.trigger || 0) - Number(b.trigger || 0))
      const live_rr_sequence = sortedLadder.map(r => Number(r.trigger))
      const exit_rr_sequence = sortedLadder.map(r => Number(r.exit))

      const signal_params = {}
      Object.entries(formOverrides).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) {
          const num = Number(v);
          if (!isNaN(num) && v !== '') {
            signal_params[k] = num;
          } else if (v === 'true' || v === 'false') {
            signal_params[k] = v === 'true';
          } else {
            signal_params[k] = v;
          }
        }
      });

      const exit_signal_delays = {}
      Object.entries(formDelays).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) {
          if (typeof v === 'string' && /^\d+c$/.test(v)) {
            exit_signal_delays[k] = v;
          } else {
            const num = Number(v);
            if (!isNaN(num) && num >= 0 && num <= 86400) {
              exit_signal_delays[k] = num;
            }
          }
        }
      })

      const payload = {
        current_sl: Number(formSl),
        live_rr_sequence,
        exit_rr_sequence,
        strategy_config: {
          signal_params,
          exit_signal_delays,
          force_risk_release: formForceRiskRelease
        }
      }

      const success = await updateActiveTradeConfig(trade.id || trade.symbol, payload)
      if (success) {
        justSavedConfig.current = true
        setIsEditing(false)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSavingConfig(false)
    }
  }

  const { isLong, pnlPct, progress, entry, mark, sl, initialSl, tp, qty, qtyFormatted, riskFormatted, slDistPct = 0, slInitialDistPct = 0, enhancedExitSignals, estPnlToRealize } = useMemo(() => {
    if (!trade) return {
      isLong: true, pnlPct: 0, progress: 50, entry: 0, mark: 0, sl: 0, initialSl: 0, tp: 0, qty: 0,
      qtyFormatted: '0.0000', riskFormatted: '$0.00', slDistPct: 0, slInitialDistPct: 0, enhancedExitSignals: {}, estPnlToRealize: 0
    }
    const isLong = trade.direction === 'LONG'
    const entry = Number(trade.entry_price || 0)
    const mark = Number(trade.current_price || trade.mark_price || 0)
    const sl = Number(trade.sl_price || 0)
    const initialSl = Number(trade.initial_sl || trade.sl_price || 0)
    const tp = Number(trade.tp_price || trade.tp || 0)

    const pnlPct = mark > 0 ? (trade.pnl_pct ?? (entry ? ((mark - entry) / entry) * 100 * (isLong ? 1 : -1) : 0)) : 0

    let progress = 50
    if (entry && mark && sl) {
      if (tp) {
        const totalRange = isLong ? (tp - sl) : (sl - tp)
        const currentFromSl = isLong ? (mark - sl) : (sl - mark)
        progress = Math.max(0, Math.min(100, (currentFromSl / totalRange) * 100))
      } else {
        const currentRR = Number(trade.rr || 0)
        if (currentRR < 0) {
           const distToSl = Math.abs(entry - sl)
           const distToMark = Math.abs(entry - mark)
           progress = Math.max(0, 50 - (distToMark / distToSl) * 50)
        } else {
           progress = Math.min(100, 50 + (currentRR / 3) * 50)
        }
      }
    }

    const qtyVal = Number(trade.qty || 0)
    const qtyFormatted = Number.isFinite(qtyVal) ? qtyVal.toFixed(4) : '0.0000'
    const riskFormatted = fmtUSD(trade.risk_usdt || 0)

    const slDistPct = mark ? (Math.abs(mark - sl) / mark) * 100 : 0
    const slInitialDistPct = entry ? (Math.abs(entry - initialSl) / entry) * 100 : 0

    // Enhanced Exit Signals with proximity
    const exitSignals = trade.exit_signals_status || {}
    const enhancedExitSignals = Object.entries(exitSignals).reduce((acc, [key, s]) => {
      const distPct = calculateProximity(s, mark, entry, isLong, true);

      acc[key] = {
        ...s,
        distPct,
        label: (s.label || key).replace(/price/gi, '').trim(),
        unit: (s.unit || '').replace(/price/gi, '').trim()
      }
      return acc
    }, {})

    const estPnlToRealize = Number(trade.est_pnl_to_realize || 0)

    return { isLong, pnlPct, progress, entry, mark, sl, initialSl, tp, qty: qtyVal, qtyFormatted, riskFormatted, slDistPct, slInitialDistPct, enhancedExitSignals, estPnlToRealize }
  }, [trade])

  if (!trade) return null

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* PnL Hero Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 md:gap-6">
        <div className="relative group flex-1">
          <div className={cn(
            "absolute -inset-1 rounded-xl md:rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-1000",
            trade.pnl >= 0 ? "bg-gradient-to-r from-green/30 to-accent/30" : "bg-gradient-to-r from-red/30 to-purple/30"
          )} />
          <div className={cn(
            "relative border rounded-2xl py-5 md:py-6 px-4 md:px-6 flex flex-col items-center text-center shadow-[0_4px_30px_rgba(0,0,0,0.1)] backdrop-blur-md overflow-hidden",
            trade.pnl >= 0
              ? "bg-green/5 border-green/20 shadow-[inset_0_0_24px_rgba(0,229,160,0.05)]"
              : "bg-red/5 border-red/20 shadow-[inset_0_0_24px_rgba(255,68,102,0.05)]"
          )}>
            <div className="absolute top-0 right-0 p-3 opacity-5">
              <Activity size={32} className="md:w-16 md:h-12" />
            </div>
            <div className="flex flex-col items-center gap-1 mb-2">
              <span className="text-[9px] md:text-[10px] font-black text-dim uppercase tracking-[0.2em]">
                {trade.exit_ts ? 'Realized P&L' : 'Live Return'}
              </span>
              <div className={cn("text-3xl md:text-4xl lg:text-5xl font-black font-mono tracking-tighter filter drop-shadow-[0_2px_10px_rgba(0,0,0,0.3)]", pnlClass(trade.pnl))}>
                {fmtUSD(trade.pnl)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-black font-mono shadow-md border",
                trade.pnl >= 0
                  ? "bg-green/10 border-green/20 text-green"
                  : "bg-red/10 border-red/20 text-red"
              )}>
                ROI: {Number(pnlPct || 0) >= 0 ? '+' : ''}{Number(pnlPct || 0).toFixed(2)}% · {fmt(trade.rr || 0, 2)}R
              </div>
              {trade.is_reconciliation && (
                <div className="bg-amber/10 text-amber border border-amber/20 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-md flex items-center gap-1.5">
                  <Activity size={12} /> Reconciled
                </div>
              )}
              {trade.strategy_config?.is_nominal_overshoot && (
                <Tooltip content="SCALED RISK: The position notional size was scaled up to meet Binance's minimum order requirements. This forces a higher actual risk percentage than configured. Exercise caution.">
                  <div className="bg-amber/15 text-amber border border-amber/35 px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-md flex items-center gap-1.5 cursor-help">
                    SCALED RISK
                  </div>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Price Runway */}
      <div className="space-y-1.5 md:space-y-2">
        <div className="flex justify-between items-end">
          <div className="flex flex-col gap-0.5">
            <span className={cn(
              "text-[8px] md:text-[9px] font-black uppercase tracking-widest flex items-center gap-1",
              trade.strategy_config?.trailing_stop_enabled ? "text-purple-400 animate-pulse font-extrabold" : "text-red"
            )}>
              <ShieldAlert size={8} /> {trade.strategy_config?.trailing_stop_enabled ? 'Trailing SL' : 'SL'}
            </span>
            {isEditingSl ? (
              <div className="flex items-center gap-1 mt-1.5">
                <span className="text-[10px] font-mono text-dim">$</span>
                <input
                  type="number"
                  step="any"
                  value={tempSl}
                  onChange={(e) => setTempSl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveSl();
                    if (e.key === 'Escape') setIsEditingSl(false);
                  }}
                  className="w-20 bg-background border border-border/80 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveSl}
                  className="text-green hover:scale-115 transition-transform"
                  aria-label="Save stop loss price override"
                >
                  <CheckCircle2 size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingSl(false)}
                  className="text-red hover:scale-115 transition-transform"
                  aria-label="Cancel stop loss price override"
                >
                  <XCircle size={12} />
                </button>
              </div>
            ) : (
              <span
                onClick={() => {
                  if (!interactiveEnabled) return;
                  handleStartEditSl();
                }}
                className={cn(
                  "font-mono text-[9px] md:text-[10px] font-bold text-dim leading-none border-b border-dashed border-dim/30 transition-all flex items-center gap-1 mt-1 group/sl",
                  interactiveEnabled
                    ? "cursor-pointer hover:border-accent hover:text-accent"
                    : "cursor-not-allowed opacity-95"
                )}
                title={interactiveEnabled ? "Click to edit Stop Loss Price" : "Stop Loss Price (Read-Only)"}
              >
                {price(sl)}
                {interactiveEnabled && <Edit3 size={8} className="opacity-0 group-hover/sl:opacity-100 transition-opacity text-accent" />}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[8px] md:text-[9px] font-black text-green uppercase tracking-widest flex items-center gap-1">
              TP <Zap size={8} fill="currentColor" />
            </span>
            <span className="font-mono text-[9px] md:text-[10px] font-bold text-dim leading-none">{tp ? price(tp) : 'TRAILED'}</span>
          </div>
        </div>

        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`Active trade price runway at ${Math.round(progress)}% of exit targets`}
          className="h-2 w-full bg-border/20 rounded-full overflow-hidden relative shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-red/5 via-transparent to-green/5 opacity-50" />
          <div className="absolute top-0 bottom-0 w-1 bg-white/20 z-10 blur-[1px]" style={{ left: '50%' }} />
          <div
            className={cn(
              "h-full transition-all duration-1000 ease-out relative",
              trade.pnl >= 0 ? "bg-green/80" : "bg-red/80"
            )}
            style={{ width: `${progress}%` }}
          >
             <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.1)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.1)_50%,rgba(255,255,255,0.1)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[move-stripe_1s_linear_infinite]" />
             {/* Beautiful custom tick marker with pulse dot at current leading price edge */}
             <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-20">
               <PulseDot color={trade.pnl >= 0 ? "bg-green" : "bg-red"} />
             </div>
          </div>
        </div>

        <div className="flex justify-center scale-90">
          <div className="bg-surface border border-border/50 px-1.5 py-0.2 rounded-md">
            <span className="text-[8px] font-black text-dim uppercase tracking-widest">Entry: </span>
            <span className="font-mono text-[9px] font-bold text-text/80">{price(entry)}</span>
          </div>
        </div>
      </div>

      {/* Primary Metrics Grid */}
       <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
         <StatCard label="Mark" value={price(mark)} color={pnlClass(trade.pnl)} syncing={isSyncing} compact />
         <StatCard label="Size" value={qtyFormatted} subValue={trade.symbol.replace('USDT', '')} color="text-text" compact />
         <StatCard label="Risk" value={riskFormatted} color="text-red" compact />
         <StatCard label="Entry" value={price(entry)} color="text-dim" compact />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-5">
         <div className="lg:col-span-2 space-y-3 md:space-y-4">
            <RRLadder trade={trade} interactiveEnabled={interactiveEnabled} />
         </div>

         <div className="space-y-3 md:space-y-4">
            <ExitMonitor status={enhancedExitSignals} logic={trade.exit_signal_logic} trade={trade} interactiveEnabled={interactiveEnabled} setInteractiveEnabled={setInteractiveEnabled} />

            <div className="bg-surface border border-border rounded-2xl p-3 md:p-5 shadow-sm">
              <SectionLabel className="mb-3 md:mb-5">
                 <Info size={14} className="text-accent" /> Technical Meta
              </SectionLabel>
              {(() => {
                const sessionReturnBlock = (() => {
                  if (trade.exit_ts || !sessionActive) return null;
                  const tradingMode = activeSessionConfig.trading_mode || (activeSessionConfig.paper_mode ? 'paper' : 'live');
                  const startingBalance = tradingMode === 'paper'
                    ? (activeSessionConfig.paper_starting_balance || 10000)
                    : (tradingMode === 'testnet'
                        ? (activeSessionConfig.testnet_starting_balance || 10000)
                        : (activeSessionConfig.live_starting_balance || activeSessionBalance || 10000));
                  const returnPct = startingBalance > 0 ? (activeSessionPnl / startingBalance) * 100 : 0;
                  const modeLabel = tradingMode === 'paper' ? 'Paper' : tradingMode === 'testnet' ? 'Testnet' : 'Live';
                  return {
                    label: `Session Return (${modeLabel})`,
                    value: `${fmtUSD(activeSessionPnl)} (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%)`,
                    color: pnlClass(activeSessionPnl)
                  };
                })();

                return (
                  <div className="space-y-1 md:space-y-3.5">
                     {[
                       sessionReturnBlock && {
                         label: sessionReturnBlock.label,
                         value: sessionReturnBlock.value,
                         color: sessionReturnBlock.color
                       },
                       {
                         label: 'Est. P&L at Target',
                         value: `${fmtUSD(estPnlToRealize)} (${fmt(trade.tp_ratio || 0, 2)}R)`,
                         color: estPnlToRealize >= 0 ? 'text-green' : 'text-red',
                         tooltip: 'Estimated Projected profit and loss if exited at target Reward-to-Risk ratio.'
                       },
                       {
                         label: 'Min RR (Drawdown)',
                         value: `${(() => {
                           const v = trade.min_rr_achieved !== undefined && trade.min_rr_achieved !== null ? trade.min_rr_achieved : 0;
                           return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
                         })()} R`,
                         color: (trade.min_rr_achieved || 0) < 0 ? 'text-red' : 'text-dim',
                         tooltip: 'The lowest RR (deepest drawdown) reached during this trade.'
                       },
                        { label: 'Commission', value: fmtUSD(-(trade.realized_fee || 0)), color: 'text-red/70', tooltip: 'Realized trading fees.' },
                        { label: 'Funding Fee', value: fmtUSD(-(trade.funding_fee || 0)), color: trade.funding_fee > 0 ? 'text-red/70' : 'text-green/70', tooltip: 'Funding fees paid/received.' },
                       { label: 'ROI from Entry', value: `${pnlPct.toFixed(2)}%`, color: pnlPct >= 0 ? 'text-green' : 'text-red', tooltip: 'Percentage return on investment from entry price.' },
                       { label: 'Stop Distance (Live)', value: `${slDistPct.toFixed(2)}%`, tooltip: 'Distance between mark price and current SL.' },
                       trade.strategy_config?.trailing_stop_enabled && {
                         label: 'Trailing Stop',
                         value: `${trade.strategy_config.trailing_stop_distance_pct}%`,
                         color: 'text-purple-400',
                         tooltip: 'Trailing stop-loss distance percentage.'
                       },
                       { label: 'Initial SL Dist', value: `${slInitialDistPct.toFixed(2)}%`, tooltip: 'Initial SL distance percentage from entry.' },
                           { label: 'Max Entry Risk', value: fmtUSD(trade.initial_risk_usdt || trade.risk_usdt || 0), tooltip: 'Maximum risk defined at trade entry.' },
                           {
                             label: 'Daily Δ at Entry',
                             value: `${(trade.entry_daily_change_pct || 0) > 0 ? '▲' : (trade.entry_daily_change_pct || 0) < 0 ? '▼' : ''} ${Number(Math.abs(trade.entry_daily_change_pct || 0)).toFixed(2)}%`,
                             color: pnlClass(trade.entry_daily_change_pct),
                             tooltip: 'Market price change % at trade entry.'
                           },
                           trade.exit_ts && {
                             label: 'Exit Signal',
                             value: (() => {
                                const type = trade.exit_signal_type?.replace(/_/g, ' ') || (trade.exit_reason || 'Manual');
                                const reason = trade.exit_signal_reason || '';
                                if (type === 'STOP LOSS' || type === 'SL HIT' || type === 'TRAILING STOP') {
                                  if (reason.includes('INITIAL_SL')) return 'Initial Stop Loss';
                                  if (reason.includes('RR_sequence_milestone_0')) return 'Breakeven SL';
                                  if (reason.includes('RR_sequence_milestone')) {
                                    const match = reason.match(/milestone_(\d+)/);
                                    return match ? `Ratchet SL (M${match[1]})` : 'Ratchet SL';
                                  }
                                  if (type === 'TRAILING STOP') return 'Trailing Stop';
                                  return 'Stop Loss';
                                }
                                if (type === 'EXCHANGE MANUAL') return 'Exchange Manual';
                                if (type === 'EXCHANGE FILL') return 'Exchange Fill';
                                if (type === 'EXCHANGE SYNC') return 'Exchange Sync';
                                return type;
                             })(),
                             color: 'text-accent',
                             tooltip: trade.exit_signal_reason || 'Exit signal details.'
                           }
                         ].filter(Boolean).map(item => (
                           <div key={item.label} className="flex justify-between items-center py-1 md:py-2.5 border-b border-border/40 last:border-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] md:text-[10px] text-dim font-bold uppercase tracking-widest">{item.label}</span>
                                <Tooltip content={item.tooltip || 'No info'}>
                                  <Info size={10} className="text-dim/50 hover:text-accent cursor-help" />
                                </Tooltip>
                              </div>
                              <span className={cn("text-xs font-bold font-mono", item.color)}>{item.value}</span>
                           </div>
                         ))}
                      </div>
                    );
                })()}
             </div>

             {/* Risk Mitigation Log section */}
             {(trade.sl_adjustments || []).length > 0 && (
                <div className="bg-surface border border-border rounded-2xl p-3 md:p-5 shadow-sm">
                  <SectionLabel className="mb-3 md:mb-5">
                    <ShieldCheck size={14} className="text-accent" /> Risk Mitigation Log
                  </SectionLabel>
                  <div className="space-y-2">
                    {(trade.sl_adjustments || []).slice(-3).reverse().map((adj, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px] bg-white/[0.02] border border-white/[0.05] p-3 md:p-4 rounded-2xl group/adj hover:border-accent/30 transition-colors">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-text/90">{price(adj.prev_sl)}</span>
                            <span className="text-dim/30">→</span>
                            <span className="font-mono font-bold text-accent">{price(adj.new_sl)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                             <span className="text-dim/60 text-[9px] uppercase tracking-[0.1em]">{adj.reason}</span>
                             {adj.adaptive && (
                                <span className="bg-amber/10 text-amber px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-tighter flex items-center gap-1 border border-amber/20">
                                   <Activity size={8} /> Adaptive
                                </span>
                             )}
                          </div>
                        </div>
                        {i === 0 && (
                          <div className="flex flex-col items-end gap-1">
                            <span className="bg-accent/10 text-accent px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter">Current SL</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
         </div>
      </div>

      {/* Active Trade Stop Loss & Exit Monitors Configuration Workspace */}
      {trade.status === 'OPEN' && (() => {
        const isTestnet = (activeSessionConfig?.trading_mode === 'testnet');
        const ringColorClass = isTestnet
          ? "focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none"
          : "focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none";

        return (
          <div className="mt-4 md:mt-6 pt-5 border-t border-border/40">
            <div className="flex justify-between items-center mb-4">
              <SectionLabel className="mb-0 flex items-center gap-1.5">
                <Sliders size={14} className="text-accent" /> Active Exit Guard Configuration
              </SectionLabel>
              <Btn
                variant={isEditing ? "ghost" : "primary"}
                onClick={() => setIsEditing(!isEditing)}
                className={cn(
                  "px-3.5 py-1.5 h-8 text-[10px] uppercase tracking-wider font-black rounded-lg transition-all duration-300",
                  isEditing
                    ? "bg-accent/10 border-accent/30 text-accent hover:bg-accent/20 hover:text-accent shadow-[0_0_15px_rgba(91,111,255,0.15)]"
                    : "bg-surface hover:bg-accent hover:text-white text-text border border-border/60 hover:border-accent hover:shadow-[0_0_20px_rgba(91,111,255,0.2)]"
                )}
              >
                {isEditing ? (
                  <>
                    <Sliders size={11} className="animate-pulse" />
                    <span>Collapse Editor</span>
                  </>
                ) : (
                  <>
                    <Sliders size={11} />
                    <span>Edit Config</span>
                  </>
                )}
              </Btn>
            </div>

            <AnimatePresence initial={false}>
              {isEditing && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  className="overflow-hidden"
                >
                  <div className="bg-surface/60 border border-border/50 rounded-2xl p-4 md:p-6 shadow-lg backdrop-blur-md space-y-5 md:space-y-7 mt-3">

                    {/* Part 1: Stop-Loss Override */}
                    <div className="space-y-2">
                      <SectionLabel className="text-[10px] text-accent/80 tracking-widest font-black uppercase">
                        Stop-Loss Override
                      </SectionLabel>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/60 font-mono text-xs">$</span>
                          <input
                            type="number"
                            step="any"
                            value={formSl}
                            onChange={(e) => setFormSl(e.target.value)}
                            className={cn(
                              "pl-7 pr-3 py-1.5 w-full font-mono text-sm bg-background/50 border border-border/50 text-text rounded-lg transition-all",
                              ringColorClass
                            )}
                            aria-label="Edit stop loss price"
                          />
                        </div>
                        <div className="text-[10px] md:text-xs font-mono text-dim/80 space-y-0.5">
                          <div className="flex justify-between">
                            <span>Risk Distance:</span>
                            <span className="font-bold text-red">
                              {Number(entry) > 0 ? `${Number(Math.abs(entry - Number(formSl)) / entry * 100).toFixed(2)}%` : '0.00%'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Projected Risk:</span>
                            <span className="font-bold text-red">
                              {fmtUSD(Math.abs(entry - Number(formSl)) * Number(qty))}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Part 1.5: Force Risk Release Toggle */}
                    <div className="flex items-center justify-between p-3.5 bg-background/30 border border-border/40 rounded-xl">
                      <div className="flex flex-col gap-0.5 min-w-0 pr-4">
                        <span className="text-[10px] text-accent/80 tracking-widest font-black uppercase">
                          Force Risk Release
                        </span>
                        <span className="text-[9px] text-dim/60 leading-tight">
                          Locks trade risk value to $0.00. Use this if the trade has reached a safe breakeven state or you want to free up active risk allocation.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormForceRiskRelease(prev => !prev)}
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          formForceRiskRelease ? "bg-accent" : "bg-surface-light border border-border/40"
                        )}
                        aria-pressed={formForceRiskRelease}
                        aria-label="Toggle Force Risk Release"
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            formForceRiskRelease ? "translate-x-4" : "translate-x-0"
                          )}
                        />
                      </button>
                    </div>

                    {/* Part 2: Exponential RR Guard Ladder */}
                    <div className="space-y-3 pt-4 border-t border-border/10">
                      <div className="flex justify-between items-center">
                        <SectionLabel className="text-[10px] text-accent/80 tracking-widest font-black uppercase mb-0">
                          Profit-Locking Guard Ladder Milestones
                        </SectionLabel>
                        <Btn
                          variant="ghost"
                          onClick={handleAddLadderRow}
                          className="px-2.5 py-1 h-7 text-[9px] uppercase tracking-wider font-black rounded-lg border border-border/40 hover:border-accent/40 text-accent/80 hover:text-accent hover:bg-accent/5 transition-all duration-300 active:scale-95"
                          icon={Plus}
                        >
                          Add Milestone
                        </Btn>
                      </div>

                      {ladderValidationError && (
                        <div className="bg-red/10 border border-red/20 rounded-xl p-3 text-[10px] text-red uppercase tracking-wider font-black animate-pulse">
                          ⚠ {ladderValidationError}
                        </div>
                      )}

                      <div className="space-y-1.5 max-h-[240px] overflow-y-auto no-scrollbar pr-1">
                        <AnimatePresence initial={false} mode="popLayout">
                          {formLadder.map((row, idx) => (
                            <motion.div
                              key={row.id || `row-${idx}`}
                              initial={{ opacity: 0, y: -10, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: "auto" }}
                              exit={{ opacity: 0, y: 10, height: 0 }}
                              transition={{ type: "spring", stiffness: 350, damping: 26 }}
                              className="grid grid-cols-[1fr_1fr_40px] gap-2 items-center overflow-hidden py-0.5"
                            >
                              <div className="relative">
                                <input
                                  type="number"
                                  step="any"
                                  value={row.trigger}
                                  onChange={(e) => handleUpdateLadderRow(idx, "trigger", e.target.value)}
                                  onBlur={handleSortLadder}
                                  placeholder="Trigger RR"
                                  className={cn(
                                    "px-3 py-1.5 w-full font-mono text-sm bg-background/50 border border-border/50 text-text rounded-lg transition-all",
                                    ringColorClass
                                  )}
                                  aria-label={`Milestone trigger ${idx + 1}`}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-dim/40 font-mono">Trigger R</span>
                              </div>
                              <div className="relative">
                                <input
                                  type="number"
                                  step="any"
                                  value={row.exit}
                                  onChange={(e) => handleUpdateLadderRow(idx, "exit", e.target.value)}
                                  onBlur={handleSortLadder}
                                  placeholder="Exit SL RR"
                                  className={cn(
                                    "px-3 py-1.5 w-full font-mono text-sm bg-background/50 border border-border/50 text-text rounded-lg transition-all",
                                    ringColorClass
                                  )}
                                  aria-label={`Milestone exit stop loss ${idx + 1}`}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-dim/40 font-mono">Lock R</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveLadderRow(idx)}
                                className="p-2 h-9 w-10 flex items-center justify-center rounded-lg hover:bg-red/10 text-dim/60 hover:text-red border border-border/40 hover:border-red/20 shrink-0 transition-all duration-200 active:scale-90"
                                aria-label={`Delete milestone row ${idx + 1}`}
                              >
                                <Trash size={13} />
                              </button>
                            </motion.div>
                          ))}
                        </AnimatePresence>

                        {formLadder.length === 0 && (
                          <div className="text-center py-4 text-xs text-dim italic">
                            No guard ladder milestones configured. Add a milestone to enable live ratcheting.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Part 3: Exit Monitors indicator parameter overrides */}
                    <div className="space-y-3 pt-4 border-t border-border/10">
                      <SectionLabel className="text-[10px] text-accent/80 tracking-widest font-black uppercase mb-1">
                        Technical Indicator Overrides
                      </SectionLabel>
                      <div className="space-y-4">
                        {activeSignalKeys.map(sigKey => {
                          const baseType = getBaseSignalType(sigKey);
                          const { timeframe, params } = getSignalInfo(sigKey, trade.strategy_config || {});
                          if (params.length === 0) return null;

                          const label = FRIENDLY_SIGNAL_NAMES[baseType] || baseType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          const isLayered = sigKey !== baseType;
                          const suffix = isLayered ? ` (Layer: _${sigKey.split('_').pop()})` : '';

                          return (
                            <div key={sigKey} className="bg-white/[0.01] border border-white/[0.03] p-3 rounded-xl space-y-2.5">
                              <div className="flex justify-between items-center border-b border-white/[0.02] pb-1.5">
                                <span className="text-[9px] font-black uppercase tracking-wider text-text/95">
                                  {label}{suffix}
                                </span>
                                <span className="text-[8px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded font-bold uppercase">
                                  {timeframe}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {params.map(p => {
                                  const storeKey = getParamStoreKey(sigKey, baseType, p.key);
                                  const val = formOverrides[storeKey] ?? '';

                                  return (
                                    <div key={p.key}>
                                      <label className="text-[8px] font-black text-dim uppercase tracking-wider block mb-1">
                                        {p.label}
                                      </label>
                                      {p.type === 'select' ? (
                                        <select
                                          value={val}
                                          onChange={(e) => setFormOverrides({ ...formOverrides, [storeKey]: e.target.value })}
                                          className={cn(
                                            "px-2 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg transition-all focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                                            ringColorClass
                                          )}
                                        >
                                          <option value="">Default ({p.value})</option>
                                          {p.options.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                          ))}
                                        </select>
                                      ) : p.type === 'boolean' ? (
                                        <select
                                          value={val}
                                          onChange={(e) => setFormOverrides({ ...formOverrides, [storeKey]: e.target.value })}
                                          className={cn(
                                            "px-2 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg transition-all focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                                            ringColorClass
                                          )}
                                        >
                                          <option value="">Default ({p.value ? 'Yes' : 'No'})</option>
                                          <option value="true">Yes</option>
                                          <option value="false">No</option>
                                        </select>
                                      ) : (
                                        <input
                                          type="number"
                                          step="any"
                                          placeholder={`Default (${p.value})`}
                                          value={val}
                                          onChange={(e) => setFormOverrides({ ...formOverrides, [storeKey]: e.target.value })}
                                          className={cn(
                                            "px-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg transition-all",
                                            ringColorClass
                                          )}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        {activeSignalKeys.length === 0 && (
                          <div className="text-center py-4 text-xs text-dim italic">
                            No active indicator overrides available.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Part 4: Exit Signal Delay Overrides */}
                    <div className="space-y-3 pt-4 border-t border-border/10">
                      <SectionLabel className="text-[10px] text-accent/80 tracking-widest font-black uppercase mb-1">
                        Exit Signal Delay Overrides
                      </SectionLabel>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {activeSignalKeys.map((key) => {
                          const val = formDelays[key] ?? 0;
                          const label = FRIENDLY_SIGNAL_NAMES[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          const isCandleType = typeof val === 'string' && /^\d+c$/.test(val);
                          const candleCountValue = isCandleType ? parseInt(val.slice(0, -1), 10) : 1;

                          return (
                            <div key={key} className="flex flex-col gap-1.5 bg-white/[0.01] border border-white/[0.03] p-2.5 rounded-xl">
                              <div className="flex items-center justify-between">
                                <label className="text-[8px] font-black text-dim uppercase tracking-wider block">
                                  {label} Delay
                                </label>
                                <div className="flex bg-background border border-border/40 rounded-md p-0.5" role="group" aria-label={`Delay mode for ${label}`}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFormDelays(prev => ({ ...prev, [key]: 0 }));
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
                                      setFormDelays(prev => ({ ...prev, [key]: "1c" }));
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

                              <div className="relative h-8">
                                {!isCandleType ? (
                                  <>
                                    <input
                                      type="number"
                                      min="0"
                                      max="86400"
                                      placeholder="0"
                                      value={val === '' ? '' : val}
                                      onChange={(e) => {
                                        const v = e.target.value === '' ? '' : Math.max(0, Math.min(86400, parseInt(e.target.value) || 0));
                                        setFormDelays(prev => ({ ...prev, [key]: v }));
                                      }}
                                      className={cn(
                                        "px-3 py-1.5 pr-8 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg transition-all h-8",
                                        ringColorClass
                                      )}
                                      aria-label={`Exit delay for ${label} in seconds`}
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-dim/40 font-mono">s</span>
                                  </>
                                ) : (
                                  <>
                                    <input
                                      type="number"
                                      min="1"
                                      max="1000"
                                      placeholder="1"
                                      value={candleCountValue}
                                      onChange={(e) => {
                                        const v = Math.max(1, parseInt(e.target.value) || 1);
                                        setFormDelays(prev => ({ ...prev, [key]: `${v}c` }));
                                      }}
                                      className={cn(
                                        "px-3 py-1.5 pr-8 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg transition-all h-8",
                                        ringColorClass
                                      )}
                                      aria-label={`Exit delay for ${label} in candles`}
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-dim/40 font-mono">candles</span>
                                  </>
                                )}
                              </div>
                              <span className="text-[8px] text-dim/70 font-mono mt-0.5">
                                {!isCandleType ? (val ? formatDuration(val * 1000) : 'Instant (no delay)') : `${candleCountValue} candle${candleCountValue > 1 ? 's' : ''}`}
                              </span>
                            </div>
                          );
                        })}
                        {activeSignalKeys.length === 0 && (
                          <div className="col-span-full text-center py-2 text-xs text-dim italic">
                            No active exit signals configured for this trade.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Saving Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t border-border/10">
                      <Btn
                        variant="ghost"
                        onClick={() => setIsEditing(false)}
                        disabled={savingConfig}
                        className="px-4 py-1.5 h-9 text-[10px] uppercase tracking-wider font-black rounded-lg hover:bg-white/5 hover:text-text hover:border-border transition-all"
                      >
                        Cancel
                      </Btn>
                      <Btn
                        variant="primary"
                        onClick={handleSaveTradeConfig}
                        disabled={savingConfig || !!ladderValidationError}
                        loading={savingConfig}
                        className="px-5 py-1.5 h-9 text-[10px] uppercase tracking-wider font-black rounded-lg bg-gradient-to-r from-accent to-indigo-600 hover:from-accent/95 hover:to-indigo-500 shadow-md shadow-accent/20 hover:shadow-lg hover:shadow-accent/30 transition-all duration-300"
                      >
                        Apply Changes
                      </Btn>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })()}

      <div className="mt-3 md:mt-5 pt-4 border-t border-border/40">
        <SectionLabel className="mb-2.5 text-red">Danger Zone</SectionLabel>
        <div className="bg-red/5 border border-red/10 rounded-2xl p-4 md:p-5 flex flex-col md:flex-row items-center justify-between gap-4 transition-all hover:bg-red/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red/10 flex items-center justify-center text-red shrink-0">
              <ShieldAlert size={20} />
            </div>
            <div className="flex flex-col">
              <h3 className="text-xs font-bold uppercase tracking-tight text-red">Force Liquidation</h3>
              <p className="text-[9px] text-dim font-medium uppercase mt-0.5">Immediately close this position at current market price. This ignores all strategy logic.</p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 w-full md:w-auto min-w-[180px]">
            {trade.close_blocked && (
               <div className="bg-red/10 border border-red/20 rounded-xl p-2.5 flex flex-col gap-0.5 items-center text-center animate-pulse mb-1.5">
                  <span className="text-[9px] font-black text-red uppercase tracking-widest flex items-center gap-1">
                     <ShieldAlert size={10} /> Liquidation Blocked
                  </span>
                  <span className="text-[7.5px] text-red/60 font-bold uppercase leading-tight">
                     Max retries exceeded. Manual intervention on Binance is required.
                  </span>
               </div>
            )}
            {!trade.close_blocked && trade.close_attempts > 0 && (
               <div className="bg-amber/10 border border-amber/20 rounded-xl p-1.5 flex items-center justify-center gap-1.5 mb-1.5">
                  <Loader2 className="animate-spin text-amber" size={9} />
                  <span className="text-[7.5px] font-black text-amber uppercase tracking-widest">
                     Closure Retry {trade.close_attempts}/5
                  </span>
               </div>
            )}
            <Btn
              variant="danger"
              onClick={() => setConfirmClose(true)}
              disabled={isClosing}
              loading={isClosing}
              className="w-full h-10 py-1 text-[11px] uppercase tracking-widest font-black"
            >
              <Trash2 size={14} /> Force Close
            </Btn>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          onTradeClose(trade.symbol);
        }}
        title="Force Liquidation?"
        message={`Are you sure you want to immediately close your ${trade.symbol} ${trade.direction} position at market price? This bypasses all exit signals and risk guards.`}
        confirmText="Confirm Liquidation"
        variant="danger"
        loading={isClosing}
      />
    </div>
  )
})
TradeDetailContent.displayName = 'TradeDetailContent'
