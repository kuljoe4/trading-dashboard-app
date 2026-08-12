export const THEMES = {
  default: {
    name: 'Default Dark',
    desc: 'Deep midnight blue with vibrant accents (original style)',
    colors: {
      '--color-background-theme': '#080b0f',
      '--color-surface-theme': '#0d1117',
      '--color-accent-theme': '#5b6fff',
      '--color-green-theme': '#00e5a0',
      '--color-red-theme': '#ff4466',
      '--color-amber-theme': '#f5a623',
      '--color-text-theme': '#f0f3f8',
      '--color-dim-theme': '#8ba1c1',
      '--color-border-theme': '#1e293b',
      '--color-border-hover-theme': '#334155',
    }
  },
  cyberpunk: {
    name: 'Cyberpunk Neon',
    desc: 'Vibrant neon fuchsia and emerald on a deep cyber-violet canvas',
    colors: {
      '--color-background-theme': '#0c0714',
      '--color-surface-theme': '#140e24',
      '--color-accent-theme': '#d946ef',
      '--color-green-theme': '#10b981',
      '--color-red-theme': '#ef4444',
      '--color-amber-theme': '#f59e0b',
      '--color-text-theme': '#f5f3f7',
      '--color-dim-theme': '#a78bfa',
      '--color-border-theme': '#3b0764',
      '--color-border-hover-theme': '#6b21a8',
    }
  },
  forest: {
    name: 'Nordic Woods',
    desc: 'Sophisticated sage, mint, and pine forest palette',
    colors: {
      '--color-background-theme': '#0a0f0d',
      '--color-surface-theme': '#121a16',
      '--color-accent-theme': '#10b981',
      '--color-green-theme': '#34d399',
      '--color-red-theme': '#f87171',
      '--color-amber-theme': '#fbbf24',
      '--color-text-theme': '#f0f7f4',
      '--color-dim-theme': '#86a397',
      '--color-border-theme': '#1d2c25',
      '--color-border-hover-theme': '#2d4338',
    }
  },
  ocean: {
    name: 'Ocean Sapphire',
    desc: 'Sleek, refreshing deep sapphire and cyan ice breeze',
    colors: {
      '--color-background-theme': '#050e14',
      '--color-surface-theme': '#0a1924',
      '--color-accent-theme': '#06b6d4',
      '--color-green-theme': '#10b981',
      '--color-red-theme': '#f43f5e',
      '--color-amber-theme': '#f59e0b',
      '--color-text-theme': '#f1f7fa',
      '--color-dim-theme': '#80a5b8',
      '--color-border-theme': '#153043',
      '--color-border-hover-theme': '#204a67',
    }
  },
  carbon: {
    name: 'Monochrome Slate',
    desc: 'High-contrast professional carbon fiber and sleek white accents',
    colors: {
      '--color-background-theme': '#0d0d0d',
      '--color-surface-theme': '#181818',
      '--color-accent-theme': '#ffffff',
      '--color-green-theme': '#10b981',
      '--color-red-theme': '#ef4444',
      '--color-amber-theme': '#f59e0b',
      '--color-text-theme': '#ededed',
      '--color-dim-theme': '#888888',
      '--color-border-theme': '#2e2e2e',
      '--color-border-hover-theme': '#444444',
    }
  }
};

export const applyTheme = (themeName) => {
  if (typeof window === 'undefined') return;
  const theme = THEMES[themeName] || THEMES.default;
  Object.entries(theme.colors).forEach(([property, value]) => {
    document.documentElement.style.setProperty(property, value);
  });
};

export const C = {
  bg: "var(--color-background-theme, #080b0f)",
  surface: "var(--color-surface-theme, #0d1117)",
  border: "var(--color-border-theme, #1e293b)",
  borderHover: "var(--color-border-hover-theme, #334155)",
  muted: "var(--color-dim-theme, #8ba1c1)",
  text: "var(--color-text-theme, #f0f3f8)",
  dim: "var(--color-dim-theme, #8ba1c1)",
  green: "var(--color-green-theme, #00e5a0)",
  greenDim: "rgba(0, 229, 160, 0.15)",
  greenBorder: "rgba(0, 229, 160, 0.3)",
  red: "var(--color-red-theme, #ff4466)",
  redDim: "rgba(255, 68, 102, 0.15)",
  redBorder: "rgba(255, 68, 102, 0.3)",
  amber: "var(--color-amber-theme, #f5a623)",
  amberDim: "rgba(245, 166, 35, 0.15)",
  blue: "var(--color-accent-theme, #5b6fff)",
  blueDim: "rgba(91, 111, 255, 0.15)",
  accent: "var(--color-accent-theme, #5b6fff)",
  accentDim: "rgba(91, 111, 255, 0.2)",
};

export const pnlColor = (pnl) => {
  const n = Number(pnl);
  if (n === 0) return "var(--color-dim-theme, #8ba1c1)";
  return n > 0 ? "var(--color-green-theme, #00e5a0)" : "var(--color-red-theme, #ff4466)";
};

export const pnlClass = (pnl) => {
  const n = Number(pnl);
  if (n === 0) return "text-dim";
  return n > 0 ? "text-green" : "text-red";
};

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

  // If the value rounds to zero or is exactly zero, return neutral format
  if (n === 0 || formatted === '0.00' || formatted === '0.0000') return `$${formatted}`;

  // BOLT: Clean up visuals - use either arrow OR sign, not both (Double Negative issue)
  // We'll keep the arrow as it's more distinct in the financial context.
  // Use small variants (▴/▾) as per project standard.
  const prefix = n > 0 ? '▴ $' : '▾ $';
  return `${prefix}${formatted}`;
};
export const fmt = (n, d = 2) => {
  const val = Number(n || 0);
  return (val >= 0 ? "+" : "") + val.toFixed(d);
};
export const fmtVol = (v) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${(v / 1_000).toFixed(1)}K`;

// Simple catmull-rom to cubic bezier approximation for smooth lines
/**
 * BOLT OPTIMIZATION: Optimized path generation.
 * Uses a manual loop and array.join('') to avoid O(N^2) string concatenation overhead
 * in high-frequency chart updates (e.g., Sparklines, Equity Curve).
 */
export const solveSmoothing = (points) => {
  const len = points.length;
  if (len < 2) return '';
  if (len === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const path = new Array(len);
  path[0] = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < len; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const prevPrev = points[i - 2] || prev;

    // Control points
    const cp1x = prev.x + (curr.x - prevPrev.x) / 6;
    const cp1y = prev.y + (curr.y - prevPrev.y) / 6;

    const cp2x = curr.x - ((next ? next.x : curr.x) - prev.x) / 6;
    const cp2y = curr.y - ((next ? next.y : curr.y) - prev.y) / 6;

    path[i] = ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
  }

  return path.join('');
};
