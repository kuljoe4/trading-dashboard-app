export const THEMES = {
  default: {
    name: 'Default Dark',
    desc: 'Deep midnight blue with vibrant accents (original style)',
    colors: {
      '--color-background-theme': '#080b0f',
      '--color-surface-theme': '#0d1117',
      '--color-accent-theme': '#6378ff',
      '--color-green-theme': '#00e5a0',
      '--color-red-theme': '#ff4466',
      '--color-amber-theme': '#f5a623',
      '--color-text-theme': '#f0f3f8',
      '--color-dim-theme': '#9ab2d6',
      '--color-border-theme': '#24344d',
      '--color-border-hover-theme': '#3b4e6b',
    }
  },
  slateDim: {
    name: 'Slate Dim',
    desc: 'Comfortable blue-gray charcoal theme (not pitch black)',
    colors: {
      '--color-background-theme': '#15202b',
      '--color-surface-theme': '#192734',
      '--color-accent-theme': '#1da1f2',
      '--color-green-theme': '#17bf63',
      '--color-red-theme': '#e0245e',
      '--color-amber-theme': '#ffad1f',
      '--color-text-theme': '#ffffff',
      '--color-dim-theme': '#a0b3c6',
      '--color-border-theme': '#2e3f52',
      '--color-border-hover-theme': '#415469',
    }
  },
  coolGray: {
    name: 'Onyx Gray',
    desc: 'Sleek, neutral gunmetal gray and onyx dark mode (no blue tint)',
    colors: {
      '--color-background-theme': '#1c1e21',
      '--color-surface-theme': '#242729',
      '--color-accent-theme': '#3b82f6',
      '--color-green-theme': '#10b981',
      '--color-red-theme': '#ef4444',
      '--color-amber-theme': '#f59e0b',
      '--color-text-theme': '#f3f4f6',
      '--color-dim-theme': '#b0b7c3',
      '--color-border-theme': '#3e4856',
      '--color-border-hover-theme': '#525e70',
    }
  },
  cyberpunk: {
    name: 'Cyberpunk Neon',
    desc: 'Vibrant neon fuchsia and emerald on a deep cyber-violet canvas',
    colors: {
      '--color-background-theme': '#0c0714',
      '--color-surface-theme': '#140e24',
      '--color-accent-theme': '#e855ff',
      '--color-green-theme': '#10b981',
      '--color-red-theme': '#ef4444',
      '--color-amber-theme': '#f59e0b',
      '--color-text-theme': '#f5f3f7',
      '--color-dim-theme': '#c4b5fd',
      '--color-border-theme': '#4c0f82',
      '--color-border-hover-theme': '#7e22ce',
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
      '--color-dim-theme': '#9ebbb0',
      '--color-border-theme': '#273c33',
      '--color-border-hover-theme': '#3a564a',
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
      '--color-dim-theme': '#9ac2d6',
      '--color-border-theme': '#1f425c',
      '--color-border-hover-theme': '#2e6085',
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
      '--color-text-theme': '#ffffff',
      '--color-dim-theme': '#aaaaaa',
      '--color-border-theme': '#3a3a3a',
      '--color-border-hover-theme': '#555555',
    }
  },
  light: {
    name: 'Ice Light (Day)',
    desc: 'A gorgeous high-contrast daylight theme with crisp slate and blue accents',
    colors: {
      '--color-background-theme': '#f4f6fa',
      '--color-surface-theme': '#ffffff',
      '--color-accent-theme': '#1d4ed8',
      '--color-green-theme': '#047857',
      '--color-red-theme': '#b91c1c',
      '--color-amber-theme': '#b45309',
      '--color-text-theme': '#0f172a',
      '--color-dim-theme': '#334155',
      '--color-border-theme': '#cbd5e1',
      '--color-border-hover-theme': '#94a3b8',
    }
  },
  warmCream: {
    name: 'Warm Cream (Day)',
    desc: 'Soothing daylight theme with ivory, bronze, and stone tones',
    colors: {
      '--color-background-theme': '#faf8f5',
      '--color-surface-theme': '#ffffff',
      '--color-accent-theme': '#92400e',
      '--color-green-theme': '#047857',
      '--color-red-theme': '#991b1b',
      '--color-amber-theme': '#b45309',
      '--color-text-theme': '#1c1917',
      '--color-dim-theme': '#57534e',
      '--color-border-theme': '#d6d3d1',
      '--color-border-hover-theme': '#a8a29e',
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
