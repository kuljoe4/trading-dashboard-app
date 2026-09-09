import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('ViewHeader Ultra-High-Density Auto-Collapsing Header Verification', () => {
  const primitivesPath = path.resolve(process.cwd(), 'frontend/src/components/ui/primitives.jsx');
  const primitivesCode = fs.readFileSync(primitivesPath, 'utf8');

  // Verify ViewHeader supports scroll detection and auto-collapsing
  assert.ok(primitivesCode.includes('isScrolled'), 'ViewHeader must track isScrolled state');
  assert.ok(primitivesCode.includes('addEventListener(\'scroll\''), 'ViewHeader must attach scroll listener');
  assert.ok(primitivesCode.includes('role="region"'), 'ViewHeader must enforce role="region" accessibility attribute');
  assert.ok(primitivesCode.includes('tabIndex={0}'), 'ViewHeader must enforce tabIndex={0} keyboard focusability');
  assert.ok(primitivesCode.includes('aria-label='), 'ViewHeader must enforce dynamic aria-label detailing collapsed state');
});
