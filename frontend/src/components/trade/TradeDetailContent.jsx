import React, { useState, useEffect, useMemo, memo } from 'react'
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

const Metric = memo(({ label, value }) => (
  <div className="flex flex-col gap-1.5 group/metric">
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-black text-dim uppercase tracking-[0.2em]">{label}</span>
    </div>
    <span className="font-mono text-sm font-bold text-text/90">{value}</span>
  </div>
))
Metric.displayName = 'Metric'

const RRLadder = memo(({ trade }) => {
  const triggers = trade.live_rr_sequence || []
  const exits = trade.exit_rr_sequence || []
  const maxRR = trade.max_rr || 0
  const liveRR = trade.rr || 0
  const risk = Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price))
  const activeIdx = triggers.reduce((idx, trigger, i) => maxRR >= trigger ? i : idx, -1)

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
        <div className="flex items-center gap-2">
          <SectionLabel className="mb-0">
             <Zap size={14} className="text-accent" fill="currentColor" /> Guard Ladder
          </SectionLabel>
        </div>
        <div className="flex items-center gap-2">
          {trade.strategy_config?.trailing_stop_enabled && (
            <div className="text-[10px] text-purple-400 font-mono bg-purple-400/10 px-2 py-0.5 rounded border border-purple-400/20 flex items-center gap-1">
              <Activity size={10} /> Trailing
            </div>
          )}
          <div className="text-[10px] text-accent font-mono bg-accent/10 px-2 py-0.5 rounded border border-accent/20">Live Ratchet</div>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto no-scrollbar mb-3 md:mb-8 pb-2">
        {(triggers || []).map((trigger, i) => {
          const done = maxRR >= trigger
          const current = i === activeIdx
          return (
            <div key={`${trigger}-${i}`} className="min-w-[60px] md:min-w-[80px] flex-1">
              <div className={cn(
                "text-[10px] md:text-xs font-bold mb-1.5 md:mb-3 text-center",
                current ? "text-accent" : done ? "text-green" : "text-dim"
              )}>{trigger}R</div>
              <div className={cn(
                "h-1.5 md:h-2 rounded-full transition-all duration-500",
                done ? (current ? "bg-accent shadow-[0_0_10px_rgba(91,111,255,0.4)]" : "bg-green") : "bg-border"
              )} />
              <div className={cn(
                "text-[9px] md:text-[10px] font-bold mt-1.5 md:mt-3 uppercase tracking-widest text-center flex flex-col",
                done ? "text-text" : "text-dim"
              )}>
                <span>SL {exits[i] === 0 ? 'BE' : `${exits[i]}R`}</span>
                <span className={cn("text-[8px] font-mono", done ? pnlClass(getEstPnl(trade.direction === 'LONG' ? trade.entry_price + risk * exits[i] : trade.entry_price - risk * exits[i])) : "opacity-40")}>
                  {fmtUSD(getEstPnl(trade.direction === 'LONG' ? trade.entry_price + risk * exits[i] : trade.entry_price - risk * exits[i]))}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-6">
        <div className="p-2 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[8px] md:text-[10px] text-dim font-bold uppercase tracking-widest mb-0.5 md:mb-1">Live RR</div>
          <div className={cn("text-sm md:text-xl font-mono font-bold", liveRR >= 0 ? "text-green" : "text-red")}>{fmt(liveRR, 2)}</div>
        </div>
        <div className="p-2 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[8px] md:text-[10px] text-dim font-bold uppercase tracking-widest mb-0.5 md:mb-1">Peak RR</div>
          <div className="text-sm md:text-xl font-mono font-bold text-accent">{fmt(maxRR, 2)}</div>
        </div>
        <div className="p-2 md:p-4 bg-background/40 rounded-xl border border-border">
          <div className="text-[8px] md:text-[10px] text-dim font-bold uppercase tracking-widest mb-0.5 md:mb-1">Secured SL</div>
          <div className="text-sm md:text-xl font-mono font-bold text-text flex flex-col leading-tight">
            <span>{price(currentSl)}</span>
            <span className={cn("text-[7px] md:text-[10px]", pnlClass(getEstPnl(currentSl)))}>
              {fmtUSD(getEstPnl(currentSl))}
            </span>
          </div>
        </div>
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

const getSignalInfo = (key, config) => {
  const base = getBaseSignalType(key);
  let tf = config?.signal_timeframes?.[key] || config?.scan_interval || config?.interval || '1m';
  if (tf === 'default') {
    tf = config?.scan_interval || config?.interval || '1m';
  }
  const params = [];
  const sp = config?.signal_params || {};

  switch (base) {
    case 'macd_fade':
    case 'macd_impulse':
    case 'macd_pbc': {
      const fast = sp.macd_fast ?? 12;
      const slow = sp.macd_slow ?? 26;
      const sig = sp.macd_signal ?? 9;
      params.push({ label: 'Fast', value: fast });
      params.push({ label: 'Slow', value: slow });
      params.push({ label: 'Signal', value: sig });
      if (base === 'macd_pbc') {
        const trendEma = sp.macd_pbc_trend_ema ?? 50;
        const lb = sp.macd_pbc_lookback ?? 10;
        params.push({ label: 'Trend EMA', value: trendEma });
        params.push({ label: 'Lookback', value: lb });
      } else if (base === 'macd_impulse') {
        const strict = sp.macd_strict_expansion === true || sp.macd_strict_expansion === 'true';
        params.push({ label: 'Strict', value: strict ? 'Yes' : 'No' });
      }
      break;
    }
    case 'supertrend': {
      const period = sp.supertrend_period ?? 10;
      const mult = sp.supertrend_multiplier ?? 3;
      const mode = sp.supertrend_mode ?? 'trend';
      params.push({ label: 'Period', value: period });
      params.push({ label: 'Mult', value: mult });
      params.push({ label: 'Mode', value: mode });
      break;
    }
    case 'engulfing': {
      const lookback = config?.engulfing_lookback ?? sp.engulfing_lookback ?? 1;
      const streak = config?.engulfing_streak ?? sp.engulfing_streak ?? 1;
      const mode = config?.engulfing_mode ?? sp.engulfing_mode ?? 'range';
      const volConfirm = config?.engulfing_volume_confirm ?? sp.engulfing_volume_confirm ?? false;
      params.push({ label: 'Lookback', value: lookback });
      params.push({ label: 'Streak', value: streak });
      params.push({ label: 'Mode', value: mode });
      params.push({ label: 'Vol Conf', value: volConfirm ? 'Yes' : 'No' });
      break;
    }
    case 'ema':
    case 'ema_cross':
    case 'ema_price_cross':
    case 'ema_close': {
      const period = sp.exit_ema_period ?? sp.ema_period ?? 12;
      params.push({ label: 'Period', value: period });
      break;
    }
    case 'ema_dual_cross':
    case 'ema_dual_close': {
      const fast = sp.exit_ema_fast ?? sp.entry_ema_fast ?? 9;
      const slow = sp.exit_ema_slow ?? sp.entry_ema_slow ?? 21;
      params.push({ label: 'Fast', value: fast });
      params.push({ label: 'Slow', value: slow });
      break;
    }
    case 'ma': {
      const period = sp.ma_period ?? 20;
      params.push({ label: 'Period', value: period });
      break;
    }
    case 'momentum_pct': {
      const threshold = config?.scan_pct_threshold ?? sp.scan_pct_threshold ?? 2.0;
      const lookback = config?.scan_lookback ?? sp.scan_lookback ?? 3;
      params.push({ label: 'Threshold', value: `${threshold}%` });
      params.push({ label: 'Lookback', value: lookback });
      break;
    }
    case 'breakout_hl': {
      const lookback = config?.scan_lookback ?? sp.scan_lookback ?? 3;
      params.push({ label: 'Lookback', value: lookback });
      break;
    }
    default:
      break;
  }

  return { timeframe: tf, params };
};

const ExitMonitor = memo(({ status, logic, trade }) => {
  if (!status || Object.keys(status).length === 0) return null;
  const mark = Number(trade.current_price || trade.mark_price || 0)
  const isLong = trade.direction === 'LONG'
  const entryPrice = Number(trade.entry_price || 0)
  const qty = Number(trade.qty || 0)
  const riskUsdt = Number(trade.initial_risk_usdt || trade.risk_usdt || Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price)) * trade.qty || 0)

  // Sort entries by proximity (triggerProgress descending)
  const entries = useMemo(() => {
    return Object.entries(status || {}).map(([key, s]) => {
      const progress = s.distPct ?? 0;
      return [key, { ...s, progress }];
    }).sort((a, b) => b[1].progress - a[1].progress);
  }, [status]);

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
        <div className="flex items-center gap-2 md:gap-3">
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
                    <span className="text-amber bg-amber/10 px-1 rounded flex items-center gap-1 scale-90 md:scale-100">
                      <Clock size={8} /> {formatDuration(s.remaining_delay * 1000)}
                    </span>
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
                    {params.map((p, pIdx) => (
                      <span key={pIdx} className="text-[7.5px] font-mono text-dim/80 bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.05]">
                        <span className="text-dim/50 uppercase mr-0.5">{p.label}:</span>
                        <span className="font-bold text-text/80">{p.value}</span>
                      </span>
                    ))}
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
  const updateActiveTradeConfig = useTradingStore(state => state.updateActiveTradeConfig);

  // Active Trade Customization Form State
  const [isEditing, setIsEditing] = useState(false)
  const [formSl, setFormSl] = useState(trade?.sl_price || trade?.current_sl || 0)

  // Guard Ladder state representation
  const [formLadder, setFormLadder] = useState([])

  // Overrides configurations
  const [formOverrides, setFormOverrides] = useState({
    exit_ema_period: '',
    supertrend_period: '',
    supertrend_multiplier: '',
    macd_fast: '',
    macd_slow: '',
    macd_signal: '',
  })

  const [savingConfig, setSavingConfig] = useState(false)

  // Sync state with trade details whenever they refresh/mount
  useEffect(() => {
    if (trade) {
      setFormSl(trade.sl_price || trade.current_sl || 0)

      const triggers = trade.live_rr_sequence || []
      const exits = trade.exit_rr_sequence || []
      const ladderPairs = triggers.map((trigger, idx) => ({
        trigger,
        exit: exits[idx] !== undefined ? exits[idx] : 0,
      }))
      setFormLadder(ladderPairs)

      const sc = trade.strategy_config?.signal_params || trade.strategy_config || {}
      setFormOverrides({
        exit_ema_period: sc.exit_ema_period ?? sc.ema_period ?? '',
        supertrend_period: sc.supertrend_period ?? '',
        supertrend_multiplier: sc.supertrend_multiplier ?? '',
        macd_fast: sc.macd_fast ?? '',
        macd_slow: sc.macd_slow ?? '',
        macd_signal: sc.macd_signal ?? '',
      })
    }
  }, [trade])

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

  const handleAddLadderRow = () => {
    const lastRow = formLadder[formLadder.length - 1]
    const nextTrigger = lastRow ? Number(lastRow.trigger) + 1.0 : 1.0
    const nextExit = lastRow ? Number(lastRow.exit) + 0.5 : 0.5
    setFormLadder([...formLadder, { trigger: nextTrigger, exit: nextExit }])
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
      const live_rr_sequence = formLadder.map(r => Number(r.trigger))
      const exit_rr_sequence = formLadder.map(r => Number(r.exit))

      const signal_params = {}
      if (formOverrides.exit_ema_period !== '') signal_params.exit_ema_period = Number(formOverrides.exit_ema_period);
      if (formOverrides.supertrend_period !== '') signal_params.supertrend_period = Number(formOverrides.supertrend_period);
      if (formOverrides.supertrend_multiplier !== '') signal_params.supertrend_multiplier = Number(formOverrides.supertrend_multiplier);
      if (formOverrides.macd_fast !== '') signal_params.macd_fast = Number(formOverrides.macd_fast);
      if (formOverrides.macd_slow !== '') signal_params.macd_slow = Number(formOverrides.macd_slow);
      if (formOverrides.macd_signal !== '') signal_params.macd_signal = Number(formOverrides.macd_signal);

      const payload = {
        current_sl: Number(formSl),
        live_rr_sequence,
        exit_rr_sequence,
        strategy_config: {
          signal_params
        }
      }

      const success = await updateActiveTradeConfig(trade.id || trade.symbol, payload)
      if (success) {
        setIsEditing(false)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSavingConfig(false)
    }
  }

  const { isLong, pnlPct, progress, entry, mark, sl, initialSl, tp, qtyFormatted, riskFormatted, slDistPct = 0, slInitialDistPct = 0, enhancedExitSignals } = useMemo(() => {
    if (!trade) return {
      isLong: true, pnlPct: 0, progress: 50, entry: 0, mark: 0, sl: 0, initialSl: 0, tp: 0,
      qtyFormatted: '0.0000', riskFormatted: '$0.00', slDistPct: 0, slInitialDistPct: 0, enhancedExitSignals: {}
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

    const qtyVal = Number(trade.qty)
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

    return { isLong, pnlPct, progress, entry, mark, sl, initialSl, tp, qtyFormatted, riskFormatted, slDistPct, slInitialDistPct, enhancedExitSignals }
  }, [trade])

  if (!trade) return null

  return (
    <div className="flex flex-col gap-3 md:gap-6">
      {/* PnL Hero Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 md:gap-6">
        <div className="relative group flex-1">
          <div className="absolute -inset-1 bg-gradient-to-r from-accent/20 to-purple/20 rounded-xl md:rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-1000" />
            <div className="relative bg-white/[0.03] border border-white/[0.05] rounded-xl md:rounded-2xl py-2 md:py-4 px-3 md:px-6 flex flex-col items-center text-center shadow-inner overflow-hidden">
              <div className="absolute top-0 right-0 p-2 md:p-4 opacity-10">
                <Activity size={24} className="md:w-12 md:h-12" />
            </div>
              <div className="flex items-center gap-2 mb-0.5 md:mb-1">
                <span className="text-[7px] md:text-[9px] font-black text-dim uppercase tracking-[0.2em]">
                {trade.exit_ts ? 'Realized P&L' : 'Live Return'}
              </span>
                <div className={cn("text-base md:text-2xl lg:text-3xl font-black font-mono tracking-tighter", pnlClass(trade.pnl))}>
                {fmtUSD(trade.pnl)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={cn("px-2 py-0.5 md:px-4 md:py-1.5 rounded-full text-[8px] md:text-xs font-black font-mono shadow-sm", trade.pnl >= 0 ? "bg-green/10 text-green" : "bg-red/10 text-red")}>
                ROI: {Number(pnlPct || 0) >= 0 ? '+' : ''}{Number(pnlPct || 0).toFixed(2)}% · {fmt(trade.rr || 0, 2)}R
              </div>
              {trade.is_reconciliation && (
                <div className="bg-amber/10 text-amber border border-amber/20 px-2 py-0.5 md:px-4 md:py-1.5 rounded-full text-[8px] md:text-xs font-black uppercase tracking-widest shadow-sm flex items-center gap-1.5">
                  <Activity size={12} className="md:size-3" /> Reconciled
                </div>
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
            <span className="font-mono text-[9px] md:text-[10px] font-bold text-dim leading-none">{price(sl)}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[8px] md:text-[9px] font-black text-green uppercase tracking-widest flex items-center gap-1">
              TP <Zap size={8} fill="currentColor" />
            </span>
            <span className="font-mono text-[9px] md:text-[10px] font-bold text-dim leading-none">{tp ? price(tp) : 'TRAILED'}</span>
          </div>
        </div>

        <div className="h-2 w-full bg-border/20 rounded-full overflow-hidden relative shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]">
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
            <RRLadder trade={trade} />

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

         <div className="space-y-3 md:space-y-4">
            <ExitMonitor status={enhancedExitSignals} logic={trade.exit_signal_logic} trade={trade} />

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
                        : (activeSessionConfig.live_starting_balance || 10000));
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
                       { label: 'TP Mode', value: trade.tp_mode === 'exp_rr_seq' ? 'Expansion RR' : 'Fixed Ratio' },
                   {
                     label: trade.exit_ts ? 'Exit RR' : 'Exit RR (Projected)',
                     value: `${(() => {
                       if (trade.exit_rr !== undefined && trade.exit_rr !== null && trade.exit_rr !== 0) {
                         return trade.exit_rr >= 0 ? `+${Number(trade.exit_rr).toFixed(2)}` : Number(trade.exit_rr).toFixed(2);
                       }
                       const initRisk = Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price));
                       const refPrice = trade.exit_price || mark;
                       const v = (refPrice && trade.entry_price && initRisk > 0 ?
                           (trade.direction === 'LONG' ? (refPrice - trade.entry_price) : (trade.entry_price - refPrice)) / initRisk : 0);
                       return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
                     })()} R`,
                     color: (() => {
                       const initRisk = Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price));
                       const refPrice = trade.exit_price || mark;
                       const v = trade.exit_rr !== undefined && trade.exit_rr !== null && trade.exit_rr !== 0 ? trade.exit_rr :
                         (refPrice && trade.entry_price && initRisk > 0 ?
                           (trade.direction === 'LONG' ? (refPrice - trade.entry_price) : (trade.entry_price - refPrice)) / initRisk : 0);
                       return v >= 0 ? 'text-green' : 'text-red';
                     })()
                   },
                   {
                     label: 'Min RR (Drawdown)',
                     value: `${(() => {
                       const v = trade.min_rr_achieved !== undefined && trade.min_rr_achieved !== null ? trade.min_rr_achieved : 0;
                       return v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
                     })()} R`,
                     color: (trade.min_rr_achieved || 0) < 0 ? 'text-red' : 'text-dim'
                   },
                    { label: 'Commission', value: fmtUSD(-(trade.realized_fee || 0)), color: 'text-red/70' },
                    { label: 'Funding Fee', value: fmtUSD(-(trade.funding_fee || 0)), color: trade.funding_fee > 0 ? 'text-red/70' : 'text-green/70' },
                   { label: 'ROI from Entry', value: `${pnlPct.toFixed(2)}%`, color: pnlPct >= 0 ? 'text-green' : 'text-red' },
                   { label: 'Stop Distance (Live)', value: `${slDistPct.toFixed(2)}%` },
                   trade.strategy_config?.trailing_stop_enabled && {
                     label: 'Trailing Stop',
                     value: `${trade.strategy_config.trailing_stop_distance_pct}%`,
                     color: 'text-purple-400'
                   },
                   { label: 'Initial SL Dist', value: `${slInitialDistPct.toFixed(2)}%` },
                       { label: 'Max Entry Risk', value: fmtUSD(trade.initial_risk_usdt || trade.risk_usdt || 0) },
                       {
                         label: 'Daily Δ at Entry',
                         value: `${(trade.entry_daily_change_pct || 0) > 0 ? '▲' : (trade.entry_daily_change_pct || 0) < 0 ? '▼' : ''} ${Number(Math.abs(trade.entry_daily_change_pct || 0)).toFixed(2)}%`,
                         color: pnlClass(trade.entry_daily_change_pct)
                       },
                       trade.exit_ts && {
                         label: 'Exit Signal',
                         tooltip: trade.exit_signal_reason,
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
                         color: 'text-accent'
                       }
                     ].filter(Boolean).map(item => (
                       <div key={item.label} className="flex justify-between items-center py-1 md:py-2.5 border-b border-border/40 last:border-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] md:text-[10px] text-dim font-bold uppercase tracking-widest">{item.label}</span>
                          </div>
                          {item.tooltip ? (
                            <Tooltip content={item.tooltip}>
                              <span className={cn("text-xs font-bold font-mono cursor-help border-b border-dotted border-white/10", item.color)}>{item.value}</span>
                            </Tooltip>
                          ) : (
                            <span className={cn("text-xs font-bold font-mono", item.color)}>{item.value}</span>
                          )}
                       </div>
                     ))}
                  </div>
                );
              })()}
            </div>
         </div>
      </div>

      {/* Active Trade Stop Loss & Exit Monitors Configuration Workspace */}
      {trade.status === 'OPEN' && (
        <div className="mt-3 md:mt-5 pt-4 border-t border-border/40">
          <div className="flex justify-between items-center mb-3">
            <SectionLabel className="mb-0 flex items-center gap-1.5">
              <Sliders size={14} className="text-accent" /> Active Exit Guard Configuration
            </SectionLabel>
            <Btn
              variant={isEditing ? "ghost" : "primary"}
              onClick={() => setIsEditing(!isEditing)}
              className="px-3.5 py-1.5 h-8 text-[10px] uppercase tracking-wider font-black rounded-lg"
            >
              {isEditing ? "Collapse" : "Edit Config"}
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
                <div className="bg-surface/50 border border-border/40 rounded-2xl p-4 md:p-6 shadow-md backdrop-blur-md space-y-4 md:space-y-6">

                  {/* Part 1: Stop-Loss Override */}
                  <div className="space-y-2">
                    <SectionLabel className="text-[10px] text-accent/80 tracking-widest font-black uppercase">
                      Stop-Loss Override
                    </SectionLabel>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/60 font-mono text-xs">$</span>
                        <input
                          type="number"
                          step="any"
                          value={formSl}
                          onChange={(e) => setFormSl(e.target.value)}
                          className="pl-7 pr-3 py-1.5 w-full font-mono text-sm bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
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

                  {/* Part 2: Exponential RR Guard Ladder */}
                  <div className="space-y-3 pt-3 border-t border-border/30">
                    <div className="flex justify-between items-center">
                      <SectionLabel className="text-[10px] text-accent/80 tracking-widest font-black uppercase mb-0">
                        Profit-Locking Guard Ladder Milestones
                      </SectionLabel>
                      <Btn
                        variant="ghost"
                        onClick={handleAddLadderRow}
                        className="px-2 py-1 h-7 text-[9px] uppercase tracking-wider font-black rounded-md"
                        icon={Plus}
                      >
                        Add Row
                      </Btn>
                    </div>

                    {ladderValidationError && (
                      <div className="bg-red/10 border border-red/20 rounded-xl p-3 text-[10px] text-red uppercase tracking-wider font-black">
                        ⚠ {ladderValidationError}
                      </div>
                    )}

                    <div className="space-y-1.5 max-h-[220px] overflow-y-auto no-scrollbar pr-1">
                      {formLadder.map((row, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_1fr_40px] gap-2 items-center">
                          <div className="relative">
                            <input
                              type="number"
                              step="any"
                              value={row.trigger}
                              onChange={(e) => handleUpdateLadderRow(idx, "trigger", e.target.value)}
                              placeholder="Trigger RR"
                              className="px-3 py-1.5 w-full font-mono text-sm bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
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
                              placeholder="Exit SL RR"
                              className="px-3 py-1.5 w-full font-mono text-sm bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                              aria-label={`Milestone exit stop loss ${idx + 1}`}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-dim/40 font-mono">Lock R</span>
                          </div>
                          <Btn
                            variant="ghost"
                            onClick={() => handleRemoveLadderRow(idx)}
                            className="p-2 h-9 w-10 flex items-center justify-center rounded-lg hover:bg-red/10 hover:text-red hover:border-red/20 shrink-0 border border-border/40 text-dim"
                            icon={Trash}
                            aria-label={`Delete milestone row ${idx + 1}`}
                          />
                        </div>
                      ))}

                      {formLadder.length === 0 && (
                        <div className="text-center py-4 text-xs text-dim italic">
                          No guard ladder milestones configured. Add a row to enable live ratcheting.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Part 3: Exit Monitors indicator parameter overrides */}
                  <div className="space-y-3 pt-3 border-t border-border/30">
                    <SectionLabel className="text-[10px] text-accent/80 tracking-widest font-black uppercase mb-1">
                      Technical Indicator Overrides
                    </SectionLabel>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[8px] font-black text-dim uppercase tracking-wider block mb-1">Exit EMA Period</label>
                        <input
                          type="number"
                          placeholder="e.g. 12"
                          value={formOverrides.exit_ema_period}
                          onChange={(e) => setFormOverrides({ ...formOverrides, exit_ema_period: e.target.value })}
                          className="px-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-dim uppercase tracking-wider block mb-1">Supertrend Period</label>
                        <input
                          type="number"
                          placeholder="e.g. 10"
                          value={formOverrides.supertrend_period}
                          onChange={(e) => setFormOverrides({ ...formOverrides, supertrend_period: e.target.value })}
                          className="px-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-dim uppercase tracking-wider block mb-1">Supertrend Multiplier</label>
                        <input
                          type="number"
                          placeholder="e.g. 3"
                          value={formOverrides.supertrend_multiplier}
                          onChange={(e) => setFormOverrides({ ...formOverrides, supertrend_multiplier: e.target.value })}
                          className="px-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-dim uppercase tracking-wider block mb-1">MACD Fast Period</label>
                        <input
                          type="number"
                          placeholder="e.g. 12"
                          value={formOverrides.macd_fast}
                          onChange={(e) => setFormOverrides({ ...formOverrides, macd_fast: e.target.value })}
                          className="px-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-dim uppercase tracking-wider block mb-1">MACD Slow Period</label>
                        <input
                          type="number"
                          placeholder="e.g. 26"
                          value={formOverrides.macd_slow}
                          onChange={(e) => setFormOverrides({ ...formOverrides, macd_slow: e.target.value })}
                          className="px-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[8px] font-black text-dim uppercase tracking-wider block mb-1">MACD Signal Period</label>
                        <input
                          type="number"
                          placeholder="e.g. 9"
                          value={formOverrides.macd_signal}
                          onChange={(e) => setFormOverrides({ ...formOverrides, macd_signal: e.target.value })}
                          className="px-3 py-1.5 w-full font-mono text-xs bg-background/50 border border-border/50 text-text rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Saving Actions */}
                  <div className="flex justify-end gap-3 pt-3 border-t border-border/30">
                    <Btn
                      variant="ghost"
                      onClick={() => setIsEditing(false)}
                      disabled={savingConfig}
                      className="px-4 py-1.5 h-9 text-[11px] uppercase tracking-wider font-black rounded-lg"
                    >
                      Cancel
                    </Btn>
                    <Btn
                      variant="primary"
                      onClick={handleSaveTradeConfig}
                      disabled={savingConfig || !!ladderValidationError}
                      loading={savingConfig}
                      className="px-5 py-1.5 h-9 text-[11px] uppercase tracking-wider font-black rounded-lg"
                    >
                      Save Parameters
                    </Btn>
                  </div>

                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

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
