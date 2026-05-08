import React, { useState } from 'react'
import { C } from '../lib/theme'

export const ConfigModal = ({ initialConfig, onSave, onClose }) => {
  const [cfg, setCfg] = useState({ ...initialConfig });

  const field = (label, key, type = "number", opts = null) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>{label}</label>
      {opts
        ? <select value={cfg[key]} onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))}
            style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: "8px 10px", fontSize: 13, fontFamily: "monospace", outline: 'none' }}>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        : <input type={type} value={cfg[key]} onChange={e => setCfg(p => ({ ...p, [key]: type === "number" ? parseFloat(e.target.value) : e.target.value }))}
            style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: "8px 10px", fontSize: 13, fontFamily: "monospace", outline: 'none' }} />}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: 480, maxHeight: "90vh", overflow: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>New Strategy</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Momentum Breakout Configuration</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>── SCANNER</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          {field("Interval", "scan_interval", "text", ["1m", "5m", "15m", "1h"])}
          {field("Lookback (candles)", "scan_lookback")}
          {field("% Threshold", "scan_pct_threshold")}
          {field("Min Volume (USDT)", "scan_min_volume_usdt")}
        </div>

        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>── RISK</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          {field("Risk % per Trade", "risk_pct_per_trade")}
          {field("SL Distance %", "sl_distance_pct")}
          {field("TP Ratio (R)", "tp_ratio")}
          {field("Side", "entry_side", "text", ["both", "long", "short"])}
        </div>

        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>── SIZING PREVIEW</div>
        <div style={{ background: C.bg, borderRadius: 8, padding: 14, fontFamily: "monospace", fontSize: 12, color: C.dim, marginBottom: 20 }}>
          <div>Balance: <span style={{ color: C.text }}>$10,000</span></div>
          <div>Risk Amount: <span style={{ color: C.green }}>${(10000 * (cfg.risk_pct_per_trade || 0) / 100).toFixed(2)}</span></div>
          <div>SL Distance: <span style={{ color: C.red }}>{cfg.sl_distance_pct}% of entry</span></div>
          <div style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
            qty = risk_amt ÷ (entry × sl_pct) = <span style={{ color: C.accent }}>~{((10000 * (cfg.risk_pct_per_trade || 0) / 100) / (100 * (cfg.sl_distance_pct || 1) / 100)).toFixed(1)} units @ $100</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div onClick={() => setCfg(p => ({ ...p, paper_mode: !p.paper_mode }))} style={{ width: 44, height: 24, borderRadius: 12, background: cfg.paper_mode ? C.amber : C.border, cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
            <div style={{ position: "absolute", top: 3, left: cfg.paper_mode ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
          </div>
          <span style={{ fontSize: 13, color: cfg.paper_mode ? C.amber : C.dim }}>Paper Mode {cfg.paper_mode ? "ON" : "OFF"}</span>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button onClick={() => onSave(cfg)} style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Start Session</button>
        </div>
      </div>
    </div>
  );
}
