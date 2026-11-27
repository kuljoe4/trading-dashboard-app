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
      primitivesSource.includes('mobileOneRow && "flex-nowrap min-h-[34px]"') &&
      primitivesSource.includes('mobileOneRow && backAction ? "hidden sm:flex" : "flex"') &&
      primitivesSource.includes('min-h-[34px] min-w-[34px]'),
      'ViewHeader must support mobileOneRow with non-wrapping Row 1, hidden mobile decorative icon when backAction is present, and compact mobile back button hitbox'
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

  test('DashboardView Global Metrics toolbar enforces equal-height compact Risk Limits & Expand buttons with balanced expanded subValues', () => {
    assert.ok(
      dashboardViewSource.includes('grid grid-cols-2 sm:inline-flex items-stretch gap-1 p-0.5') &&
      dashboardViewSource.includes('h-7 sm:h-6 px-2 sm:px-2.5 rounded-md flex items-center justify-center gap-1.5') &&
      dashboardViewSource.includes('aria-label="Global metrics and risk limits controls"'),
      'Global Metrics Risk Limits and Expand buttons must sit inside a compact unified equal-height control track without mobile wrapping'
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
      alertBannerSource.includes('data-banner-unified="single-strip"') &&
      !alertBannerSource.includes('fixed top-2 left-1/2 -translate-x-1/2') &&
      !alertBannerSource.includes('border-l-2'),
      'PersistentAlertBanner must render all notices inside one inline unified top strip without overlap or thick left accent borders'
    );

    assert.ok(
      alertBannerSource.includes('if (gateState || scannerPaused)') &&
      !alertBannerSource.includes('if (gateState || scannerPaused || isSyncingOnResume)'),
      'Unified top strip must not mount a gate notice solely for transient resume feedback'
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
      !dashboardViewSource.includes('DashboardTopBannerDock') &&
      !dashboardViewSource.includes('fixed left-1/2 -translate-x-1/2') &&
      dashboardViewSource.includes('open-strategy-settings'),
      'DashboardView must not duplicate top banners separately from PersistentAlertBanner and must listen for open-strategy-settings'
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

    // 1. Unified single narrow top slide-down notification strip
    assert.ok(
      alertBannerSource.includes('data-banner-style="top-slide-strip"') &&
      alertBannerSource.includes('data-banner-unified="single-strip"') &&
      alertBannerSource.includes('handleCycleNotice') &&
      !dashboardViewSource.includes('DashboardTopBannerDock'),
      'All connection, ban, agreement, and gate banners must live inside one unified top-slide-strip'
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
      alertBannerSource.includes('min-w-[16ch]') &&
      alertBannerSource.includes('min-w-[4.5ch]'),
      'Trade duration, exit delay, ban cooldown, and gate countdowns must zero-pad and reserve fixed widths to prevent CLS'
    );
  });

  test('Selective element skeletons preserve static labels and Live|Paper EngineSwitch while eliminating Resuming Feed blur overlays', () => {
    const skeletonsSource = fs.readFileSync(path.join(__dirname, '../components/ui/Skeletons.jsx'), 'utf-8');
    const engineSwitchSource = fs.readFileSync(path.join(__dirname, '../components/EngineSwitch.jsx'), 'utf-8');
    const activeTradeCardSource = fs.readFileSync(path.join(__dirname, '../components/ActiveTradeCard.jsx'), 'utf-8');

    // 1. EngineSwitch keeps hooks strictly above early return and renders in both DashboardView & DashboardSkeleton
    assert.ok(
      engineSwitchSource.indexOf('useEffect(') !== -1 &&
      engineSwitchSource.indexOf('useEffect(') < engineSwitchSource.indexOf('if (!selectedEngine) return null'),
      'EngineSwitch must invoke all React hooks before any conditional early return'
    );
    assert.ok(
      dashboardViewSource.includes("import { EngineSwitch } from '../components/EngineSwitch'") &&
      skeletonsSource.includes("import { EngineSwitch } from '../EngineSwitch'") &&
      skeletonsSource.includes('<EngineSwitch running={null} />'),
      'Live|Paper EngineSwitch must stay rendered and interactive inside DashboardView and DashboardSkeleton'
    );

    // 2. Route skeletons preserve static titles and labels instead of replacing them with blank shimmer bars
    for (const staticLabel of [
      'Overview',
      'Account Balance',
      'Active Positions',
      'Trade History',
      'System Settings',
    ]) {
      assert.ok(
        skeletonsSource.includes(staticLabel),
        `Skeletons.jsx must preserve static UI text "${staticLabel}" instead of placeholder-shimmering static labels`
      );
    }

    // 3. StatCard supports valueLoading/subValueLoading without full-card bg-accent/5 animate-pulse wash
    assert.ok(
      primitivesSource.includes('valueLoading = false') &&
      primitivesSource.includes('subValueLoading = false'),
      'StatCard must accept valueLoading and subValueLoading props'
    );
    const statCardSection = primitivesSource.slice(
      primitivesSource.indexOf('export const StatCard'),
      primitivesSource.indexOf('// --- Section Label ---')
    );
    assert.ok(
      !statCardSection.includes('bg-accent/5 animate-pulse'),
      'StatCard must not overlay full-card bg-accent/5 animate-pulse wash during sync'
    );

    // 4. ActiveTradeCard and DashboardView omit blocking Resuming Feed blur overlays
    assert.ok(
      !activeTradeCardSource.includes('Resuming Feed...') &&
      !dashboardViewSource.includes('Resuming Feed...') &&
      !activeTradeCardSource.includes('backdrop-blur-[1px]'),
      'ActiveTradeCard and DashboardView StrategyCard must not cover cards with Resuming Feed backdrop-blur overlays'
    );
  });

  test('Smooth compositor motion primitives, LayoutGroup, MotionConfig, and SmoothCollapse zero-CLS contracts are enforced', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.jsx'), 'utf-8');
    const smoothMotionSource = fs.readFileSync(path.join(__dirname, '../components/ui/SmoothMotion.jsx'), 'utf-8');
    const navigationSource = fs.readFileSync(path.join(__dirname, '../components/Navigation.jsx'), 'utf-8');
    const engineSwitchSource = fs.readFileSync(path.join(__dirname, '../components/EngineSwitch.jsx'), 'utf-8');
    const alertBannerSource = fs.readFileSync(path.join(__dirname, '../components/PersistentAlertBanner.jsx'), 'utf-8');
    const tradesViewSource = fs.readFileSync(path.join(__dirname, '../views/TradesView.jsx'), 'utf-8');
    const analyticsSource = fs.readFileSync(path.join(__dirname, '../components/Analytics.jsx'), 'utf-8');
    const historyViewSource = fs.readFileSync(path.join(__dirname, '../views/HistoryView.jsx'), 'utf-8');
    const settingsViewSource = fs.readFileSync(path.join(__dirname, '../views/SettingsView.jsx'), 'utf-8');
    const configModalSource = fs.readFileSync(path.join(__dirname, '../components/ConfigModal.jsx'), 'utf-8');
    const activeSummarySource = fs.readFileSync(path.join(__dirname, '../components/config/ActiveSummaryPanel.jsx'), 'utf-8');
    const backtestPanelSource = fs.readFileSync(path.join(__dirname, '../components/BacktestPanel.jsx'), 'utf-8');
    const tradeDetailModalSource = fs.readFileSync(path.join(__dirname, '../components/TradeDetailModal.jsx'), 'utf-8');

    // 1. Global accessibility & shared layout group root wrappers
    assert.ok(
      mainSource.includes('<MotionConfig reducedMotion="user">') &&
      mainSource.includes('<LayoutGroup id="momentum-cockpit-motion">'),
      'main.jsx must wrap the shell in MotionConfig reducedMotion="user" and a shared LayoutGroup'
    );

    // 2. SmoothMotion enforces geometry containment & outExpo / glide curves
    assert.ok(
      smoothMotionSource.includes('[contain:layout_style]') &&
      smoothMotionSource.includes('export const MOTION_EASE') &&
      smoothMotionSource.includes('export const MotionSegmentedPill'),
      'SmoothMotion.jsx must contain layout geometry and export MOTION_EASE + MotionSegmentedPill'
    );

    // 3. SmoothCollapse handles dynamic drawers/panels without abrupt height snaps
    for (const [label, src] of [
      ['DashboardView', dashboardViewSource],
      ['HistoryView', historyViewSource],
      ['PersistentAlertBanner', alertBannerSource],
      ['ConfigModal', configModalSource],
      ['ActiveSummaryPanel', activeSummarySource],
      ['BacktestPanel', backtestPanelSource],
    ]) {
      assert.ok(
        src.includes('<SmoothCollapse'),
        `${label} must use <SmoothCollapse> for collapsible drawers/panels to prevent layout snapping`
      );
    }

    // 4. MotionSegmentedPill drives active indicators across navigation & filters
    for (const [label, src] of [
      ['Navigation', navigationSource],
      ['EngineSwitch', engineSwitchSource],
      ['DashboardView', dashboardViewSource],
      ['TradesView', tradesViewSource],
      ['Analytics', analyticsSource],
      ['HistoryView', historyViewSource],
      ['SettingsView', settingsViewSource],
      ['ConfigModal', configModalSource],
      ['BacktestPanel', backtestPanelSource],
    ]) {
      assert.ok(
        src.includes('<MotionSegmentedPill'),
        `${label} must render <MotionSegmentedPill> for silky segmented/tab indicator transitions`
      );
    }

    // 5. Sidebar fixes icon column width (w-12 inside p-4 -> 80px collapsed) so icons never jump horizontally
    assert.ok(
      navigationSource.includes('w-12 h-10 shrink-0') &&
      !tradeDetailModalSource.includes('Resuming Feed...'),
      'Sidebar must stabilize icon geometry across collapse and TradeDetailModal must not swap out metadata for Resuming Feed...'
    );
  });

  test('Uniform compact ViewHeader & Skeleton Row 1/Row 2 geometry, non-overlapping alert ticker, and slim connection slide strip', () => {
    const skeletonsSource = fs.readFileSync(path.join(__dirname, '../components/ui/Skeletons.jsx'), 'utf-8');
    const mainSource = fs.readFileSync(path.join(__dirname, '../main.jsx'), 'utf-8');
    const smoothMotionSource = fs.readFileSync(path.join(__dirname, '../components/ui/SmoothMotion.jsx'), 'utf-8');
    const tradeDetailSource = fs.readFileSync(path.join(__dirname, '../views/TradeDetailView.jsx'), 'utf-8');
    const indexHtmlSource = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf-8');
    const alertBannerSource = fs.readFileSync(path.join(__dirname, '../components/PersistentAlertBanner.jsx'), 'utf-8');
    const engineSwitchSource = fs.readFileSync(path.join(__dirname, '../components/EngineSwitch.jsx'), 'utf-8');

    // ViewHeader locks compact Row 1 & Row 2 uniformly
    assert.ok(
      primitivesSource.includes('sm:min-h-[34px] sm:h-[34px]') &&
      primitivesSource.includes('h-[26px] sm:h-[28px]') &&
      primitivesSource.includes('h-[22px] min-h-[22px] w-full') &&
      tradeDetailSource.includes('mobileOneRow'),
      'ViewHeader and all views must lock compact Row 1 and Row 2 heights consistently across mobile and desktop'
    );

    // AlertLogBar moved out of Row 2 onto the Live/Paper switch row (and fills full width when EngineSwitch isn't rendered)
    assert.ok(
      primitivesSource.includes('export const AlertLogBar =') &&
      primitivesSource.includes('!hideAlertBar && !hideMetrics') &&
      primitivesSource.includes('shrink-0 min-w-0 max-w-full') &&
      primitivesSource.includes('!backAction ? "flex" : "hidden sm:flex"') &&
      dashboardViewSource.includes('hideAlertBar={true}') &&
      dashboardViewSource.includes('data-switch-alert-row') &&
      dashboardViewSource.includes('<AlertLogBar className={selectedEngine ? "flex-1 min-w-0" : "w-full min-w-0"} />'),
      'AlertLogBar must render on the Live/Paper EngineSwitch row (full width when switch is absent) and stay cleanly outside ViewHeader Row 2'
    );

    // Slim connection slide bar and compact EngineSwitch
    assert.ok(
      alertBannerSource.includes('min-h-[28px] py-0.5') &&
      alertBannerSource.includes('h-[1.5px]') &&
      engineSwitchSource.includes('min-h-[26px] min-w-[66px]'),
      'PersistentAlertBanner must stay sleek/slim (min-h-[28px] py-0.5) and EngineSwitch must use compact 26px tabs'
    );

    // Skeletons render matching ViewHeader Row 1 + Row 2 chrome via ViewHeaderSkeleton
    assert.ok(
      skeletonsSource.includes('const ViewHeaderSkeleton =') &&
      skeletonsSource.includes('h-[26px] sm:h-[28px] mb-1.5 lg:mb-2') &&
      skeletonsSource.includes("readSkeletonPref('global_metrics_expanded'"),
      'Skeletons.jsx must render matching compact ViewHeader Row 1 + Row 2 chrome and respect persisted expand/view-mode prefs'
    );

    // main.jsx uses constant top padding (no conditional pt-1 paper-mode layout shift)
    assert.ok(
      mainSource.includes('pt-[3px]') &&
      !mainSource.includes("${tradingMode === 'paper' ? 'pt-1' : ''}"),
      'main.jsx must maintain fixed top padding across paper/live/testnet mode hydration'
    );

    // SmoothSwap skips initial vertical slide on mount and DashboardView cards omit y: 5 jump
    assert.ok(
      smoothMotionSource.includes('isInitialMountRef') &&
      smoothMotionSource.includes('initial={skipInitialAnim ? false :') &&
      !dashboardViewSource.includes('initial={{ opacity: 0, y: 5 }}'),
      'SmoothSwap and DashboardView strategy card grid must skip initial-mount vertical y-offset jitter'
    );

    // Boot shell mirrors two-row header + responsive KPI grid
    assert.ok(
      indexHtmlSource.includes('boot-h1') &&
      indexHtmlSource.includes('boot-h2') &&
      indexHtmlSource.includes('boot-kpis'),
      'index.html boot-shell must mirror two-row header and responsive KPI strip geometry'
    );
  });

  test('TradeDetailModal and TradeDetailContent enforce horizontal overflow containment on mobile and desktop', () => {
    const tradeDetailModalSource = fs.readFileSync(path.join(__dirname, '../components/TradeDetailModal.jsx'), 'utf-8');
    const tradeDetailContentSource = fs.readFileSync(path.join(__dirname, '../components/trade/TradeDetailContent.jsx'), 'utf-8');

    assert.ok(
      tradeDetailModalSource.includes('w-full max-w-full') &&
      tradeDetailModalSource.includes('overflow-y-auto overflow-x-hidden') &&
      tradeDetailModalSource.includes('min-w-0 flex-1'),
      'TradeDetailModal must constrain drawer and scrollable viewport horizontally with overflow-x-hidden and min-w-0'
    );

    assert.ok(
      tradeDetailContentSource.includes('w-full min-w-0 overflow-x-hidden') &&
      tradeDetailContentSource.includes('overflow-x-clip') &&
      tradeDetailContentSource.includes('translate-x-0 items-start') &&
      tradeDetailContentSource.includes('-translate-x-full items-end') &&
      tradeDetailContentSource.includes('grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]'),
      'TradeDetailContent must prevent horizontal overflow in root layout, price runway markers, and inline guard/ladder editors'
    );
  });

  test('UI chrome elements stay steady across transient OS wakeup and WS reconnect transitions', () => {
    const delayedHookSource = fs.readFileSync(path.join(__dirname, '../hooks/useDelayedActive.js'), 'utf-8');
    const tradeDetailModalSource = fs.readFileSync(path.join(__dirname, '../components/TradeDetailModal.jsx'), 'utf-8');
    const tradesViewSource = fs.readFileSync(path.join(__dirname, '../views/TradesView.jsx'), 'utf-8');
    const systemMetricsSource = fs.readFileSync(path.join(__dirname, '../components/SystemMetrics.jsx'), 'utf-8');
    const alertBannerSource = fs.readFileSync(path.join(__dirname, '../components/PersistentAlertBanner.jsx'), 'utf-8');
    const engineSwitchSource = fs.readFileSync(path.join(__dirname, '../components/EngineSwitch.jsx'), 'utf-8');
    const apiClientSource = fs.readFileSync(path.join(__dirname, '../api/client.js'), 'utf-8');

    const activeTradeBarSource = fs.readFileSync(path.join(__dirname, '../components/ActiveTradeBar.jsx'), 'utf-8');
    const scannerOverlaySource = fs.readFileSync(path.join(__dirname, '../components/ScannerOverlay.jsx'), 'utf-8');

    assert.ok(
      delayedHookSource.includes('export function useDelayedActive') &&
      primitivesSource.includes('useDelayedActive') &&
      tradeDetailModalSource.includes('useDelayedActive') &&
      systemMetricsSource.includes('useDelayedActive') &&
      alertBannerSource.includes('useDelayedActive') &&
      activeTradeBarSource.includes('useDelayedActive') &&
      scannerOverlaySource.includes('useDelayedActive'),
      'EcoBadge, ViewHeader, TradeDetailModal, SystemMetrics, PersistentAlertBanner, ActiveTradeBar, and ScannerOverlay must debounce transient resume/reconnect visual chrome with useDelayedActive'
    );

    assert.ok(
      !dashboardViewSource.includes('paused && !isResuming') &&
      !dashboardViewSource.includes('isGated && !paused && !isResuming') &&
      !dashboardViewSource.includes('isResuming && "border-accent/25"') &&
      !tradesViewSource.includes('(!initialStatusLoaded || (sessionActive && isResuming))'),
      'StrategyCard status badges, card borders, and TradesView empty states must not flash/unmount on transient resume'
    );

    assert.ok(
      engineSwitchSource.includes('setOtherRunning(prev => (cached !== null ? cached : prev))') &&
      apiClientSource.includes('_suppressGlobalApiError') &&
      apiClientSource.includes('axios.isCancel(error)'),
      'EngineSwitch and API client must ignore canceled/background polling failures during wakeup so dots and alerts do not flicker'
    );
  });
});

