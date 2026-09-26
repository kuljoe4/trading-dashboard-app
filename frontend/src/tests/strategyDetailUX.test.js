import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('StrategyDetailView Collapsible Section Accessibility', () => {
  const strategyDetailViewPath = path.join(__dirname, '../views/StrategyDetailView.jsx');
  const sourceCode = fs.readFileSync(strategyDetailViewPath, 'utf-8');

  test('Daily Calendar Breakdown button specifies aria-expanded={isCalendarOpen} and dynamic aria-label', () => {
    assert.ok(
      sourceCode.includes('aria-expanded={isCalendarOpen}'),
      'Daily Calendar Breakdown toggle button must specify aria-expanded={isCalendarOpen}'
    );
    assert.ok(
      sourceCode.includes('aria-label={isCalendarOpen ? "Collapse daily calendar breakdown" : "Expand daily calendar breakdown"}'),
      'Daily Calendar Breakdown toggle button must specify dynamic state-aware aria-label'
    );
  });

  test('Technical Signal Checklist button specifies aria-expanded={isChecklistOpen} and dynamic aria-label', () => {
    assert.ok(
      sourceCode.includes('aria-expanded={isChecklistOpen}'),
      'Technical Signal Checklist toggle button must specify aria-expanded={isChecklistOpen}'
    );
    assert.ok(
      sourceCode.includes('aria-label={isChecklistOpen ? `Collapse technical signal checklist for ${bestOpp.symbol}` : `Expand technical signal checklist for ${bestOpp.symbol}`}'),
      'Technical Signal Checklist toggle button must specify dynamic state-aware aria-label including symbol context'
    );
  });
});
