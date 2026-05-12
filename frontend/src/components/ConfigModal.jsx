import React, { useMemo, useState } from 'react'
import { C } from '../lib/theme'

const SIGNALS = [
  ['momentum_pct', '% Momentum'],
  ['breakout_hl', 'Breakout H/L'],
  ['ema_cross', 'EMA Cross'],
]

const Toggle = ({ value, onChange, label, color = C.accent }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    className="toggle-control"
    style={{ color: value ? C.text : C.dim }}
  >
    <span style={{ background: value ? color : C.border }}>
      <i style={{ left: value ? 22 : 3 }} />
    </span>
    {label}
  </button>
)

const Chip = ({ active, onClick, children, color = C.accent }) => (
  <button
    type="button"
    onClick={onClick}
    className="config-chip"
    style={{
      borderColor: active ? color : C.border,
      background: active ? `${color}20` : 'transparent',
      color: active ? color : C.dim,
    }}
  >
    {children}
  </button>
)

export const ConfigModal = ({ initialConfig, onSave, onClose }) => {
  const [cfg, setCfg] = useState({ ...initialConfig })
  const [section, setSection] = useState('scan')

  const setField = (key, value) => setCfg((prev) => ({ ...prev, [key]: value }))
  const numberField = (label, key, attrs = {}) => field(label, key, 'number', null, attrs)
  const selectField = (label, key, opts) => field(label, key, 'text', opts)

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
      <div className="field">
        <label htmlFor={id}>{label}</label>
        {opts ? (
          <select id={id} value={cfg[key] ?? ''} onChange={(e) => setField(key, e.target.value)}>
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
    <div className="modal-overlay">
      <div className="config-panel" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <div className="config-header">
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>New Session</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Configure scanner, exits, and risk before launch</div>
          </div>
          <button onClick={onClose} className="icon-button" aria-label="Close configuration">Close</button>
        </div>

        <div className="config-sections">
          {[
            ['scan', 'Scan'],
            ['signals', 'Signals'],
            ['exit', 'Exit'],
            ['risk', 'Risk'],
            ['mode', 'Mode'],
          ].map(([id, label]) => (
            <Chip key={id} active={section === id} onClick={() => setSection(id)}>{label}</Chip>
          ))}
        </div>

        {section === 'scan' && (
          <>
            <div className="section-title">Scanner</div>
            <div className="config-grid">
              {selectField('Interval', 'scan_interval', ['1m', '5m', '15m', '1h'])}
              {numberField('Lookback candles', 'scan_lookback', { min: 1, max: 20 })}
              {numberField('% threshold', 'scan_pct_threshold', { min: 0.1, step: 0.1 })}
              {numberField('Min volume USDT', 'scan_min_volume_usdt', { min: 0, step: 100000 })}
              {numberField('Watchlist size', 'watchlist_size', { min: 10, max: 100 })}
              {selectField('Entry side', 'entry_side', ['both', 'long', 'short'])}
            </div>
            <div className="mode-row">
              <Chip active={cfg.scan_mode === 'interval'} onClick={() => setField('scan_mode', 'interval')}>Interval</Chip>
              <Chip active={cfg.scan_mode === 'active_window'} onClick={() => setField('scan_mode', 'active_window')}>Active Window</Chip>
            </div>
            {cfg.scan_mode === 'active_window' && (
              <div className="config-grid">
                {numberField('Window duration sec', 'scan_window_duration_sec', { min: 10, max: 600 })}
                {numberField('Check interval sec', 'scan_check_interval_sec', { min: 2, max: 60 })}
              </div>
            )}
          </>
        )}

        {section === 'signals' && (
          <>
            <div className="section-title">Entry Signals</div>
            <div className="mode-row">
              <Chip active={cfg.signal_logic === 'all'} onClick={() => setField('signal_logic', 'all')}>Require All</Chip>
              <Chip active={cfg.signal_logic === 'any'} onClick={() => setField('signal_logic', 'any')}>Allow Any</Chip>
            </div>
            <div className="signal-grid">
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
          </>
        )}

        {section === 'exit' && (
          <>
            <div className="section-title">Take Profit</div>
            <div className="mode-row">
              <Chip active={cfg.tp_mode === 'fixed'} onClick={() => setField('tp_mode', 'fixed')}>Fixed R:R</Chip>
              <Chip active={cfg.tp_mode === 'exp_rr_seq'} onClick={() => setField('tp_mode', 'exp_rr_seq')}>EXP RR</Chip>
            </div>
            {cfg.tp_mode === 'fixed' ? (
              <div className="config-grid">{numberField('TP ratio', 'tp_ratio', { min: 0.2, step: 0.1 })}</div>
            ) : (
              <div className="sequence-editor">
                {sequence.map(([trigger, exit], i) => (
                  <div key={i} className="sequence-row">
                    <span>{i + 1}</span>
                    <input type="number" value={trigger} min="0.5" step="0.5" onChange={(e) => updateSequence(i, 0, e.target.value)} />
                    <input type="number" value={exit} min="-1" step="0.5" onChange={(e) => updateSequence(i, 1, e.target.value)} />
                    <strong>{exit === 0 ? 'BE' : `${exit}R`}</strong>
                    <button type="button" onClick={() => removeStep(i)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="ghost-button" onClick={addStep}>Add Step</button>
              </div>
            )}

            <div className="section-title">Stop Loss</div>
            <div className="mode-row">
              <Chip active={cfg.sl_type === 'pct'} onClick={() => setField('sl_type', 'pct')}>Fixed Percent</Chip>
              <Chip active={cfg.sl_type === 'lookback_low/high'} onClick={() => setField('sl_type', 'lookback_low/high')}>Lookback H/L</Chip>
            </div>
            {cfg.sl_type === 'pct' ? (
              <div className="config-grid">{numberField('SL distance %', 'sl_distance_pct', { min: 0.05, step: 0.05 })}</div>
            ) : (
              <div className="config-grid">
                {selectField('SL timeframe', 'sl_lookback_timeframe', ['1m', '5m', '15m', '1h', '4h'])}
                {numberField('Lookback bars', 'sl_lookback_period', { min: 1, max: 50 })}
                {numberField('Min SL %', 'sl_min_pct', { min: 0.05, step: 0.05 })}
                {numberField('Max SL %', 'sl_max_pct', { min: 0.1, step: 0.1 })}
              </div>
            )}
          </>
        )}

        {section === 'risk' && (
          <>
            <div className="section-title">Risk Guard</div>
            <div className="config-grid">
              {numberField('Risk % per trade', 'risk_pct_per_trade', { min: 0.1, step: 0.1 })}
              {numberField('Max open trades', 'max_open_trades', { min: 1 })}
              {numberField('Max total risk %', 'max_total_risk_pct', { min: 0.5, step: 0.5 })}
              {numberField('SL guard USDT', 'total_sl_guard_usdt', { min: 1, step: 10 })}
            </div>
            <div className="sizing-preview">
              <div><span>Risk amount</span><strong style={{ color: C.amber }}>${riskAmount.toFixed(2)}</strong></div>
              <div><span>SL distance at $100</span><strong style={{ color: C.red }}>{slDistance.toFixed(2)}</strong></div>
              <div><span>Estimated qty</span><strong style={{ color: C.accent }}>{estimatedQty.toFixed(1)}</strong></div>
            </div>
          </>
        )}

        {section === 'mode' && (
          <>
            <div className="section-title">Trading Mode</div>
            <div className="mode-card" style={{ borderColor: cfg.paper_mode ? C.amber : C.green }}>
              <Toggle value={cfg.paper_mode} onChange={(value) => setField('paper_mode', value)} label={cfg.paper_mode ? 'Paper Mode' : 'Live Trading'} color={cfg.paper_mode ? C.amber : C.green} />
              <p>{cfg.paper_mode ? 'Simulated fills with no real funds at risk.' : 'Real Binance Futures orders. Confirm keys and permissions before launch.'}</p>
            </div>
            <div className="config-grid">
              {numberField('Paper balance USDT', 'paper_starting_balance', { min: 100, step: 1000 })}
              {numberField('Live balance reference', 'live_starting_balance', { min: 0, step: 1000 })}
            </div>
          </>
        )}

        <div className="config-actions">
          <button onClick={onClose} className="ghost-button">Cancel</button>
          <button onClick={() => onSave(cfg)} className="primary-button">Start Session</button>
        </div>
      </div>
    </div>
  )
}
