import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('TradesView filter toolbar features ultra-dense mobile-optimized chip groups, aria-pressed attributes, and reset button', () => {
  const p1 = path.join(process.cwd(), 'src/views/TradesView.jsx');
  const p2 = path.join(process.cwd(), 'src/views/TradesView.jsx');
  const filePath = fs.existsSync(p1) ? p1 : p2;
  const fileContent = fs.readFileSync(filePath, 'utf8');

  // Verify ultra-dense filter toolbar element
  assert.match(fileContent, /id="active-trades-filter-toolbar"/, 'TradesView should render ultra-dense filter toolbar container');

  // Verify strategy, direction, and risk filter chip groups with WCAG aria-pressed state
  assert.match(fileContent, /aria-pressed=\{strategyFilter === 'ALL'\}/, 'TradesView strategy filter should enforce aria-pressed state');
  assert.match(fileContent, /aria-pressed=\{directionFilter === d\}/, 'TradesView direction filter should enforce aria-pressed state');
  assert.match(fileContent, /aria-pressed=\{riskFilter === r\.id\}/, 'TradesView risk filter should enforce aria-pressed state');

  // Verify type="button", focus ring, and cursor-pointer on filter triggers
  assert.match(fileContent, /type="button"/, 'TradesView filter buttons should specify type="button"');
  assert.match(fileContent, /focus-visible:ring-accent/, 'TradesView filter buttons should specify focus-visible rings');
  assert.match(fileContent, /cursor-pointer/, 'TradesView filter buttons should specify cursor-pointer');

  // Verify reset filters button functionality and Tooltip wrapper
  assert.match(fileContent, /resetAllFilters/, 'TradesView should feature a resetAllFilters handler for active filters');
  assert.match(fileContent, /<Tooltip content="Reset position filters">/, 'TradesView reset filters button should be wrapped in Tooltip');
});
