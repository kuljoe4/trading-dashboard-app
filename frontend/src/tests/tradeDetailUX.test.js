import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

test('TradeDetailContent inline editing triggers use semantic buttons with aria-labels and focus-visible rings', () => {
  const filePath = path.join(process.cwd(), 'frontend/src/components/trade/TradeDetailContent.jsx')
  const content = fs.readFileSync(filePath, 'utf8')

  // Check Guard Ladder trigger button
  assert.ok(
    content.includes('aria-label={interactiveEnabled ? `Edit milestone ${i + 1} trigger (current: ${trigger}R)` : `Milestone ${i + 1} trigger ${trigger}R (read only)`}'),
    'Milestone trigger should specify dynamic aria-label'
  )

  // Check Guard Ladder secured stop button
  assert.ok(
    content.includes('aria-label={interactiveEnabled ? `Edit milestone ${i + 1} secured stop loss (current: SL ${exits[i] === 0 ? \'BE\' : `${exits[i]}R`})` : `Milestone ${i + 1} secured stop loss SL ${exits[i] === 0 ? \'BE\' : `${exits[i]}R`} (read only)`}'),
    'Milestone secured stop should specify dynamic aria-label'
  )

  // Check Stop Loss price button
  assert.ok(
    content.includes('aria-label={interactiveEnabled ? `Edit stop loss price (current: ${price(sl)})` : `Stop loss price ${price(sl)} (read only)`}'),
    'Stop Loss price display should specify dynamic aria-label'
  )

  // Ensure focus-visible rings are present on inline buttons
  assert.ok(
    content.includes('focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-sm'),
    'Inline edit triggers must feature WCAG focus-visible ring styles'
  )
})
