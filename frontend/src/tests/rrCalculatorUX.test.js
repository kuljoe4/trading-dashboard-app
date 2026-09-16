import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('RrWinRateCalculator header accessibility & WCAG keyboard standard', () => {
  const historyViewPath = path.join(__dirname, '../views/HistoryView.jsx');
  const code = fs.readFileSync(historyViewPath, 'utf-8');

  // Verify RrWinRateCalculator header trigger includes role="button"
  assert.ok(
    code.includes('role="button"'),
    'RrWinRateCalculator header trigger must specify role="button"'
  );

  // Verify tabIndex={0}
  assert.ok(
    code.includes('tabIndex={0}'),
    'RrWinRateCalculator header trigger must specify tabIndex={0}'
  );

  // Verify aria-expanded
  assert.ok(
    code.includes('aria-expanded={isExpanded}'),
    'RrWinRateCalculator header trigger must specify aria-expanded={isExpanded}'
  );

  // Verify dynamic aria-label
  assert.ok(
    code.includes("aria-label={isExpanded ? 'Collapse predictive RR target calculator' : 'Expand predictive RR target calculator'}"),
    'RrWinRateCalculator header trigger must specify dynamic aria-label describing expand/collapse state'
  );

  // Verify onKeyDown handler for Enter and Space
  assert.ok(
    code.includes("if (e.key === 'Enter' || e.key === ' ')"),
    'RrWinRateCalculator header trigger must handle Enter and Space keyboard activation'
  );

  // Verify focus-visible ring styles
  assert.ok(
    code.includes('focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'),
    'RrWinRateCalculator header trigger must enforce high-contrast focus-visible ring styles'
  );
});
