import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('SettingsView handleValidate catch block handles errors correctly', () => {
  const settingsViewPath = path.join(__dirname, '../views/SettingsView.jsx');
  const code = fs.readFileSync(settingsViewPath, 'utf-8');

  // Verify the catch block structure in handleValidate
  assert.ok(
    code.includes('} catch (e) {'),
    'SettingsView must have a catch block'
  );

  assert.ok(
    code.includes("setValidationResults({"),
    'SettingsView must call setValidationResults in the catch block'
  );

  assert.ok(
    code.includes("valid: false,"),
    'SettingsView catch block must set valid to false'
  );

  assert.ok(
    code.includes("checks: [{"),
    'SettingsView catch block must set checks array'
  );

  assert.ok(
    code.includes("type: 'error',"),
    'SettingsView catch block checks must have type error'
  );

  assert.ok(
    code.includes("status: 'error',"),
    'SettingsView catch block checks must have status error'
  );

  assert.ok(
    code.includes("message: `Validation request failed: ${e.message || 'Unknown error'}`"),
    'SettingsView catch block checks must include correct fallback error message string template'
  );

  assert.ok(
    code.includes("console.error('Validation failed', e)"),
    'SettingsView must log the error to the console'
  );
});
