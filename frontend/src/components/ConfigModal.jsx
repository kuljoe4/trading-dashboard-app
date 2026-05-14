import React, { useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2, Save, FolderOpen } from 'lucide-react'
import { cn, Btn } from './ui/primitives'
import * as Switch from '@radix-ui/react-switch'

const SIGNALS = [
  ['momentum_pct', '% Momentum'],
  ['breakout_hl', 'Breakout H/L'],
  ['ema_cross', 'EMA Cross'],
]

const Toggle = ({ value, onChange, label, color = "bg-accent" }) => (
  <div className="flex items-center gap-3">
    <Switch.Root
      checked={value}
      onCheckedChange={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        value ? color : "bg-border"
      )}
    >
      <Switch.Thumb
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
          value ? "translate-x-5" : "translate-x-0"
        )}
      />
    </Switch.Root>
    <span className={cn("text-sm font-bold", value ? "text-text" : "text-dim")}>{label}</span>
  </div>
)

const Chip = ({ active, onClick, children, activeClass = "border-accent text-accent bg-accent/10" }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "px-3 py-1.5 rounded-md border text-[11px] font-bold tracking-wider transition-all",
      active ? activeClass : "border-border text-dim hover:border-dim/50"
    )}
  >
    {children}
  </button>
)

export const ConfigModal = ({ initialConfig, onSave, onClose, isEdit = false }) => {
  const [cfg, setCfg] = useState({ ...initialConfig })
  const [section, setSection] = useState('scan')
  const [presets, setPresets] = useState([])
  const [presetName, setPresetName] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('strategy_presets')
    if (saved) setPresets(JSON.parse(saved))
  }, [])

  const setField = (key, value) => setCfg((prev) => ({ ...prev, [key]: value }))

  const savePreset = () => {
    if (!presetName) return
    const next = [...presets.filter(p => p.name !== presetName), { name: presetName, config: cfg }]
    setPresets(next)
    localStorage.setItem('strategy_presets', JSON.stringify(next))
    setPresetName('')
  }

  const loadPreset = (p) => {
    setCfg({ ...p.config })
    setSection('scan')
  }

  const deletePreset = (e, name) => {
    e.stopPropagation()
    const next = presets.filter(p => p.name !== name)
    setPresets(next)
    localStorage.setItem('strategy_presets', JSON.stringify(next))
  }

  const riskAmount = ((cfg.paper_starting_balance || 10000) * ((cfg.risk_pct_per_trade || 0) / 100))
  const slDistance = 100 * ((cfg.sl_distance_pct || 1) / 100)
  const estimatedQty = slDistance > 0 ? riskAmount / slDistance : 0

  const sequence = useMemo(() => {
    const live = cfg.live_rr_sequence || []
    const exits = cfg.exit_rr_sequence || []
    return live.map((trigger, i) => [trigger, exits[i] ?? 0])
  }, [cfg.live_rr_sequence, cfg.exit_rr_sequence])

  function field(label, key, type = 'number', opts = null, attrs = {}) {
    const id = `config-${key}`
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[10px] text-dim font-bold tracking-widest uppercase">{label}</label>
        {opts ? (
          <select
            id={id}
            value={cfg[key] ?? ''}
            onChange={(e) => setField(key, e.target.value)}
            className="bg-surface border border-border rounded-md px-3 py-2 text-sm font-mono text-text focus:outline-none focus:border-accent"
          >
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            id={id}
            type={type}
            value={cfg[key] ?? ''}
            min={attrs.min}
            max={attrs.max}
            step={attrs.step}
            onChange={(e) => setField(key, type === 'number' ? Number(e.target.value) : e.target.value)}
            className="bg-surface border border-border rounded-md px-3 py-2 text-sm font-mono text-text focus:outline-none focus:border-accent"
          />
        )}
      </div>
    )
  }

  function updateSequence(index, col, value) {
    const next = sequence.map((row, i) => i === index ? [col === 0 ? Number(value) : row[0], col === 1 ? Number(value) : row[1]] : row)
    setCfg((prev) => ({
      ...prev,
      live_rr_sequence: next.map(([trigger]) => trigger),
      exit_rr_sequence: next.map(([, exit]) => exit),
    }))
  }

  function addStep() {
    const last = sequence[sequence.length - 1] || [0, -1]
    setCfg((prev) => ({
      ...prev,
      live_rr_sequence: [...(prev.live_rr_sequence || []), last[0] + 1],
      exit_rr_sequence: [...(prev.exit_rr_sequence || []), Math.max(0, last[1] + 1)],
    }))
  }

  function removeStep(index) {
    const next = sequence.filter((_, i) => i !== index)
    setCfg((prev) => ({
      ...prev,
      live_rr_sequence: next.map(([trigger]) => trigger),
      exit_rr_sequence: next.map(([, exit]) => exit),
    }))
  }

  return (
    <div className="flex flex-col h-full bg-surface text-text overflow-hidden">
      <div className="p-5 border-b border-border flex justify-between items-center shrink-0">
        <div>
          <div className="text-lg font-bold">New Session</div>
          <div className="text-[11px] text-dim font-medium mt-0.5">Configure scanner, exits, and risk before launch</div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors" aria-label="Close configuration">
          <X size={18} className="text-dim" />
        </button>
      </div>

      <div className="flex gap-2 p-4 overflow-x-auto no-scrollbar shrink-0 border-b border-border">
        {[
          ['scan', 'Scan'],
          ['signals', 'Signals'],
          ['exit', 'Exit'],
          ['risk', 'Risk'],
          ['schedule', 'Schedule'],
          ['mode', 'Mode'],
          ['presets', 'Presets'],
        ].map(([id, label]) => (
          <Chip key={id} active={section === id} onClick={() => setSection(id)}>{label}</Chip>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {section === 'scan' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {field('Interval', 'scan_interval', 'text', ['1m', '5m', '15m', '1h'])}
              {field('Lookback candles', 'scan_lookback', 'number', null, { min: 1, max: 20 })}
              {field('% threshold', 'scan_pct_threshold', 'number', null, { min: 0.1, step: 0.1 })}
              {field('Min volume USDT', 'scan_min_volume_usdt', 'number', null, { min: 0, step: 100000 })}
              {field('Watchlist size', 'watchlist_size', 'number', null, { min: 10, max: 100 })}
              {field('Entry side', 'entry_side', 'text', ['both', 'long', 'short'])}
            </div>
            <div className="flex gap-2 p-1 bg-background rounded-lg">
              <button
                className={cn("flex-1 py-2 text-[11px] font-bold rounded-md transition-all", cfg.scan_mode === 'interval' ? "bg-surface text-accent shadow-sm" : "text-dim")}
                onClick={() => setField('scan_mode', 'interval')}
              >Interval</button>
              <button
                className={cn("flex-1 py-2 text-[11px] font-bold rounded-md transition-all", cfg.scan_mode === 'active_window' ? "bg-surface text-accent shadow-sm" : "text-dim")}
                onClick={() => setField('scan_mode', 'active_window')}
              >Active Window</button>
            </div>
            {cfg.scan_mode === 'active_window' && (
              <div className="grid grid-cols-2 gap-5">
                {field('Window duration sec', 'scan_window_duration_sec', 'number', null, { min: 10, max: 600 })}
                {field('Check interval sec', 'scan_check_interval_sec', 'number', null, { min: 2, max: 60 })}
              </div>
            )}
          </div>
        )}

        {section === 'signals' && (
          <div className="space-y-6">
            <div className="flex gap-2 p-1 bg-background rounded-lg">
              <button
                className={cn("flex-1 py-2 text-[11px] font-bold rounded-md transition-all", cfg.signal_logic === 'all' ? "bg-surface text-accent shadow-sm" : "text-dim")}
                onClick={() => setField('signal_logic', 'all')}
              >Require All</button>
              <button
                className={cn("flex-1 py-2 text-[11px] font-bold rounded-md transition-all", cfg.signal_logic === 'any' ? "bg-surface text-accent shadow-sm" : "text-dim")}
                onClick={() => setField('signal_logic', 'any')}
              >Allow Any</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {SIGNALS.map(([key, label]) => {
                const active = (cfg.enabled_signals || []).includes(key)
                return (
                  <Chip
                    key={key}
                    active={active}
                    onClick={() => setField('enabled_signals', active
                      ? (cfg.enabled_signals || []).filter((s) => s !== key)
                      : [...(cfg.enabled_signals || []), key])}
                  >
                    {label}
                  </Chip>
                )
              })}
            </div>
          </div>
        )}

        {section === 'exit' && (
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="text-[10px] text-dim font-bold tracking-widest uppercase">Take Profit Mode</div>
              <div className="flex gap-2 p-1 bg-background rounded-lg">
                <button className={cn("flex-1 py-2 text-[11px] font-bold rounded-md transition-all", cfg.tp_mode === 'fixed' ? "bg-surface text-accent shadow-sm" : "text-dim")} onClick={() => setField('tp_mode', 'fixed')}>Fixed R:R</button>
                <button className={cn("flex-1 py-2 text-[11px] font-bold rounded-md transition-all", cfg.tp_mode === 'exp_rr_seq' ? "bg-surface text-accent shadow-sm" : "text-dim")} onClick={() => setField('tp_mode', 'exp_rr_seq')}>EXP RR</button>
              </div>
              {cfg.tp_mode === 'fixed' ? (
                <div className="grid grid-cols-1">{field('TP ratio', 'tp_ratio', 'number', null, { min: 0.2, step: 0.1 })}</div>
              ) : (
                <div className="space-y-3">
                  {sequence.map(([trigger, exit], i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-background rounded-lg border border-border">
                      <span className="text-[11px] text-dim font-bold w-4">{i + 1}</span>
                      <div className="flex-1 flex flex-col gap-1">
                        <span className="text-[9px] text-dim uppercase font-bold">Trigger RR</span>
                        <input type="number" value={trigger} min="0.5" step="0.5" onChange={(e) => updateSequence(i, 0, e.target.value)} className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono" />
                      </div>
                      <div className="flex-1 flex flex-col gap-1">
                        <span className="text-[9px] text-dim uppercase font-bold">Exit RR</span>
                        <input type="number" value={exit} min="-1" step="0.5" onChange={(e) => updateSequence(i, 1, e.target.value)} className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono" />
                      </div>
                      <div className="w-10 text-center text-xs font-bold font-mono">
                        {exit === 0 ? 'BE' : `${exit}R`}
                      </div>
                      <button onClick={() => removeStep(i)} className="text-red/60 hover:text-red p-1"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button onClick={addStep} className="w-full py-2 border border-dashed border-border rounded-lg text-[11px] font-bold text-dim hover:text-accent hover:border-accent transition-all flex items-center justify-center gap-1.5">
                    <Plus size={14} /> Add Step
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="text-[10px] text-dim font-bold tracking-widest uppercase">Stop Loss Mode</div>
              <div className="flex gap-2 p-1 bg-background rounded-lg">
                <button className={cn("flex-1 py-2 text-[11px] font-bold rounded-md transition-all", cfg.sl_type === 'pct' ? "bg-surface text-accent shadow-sm" : "text-dim")} onClick={() => setField('sl_type', 'pct')}>Fixed %</button>
                <button className={cn("flex-1 py-2 text-[11px] font-bold rounded-md transition-all", cfg.sl_type === 'lookback_low/high' ? "bg-surface text-accent shadow-sm" : "text-dim")} onClick={() => setField('sl_type', 'lookback_low/high')}>Lookback H/L</button>
              </div>
              {cfg.sl_type === 'pct' ? (
                <div className="grid grid-cols-1">{field('SL distance %', 'sl_distance_pct', 'number', null, { min: 0.05, step: 0.05 })}</div>
              ) : (
                <div className="grid grid-cols-2 gap-5">
                  {field('SL timeframe', 'sl_lookback_timeframe', 'text', ['1m', '5m', '15m', '1h', '4h'])}
                  {field('Lookback bars', 'sl_lookback_period', 'number', null, { min: 1, max: 50 })}
                  {field('Min SL %', 'sl_min_pct', 'number', null, { min: 0.05, step: 0.05 })}
                  {field('Max SL %', 'sl_max_pct', 'number', null, { min: 0.1, step: 0.1 })}
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'risk' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {field('Risk % per trade', 'risk_pct_per_trade', 'number', null, { min: 0.1, step: 0.1 })}
              {field('Max open trades', 'max_open_trades', 'number', null, { min: 1 })}
              {field('Max trades per period', 'max_trades_per_period', 'number', null, { min: 0 })}
              {field('Period (minutes)', 'trades_period_min', 'number', null, { min: 1 })}
              {field('Max total risk %', 'max_total_risk_pct', 'number', null, { min: 0.5, step: 0.5 })}
              {field('SL guard USDT', 'total_sl_guard_usdt', 'number', null, { min: 1, step: 10 })}
            </div>
            <div className="grid grid-cols-3 gap-3 p-4 bg-background rounded-xl border border-border">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-dim uppercase font-bold">Risk amount</span>
                <span className="text-sm font-bold font-mono text-amber">${riskAmount.toFixed(2)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-dim uppercase font-bold">SL @ $100</span>
                <span className="text-sm font-bold font-mono text-red">{slDistance.toFixed(2)}</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                <span className="text-[9px] text-dim uppercase font-bold">Est. qty</span>
                <span className="text-sm font-bold font-mono text-accent">{estimatedQty.toFixed(1)}</span>
              </div>
            </div>

            <div className="pt-6 border-t border-border/40 space-y-4">
               <div className="text-[10px] text-dim font-bold tracking-widest uppercase">Advanced Risk Filters</div>
               <div className="flex flex-col gap-4">
                  <Toggle
                    label="Historical TOD Risk"
                    value={cfg.risk_use_tod_stats}
                    onChange={(v) => setField('risk_use_tod_stats', v)}
                    color="bg-green"
                  />
                  {cfg.risk_use_tod_stats && (
                    <div className="pl-9">
                       {field('Min Hour WinRate %', 'tod_min_winrate', 'number', null, { min: 10, max: 90, step: 1 })}
                    </div>
                  )}
               </div>
            </div>
          </div>
        )}

        {section === 'schedule' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
               <div className="text-[10px] text-dim font-bold tracking-widest uppercase">Trading Windows (24h)</div>
               <button
                  onClick={() => setField('trading_windows', [...(cfg.trading_windows || []), { start: '09:00', end: '17:00' }])}
                  className="text-[10px] font-bold text-accent uppercase tracking-widest"
               >+ Add Window</button>
            </div>

            {(cfg.trading_windows || []).length === 0 ? (
               <div className="p-8 border border-dashed border-border rounded-xl text-center">
                  <span className="text-xs text-dim">Trade 24/7 (No restrictions)</span>
               </div>
            ) : (
               <div className="space-y-3">
                  {cfg.trading_windows.map((w, i) => (
                    <div key={i} className="flex items-center gap-3 p-4 bg-background border border-border rounded-xl">
                       <div className="flex-1 flex flex-col gap-1">
                          <span className="text-[9px] text-dim uppercase font-bold">Start</span>
                          <input type="time" value={w.start} onChange={(e) => {
                             const next = [...cfg.trading_windows];
                             next[i] = { ...next[i], start: e.target.value };
                             setField('trading_windows', next);
                          }} className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono" />
                       </div>
                       <div className="flex-1 flex flex-col gap-1">
                          <span className="text-[9px] text-dim uppercase font-bold">End</span>
                          <input type="time" value={w.end} onChange={(e) => {
                             const next = [...cfg.trading_windows];
                             next[i] = { ...next[i], end: e.target.value };
                             setField('trading_windows', next);
                          }} className="bg-surface border border-border rounded px-2 py-1 text-xs font-mono" />
                       </div>
                       <button onClick={() => setField('trading_windows', cfg.trading_windows.filter((_, idx) => idx !== i))} className="text-red/60 hover:text-red p-2">
                          <Trash2 size={16} />
                       </button>
                    </div>
                  ))}
               </div>
            )}
            <p className="text-[10px] text-dim/60 leading-relaxed italic">
               Note: System will enter 'Sleep Mode' outside these windows if no positions are open, reducing API consumption and CPU usage.
            </p>
          </div>
        )}

        {section === 'presets' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3">
              <label className="text-[10px] text-dim font-bold tracking-widest uppercase">Save Current as Preset</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Scalping 1m"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm font-mono text-text focus:outline-none focus:border-accent"
                />
                <button
                  onClick={savePreset}
                  disabled={!presetName}
                  className="bg-accent/10 border border-accent/20 text-accent px-4 py-2 rounded-md hover:bg-accent/20 disabled:opacity-50 transition-colors"
                >
                  <Save size={18} />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] text-dim font-bold tracking-widest uppercase">Saved Library</label>
              {presets.length === 0 ? (
                <div className="p-10 border border-dashed border-border rounded-xl text-center text-dim text-xs font-medium">
                  No presets saved yet
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {presets.map((p) => (
                    <div
                      key={p.name}
                      onClick={() => loadPreset(p)}
                      className="group flex items-center justify-between p-4 bg-background border border-border rounded-xl cursor-pointer hover:border-accent/40 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center border border-border group-hover:border-accent/20">
                          <FolderOpen size={14} className="text-dim group-hover:text-accent" />
                        </div>
                        <div>
                          <div className="text-sm font-bold group-hover:text-accent transition-colors">{p.name}</div>
                          <div className="text-[10px] text-dim font-mono">{p.config.scan_interval} · {p.config.scan_pct_threshold}% · {p.config.risk_pct_per_trade}% Risk</div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => deletePreset(e, p.name)}
                        className="p-2 text-dim hover:text-red transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'mode' && (
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="text-[10px] text-dim font-bold tracking-widest uppercase">Trading Environment</div>
              <div className="grid grid-cols-1 gap-4">
                <button
                  onClick={() => { setField('trading_mode', 'paper'); setField('paper_mode', true); }}
                  className={cn(
                    "p-4 rounded-xl border-2 text-left transition-all",
                    (cfg.trading_mode === 'paper' || (cfg.paper_mode && !cfg.trading_mode)) ? "border-amber bg-amber/5" : "border-border bg-surface hover:border-dim/50"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">Local Paper Trading</span>
                    {(cfg.trading_mode === 'paper' || (cfg.paper_mode && !cfg.trading_mode)) && <div className="w-2 h-2 rounded-full bg-amber shadow-[0_0_8px_rgba(245,166,35,0.8)]" />}
                  </div>
                  <p className="text-[11px] text-dim leading-relaxed">Simulated fills within the app. No real exchange connection required. Best for initial logic testing.</p>
                </button>

                <button
                  onClick={() => { setField('trading_mode', 'testnet'); setField('paper_mode', false); }}
                  className={cn(
                    "p-4 rounded-xl border-2 text-left transition-all",
                    cfg.trading_mode === 'testnet' ? "border-purple bg-purple/5" : "border-border bg-surface hover:border-dim/50"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">Binance Demo (Testnet)</span>
                    {cfg.trading_mode === 'testnet' && <div className="w-2 h-2 rounded-full bg-purple shadow-[0_0_8px_rgba(168,85,247,0.8)]" />}
                  </div>
                  <p className="text-[11px] text-dim leading-relaxed">Real-time execution on Binance Testnet. Uses demo funds but tests actual connectivity and exchange latency.</p>
                </button>

                <button
                  onClick={() => { setField('trading_mode', 'live'); setField('paper_mode', false); }}
                  className={cn(
                    "p-4 rounded-xl border-2 text-left transition-all",
                    cfg.trading_mode === 'live' ? "border-green bg-green/5" : "border-border bg-surface hover:border-dim/50"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">Binance Live Trading</span>
                    {cfg.trading_mode === 'live' && <div className="w-2 h-2 rounded-full bg-green shadow-[0_0_8px_rgba(34,197,94,0.8)]" />}
                  </div>
                  <p className="text-[11px] text-dim leading-relaxed">Real funds on Binance Futures. Use with extreme caution. Ensure API keys have appropriate permissions.</p>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-border/50">
              {field('Initial Balance USDT', cfg.trading_mode === 'paper' ? 'paper_starting_balance' : 'live_starting_balance', 'number', null, { min: 10, step: 100 })}
            </div>
          </div>
        )}
      </div>

      <div className="p-5 border-t border-border bg-surface flex gap-3 shrink-0">
        <Btn variant="ghost" onClick={onClose} className="flex-1">Cancel</Btn>
        <Btn variant="primary" onClick={() => onSave(cfg)} className="flex-[2]">
          {isEdit ? 'Apply Changes' : 'Start Session'}
        </Btn>
      </div>
    </div>
  )
}
