import React, { useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2, Save, FolderOpen, Search, Settings2, ShieldCheck, Clock, CheckCircle2, AlertCircle, Zap, XCircle, Activity, LayoutGrid } from 'lucide-react'
import { cn, Btn, Tooltip } from './ui/primitives'
import * as Switch from '@radix-ui/react-switch'
import { CONFIG_LIMITS } from '../constants/configLimits'

const SIGNALS = [
  ['momentum_pct', '% Momentum', 'Entry when momentum exceeds threshold.'],
  ['breakout_hl', 'Breakout H/L', 'Entry when price breaks highest high or lowest low.'],
  ['ema_price_cross', 'EMA Price Cross', 'Entry when price crosses EMA.'],
  ['ema_dual_cross', 'EMA Dual Cross', 'Entry when fast EMA crosses slow EMA.'],
  ['ema_close', 'EMA Close', 'Entry when candle closes favorable side of EMA.'],
  ['ma', 'MA Cross', 'Entry when price crosses simple Moving Average.'],
  ['engulfing', 'Engulfing', 'Entry on bullish or bearish engulfing pattern.'],
]

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
    return { ...config, signal_params_ma_period: params.ma_period, signal_params_ema_period: params.ema_period, signal_params_entry_ema_period: params.entry_ema_period, signal_params_exit_ema_period: params.exit_ema_period, signal_params_entry_ema_fast: params.entry_ema_fast, signal_params_entry_ema_slow: params.entry_ema_slow, signal_params_exit_ema_fast: params.exit_ema_fast, signal_params_exit_ema_slow: params.exit_ema_slow };
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
  const sequence = useMemo(() => { const l = cfg.live_rr_sequence || []; const ex = cfg.exit_rr_sequence || []; return l.map((t, i) => [t, ex[i] ?? 0]); }, [cfg.live_rr_sequence, cfg.exit_rr_sequence])

  function field(label, key, type = 'number', opts = null, attrs = {}, cp = null) {
    const id = `config-${key}`; const v = cp ? cp[key] : cfg[key]; const err = errors[key]; const warn = errors[`${key}_warn`];
    const onChange = (val) => { if (cp) attrs.onCustomChange(key, val); else setField(key, val); }
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center"><label htmlFor={id} className="text-[10px] text-dim font-bold tracking-widest uppercase">{label}</label>
          {err && <span role="alert" className="text-[9px] text-red font-bold uppercase">{err}</span>}
          {warn && !err && <span role="alert" className="text-[9px] text-amber font-bold uppercase">{warn}</span>}
        </div>
        {opts ? <select id={id} value={v ?? ''} onChange={(e) => onChange(e.target.value)} className="bg-surface border border-border rounded-md px-3 py-2 text-sm font-mono text-text focus:outline-none focus:border-accent">{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select> : <input id={id} type={type} value={v ?? ''} {...attrs} onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)} className="bg-surface border border-border rounded-md px-3 py-2 text-sm font-mono text-text focus:outline-none focus:border-accent" />}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-surface text-text overflow-hidden relative">
      <div className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md border-b border-border">
        <div className="p-5 flex justify-between items-center">
          <div><div className="text-lg font-bold">Configure Engine</div><div className="text-[11px] text-dim font-medium">Define parameters for automated execution</div></div>
          <button onClick={onClose} aria-label="Close configuration" className="p-2 hover:bg-white/5 rounded-full transition-colors"><X size={18} className="text-dim" /></button>
        </div>
        <div className="flex gap-2 p-4 overflow-x-auto no-scrollbar touch-pan-x" data-vaul-no-drag>
          {[ ['scan', 'Scanner'], ['strategy', 'Strategy'], ['risk', 'Risk'], ['advanced', 'Advanced'], ['presets', 'Presets'] ].map(([id, label]) => (
            <Chip key={id} active={section === id} onClick={() => setSection(id)}>{label}</Chip>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 pb-32 overscroll-contain" data-vaul-no-drag>
        {section === 'scan' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {field('Strategy label', 'strategy_label', 'text')}
            <div className="p-4 bg-accent/5 border border-accent/20 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center"><Search size={20} className="text-accent" /></div><div><div className="text-sm font-bold">Global Scanner</div><div className="text-[10px] text-dim font-medium">Automatic opportunity discovery</div></div></div>
              <Toggle value={cfg.global_scanner_enabled !== false} onChange={(v) => setField('global_scanner_enabled', v)} />
            </div>
            <div className={cn("grid grid-cols-2 gap-5", cfg.global_scanner_enabled === false && "opacity-40 pointer-events-none")}>
              {field('Interval', 'scan_interval', 'text', ['1m', '5m', '15m', '1h'])}
              {field('% threshold', 'scan_pct_threshold', 'number', null, { min: CONFIG_LIMITS.SCAN_PCT_THRESHOLD_MIN, step: 0.1 })}
              {field('Watchlist size', 'watchlist_size', 'number', null, { min: CONFIG_LIMITS.WATCHLIST_MIN, max: CONFIG_LIMITS.WATCHLIST_MAX })}
              {field('Entry side', 'entry_side', 'text', ['both', 'long', 'short'])}
            </div>
            <div className="space-y-3 pt-4 border-t border-border/40">
               <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex items-center gap-2"><ShieldCheck size={12} /> Specific Symbol Monitors</div>
               <div className="flex gap-2"><input type="text" placeholder="BTCUSDT" value={symbolSearch} onChange={(e) => setSymbolSearch(e.target.value.toUpperCase())} className="flex-1 bg-surface border border-border rounded px-3 py-2 text-sm font-mono" /><Btn variant="primary" onClick={() => { if (!symbolSearch) return; setField('single_symbol_configs', [...(cfg.single_symbol_configs || []), { symbol: symbolSearch, enabled: true, follow_schedule: true }]); setSymbolSearch(''); }}><Plus size={16} /></Btn></div>
            </div>
          </div>
        )}

        {section === 'strategy' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-2 gap-2">
              {SIGNALS.map(([key, label]) => {
                const active = (cfg.enabled_signals || []).includes(key);
                return <Chip key={key} active={active} onClick={() => setField('enabled_signals', active ? cfg.enabled_signals.filter(s => s !== key) : [...(cfg.enabled_signals || []), key])}>{label}</Chip>
              })}
            </div>
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="text-[10px] text-dim font-bold uppercase tracking-widest">Indicators</div>
              <div className="grid grid-cols-2 gap-5">
                {field('MA Period', 'signal_params_ma_period')}
                {field('EMA Period', 'signal_params_entry_ema_period')}
              </div>
            </div>
            <div className="space-y-4 pt-4 border-t border-border">
               <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex justify-between"><span>Exit Conditions</span><div className="flex gap-1">
                 <button className={cn("px-2 py-0.5 rounded text-[8px] font-bold", (cfg.exit_signal_logic || 'any') === 'any' ? "bg-red text-white" : "bg-border")} onClick={() => setField('exit_signal_logic', 'any')}>ANY</button>
                 <button className={cn("px-2 py-0.5 rounded text-[8px] font-bold", cfg.exit_signal_logic === 'all' ? "bg-red text-white" : "bg-border")} onClick={() => setField('exit_signal_logic', 'all')}>ALL</button>
               </div></div>
               <div className="grid grid-cols-1 gap-2">
                 {SIGNALS.map(([key, label]) => {
                   const active = (cfg.exit_signals || []).includes(key);
                   return <div key={key} className={cn("flex items-center justify-between p-2 rounded border", active ? "border-red/40 bg-red/5" : "border-border")}><span className="text-xs font-bold">{label}</span><Switch.Root checked={active} onCheckedChange={(v) => setField('exit_signals', v ? [...(cfg.exit_signals || []), key] : cfg.exit_signals.filter(s => s !== key))} className={cn("h-5 w-9 rounded-full border-2 border-transparent transition-colors", active ? "bg-red" : "bg-border")}><Switch.Thumb className={cn("block h-4 w-4 rounded-full bg-white transition-transform", active ? "translate-x-4" : "translate-x-0")} /></Switch.Root></div>
                 })}
               </div>
            </div>
          </div>
        )}

        {section === 'risk' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-2 gap-5">
              {field('Risk % per trade', 'risk_pct_per_trade', 'number', null, { min: CONFIG_LIMITS.RISK_PER_TRADE_MIN, max: CONFIG_LIMITS.RISK_PER_TRADE_MAX, step: 0.1 })}
              {field('SL Distance %', 'sl_distance_pct', 'number', null, { min: CONFIG_LIMITS.SL_DISTANCE_MIN, max: CONFIG_LIMITS.SL_DISTANCE_MAX, step: 0.1 })}
              {field('Max open trades', 'max_open_trades', 'number', null, { min: CONFIG_LIMITS.MAX_OPEN_TRADES_MIN })}
              {field('Max total risk %', 'max_total_risk_pct', 'number', null, { min: CONFIG_LIMITS.MAX_TOTAL_RISK_MIN, max: CONFIG_LIMITS.MAX_TOTAL_RISK_MAX })}
              {field('SL guard USDT', 'total_sl_guard_usdt')}
            </div>
            <div className="p-4 bg-background border border-border rounded-xl flex justify-between"><div className="flex flex-col"><span className="text-[9px] text-dim uppercase font-bold">Capital at risk</span><span className="text-sm font-bold font-mono text-amber">${fmtUSD(riskAmount)}</span></div><div className="flex flex-col text-right"><span className="text-[9px] text-dim uppercase font-bold">TP Ratio</span><span className="text-sm font-bold font-mono text-accent">{cfg.tp_ratio}R</span></div></div>
            <div className="space-y-4 pt-4 border-t border-border">
               <div className="text-[10px] text-dim font-bold uppercase tracking-widest flex items-center gap-2"><Clock size={12} /> Trading Windows</div>
               <div className="flex flex-col gap-2">
                 {(cfg.trading_windows || []).map((w, i) => (
                   <div key={i} className="flex gap-2">
                     <input type="text" value={w.start} onChange={(e) => { const wins = [...(cfg.trading_windows || [])]; wins[i].start = e.target.value; setField('trading_windows', wins); }} className="w-20 bg-surface border border-border rounded px-2 py-1 text-xs font-mono" />
                     <input type="text" value={w.end} onChange={(e) => { const wins = [...(cfg.trading_windows || [])]; wins[i].end = e.target.value; setField('trading_windows', wins); }} className="w-20 bg-surface border border-border rounded px-2 py-1 text-xs font-mono" />
                     <Btn variant="ghost" aria-label="Remove trading window" onClick={() => setField('trading_windows', cfg.trading_windows.filter((_, idx) => idx !== i))}><Trash2 size={14} /></Btn>
                   </div>
                 ))}
                 <Btn variant="ghost" onClick={() => setField('trading_windows', [...(cfg.trading_windows || []), { start: '09:00', end: '17:00' }])} className="w-full text-[10px]">+ Add Window</Btn>
               </div>
            </div>
          </div>
        )}

        {section === 'advanced' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 gap-4">
              {['paper', 'testnet', 'live'].map(m => (
                <button key={m} onClick={() => { setField('trading_mode', m); setField('paper_mode', m === 'paper'); }} className={cn("p-4 rounded-xl border-2 text-left transition-all", (cfg.trading_mode === m || (m === 'paper' && cfg.paper_mode && !cfg.trading_mode)) ? "border-accent bg-accent/5" : "border-border bg-surface")}>
                  <div className="flex items-center justify-between mb-1"><span className="text-sm font-bold capitalize">{m} Trading</span>{(cfg.trading_mode === m || (m === 'paper' && cfg.paper_mode && !cfg.trading_mode)) && <CheckCircle2 size={16} className="text-accent" />}</div>
                  <p className="text-[10px] text-dim">Executing in ${m} environment</p>
                </button>
              ))}
            </div>
            <div className="space-y-4 pt-4 border-t border-border">
              {field('Hot Loop (ms)', 'hot_loop_interval_ms', 'number', null, { min: CONFIG_LIMITS.HOT_LOOP_MIN })}
              {field('Main Loop (ms)', 'main_loop_interval_ms', 'number', null, { min: CONFIG_LIMITS.MAIN_LOOP_MIN })}
              <div className="flex items-center justify-between p-4 bg-background rounded-xl"><div><div className="text-sm font-bold">Debug Mode</div><div className="text-[10px] text-dim uppercase">Verbose backend logs</div></div><Toggle value={cfg.debug_mode === true} onChange={(v) => setField('debug_mode', v)} color="bg-amber" /></div>
            </div>
          </div>
        )}

        {section === 'presets' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex gap-2"><input type="text" placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} className="flex-1 bg-surface border border-border rounded px-3 py-2 text-sm font-mono" /><Btn variant="primary" onClick={savePreset}><Save size={18} /></Btn></div>
            <div className="space-y-2">
              {presets.length === 0 ? <div className="p-10 border border-dashed border-border rounded-xl text-center text-dim text-xs">No presets saved</div> : presets.map(p => (
                <div key={p.name} onClick={() => loadPreset(p)} className="flex items-center justify-between p-4 bg-background border border-border rounded-xl cursor-pointer hover:border-accent/40 transition-all">
                  <div><div className="text-sm font-bold">{p.name}</div><div className="text-[10px] text-dim font-mono">{p.config.scan_interval} · {p.config.risk_pct_per_trade}% Risk</div></div>
                  <button onClick={(e) => deletePreset(e, p.name)} aria-label={`Delete preset ${p.name}`} className="p-2 text-dim hover:text-red"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
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

const fmtUSD = (v) => `$${Number(v || 0).toFixed(2)}`;
