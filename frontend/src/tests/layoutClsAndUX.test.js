import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Layout CLS & WCAG 2.1 UX Standards', () => {
  const dashboardViewPath = path.join(__dirname, '../views/DashboardView.jsx');
  const dashboardViewSource = fs.readFileSync(dashboardViewPath, 'utf-8');

  const primitivesPath = path.join(__dirname, '../components/ui/primitives.jsx');
  const primitivesSource = fs.readFileSync(primitivesPath, 'utf-8');

  test('MonthlyRevenueChart pre-reserves period detail banner container height to eliminate CLS', () => {
    assert.ok(
      dashboardViewSource.includes('min-h-[38px] bg-accent/5 border border-accent/20 px-3 py-2 rounded-xl') &&
      dashboardViewSource.includes('Hover or tap a bar to inspect period breakdown'),
      'MonthlyRevenueChart must pre-reserve a min-height banner container and display guidance text when unhovered to prevent CLS on bar hover/touch'
    );
  });

  test('InteractiveLimitCard enforces WCAG spinbutton role, valuenow, lock/unlock ARIA labels, tooltips, and button semantics', () => {
    assert.ok(
      primitivesSource.includes('role="spinbutton"') &&
      primitivesSource.includes('aria-valuenow={value}') &&
      primitivesSource.includes('aria-valuemin={min}') &&
      primitivesSource.includes('aria-valuemax={max}'),
      'InteractiveLimitCard must apply spinbutton ARIA roles and value attributes for accessibility'
    );
    assert.ok(
      primitivesSource.includes('<Tooltip content={tooltip}>') &&
      primitivesSource.includes('type="button"') &&
      primitivesSource.includes('cursor-pointer'),
      'InteractiveLimitCard must wire tooltip prop to Radix Tooltip and enforce explicit type="button" and cursor-pointer on controls'
    );
  });

  test('StatCard enforces WCAG region role and keyboard focus-visible ring styles', () => {
    assert.ok(
      primitivesSource.includes('role="region"') &&
      primitivesSource.includes('focus-visible:ring-2 focus-visible:ring-accent'),
      'StatCard must enforce region ARIA role and high-contrast focus rings for keyboard navigation'
    );
  });

  test('StrategyCard enforces WCAG button role, keyboard interaction, and focus ring', () => {
    assert.ok(
      dashboardViewSource.includes('role="button"') &&
      dashboardViewSource.includes('tabIndex={0}') &&
      dashboardViewSource.includes('focus-visible:ring-2 focus-visible:ring-accent'),
      'StrategyCard interactive containers must specify button ARIA role, tabIndex={0}, and focus-visible rings'
    );
  });

  test('Metric grids enforce equal card heights with auto-rows-fr, items-stretch, and h-full StatCard', () => {
    const strategyDetailSource = fs.readFileSync(path.join(__dirname, '../views/StrategyDetailView.jsx'), 'utf-8');
    const tradesViewSource = fs.readFileSync(path.join(__dirname, '../views/TradesView.jsx'), 'utf-8');
    const historyViewSource = fs.readFileSync(path.join(__dirname, '../views/HistoryView.jsx'), 'utf-8');

    assert.ok(primitivesSource.includes('flex flex-col items-start h-full w-full'), 'StatCard must stretch to full grid cell height');
    assert.ok(dashboardViewSource.includes('auto-rows-fr items-stretch'), 'DashboardView metric rows must enforce equal height');
    assert.ok(strategyDetailSource.includes('auto-rows-fr items-stretch'), 'StrategyDetailView KPI rows must enforce equal height');
    assert.ok(tradesViewSource.includes('auto-rows-fr items-stretch'), 'TradesView metric rows must enforce equal height');
    assert.ok(historyViewSource.includes('auto-rows-fr items-stretch'), 'HistoryView metric rows must enforce equal height');
  });

  test('StrategyDetailView header enforces mobile-first single-row layout without w-full overflow', () => {
    const strategyDetailSource = fs.readFileSync(path.join(__dirname, '../views/StrategyDetailView.jsx'), 'utf-8');
    assert.ok(
      primitivesSource.includes('mobileOneRow = false') &&
      primitivesSource.includes('mobileOneRow && "flex-nowrap min-h-[38px]"') &&
      primitivesSource.includes('mobileOneRow && backAction ? "hidden sm:flex" : "flex"') &&
      primitivesSource.includes('min-h-[38px] min-w-[38px]'),
      'ViewHeader must support mobileOneRow with non-wrapping Row 1, hidden mobile decorative icon when backAction is present, and >=38px mobile back button hitbox'
    );
    assert.ok(
      strategyDetailSource.includes('mobileOneRow'),
      'StrategyDetailView must enable mobileOneRow on ViewHeader'
    );
    assert.ok(
      !strategyDetailSource.includes('w-full sm:w-auto justify-between sm:justify-end'),
      'StrategyDetailView ViewHeader children must not use w-full inside shrink-0 Row 1 flex container'
    );
  });

  test('DashboardView Global Metrics toolbar enforces equal-height Risk Limits & Expand buttons with balanced expanded subValues', () => {
    assert.ok(
      dashboardViewSource.includes('grid grid-cols-2 sm:inline-flex items-stretch gap-1 p-1') &&
      dashboardViewSource.includes('h-9 sm:h-7 px-2.5 sm:px-3 rounded-lg flex items-center justify-center gap-1.5') &&
      dashboardViewSource.includes('aria-label="Global metrics and risk limits controls"'),
      'Global Metrics Risk Limits and Expand buttons must sit inside a unified equal-height control track without mobile wrapping'
    );
    assert.ok(
      dashboardViewSource.includes('subValue={globalMetricsExpanded ? `Cap:') &&
      dashboardViewSource.includes('subValue={globalMetricsExpanded ? `${hitCount || 0}/${entryCount || 0} Hits'),
      'Live Risk and Peak RR cards should show subValue details when global metrics are expanded'
    );
  });

  test('ConfigModal enforces mobile keyboard ergonomics, full-screen mobile sheet, Presets order after Risk, and compact Presets layout', () => {
    const configModalSource = fs.readFileSync(path.join(__dirname, '../components/ConfigModal.jsx'), 'utf-8');

    assert.ok(
      configModalSource.includes('window.visualViewport') &&
      configModalSource.includes('stepFocusedField') &&
      configModalSource.includes('dismissMobileKeyboard') &&
      configModalSource.includes('↑ Prev') &&
      configModalSource.includes('↓ Next') &&
      configModalSource.includes('height: `${vvHeight}px`, maxHeight: `${vvHeight}px`'),
      'ConfigModal must bind visualViewport height on mobile keyboards and provide Prev/Next/Done accessory controls'
    );

    assert.ok(
      configModalSource.includes('min-h-[32px] text-xs') &&
      !configModalSource.includes('text-base sm:text-xs') &&
      configModalSource.includes("const resolvedInputMode = attrs?.inputMode ?? (type === 'number' ? 'decimal' : undefined);") &&
      configModalSource.includes('inputMode={resolvedInputMode}'),
      'ConfigModal ConfigField inputs must use uniform compact text-xs typography, min-h-[32px], and numeric inputMode'
    );

    assert.ok(
      configModalSource.includes('overflow-x-auto no-scrollbar snap-x') &&
      !configModalSource.includes('isMoreOpen'),
      'SectionTabs must render all tabs in a single horizontally scrollable strip without the brittle portal More dropdown'
    );

    assert.match(
      configModalSource,
      /id:\s*'risk'[\s\S]*?id:\s*'presets'[\s\S]*?id:\s*'env'/,
      'SectionTabs must position Presets immediately after Risk'
    );

    assert.ok(
      dashboardViewSource.includes('h-[100dvh] sm:h-[88dvh]') &&
      dashboardViewSource.includes('inset-0 sm:inset-auto'),
      'DashboardView ConfigModal drawer must render edge-to-edge full-screen (100dvh) on mobile and centered dialog on sm+ viewports'
    );

    assert.ok(
      configModalSource.includes('pb-2 sm:pb-3 overscroll-contain') &&
      !configModalSource.includes('pb-24 md:pb-24'),
      'ConfigModal scroll container must eliminate wasted pb-24 bottom dead space'
    );

    assert.ok(
      configModalSource.includes("window.location.hash = '#/settings'"),
      'ConfigModal Env tab missing-keys warning must bridge cleanly to System Settings'
    );

    assert.ok(
      configModalSource.includes('scrollBodyRef') &&
      configModalSource.includes('resetOuterScroll') &&
      configModalSource.includes('vvOffsetTop') &&
      configModalSource.includes('onOuterScrollGuard') &&
      configModalSource.includes('onNativeSelectChange') &&
      !configModalSource.includes('scrollIntoView('),
      'ConfigModal must isolate field/tab scrolling to scrollBodyRef & listRef, track visualViewport.offsetTop, and lock outer overflow-hidden containers against header clipping'
    );

    const primitivesSource = fs.readFileSync(path.join(__dirname, '../components/ui/primitives.jsx'), 'utf-8');
    assert.ok(
      primitivesSource.includes('shrink-0 animate-in fade-in') &&
      primitivesSource.includes('w-[min(20rem,calc(100vw-2rem))]'),
      'ModalAlertTicker must prevent flex shrinking and clamp dropdown width on narrow mobile viewports'
    );
  });

  test('SettingsView enforces unified Cockpit layout, mobileOneRow ViewHeader, KPI readiness strip, category tabs, and anti-zoom inputs', () => {
    const settingsSource = fs.readFileSync(path.join(__dirname, '../views/SettingsView.jsx'), 'utf-8');

    assert.ok(
      settingsSource.includes('max-w-[1160px]') &&
      settingsSource.includes('mobileOneRow') &&
      settingsSource.includes('SETTINGS_CATEGORIES'),
      'SettingsView must match Cockpit container width, single-row mobile ViewHeader, and category navigation'
    );

    assert.ok(
      settingsSource.includes('grid grid-cols-2 lg:grid-cols-4 auto-rows-fr items-stretch gap-2.5'),
      'SettingsView overview strip must align 4 equal-height KPI tiles across breakpoints'
    );

    assert.ok(
      settingsSource.includes('min-h-[34px] text-xs') &&
      !settingsSource.includes('text-base sm:text-sm'),
      'SettingsView inputs/selects must use uniform compact text-xs typography and 34px min height'
    );
  });

  test('ViewHeader Row 2 reserves constant min-height and TradesView/HistoryView enforce mobile-first alignment without hover translate shift', () => {
    const tradesViewSource = fs.readFileSync(path.join(__dirname, '../views/TradesView.jsx'), 'utf-8');
    const historyViewSource = fs.readFileSync(path.join(__dirname, '../views/HistoryView.jsx'), 'utf-8');

    assert.ok(
      primitivesSource.includes('const shouldRenderSecondRow = !hideMetrics;') &&
      primitivesSource.includes('min-h-[22px] w-full'),
      'ViewHeader must keep Row 2 consistently mounted with min-h-[22px] when hideMetrics is false so alerts never cause vertical layout shift'
    );

    assert.ok(
      tradesViewSource.includes('max-w-[1160px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-6 md:pt-6') &&
      tradesViewSource.includes('hideMetricsNumbers') &&
      tradesViewSource.includes('mobileOneRow'),
      'TradesView must use unified mobile-first container padding, mobileOneRow, and hideMetricsNumbers'
    );

    assert.ok(
      historyViewSource.includes('max-w-[1160px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-6 md:pt-6') &&
      !historyViewSource.includes('hover:translate-x-1'),
      'HistoryView must use unified mobile-first container padding and eliminate horizontal hover translate layout shifts on TradeItem'
    );
  });

  test('PersistentAlertBanner, GateBanner, ViewHeader, and LoadingView enforce inline non-overlapping banners and stable geometry', () => {
    const alertBannerSource = fs.readFileSync(path.join(__dirname, '../components/PersistentAlertBanner.jsx'), 'utf-8');
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.jsx'), 'utf-8');
    const strategyDetailSource = fs.readFileSync(path.join(__dirname, '../views/StrategyDetailView.jsx'), 'utf-8');
    const configModalSource = fs.readFileSync(path.join(__dirname, '../components/ConfigModal.jsx'), 'utf-8');

    assert.ok(
      alertBannerSource.includes('data-banner-layout="inline"') &&
      !alertBannerSource.includes('fixed top-2 left-1/2 -translate-x-1/2'),
      'PersistentAlertBanner must render inline in normal flow so connection banners never overlap headers or cards'
    );

    assert.ok(
      dashboardViewSource.includes('if (!gateState && !scannerPaused) return null;') &&
      !dashboardViewSource.includes('if (!gateState && !scannerPaused && !showResumingFeedback) return null;'),
      'GateBanner must not mount in document flow solely for transient resume feedback'
    );

    assert.ok(
      !primitivesSource.includes("{showResumingFeedback ? 'Resuming...' : title}"),
      'ViewHeader h1 title must stay constant during resume instead of mutating heading width'
    );

    assert.ok(
      mainSource.includes("sidebarCollapsed ? 'lg:pl-[80px]' : 'lg:pl-[260px]'") &&
      mainSource.includes('warmRoutes'),
      'main.jsx LoadingView must mirror sidebar shell geometry and idle-preload lazy routes'
    );

    const indexCssSource = fs.readFileSync(path.join(__dirname, '../index.css'), 'utf-8');
    const symbolPickerSource = fs.readFileSync(path.join(__dirname, '../components/SymbolCatalogPicker.jsx'), 'utf-8');
    const gaugeSource = fs.readFileSync(path.join(__dirname, '../components/ui/CandidateConditionsGauge.jsx'), 'utf-8');

    assert.ok(
      indexCssSource.includes('scrollbar-gutter: stable;'),
      'index.css must set scrollbar-gutter: stable on html to prevent horizontal CLS on scrollbar appearance'
    );

    assert.ok(
      dashboardViewSource.includes('const DashboardTopBannerDock = React.memo(') &&
      dashboardViewSource.includes('data-banner-layout="inline"') &&
      !dashboardViewSource.includes('fixed left-1/2 -translate-x-1/2'),
      'DashboardView BanBanner, Agreement banner, and GateBanner must render inline in normal flow without overlapping headers or connection alerts'
    );

    assert.ok(
      symbolPickerSource.includes("compact ? 'h-52' : 'h-64'") &&
      symbolPickerSource.includes("compact ? 'h-[246px]' : 'h-[294px]'"),
      'SymbolCatalogPicker must reserve fixed scroll container heights to prevent CLS during async symbol loading and tab switches'
    );

    assert.ok(
      gaugeSource.includes('[contain:layout_style]') &&
      gaugeSource.includes("compact ? 'gap-2 min-h-[120px]' : 'gap-3 min-h-[168px]'") &&
      gaugeSource.includes('data-sticky-condition-header') &&
      gaugeSource.includes('sticky top-0 z-30') &&
      gaugeSource.includes('overflow-x-clip') &&
      gaugeSource.includes('CandleCloseCountdown'),
      'CandidateConditionsGauge must enforce layout containment, sticky condition header with overflow-x-clip, and stable CandleCloseCountdown'
    );

    assert.ok(
      strategyDetailSource.includes('const RotationStatusControl = React.memo(') &&
      strategyDetailSource.includes('ROTATION_INTERVAL_SEC') &&
      strategyDetailSource.includes('stickyHeader={true}') &&
      strategyDetailSource.includes('useNow()') &&
      !strategyDetailSource.includes('((now - (lastUpdateTs || now)) / 1000)).toFixed(1)'),
      'StrategyDetailView must render RotationStatusControl with countdown/reason, sticky condition header, and flicker-free useNow LiveStreamAge'
    );

    assert.ok(
      configModalSource.includes('config_last_edited_location') &&
      configModalSource.includes('const navigateToLastEdited = React.useCallback(') &&
      configModalSource.includes('data-testid="presets-last-edited-nav"'),
      'ConfigModal must persist lastEditedLocation and navigate there when editing presets/variants instead of forcing Active tab'
    );
  });

  test('Geometry-matched zero-CLS skeletons are used across view transitions, Suspense mounts, and live sync events', () => {
    const skeletonsSource = fs.readFileSync(path.join(__dirname, '../components/ui/Skeletons.jsx'), 'utf-8');
    const indexCssSource = fs.readFileSync(path.join(__dirname, '../index.css'), 'utf-8');
    const strategyDetailSource = fs.readFileSync(path.join(__dirname, '../views/StrategyDetailView.jsx'), 'utf-8');
    const gaugeSource = fs.readFileSync(path.join(__dirname, '../components/ui/CandidateConditionsGauge.jsx'), 'utf-8');
    const scannerOverlaySource = fs.readFileSync(path.join(__dirname, '../components/ScannerOverlay.jsx'), 'utf-8');
    const scannerPreviewSource = fs.readFileSync(path.join(__dirname, '../components/ScannerPreview.jsx'), 'utf-8');
    const tradesViewSource = fs.readFileSync(path.join(__dirname, '../views/TradesView.jsx'), 'utf-8');
    const tradeDetailSource = fs.readFileSync(path.join(__dirname, '../views/TradeDetailView.jsx'), 'utf-8');
    const historyViewSource = fs.readFileSync(path.join(__dirname, '../views/HistoryView.jsx'), 'utf-8');

    for (const exportName of [
      'SkeletonBlock',
      'StrategyDetailSkeleton',
      'ConditionCardsSkeleton',
      'ScannerRowsSkeleton',
      'ScannerPreviewRowsSkeleton',
      'DecisionLogSkeleton',
      'ChartPanelSkeleton',
      'CalendarGridSkeleton',
      'TradeDetailSkeleton',
      'ActiveTradesSkeleton',
      'HistorySessionsSkeleton',
    ]) {
      assert.ok(
        skeletonsSource.includes(`export const ${exportName}`),
        `Skeletons.jsx must export ${exportName}`
      );
    }

    assert.ok(
      indexCssSource.includes('@keyframes skeleton-shimmer') &&
      indexCssSource.includes('.skeleton-shimmer::after') &&
      indexCssSource.includes('html[data-low-glare="true"] .skeleton-shimmer::after'),
      'index.css must provide GPU-composited .skeleton-shimmer with low-glare and reduced-motion disablement'
    );

    assert.ok(
      dashboardViewSource.includes('<Suspense fallback={<StrategyDetailSkeleton />}>') &&
      dashboardViewSource.includes('<Suspense fallback={<DecisionLogSkeleton />}>') &&
      dashboardViewSource.includes('<Suspense fallback={<ScannerRowsSkeleton'),
      'DashboardView Suspense slots must use geometry-matched skeletons'
    );

    assert.ok(
      strategyDetailSource.includes('<Suspense fallback={<ChartPanelSkeleton') &&
      strategyDetailSource.includes('<Suspense fallback={<CalendarGridSkeleton />}>') &&
      strategyDetailSource.includes('isSyncing={isBatchSyncing}'),
      'StrategyDetailView must render ChartPanelSkeleton, CalendarGridSkeleton, and wire isBatchSyncing to CandidateConditionsGauge'
    );

    assert.ok(
      gaugeSource.includes('<ConditionCardsSkeleton') &&
      gaugeSource.includes('isSyncing && !effectiveOpp?.isEntrySnapshot'),
      'CandidateConditionsGauge must render ConditionCardsSkeleton in-place during kline sync'
    );

    assert.ok(
      scannerOverlaySource.includes('<ScannerRowsSkeleton') &&
      scannerPreviewSource.includes('<ScannerPreviewRowsSkeleton'),
      'ScannerOverlay and ScannerPreview must render row skeletons while scanning/warming up'
    );

    assert.ok(
      tradesViewSource.includes('<ActiveTradesSkeleton') &&
      tradeDetailSource.includes('<TradeDetailSkeleton />') &&
      historyViewSource.includes('<ChartPanelSkeleton') &&
      historyViewSource.includes('<HistorySessionsSkeleton'),
      'TradesView, TradeDetailView, and HistoryView must render zero-CLS skeletons during resume and initial REST hydration'
    );
  });

  test('Persistent App navigation shell, non-blanking transitions, and full-route skeletons are wired cleanly', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.jsx'), 'utf-8');
    const smoothMotionSource = fs.readFileSync(path.join(__dirname, '../components/ui/SmoothMotion.jsx'), 'utf-8');
    const historyViewSource = fs.readFileSync(path.join(__dirname, '../views/HistoryView.jsx'), 'utf-8');
    const tradesViewSource = fs.readFileSync(path.join(__dirname, '../views/TradesView.jsx'), 'utf-8');
    const backtestSource = fs.readFileSync(path.join(__dirname, '../components/BacktestPanel.jsx'), 'utf-8');
    const settingsSource = fs.readFileSync(path.join(__dirname, '../views/SettingsView.jsx'), 'utf-8');
    const indexHtmlSource = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf-8');

    assert.ok(
      !smoothMotionSource.includes('<AnimatePresence mode="wait"'),
      'SmoothSwap must mount incoming route/tab content immediately without AnimatePresence mode="wait" blanking'
    );

    const sidebarIdx = mainSource.indexOf('<Sidebar ');
    const suspenseIdx = mainSource.indexOf('<Suspense fallback={<LoadingView view={view} />}>');
    const bottomNavIdx = mainSource.indexOf('<BottomNav ');
    assert.ok(
      sidebarIdx !== -1 &&
      suspenseIdx !== -1 &&
      bottomNavIdx !== -1 &&
      sidebarIdx < suspenseIdx &&
      bottomNavIdx > suspenseIdx &&
      mainSource.includes('useState(getViewFromHash)') &&
      mainSource.includes('<DashboardSkeleton />') &&
      mainSource.includes('<TradesSkeleton />') &&
      mainSource.includes('<HistorySkeleton />') &&
      mainSource.includes('<SettingsSkeleton />') &&
      mainSource.includes('<TradeDetailSkeleton />') &&
      mainSource.includes('<StrategyDetailSkeleton />'),
      'main.jsx must render persistent Sidebar/BottomNav outside Suspense, initialize route synchronously, and route-match LoadingView skeletons'
    );

    assert.ok(
      !tradesViewSource.includes('<Sidebar') &&
      !historyViewSource.includes('<Sidebar') &&
      !settingsSource.includes('<Sidebar') &&
      !dashboardViewSource.includes('<Sidebar'),
      'Individual views must not remount Sidebar independently when App owns the persistent shell'
    );

    assert.ok(
      !historyViewSource.includes('<React.Suspense fallback={null}>\n      <Sidebar') &&
      historyViewSource.includes('<ModalDrawerSkeleton />') &&
      tradesViewSource.includes('<ModalDrawerSkeleton />') &&
      backtestSource.includes('<BacktestResultsSkeleton />') &&
      settingsSource.includes('<StartupChecklistSkeleton') &&
      indexHtmlSource.includes('boot-shell'),
      'Views must wire HistoryView/BacktestPanel/SettingsView/drawer skeletons and index.html cold-boot shell without full-page fallback={null}'
    );
  });

  test('Top slide-down notification strips, unwrapped Global Metrics expand, and countdown CLS guards', () => {
    const alertBannerSource = fs.readFileSync(path.join(__dirname, '../components/PersistentAlertBanner.jsx'), 'utf-8');
    const gaugeSource = fs.readFileSync(path.join(__dirname, '../components/ui/CandidateConditionsGauge.jsx'), 'utf-8');
    const strategyDetailSource = fs.readFileSync(path.join(__dirname, '../views/StrategyDetailView.jsx'), 'utf-8');
    const activeTradeCardSource = fs.readFileSync(path.join(__dirname, '../components/ActiveTradeCard.jsx'), 'utf-8');
    const tradeDetailSource = fs.readFileSync(path.join(__dirname, '../components/trade/TradeDetailContent.jsx'), 'utf-8');
    const apiHealthSource = fs.readFileSync(path.join(__dirname, '../components/ApiHealthWidget.jsx'), 'utf-8');
    const systemMetricsSource = fs.readFileSync(path.join(__dirname, '../components/SystemMetrics.jsx'), 'utf-8');

    // 1. Narrow top slide-down notification strips
    assert.ok(
      alertBannerSource.includes('data-banner-style="top-slide-strip"') &&
      dashboardViewSource.includes('data-banner-style="top-slide-strip"'),
      'Connection, ban, and gate banners must use narrow top-slide-strip layout'
    );

    // 2. Global Metrics Expand shows full unwrapped content without truncation
    assert.ok(
      primitivesSource.includes('wrapSubValue = false') &&
      dashboardViewSource.includes('wrapSubValue={globalMetricsExpanded}') &&
      dashboardViewSource.includes('grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'),
      'Expanded Global Metrics must switch to full-width grid and pass wrapSubValue so sub-metrics are never cut off'
    );

    // 3. Countdown & live-timer CLS prevention (fixed ch widths, zero-padding, nowrap)
    assert.ok(
      gaugeSource.includes('min-w-[14ch]') &&
      gaugeSource.includes('min-w-[7ch]') &&
      gaugeSource.includes('whitespace-nowrap shrink-0 inline-block'),
      'CandidateConditionsGauge freshness & candle countdown must reserve stable ch widths and avoid wrapping'
    );
    assert.ok(
      strategyDetailSource.includes("compact ? 'min-w-[3.5ch]' : 'min-w-[8.5ch]'") &&
      strategyDetailSource.includes('min-w-[3.5ch]') &&
      strategyDetailSource.includes('min-w-[7ch]'),
      'StrategyDetailView live stream age, rotation countdown, and relative time must reserve stable ch widths'
    );
    assert.ok(
      activeTradeCardSource.includes('min-w-[6.5ch]') &&
      tradeDetailSource.includes('min-w-[7ch]') &&
      apiHealthSource.includes('min-w-[11ch]') &&
      apiHealthSource.includes("String(secs).padStart(2, '0')") &&
      systemMetricsSource.includes("String(secs).padStart(2, '0')") &&
      dashboardViewSource.includes('min-w-[16ch]') &&
      dashboardViewSource.includes('min-w-[4.5ch]'),
      'Trade duration, exit delay, ban cooldown, and gate countdowns must zero-pad and reserve fixed widths to prevent CLS'
    );
  });
});




