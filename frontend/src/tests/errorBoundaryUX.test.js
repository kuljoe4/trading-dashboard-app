import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ErrorBoundary Micro-UX & Keyboard Accessibility Standard', () => {
  const errorBoundaryPath = path.join(__dirname, '../components/ErrorBoundary.jsx');
  const sourceCode = fs.readFileSync(errorBoundaryPath, 'utf-8');

  test('interactive buttons specify explicit type="button" and cursor-pointer', () => {
    assert.ok(sourceCode.includes('type="button"'), 'Buttons must explicitly specify type="button"');
    assert.ok(sourceCode.includes('cursor-pointer'), 'Buttons must include cursor-pointer styling');
  });

  test('interactive buttons specify explicit aria-label attributes', () => {
    assert.ok(sourceCode.includes('aria-label="Reload Dashboard"'), 'Reload button must specify explicit aria-label');
    assert.ok(sourceCode.includes('aria-label="Try to recover dashboard state"'), 'Recover button must specify explicit aria-label');
  });

  test('interactive buttons specify focus-visible rings for WCAG keyboard accessibility', () => {
    assert.ok(sourceCode.includes('focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none'), 'Reload button must specify focus-visible ring');
    assert.ok(sourceCode.includes('focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none'), 'Recover button must specify focus-visible ring');
  });
});
