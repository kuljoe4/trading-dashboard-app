import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('SettingsView Hibernation Mode buttons enforce aria-pressed, aria-label, and cursor-pointer', () => {
  const filePath = path.resolve('frontend/src/views/SettingsView.jsx');
  const fileContent = fs.readFileSync(filePath, 'utf8');

  // Verify isActive evaluation
  assert.strictEqual(
    fileContent.includes("const isActive = (cfg.hibernation_mode || 'adaptive') === mode.id;"),
    true,
    'SettingsView must evaluate isActive for hibernation mode buttons'
  );

  // Verify aria-pressed attribute usage
  assert.strictEqual(
    fileContent.includes('aria-pressed={isActive}'),
    true,
    'Hibernation mode buttons must specify aria-pressed attribute'
  );

  // Verify dynamic aria-label attribute usage
  assert.strictEqual(
    fileContent.includes('aria-label={`Select ${mode.label} hibernation mode`}'),
    true,
    'Hibernation mode buttons must specify dynamic aria-label attribute'
  );

  // Verify cursor-pointer class usage
  assert.strictEqual(
    fileContent.includes('cursor-pointer'),
    true,
    'Hibernation mode buttons must include cursor-pointer'
  );
});
