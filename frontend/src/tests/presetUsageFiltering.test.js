import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatRelativePresetAge,
  classifyPresetUsage,
  filterAndGroupPresets,
} from '../utils/presetFiltering.js';
import {
  formatStopLossDescriptor,
  formatTakeProfitDescriptor,
} from '../utils/strategySummary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const makePreset = (name, mode = 'live', extra = {}) => ({
  name,
  config: {
    trading_mode: mode,
    paper_mode: mode === 'paper',
    strategy_label: name,
    ...extra,
  },
});

test('formatRelativePresetAge formats edge cases and human intervals cleanly', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatRelativePresetAge(0, now), null);
  assert.equal(formatRelativePresetAge(null, now), null);
  assert.equal(formatRelativePresetAge(NaN, now), null);
  assert.equal(formatRelativePresetAge(now - 20_000, now), 'just now');
  assert.equal(formatRelativePresetAge(now - 5 * 60_000, now), '5m ago');
  assert.equal(formatRelativePresetAge(now - 3 * 3600_000, now), '3h ago');
  assert.equal(formatRelativePresetAge(now - 4 * 86400_000, now), '4d ago');
  assert.equal(formatRelativePresetAge(now - 65 * 86400_000, now), '2mo ago');
});

test('classifyPresetUsage partitions active, recent, and others with strict tier precedence', () => {
  const variantOrderMap = new Map([['VarOne', 0]]);
  const activeSessionNames = new Set(['RunningLive', 'BaseStrat']);
  const recentlyUsedNames = ['BaseStrat', 'RecentLocal'];
  const lastUsedTsByName = new Map([
    ['BaseStrat', 1000],
    ['RecentSession', 2000],
  ]);

  const ctx = {
    activeBasePresetName: 'BaseStrat',
    variantOrderMap,
    activeSessionNames,
    recentlyUsedNames,
    lastUsedTsByName,
  };

  assert.deepEqual(classifyPresetUsage(makePreset('BaseStrat'), ctx), {
    group: 'active',
    role: 'active_base',
    tier: 0,
    lastUsedTs: 1000,
  });

  assert.deepEqual(classifyPresetUsage(makePreset('VarOne'), ctx), {
    group: 'active',
    role: 'active_variant',
    tier: 1,
    lastUsedTs: 0,
  });

  assert.deepEqual(classifyPresetUsage(makePreset('RunningLive'), ctx), {
    group: 'active',
    role: 'active_session',
    tier: 2,
    lastUsedTs: 0,
  });

  assert.deepEqual(classifyPresetUsage(makePreset('RecentLocal'), ctx), {
    group: 'recent',
    role: 'recent',
    tier: 3,
    lastUsedTs: 0,
  });

  assert.deepEqual(classifyPresetUsage(makePreset('RecentSession'), ctx), {
    group: 'recent',
    role: 'recent',
    tier: 3,
    lastUsedTs: 2000,
  });

  assert.deepEqual(classifyPresetUsage(makePreset('LibraryAlpha'), ctx), {
    group: 'other',
    role: 'other',
    tier: 4,
    lastUsedTs: 0,
  });
});

test('filterAndGroupPresets filters by usageFilter, composes with mode & search, and never double-counts', () => {
  const presets = [
    makePreset('ZuluOther', 'live'),
    makePreset('AlphaOther', 'testnet'),
    makePreset('OldSession', 'paper'),
    makePreset('LatestLocal', 'live'),
    makePreset('VarTwo', 'paper'),
    makePreset('VarOne', 'live'),
    makePreset('BaseCore', 'live'),
    makePreset('SessionRunner', 'testnet'),
  ];

  const common = {
    activeBasePresetName: 'BaseCore',
    activeVariants: [{ strategy_label: 'VarOne' }, { strategy_label: 'VarTwo' }],
    sessionRecency: {
      activeNames: new Set(['SessionRunner']),
      lastUsedTsByName: new Map([
        ['BaseCore', 9000],
        ['OldSession', 5000],
        ['LatestLocal', 4000],
      ]),
    },
    recentlyUsedNames: ['LatestLocal', 'BaseCore'],
  };

  // All groups together
  const allRes = filterAndGroupPresets(presets, { ...common, usageFilter: 'all' });
  assert.deepEqual(allRes.counts, { all: 8, active: 4, recent: 2, other: 2 });
  assert.deepEqual(
    allRes.groups.active.map((p) => p.name),
    ['BaseCore', 'VarOne', 'VarTwo', 'SessionRunner']
  );
  // MRU local names precede pure timestamp-only recency
  assert.deepEqual(
    allRes.groups.recent.map((p) => p.name),
    ['LatestLocal', 'OldSession']
  );
  // Alphabetical for Others
  assert.deepEqual(
    allRes.groups.other.map((p) => p.name),
    ['AlphaOther', 'ZuluOther']
  );
  assert.equal(allRes.items.length, 8);

  // Usage filters narrow items while keeping group counts for the current search/mode scope
  const activeOnly = filterAndGroupPresets(presets, { ...common, usageFilter: 'active' });
  assert.deepEqual(activeOnly.items.map((p) => p.name), ['BaseCore', 'VarOne', 'VarTwo', 'SessionRunner']);
  assert.deepEqual(activeOnly.counts, { all: 8, active: 4, recent: 2, other: 2 });

  const recentOnly = filterAndGroupPresets(presets, { ...common, usageFilter: 'recent' });
  assert.deepEqual(recentOnly.items.map((p) => p.name), ['LatestLocal', 'OldSession']);

  const otherOnly = filterAndGroupPresets(presets, { ...common, usageFilter: 'other' });
  assert.deepEqual(otherOnly.items.map((p) => p.name), ['AlphaOther', 'ZuluOther']);

  // Composing with modeFilter + search updates counts cleanly
  const liveSearch = filterAndGroupPresets(presets, {
    ...common,
    modeFilter: 'live',
    search: 'o',
    usageFilter: 'all',
  });
  // Matches ZuluOther (other), VarOne (active), BaseCore (active), LatestLocal (recent)
  assert.deepEqual(liveSearch.counts, { all: 4, active: 2, recent: 1, other: 1 });
  assert.deepEqual(liveSearch.items.map((p) => p.name), ['BaseCore', 'VarOne', 'LatestLocal', 'ZuluOther']);

  // Composing with modeFilter === 'variants'
  const variantsOnly = filterAndGroupPresets(presets, {
    ...common,
    modeFilter: 'variants',
    usageFilter: 'all',
  });
  assert.deepEqual(variantsOnly.counts, { all: 2, active: 2, recent: 0, other: 0 });
});

test('ConfigModal wires mobile-first presets usage filter, grouped section headers, and recency updates', () => {
  const configPath = path.resolve(__dirname, '../components/ConfigModal.jsx');
  const src = fs.readFileSync(configPath, 'utf8');

  assert.ok(src.includes("from '../utils/presetFiltering.js'"), 'Imports presetFiltering helpers');
  assert.ok(src.includes('data-testid="presets-usage-filter"'), 'Renders presets usage filter strip');
  assert.ok(src.includes('grid grid-cols-4 sm:flex'), 'Uses mobile-first 4-col grid for usage filters');
  assert.ok(src.includes('data-preset-group={group.id}'), 'Renders grouped preset sections');
  assert.ok(src.includes('Show all groups'), 'Provides reset button in empty usage filter state');
  assert.ok(src.includes('presetPartition.metaByName.get(p.name)'), 'Passes usageMeta to PresetItem');
  assert.ok(
    /toggleVariant[\s\S]*?recordRecentlyUsed\(p\.name\)/.test(src),
    'Records recently used when toggling a variant on'
  );
  assert.ok(
    /promoteVariantToBaseByIndex[\s\S]*?recordRecentlyUsed\(variantLabel\)/.test(src),
    'Records recently used when promoting a variant to base'
  );
  assert.ok(
    src.includes('grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-2.5'),
    'Renders mobile-first compact single-column to desktop 2-column preset card grid'
  );
  assert.ok(
    src.includes('grid grid-cols-4 gap-1.5 pt-1 border-t border-border/30'),
    'PresetItem renders compact 4-column tabular parameter strip without mobile truncation'
  );
  assert.ok(
    src.includes("from '../utils/strategySummary.js'") &&
    src.includes('formatStopLossDescriptor(') &&
    src.includes('formatTakeProfitDescriptor('),
    'ConfigModal uses type-aware SL and TP descriptors instead of hardcoded fixed fields'
  );
  assert.ok(
    src.includes('onClick={handleSelectAllPresets}') && src.includes('onClick={handleCopySelectedPresets}'),
    'Wires Select All and Copy Selected Presets controls directly into the Presets panel'
  );
});

test('formatStopLossDescriptor accurately formats all sl_type models without assuming fixed pct', () => {
  const fixed = formatStopLossDescriptor({ sl_type: 'pct', sl_distance_pct: 1.25 });
  assert.equal(fixed.type, 'pct');
  assert.equal(fixed.shortLabel, 'Fixed SL');
  assert.equal(fixed.valueText, '1.25%');
  assert.equal(fixed.fullText, 'Fixed 1.25%');

  const hl = formatStopLossDescriptor({
    sl_type: 'lookback_low/high',
    sl_lookback_period: 12,
    sl_lookback_timeframe: '15m',
    sl_min_pct: 0.4,
    sl_max_pct: 2.5,
  });
  assert.equal(hl.type, 'lookback_low/high');
  assert.equal(hl.shortLabel, 'H/L SL');
  assert.equal(hl.valueText, '0.4–2.5%');
  assert.equal(hl.compactText, 'H/L 0.4–2.5%');
  assert.equal(hl.fullText, 'H/L 12c 15m (0.4–2.5%)');

  const streak = formatStopLossDescriptor({
    sl_type: 'streak_extreme',
    sl_lookback_period: 0,
    sl_lookback_timeframe: '5m',
    sl_min_pct: null,
    sl_max_pct: 3.0,
  });
  assert.equal(streak.type, 'streak_extreme');
  assert.equal(streak.shortLabel, 'Streak SL');
  assert.equal(streak.valueText, '≤3%');
  assert.equal(streak.fullText, 'Streak 0c 5m (≤3%)');

  const st = formatStopLossDescriptor({
    sl_type: 'supertrend',
    sl_lookback_timeframe: '1h',
    sl_min_pct: 0.5,
    sl_max_pct: 4.0,
  });
  assert.equal(st.type, 'supertrend');
  assert.equal(st.shortLabel, 'ST SL');
  assert.equal(st.valueText, '0.5–4% 1h');
  assert.equal(st.fullText, 'Supertrend 1h (0.5–4%)');

  const trail = formatStopLossDescriptor({
    sl_type: 'trailing',
    trailing_stop_type: 'rr',
    trailing_stop_rr: 1.5,
  });
  assert.equal(trail.shortLabel, 'Trail SL');
  assert.equal(trail.fullText, 'Trailing 1.5R');
});

test('formatTakeProfitDescriptor accurately formats all tp_mode models and trailing stops', () => {
  const fixed = formatTakeProfitDescriptor({ tp_mode: 'fixed', tp_ratio: 2.5, trailing_stop_enabled: false });
  assert.equal(fixed.shortLabel, 'Fixed TP');
  assert.equal(fixed.valueText, '2.5R');
  assert.equal(fixed.fullText, 'Fixed 2.5R');

  const fixedTrail = formatTakeProfitDescriptor({
    tp_mode: 'fixed',
    tp_ratio: 3,
    trailing_stop_enabled: true,
    trailing_stop_type: 'pct',
    trailing_stop_distance_pct: 0.8,
  });
  assert.equal(fixedTrail.shortLabel, 'TP+Trail');
  assert.equal(fixedTrail.valueText, '3R +Tr');
  assert.equal(fixedTrail.fullText, 'Fixed 3R +0.8% Tr');

  const seq = formatTakeProfitDescriptor({
    tp_mode: 'exp_rr_seq',
    live_rr_sequence: [1, 2.5, 5],
    exit_rr_sequence: [0, 1, 3],
    trailing_stop_enabled: false,
  });
  assert.equal(seq.shortLabel, 'RR Ladder');
  assert.equal(seq.valueText, '1/2.5/5R');
  assert.equal(seq.compactText, 'Seq 1/2.5/5R');
  assert.equal(seq.fullText, 'RR Ladder (1R→0R, 2.5R→1R, 5R→3R)');

  const sw = formatTakeProfitDescriptor({
    tp_mode: 'exp_rr_seq_switch',
    live_rr_sequence: [1, 2, 4],
    peak_rr_switch_threshold: 3.5,
    peak_rr_switch_count: 2,
    trailing_stop_enabled: true,
    trailing_stop_type: 'rr',
    trailing_stop_rr: 1.2,
  });
  assert.equal(sw.shortLabel, 'Adapt+Tr');
  assert.equal(sw.valueText, '1/2/4R⇄ +Tr');
  assert.equal(sw.fullText, 'Adaptive RR (1/2/4R, sw @3.5R ×2) +1.2R Tr');
});

test('All UI summary surfaces avoid hardcoding fixed SL/TP values when rendering strategy descriptors', () => {
  const filesToCheck = [
    '../components/BacktestPanel.jsx',
    '../views/TradesView.jsx',
    '../views/StrategyDetailView.jsx',
    '../views/DashboardView.jsx',
    '../components/config/ActiveSummaryPanel.jsx',
    '../components/RiskSummary.jsx',
    '../components/trade/TradeDetailContent.jsx',
    '../utils/strategyDiagnostics.js',
  ];

  for (const rel of filesToCheck) {
    const src = fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
    assert.ok(
      src.includes('strategySummary.js'),
      `${rel} must import type-aware formatters from strategySummary.js`
    );
  }
});

