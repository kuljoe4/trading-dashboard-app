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

export const DEFAULT_APPEARANCE = Object.freeze({
  screenBrightness: 100, // 60 - 100 (%)
  textBrightness: 100,   // 50 - 100 (%)
  accentIntensity: 100,  // 40 - 100 (%)
  borderContrast: 100,   // 25 - 100 (%)
  glowIntensity: 100,    // 0 - 100 (%)
});

export const APPEARANCE_PRESETS = Object.freeze({
  standard: {
    id: 'standard',
    label: 'Standard (100%)',
    desc: 'Full contrast and factory theme brightness',
    values: {
      screenBrightness: 100,
      textBrightness: 100,
      accentIntensity: 100,
      borderContrast: 100,
      glowIntensity: 100,
    },
  },
  nightComfort: {
    id: 'nightComfort',
    label: 'Night Comfort',
    desc: 'Softens white text and neon signals for dark rooms',
    values: {
      screenBrightness: 90,
      textBrightness: 82,
      accentIntensity: 72,
      borderContrast: 60,
      glowIntensity: 25,
    },
  },
  deepFocus: {
    id: 'deepFocus',
    label: 'Deep Focus (Low Glare)',
    desc: 'Minimum shine and quiet borders to reduce cognitive load',
    values: {
      screenBrightness: 82,
      textBrightness: 72,
      accentIntensity: 55,
      borderContrast: 40,
      glowIntensity: 0,
    },
  },
});

const APPEARANCE_STORAGE_KEY = 'momentum_appearance_settings';

const clampRange = (val, min, max, fallback) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
};

export const normalizeAppearance = (raw = {}) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    screenBrightness: clampRange(src.screenBrightness, 60, 100, DEFAULT_APPEARANCE.screenBrightness),
    textBrightness: clampRange(src.textBrightness, 50, 100, DEFAULT_APPEARANCE.textBrightness),
    accentIntensity: clampRange(src.accentIntensity, 40, 100, DEFAULT_APPEARANCE.accentIntensity),
    borderContrast: clampRange(src.borderContrast, 25, 100, DEFAULT_APPEARANCE.borderContrast),
    glowIntensity: clampRange(src.glowIntensity, 0, 100, DEFAULT_APPEARANCE.glowIntensity),
  };
};

export const loadAppearanceSettings = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
      if (raw) {
        return normalizeAppearance(JSON.parse(raw));
      }
    }
  } catch (_) {}
  return { ...DEFAULT_APPEARANCE };
};

export const saveAppearanceSettings = (settings) => {
  const normalized = normalizeAppearance(settings);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch (_) {}
  return normalized;
};

const parseHexRgb = (hex) => {
  const clean = String(hex || '').trim().replace(/^#/, '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 0,
      parseInt(clean[1] + clean[1], 16) || 0,
      parseInt(clean[2] + clean[2], 16) || 0,
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16) || 0,
      parseInt(clean.slice(2, 4), 16) || 0,
      parseInt(clean.slice(4, 6), 16) || 0,
    ];
  }
  return [13, 17, 23];
};

const toHexByte = (n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');

export const mixHexColors = (hexA, hexB, weightA = 1) => {
  const w = Math.min(1, Math.max(0, Number(weightA) || 0));
  const [r1, g1, b1] = parseHexRgb(hexA);
  const [r2, g2, b2] = parseHexRgb(hexB);
  const r = r1 * w + r2 * (1 - w);
  const g = g1 * w + g2 * (1 - w);
  const b = b1 * w + b2 * (1 - w);
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
};

export const computeThemeVariables = (themeName, appearanceInput = null) => {
  const theme = THEMES[themeName] || THEMES.default;
  const app = normalizeAppearance(appearanceInput || loadAppearanceSettings());
  const base = theme.colors;

  const [bgR, bgG, bgB] = parseHexRgb(base['--color-background-theme']);
  const isLightTheme = (bgR * 0.299 + bgG * 0.587 + bgB * 0.114) > 140;

  const screenFactor = app.screenBrightness / 100;
  const textFactor = app.textBrightness / 100;
  const accentFactor = app.accentIntensity / 100;
  const borderFactor = app.borderContrast / 100;
  const glowFactor = app.glowIntensity / 100;

  const darkAnchor = '#04060a';
  const lightAnchor = '#d6d9e0';
  const luminanceAnchor = isLightTheme ? lightAnchor : darkAnchor;

  const bgHex = screenFactor < 1
    ? mixHexColors(base['--color-background-theme'], luminanceAnchor, 0.35 + 0.65 * screenFactor)
    : base['--color-background-theme'];

  const surfaceHex = screenFactor < 1
    ? mixHexColors(base['--color-surface-theme'], bgHex, 0.25 + 0.75 * screenFactor)
    : base['--color-surface-theme'];

  // Text & secondary dim text soften smoothly toward surface without losing readability
  const effectiveTextWeight = isLightTheme
    ? (0.45 + 0.55 * textFactor)
    : (0.35 + 0.65 * textFactor) * (0.78 + 0.22 * screenFactor);
  const textHex = (textFactor < 1 || screenFactor < 1)
    ? mixHexColors(base['--color-text-theme'], surfaceHex, effectiveTextWeight)
    : base['--color-text-theme'];

  const effectiveDimWeight = isLightTheme
    ? (0.50 + 0.50 * textFactor)
    : (0.42 + 0.58 * textFactor) * (0.82 + 0.18 * screenFactor);
  const dimHex = (textFactor < 1 || screenFactor < 1)
    ? mixHexColors(base['--color-dim-theme'], surfaceHex, effectiveDimWeight)
    : base['--color-dim-theme'];

  // Neutral desaturation anchor for neon signals/accents
  const neutralSignalAnchor = mixHexColors(surfaceHex, dimHex, 0.32);
  const effectiveAccentWeight = (0.28 + 0.72 * accentFactor) * (0.80 + 0.20 * screenFactor);
  const dimSignal = (hex) => (accentFactor < 1 || screenFactor < 1)
    ? mixHexColors(hex, neutralSignalAnchor, effectiveAccentWeight)
    : hex;

  const accentHex = dimSignal(base['--color-accent-theme']);
  const greenHex = dimSignal(base['--color-green-theme']);
  const redHex = dimSignal(base['--color-red-theme']);
  const amberHex = dimSignal(base['--color-amber-theme']);

  // Borders blend toward surface to reduce box/grid visual clutter
  const effectiveBorderWeight = (0.15 + 0.85 * borderFactor) * (0.75 + 0.25 * screenFactor);
  const borderHex = (borderFactor < 1 || screenFactor < 1)
    ? mixHexColors(base['--color-border-theme'], surfaceHex, effectiveBorderWeight)
    : base['--color-border-theme'];
  const borderHoverHex = (borderFactor < 1 || screenFactor < 1)
    ? mixHexColors(base['--color-border-hover-theme'], surfaceHex, Math.min(1, effectiveBorderWeight + 0.12))
    : base['--color-border-hover-theme'];

  const surfaceElevatedHex = mixHexColors(surfaceHex, borderHex, 0.65);
  const accentLightHex = mixHexColors(accentHex, textHex, 0.82);
  const whiteDimmedHex = isLightTheme
    ? '#ffffff'
    : mixHexColors('#ffffff', surfaceHex, effectiveTextWeight);

  return {
    vars: {
      '--color-background-theme': bgHex,
      '--color-surface-theme': surfaceHex,
      '--color-surface-elevated-theme': surfaceElevatedHex,
      '--color-accent-theme': accentHex,
      '--color-accent-light-theme': accentLightHex,
      '--color-green-theme': greenHex,
      '--color-red-theme': redHex,
      '--color-amber-theme': amberHex,
      '--color-text-theme': textHex,
      '--color-dim-theme': dimHex,
      '--color-border-theme': borderHex,
      '--color-border-hover-theme': borderHoverHex,
      '--color-white-dimmed': whiteDimmedHex,
      '--ui-glow-scale': String(Number(glowFactor.toFixed(2))),
    },
    isLowGlare: !isLightTheme && (app.glowIntensity <= 50 || app.accentIntensity <= 75 || app.screenBrightness <= 88),
    isTextDimmed: !isLightTheme && (app.textBrightness < 96 || app.screenBrightness < 96),
    appearance: app,
  };
};

export const applyTheme = (themeName, appearanceInput = null) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const effectiveThemeName = themeName || (typeof localStorage !== 'undefined' && localStorage.getItem('momentum_theme')) || 'default';
  const { vars, isLowGlare, isTextDimmed } = computeThemeVariables(effectiveThemeName, appearanceInput);
  const root = document.documentElement;
  Object.entries(vars).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
  if (root.dataset) {
    root.dataset.lowGlare = isLowGlare ? 'true' : 'false';
    root.dataset.textDimmed = isTextDimmed ? 'true' : 'false';
  }
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

export const fmtUSD = (val, showArrow = false) => {
  const n = Number(val || 0);
  const absN = Math.abs(n);
  const formatter = (absN < 1 && absN > 0) ? usdFormatter4 : usdFormatter2;
  const formatted = formatter.format(absN);

  // If the value rounds to zero or is exactly zero, return neutral format
  if (n === 0 || formatted === '0.00' || formatted === '0.0000') return `$${formatted}`;

  if (!showArrow) {
    return n < 0 ? `-$${formatted}` : `$${formatted}`;
  }

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

    // Fix deformed lines / loops when adjacent x-coordinates coincide or have near-zero deltas
    const dx = curr.x - prev.x;
    if (Math.abs(dx) < 1e-5) {
      path[i] = ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const minY = Math.min(prev.y, curr.y);
    const maxY = Math.max(prev.y, curr.y);

    // Control points constrained strictly to the horizontal span [prev.x, curr.x]
    let cp1x = prev.x + (curr.x - prevPrev.x) / 6;
    let cp1y = prev.y + (curr.y - prevPrev.y) / 6;

    let cp2x = curr.x - ((next ? next.x : curr.x) - prev.x) / 6;
    let cp2y = curr.y - ((next ? next.y : curr.y) - prev.y) / 6;

    // Clamp control point x-coordinates to avoid backward loops or horizontal overshoots
    cp1x = Math.max(prev.x, Math.min(curr.x, cp1x));
    cp2x = Math.max(prev.x, Math.min(curr.x, cp2x));

    // Monotonic control point clamping to prevent overshoot/bowing beyond segment bounds
    cp1y = Math.max(minY, Math.min(maxY, cp1y));
    cp2y = Math.max(minY, Math.min(maxY, cp2y));

    path[i] = ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
  }

  return path.join('');
};
