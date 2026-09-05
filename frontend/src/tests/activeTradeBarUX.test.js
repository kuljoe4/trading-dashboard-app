import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ActiveTradeBar Micro-UX & Keyboard Accessibility Standard', () => {
  const barFilePath = path.join(__dirname, '../components/ActiveTradeBar.jsx');
  const sourceCode = fs.readFileSync(barFilePath, 'utf-8');

  test('liquidation button specifies explicit type="button" and cursor-pointer', () => {
    assert.ok(sourceCode.includes('type="button"'), 'Liquidation button must specify explicit type="button"');
    assert.ok(sourceCode.includes('cursor-pointer'), 'Liquidation button must include cursor-pointer');
  });

  test('liquidation button includes enriched aria-label with symbol, direction, and PnL', () => {
    assert.ok(
      sourceCode.includes('aria-label={`Close ${t.symbol} ${t.direction || \'\'} position (${fmtUSD(t.pnl)})`}'),
      'Liquidation button aria-label must include direction and live PnL'
    );
  });

  test('estimated stop loss badge includes Tooltip, tabIndex={0}, aria-label, and focus ring without role="region"', () => {
    assert.ok(
      sourceCode.includes('<Tooltip content={`Estimated Stop Loss PnL: ${fmtUSD(slPnl)}`}>'),
      'Estimated SL badge must be wrapped in a Tooltip'
    );
    assert.ok(sourceCode.includes('tabIndex={0}'), 'Estimated SL badge must specify tabIndex={0} for keyboard focus');
    assert.strictEqual(
      sourceCode.includes('role="region"'),
      false,
      'Estimated SL badge must not specify landmark role="region"'
    );
    assert.ok(
      sourceCode.includes('aria-label={`Estimated Stop Loss PnL for ${t.symbol}: ${fmtUSD(slPnl)}`}'),
      'Estimated SL badge must specify descriptive aria-label'
    );
    assert.ok(
      sourceCode.includes('focus-visible:ring-1 focus-visible:ring-accent'),
      'Estimated SL badge must specify focus-visible ring style'
    );
  });
});
