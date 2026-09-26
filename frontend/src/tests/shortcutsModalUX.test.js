import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('ShortcutsModal Accessibility & Dialog Title/Description Linking Standard', () => {
  const filePath = path.join(process.cwd(), 'src/components/ShortcutsModal.jsx');
  const fileContent = fs.readFileSync(filePath, 'utf8');

  // Verify Dialog.Content aria attributes match VisuallyHidden ids
  assert.ok(fileContent.includes('aria-labelledby="shortcuts-title"'), 'ShortcutsModal Dialog.Content must include aria-labelledby="shortcuts-title"');
  assert.ok(fileContent.includes('aria-describedby="shortcuts-description"'), 'ShortcutsModal Dialog.Content must include aria-describedby="shortcuts-description"');

  assert.ok(fileContent.includes('id="shortcuts-title"'), 'VisuallyHidden title element must declare id="shortcuts-title"');
  assert.ok(fileContent.includes('id="shortcuts-description"'), 'VisuallyHidden description element must declare id="shortcuts-description"');

  // Verify interactive shortcut buttons have explicit type="button", aria-labels, and focus-visible rings
  assert.ok(fileContent.includes('type="button"'), 'Interactive controls must have explicit type="button"');
  assert.ok(fileContent.includes('aria-label='), 'Shortcut items must have explicit aria-label descriptions');
  assert.ok(fileContent.includes('focus-visible:ring-2'), 'Interactive shortcut buttons must feature focus-visible focus rings');
  assert.ok(fileContent.includes('cursor-pointer'), 'Interactive shortcut buttons must include cursor-pointer');
});
