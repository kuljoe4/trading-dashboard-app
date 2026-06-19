import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Plus, Trash2, Save, FolderOpen, Search, Settings2, ShieldCheck, Clock, CheckCircle2, Zap, XCircle, Activity, LayoutGrid, Briefcase, TrendingUp, Target, ArrowRight } from 'lucide-react'
import { cn, Btn, Tooltip, PaperBadge, DemoBadge, LiveBadge } from './ui/primitives'
import * as Switch from '@radix-ui/react-switch'
import { CONFIG_LIMITS } from '../constants/configLimits'
import { settingsAPI } from '../api/client'

const fmtUSD = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SIGNALS = [
  ['momentum_pct', '% Momentum', 'Entry when momentum exceeds threshold.'],
  ['breakout_hl', 'Breakout H/L', 'Entry when price breaks highest high or lowest low.'],
  ['ema_price_cross', 'EMA Price Cross', 'Entry when price crosses EMA.'],
  ['ema_dual_cross', 'EMA Dual Cross', 'Entry when fast EMA crosses slow EMA.'],
  ['ema_close', 'EMA Close', 'Entry when candle closes favorable side of EMA.'],
  ['ema_dual_close', 'EMA Dual Close', 'Entry when candle closes above both EMAs.'],
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
      trading_mode: config.trading_mode || (config.paper_mode ? 'paper' : 'live'),
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
      trailing_guard_buffer_pct: config.trailing_guard_buffer_pct !== undefined ? config.trailing_guard_buffer_pct : CONFIG_LIMITS.TRAILING_GUARD_DEFAULT,
      // UI Conversion: backend decimal to UI percentage
      slippage_warning_threshold: config.slippage_warning_threshold !== undefined ? config.slippage_warning_threshold * 100 : (CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT * 100 || 0.1),
    };
  } catch (e) { return { ...config }; }
};
export const ConfigModal = ({ initialConfig, onSave, onClose, isEdit = false }) => {
  const [cfg, setCfg] = useState(() => {
    const savedDraft = sessionStorage.getItem('config_draft');
    if (savedDraft) return JSON.parse(savedDraft);
    return flattenConfig(initialConfig);
  });
  const [isDirty, setIsDirty] = useState(() => {
    const savedDraft = sessionStorage.getItem('config_draft');
    return !!savedDraft;
  });

  const [section, setSection] = useState('scan')
  const [presets, setPresets] = useState([])
  const [presetName, setPresetName] = useState('')
  const [errors, setErrors] = useState({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')
  const [testnetConfigured, setTestnetConfigured] = useState(false)
  const [liveConfigured, setLiveConfigured] = useState(false)
  const [modeWarning, setModeWarning] = useState(null)
  const [loadedPresetName, setLoadedPresetName] = useState(() => sessionStorage.getItem('loaded_preset_name'));

  useEffect(() => {
    sessionStorage.setItem('config_draft', JSON.stringify(cfg));
    if (loadedPresetName) sessionStorage.setItem('loaded_preset_name', loadedPresetName);
    else sessionStorage.removeItem('loaded_preset_name');
  }, [cfg, loadedPresetName]);

  const validate = (c) => {
    // ... (rest of the component logic)

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

  // Check API key configuration for testnet and live modes
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await settingsAPI.getKeys()
        console.log('[ConfigModal] API keys response:', res)
        console.log('[ConfigModal] Keys data:', res.data)
        const tn = !!res.data.testnet_api_key
        const ln = !!res.data.api_key
        console.log('[ConfigModal] Testnet configured:', tn, 'Live configured:', ln)
        setTestnetConfigured(tn)
        setLiveConfigured(ln)
      } catch (e) {
        console.log('[ConfigModal] Error checking keys:', e.message)
        // If we can't check, assume not configured
        setTestnetConfigured(false)
        setLiveConfigured(false)
      }
    }
    checkConfig()
  }, [])

  const setField = (key, value) => { 
    console.log('[ConfigModal] setField called:', key, '=', value)
    setIsDirty(true); // Mark as dirty on any change
    setCfg(prev => {
      const next = { ...prev, [key]: value };
      console.log('[ConfigModal] New config state:', next)
      if (Object.keys(errors).length > 0) validate(next);
      return next;
    });
  }
  
  const resetToLastSaved = () => {
    sessionStorage.removeItem('config_draft');
    setCfg(flattenConfig(initialConfig));
    setIsDirty(false);
    setErrors({});
  };
  
  const handleModeSelect = (mode) => {
    console.log('[ConfigModal] Mode selected:', mode, 'testnetConfigured:', testnetConfigured, 'liveConfigured:', liveConfigured)
    setModeWarning(null)
    if (mode === 'testnet' && !testnetConfigured) {
      console.log('[ConfigModal] Blocking testnet - not configured')
      setModeWarning('Testnet API keys not configured. Please add them in Settings first.')
      return
    }
    if (mode === 'live' && !liveConfigured) {
      console.log('[ConfigModal] Blocking live - not configured')
      setModeWarning('Live API keys not configured. Please add them in Settings first.')
      return
    }
    console.log('[ConfigModal] Proceeding with mode selection:', mode)
    setCfg(prev => ({
      ...prev,
      trading_mode: mode,
      paper_mode: mode === 'paper'
    }))
  }

  const savePreset = () => { if (!validate(cfg)) return; const name = (presetName || generatedPresetName).trim(); if (!name) return; const { strategy_variants, ...pc } = cfg; const next = [...presets.filter(p => p.name !== name), { name, config: { ...pc, strategy_label: name } }]; setPresets(next); localStorage.setItem('strategy_presets', JSON.stringify(next)); setPresetName(''); setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 2000); }
  const loadPreset = (p) => { 
    setCfg({ ...p.config }); 
    setLoadedPresetName(p.name);
    setSection('scan'); 
    setErrors({}); 
    setIsDirty(false);
  }
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
    c.signal_params = sp;
    c.trailing_guard_buffer_pct = cfg.trailing_guard_buffer_pct;
    // UI Conversion: UI percentage back to backend decimal
    if (c.slippage_warning_threshold !== undefined) {
      c.slippage_warning_threshold = c.slippage_warning_threshold / 100;
    }
    c.strategy_variants = (cfg.strategy_variants || []).map((v) => ({ ...v, strategy_label: v.strategy_label || 'Variant', strategy_variants: [] }));
    return c;
  }

  const currentModeBalance = cfg.trading_mode === 'paper' ? (cfg.paper_starting_balance || 10000) : cfg.trading_mode === 'testnet' ? (cfg.testnet_starting_balance || 0) : (cfg.live_starting_balance || 0);
  const riskAmount = (currentModeBalance * ((cfg.risk_pct_per_trade || 0) / 100))
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
          <div className="min-w-0 flex-1 mr-4">
             <div className="text-lg font-black tracking-tight truncate uppercase flex items-center gap-2">
               {cfg.strategy_label || 'Configure Engine'}
               {isDirty && <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />}
             </div>
             <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex items-center gap-2 truncate">
               {isDirty ? (
                 <span className="text-accent flex items-center gap-1.5 shrink-0">
                   <Activity size={10} className="animate-pulse" /> Unsaved Changes
                 </span>
               ) : (
                 <span className="flex items-center gap-1.5 shrink-0">
                   <ShieldCheck size={10} className="text-green/60" /> Strategy Synced
                 </span>
               )}
               <span className="opacity-40">/</span>
               <span className="truncate">Orchestration Center</span>
             </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close configuration" className="p-2 hover:bg-white/5 rounded-full transition-colors shrink-0"><X size={18} className="text-dim" /></button>
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

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 md:p-6 pb-32 overscroll-contain" data-vaul-no-drag>
        {section === 'scan' && (
          <div className="space-y-6 lg:space-y-8 animate-in fade-in duration-300">
            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <SectionHeader icon={Settings2} title="General" subtitle="Basic strategy identification" />
              {field('Strategy label', 'strategy_label', 'text', null, { placeholder: 'Momentum Strategy' })}
            </section>

            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <div className="p-4 bg-accent/5 border border-accent/20 rounded-2xl flex items-center justify-between mb-6">
                <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent"><Search size={20} /></div><div><div className="text-sm font-bold">Global Scanner</div><div className="text-[10px] text-dim font-medium uppercase">Automatic discovery</div></div></div>
                <Toggle value={cfg.global_scanner_enabled !== false} onChange={(v) => setField('global_scanner_enabled', v)} />
              </div>

              <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6", cfg.global_scanner_enabled === false && "opacity-40 pointer-events-none")}>
                {field('Timeframe', 'scan_interval', 'text', ['1m', '5m', '15m', '1h'])}
                {field('% Threshold', 'scan_pct_threshold', 'number', null, { min: CONFIG_LIMITS.SCAN_PCT_THRESHOLD_MIN, step: 0.1 })}
                {field('Watchlist size', 'watchlist_size', 'number', null, { min: CONFIG_LIMITS.WATCHLIST_MIN, max: CONFIG_LIMITS.WATCHLIST_MAX })}
                {field('Watchlist Offset', 'watchlist_offset', 'number', null, { min: 0, max: 100 })}
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

            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <SectionHeader icon={Plus} title="Static Watchlist" subtitle="Rank only these symbols (comma separated)" />
              <input type="text" placeholder="BTCUSDT, ETHUSDT, SOLUSDT..." value={cfg.symbols?.join(', ') || ''} onChange={(e) => setField('symbols', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent outline-none hover:border-border-hover transition-colors" />
            </section>

            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <SectionHeader icon={XCircle} title="Exclusion List" subtitle="Symbols to never trade" />
              <input type="text" placeholder="BTCUSDT, ETHUSDT..." value={cfg.excluded_symbols?.join(', ') || ''} onChange={(e) => setField('excluded_symbols', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent outline-none hover:border-border-hover transition-colors" />
            </section>

            <section className="pt-6 border-t border-border/40">
               <div className="flex justify-between items-center mb-4">
                 <SectionHeader icon={ShieldCheck} title="Manual Monitors" subtitle="Specific symbols to track" />
                 {(cfg.single_symbol_configs || []).length > 0 && <button type="button" onClick={() => setField('single_symbol_configs', [])} className="text-[10px] font-black uppercase tracking-widest text-red/60 hover:text-red transition-colors flex items-center gap-1.5"><Trash2 size={12} /> Clear All</button>}
               </div>
               <div className="flex gap-2">
                 <div className="relative flex-1">
                   <input type="text" placeholder="BTCUSDT" value={symbolSearch} onChange={(e) => setSymbolSearch(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (symbolSearch) { setField('single_symbol_configs', [...(cfg.single_symbol_configs || []), { symbol: symbolSearch, enabled: true, follow_schedule: true }]); setSymbolSearch(''); } } if (e.key === 'Escape') setSymbolSearch(''); }} className="w-full bg-surface border border-border rounded-xl pl-4 pr-10 py-3 text-sm font-mono focus:border-accent outline-none hover:border-border-hover transition-colors" />
                   {symbolSearch && <button type="button" onClick={() => setSymbolSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors" aria-label="Clear input"><X size={16} /></button>}
                 </div>
                 <Btn variant="primary" onClick={() => { if (symbolSearch) { setField('single_symbol_configs', [...(cfg.single_symbol_configs || []), { symbol: symbolSearch, enabled: true, follow_schedule: true }]); setSymbolSearch(''); } }} className="aspect-square p-0 w-12 h-12 flex items-center justify-center"><Plus size={20} /></Btn>
               </div>
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
          <div className="space-y-6 lg:space-y-8 animate-in fade-in duration-300">
            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <div className="flex justify-between items-center mb-4">
                <SectionHeader icon={Zap} title="Entry Signals" subtitle="Triggers for opening positions" />
                <div className="flex bg-background p-1 rounded-lg border border-border shadow-inner">
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'any' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'any')}>ANY</button>
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'all' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'all')}>ALL</button>
                 </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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

              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                {field('MA Period', 'signal_params_ma_period', 'number', null, { min: 1 })}
                <Tooltip content="Global fallback period used if specific Entry/Exit EMA is not set">
                  {field('EMA (Global Fallback)', 'signal_params_ema_period', 'number', null, { min: 1 })}
                </Tooltip>
              </div>

              <div className="space-y-6">
                <div className="bg-background/20 p-4 rounded-2xl border border-border/50">
                  <div className="text-[9px] font-black text-dim uppercase tracking-[0.2em] mb-4">Entry Specific EMAs</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                    {field('Entry Period', 'signal_params_entry_ema_period', 'number', null, { min: 1 })}
                    {field('Entry Fast', 'signal_params_entry_ema_fast', 'number', null, { min: 1 })}
                    {field('Entry Slow', 'signal_params_entry_ema_slow', 'number', null, { min: 1 })}
                  </div>
                </div>

                <div className="bg-background/20 p-4 rounded-2xl border border-border/50">
                  <div className="text-[9px] font-black text-dim uppercase tracking-[0.2em] mb-4">Exit Specific EMAs</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                    {field('Exit Period', 'signal_params_exit_ema_period', 'number', null, { min: 1 })}
                    {field('Exit Fast', 'signal_params_exit_ema_fast', 'number', null, { min: 1 })}
                    {field('Exit Slow', 'signal_params_exit_ema_slow', 'number', null, { min: 1 })}
                  </div>
                </div>
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
                    <div key={key} className="flex flex-col gap-2">
                      <Tooltip content={desc}>
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
                      {active && (
                        <div className="px-1 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                          <label className="text-[9px] font-bold text-dim uppercase tracking-wider">Delay Trigger (s)</label>
                          <input
                            type="number"
                            min="0"
                            placeholder="0s"
                            value={(cfg.exit_signal_delays || {})[key] || ''}
                            onChange={(e) => {
                              const val = Math.max(0, parseInt(e.target.value) || 0);
                              setField('exit_signal_delays', { ...(cfg.exit_signal_delays || {}), [key]: val });
                            }}
                            className="w-20 bg-background border border-border rounded-lg px-2 py-1 text-[10px] font-mono font-bold text-right focus:border-red outline-none"
                          />
                        </div>
                      )}
                    </div>
                   )
                 })}
               </div>
            </section>
          </div>
        )}

        {section === 'risk' && (
          <div className="space-y-6 lg:space-y-8 animate-in fade-in duration-300">
            <section>
              <SectionHeader icon={ShieldCheck} title="Capital Guards" subtitle="Global safety limits" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {field('Risk % Per Trade', 'risk_pct_per_trade', 'number', null, { min: CONFIG_LIMITS.RISK_PER_TRADE_MIN, max: CONFIG_LIMITS.RISK_PER_TRADE_MAX, step: 0.1 })}
                {field('Max Total Risk %', 'max_total_risk_pct', 'number', null, { min: CONFIG_LIMITS.MAX_TOTAL_RISK_MIN, max: CONFIG_LIMITS.MAX_TOTAL_RISK_MAX })}
                {field('Max Open Trades', 'max_open_trades', 'number', null, { min: CONFIG_LIMITS.MAX_OPEN_TRADES_MIN })}
                {field('SL Guard (USDT)', 'total_sl_guard_usdt', 'number', null, { min: 0 })}
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
                        Math: {fmtUSD(riskAmount)} Target Risk / {(cfg.sl_distance_pct || 0.8).toFixed(1)}% SL = {fmtUSD(riskAmount / ((cfg.sl_distance_pct || 0.8) / 100))} Notional
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
                <div className="md:col-span-2">
                  <Tooltip content="Safety buffer that prevents trailing stops from being placed too close to the market price. This avoids 'Order would immediately trigger' errors and instant fills during high volatility. Recommended: 0.03% to 0.05%.">
                    {field('Trailing Guard (%)', 'trailing_guard_buffer_pct', 'number', null, { min: CONFIG_LIMITS.TRAILING_GUARD_MIN, max: CONFIG_LIMITS.TRAILING_GUARD_MAX, step: 0.01 })}
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
              <SectionHeader icon={Clock} title="Frequency & Temporal Risk" subtitle="Execution windows & frequency shaping" />

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

                {cfg.frequency_shaping_enabled && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 md:grid-cols-4 gap-6 p-5 bg-surface/30 rounded-2xl border border-border/40 mb-6">
                    {field('Period Limit', 'max_trades_per_period', 'number', null, { min: 0 })}
                    {field('Period (min)', 'trades_period_min', 'number', null, { min: 1 })}
                    {field('Max 24h', 'max_trades_24h', 'number', null, { min: 0 })}
                    {field('Min Interval (m)', 'min_trade_interval_min', 'number', null, { min: 0 })}
                    <div className="md:col-span-2">
                      {field('Window Jitter (%)', 'trades_jitter_pct', 'number', null, { min: 0, max: 100 })}
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
                    {field('Minimum Required TOD Winrate %', 'tod_min_winrate', 'number', null, { min: 0, max: 100 })}

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
                  {field('Max Per Sym', 'max_open_trades_per_symbol', 'number', null, { min: 1 })}
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
          <div className="space-y-6 lg:space-y-8 animate-in fade-in duration-300">
            <section>
              <SectionHeader icon={Briefcase} title="Execution Environment" subtitle="Target exchange and mode" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {console.log('[ConfigModal] Rendering mode buttons, cfg.trading_mode:', cfg.trading_mode, 'cfg.paper_mode:', cfg.paper_mode)}
                {['paper', 'testnet', 'live'].map(m => {
                  const isSelected = cfg.trading_mode === m || (m === 'paper' && cfg.paper_mode && !cfg.trading_mode)
                  console.log(`[ConfigModal] Button ${m}: isSelected=${isSelected}, trading_mode=${cfg.trading_mode}`)
                  return (
                    <button key={m} type="button" onClick={() => handleModeSelect(m)} className={cn("p-4 rounded-xl border-2 text-left transition-all relative group", isSelected ? "border-accent bg-accent/10 ring-2 ring-accent/20" : "border-border bg-surface hover:border-border-hover")}>
                      <div className="flex items-center justify-between mb-1"><span className="text-xs font-black uppercase tracking-tighter capitalize">{m}</span>{isSelected && <CheckCircle2 size={16} className="text-accent" />}</div>
                      <p className="text-[9px] text-dim font-bold uppercase tracking-widest">{m === 'paper' ? 'Simulated' : m === 'testnet' ? 'Demo API' : 'Real Capital'}</p>
                    </button>
                  )
                })}
              </div>
              {modeWarning && (
                <div className="mt-4 p-3 bg-orange/10 border border-orange/30 rounded-lg flex items-start gap-3 animate-in slide-in-from-top">
                  <XCircle size={16} className="text-orange mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-orange">{modeWarning}</div>
                </div>
              )}
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={TrendingUp} title="Initial Capital" subtitle="Starting balance for sessions" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {field('Paper Balance ($)', 'paper_starting_balance', 'number', null, { min: 0 })}
                {field('Demo Balance ($)', 'testnet_starting_balance', 'number', null, { min: 0, placeholder: '10000' })}
                {field('Live Balance ($)', 'live_starting_balance', 'number', null, { min: 0 })}
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={Activity} title="Engine Performance" subtitle="Hot and main loop cadences" />
              <div className="grid grid-cols-2 gap-6 mb-6">
                {field('Hot Loop (ms)', 'hot_loop_interval_ms', 'number', null, { min: CONFIG_LIMITS.HOT_LOOP_MIN })}
                {field('Main Loop (ms)', 'main_loop_interval_ms', 'number', null, { min: CONFIG_LIMITS.MAIN_LOOP_MIN })}
                {field('Slippage Limit (%)', 'slippage_warning_threshold', 'number', null, { min: 0, step: 0.1 })}
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
          <div className="space-y-6 lg:space-y-8 animate-in fade-in duration-300">
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
                  const pMode = p.config.trading_mode || (p.config.paper_mode ? 'paper' : 'live');
                  return (
                    <div key={p.name} className="flex items-center justify-between p-4 bg-background border border-border rounded-2xl transition-all group/preset">
                      <button type="button" onClick={() => loadPreset(p)} className="flex-1 flex items-center gap-4 text-left">
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border transition-colors", isVariant ? "bg-accent border-accent text-white" : "bg-surface border-border text-dim group-hover/preset:border-accent/20")}>
                        {isVariant ? <ShieldCheck size={20} /> : <Zap size={20} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold group-hover/preset:text-accent transition-colors flex items-center gap-2 flex-wrap">
                           <span className="truncate">{p.name}</span>
                           <div className="flex items-center gap-1 scale-[0.7] origin-left shrink-0">
                             {pMode === 'paper' && <PaperBadge />}
                             {pMode === 'testnet' && <DemoBadge />}
                             {pMode === 'live' && <LiveBadge />}
                           </div>
                           {loadedPresetName === p.name && (
                             <span className={cn("text-[9px] px-1.5 py-0.5 rounded shrink-0 font-black tracking-widest uppercase", isDirty ? "bg-amber/10 text-amber" : "bg-accent/10 text-accent")}>
                               {isDirty ? "Modified" : "Current"}
                             </span>
                           )}
                        </div>
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
        <div className="flex-1 flex gap-2">
           <Btn variant="ghost" onClick={onClose} className="flex-1">Cancel</Btn>
           {isDirty && <Btn variant="ghost" onClick={resetToLastSaved} className="text-red hover:bg-red/5">Reset</Btn>}
        </div>
        <Btn variant="primary" onClick={() => { 
          if (validate(cfg)) {
             onSave(buildConfigToSave());
             sessionStorage.removeItem('config_draft');
             setIsDirty(false);
          }
        }} className="flex-[2] flex items-center justify-center gap-2">
          {isEdit ? 'Apply Changes' : 'Start Session'}
          {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
        </Btn>
      </div>
    </div>
  )
}

