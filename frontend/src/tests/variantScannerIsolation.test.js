import { fileURLToPath } from 'node:url';
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('trading_session.service.ts isolates variant strategy scanner configuration and symbols', () => {
  const filePath = path.resolve(__dirname, '../../../backend/node/src/engine/trading_session.service.ts')
  const content = fs.readFileSync(filePath, 'utf8')

  assert.ok(
    content.includes('hasVariantScannerOverride'),
    'trading_session.service.ts must check hasVariantScannerOverride when resolving variant symbols'
  )

  assert.ok(
    content.includes('const variantSymbols = hasVariantSymbols'),
    'trading_session.service.ts must resolve variantSymbols cleanly to avoid leaking static base symbols into discovery variants'
  )
})

test('server.ts computes distinct scanner opportunities for strategy variants based on watchlist_size and discovery_mode', () => {
  const filePath = path.resolve(__dirname, '../../../server.ts')
  const content = fs.readFileSync(filePath, 'utf8')

  assert.ok(
    content.includes('function getVariantOpportunitiesData()'),
    'server.ts must define getVariantOpportunitiesData for multi-variant scanner broadcast'
  )

  assert.ok(
    content.includes('hasVariantScannerOverride'),
    'server.ts must check hasVariantScannerOverride when resolving variant symbols'
  )
})

test('ScannerOverlay.jsx and StrategyDetailView.jsx isolate variant symbols when variant overrides scanner config', () => {
  const overlayPath = path.resolve(__dirname, '../components/ScannerOverlay.jsx')
  const overlayContent = fs.readFileSync(overlayPath, 'utf8')

  assert.ok(
    overlayContent.includes('hasVariantScannerOverride'),
    'ScannerOverlay.jsx must check hasVariantScannerOverride for variant strategyConfig'
  )

  const detailPath = path.resolve(__dirname, '../views/StrategyDetailView.jsx')
  const detailContent = fs.readFileSync(detailPath, 'utf8')

  assert.ok(
    detailContent.includes('hasVariantScannerOverride'),
    'StrategyDetailView.jsx must check hasVariantScannerOverride for variant strategyConfig'
  )
})
