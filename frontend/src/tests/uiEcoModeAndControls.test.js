import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('UI Eco Mode & Non-Redundant Performance Controls Unit Tests', async (t) => {
  await t.test('SettingsView includes uiEcoMode store selector and toggle switch', () => {
    const settingsPath = path.resolve(__dirname, '../views/SettingsView.jsx');
    const code = fs.readFileSync(settingsPath, 'utf8');
    assert.ok(code.includes('uiEcoMode'));
  });
});
