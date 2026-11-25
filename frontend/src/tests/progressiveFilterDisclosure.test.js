import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');

test('ConfigModal Presets panel progressively discloses secondary mode filters with persisted state & quiet summary', () => {
  const src = readSrc('components/ConfigModal.jsx');

  assert.ok(
    src.includes("localStorage.getItem('presets_filters_expanded') === 'true'"),
    'ConfigModal presets filter disclosure defaults collapsed and persists in localStorage'
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

test('DecisionLog progressively discloses level toggles and limit controls behind a Filters toggle', () => {
  const src = readSrc('components/DecisionLog.jsx');

  assert.ok(
    src.includes("localStorage.getItem('decision_log_filters_expanded') === 'true'"),
    'DecisionLog filter disclosure defaults collapsed and persists in localStorage'
  );
  assert.ok(
    src.includes('data-testid="decision-log-filters-toggle"') && src.includes('aria-expanded={filtersExpanded}'),
    'DecisionLog exposes accessible Filters toggle button with active count and aria-expanded'
  );
  assert.ok(
    src.includes('!filtersExpanded') && src.includes('Levels:') && src.includes('Limit:'),
    'DecisionLog shows a quiet 1-line summary of levels and limit when collapsed'
  );
  assert.ok(
    src.includes('<SmoothCollapse isOpen={filtersExpanded}>') && src.includes('handleResetFilters'),
    'DecisionLog wraps level toggles & limit selector in SmoothCollapse with unified reset'
  );
});

test('StrategyDetailView Decision Log progressively discloses secondary facets and bulk copy controls', () => {
  const src = readSrc('views/StrategyDetailView.jsx');

  assert.ok(
    src.includes("localStorage.getItem('strategy_decision_filters_expanded') === 'true'"),
    'StrategyDetailView decision log filter disclosure defaults collapsed and persists in localStorage'
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

test('SymbolCatalogPicker separates EMA filter drawer expansion from EMA Cross sort scoring', () => {
  const src = readSrc('components/SymbolCatalogPicker.jsx');

  assert.ok(
    src.includes('aria-expanded={showHtfFilters}'),
    'SymbolCatalogPicker EMA Filters button accurately reflects collapsed/expanded drawer state even in ema_cross sort'
  );
  assert.ok(
    src.includes('isHtfMode && !showHtfFilters') && src.includes('<SmoothCollapse isOpen={showHtfFilters}>'),
    'SymbolCatalogPicker shows compact 1-line EMA summary when collapsed and wraps filter rows in SmoothCollapse'
  );
});
