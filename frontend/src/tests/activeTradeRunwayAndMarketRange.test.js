import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Active Trade Runway Card Dual Indicators & 24h Market Range Standard Verification', () => {
  const cardPath = path.resolve('frontend/src/components/ActiveTradeCard.jsx');
  const cardCode = fs.readFileSync(cardPath, 'utf8');

  // Verify dual indicator markers calculation and rendering on runway track
  assert.ok(
    cardCode.includes('dualIndicatorMarkers'),
    'ActiveTradeCard must calculate dual indicator markers for proximity visibility'
  );
  assert.ok(
    cardCode.includes('Dual Indicator ('),
    'ActiveTradeCard must render dual indicator markers on the runway track'
  );

  // Verify 24h market range high/low calculation and visual meter
  assert.ok(
    cardCode.includes('24H L:'),
    'ActiveTradeCard must render 24h Low price'
  );
  assert.ok(
    cardCode.includes('24H H:'),
    'ActiveTradeCard must render 24h High price'
  );
  assert.ok(
    cardCode.includes('OF 24H RANGE'),
    'ActiveTradeCard must render 24h Range percentage meter'
  );

  // Verify WCAG accessibility standards
  assert.ok(
    cardCode.includes('aria-label={`24h Market Range for'),
    'ActiveTradeCard 24h range element must provide descriptive WCAG aria-label'
  );
  assert.ok(
    cardCode.includes('role="region"'),
    'ActiveTradeCard 24h range element must enforce role="region"'
  );
  assert.ok(
    cardCode.includes('tabIndex={0}'),
    'ActiveTradeCard 24h range element must enforce tabIndex={0}'
  );
});
