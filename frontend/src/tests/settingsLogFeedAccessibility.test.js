import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('SettingsView Backend Log Feed buttons enforce aria-pressed, aria-label, and Tooltip wrapping', () => {
  const filePath = path.resolve('frontend/src/views/SettingsView.jsx');
  const fileContent = fs.readFileSync(filePath, 'utf8');

  // Verify safe log filter check
  assert.strictEqual(
    fileContent.includes("const safeLogFilters = logFilters && typeof logFilters === 'object' ? logFilters : { info: true, warn: true, error: true }"),
    true,
    'SettingsView must perform defensive safe log filter evaluation'
  );

  // Verify aria-pressed attribute usage
  assert.strictEqual(
    fileContent.includes('aria-pressed={enabled}'),
    true,
    'Backend Log Feed filter buttons must specify aria-pressed attribute'
  );

  // Verify dynamic aria-label attribute usage
  assert.strictEqual(
    fileContent.includes('aria-label={`Toggle ${label} logs (${enabled ? \'Enabled\' : \'Disabled\'})`}'),
    true,
    'Backend Log Feed filter buttons must specify dynamic aria-label attribute'
  );

  // Verify Tooltip content description
  assert.strictEqual(
    fileContent.includes('content={`Click to ${enabled ? \'disable\' : \'enable\'} ${label.toLowerCase()} level logs in the live dashboard feed`}'),
    true,
    'Backend Log Feed filter buttons must be wrapped in descriptive Tooltips'
  );
});
