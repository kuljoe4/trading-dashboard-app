import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('TradesView search input includes ref-based focus recovery, clear button with Tooltip, focus rings, and shortcut hint', () => {
  const p1 = path.join(process.cwd(), 'frontend/src/views/TradesView.jsx');
  const p2 = path.join(process.cwd(), 'src/views/TradesView.jsx');
  const filePath = fs.existsSync(p1) ? p1 : p2;
  const fileContent = fs.readFileSync(filePath, 'utf8');

  // Verify ref attachment to search input
  assert.match(fileContent, /ref=\{searchInputRef\}/, 'TradesView search input should attach searchInputRef');

  // Verify type="button", cursor-pointer, and focus ring styling on clear search button
  assert.match(fileContent, /type="button"/, 'TradesView clear button should specify type="button"');
  assert.match(fileContent, /aria-label="Clear active positions search"/, 'TradesView clear button should specify descriptive ARIA label');
  assert.match(fileContent, /focus-visible:ring-accent/, 'TradesView clear button should specify accent focus-visible ring');
  assert.match(fileContent, /cursor-pointer/, 'TradesView clear button should specify cursor-pointer');

  // Verify focus recovery on clear
  assert.match(fileContent, /searchInputRef\.current\?\.focus\(\)/, 'TradesView clear handler should programmatically restore focus to search input');

  // Verify global '/' hotkey listener and inline <kbd> badge
  assert.match(fileContent, /e\.key === '\/'/, 'TradesView should listen for slash hotkey');
  assert.match(fileContent, /<kbd/, 'TradesView should render kbd badge when search query is empty');
});
