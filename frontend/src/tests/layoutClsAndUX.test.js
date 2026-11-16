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
});
