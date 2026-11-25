import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPersistedFilter,
  writePersistedFilter,
  readPersistedJson,
  writePersistedJson,
  sanitizeLogFilters,
} from '../utils/filterPersistence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');

test('filterPersistence helpers validate booleans, numbers, allowlists, and JSON safely', () => {
  const backing = new Map();
  const prevStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  };

  try {
    writePersistedFilter('mode', 'variants');
    assert.equal(readPersistedFilter('mode', 'all', ['all', 'live', 'variants']), 'variants');
    writePersistedFilter('mode', 'bogus');
    assert.equal(readPersistedFilter('mode', 'all', ['all', 'live', 'variants']), 'all');

    writePersistedFilter('flag', true);
    assert.equal(readPersistedFilter('flag', false), true);
    writePersistedFilter('flag', false);
    assert.equal(readPersistedFilter('flag', true), false);
    backing.set('flag', 'corrupt');
    assert.equal(readPersistedFilter('flag', true), true);

    writePersistedFilter('score', 70);
    assert.equal(readPersistedFilter('score', 0, [0, 55, 70, 80]), 70);
    backing.set('score', '999');
    assert.equal(readPersistedFilter('score', 0, [0, 55, 70, 80]), 0);

    writePersistedJson('logs', { info: false, warn: true, error: true });
    assert.deepEqual(
      readPersistedJson('logs', { info: true, warn: true, error: true }, sanitizeLogFilters),
      { info: false, warn: true, error: true }
    );
    backing.set('logs', '{bad json');
    assert.deepEqual(
      readPersistedJson('logs', { info: true, warn: true, error: true }, sanitizeLogFilters),
      { info: true, warn: true, error: true }
    );
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('ConfigModal Presets panel progressively discloses & persists usage and mode filter selections', () => {
  const src = readSrc('components/ConfigModal.jsx');

  assert.ok(
    src.includes("usePersistedFilter('presets_filters_expanded', false)"),
    'ConfigModal presets filter disclosure defaults collapsed and persists in localStorage'
  );
  assert.ok(
    src.includes("usePersistedFilter('presets_mode_filter', 'all'") &&
      src.includes("usePersistedFilter('presets_usage_filter', 'all'"),
    'ConfigModal persists both mode and usage filter selections'
  );
  assert.ok(
    src.includes('data-testid="presets-filters-toggle"') && src.includes('aria-expanded={presetFiltersExpanded}'),
    'ConfigModal exposes accessible presets Filters toggle button with aria-expanded'
  );
  assert.ok(
    src.includes('<SmoothCollapse isOpen={presetFiltersExpanded}>'),
    'ConfigModal wraps secondary preset mode filters in SmoothCollapse'
  );
  assert.ok(
    src.includes('!presetFiltersExpanded && presetTabFilter !== \'all\''),
    'ConfigModal surfaces a quiet active summary + reset when mode filters are collapsed'
  );
});

test('DecisionLog & trading store persist level toggles, limit selection, and disclosure state', () => {
  const logSrc = readSrc('components/DecisionLog.jsx');
  const storeSrc = readSrc('store/trading.js');

  assert.ok(
    storeSrc.includes("readPersistedJson('decision_log_filters'") &&
      storeSrc.includes("writePersistedJson('decision_log_filters'"),
    'trading store persists Info/Warnings/Errors level filter selection in localStorage'
  );
  assert.ok(
    logSrc.includes("localStorage.getItem('decision_log_filters_expanded') === 'true'") &&
      logSrc.includes("localStorage.getItem('decision_log_limit')"),
    'DecisionLog filter disclosure and limit persist in localStorage'
  );
  assert.ok(
    logSrc.includes('data-testid="decision-log-filters-toggle"') && logSrc.includes('aria-expanded={filtersExpanded}'),
    'DecisionLog exposes accessible Filters toggle button with active count and aria-expanded'
  );
  assert.ok(
    logSrc.includes('!filtersExpanded') && logSrc.includes('Levels:') && logSrc.includes('Limit:'),
    'DecisionLog shows a quiet 1-line summary of levels and limit when collapsed'
  );
  assert.ok(
    logSrc.includes('<SmoothCollapse isOpen={filtersExpanded}>') && logSrc.includes('handleResetFilters'),
    'DecisionLog wraps level toggles & limit selector in SmoothCollapse with unified reset'
  );
});

test('StrategyDetailView persists all decision log, snapshot, and rule filter selections', () => {
  const src = readSrc('views/StrategyDetailView.jsx');

  assert.ok(
    src.includes("usePersistedFilter('strategy_decision_filters_expanded', false)") &&
      src.includes("usePersistedFilter('strategy_decision_outcome', 'all'") &&
      src.includes("usePersistedFilter('strategy_decision_stage', 'all'") &&
      src.includes("usePersistedFilter('strategy_decision_symbol', 'all')") &&
      src.includes("usePersistedFilter('strategy_decision_hide_misses', true)") &&
      src.includes("usePersistedFilter('strategy_decision_view_mode', 'timeline'"),
    'StrategyDetailView persists all decision log filter selections'
  );
  assert.ok(
    src.includes("usePersistedFilter('strategy_inspect_scope', 'live'") &&
      src.includes("usePersistedFilter('strategy_snapshot_status_filter', 'all'") &&
      src.includes("usePersistedFilter('strategy_rules_mobile_section', 'all'"),
    'StrategyDetailView persists inspect scope, snapshot status, and mobile rule section filters'
  );
  assert.ok(
    src.includes('data-testid="strategy-decision-filters-toggle"') && src.includes('aria-expanded={decisionFiltersExpanded}'),
    'StrategyDetailView exposes accessible decision log Filters toggle with aria-expanded'
  );
  assert.ok(
    src.includes('!decisionFiltersExpanded') && src.includes('handleCopyLogScope(\'filtered\')'),
    'StrategyDetailView displays a quiet facet summary + quick Copy when collapsed'
  );
  assert.ok(
    src.includes('<SmoothCollapse isOpen={decisionFiltersExpanded}>') && src.includes('handleResetDecisionFilters'),
    'StrategyDetailView collapses Stage/Symbol/Search/ViewMode/BulkCopy inside SmoothCollapse'
  );
});

test('SymbolCatalogPicker, SystemMetrics, and HistoryView persist remaining filter selections', () => {
  const picker = readSrc('components/SymbolCatalogPicker.jsx');
  const metrics = readSrc('components/SystemMetrics.jsx');
  const history = readSrc('views/HistoryView.jsx');

  assert.ok(
    picker.includes('aria-expanded={showHtfFilters}') &&
      picker.includes('isHtfMode && !showHtfFilters') &&
      picker.includes('<SmoothCollapse isOpen={showHtfFilters}>'),
    'SymbolCatalogPicker keeps EMA filter drawer collapsible cleanly with compact collapsed summary'
  );
  assert.ok(
    picker.includes("usePersistedFilter('symbol_picker_category', 'all'") &&
      picker.includes("usePersistedFilter('symbol_picker_sort', 'volume'") &&
      picker.includes("usePersistedFilter('symbol_picker_htf_filters_expanded', false)") &&
      picker.includes("usePersistedFilter('symbol_picker_htf_freshness', 'all'") &&
      picker.includes("usePersistedFilter('symbol_picker_htf_direction', 'all'") &&
      picker.includes("usePersistedFilter('symbol_picker_htf_min_score', 0"),
    'SymbolCatalogPicker persists category, sort, and HTF EMA Cross filter selections'
  );
  assert.ok(
    metrics.includes("usePersistedFilter('metrics_rest_endpoint_filter', 'all')") &&
      metrics.includes("usePersistedFilter('metrics_rest_status_filter', 'all')"),
    'SystemMetrics persists REST Call endpoint and status filters'
  );
  assert.ok(
    history.includes("usePersistedFilter('history_session_filter_tab', 'strategy'"),
    'HistoryView persists session breakdown filter tab'
  );
});
