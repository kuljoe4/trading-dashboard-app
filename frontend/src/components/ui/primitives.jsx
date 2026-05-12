import React from 'react'
import { C } from '../../lib/theme'

// --- Pulse dot ---
export const PulseDot = ({ color }) => (
  <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 10, height: 10 }}>
    <span style={{
      position: "absolute", width: 10, height: 10, borderRadius: "50%",
      background: color, opacity: 0.3,
      animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
    }} />
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
  </span>
)

// --- Stat Card ---
export const StatCard = ({ label, value, color = C.text }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 16, borderRadius: 8 }}>
    <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
  </div>
)

// --- Section Label ---
export const SectionLabel = ({ children }) => (
  <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>
    {children}
  </div>
)

// --- Button ---
export const Btn = ({ children, variant, onClick, style: customStyle, disabled, ...props }) => (
  <button 
    onClick={onClick}
    disabled={disabled}
    style={{ 
      padding: '8px 16px', 
      borderRadius: 6, 
      border: variant === 'danger' ? `1px solid ${C.redBorder}` : 'none', 
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: variant === 'success' ? C.green : variant === 'danger' ? C.redDim : C.accent,
      color: variant === 'danger' ? C.red : 'white',
      fontWeight: 'bold',
      fontSize: 12,
      opacity: disabled ? 0.5 : 1,
      ...customStyle
    }}
    {...props}
  >
    {children}
  </button>
)

// --- Status Badge ---
export const StatusBadge = ({ status }) => {
  const active = status === true || status === 'live'
  const cfg = active
    ? { color: C.green, bg: C.greenDim, border: C.greenBorder, label: "LIVE" }
    : { color: C.dim, bg: "#1a2030", border: C.border, label: "STOPPED" };
  
  return (
    <span style={{ 
      display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", 
      borderRadius: 4, border: `1px solid ${cfg.border}`, background: cfg.bg, 
      fontSize: 10, fontWeight: 700, color: cfg.color, letterSpacing: 1 
    }}>
      {active && <PulseDot color={cfg.color} />}
      {cfg.label}
    </span>
  );
}

// --- Paper Badge ---
export const PaperBadge = () => (
  <span style={{ 
    padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.amberDim}`, 
    background: C.amberDim, fontSize: 10, color: C.amber, fontWeight: 700, letterSpacing: 1 
  }}>
    PAPER
  </span>
)

// --- Condition Widget ---
export const ConditionWidget = ({ label, value, threshold, unit = "%", satisfied, sublabel }) => {
  const pct = Math.min((Math.abs(value) / (threshold * 1.5)) * 100, 100);
  const color = satisfied ? C.green : C.amber;
  return (
    <div style={{ flex: 1, background: C.surface, border: `1px solid ${satisfied ? C.greenBorder : C.border}`, borderRadius: 8, padding: 16, transition: "border-color 0.3s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "monospace" }}>
            {value > 0 ? "+" : ""}{value.toFixed(2)}{unit}
          </div>
          {sublabel && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{sublabel}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: C.dim, marginBottom: 4 }}>THRESHOLD</div>
          <div style={{ fontSize: 14, color: C.text, fontFamily: "monospace" }}>≥ {threshold}{unit}</div>
        </div>
      </div>
      <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.5s, background 0.3s" }} />
      </div>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
        {satisfied
          ? <><span style={{ fontSize: 12, color: C.green }}>✓</span><span style={{ fontSize: 11, color: C.green }}>Condition met</span></>
          : <><span style={{ fontSize: 12, color: C.amber }}>○</span><span style={{ fontSize: 11, color: C.amber }}>Watching…</span></>}
      </div>
    </div>
  );
}

// --- P&L Bars ---
export const PnLBars = ({ trades }) => {
  if (!trades || trades.length === 0) return <div style={{ height: 60 }} />
  const max = Math.max(...trades.map(t => Math.abs(t.pnl || 0)), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60, padding: "0 4px" }}>
      {trades.map((t, i) => {
        const pnl = t.pnl || 0;
        const h = Math.max(4, (Math.abs(pnl) / max) * 52);
        return (
          <div key={i} title={`${t.symbol}: ${pnl}`} style={{
            flex: 1, height: h, borderRadius: "2px 2px 0 0",
            background: pnl >= 0 ? C.green : C.red,
            opacity: 0.85, cursor: "default", transition: "opacity 0.2s"
          }} />
        );
      })}
    </div>
  );
}

// --- Sparkline ---
export const Sparkline = ({ data = [], width = 60, height = 24, color = C.accent }) => {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
