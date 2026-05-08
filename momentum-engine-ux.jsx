import { useState, useEffect, useRef } from "react";

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg: "#080b0f",
  surface: "#0d1117",
  border: "#1a2030",
  borderHover: "#2a3550",
  muted: "#3a4560",
  text: "#c8d4e8",
  dim: "#5a6a88",
  green: "#00e5a0",
  greenDim: "#00e5a015",
  greenBorder: "#00e5a030",
  red: "#ff4466",
  redDim: "#ff446615",
  redBorder: "#ff446630",
  amber: "#f5a623",
  amberDim: "#f5a62315",
  blue: "#4a9eff",
  blueDim: "#4a9eff15",
  accent: "#5b6fff",
  accentDim: "#5b6fff20",
};

// ─── Mock Data ─────────────────────────────────────────────────────────────────
const MOCK_STRATEGIES = [
  {
    id: "s1",
    name: "Breakout 5m +2%",
    status: "live",
    mode: "loop",
    hits: 14,
    pnl: 312.40,
    totalSL: 200,
    currentSLUsed: 0,
    config: { scan_interval: "5m", scan_lookback: 3, scan_pct_threshold: 2.0, sl_distance_pct: 0.8, risk_pct: 1.0, tp_ratio: 2.0, entry_side: "both", paper_mode: false },
    activeTrade: { symbol: "INJUSDT", side: "long", entry: 28.42, current: 28.91, sl: 27.69, tp: 30.96, qty: 87.4, pnl: 42.8, rr: 0.67 },
  },
  {
    id: "s2",
    name: "Scalp 1m Long Only",
    status: "live",
    mode: "loop",
    hits: 31,
    pnl: -88.20,
    totalSL: 150,
    currentSLUsed: 88.2,
    config: { scan_interval: "1m", scan_lookback: 5, scan_pct_threshold: 1.0, sl_distance_pct: 0.4, risk_pct: 0.5, tp_ratio: 1.5, entry_side: "long", paper_mode: false },
    activeTrade: null,
  },
  {
    id: "s3",
    name: "15m Momentum Paper",
    status: "stopped",
    mode: "loop",
    hits: 7,
    pnl: 540.00,
    totalSL: 300,
    currentSLUsed: 0,
    config: { scan_interval: "15m", scan_lookback: 2, scan_pct_threshold: 3.0, sl_distance_pct: 1.2, risk_pct: 1.5, tp_ratio: 2.5, entry_side: "both", paper_mode: true },
    activeTrade: null,
  },
];

const MOCK_OPPORTUNITIES = [
  { symbol: "INJUSDT", pct: 2.84, dir: "long", vol: 2_140_000, score: 9.2, price: 28.91 },
  { symbol: "SUIUSDT", pct: 2.41, dir: "long", vol: 1_870_000, score: 8.1, price: 1.342 },
  { symbol: "SEIUSDT", pct: -2.18, dir: "short", vol: 960_000, score: 6.4, price: 0.412 },
  { symbol: "TIAUSDT", pct: 1.94, dir: "long", vol: 1_200_000, score: 5.9, price: 6.21 },
  { symbol: "ARKMUSDT", pct: -1.71, dir: "short", vol: 740_000, score: 4.8, price: 1.08 },
  { symbol: "BONKUSDT", pct: 1.62, dir: "long", vol: 3_100_000, score: 4.6, price: 0.0000211 },
];

const MOCK_TIMELINE = [
  { id: 1, symbol: "SOLUSDT", side: "long", entry: 148.2, exit: 151.9, pnl: 34.2, rr: 2.1, type: "tp", time: "14:22" },
  { id: 2, symbol: "APTUSDT", side: "long", entry: 9.14, exit: 8.87, pnl: -10.0, rr: -1.0, type: "sl", time: "13:05" },
  { id: 3, symbol: "INJUSDT", side: "short", entry: 29.8, exit: 28.9, pnl: 45.3, rr: 2.4, type: "tp", time: "11:48" },
  { id: 4, symbol: "AVAXUSDT", side: "long", entry: 34.1, exit: 35.2, pnl: 22.8, rr: 1.9, type: "tp", time: "09:31" },
  { id: 5, symbol: "SUIUSDT", side: "long", entry: 1.31, exit: 1.30, pnl: -10.0, rr: -1.0, type: "sl", time: "08:14" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d);
const fmtU = (n) => n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
const fmtVol = (v) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}K`;
const pnlColor = (n) => n >= 0 ? C.green : C.red;

// ─── Pulse dot ────────────────────────────────────────────────────────────────
function PulseDot({ color }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 10, height: 10 }}>
      <span style={{
        position: "absolute", width: 10, height: 10, borderRadius: "50%",
        background: color, opacity: 0.3,
        animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
      }} />
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = status === "live"
    ? { color: C.green, bg: C.greenDim, border: C.greenBorder, label: "LIVE" }
    : { color: C.dim, bg: "#1a2030", border: C.border, label: "STOPPED" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 4, border: `1px solid ${cfg.border}`, background: cfg.bg, fontSize: 10, fontWeight: 700, color: cfg.color, letterSpacing: 1 }}>
      {status === "live" && <PulseDot color={cfg.color} />}
      {cfg.label}
    </span>
  );
}

// ─── Paper Badge ──────────────────────────────────────────────────────────────
function PaperBadge() {
  return <span style={{ padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.amberDim}`, background: C.amberDim, fontSize: 10, color: C.amber, fontWeight: 700, letterSpacing: 1 }}>PAPER</span>;
}

// ─── Condition Widget ─────────────────────────────────────────────────────────
function ConditionWidget({ label, value, threshold, unit = "%", satisfied, sublabel }) {
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

// ─── Timeline Card ────────────────────────────────────────────────────────────
function TimelineCard({ trade }) {
  const isTP = trade.type === "tp";
  const isSL = trade.type === "sl";
  const color = isTP ? C.green : C.red;
  const bg = isTP ? C.greenDim : C.redDim;
  const border = isTP ? C.greenBorder : C.redBorder;
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${border}`, background: bg, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>{trade.symbol}</span>
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: trade.side === "long" ? C.greenDim : C.redDim, color: trade.side === "long" ? C.green : C.red, fontWeight: 700 }}>
            {trade.side.toUpperCase()}
          </span>
        </div>
        <span style={{ fontSize: 10, color: C.dim, fontFamily: "monospace" }}>{trade.time}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 10, color: C.dim }}>P&L </span>
          <span style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "monospace" }}>{fmtU(trade.pnl)}</span>
        </div>
        <div>
          <span style={{ fontSize: 10, color: C.dim }}>R:R </span>
          <span style={{ fontSize: 12, color, fontFamily: "monospace" }}>{fmt(trade.rr, 1)}</span>
        </div>
        <div style={{ padding: "1px 7px", borderRadius: 3, border: `1px solid ${border}`, fontSize: 10, fontWeight: 700, color, alignSelf: "center" }}>
          {isTP ? "TP HIT" : "SL HIT"}
        </div>
      </div>
    </div>
  );
}

// ─── Active Trade Bar ─────────────────────────────────────────────────────────
function ActiveTradeBar({ trade }) {
  if (!trade) return (
    <div style={{ padding: "16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, textAlign: "center", color: C.dim, fontSize: 13 }}>
      No active position — scanning…
    </div>
  );
  const slDist = ((trade.entry - trade.sl) / trade.entry * 100).toFixed(2);
  const tpDist = ((trade.tp - trade.entry) / trade.entry * 100).toFixed(2);
  const progress = Math.max(0, Math.min(100, ((trade.current - trade.sl) / (trade.tp - trade.sl)) * 100));
  return (
    <div style={{ padding: 16, borderRadius: 8, border: `1px solid ${C.greenBorder}`, background: C.greenDim }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PulseDot color={C.green} />
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>{trade.symbol}</span>
          <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: C.greenDim, color: C.green, fontWeight: 700, border: `1px solid ${C.greenBorder}` }}>
            {trade.side.toUpperCase()}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: pnlColor(trade.pnl), fontFamily: "monospace" }}>{fmtU(trade.pnl)}</div>
          <div style={{ fontSize: 11, color: C.dim }}>R:R {fmt(trade.rr, 1)}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        {[["ENTRY", `$${trade.entry}`], ["CURRENT", `$${trade.current}`], ["QTY", `${trade.qty}`]].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3, letterSpacing: 1 }}>{k}</div>
            <div style={{ fontSize: 13, color: C.text, fontFamily: "monospace", fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10, color: C.dim }}>
        <span style={{ color: C.red }}>SL ${trade.sl} (−{slDist}%)</span>
        <span style={{ color: C.green }}>TP ${trade.tp} (+{tpDist}%)</span>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: `linear-gradient(90deg, ${C.red}40, ${C.green}40)` }} />
        <div style={{ position: "absolute", left: `${progress}%`, top: -2, width: 10, height: 10, borderRadius: "50%", background: C.green, border: `2px solid ${C.bg}`, transform: "translateX(-50%)" }} />
      </div>
    </div>
  );
}

// ─── Mini P&L Bars (simple chart) ────────────────────────────────────────────
function PnLBars({ trades }) {
  const max = Math.max(...trades.map(t => Math.abs(t.pnl)));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60, padding: "0 4px" }}>
      {trades.map(t => {
        const h = Math.max(4, (Math.abs(t.pnl) / max) * 52);
        return (
          <div key={t.id} title={`${t.symbol}: ${fmtU(t.pnl)}`} style={{
            flex: 1, height: h, borderRadius: "2px 2px 0 0",
            background: t.pnl >= 0 ? C.green : C.red,
            opacity: 0.85, cursor: "default", transition: "opacity 0.2s"
          }} />
        );
      })}
    </div>
  );
}

// ─── Opportunity Row ──────────────────────────────────────────────────────────
function OpportunityRow({ opp, rank, threshold }) {
  const passing = Math.abs(opp.pct) >= threshold;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 80px 70px 80px 60px", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${C.border}`, opacity: passing ? 1 : 0.4 }}>
      <span style={{ fontSize: 11, color: C.dim, fontFamily: "monospace" }}>#{rank}</span>
      <div>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>{opp.symbol.replace("USDT", "")}</span>
        <span style={{ fontSize: 10, color: C.dim }}>/USDT</span>
      </div>
      <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: opp.pct >= 0 ? C.green : C.red, textAlign: "right" }}>
        {opp.pct >= 0 ? "▲" : "▼"} {Math.abs(opp.pct).toFixed(2)}%
      </span>
      <span style={{ fontSize: 11, color: C.dim, fontFamily: "monospace", textAlign: "right" }}>{fmtVol(opp.vol)}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2 }}>
          <div style={{ width: `${(opp.score / 10) * 100}%`, height: "100%", background: C.accent, borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 10, color: C.dim, fontFamily: "monospace", minWidth: 24 }}>{opp.score.toFixed(1)}</span>
      </div>
      {passing
        ? <span style={{ fontSize: 10, fontWeight: 700, color: C.green, textAlign: "center" }}>✓</span>
        : <span style={{ fontSize: 10, color: C.dim, textAlign: "center" }}>—</span>}
    </div>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────
function TopBar({ balance, totalRisk, onKill, sessionActive }) {
  return (
    <div style={{ height: 52, background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 20px", gap: 20, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: "auto" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: 0.5 }}>MOMENTUM ENGINE</span>
      </div>
      <div>
        <span style={{ fontSize: 10, color: C.dim }}>BALANCE </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>${balance.toLocaleString()}</span>
      </div>
      <div>
        <span style={{ fontSize: 10, color: C.dim }}>OPEN RISK </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: totalRisk > 3 ? C.amber : C.text, fontFamily: "monospace" }}>{totalRisk.toFixed(1)}%</span>
      </div>
      <button onClick={onKill} style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.redBorder}`, background: C.redDim, color: C.red, fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: 1 }}>
        ⬛ KILL
      </button>
    </div>
  );
}

// ─── Config Modal ─────────────────────────────────────────────────────────────
function ConfigModal({ strategy, onClose }) {
  const [cfg, setCfg] = useState({ ...strategy.config });
  const field = (label, key, type = "number", opts = null) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>{label}</label>
      {opts
        ? <select value={cfg[key]} onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))}
            style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: "8px 10px", fontSize: 13, fontFamily: "monospace" }}>
            {opts.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        : <input type={type} value={cfg[key]} onChange={e => setCfg(p => ({ ...p, [key]: type === "number" ? parseFloat(e.target.value) : e.target.value }))}
            style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: "8px 10px", fontSize: 13, fontFamily: "monospace" }} />}
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, width: 480, maxHeight: "80vh", overflow: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{strategy.name}</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Strategy Configuration</div>
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
          {field("Risk % per Trade", "risk_pct")}
          {field("SL Distance %", "sl_distance_pct")}
          {field("TP Ratio (R)", "tp_ratio")}
          {field("Side", "entry_side", "text", ["both", "long", "short"])}
        </div>

        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>── SIZING PREVIEW</div>
        <div style={{ background: C.bg, borderRadius: 8, padding: 14, fontFamily: "monospace", fontSize: 12, color: C.dim, marginBottom: 20 }}>
          <div>Balance: <span style={{ color: C.text }}>$10,000</span></div>
          <div>Risk Amount: <span style={{ color: C.green }}>${(10000 * cfg.risk_pct / 100).toFixed(2)}</span></div>
          <div>SL Distance: <span style={{ color: C.red }}>{cfg.sl_distance_pct}% of entry</span></div>
          <div style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
            qty = risk_amt ÷ (entry × sl_pct) = <span style={{ color: C.accent }}>~{((10000 * cfg.risk_pct / 100) / (100 * cfg.sl_distance_pct / 100)).toFixed(1)} units @ $100</span>
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
          <button onClick={onClose} style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Save & Apply</button>
        </div>
      </div>
    </div>
  );
}

// ─── Strategy Card (dashboard list) ──────────────────────────────────────────
function StrategyCard({ s, onClick }) {
  const slPct = (s.currentSLUsed / s.totalSL) * 100;
  return (
    <div onClick={onClick} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18, cursor: "pointer", transition: "border-color 0.2s", position: "relative" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.borderHover}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <StatusBadge status={s.status} />
            {s.config.paper_mode && <PaperBadge />}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{s.name}</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>
            {s.config.scan_interval} · {s.config.scan_pct_threshold}% threshold · SL {s.config.sl_distance_pct}%
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: pnlColor(s.pnl), fontFamily: "monospace" }}>{fmtU(s.pnl)}</div>
          <div style={{ fontSize: 11, color: C.dim }}>{s.hits} hits</div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.dim, marginBottom: 4 }}>
          <span>TOTAL SL GUARD</span>
          <span style={{ color: slPct > 70 ? C.red : C.dim }}>${s.currentSLUsed.toFixed(0)} / ${s.totalSL}</span>
        </div>
        <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
          <div style={{ width: `${slPct}%`, height: "100%", background: slPct > 70 ? C.red : C.accent, borderRadius: 2, transition: "width 0.5s" }} />
        </div>
      </div>

      {s.activeTrade && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, background: C.greenDim, border: `1px solid ${C.greenBorder}` }}>
          <PulseDot color={C.green} />
          <span style={{ fontSize: 12, color: C.text, fontFamily: "monospace" }}>{s.activeTrade.symbol}</span>
          <span style={{ fontSize: 11, color: s.activeTrade.side === "long" ? C.green : C.red }}>{s.activeTrade.side.toUpperCase()}</span>
          <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: pnlColor(s.activeTrade.pnl), fontFamily: "monospace" }}>{fmtU(s.activeTrade.pnl)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Strategy Detail View ─────────────────────────────────────────────────────
function StrategyDetailView({ strategy, onBack, onConfig }) {
  const s = strategy;
  const bestOpp = MOCK_OPPORTUNITIES[0];
  const scanMet = Math.abs(bestOpp.pct) >= s.config.scan_pct_threshold;
  const entryMet = scanMet && !!s.activeTrade;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.dim, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{s.name}</span>
            <StatusBadge status={s.status} />
            {s.config.paper_mode && <PaperBadge />}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>Loop mode · Started 2h ago</div>
        </div>
        <button onClick={onConfig} style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${C.border}`, background: "none", color: C.text, cursor: "pointer", fontSize: 12 }}>⚙ Config</button>
        <button style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${C.redBorder}`, background: C.redDim, color: C.red, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>■ Stop</button>
      </div>

      {/* Summary Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          ["TOTAL P&L", fmtU(s.pnl), pnlColor(s.pnl)],
          ["HITS", s.hits.toString(), C.text],
          ["SL USED", `$${s.currentSLUsed} / $${s.totalSL}`, s.currentSLUsed > s.totalSL * 0.7 ? C.amber : C.text],
          ["OPEN RISK", s.activeTrade ? `${((s.config.risk_pct)).toFixed(1)}%` : "0%", C.text],
        ].map(([k, v, col]) => (
          <div key={k} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1, marginBottom: 6 }}>{k}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: col, fontFamily: "monospace" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Condition Widgets */}
      <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>Entry Conditions</div>
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <ConditionWidget
          label={`Scanner: % Move in last ${s.config.scan_lookback}×${s.config.scan_interval}`}
          value={bestOpp.pct}
          threshold={s.config.scan_pct_threshold}
          satisfied={scanMet}
          sublabel={`Best: ${bestOpp.symbol} ${bestOpp.dir.toUpperCase()}`}
        />
        <ConditionWidget
          label="Entry Confirmation"
          value={entryMet ? s.config.scan_pct_threshold + 0.3 : s.config.scan_pct_threshold - 0.5}
          threshold={s.config.scan_pct_threshold}
          unit=" confirm"
          satisfied={entryMet}
          sublabel="Breakout above N-bar high"
        />
      </div>

      {/* Active Position */}
      <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>Active Position</div>
      <div style={{ marginBottom: 24 }}>
        <ActiveTradeBar trade={s.activeTrade} />
      </div>

      {/* P&L Chart + Timeline */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 14, textTransform: "uppercase" }}>P&L Per Hit</div>
          <PnLBars trades={MOCK_TIMELINE} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            {MOCK_TIMELINE.map(t => (
              <div key={t.id} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>{t.symbol.replace("USDT", "")}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, overflow: "auto", maxHeight: 260 }}>
          <div style={{ fontSize: 11, color: C.dim, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Timeline</div>
          {MOCK_TIMELINE.map(t => <TimelineCard key={t.id} trade={t} />)}
        </div>
      </div>
    </div>
  );
}

// ─── Scanner Overlay ──────────────────────────────────────────────────────────
function ScannerOverlay({ strategies, onClose }) {
  const activeStrategy = strategies.find(s => s.status === "live");
  const threshold = activeStrategy?.config.scan_pct_threshold ?? 2.0;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, width: 560, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PulseDot color={C.green} />
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Live Scanner</span>
            <span style={{ fontSize: 10, color: C.dim }}>threshold ≥ {threshold}%</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "8px 14px 4px", display: "grid", gridTemplateColumns: "24px 1fr 80px 70px 80px 60px", gap: 12, fontSize: 10, color: C.dim, letterSpacing: 1, borderBottom: `1px solid ${C.border}` }}>
          <span>#</span><span>SYMBOL</span><span style={{ textAlign: "right" }}>MOVE</span><span style={{ textAlign: "right" }}>VOLUME</span><span>SCORE</span><span style={{ textAlign: "center" }}>PASS</span>
        </div>
        {MOCK_OPPORTUNITIES.map((opp, i) => (
          <OpportunityRow key={opp.symbol} opp={opp} rank={i + 1} threshold={threshold} />
        ))}
        <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.dim, textAlign: "center" }}>
          WS: !miniTicker@arr + kline · Updated {tick * 2}s ago
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("dashboard"); // dashboard | detail
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [balance] = useState(10_240);
  const [totalRisk] = useState(1.0);

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', 'Fira Code', monospace", background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
        ::-webkit-scrollbar { width: 4px; } 
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a3550; border-radius: 2px; }
      `}</style>

      <TopBar balance={balance} totalRisk={totalRisk} onKill={() => {}} sessionActive={true} />

      {/* Nav */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 24px", gap: 4 }}>
        {[["dashboard", "Strategies"], ["scanner", "Scanner"]].map(([v, label]) => (
          <button key={v} onClick={() => { if (v === "scanner") setShowScanner(true); else setView(v); }}
            style={{ padding: "10px 16px", fontSize: 12, fontWeight: view === v ? 700 : 400, color: view === v ? C.text : C.dim, background: "none", border: "none", borderBottom: `2px solid ${view === v ? C.accent : "transparent"}`, cursor: "pointer" }}>
            {label}
          </button>
        ))}
        <button onClick={() => setShowScanner(true)}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.border}`, background: "none", color: C.text, fontSize: 11, cursor: "pointer" }}>
          <PulseDot color={C.green} />
          Scanner Live
        </button>
        {view === "dashboard" && (
          <button style={{ marginLeft: 8, padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.accentDim}`, background: C.accentDim, color: C.accent, fontSize: 11, cursor: "pointer", fontWeight: 700 }}>
            + New Strategy
          </button>
        )}
      </div>

      {/* Views */}
      {view === "dashboard" && (
        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
            {MOCK_STRATEGIES.map(s => (
              <StrategyCard key={s.id} s={s} onClick={() => { setSelectedStrategy(s); setView("detail"); }} />
            ))}
          </div>
        </div>
      )}

      {view === "detail" && selectedStrategy && (
        <StrategyDetailView
          strategy={selectedStrategy}
          onBack={() => setView("dashboard")}
          onConfig={() => setShowConfig(true)}
        />
      )}

      {showScanner && <ScannerOverlay strategies={MOCK_STRATEGIES} onClose={() => setShowScanner(false)} />}
      {showConfig && selectedStrategy && <ConfigModal strategy={selectedStrategy} onClose={() => setShowConfig(false)} />}
    </div>
  );
}
