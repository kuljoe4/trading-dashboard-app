import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MonthlyRevenueChart Periodic PnL Tooltip & Micro-UX Standard', () => {
  const dashboardViewPath = path.join(__dirname, '../views/DashboardView.jsx');
  const dashboardViewSource = fs.readFileSync(dashboardViewPath, 'utf-8');

  test('MonthlyRevenueChart wraps bar canvas items in Radix Tooltip with Portal to prevent clipping', () => {
    assert.ok(
      dashboardViewSource.includes('<Tooltip') &&
      dashboardViewSource.includes('key={b.id}') &&
      dashboardViewSource.includes('content={tooltipCard}'),
      'MonthlyRevenueChart bar items must be wrapped in Radix Tooltip component to avoid clipping at overflow bounds'
    );
  });

  test('MonthlyRevenueChart renders Active Selected Period Detail Banner above canvas', () => {
    assert.ok(
      dashboardViewSource.includes('Active Selected Period Detail Banner'),
      'MonthlyRevenueChart must render an active period banner showing selected period breakdown'
    );
    assert.ok(
      dashboardViewSource.includes('hoveredIndex !== null && buckets[hoveredIndex]'),
      'MonthlyRevenueChart must display active details when a period bar is hovered or clicked'
    );
  });

  test('MonthlyRevenueChart bar item includes WCAG region role, tabIndex={0}, and aria-label', () => {
    assert.ok(
      dashboardViewSource.includes('tabIndex={0}') &&
      dashboardViewSource.includes('role="region"') &&
      dashboardViewSource.includes('aria-label='),
      'MonthlyRevenueChart bar items must enforce accessibility standards for keyboard and screen reader navigation'
    );
  });
});
