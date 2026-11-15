import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('ViewHeader Ultra-High-Density Auto-Collapsing Header Verification', () => {
  const primitivesPath = path.resolve(__dirname, '../components/ui/primitives.jsx');
  const primitivesCode = fs.readFileSync(primitivesPath, 'utf8');

  // Verify ViewHeader supports scroll detection and auto-collapsing
  assert.ok(primitivesCode.includes('isScrolled'), 'ViewHeader must track isScrolled state');
  assert.ok(primitivesCode.includes('addEventListener(\'scroll\''), 'ViewHeader must attach scroll listener');
  assert.ok(primitivesCode.includes('role="region"'), 'ViewHeader must enforce role="region" accessibility attribute');
  assert.ok(primitivesCode.includes('tabIndex={0}'), 'ViewHeader must enforce tabIndex={0} keyboard focusability');
  assert.ok(primitivesCode.includes('aria-label='), 'ViewHeader must enforce dynamic aria-label detailing collapsed state');
  assert.ok(primitivesCode.includes('[overflow-anchor:none]'), 'ViewHeader must disable scroll anchoring to prevent sticky oscillation');
  assert.ok(primitivesCode.includes('hasSplitStickyMetrics'), 'ViewHeader must render Row 2 outside sticky container to avoid layout height shifts on scroll');
  assert.ok(!primitivesCode.includes('isScrolled ? "max-h-0'), 'ViewHeader must not animate max-height to 0 inside sticky flow');
});
