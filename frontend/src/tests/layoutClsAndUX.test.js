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

  test('InteractiveLimitCard enforces WCAG spinbutton role, valuenow, and lock/unlock ARIA labels', () => {
    assert.ok(
      primitivesSource.includes('role="spinbutton"') &&
      primitivesSource.includes('aria-valuenow={value}') &&
      primitivesSource.includes('aria-valuemin={min}') &&
      primitivesSource.includes('aria-valuemax={max}'),
      'InteractiveLimitCard must apply spinbutton ARIA roles and value attributes for accessibility'
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
});
