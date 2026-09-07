import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Navigation buttons include explicit type="button", cursor-pointer, focus rings, and dynamic ARIA labels', () => {
  const filePath = path.join(process.cwd(), 'frontend/src/components/Navigation.jsx');
  const fileContent = fs.readFileSync(filePath, 'utf8');

  // Verify type="button" presence on interactive controls
  assert.match(fileContent, /type="button"/, 'Navigation should declare type="button" on controls');

  // Verify cursor-pointer presence
  assert.match(fileContent, /cursor-pointer/, 'Navigation should specify cursor-pointer styling');

  // Verify focus-visible ring styles
  assert.match(fileContent, /focus-visible:ring-2/, 'Navigation should include focus-visible rings');
  assert.match(fileContent, /focus-visible:ring-accent/, 'Navigation focus ring should use accent color');

  // Verify dynamic ARIA labels for active trades context
  assert.match(fileContent, /active position/, 'Navigation should include dynamic active position context in ARIA labels');
  assert.match(fileContent, /aria-current=\{isActive\(item\.path\)\ \?\ 'page'\ \:\ undefined\}/, 'Navigation should set aria-current="page" on active route');
});
