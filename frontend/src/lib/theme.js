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

export const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Performance: Pre-allocate formatters to avoid GC pressure in hot loops
const usdFormatter2 = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const usdFormatter4 = new Intl.NumberFormat('en-US', {
  style: 'decimal',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4
});

export const fmtUSD = (val) => {
  const n = Number(val || 0);
  const absN = Math.abs(n);
  const formatter = (absN < 1 && absN > 0) ? usdFormatter4 : usdFormatter2;
  const formatted = formatter.format(absN);

  // BOLT: Clean up visuals - use either arrow OR sign, not both (Double Negative issue)
  // We'll keep the arrow as it's more distinct in the financial context.
  const prefix = n >= 0 ? '▲ $' : '▼ $';
  return `${prefix}${formatted}`;
};
export const fmt = (n, d = 2) => {
  const val = Number(n || 0);
  return (val >= 0 ? "+" : "") + val.toFixed(d);
};
export const fmtVol = (v) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${(v / 1_000).toFixed(1)}K`;

// Simple catmull-rom to cubic bezier approximation for smooth lines
export const solveSmoothing = (points) => {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  return points.reduce((acc, point, i, a) => {
    if (i === 0) return `M ${point.x} ${point.y}`;

    const prev = a[i - 1];
    const curr = a[i];
    const next = a[i + 1];
    const prevPrev = a[i - 2] || prev;

    // Control points
    const cp1x = prev.x + (curr.x - prevPrev.x) / 6;
    const cp1y = prev.y + (curr.y - prevPrev.y) / 6;

    const cp2x = curr.x - ((next ? next.x : curr.x) - prev.x) / 6;
    const cp2y = curr.y - ((next ? next.y : curr.y) - prev.y) / 6;

    return `${acc} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
  }, '');
};
