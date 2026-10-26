import { fileURLToPath } from 'node:url';
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('ConfigModal includes discovery_mode input field and maps it to scan tab in TAB_ERROR_MAP', () => {
  const filePath = path.resolve(__dirname, '../components/ConfigModal.jsx')
  const content = fs.readFileSync(filePath, 'utf8')

  assert.ok(
    content.includes("discovery_mode: 'scan'"),
    'TAB_ERROR_MAP should map discovery_mode to scan tab'
  )

  assert.ok(
    content.includes("renderField('Discovery Mode', 'discovery_mode', 'text',"),
    'ConfigModal must render Discovery Mode field input'
  )

  assert.ok(
    content.includes("discovery_mode: config.discovery_mode || 'volume'"),
    'flattenConfig must preserve discovery_mode from strategy config'
  )

  assert.ok(
    content.includes("discovery_mode: flat.discovery_mode || 'volume'"),
    'coerceAndSanitizeConfig must preserve discovery_mode when saving strategy or variants'
  )
})

test('ScannerOverlay supports all discovery modes including volume, change_pct, and abs_change_pct', () => {
  const filePath = path.resolve(__dirname, '../components/ScannerOverlay.jsx')
  const content = fs.readFileSync(filePath, 'utf8')

  assert.ok(
    content.includes("id: 'abs_change_pct', label: 'Top Volatile', color: 'amber'"),
    'ScannerOverlay toolbar must include Top Volatile (abs_change_pct) mode'
  )

  assert.ok(
    content.includes("discoveryMode === 'abs_change_pct'"),
    'ScannerOverlay filteredResults must handle abs_change_pct sorting'
  )
})
