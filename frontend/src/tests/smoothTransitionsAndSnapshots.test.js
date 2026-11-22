import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Smooth Transitions, Separated Snapshots, Rule Filters, Catalog & Slim Banners', () => {
  const gaugeSource = fs.readFileSync(
    path.join(__dirname, '../components/ui/CandidateConditionsGauge.jsx'),
    'utf-8'
  );
  const strategyDetailSource = fs.readFileSync(
    path.join(__dirname, '../views/StrategyDetailView.jsx'),
    'utf-8'
  );
  const indexCssSource = fs.readFileSync(
    path.join(__dirname, '../index.css'),
    'utf-8'
  );
  const smoothMotionSource = fs.readFileSync(
    path.join(__dirname, '../components/ui/SmoothMotion.jsx'),
    'utf-8'
  );
  const tradesViewSource = fs.readFileSync(
    path.join(__dirname, '../views/TradesView.jsx'),
    'utf-8'
  );
  const dashboardSource = fs.readFileSync(
    path.join(__dirname, '../views/DashboardView.jsx'),
    'utf-8'
  );
  const alertBannerSource = fs.readFileSync(
    path.join(__dirname, '../components/PersistentAlertBanner.jsx'),
    'utf-8'
  );
  const symbolPickerSource = fs.readFileSync(
    path.join(__dirname, '../components/SymbolCatalogPicker.jsx'),
    'utf-8'
  );

  test('CandidateConditionsGauge updates in-place without unmounting/disappearing and enforces ruleFilter', () => {
    assert.ok(
      !gaugeSource.includes('key={`${model.symbol}:${model.mode}`}'),
      'CandidateConditionsGauge must NOT remount its outer container via key={`${model.symbol}:${model.mode}`}'
    );
    assert.ok(
      gaugeSource.includes('<SmoothHeightContainer') &&
      !gaugeSource.includes('<SmoothSwap'),
      'CandidateConditionsGauge must animate container height smoothly in-place without SmoothSwap unmount/blanking'
    );
    assert.ok(
      gaugeSource.includes("ruleFilter = 'all'") &&
      gaugeSource.includes('isClosedExitSnapshotView') &&
      gaugeSource.includes('isExitPreviewMode') &&
      gaugeSource.includes('configuredExitRules'),
      'CandidateConditionsGauge must enforce Entry / Exit ruleFilter properly for live candidates, In-Pos trades, and closed snapshots'
    );
    assert.ok(
      gaugeSource.includes('svg-smooth-stroke') &&
      gaugeSource.includes('svg-smooth-transform'),
      'ConditionDial and HtfBreakoutLadder must apply smooth GPU/stroke transitions instead of snapping'
    );
    assert.ok(
      gaugeSource.includes('In-Pos entry snapshot') &&
      gaugeSource.includes('In-Pos Snapshot'),
      'CandidateConditionsGauge must clearly label In-Position Entry Snapshots'
    );
  });

  test('StrategyDetailView separates Live vs Snapshots, includes ALL In-Pos trades, scrolls to Inspect Live, and filters rules across all viewports', () => {
    assert.ok(
      strategyDetailSource.includes("useState('live')") &&
      strategyDetailSource.includes("useState('all')") &&
      strategyDetailSource.includes('aria-label="Inspect filter scope"') &&
      strategyDetailSource.includes('aria-label="Filter snapshots by trade status"'),
      'StrategyDetailView must expose separated Live vs Snapshots filter controls and In Pos / Closed snapshot sub-filters'
    );
    assert.ok(
      strategyDetailSource.includes('openSnapshotChips') &&
      strategyDetailSource.includes('focusKey: `snapshot:${t.id}`') &&
      strategyDetailSource.includes('isMetadataOnlySnapshot'),
      'StrategyDetailView must populate Entry Snapshots for ALL In-Position trades (never restricted to closed trades)'
    );
    assert.ok(
      strategyDetailSource.includes("const isExplicitSnapshotFocus = Boolean(selectedFocusSymbol?.startsWith('snapshot:'))") &&
      strategyDetailSource.includes("if (isInspectingSnapshot || !bestOpp?.symbol || bestOpp.symbol === '---') return null;"),
      'Inspecting an In-Position snapshot must bypass Exit Monitor override so the Entry Conditions Snapshot is displayed'
    );
    assert.ok(
      strategyDetailSource.includes('Entry Snapshot') &&
      strategyDetailSource.includes('Live Exit Monitor'),
      'StrategyDetailView must offer quick switching between Live Exit Monitor and Entry Snapshot for open trades'
    );
    assert.ok(
      strategyDetailSource.includes('inspectLiveRef') &&
      strategyDetailSource.includes('scrollToInspectLive') &&
      strategyDetailSource.includes('scrollIntoView'),
      'StrategyDetailView must smoothly scroll to the Inspect Live section during candidate/snapshot/stage transitions'
    );
    assert.ok(
      strategyDetailSource.includes('ruleFilter={rulesMobileSection}') &&
      strategyDetailSource.includes('aria-label="Filter rules section"') &&
      !strategyDetailSource.includes('rulesMobileSection === \'risk\' && "hidden xl:block"'),
      'All Rules / Entry / Exit / Risk filter bar must work across desktop and mobile viewports and pass ruleFilter to CandidateConditionsGauge'
    );
  });

  test('Slim top inline banners, Edit modal full-width fallback, and static watchlist symbol catalog', () => {
    assert.ok(
      alertBannerSource.includes('data-banner-layout="inline"') &&
      !alertBannerSource.includes('fixed top-2 left-1/2 -translate-x-1/2') &&
      alertBannerSource.includes('py-1.5') &&
      alertBannerSource.includes('text-[11px]'),
      'PersistentAlertBanner must render slim modern inline top bars without fixed overlay overlap'
    );
    assert.ok(
      dashboardSource.includes('ModalLoadingFallback') &&
      dashboardSource.includes('w-full') &&
      dashboardSource.includes('preloadConfigModal()'),
      'DashboardView must use full-width modal Suspense fallback and preload ConfigModal to prevent vertical slim strip glitch'
    );
    assert.ok(
      symbolPickerSource.includes('fetchAvailableSymbols') &&
      symbolPickerSource.includes('From Strategy') &&
      symbolPickerSource.includes('TradFi'),
      'SymbolCatalogPicker must load full exchange catalog without scanning first, support TradFi/Overnight futures, and copy from other strategies'
    );
  });

  test('CSS animation utilities and SmoothMotion primitives support reduced motion', () => {
    assert.ok(
      indexCssSource.includes('.animate-in {') &&
      indexCssSource.includes('.fade-in {') &&
      indexCssSource.includes('.svg-smooth-transform {') &&
      indexCssSource.includes('.svg-smooth-stroke {') &&
      indexCssSource.includes('@media (prefers-reduced-motion: reduce)'),
      'index.css must define GPU enter & SVG transition utilities with prefers-reduced-motion fallback'
    );
    assert.ok(
      smoothMotionSource.includes('useReducedMotion') &&
      smoothMotionSource.includes('export const MOTION_EASE') &&
      smoothMotionSource.includes('export const SmoothCollapse') &&
      smoothMotionSource.includes('export const SmoothHeightContainer') &&
      smoothMotionSource.includes('export const SmoothSwap') &&
      smoothMotionSource.includes('export const MotionSegmentedPill') &&
      smoothMotionSource.includes('export const FocusCueBar'),
      'SmoothMotion.jsx must export MOTION_EASE, SmoothCollapse, SmoothHeightContainer, SmoothSwap, MotionSegmentedPill, and FocusCueBar with reduced-motion support'
    );
    assert.ok(
      indexCssSource.includes('--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);') &&
      indexCssSource.includes('--ease-glide: cubic-bezier(0.22, 1, 0.36, 1);') &&
      indexCssSource.includes('.animate-focus-sweep {'),
      'index.css must define semantic cubic-bezier variables and compositor-only focus hairline sweep'
    );
    assert.ok(
      strategyDetailSource.includes('layoutId="strategy-primary-tab"') &&
      strategyDetailSource.includes('layoutId="strategy-inspect-scope"') &&
      strategyDetailSource.includes('layoutId="strategy-rule-filter"') &&
      strategyDetailSource.includes('layoutId="strategy-stage-active-rail"') &&
      strategyDetailSource.includes('<FocusCueBar'),
      'StrategyDetailView must use cubic-bezier sliding indicators and FocusCueBar highlights to guide user attention cleanly'
    );
  });

  test('TradesView wraps mapped cards directly inside AnimatePresence for smooth enter/exit', () => {
    assert.ok(
      tradesViewSource.includes('<div className="grid gap-4 grid-cols-1">\n            <AnimatePresence mode="popLayout" initial={false}>'),
      'TradesView must place AnimatePresence directly inside the grid container wrapping motion card items'
    );
  });
});
