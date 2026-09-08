import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('View Mode Switch Standard - DashboardView and Analytics remove FLIP stretch', () => {
  const dashboardPath = path.join(process.cwd(), 'frontend/src/views/DashboardView.jsx');
  const analyticsPath = path.join(process.cwd(), 'frontend/src/components/Analytics.jsx');
  const detailPath = path.join(process.cwd(), 'frontend/src/views/StrategyDetailView.jsx');

  const dashboardCode = fs.readFileSync(dashboardPath, 'utf8');
  const analyticsCode = fs.readFileSync(analyticsPath, 'utf8');
  const detailCode = fs.readFileSync(detailPath, 'utf8');

  // StrategyCard does not use FLIP layout stretching
  assert.equal(dashboardCode.includes('<motion.div\n        layout\n        transition={{ type: "spring", stiffness: 500, damping: 30 }}'), false, 'StrategyCard should not use FLIP layout stretching');

  // Dashboard cardViewMode controls use WCAG tablist/tab roles
  assert.equal(dashboardCode.includes('role="tablist" aria-label="Strategy card view mode selection"'), true, 'Dashboard cardViewMode switcher should have tablist role');
  assert.equal(dashboardCode.includes('id="active-strategy-cards-container"'), true, 'Dashboard card container should have active-strategy-cards-container ID');

  // Analytics StrategyCalendarPnL viewMode controls use WCAG tablist/tab roles and AnimatePresence mode="wait"
  assert.equal(analyticsCode.includes('role="tablist" aria-label="Strategy calendar view mode selection"'), true, 'Analytics viewMode switcher should have tablist role');
  assert.equal(analyticsCode.includes('id="strategy-calendar-view-container"'), true, 'Analytics container should have strategy-calendar-view-container ID');

  // StrategyDetailView root does not use layout prop
  assert.equal(detailCode.includes('<motion.div\n      layout'), false, 'StrategyDetailView root should not use layout attribute');
});
