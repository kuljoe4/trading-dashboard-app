import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

test('ScannerRow interactive element includes dynamic aria-label and high-contrast focus-visible ring', () => {
  const filePath = path.join(process.cwd(), 'frontend/src/components/ScannerOverlay.jsx')
  const content = fs.readFileSync(filePath, 'utf8')

  // Verify ScannerRow includes dynamic aria-label
  assert.ok(
    content.includes('aria-label={`Toggle details for ${opp.symbol}, ${isLong ? \'Long\' : \'Short\'} ${Math.abs(opp.pct || 0).toFixed(2)}%, score ${Number(opp.score || 0).toFixed(0)}, status ${status.label}`}'),
    'ScannerRow interactive row should specify dynamic aria-label detailing symbol, direction, change %, score, and status'
  )

  // Verify focus-visible ring styles are present on the interactive row container
  assert.ok(
    content.includes('focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none'),
    'ScannerRow interactive row container must apply high-contrast inset focus-visible ring styles for keyboard navigation'
  )
})
