import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_SRC_DIR = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests' || entry.name === 'node_modules') continue;
      collectSourceFiles(full, out);
    } else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

describe('Static ReferenceError & Missing Import Guard', () => {
  test('ConfigModal, BacktestPanel, and trading store have no known undefined-reference or duplicate-key regressions', () => {
    const configModalSrc = fs.readFileSync(path.join(FRONTEND_SRC_DIR, 'components/ConfigModal.jsx'), 'utf-8');
    const backtestSrc = fs.readFileSync(path.join(FRONTEND_SRC_DIR, 'components/BacktestPanel.jsx'), 'utf-8');

    assert.ok(
      !configModalSrc.includes('rootDraft'),
      'ConfigModal.jsx must not reference undefined rootDraft'
    );
    assert.ok(
      backtestSrc.includes('CandlestickChart') &&
      /import\s*\{[^}]*\bCandlestickChart\b[^}]*\}\s*from\s*['"]\.\/ui\/primitives['"]/.test(backtestSrc) &&
      /import\s*\{[^}]*\bX\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(backtestSrc),
      'BacktestPanel.jsx must import CandlestickChart and X before rendering them'
    );
  });

  test('all frontend JS/JSX modules have zero undefined identifiers, broken named imports, or duplicate object keys', (t) => {
    const tscCandidates = [
      path.join(WORKSPACE_ROOT, 'frontend/node_modules/.bin/tsc'),
      path.join(WORKSPACE_ROOT, 'node_modules/.bin/tsc'),
      path.join(WORKSPACE_ROOT, 'backend/node/node_modules/.bin/tsc'),
    ];
    const tscBin = tscCandidates.find((p) => fs.existsSync(p));
    if (!tscBin) {
      // Standalone frontend CI installs only frontend/package.json (which does not include typescript).
      t.skip('tsc binary not installed in standalone frontend CI environment');
      return;
    }

    const files = collectSourceFiles(FRONTEND_SRC_DIR);
    assert.ok(files.length > 0, 'Should discover frontend source files');

    let output = '';
    try {
      execFileSync(
        tscBin,
        [
          '--ignoreConfig',
          '--allowJs',
          '--checkJs',
          '--noEmit',
          '--jsx', 'react-jsx',
          '--moduleResolution', 'bundler',
          '--module', 'esnext',
          '--target', 'esnext',
          '--skipLibCheck',
          ...files,
        ],
        { cwd: WORKSPACE_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      output = `${err?.stdout || ''}\n${err?.stderr || ''}`;
    }

    const fatalPattern = /error TS(2304|2552|2305|2614|2393|2451|1117):/;
    const fatalErrors = output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => fatalPattern.test(line));

    assert.deepEqual(
      fatalErrors,
      [],
      `Found undefined references / broken imports / duplicate keys in frontend/src:\n${fatalErrors.join('\n')}`
    );
  });
});
