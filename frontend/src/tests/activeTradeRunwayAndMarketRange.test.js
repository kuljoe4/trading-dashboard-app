import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Active Trade Runway Card Dual Indicators & Global 24h Market Range Verification', () => {
  const cardPath = path.resolve('frontend/src/components/ActiveTradeCard.jsx');
  const overlayPath = path.resolve('frontend/src/components/ScannerOverlay.jsx');
  const regimePath = path.resolve('frontend/src/utils/marketRegime.js');

  const cardCode = fs.readFileSync(cardPath, 'utf8');
  const overlayCode = fs.readFileSync(overlayPath, 'utf8');
  const regimeCode = fs.readFileSync(regimePath, 'utf8');

  // Verify dual indicator markers calculation and rendering on runway track
  assert.ok(
    cardCode.includes('dualIndicatorMarkers'),
    'ActiveTradeCard must calculate dual indicator markers for proximity visibility'
  );
  assert.ok(
    cardCode.includes('Dual Indicator ('),
    'ActiveTradeCard must render dual indicator markers on the runway track'
  );

  // Verify global 24h market range is part of global regime in ScannerOverlay, not in active trade card
  assert.ok(
    regimeCode.includes('btc24hHigh'),
    'marketRegime utility must compute global 24h market range bounds'
  );
  assert.ok(
    overlayCode.includes('Min') && overlayCode.includes('Max'),
    'ScannerOverlay must render 24h market range min and max percentages'
  );

  // Verify WCAG accessibility standards on global market regime element
  assert.ok(
    overlayCode.includes('aria-label={`Market Activity Status:'),
    'Global market regime telemetry element must provide descriptive WCAG aria-label'
  );
  assert.ok(
    overlayCode.includes('role="region"'),
    'Global 24h range element must enforce role="region"'
  );
  assert.ok(
    overlayCode.includes('tabIndex={0}'),
    'Global 24h range element must enforce tabIndex={0}'
  );
});
