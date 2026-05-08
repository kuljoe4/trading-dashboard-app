export const C = {
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

export const pnlColor = (pnl) => (pnl >= 0 ? C.green : C.red);
export const fmtUSD = (val) => val >= 0 ? `+$${val.toLocaleString('en', { minimumFractionDigits: 2 })}` : `-$${Math.abs(val).toLocaleString('en', { minimumFractionDigits: 2 })}`;
export const fmt = (n, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d);
export const fmtVol = (v) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${(v / 1_000).toFixed(0)}K`;
