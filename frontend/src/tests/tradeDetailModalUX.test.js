import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test('TradeDetailModal specifies aria-labelledby, aria-describedby, and matching id attributes for WCAG accessibility', () => {
  const filePath = path.resolve(__dirname, '../components/TradeDetailModal.jsx')
  const content = fs.readFileSync(filePath, 'utf8')

  assert.ok(
    content.includes('aria-labelledby="trade-detail-title"'),
    'TradeDetailModal Drawer.Content should specify aria-labelledby="trade-detail-title"'
  )

  assert.ok(
    content.includes('aria-describedby="trade-detail-description"'),
    'TradeDetailModal Drawer.Content should specify aria-describedby="trade-detail-description"'
  )

  assert.ok(
    content.includes('Drawer.Title id="trade-detail-title"'),
    'Drawer.Title should specify id="trade-detail-title"'
  )

  assert.ok(
    content.includes('Drawer.Description id="trade-detail-description"'),
    'Drawer.Description should specify id="trade-detail-description"'
  )
})
