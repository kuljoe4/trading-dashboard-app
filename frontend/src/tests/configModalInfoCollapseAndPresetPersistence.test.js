import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSessionConfig, sessionConfigAllowedKeys } from '../api/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configModalPath = path.resolve(__dirname, '../components/ConfigModal.jsx');
const signalCardsPath = path.resolve(__dirname, '../components/config/SignalCards.jsx');
const dashboardViewPath = path.resolve(__dirname, '../views/DashboardView.jsx');
const clientPath = path.resolve(__dirname, '../api/client.js');

const configModalSource = fs.readFileSync(configModalPath, 'utf8');
const signalCardsSource = fs.readFileSync(signalCardsPath, 'utf8');
const dashboardViewSource = fs.readFileSync(dashboardViewPath, 'utf8');
const clientSource = fs.readFileSync(clientPath, 'utf8');

test('client.js sessionConfigAllowedKeys strips invalid ui_eco_mode and preserves htf_breakout_* and trigger_candle_exit_* keys', () => {
  assert.equal(sessionConfigAllowedKeys.includes('ui_eco_mode'), false, 'ui_eco_mode must NOT be in sessionConfigAllowedKeys');

  const requiredSignalKeys = [
    'htf_breakout_ref_timeframe',
    'htf_breakout_trigger_timeframe',
    'htf_breakout_mode',
    'htf_breakout_reference_level',
    'htf_breakout_lookback',
    'htf_breakout_buffer_pct',
    'htf_breakout_max_expansion_pct',
    'trigger_candle_exit_enabled',
    'trigger_candle_exit_n',
    'trigger_candle_exit_offset_mode',
    'trigger_candle_exit_mode',
    'trigger_candle_exit_timeframe',
    'trigger_candle_exit_buffer_pct',
  ];

  for (const key of requiredSignalKeys) {
    assert.equal(sessionConfigAllowedKeys.includes(key), true, `Expected ${key} in sessionConfigAllowedKeys`);
  }

  const sanitized = sanitizeSessionConfig({
    strategy_label: 'Base',
    ui_eco_mode: true,
    htf_breakout_mode: 'closed_candle_confirm',
    htf_breakout_lookback: 3,
    trigger_candle_exit_enabled: true,
    trigger_candle_exit_n: 2,
    strategy_variants: [
      {
        strategy_label: 'Var 1',
        ui_eco_mode: false,
        htf_breakout_buffer_pct: 0.2,
        trigger_candle_exit_mode: 'wick',
      }
    ],
    single_symbol_configs: [
      {
        symbol: 'BTCUSDT',
        enabled: true,
        follow_schedule: true,
        use_custom_config: true,
        custom_config: {
          ui_eco_mode: true,
          trigger_candle_exit_buffer_pct: 0.15,
        }
      }
    ]
  });

  assert.equal('ui_eco_mode' in sanitized, false);
  assert.equal(sanitized.htf_breakout_mode, 'closed_candle_confirm');
  assert.equal(sanitized.htf_breakout_lookback, 3);
  assert.equal(sanitized.trigger_candle_exit_enabled, true);
  assert.equal(sanitized.trigger_candle_exit_n, 2);
  assert.equal('ui_eco_mode' in sanitized.strategy_variants[0], false);
  assert.equal(sanitized.strategy_variants[0].htf_breakout_buffer_pct, 0.2);
  assert.equal(sanitized.strategy_variants[0].trigger_candle_exit_mode, 'wick');
  assert.equal('ui_eco_mode' in sanitized.single_symbol_configs[0].custom_config, false);
  assert.equal(sanitized.single_symbol_configs[0].custom_config.trigger_candle_exit_buffer_pct, 0.15);

  assert.match(clientSource, /baseConfig:\s*sanitizeSessionConfig\(payload\?\.baseConfig \|\| \{\}\)/, 'smartOptimizerAPI.run should sanitize baseConfig');
});

test('ConfigModal hardening: variant staging, WS clobber protection, draft persistence, duplicate, promote, and numeric sanitization', () => {
  // 1. Numeric empty string deletion in both coerceAndSanitizeConfig and buildConfigToSave
  assert.match(configModalSource, /'martingale_multiplier',\s*'martingale_max_steps',\s*'martingale_reset_threshold_pct'/);
  assert.match(configModalSource, /delete c\[f\];/, 'Empty or non-finite numeric fields must be deleted rather than sent as NaN or empty string');

  // 2. Draft restore works regardless of preset label rename and uses persistDraft
  assert.match(configModalSource, /const persistDraft = React\.useCallback\(/);
  assert.match(configModalSource, /suppressDraftSaveRef/);
  assert.match(configModalSource, /hasPendingSessionChanges/);
  assert.match(configModalSource, /hasUserLocalOverrideRef/);

  // 3. WS sync guard only overwrites local cfg when no pending changes/override and not editing a variant
  assert.match(
    configModalSource,
    /!hasUserLocalOverrideRef\.current &&[\s\S]*?!hasPendingSessionChangesRef\.current &&[\s\S]*?!isDirtyRef\.current &&[\s\S]*?editingVariantIdx === null/
  );

  // 4. Atomic variant list sync helper & activeVariants memo
  assert.match(configModalSource, /const activeVariants = useMemo\(/);
  assert.match(configModalSource, /const updateVariantsList = React\.useCallback\(/);

  // 5. startEditingVariant guard & commit-then-switch + savePreset syncing back to baseConfigBackup
  assert.match(configModalSource, /if \(editingVariantIdx !== null && editingVariantIdx === vIndex\)/);
  assert.match(configModalSource, /const cleanVariant = vData\.__flattened \? coerceAndSanitizeConfig\(vData, true\) : \{ \.\.\.vData \};/);
  assert.match(configModalSource, /Sync updated variant back into baseConfigBackup and cfg\.strategy_variants/);

  // 6. Real duplicatePreset & promoteVariantToBaseByIndex wired to PresetItem
  assert.match(configModalSource, /const duplicatePreset = React\.useCallback\(async \(p\) =>/);
  assert.match(configModalSource, /const promoteVariantToBaseByIndex = React\.useCallback\(/);
  assert.match(configModalSource, /onPromoteVariant=\{\(\) => promoteVariantToBaseByIndex\(variantIndex\)\}/);
  assert.match(configModalSource, /onDuplicate=\{\(\) => duplicatePreset\(p\)\}/);

  // 7. Trailing renderField bug fix (opts must be null, description passed in attrs.helpText)
  assert.match(configModalSource, /renderField\('Trailing Activation R:R', 'trailing_activation_rr', 'number', null, \{/);
  assert.match(configModalSource, /renderField\('Trailing Distance \(R:R\)', 'trailing_stop_rr', 'number', null, \{/);
  assert.match(configModalSource, /renderField\('Trailing Distance \(%\)', 'trailing_stop_distance_pct', 'number', null, \{/);
  assert.doesNotMatch(
    configModalSource,
    /renderField\('Trailing Activation R:R', 'trailing_activation_rr', 'number', 'Required R:R/,
    'Trailing Activation R:R must not pass help string as opts dropdown array'
  );

  // 8. DashboardView handleEditVariant preserves strategy_variants and clears selectedConfig & editingVariantIndex on close
  assert.match(dashboardViewSource, /const handleEditVariant = React\.useCallback\(\(label\) => \{[\s\S]*?strategy_variants:\s*Array\.isArray\(config\.strategy_variants\)[\s\S]*?setEditingVariantIndex\(idx\)/);
  assert.match(dashboardViewSource, /onClose=\{\(\) => \{ setShowConfig\(false\); setIsEditMode\(false\); setSelectedConfig\(null\); setEditingVariantIndex\(null\); \}\}/);
});

test('ConfigModal collapses explanatory text into clickable InfoHelpButton / CollapsibleHelpTitle across all sections and follows Rules of Hooks', () => {
  // Core info toggle primitives exist and are used in ConfigModal & SignalCards
  assert.match(configModalSource, /const InfoHelpButton = React\.memo\(/);
  assert.match(configModalSource, /const InfoDropdownBox = React\.memo\(/);
  assert.match(configModalSource, /const CollapsibleHelpTitle = React\.memo\(/);
  assert.match(signalCardsSource, /setShowInfo\(v => !v\)/);

  // Header & Env & OptimizationPanel & Strategy sections use collapsible help controls
  assert.match(configModalSource, /expandedHelpMap\.header_status/);
  assert.match(configModalSource, /expandedHelpMap\.scan_htf_boost/);
  assert.match(configModalSource, /expandedHelpMap\.scan_global_toggle/);
  assert.match(configModalSource, /expandedHelpMap\.smart_watchlist/);
  assert.match(configModalSource, /expandedHelpMap\.entry_signal_logic/);
  assert.match(configModalSource, /expandedHelpMap\.exit_signal_logic/);
  assert.match(configModalSource, /<CollapsibleInfoCard title="EMA Dual Logic"/);
  assert.match(configModalSource, /title="Watchlist Limit \(Strict Ceiling\)"/);
  assert.match(configModalSource, /title="Est\. P&L Risk Release"/);
  assert.match(configModalSource, /title="Auto-Adjust Max Open Trades \(Zero Risk\)"/);
  assert.match(configModalSource, /expandedHelpMap\.risk_min_notional/);
  assert.match(configModalSource, /expandedHelpMap\.risk_hardening/);
  assert.match(configModalSource, /title="Enable Martingale"/);
  assert.match(configModalSource, /title="Reject Entry If SL Exceeds Max"/);
  assert.match(configModalSource, /title="Include Forming Candle in SL Lookback"/);
  assert.match(configModalSource, /expandedHelpMap\.risk_dynamic_trailing/);
  assert.match(configModalSource, /expandedHelpMap\.risk_freq_shaping/);
  assert.match(configModalSource, /expandedHelpMap\.risk_tod_guard/);
  assert.match(configModalSource, /expandedHelpMap\.env_mode_fixed/);
  assert.match(configModalSource, /expandedHelpMap\.paste_overlay_help/);

  // Hover-only Tooltip must not wrap renderField in Scan/Strategy/Risk
  assert.doesNotMatch(
    configModalSource,
    /<Tooltip content="[^"]+">\s*\{renderField\(/,
    'renderField inputs should pass helpText inside attrs so they render clickable InfoHelpButton toggles rather than hover-only Tooltip wrappers'
  );

  // OptimizationPanel declares useState BEFORE early return (Rules of Hooks)
  const optMatch = configModalSource.match(/const OptimizationPanel = \(\{[\s\S]*?\}\) => \{([\s\S]{0,220})/);
  assert.ok(optMatch, 'OptimizationPanel definition must exist');
  const headBody = optMatch[1];
  const hookPos = headBody.indexOf('useState(');
  const returnPos = headBody.indexOf('if (!analytics?.rrOptimization) return null;');
  assert.ok(hookPos !== -1 && returnPos !== -1 && hookPos < returnPos, 'OptimizationPanel useState must appear before early return');
});

test('ActiveSummaryPanel, right-end More tab dropdown, section-level error indicators, and active/latest session bubbling', () => {
  const activeSummaryPath = path.resolve(__dirname, '../components/config/ActiveSummaryPanel.jsx');
  const historyViewPath = path.resolve(__dirname, '../views/HistoryView.jsx');
  const activeSummarySource = fs.readFileSync(activeSummaryPath, 'utf8');
  const historyViewSource = fs.readFileSync(historyViewPath, 'utf8');

  // 1. Primary tabs + overflow tabs in right-end Radix DropdownMenu after presets
  assert.match(configModalSource, /const primaryTabs = useMemo\(\(\) => \[[\s\S]*?id:\s*'summary'[\s\S]*?id:\s*'presets'/);
  assert.match(configModalSource, /const overflowTabs = useMemo\(\(\) => \[[\s\S]*?id:\s*'env'[\s\S]*?id:\s*'smart'[\s\S]*?id:\s*'backtest'/);
  assert.match(configModalSource, /<DropdownMenu\.Root modal=\{false\}>/);
  assert.match(configModalSource, /align="end"[\s\S]*?z-\[200\]/);
  assert.equal(configModalSource.includes('isMoreOpen'), false);

  // 2. ActiveSummaryPanel renders active rules cleanly & indicates section errors
  assert.match(configModalSource, /<ActiveSummaryPanel/);
  assert.match(activeSummarySource, /id="config-panel-summary"/);
  assert.match(activeSummarySource, /envErrCount/);
  assert.match(activeSummarySource, /scanErrCount/);
  assert.match(activeSummarySource, /riskErrCount/);
  assert.match(activeSummarySource, /errors\?\.slippage_warning_threshold/);
  assert.match(activeSummarySource, /errors\?\.scanner_weights_momentum/);
  assert.match(activeSummarySource, /onOpenFullSection\('risk', 'risk_sl'\)/);

  // 3. ConfigModal CollapsibleSection error mapping & auto-navigation
  assert.match(configModalSource, /const SECTION_ERROR_MAP = \{/);
  assert.match(configModalSource, /scanner_signal_depth:\s*'scan_global'/);
  assert.match(configModalSource, /slippage_warning_threshold:\s*'risk_guards'/);
  assert.match(configModalSource, /const getSectionErrorInfo = React\.useCallback/);
  assert.match(configModalSource, /\{\.\.\.getSectionErrorInfo\('scan_global'\)\}/);
  assert.match(configModalSource, /\{\.\.\.getSectionErrorInfo\('risk_guards'\)\}/);
  assert.match(configModalSource, /\{\.\.\.getSectionErrorInfo\('risk_martingale'\)\}/);
  assert.match(configModalSource, /\{\.\.\.getSectionErrorInfo\('risk_sl'\)\}/);
  assert.match(configModalSource, /\{\.\.\.getSectionErrorInfo\('adv_env'\)\}/);
  assert.match(configModalSource, /hasError = false, errorCount = 0/);
  assert.match(configModalSource, /if \(!k\.endsWith\('_warn'\)\)|filter\(k => !k\.endsWith\('_warn'\)\)/);

  // 4. Active & latest-used presets/sessions bubbling (extracted to utils/presetFiltering.js)
  const presetFilteringSource = fs.readFileSync(path.resolve(__dirname, '../utils/presetFiltering.js'), 'utf8');
  assert.match(configModalSource, /const sessionRecency = useMemo\(/);
  assert.match(configModalSource, /const presetPartition = useMemo\(\(\) => \{[\s\S]*?filterAndGroupPresets\(/);
  assert.match(presetFilteringSource, /export function classifyPresetUsage\(/);
  assert.match(presetFilteringSource, /if \(name && activeBasePresetName && name === activeBasePresetName/);
  assert.match(presetFilteringSource, /if \(name && activeSessionNames\.has\(name\)\)/);
  assert.match(presetFilteringSource, /metaB\.lastUsedTs - metaA\.lastUsedTs/);
  assert.match(historyViewSource, /const aActive = a\.status === 'active' \|\| !a\.endTime;/);
});

test('ConfigModal per-tab sections use draggable persistent ordering instead of dynamic latest-use sorting', () => {
  const draggableListPath = path.resolve(__dirname, '../components/config/DraggableSectionList.jsx');
  const draggableListSource = fs.readFileSync(draggableListPath, 'utf8');
  const orderUtilsPath = path.resolve(__dirname, '../utils/configSectionOrder.js');
  const orderUtilsSource = fs.readFileSync(orderUtilsPath, 'utf8');
  const activeSummarySource = fs.readFileSync(path.resolve(__dirname, '../components/config/ActiveSummaryPanel.jsx'), 'utf8');

  // Dynamic latest-use section sorting is completely removed
  assert.equal(configModalSource.includes('recent_config_sections'), false);
  assert.equal(configModalSource.includes('computeTabSectionOrder'), false);
  assert.equal(configModalSource.includes('recordRecentSection'), false);
  assert.equal(configModalSource.includes('refreshSectionOrders'), false);

  // Persistent order utility & DraggableSectionList are wired across all section-based tabs
  assert.match(orderUtilsSource, /export const CONFIG_SECTION_ORDER_STORAGE_KEY = 'config_section_order_v1'/);
  assert.match(orderUtilsSource, /export const TAB_SECTION_DEFAULTS = \{/);
  assert.match(draggableListSource, /Reorder\.Group/);
  assert.match(draggableListSource, /Reorder\.Item/);
  assert.match(draggableListSource, /useDragControls/);
  assert.match(draggableListSource, /GripVertical/);

  assert.match(configModalSource, /loadPersistedSectionOrders/);
  assert.match(configModalSource, /savePersistedSectionOrders/);
  assert.match(configModalSource, /const handleReorderTabSections = React\.useCallback\(/);
  assert.match(configModalSource, /const handleResetTabSections = React\.useCallback\(/);
  assert.match(configModalSource, /const orderSectionEntries = React\.useCallback\(/);
  assert.match(configModalSource, /<DraggableSectionList/);

  // Summary + all 4 editor section tabs use DraggableSectionList
  assert.match(activeSummarySource, /<DraggableSectionList/);
  assert.match(configModalSource, /\{orderSectionEntries\('scan',\s*\{/);
  assert.match(configModalSource, /\{orderSectionEntries\('strategy',\s*\{/);
  assert.match(configModalSource, /\{orderSectionEntries\('risk',\s*\{/);
  assert.match(configModalSource, /\{orderSectionEntries\('env',\s*\{/);

  // Navigation still updates lastEditedLocation and focuses/scrolls without reshuffling section order
  assert.match(configModalSource, /<SectionTabs section=\{section\} onSectionChange=\{handleSectionChange\} errors=\{errors\} \/>/);
  assert.match(configModalSource, /scrollIntoView/);
});

test('Uniform compact text-xs input typography across modals/views and edit actions navigate to last edited location (fallback Active)', () => {
  const activeSummarySource = fs.readFileSync(path.resolve(__dirname, '../components/config/ActiveSummaryPanel.jsx'), 'utf8');
  const settingsViewSource = fs.readFileSync(path.resolve(__dirname, '../views/SettingsView.jsx'), 'utf8');
  const authOverlaySource = fs.readFileSync(path.resolve(__dirname, '../components/AuthOverlay.jsx'), 'utf8');

  // 1. Editing strategy / preset / variant restores lastEditedLocation (falling back to Active 'summary')
  assert.match(configModalSource, /const readStoredLastEditedLocation = \(\) =>/);
  assert.match(configModalSource, /if \(isEdit \|\| initialEditingVariantIndex !== null\) \{\s*return readStoredLastEditedLocation\(\)\.tab;/);
  assert.match(configModalSource, /if \(editingVariantIdx !== null && editingVariantIdx === vIndex\) \{\s*navigateToLastEdited\('summary'\);/);
  assert.match(configModalSource, /setIsDirty\(false\);\s*navigateToLastEdited\('summary'\);/);

  // 2. Inputs/selects/textareas avoid oversized text-base / text-sm classes
  assert.equal(configModalSource.includes('text-base sm:text-xs'), false, 'ConfigModal must not contain oversized text-base input classes');
  assert.equal(activeSummarySource.includes('text-base'), false, 'ActiveSummaryPanel must not contain oversized text-base classes');
  assert.equal(settingsViewSource.includes('text-base sm:text-sm'), false, 'SettingsView inputs must not contain oversized text-base sm:text-sm classes');
  assert.match(authOverlaySource, /min-h-\[36px\] text-xs font-mono/);

  // 3. Active tab sections are collapsible and collapsed by default
  assert.match(activeSummarySource, /const SummaryCollapsibleSection = React\.memo\(/);
  assert.match(activeSummarySource, /const \[openSectionId, setOpenSectionId\] = useState\(null\);/);
  for (const sid of ['summary_env', 'summary_scan', 'summary_entry', 'summary_exit', 'summary_risk']) {
    assert.match(activeSummarySource, new RegExp(`id="${sid}"`));
    assert.match(activeSummarySource, new RegExp(`isOpen=\\{openSectionId === '${sid}'\\}`));
  }
});

test('Preset & variant saving protects against accidental overwrites, variant leaks, duplicate labels, and map-key resurrection', async () => {
  const tradingStoreSource = fs.readFileSync(path.resolve(__dirname, '../store/trading.js'), 'utf8');

  // 1. SavePresetModal collision warning, Make Unique button, and explicit overwrite checkbox
  assert.match(configModalSource, /const buildUniquePresetName = \(/);
  assert.match(configModalSource, /const collidingPresetName = useMemo\(/);
  assert.match(configModalSource, /Make Unique/);
  assert.match(configModalSource, /Overwrite existing preset/);
  assert.match(configModalSource, /collidingPresetName && allowOverwrite \? 'Overwrite Preset' : 'Save Preset'/);

  // 2. Client API supports optional overwrite boolean
  assert.match(clientSource, /if \(typeof options\?\.overwrite === 'boolean'\)/);
  assert.match(clientSource, /body\.overwrite = options\.overwrite;/);

  // 3. Preset clone preserves only its own variants (does not leak unrelated activeVariants)
  assert.match(configModalSource, /Preserve only the cloned preset's own variants; never leak unrelated active editor variants/);

  // 4. Bulk file import preserves strategy_variants (isNestedVariant = false) and deduplicates names with overwrite: false
  assert.match(configModalSource, /buildUniquePresetName\(rawName, reservedNames, 100, 'imported'\)/);
  assert.match(configModalSource, /coerceAndSanitizeConfig\(\{ \.\.\.item\.config, strategy_label: safeName \}, false\)/);
  assert.match(configModalSource, /presetsAPI\.save\(item\.name, item\.config, \{ overwrite: false \}\)/);

  // 5. Duplicate strategy_label guard in saveVariantChanges and savePreset
  assert.match(configModalSource, /title: 'Duplicate Strategy Label'/);

  // 6. Top-bar Update button routes renamed strategies to SavePresetModal instead of silently overwriting old preset
  assert.match(configModalSource, /const hasRenamedAwayFromLoaded = Boolean\(/);

  // 7. Store mergeConfigObjects replaces map keys atomically and patchConfig guards draft + rolls back on failure
  assert.match(tradingStoreSource, /const ATOMIC_CONFIG_MAP_KEYS = new Set\(/);
  assert.match(tradingStoreSource, /export const mergeConfigObjects = \(target, source\) =>/);
  assert.match(tradingStoreSource, /if \(!st\.sessionActive\) \{\s*try \{\s*if \(typeof sessionStorage !== 'undefined'\) \{\s*sessionStorage\.setItem\(engineStorageKey\('config_draft'\)/);
  assert.match(tradingStoreSource, /title: 'Update Failed'/);
});




