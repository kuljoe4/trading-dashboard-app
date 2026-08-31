import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ConfirmationModal Safe-by-Default Micro-UX & Accessibility Standard', () => {
  const modalFilePath = path.join(__dirname, '../components/ConfirmationModal.jsx');
  const sourceCode = fs.readFileSync(modalFilePath, 'utf-8');

  test('guards backdrop onOpenChange when loading={true}', () => {
    assert.ok(sourceCode.includes('onOpenChange={(open) => !open && !loading && onClose()}'), 'Must restrict dialog close during loading');
    assert.ok(sourceCode.includes('loading ? "cursor-wait" : "cursor-pointer"'), 'Overlay backdrop must update cursor to wait during loading');
  });

  test('enforces button explicit type="button" and cursor-pointer', () => {
    assert.ok(sourceCode.includes('type="button"'), 'Interactive buttons must explicitly specify type="button"');
    assert.ok(sourceCode.includes('cursor-pointer'), 'Buttons must include cursor-pointer');
  });

  test('includes explicit aria-label attributes for confirm and cancel actions', () => {
    assert.ok(sourceCode.includes('aria-label={`${cancelText} action`}'), 'Cancel button must include explicit aria-label');
    assert.ok(sourceCode.includes('aria-label={`${confirmText} action`}'), 'Confirm button must include explicit aria-label');
  });

  test('disables cancel, close, and confirm controls during loading state', () => {
    assert.ok(sourceCode.includes('disabled={loading}'), 'Action controls must apply disabled prop when loading');
    assert.ok(sourceCode.includes('if (!loading) onConfirm()'), 'Confirm click handler must check !loading condition');
  });

  test('preserves auto-focus ref on cancel action for safe-by-default behavior', () => {
    assert.ok(sourceCode.includes('ref={cancelBtnRef}'), 'Cancel button must receive cancelBtnRef');
    assert.ok(sourceCode.includes('cancelBtnRef.current?.focus()'), 'Modal must auto-focus cancel button on open');
  });
});
