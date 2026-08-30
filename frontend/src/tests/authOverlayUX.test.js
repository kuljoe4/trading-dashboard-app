import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('AuthOverlay Micro-UX & Accessibility Standard', () => {
  const overlayFilePath = path.join(__dirname, '../components/AuthOverlay.jsx');
  const sourceCode = fs.readFileSync(overlayFilePath, 'utf-8');

  test('includes dialog ARIA attributes role="dialog", aria-modal, aria-labelledby, and aria-describedby', () => {
    assert.ok(sourceCode.includes('role="dialog"'), 'Must specify role="dialog"');
    assert.ok(sourceCode.includes('aria-modal="true"'), 'Must specify aria-modal="true"');
    assert.ok(sourceCode.includes('aria-labelledby="auth-title"'), 'Must link dialog title via aria-labelledby');
    assert.ok(sourceCode.includes('aria-describedby="auth-description"'), 'Must link dialog description via aria-describedby');
    assert.ok(sourceCode.includes('id="auth-title"'), 'Must specify title ID matching aria-labelledby');
    assert.ok(sourceCode.includes('id="auth-description"'), 'Must specify description ID matching aria-describedby');
  });

  test('includes accessible input label and ARIA attributes for password field', () => {
    assert.ok(sourceCode.includes('id="admin-api-key"'), 'Input must have id="admin-api-key"');
    assert.ok(sourceCode.includes('<label htmlFor="admin-api-key" className="sr-only">Admin API Key</label>'), 'Must provide sr-only label');
    assert.ok(sourceCode.includes('aria-label="Admin API Key"'), 'Input must specify aria-label="Admin API Key"');
  });

  test('provides show/hide password visibility toggle with Tooltip and focus-visible rings', () => {
    assert.ok(sourceCode.includes('type={showKey ? \'text\' : \'password\'}'), 'Input type must toggle based on showKey state');
    assert.ok(sourceCode.includes('aria-label={showKey ? "Hide API key" : "Show API key"}'), 'Toggle button must provide dynamic aria-label');
    assert.ok(sourceCode.includes('focus-visible:ring-2 focus-visible:ring-accent'), 'Toggle button must apply focus-visible ring');
  });

  test('provides clear input button with focus-visible ring and focus recovery', () => {
    assert.ok(sourceCode.includes('aria-label="Clear input"'), 'Clear button must include accessible aria-label');
    assert.ok(sourceCode.includes('inputRef.current?.focus()'), 'Clear button must restore focus to inputRef');
  });

  test('enforces submit button disabled affordance and cursor styling', () => {
    assert.ok(sourceCode.includes('disabled={!key.trim()}'), 'Submit button must disable when key is empty');
    assert.ok(sourceCode.includes('disabled:opacity-50 disabled:cursor-not-allowed'), 'Submit button must style disabled state');
    assert.ok(sourceCode.includes('cursor-pointer'), 'Interactive buttons must include cursor-pointer');
  });
});
