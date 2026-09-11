import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('HistoryView Filter Toolbar non-sticky and collapsible UX standard', () => {
  const historyViewPath = path.join(__dirname, '../views/HistoryView.jsx');
  const code = fs.readFileSync(historyViewPath, 'utf-8');

  // Verify sticky class is removed from the history filter toolbar container
  assert.ok(
    code.includes('id="history-filter-toolbar"'),
    'HistoryView must include id="history-filter-toolbar" container'
  );
  assert.ok(
    !code.includes('sticky top-[64px] z-40 bg-background/95 backdrop-blur-md border border-border/30 rounded-2xl p-2.5 mb-6 shadow-md flex flex-col sm:flex-row'),
    'HistoryView filter toolbar must NOT use sticky positioning that blocks content below when scrolling'
  );

  // Verify top strategy filter row is removed from header
  assert.ok(
    !code.includes('Strategy Filter:'),
    'HistoryView top header strategy filter row must be removed'
  );

  // Verify collapsible state and accessibility
  assert.ok(
    code.includes('const [filtersExpanded, setFiltersExpanded] = useState'),
    'HistoryView must include filtersExpanded state'
  );
  assert.ok(
    code.includes('aria-expanded={filtersExpanded}'),
    'Filter collapse button must specify aria-expanded'
  );
  assert.ok(
    code.includes('aria-label={filtersExpanded ? "Collapse advanced history filters" : "Expand advanced history filters"}'),
    'Filter collapse button must specify dynamic aria-label'
  );
});
