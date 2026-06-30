import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Plus, Trash2, Save, FolderOpen, Search, Settings2, ShieldCheck, Clock, CheckCircle2, Zap, XCircle, Activity, LayoutGrid, Briefcase, TrendingUp, Target, ArrowRight } from 'lucide-react'
import { cn, Btn, Tooltip, PaperBadge, DemoBadge, LiveBadge } from './ui/primitives'
import * as Switch from '@radix-ui/react-switch'
import { CONFIG_LIMITS } from '../constants/configLimits'
import { settingsAPI, presetsAPI } from '../api/client'
import { useTradingStore } from '../store/trading'

const fmtUSD = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TAB_ERROR_MAP = {
  scan_interval: 'scan',
  scan_lookback: 'scan',
  scan_mode: 'scan',
  trading_mode: 'advanced',
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
]

const SectionHeader = React.memo(({ icon: Icon, title, subtitle }) => (
  <div className="flex items-center gap-3 mb-4">
    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
      <Icon size={18} />
    </div>
    <div>
      <h3 className="text-sm font-bold uppercase tracking-tight">{title}</h3>
      {subtitle && <p className="text-[10px] text-dim font-medium uppercase">{subtitle}</p>}
    </div>
  </div>
))
SectionHeader.displayName = 'SectionHeader'

const Toggle = React.memo(({ value, onChange, label, color = "bg-accent" }) => (
  <label className="flex items-center gap-3 cursor-pointer group">
    <Switch.Root checked={value} onCheckedChange={onChange} className={cn("relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:border-accent", value ? color : "bg-border")}>
      <Switch.Thumb className={cn("pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform", value ? "translate-x-5" : "translate-x-0")} />
    </Switch.Root>
    {label && <span className={cn("text-sm font-bold transition-colors", value ? "text-text" : "text-dim group-hover:text-dim/80")}>{label}</span>}
  </label>
))
Toggle.displayName = 'Toggle'

const Chip = React.forwardRef(({ active, onClick, children, activeClass = "border-accent text-accent bg-accent/10", ...props }, ref) => (
  <button ref={ref} type="button" onClick={onClick} aria-pressed={active} className={cn("px-3 py-1.5 rounded-md border text-[11px] font-bold tracking-wider transition-all", active ? activeClass : "border-border text-dim hover:border-dim/50")} {...props}>{children}</button>
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
    <div className="flex flex-col gap-1.5 group/field">
      <div className="flex justify-between items-center">
        <label htmlFor={id} className="text-[10px] text-dim group-hover/field:text-accent font-black tracking-widest uppercase transition-colors">{label}</label>
        {error && <span role="alert" className="text-[9px] text-red font-bold uppercase">{error}</span>}
        {warning && !error && <span role="alert" className="text-[9px] text-amber font-bold uppercase">{warning}</span>}
      </div>
      {opts ? (
        <select
          id={id}
          value={localValue ?? ''}
          onChange={handleSelectChange}
          className="bg-surface border border-border rounded-xl px-4 py-2.5 text-sm font-bold text-text focus:border-accent outline-none appearance-none transition-all cursor-pointer hover:border-border-hover"
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
          className="bg-surface border border-border rounded-xl px-4 py-2.5 text-sm font-mono font-bold text-text focus:border-accent outline-none transition-all hover:border-border-hover"
        />
      )}
    </div>
  );
})
ConfigField.displayName = 'ConfigField'

const SignalChip = React.memo(({ signal, active, onClick }) => {
  const [key, label, desc] = signal;
  return (
    <Tooltip content={desc} side="bottom">
      <Chip active={active} onClick={() => onClick(key, active)}>{label}</Chip>
    </Tooltip>
  );
})
SignalChip.displayName = 'SignalChip'

const ExitSignalCard = React.memo(({ signal, active, delayValue, onToggle, onDelayChange }) => {
  const [key, label, desc] = signal;
  const [localDelay, setLocalDelay] = useState(delayValue || '');

  useEffect(() => {
    setLocalDelay(delayValue || '');
  }, [delayValue]);

  const commit = () => {
    const val = Math.max(0, parseInt(localDelay) || 0);
    if (val !== delayValue) {
      onDelayChange(key, val);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Tooltip content={desc}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onToggle(key, active)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(key, active); } }}
          className={cn("w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red/50", active ? "border-red/40 bg-red/5" : "border-border hover:border-border-hover bg-surface/50")}
        >
          <span className={cn("text-xs font-bold", active ? "text-red" : "text-text")}>{label}</span>
          <Switch.Root checked={active} className={cn("h-5 w-9 rounded-full transition-colors relative pointer-events-none", active ? "bg-red" : "bg-border")}>
            <Switch.Thumb className={cn("block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-100", active ? "translate-x-4" : "translate-x-1")} />
          </Switch.Root>
        </div>
      </Tooltip>
      {active && (
        <div className="px-1 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <label className="text-[9px] font-bold text-dim uppercase tracking-wider">Delay Trigger (s)</label>
          <input
            type="number"
            min="0"
            placeholder="0s"
            value={localDelay}
            onChange={(e) => setLocalDelay(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            className="w-20 bg-background border border-border rounded-lg px-2 py-1 text-[10px] font-mono font-bold text-right focus:border-red outline-none"
          />
        </div>
      )}
    </div>
  );
})
ExitSignalCard.displayName = 'ExitSignalCard'

const ManualMonitorInput = React.memo(({ onAdd }) => {
  const [value, setValue] = useState('');

  const handleAdd = () => {
    if (value.trim()) {
      onAdd(value.trim());
      setValue('');
    }
  };

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <input
          type="text"
          placeholder="BTCUSDT"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
            if (e.key === 'Escape') setValue('');
          }}
          className="w-full bg-surface border border-border rounded-xl pl-4 pr-10 py-3 text-sm font-mono focus:border-accent outline-none hover:border-border-hover transition-colors"
        />
        {value && <button type="button" onClick={() => setValue('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors" aria-label="Clear input"><X size={16} /></button>}
      </div>
      <Btn variant="primary" onClick={handleAdd} className="aspect-square p-0 w-12 h-12 flex items-center justify-center"><Plus size={20} /></Btn>
    </div>
  );
})
ManualMonitorInput.displayName = 'ManualMonitorInput'

const SavePresetInput = React.memo(({ onSave, isSaving, success, defaultName }) => {
  const [name, setName] = useState(defaultName || '');

  useEffect(() => {
    if (defaultName) setName(defaultName);
  }, [defaultName]);

  return (
    <div className="flex gap-2">
      <input
        type="text"
        placeholder="Preset name (e.g. Scalp High Vol)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent outline-none"
      />
      <Btn variant="primary" onClick={() => { if (name.trim()) { onSave(name); } }} loading={isSaving} className="aspect-square p-0 w-12 h-12 flex items-center justify-center">
        {success ? <CheckCircle2 size={20} /> : <Save size={20} />}
      </Btn>
    </div>
  );
})
SavePresetInput.displayName = 'SavePresetInput'

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
      className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm font-mono font-bold focus:border-accent outline-none hover:border-border-hover transition-colors"
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
    tabIndex={0}
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
    { id: 'advanced', label: 'Advanced', icon: Settings2 },
    { id: 'presets', label: 'Presets', icon: FolderOpen }
  ], []);

  const tabHasError = React.useCallback((tabId) => {
    return Object.keys(errors).some(key => TAB_ERROR_MAP[key] === tabId);
  }, [errors]);

  return (
    <div
      className="flex gap-2 p-4 overflow-x-auto no-scrollbar touch-pan-x"
      data-vaul-no-drag
      role="tablist"
      aria-label="Configuration sections"
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

const PresetItem = React.memo(({ preset, isLoaded, isDirty, onLoad, onToggleVariant, onDelete, isVariant }) => {
  const pMode = preset.config.trading_mode || (preset.config.paper_mode ? 'paper' : 'live');
  return (
    <div className="flex items-center justify-between p-4 bg-background border border-border rounded-2xl transition-all group/preset">
      <button type="button" onClick={() => onLoad(preset)} className="flex-1 flex items-center gap-4 text-left">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border transition-colors", isVariant ? "bg-accent border-accent text-white" : "bg-surface border-border text-dim group-hover/preset:border-accent/20")}>
        {isVariant ? <ShieldCheck size={20} /> : <Zap size={20} />}
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
               {isDirty ? "Modified" : "Current"}
             </span>
           )}
        </div>
        <div className="text-[10px] text-dim font-bold uppercase tracking-tight">{preset.config.scan_interval} · {preset.config.scan_pct_threshold}% · {preset.config.risk_pct_per_trade}% Risk</div>
      </div>
      </button>

      <div className="flex items-center gap-2">
        <Tooltip content={isVariant ? "Remove from variants" : "Add as strategy variant"}>
          <button
            type="button"
            onClick={(e) => onToggleVariant(e, preset)}
            aria-label={isVariant ? `Remove ${preset.name} from variants` : `Add ${preset.name} as variant`}
            className={cn("p-2 rounded-lg transition-all active:scale-95", isVariant ? "bg-accent/10 text-accent border border-accent/20" : "bg-surface border border-border text-dim hover:text-accent hover:border-accent/20")}
          >
            {isVariant ? <XCircle size={16} /> : <Plus size={16} />}
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={(e) => onDelete(e, preset.name)}
          aria-label={`Delete preset ${preset.name}`}
          className="p-2 text-dim hover:text-red transition-colors rounded-lg hover:bg-red/5"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
})
PresetItem.displayName = 'PresetItem'

const flattenConfig = (config) => {
  if (!config) return {};
  try {
    const params = typeof config.signal_params === 'string' ? JSON.parse(config.signal_params || '{}') : config.signal_params || {};
    const weights = config.scanner_weights || { momentum: 0.5, volatility: 0.3, trend: 0.2 };
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
      scanner_weights_momentum: weights.momentum * 100,
      scanner_weights_volatility: weights.volatility * 100,
      scanner_weights_trend: weights.trend * 100,
      live_rr_sequence: Array.isArray(config.live_rr_sequence) ? config.live_rr_sequence : [1.0, 2.0, 4.0],
      exit_rr_sequence: Array.isArray(config.exit_rr_sequence) ? config.exit_rr_sequence : [0.0, 1.0, 2.0],
      trailing_guard_buffer_pct: config.trailing_guard_buffer_pct !== undefined ? config.trailing_guard_buffer_pct : CONFIG_LIMITS.TRAILING_GUARD_DEFAULT,
      // UI Conversion: backend decimal to UI percentage
      slippage_warning_threshold: config.slippage_warning_threshold !== undefined ? config.slippage_warning_threshold * 100 : (CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT * 100 || 0.1),
      leverage: config.leverage !== undefined ? Number(config.leverage) : CONFIG_LIMITS.LEVERAGE_DEFAULT,
      slippage_abort_threshold: config.slippage_abort_threshold !== undefined ? Number(config.slippage_abort_threshold) : (CONFIG_LIMITS.SLIPPAGE_ABORT_DEFAULT || 0.05),
      hibernation_mode: config.hibernation_mode || 'adaptive',
      hibernation_grace_period_sec: config.hibernation_grace_period_sec || 30,
    };
  } catch (e) { return { ...config }; }
};
export const ConfigModal = ({ initialConfig, onSave, onClose, isEdit = false, loading = false }) => {
  const addAlert = useTradingStore(state => state.addAlert);
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
  const [isDirty, setIsDirty] = useState(() => {
    const savedDraft = sessionStorage.getItem('config_draft');
    return !!savedDraft;
  });

  const [section, setSection] = useState('scan')
  const [presets, setPresets] = useState([])
  const [presetName, setPresetName] = useState('')
  const [errors, setErrors] = useState({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')
  const [testnetConfigured, setTestnetConfigured] = useState(false)
  const [liveConfigured, setLiveConfigured] = useState(false)
  const [modeWarning, setModeWarning] = useState(null)
  const [loadedPresetName, setLoadedPresetName] = useState(() => sessionStorage.getItem('loaded_preset_name'));

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

  const setField = React.useCallback((key, value) => {
    setIsDirty(true);
    setCfg(prev => {
      const next = { ...prev, [key]: value };
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

    // Explicitly sanitize inputs for security and data integrity
    const sp = { ...(typeof cfg.signal_params === 'string' ? JSON.parse(cfg.signal_params || '{}') : cfg.signal_params || {}) };
    ['ma_period', 'ema_period', 'entry_ema_period', 'exit_ema_period', 'entry_ema_fast', 'entry_ema_slow', 'exit_ema_fast', 'exit_ema_slow'].forEach(k => {
      const val = cfg[`signal_params_${k}`];
      if (val !== undefined && val !== null) {
        sp[k] = Number(val);
      }
    });
    c.signal_params = sp;

    // Ensure numeric values where expected
    const numericFields = [
      'risk_pct_per_trade', 'max_total_risk_pct', 'max_open_trades', 'total_sl_guard_usdt',
      'scan_pct_threshold', 'scan_lookback', 'scan_min_volume_usdt', 'watchlist_size',
      'watchlist_offset', 'sl_distance_pct', 'sl_min_pct', 'sl_max_pct', 'trailing_guard_buffer_pct',
      'tp_ratio', 'max_trades_per_period', 'trades_period_min', 'max_trades_24h',
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

    if (c.hibernation_grace_period_sec !== undefined) {
      c.hibernation_grace_period_sec = Number(c.hibernation_grace_period_sec);
    }

    // UI Conversion: UI percentage back to backend decimal
    if (c.slippage_warning_threshold !== undefined) {
      c.slippage_warning_threshold = Number(c.slippage_warning_threshold) / 100;
    }
    c.strategy_variants = (cfg.strategy_variants || []).map((v) => ({ ...v, strategy_label: v.strategy_label || 'Variant', strategy_variants: [] }));

    // Clean up temporary UI fields
    Object.keys(c).forEach(k => {
      if (k.startsWith('signal_params_') && k !== 'signal_params') {
        delete c[k];
      }
    });

    return c;
  }, [cfg, presetName, generatedPresetName]);

  const savePreset = React.useCallback(async (explicitName) => {
    const name = (explicitName || presetName || (explicitName === undefined ? loadedPresetName : '') || generatedPresetName || '').trim();
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
    const next = flattenConfig(p.config);
    setCfg(next);
    setLoadedPresetName(p.name);
    setPresetName(p.name);
    setSection('scan');
    validate(next);
    setIsDirty(false);
    addAlert({ level: 'success', title: 'Preset Loaded', message: `Active configuration set to "${p.name}".` });
  }, [validate, addAlert]);

  const deletePreset = React.useCallback(async (e, name) => {
    e.stopPropagation();
    try {
      await presetsAPI.delete(name);
      setPresets(prev => prev.filter(p => p.name !== name));
      addAlert({ level: 'info', title: 'Preset Deleted', message: `"${name}" has been removed from the database.` });
    } catch (e) {
      console.error('[ConfigModal] Error deleting preset:', e);
      addAlert({ level: 'error', title: 'Delete Failed', message: `Could not remove preset "${name}".` });
    }
  }, [addAlert]);

  const toggleVariant = React.useCallback((e, p) => {
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
  }, [cfg.strategy_variants, setField]);

  const currentModeBalance = cfg.trading_mode === 'paper' ? (cfg.paper_starting_balance || 10000) : cfg.trading_mode === 'testnet' ? (cfg.testnet_starting_balance || 0) : (cfg.live_starting_balance || 0);
  const riskAmount = (currentModeBalance * ((cfg.risk_pct_per_trade || 0) / 100))
  const sequence = useMemo(() => {
    const l = Array.isArray(cfg.live_rr_sequence) ? cfg.live_rr_sequence : [];
    const ex = Array.isArray(cfg.exit_rr_sequence) ? cfg.exit_rr_sequence : [];
    return l.map((t, i) => [t, ex[i] ?? 0]);
  }, [cfg.live_rr_sequence, cfg.exit_rr_sequence])

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
        <SectionTabs section={section} onSectionChange={setSection} errors={errors} />
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 md:p-6 pb-32 overscroll-contain" data-vaul-no-drag>
        {section === 'scan' && (
          <div
            id="config-panel-scan"
            role="tabpanel"
            aria-labelledby="config-tab-scan"
            className="space-y-6 lg:space-y-8 animate-in fade-in duration-300"
          >
            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <SectionHeader icon={Settings2} title="General" subtitle="Basic strategy identification" />
              {renderField('Strategy label', 'strategy_label', 'text', null, { placeholder: 'Momentum Strategy' })}
            </section>

            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <div className="p-4 bg-accent/5 border border-accent/20 rounded-2xl flex items-center justify-between mb-6">
                <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent"><Search size={20} /></div><div><div className="text-sm font-bold">Global Scanner</div><div className="text-[10px] text-dim font-medium uppercase">Automatic discovery</div></div></div>
                <Toggle value={cfg.global_scanner_enabled !== false} onChange={(v) => setField('global_scanner_enabled', v)} />
              </div>

              <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6", cfg.global_scanner_enabled === false && "opacity-40 pointer-events-none")}>
                {renderField('Timeframe', 'scan_interval', 'text', ['1m', '5m', '15m', '1h'])}
                {renderField('% Threshold', 'scan_pct_threshold', 'number', null, { min: CONFIG_LIMITS.SCAN_PCT_THRESHOLD_MIN, step: 0.1 })}
                {renderField('Watchlist size', 'watchlist_size', 'number', null, { min: CONFIG_LIMITS.WATCHLIST_MIN, max: CONFIG_LIMITS.WATCHLIST_MAX })}
                {renderField('Watchlist Offset', 'watchlist_offset', 'number', null, { min: 0, max: 100 })}
                {renderField('Entry side', 'entry_side', 'text', ['both', 'long', 'short'])}
                {renderField('Lookback (Candles)', 'scan_lookback', 'number', null, { min: 1 })}
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
            </section>

            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <SectionHeader icon={Plus} title="Static Watchlist" subtitle="Rank only these symbols (comma separated)" />
              <ListInput placeholder="BTCUSDT, ETHUSDT, SOLUSDT..." value={cfg.symbols} onChange={(val) => setField('symbols', val)} />
            </section>

            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <SectionHeader icon={XCircle} title="Exclusion List" subtitle="Symbols to never trade" />
              <ListInput placeholder="BTCUSDT, ETHUSDT..." value={cfg.excluded_symbols} onChange={(val) => setField('excluded_symbols', val)} />
            </section>

            <section className="pt-6 border-t border-border/40">
               <div className="flex justify-between items-center mb-4">
                 <SectionHeader icon={ShieldCheck} title="Manual Monitors" subtitle="Specific symbols to track" />
                 {(cfg.single_symbol_configs || []).length > 0 && <button type="button" onClick={() => setField('single_symbol_configs', [])} className="text-[10px] font-black uppercase tracking-widest text-red/60 hover:text-red transition-colors flex items-center gap-1.5"><Trash2 size={12} /> Clear All</button>}
               </div>
               <ManualMonitorInput onAdd={(val) => setField('single_symbol_configs', [...(cfg.single_symbol_configs || []), { symbol: val, enabled: true, follow_schedule: true }])} />
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
            className="space-y-6 lg:space-y-8 animate-in fade-in duration-300"
          >
            <section className="bg-background/40 p-5 rounded-2xl border border-border/40">
              <div className="flex justify-between items-center mb-4">
                <SectionHeader icon={Zap} title="Entry Signals" subtitle="Triggers for opening positions" />
                <div className="flex bg-background p-1 rounded-lg border border-border shadow-inner">
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'any' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'any')}>ANY</button>
                   <button type="button" className={cn("px-3 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all", (cfg.signal_logic || 'all') === 'all' ? "bg-accent text-white shadow-sm" : "text-dim hover:text-text")} onClick={() => setField('signal_logic', 'all')}>ALL</button>
                 </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {SIGNALS.map((signal) => (
                  <SignalChip
                    key={signal[0]}
                    signal={signal}
                    active={(cfg.enabled_signals || []).includes(signal[0])}
                    onClick={(key, active) => setField('enabled_signals', active ? cfg.enabled_signals.filter(s => s !== key) : [...(cfg.enabled_signals || []), key])}
                  />
                ))}
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={Activity} title="Signal Parameters" subtitle="Technical indicator periods" />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                {renderField('MA Period', 'signal_params_ma_period', 'number', null, { min: 1 })}
                <Tooltip content="Global fallback period used if specific Entry/Exit EMA is not set">
                  <span>{renderField('EMA (Global Fallback)', 'signal_params_ema_period', 'number', null, { min: 1 })}</span>
                </Tooltip>
              </div>

              <div className="space-y-6">
                <div className="bg-background/20 p-4 rounded-2xl border border-border/50">
                  <div className="text-[9px] font-black text-dim uppercase tracking-[0.2em] mb-4">Entry Specific EMAs</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                    {renderField('Entry Period', 'signal_params_entry_ema_period', 'number', null, { min: 1 })}
                    {renderField('Entry Fast', 'signal_params_entry_ema_fast', 'number', null, { min: 1 })}
                    {renderField('Entry Slow', 'signal_params_entry_ema_slow', 'number', null, { min: 1 })}
                  </div>
                </div>

                <div className="bg-background/20 p-4 rounded-2xl border border-border/50">
                  <div className="text-[9px] font-black text-dim uppercase tracking-[0.2em] mb-4">Exit Specific EMAs</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                    {renderField('Exit Period', 'signal_params_exit_ema_period', 'number', null, { min: 1 })}
                    {renderField('Exit Fast', 'signal_params_exit_ema_fast', 'number', null, { min: 1 })}
                    {renderField('Exit Slow', 'signal_params_exit_ema_slow', 'number', null, { min: 1 })}
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
                 {SIGNALS.map((signal) => (
                   <ExitSignalCard
                    key={signal[0]}
                    signal={signal}
                    active={(cfg.exit_signals || []).includes(signal[0])}
                    delayValue={(cfg.exit_signal_delays || {})[signal[0]]}
                    onToggle={(key, active) => setField('exit_signals', active ? cfg.exit_signals.filter(s => s !== key) : [...(cfg.exit_signals || []), key])}
                    onDelayChange={(key, val) => setField('exit_signal_delays', { ...(cfg.exit_signal_delays || {}), [key]: val })}
                   />
                 ))}
               </div>
            </section>
          </div>
        )}

        {section === 'risk' && (
          <div
            id="config-panel-risk"
            role="tabpanel"
            aria-labelledby="config-tab-risk"
            className="space-y-6 lg:space-y-8 animate-in fade-in duration-300"
          >
            <section>
              <SectionHeader icon={ShieldCheck} title="Capital Guards" subtitle="Global safety limits" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {renderField('Risk % Per Trade', 'risk_pct_per_trade', 'number', null, { min: CONFIG_LIMITS.RISK_PER_TRADE_MIN, max: CONFIG_LIMITS.RISK_PER_TRADE_MAX, step: 0.1 })}
                {renderField('Max Total Risk %', 'max_total_risk_pct', 'number', null, { min: CONFIG_LIMITS.MAX_TOTAL_RISK_MIN, max: CONFIG_LIMITS.MAX_TOTAL_RISK_MAX })}
                {renderField('Max Open Trades', 'max_open_trades', 'number', null, { min: CONFIG_LIMITS.MAX_OPEN_TRADES_MIN })}
                {renderField('SL Guard (USDT)', 'total_sl_guard_usdt', 'number', null, { min: 0 })}
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
                         <span><Activity size={10} className="text-dim cursor-help" /></span>
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
                {renderField('Strategy Type', 'sl_type', 'text', [
                  { value: 'pct', label: 'Fixed Percentage' },
                  {value: 'lookback_low/high', label: 'High/Low Stop' }
                ])}
                {cfg.sl_type === 'pct' ? (
                  renderField('Distance %', 'sl_distance_pct', 'number', null, { min: CONFIG_LIMITS.SL_DISTANCE_MIN, max: CONFIG_LIMITS.SL_DISTANCE_MAX, step: 0.1 })
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {renderField('Lookback Period', 'sl_lookback_period', 'number', null, { min: 1 })}
                    {renderField('Lookback TF', 'sl_lookback_timeframe', 'text', ['1m', '5m', '15m', '1h'])}
                  </div>
                )}
                {cfg.sl_type !== 'pct' && renderField('Max Allowed SL %', 'sl_pct_limit', 'number', null, { min: 0.1, step: 0.1 })}
                <div className="grid grid-cols-2 gap-4">
                  {renderField('Floor Min %', 'sl_min_pct', 'number', null, { min: 0.1, step: 0.1 })}
                  {renderField('Ceiling Max %', 'sl_max_pct', 'number', null, { min: 0.1, step: 0.1 })}
                </div>
                <div className="md:col-span-2">
                  <Tooltip content="Safety buffer that prevents trailing stops from being placed too close to the market price. This avoids 'Order would immediately trigger' errors and instant fills during high volatility. Recommended: 0.03% to 0.05%.">
                    <span>{renderField('Trailing Guard (%)', 'trailing_guard_buffer_pct', 'number', null, { min: CONFIG_LIMITS.TRAILING_GUARD_MIN, max: CONFIG_LIMITS.TRAILING_GUARD_MAX, step: 0.01 })}</span>
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
                {renderField('Exit Strategy', 'tp_mode', 'text', [
                  { value: 'fixed', label: 'Fixed Ratio (TP)' },
                  { value: 'exp_rr_seq', label: 'Dynamic RR Milestone' }
                ])}
                {cfg.tp_mode === 'fixed' ? renderField('Fixed Ratio (R)', 'tp_ratio', 'number', null, { min: 0.1, step: 0.1 }) : <div />}
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

                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 p-5 bg-surface/30 rounded-2xl border border-border/40 mb-6">
                  {renderField('Period Limit', 'max_trades_per_period', 'number', null, { min: 0 })}
                  {renderField('Period (min)', 'trades_period_min', 'number', null, { min: 1 })}
                  {renderField('Max 24h', 'max_trades_24h', 'number', null, { min: 0 })}
                </div>

                {cfg.frequency_shaping_enabled && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 md:grid-cols-2 gap-6 p-5 bg-surface/30 rounded-2xl border border-border/40 mb-6">
                    {renderField('Min Interval (m)', 'min_trade_interval_min', 'number', null, { min: 0 })}
                    {renderField('Window Jitter (%)', 'trades_jitter_pct', 'number', null, { min: 0, max: 100 })}
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
          <div
            id="config-panel-advanced"
            role="tabpanel"
            aria-labelledby="config-tab-advanced"
            className="space-y-6 lg:space-y-8 animate-in fade-in duration-300"
          >
            <section>
              <SectionHeader icon={Briefcase} title="Execution Environment" subtitle="Target exchange and mode" />
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
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={TrendingUp} title="Initial Capital" subtitle="Starting balance for sessions" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {renderField('Paper Balance ($)', 'paper_starting_balance', 'number', null, { min: 0 })}
                {renderField('Demo Balance ($)', 'testnet_starting_balance', 'number', null, { min: 0, placeholder: '10000' })}
                {renderField('Live Balance ($)', 'live_starting_balance', 'number', null, { min: 0 })}
              </div>
            </section>

            <section className="pt-6 border-t border-border/40">
              <SectionHeader icon={Activity} title="Engine Performance" subtitle="Hot and main loop cadences" />
              <div className="grid grid-cols-2 gap-6 mb-6">
                {renderField('Hot Loop (ms)', 'hot_loop_interval_ms', 'number', null, { min: CONFIG_LIMITS.HOT_LOOP_MIN })}
                {renderField('Main Loop (ms)', 'main_loop_interval_ms', 'number', null, { min: CONFIG_LIMITS.MAIN_LOOP_MIN })}
                {renderField('Slippage Limit (%)', 'slippage_warning_threshold', 'number', null, { min: 0, step: 0.1 })}
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

              <div className="mt-8 pt-6 border-t border-border/40">
                <SectionHeader icon={Clock} title="Hibernation Management" subtitle="Gated idle resource strategy" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  {[
                    { id: 'light', label: 'Light Sleep', desc: 'Fastest resumption. Keeps market streams active. Best for low latency.' },
                    { id: 'adaptive', label: 'Adaptive', desc: 'SRE Recommended. 30s light grace period before deep sleep. Balanced.' },
                    { id: 'deep', label: 'Deep Sleep', desc: 'Maximum resource savings. Immediate stream teardown and cache purge.' }
                  ].map(mode => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setField('hibernation_mode', mode.id)}
                      className={cn(
                        "p-4 rounded-xl border-2 text-left transition-all relative group",
                        cfg.hibernation_mode === mode.id ? "border-accent bg-accent/10 ring-2 ring-accent/20" : "border-border bg-surface hover:border-border-hover"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn("text-[10px] font-black uppercase tracking-tighter", cfg.hibernation_mode === mode.id ? "text-accent" : "text-text")}>{mode.label}</span>
                        {cfg.hibernation_mode === mode.id && <CheckCircle2 size={14} className="text-accent" />}
                      </div>
                      <p className="text-[9px] text-dim font-bold uppercase tracking-tight leading-tight">{mode.desc}</p>
                    </button>
                  ))}
                </div>

                {cfg.hibernation_mode === 'adaptive' && (
                  <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
                    {renderField('Adaptive Grace Period (s)', 'hibernation_grace_period_sec', 'number', null, { min: 5, max: 3600 })}
                    <p className="mt-1.5 text-[9px] text-dim font-medium uppercase tracking-tight">Time to maintain Light Sleep before full cache purge.</p>
                  </div>
                )}

                <div className="p-4 bg-background/40 border border-border/40 rounded-xl space-y-2">
                   <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-accent">
                      <ShieldCheck size={12} /> Resource vs. Latency Trade-off
                   </div>
                   <p className="text-[10px] text-dim leading-relaxed font-medium italic border-l border-accent/20 pl-3">
                      {cfg.hibernation_mode === 'light' ?
                        "Maintaining MarketFeed during hibernation avoids the 250+ weight REST backfill burst, ensuring the engine is ready to trade the millisecond gating clears." :
                        cfg.hibernation_mode === 'deep' ?
                        "Deep sleep minimizes CPU, network, and memory by purging all non-essential data. Resumption requires a heavy API burst and short warmup period." :
                        "Adaptive mode provides 30 seconds of high-readiness light sleep before transitioning to deep sleep for prolonged gating periods."
                      }
                   </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {section === 'presets' && (
          <div
            id="config-panel-presets"
            role="tabpanel"
            aria-labelledby="config-tab-presets"
            className="space-y-6 lg:space-y-8 animate-in fade-in duration-300"
          >
            <section>
              <SectionHeader icon={Save} title="Save Strategy" subtitle="Store current configuration as a preset" />
              <SavePresetInput defaultName={loadedPresetName} onSave={(name) => { savePreset(name); }} isSaving={isSaving} success={saveSuccess} />
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
                ) : presets.map(p => (
                  <PresetItem
                    key={p.name}
                    preset={p}
                    isLoaded={loadedPresetName === p.name}
                    isDirty={isDirty}
                    onLoad={loadPreset}
                    onToggleVariant={toggleVariant}
                    onDelete={deletePreset}
                    isVariant={(cfg.strategy_variants || []).some(v => v.strategy_label === p.name)}
                  />
                ))}
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
        <Btn variant="primary" loading={loading} onClick={() => {
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

