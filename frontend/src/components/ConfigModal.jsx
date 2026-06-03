import React, { useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2, Save, FolderOpen, Search, Settings2, ShieldCheck, Clock, CheckCircle2, AlertCircle, Zap, XCircle, Activity, LayoutGrid } from 'lucide-react'
import { cn, Btn, Tooltip } from './ui/primitives'
import * as Switch from '@radix-ui/react-switch'
import { CONFIG_LIMITS } from '../constants/configLimits'

const fmtUSD = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SIGNALS = [
  ['momentum_pct', '% Momentum', 'Entry when momentum exceeds threshold.'],
  ['breakout_hl', 'Breakout H/L', 'Entry when price breaks highest high or lowest low.'],
  ['ema_price_cross', 'EMA Price Cross', 'Entry when price crosses EMA.'],
  ['ema_dual_cross', 'EMA Dual Cross', 'Entry when fast EMA crosses slow EMA.'],
  ['ema_close', 'EMA Close', 'Entry when candle closes favorable side of EMA.'],
  ['ma', 'MA Cross', 'Entry when price crosses simple Moving Average.'],
  ['engulfing', 'Engulfing', 'Entry on bullish or bearish engulfing pattern.'],
]

const SectionHeader = ({ icon: Icon, title, subtitle }) => (
  <div className="flex items-center gap-3 mb-4">
    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
      <Icon size={18} />
    </div>
    <div>
      <h3 className="text-sm font-bold uppercase tracking-tight">{title}</h3>
      {subtitle && <p className="text-[10px] text-dim font-medium uppercase">{subtitle}</p>}
    </div>
  </div>
)

const Toggle = ({ value, onChange, label, color = "bg-accent" }) => (
  <label className="flex items-center gap-3 cursor-pointer group">
    <Switch.Root checked={value} onCheckedChange={onChange} className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:border-accent", value ? color : "bg-border")}>
      <Switch.Thumb className={cn("pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform", value ? "translate-x-5" : "translate-x-0")} />
    </Switch.Root>
    {label && <span className={cn("text-sm font-bold transition-colors", value ? "text-text" : "text-dim group-hover:text-dim/80")}>{label}</span>}
  </label>
)

const Chip = React.forwardRef(({ active, onClick, children, activeClass = "border-accent text-accent bg-accent/10", ...props }, ref) => (
  <button ref={ref} type="button" onClick={onClick} aria-pressed={active} className={cn("px-3 py-1.5 rounded-md border text-[11px] font-bold tracking-wider transition-all", active ? activeClass : "border-border text-dim hover:border-dim/50")} {...props}>{children}</button>
))
Chip.displayName = 'Chip'

const flattenConfig = (config) => {
  if (!config) return {};
  try {
    const params = typeof config.signal_params === 'string' ? JSON.parse(config.signal_params || '{}') : config.signal_params || {};
    return {
      ...config,
      signal_params_ma_period: params.ma_period,
      signal_params_ema_period: params.ema_period,
      signal_params_entry_ema_period: params.entry_ema_period,
      signal_params_exit_ema_period: params.exit_ema_period,
      signal_params_entry_ema_fast: params.entry_ema_fast,
      signal_params_entry_ema_slow: params.entry_ema_slow,
      signal_params_exit_ema_fast: params.exit_ema_fast,
      signal_params_exit_ema_slow: params.exit_ema_slow,
      live_rr_sequence: Array.isArray(config.live_rr_sequence) ? config.live_rr_sequence : [1.0, 2.0, 4.0],
      exit_rr_sequence: Array.isArray(config.exit_rr_sequence) ? config.exit_rr_sequence : [0.0, 1.0, 2.0],
    };
  } catch (e) { return { ...config }; }
};

export const ConfigModal = ({ initialConfig, onSave, onClose, isEdit = false }) => {
  const [cfg, setCfg] = useState(() => flattenConfig(initialConfig))
  const [section, setSection] = useState('scan')
  const [presets, setPresets] = useState([])
  const [presetName, setPresetName] = useState('')
  const [errors, setErrors] = useState({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')

  const validate = (c) => {
    const errs = {}; if (!c.scan_interval) errs.scan_interval = 'Required'; if (c.scan_lookback < 1) errs.scan_lookback = 'Min 1';
    if (c.scan_mode === 'active_window' && (!c.scan_window_duration_sec || !c.scan_check_interval_sec)) errs.scan_mode = 'Params missing';
    
    if (c.risk_pct_per_trade > c.max_total_risk_pct) {
      errs.risk_pct_per_trade = 'Exceeds max total risk'
    }

    if (c.risk_pct_per_trade > 2) {
      errs.risk_pct_per_trade_warn = 'Aggressive (>2%)'
    }

    if (c.sl_distance_pct > 5) {
      errs.sl_distance_pct_warn = 'Aggressive (>5%)'
    }

    setErrors(errs); return Object.keys(errs).length === 0;
  }

  const generatedPresetName = useMemo(() => {
    const i = cfg.scan_interval || 'Custom'; const r = cfg.risk_pct_per_trade ? `${cfg.risk_pct_per_trade}% risk` : '';
    const parts = [i, r].filter(Boolean); return parts.join(' · ') || 'New session preset';
  }, [cfg.scan_interval, cfg.risk_pct_per_trade])

  useEffect(() => { const saved = localStorage.getItem('strategy_presets'); if (saved) setPresets(JSON.parse(saved)); }, [])

  const setField = (key, value) => { const next = { ...cfg, [key]: value }; setCfg(next); if (Object.keys(errors).length > 0) validate(next); }
  const savePreset = () => { if (!validate(cfg)) return; const name = (presetName || generatedPresetName).trim(); if (!name) return; const { strategy_variants, ...pc } = cfg; const next = [...presets.filter(p => p.name !== name), { name, config: { ...pc, strategy_label: name } }]; setPresets(next); localStorage.setItem('strategy_presets', JSON.stringify(next)); setPresetName(''); setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 2000); }
  const loadPreset = (p) => { setCfg({ ...p.config }); setSection('scan'); setErrors({}); }
  const deletePreset = (e, name) => { e.stopPropagation(); const next = presets.filter(p => p.name !== name); setPresets(next); localStorage.setItem('strategy_presets', JSON.stringify(next)); }
  const toggleVariant = (e, p) => {
    e.stopPropagation()
    const variants = cfg.strategy_variants || []
    const exists = variants.some((v) => v.strategy_label === p.name)

    if (!exists && variants.length >= CONFIG_LIMITS.MAX_VARIANTS) {
      alert(`Maximum of ${CONFIG_LIMITS.MAX_VARIANTS} strategy variants allowed.`);
      return;
    }

    setField('strategy_variants', exists
      ? variants.filter((v) => v.strategy_label !== p.name)
      : [...variants, { ...p.config, strategy_label: p.name }])
  }

  const buildConfigToSave = () => {
    const c = { ...cfg, strategy_label: (cfg.strategy_label || presetName || generatedPresetName || 'Momentum Strategy').trim() };
    const sp = { ...(typeof cfg.signal_params === 'string' ? JSON.parse(cfg.signal_params || '{}') : cfg.signal_params || {}) };
    ['ma_period', 'ema_period', 'entry_ema_period', 'exit_ema_period', 'entry_ema_fast', 'entry_ema_slow', 'exit_ema_fast', 'exit_ema_slow'].forEach(k => { if (cfg[`signal_params_${k}`]) sp[k] = cfg[`signal_params_${k}`]; });
    c.signal_params = JSON.stringify(sp);
    c.strategy_variants = (cfg.strategy_variants || []).map((v) => ({ ...v, strategy_label: v.strategy_label || 'Variant', strategy_variants: [] }));
    return c;
  }

  const riskAmount = ((cfg.paper_starting_balance || 10000) * ((cfg.risk_pct_per_trade || 0) / 100))
  const sequence = useMemo(() => {
    const l = Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [];
    const ex = Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [];
    return l.map((t, i) => [t, ex[i] ?? 0]);
  }, [cfg.live_rr_sequence, cfg.exit_rr_sequence])

  function field(label, key, type = 'number', opts = null, attrs = {}, cp = null) {
    const id = `config-${key}`; const v = cp ? cp[key] : cfg[key]; const err = errors[key]; const warn = errors[`${key}_warn`];
    const onChange = (val) => { if (cp) attrs.onCustomChange(key, val); else setField(key, val); }
    return (
      <div className="flex flex-col gap-1.5 group/field">
        <div className="flex justify-between items-center"><label htmlFor={id} className="text-[10px] text-dim group-hover/field:text-accent font-black tracking-widest uppercase transition-colors">{label}</label>
          {err && <span role="alert" className="text-[9px] text-red font-bold uppercase">{err}</span>}
          {warn && !err && <span role="alert" className="text-[9px] text-amber font-bold uppercase">{warn}</span>}
        </div>
        {opts ? (
          <select id={id} value={v ?? ''} onChange={(e) => onChange(e.target.value)} className="bg-surface border border-border rounded-xl px-4 py-2.5 text-sm font-bold text-text focus:border-accent outline-none appearance-none transition-all cursor-pointer hover:border-border-hover">
            {opts.map((o) => {
              const val = typeof o === 'string' ? o : o.value;
              const lbl = typeof o === 'string' ? o : o.label;
              return <option key={val} value={val}>{lbl}</option>;
            })}
          </select>
        ) : (
          <input id={id} type={type} value={v ?? ''} {...attrs} onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} className="bg-surface border border-border rounded-xl px-4 py-2.5 text-sm font-mono font-bold text-text focus:border-accent outline-none transition-all hover:border-border-hover" />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-surface text-text overflow-hidden relative">
      <div className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md border-b border-border">
        <div className="p-5 flex justify-between items-center">
          <div><div className="text-lg font-bold">Configure Engine</div><div className="text-[11px] text-dim font-medium uppercase tracking-widest">Strategy Orchestration</div></div>
          <button type="button" onClick={onClose} aria-label="Close configuration" className="p-2 hover:bg-white/5 rounded-full transition-colors"><X size={18} className="text-dim" /></button>
        </div>
        <div className="flex gap-2 p-4 overflow-x-auto no-scrollbar touch-pan-x" data-vaul-no-drag>
          {[
            ['scan', 'Scanner', Search],
            ['strategy', 'Strategy', Zap],
            ['risk', 'Risk', ShieldCheck],
            ['advanced', 'Advanced', Settings2],
            ['presets', 'Presets', FolderOpen]
          ].map(([id, label, Icon]) => (
            <Chip key={id} active={section === id} onClick={() => setSection(id)} className="flex items-center gap-2">
              <Icon size={12} className={cn(section === id ? "text-accent" : "text-dim")} />
              {label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 pb-32 overscroll-contain" data-vaul-no-drag>
        {section === 'scan' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <section>
              <SectionHeader icon={Settings2} title="General" subtitle="Basic strategy identification" />
              {field('Strategy label', 'strategy_label', 'text', null, { placeholder: 'Momentum Strategy' })}
            </section>

            <section>
              <div className="p-4 bg-accent/5 border border-accent/20 rounded-2xl flex items-center justify-between mb-6">
                <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent"><Search size={20} /></div><div><div className="text-sm font-bold">Global Scanner</div><div className="text-[10px] text-dim font-medium uppercase">Automatic opportunity discovery</div></div></div>
                <Toggle value={cfg.global_scanner_enabled !== false} onChange={(v) => setField('global_scanner_enabled', v)} />
              </div>

              <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6", cfg.global_scanner_enabled === false && "opacity-40 pointer-events-none")}>
                {field('Timeframe', 'scan_interval', 'text', ['1m', '5m', '15m', '1h'])}
                {field('% Threshold', 'scan_pct_threshold', 'number', null, { min: CONFIG_LIMITS.SCAN_PCT_THRESHOLD_MIN, step: 0.1 })}
                {field('Watchlist size', 'watchlist_size', 'number', null, { min: CONFIG_LIMITS.WATCHLIST_MIN, max: CONFIG_LIMITS.WATCHLIST_MAX })}
                {field('Entry side', 'entry_side', 'text', ['both', 'long', 'short'])}
                {field('Lookback (Candles)', 'scan_lookback', 'number', null, { min: 1 })}
                {field('Min Volume (USDT)', 'scan_min_volume_usdt', 'number', null, { min: 0, step: 100000 })}
                {field('Scan Mode', 'scan_mode', 'text', [
                  { value: 'interval', label: 'Fixed Interval' },
                  { value: 'active_window', label: 'Momentum Window' }
                ])}
                {cfg.scan_mode === 'active_window' && (
                  <>
                    {field('Window Duration (s)', 'scan_window_duration_sec', 'number', null, { min: 1 })}
                    {field('Check Interval (s)', 'scan_check_interval_sec', 'number', null, { min: 1 })}
                  </>
                )}
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={Plus} title="Static Watchlist" subtitle="Rank only these symbols (leave empty for all)" />
              <input type="text" placeholder="BTCUSDT,ETHUSDT,SOLUSDT..." value={cfg.symbols?.join(',') || ''} onChange={(e) => setField('symbols', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent outline-none hover:border-border-hover transition-colors" />
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={XCircle} title="Exclusion List" subtitle="Symbols to never trade" />
              <input type="text" placeholder="BTCUSDT,ETHUSDT..." value={cfg.excluded_symbols?.join(',') || ''} onChange={(e) => setField('excluded_symbols', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent outline-none hover:border-border-hover transition-colors" />
            </section>

            <section className="pt-6 border-t border-border/40">
               <SectionHeader icon={ShieldCheck} title="Manual Monitors" subtitle="Specific symbols to track" />
               <div className="flex gap-2"><input type="text" placeholder="BTCUSDT" value={symbolSearch} onChange={(e) => setSymbolSearch(e.target.value.toUpperCase())} className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono focus:border-accent outline-none" /><Btn variant="primary" onClick={() => { if (!symbolSearch) return; setField('single_symbol_configs', [...(cfg.single_symbol_configs || []), { symbol: symbolSearch, enabled: true, follow_schedule: true }]); setSymbolSearch(''); }} className="aspect-square p-0 w-12 h-12 flex items-center justify-center"><Plus size={20} /></Btn></div>
               <div className="flex flex-wrap gap-2 mt-4">
                 {(cfg.single_symbol_configs || []).map((sc, i) => (
                   <Chip key={i} active activeClass="bg-accent/10 border-accent/40 text-accent" onClick={() => setField('single_symbol_configs', cfg.single_symbol_configs.filter((_, idx) => idx !== i))}>{sc.symbol} <X size={10} className="inline ml-1" /></Chip>
                 ))}
               </div>
            </section>
          </div>
        )}

        {section === 'strategy' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <section>
              <div className="flex justify-between items-center mb-4">
                <SectionHeader icon={Zap} title="Entry Signals" subtitle="Triggers for opening positions" />
                <div className="flex bg-background p-1 rounded-lg border border-border shadow-inner">
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'any' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'any')}>ANY</button>
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'all' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'all')}>ALL</button>
                 </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SIGNALS.map(([key, label, desc]) => {
                  const active = (cfg.enabled_signals || []).includes(key);
                  return (
                    <Tooltip key={key} content={desc} side="bottom">
                      <Chip active={active} onClick={() => setField('enabled_signals', active ? cfg.enabled_signals.filter(s => s !== key) : [...(cfg.enabled_signals || []), key])}>{label}</Chip>
                    </Tooltip>
                  )
                })}
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={Activity} title="Signal Parameters" subtitle="Technical indicator periods" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {field('MA Period', 'signal_params_ma_period', 'number', null, { min: 1 })}
                {field('EMA Period', 'signal_params_ema_period', 'number', null, { min: 1 })}
                {field('Entry EMA TF', 'signal_params_entry_ema_period', 'number', null, { min: 1 })}
                {field('Exit EMA TF', 'signal_params_exit_ema_period', 'number', null, { min: 1 })}
                {field('Entry Fast', 'signal_params_entry_ema_fast', 'number', null, { min: 1 })}
                {field('Entry Slow', 'signal_params_entry_ema_slow', 'number', null, { min: 1 })}
                {field('Exit Fast', 'signal_params_exit_ema_fast', 'number', null, { min: 1 })}
                {field('Exit Slow', 'signal_params_exit_ema_slow', 'number', null, { min: 1 })}
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
               <div className="flex justify-between items-center mb-4">
                 <SectionHeader icon={XCircle} title="Exit Signals" subtitle="Automated early closures" />
                 <div className="flex bg-background p-1 rounded-lg border border-border shadow-inner">
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.exit_signal_logic || 'any') === 'any' ? "bg-red text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('exit_signal_logic', 'any')}>ANY</button>
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", cfg.exit_signal_logic === 'all' ? "bg-red text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('exit_signal_logic', 'all')}>ALL</button>
                 </div>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                 {SIGNALS.map(([key, label, desc]) => {
                   const active = (cfg.exit_signals || []).includes(key);
                   return (
                    <Tooltip key={key} content={desc}>
                      <button
                        type="button"
                        onClick={() => setField('exit_signals', active ? cfg.exit_signals.filter(s => s !== key) : [...(cfg.exit_signals || []), key])}
                        className={cn("w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left", active ? "border-red/40 bg-red/5" : "border-border hover:border-border-hover bg-surface/50")}
                      >
                        <span className={cn("text-xs font-bold", active ? "text-red" : "text-text")}>{label}</span>
                        <Switch.Root checked={active} className={cn("h-5 w-9 rounded-full transition-colors relative pointer-events-none", active ? "bg-red" : "bg-border")}>
                          <Switch.Thumb className={cn("block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-100", active ? "translate-x-4" : "translate-x-1")} />
                        </Switch.Root>
                      </button>
                    </Tooltip>
                   )
                 })}
               </div>
            </section>
          </div>
        )}

        {section === 'risk' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <section>
              <SectionHeader icon={ShieldCheck} title="Capital Guards" subtitle="Global safety limits" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {field('Risk % Per Trade', 'risk_pct_per_trade', 'number', null, { min: CONFIG_LIMITS.RISK_PER_TRADE_MIN, max: CONFIG_LIMITS.RISK_PER_TRADE_MAX, step: 0.1 })}
                {field('Max Total Risk %', 'max_total_risk_pct', 'number', null, { min: CONFIG_LIMITS.MAX_TOTAL_RISK_MIN, max: CONFIG_LIMITS.MAX_TOTAL_RISK_MAX })}
                {field('Max Open Trades', 'max_open_trades', 'number', null, { min: CONFIG_LIMITS.MAX_OPEN_TRADES_MIN })}
                {field('SL Guard (USDT)', 'total_sl_guard_usdt', 'number', null, { min: 0 })}
              </div>
              <div className="mt-4 p-4 bg-accent/5 border border-accent/20 rounded-2xl flex justify-between items-center">
                <div className="flex flex-col"><span className="text-[9px] text-dim uppercase font-bold tracking-widest mb-1">Theoretical Sizing</span><span className="text-sm font-bold font-mono text-amber">{fmtUSD(riskAmount)} <span className="text-[10px] opacity-60 font-medium">AT RISK</span></span></div>
                <div className="flex flex-col text-right"><span className="text-[9px] text-dim uppercase font-bold tracking-widest mb-1">Return Goal</span><span className="text-sm font-bold font-mono text-accent">{cfg.tp_ratio || 2.0}R <span className="text-[10px] opacity-60 font-medium">REWARD</span></span></div>
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={ShieldCheck} title="Stop Loss Strategy" subtitle="Risk truncation parameters" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {field('Strategy Type', 'sl_type', 'text', [
                  { value: 'pct', label: 'Fixed Percentage' },
                  {value: 'lookback_low/high', label: 'High/Low Stop' }
                ])}
                {cfg.sl_type === 'pct' ? (
                  field('Distance %', 'sl_distance_pct', 'number', null, { min: CONFIG_LIMITS.SL_DISTANCE_MIN, max: CONFIG_LIMITS.SL_DISTANCE_MAX, step: 0.1 })
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {field('Lookback Period', 'sl_lookback_period', 'number', null, { min: 1 })}
                    {field('Lookback TF', 'sl_lookback_timeframe', 'text', ['1m', '5m', '15m', '1h'])}
                  </div>
                )}
                {cfg.sl_type !== 'pct' && field('Max Allowed SL %', 'sl_pct_limit', 'number', null, { min: 0.1, step: 0.1 })}
                <div className="grid grid-cols-2 gap-4">
                  {field('Floor Min %', 'sl_min_pct', 'number', null, { min: 0.1, step: 0.1 })}
                  {field('Ceiling Max %', 'sl_max_pct', 'number', null, { min: 0.1, step: 0.1 })}
                </div>
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={Target} title="Profit Realization" subtitle="Locking gains and scaling exits" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {field('Exit Strategy', 'tp_mode', 'text', [
                  { value: 'fixed', label: 'Fixed Ratio (TP)' },
                  { value: 'exp_rr_seq', label: 'Dynamic RR Milestone' }
                ])}
                {cfg.tp_mode === 'fixed' ? field('Fixed Ratio (R)', 'tp_ratio', 'number', null, { min: 0.1, step: 0.1 }) : <div />}
              </div>
              {cfg.tp_mode === 'exp_rr_seq' && (
                <div className="space-y-2 mt-6 bg-background/50 p-5 rounded-2xl border border-border/40 shadow-inner">
                  <div className="flex justify-between text-[10px] text-dim font-bold uppercase tracking-widest mb-3 px-1">
                    <span>Live RR Milestone</span>
                    <span>Adjust SL to (R)</span>
                  </div>
                  {sequence.map(([live, exit], i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="relative flex-1">
                        <input type="number" step="0.1" value={live} onChange={(e) => {
                          const next = [...(Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [1.0, 2.0, 4.0])];
                          next[i] = Number(e.target.value);
                          setField('live_rr_sequence', next);
                        }} className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs font-mono text-text focus:border-accent outline-none pr-7" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim/40">R</span>
                      </div>
                      <ArrowRight size={14} className="text-dim/20 shrink-0" />
                      <div className="relative flex-1">
                        <input type="number" step="0.1" value={exit} onChange={(e) => {
                          const next = [...(Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [0.0, 1.0, 2.0])];
                          next[i] = Number(e.target.value);
                          setField('exit_rr_sequence', next);
                        }} className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-xs font-mono text-text focus:border-accent outline-none pr-7" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim/40">R</span>
                      </div>
                      <button type="button" onClick={() => {
                        const nextL = [...(cfg.live_rr_sequence || [])];
                        const nextE = [...(cfg.exit_rr_sequence || [])];
                        nextL.splice(i, 1);
                        nextE.splice(i, 1);
                        setCfg(prev => ({ ...prev, live_rr_sequence: nextL, exit_rr_sequence: nextE }));
                      }} aria-label="Remove milestone" className="p-2 text-dim hover:text-red transition-colors rounded-lg hover:bg-red/5"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => {
                    const nextL = [...(Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [1.0, 2.0, 4.0]), 5.0];
                    const nextE = [...(Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [0.0, 1.0, 2.0]), 3.0];
                    setCfg(prev => ({ ...prev, live_rr_sequence: nextL, exit_rr_sequence: nextE }));
                  }} className="w-full py-3 border border-dashed border-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all mt-2 group flex items-center justify-center gap-2"><Plus size={14} className="group-hover:scale-110 transition-transform" /> Add RR Milestone</button>
                </div>
              )}
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={Clock} title="Frequency & Schedule" subtitle="Execution windows & limits" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
                {field('Period Limit', 'max_trades_per_period', 'number', null, { min: 0 })}
                {field('Period (min)', 'trades_period_min', 'number', null, { min: 1 })}
                {field('Max Per Sym', 'max_open_trades_per_symbol', 'number', null, { min: 1 })}
              </div>

              <div className="p-4 bg-background rounded-2xl border border-border/50 flex items-center justify-between mb-6 group hover:border-accent/30 transition-colors">
                 <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent"><LayoutGrid size={20} /></div>
                   <div>
                     <div className="text-sm font-bold">Time-of-Day Risk</div>
                     <div className="text-[10px] text-dim font-medium uppercase tracking-tight">Block entries during low-winrate hours</div>
                   </div>
                 </div>
                 <Toggle value={cfg.risk_use_tod_stats === true} onChange={(v) => setField('risk_use_tod_stats', v)} />
               </div>
               {cfg.risk_use_tod_stats && <div className="mb-6 animate-in slide-in-from-top-2 duration-300">{field('Minimum Required TOD Winrate %', 'tod_min_winrate', 'number', null, { min: 0, max: 100 })}</div>}

               <div className="space-y-3">
                 <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex items-center gap-2 px-1"><Clock size={12} /> Daily Execution Windows (UTC)</div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   {(cfg.trading_windows || []).map((w, i) => (
                     <div key={i} className="flex gap-2 p-3 bg-surface/50 border border-border rounded-xl items-center shadow-sm">
                       <input type="text" value={w.start} onChange={(e) => { const wins = [...(cfg.trading_windows || [])]; wins[i].start = e.target.value; setField('trading_windows', wins); }} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-center focus:border-accent outline-none" />
                       <span className="text-dim/40 font-mono text-[10px]">to</span>
                       <input type="text" value={w.end} onChange={(e) => { const wins = [...(cfg.trading_windows || [])]; wins[i].end = e.target.value; setField('trading_windows', wins); }} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-center focus:border-accent outline-none" />
                       <button type="button" onClick={() => setField('trading_windows', cfg.trading_windows.filter((_, idx) => idx !== i))} aria-label="Remove window" className="p-2 text-dim hover:text-red transition-colors"><Trash2 size={16} /></button>
                     </div>
                   ))}
                   <button type="button" onClick={() => setField('trading_windows', [...(cfg.trading_windows || []), { start: '09:00', end: '17:00' }])} className="w-full py-3 border border-dashed border-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-dim hover:text-accent hover:border-accent/40 hover:bg-accent/5 transition-all flex items-center justify-center gap-2"><Plus size={14} /> Add Window</button>
                 </div>
               </div>
            </section>
          </div>
        )}

        {section === 'advanced' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <section>
              <SectionHeader icon={Briefcase} title="Execution Environment" subtitle="Target exchange and mode" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {['paper', 'testnet', 'live'].map(m => (
                  <button key={m} type="button" onClick={() => { setField('trading_mode', m); setField('paper_mode', m === 'paper'); }} className={cn("p-4 rounded-xl border-2 text-left transition-all relative group", (cfg.trading_mode === m || (m === 'paper' && cfg.paper_mode && !cfg.trading_mode)) ? "border-accent bg-accent/5" : "border-border bg-surface hover:border-border-hover")}>
                    <div className="flex items-center justify-between mb-1"><span className="text-xs font-black uppercase tracking-tighter capitalize">{m}</span>{(cfg.trading_mode === m || (m === 'paper' && cfg.paper_mode && !cfg.trading_mode)) && <CheckCircle2 size={14} className="text-accent" />}</div>
                    <p className="text-[9px] text-dim font-bold uppercase tracking-widest">{m === 'paper' ? 'Simulated' : m === 'testnet' ? 'Demo API' : 'Real Capital'}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={TrendingUp} title="Initial Capital" subtitle="Starting balance for sessions" />
              <div className="grid grid-cols-2 gap-6">
                {field('Paper Balance ($)', 'paper_starting_balance', 'number', null, { min: 0 })}
                {field('Live Balance ($)', 'live_starting_balance', 'number', null, { min: 0 })}
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={Activity} title="Engine Performance" subtitle="Hot and main loop cadences" />
              <div className="grid grid-cols-2 gap-6 mb-6">
                {field('Hot Loop (ms)', 'hot_loop_interval_ms', 'number', null, { min: CONFIG_LIMITS.HOT_LOOP_MIN })}
                {field('Main Loop (ms)', 'main_loop_interval_ms', 'number', null, { min: CONFIG_LIMITS.MAIN_LOOP_MIN })}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 bg-background rounded-2xl border border-border/50 group hover:border-accent/30 transition-colors">
                  <div><div className="text-sm font-bold">Track Rate Limits</div><div className="text-[10px] text-dim font-medium uppercase tracking-tight">Monitor Binance API weights</div></div>
                  <Toggle value={cfg.track_binance_rate_limits !== false} onChange={(v) => setField('track_binance_rate_limits', v)} />
                </div>
                <div className="flex items-center justify-between p-4 bg-background rounded-2xl border border-border/50 group hover:border-amber/30 transition-colors">
                  <div><div className="text-sm font-bold">Debug Mode</div><div className="text-[10px] text-dim font-medium uppercase tracking-tight">Verbose server-side logs</div></div>
                  <Toggle value={cfg.debug_mode === true} onChange={(v) => setField('debug_mode', v)} color="bg-amber" />
                </div>
              </div>
            </section>
          </div>
        )}

        {section === 'presets' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <section>
              <SectionHeader icon={Save} title="Save Strategy" subtitle="Store current configuration as a preset" />
              <div className="flex gap-2">
                <input type="text" placeholder="Preset name (e.g. Scalp High Vol)" value={presetName} onChange={(e) => setPresetName(e.target.value)} className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent outline-none" />
                <Btn variant="primary" onClick={savePreset} className="aspect-square p-0 w-12 h-12 flex items-center justify-center">
                  {saveSuccess ? <CheckCircle2 size={20} /> : <Save size={20} />}
                </Btn>
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <div className="flex justify-between items-center mb-4">
                <SectionHeader icon={FolderOpen} title="Manage Presets" subtitle="Load or combine strategies" />
                <div className="text-[9px] text-dim font-black uppercase bg-background px-2 py-1 rounded border border-border">
                  {cfg.strategy_variants?.length || 0} / {CONFIG_LIMITS.MAX_VARIANTS} Variants
                </div>
              </div>

              <div className="space-y-3">
                {presets.length === 0 ? (
                  <div className="p-12 border-2 border-dashed border-border rounded-2xl text-center">
                    <FolderOpen size={32} className="mx-auto mb-4 text-dim/20" />
                    <div className="text-xs font-bold text-dim uppercase">No saved presets</div>
                  </div>
                ) : presets.map(p => {
                  const isVariant = (cfg.strategy_variants || []).some(v => v.strategy_label === p.name);
                  return (
                    <div key={p.name} className="flex items-center justify-between p-4 bg-background border border-border rounded-2xl transition-all group/preset">
                      <button type="button" onClick={() => loadPreset(p)} className="flex-1 flex items-center gap-4 text-left">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border transition-colors", isVariant ? "bg-accent border-accent text-white" : "bg-surface border-border text-dim group-hover/preset:border-accent/20")}>
                          {isVariant ? <ShieldCheck size={20} /> : <Zap size={20} />}
                        </div>
                        <div>
                          <div className="text-sm font-bold group-hover/preset:text-accent transition-colors">{p.name}</div>
                          <div className="text-[10px] text-dim font-bold uppercase tracking-tight">{p.config.scan_interval} · {p.config.scan_pct_threshold}% · {p.config.risk_pct_per_trade}% Risk</div>
                        </div>
                      </button>
                      <div className="flex items-center gap-2">
                        <Tooltip content={isVariant ? "Remove from variants" : "Add as strategy variant"}>
                          <button
                            type="button"
                            onClick={(e) => toggleVariant(e, p)}
                            aria-label={isVariant ? `Remove ${p.name} from variants` : `Add ${p.name} as variant`}
                            className={cn("p-2 rounded-lg transition-all active:scale-95", isVariant ? "bg-accent/10 text-accent border border-accent/20" : "bg-surface border border-border text-dim hover:text-accent hover:border-accent/20")}
                          >
                            {isVariant ? <XCircle size={16} /> : <Plus size={16} />}
                          </button>
                        </Tooltip>
                        <button
                          type="button"
                          onClick={(e) => deletePreset(e, p.name)}
                          aria-label={`Delete preset ${p.name}`}
                          className="p-2 text-dim hover:text-red transition-colors rounded-lg hover:bg-red/5"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        )}
      </div>

      <div className="p-5 border-t border-border bg-surface flex gap-3 sticky bottom-0">
        <Btn variant="ghost" onClick={onClose} className="flex-1">Cancel</Btn>
        <Btn variant="primary" onClick={() => { if (validate(cfg)) onSave(buildConfigToSave()); }} className="flex-[2]">{isEdit ? 'Apply Changes' : 'Start Session'}</Btn>
      </div>
    </div>
  )
}

