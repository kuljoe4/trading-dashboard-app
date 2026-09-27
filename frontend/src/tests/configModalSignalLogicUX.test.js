import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ConfigModal Signal Logic Accessibility & Micro-UX Standard', () => {
  const configModalPath = path.join(__dirname, '../components/ConfigModal.jsx');
  const sourceCode = fs.readFileSync(configModalPath, 'utf-8');

  test('Entry signal logic segment buttons enforce aria-pressed, aria-label, cursor-pointer and focus-visible rings', () => {
    assert.ok(
      sourceCode.includes('role="group" aria-label="Entry signal logic selection"'),
      'Entry signal logic group must specify role="group" and aria-label'
    );
    assert.ok(
      sourceCode.includes('aria-pressed={(cfg.signal_logic || \'all\') === \'any\'}'),
      'Entry signal logic ANY button must enforce aria-pressed attribute'
    );
    assert.ok(
      sourceCode.includes('aria-label="Set entry signal logic to ANY"'),
      'Entry signal logic ANY button must include descriptive aria-label'
    );
    assert.ok(
      sourceCode.includes('aria-label="Set entry signal logic to ALL (AND)"'),
      'Entry signal logic ALL button must include descriptive aria-label'
    );
    assert.ok(
      sourceCode.includes('aria-label="Set entry signal logic to COMBO"'),
      'Entry signal logic COMBO button must include descriptive aria-label'
    );
  });

  test('Exit signal logic segment buttons enforce aria-pressed, aria-label, cursor-pointer and focus-visible rings', () => {
    assert.ok(
      sourceCode.includes('role="group" aria-label="Exit signal logic selection"'),
      'Exit signal logic group must specify role="group" and aria-label'
    );
    assert.ok(
      sourceCode.includes('aria-pressed={(cfg.exit_signal_logic || \'any\') === \'any\'}'),
      'Exit signal logic ANY button must enforce aria-pressed attribute'
    );
    assert.ok(
      sourceCode.includes('aria-label="Set exit signal logic to ANY"'),
      'Exit signal logic ANY button must include descriptive aria-label'
    );
    assert.ok(
      sourceCode.includes('aria-label="Set exit signal logic to ALL (AND)"'),
      'Exit signal logic ALL button must include descriptive aria-label'
    );
    assert.ok(
      sourceCode.includes('aria-label="Set exit signal logic to COMBO"'),
      'Exit signal logic COMBO button must include descriptive aria-label'
    );
  });
});
