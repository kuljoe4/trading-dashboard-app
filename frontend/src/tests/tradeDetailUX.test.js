import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test('TradeDetailContent inline editing triggers use semantic buttons with aria-labels and focus-visible rings', () => {
  const filePath = path.resolve(__dirname, '../components/trade/TradeDetailContent.jsx')
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

test('TradeDetailContent defines and renders EntrySignalContext component without ReferenceError', () => {
  const filePath = path.resolve(__dirname, '../components/trade/TradeDetailContent.jsx')
  const content = fs.readFileSync(filePath, 'utf8')

  // Check EntrySignalContext definition
  assert.ok(
    content.includes('const EntrySignalContext = memo(({ trade, activeSessionConfig }) => {'),
    'EntrySignalContext component should be defined in TradeDetailContent.jsx'
  )

  // Check EntrySignalContext usage in TradeDetailContent
  assert.ok(
    content.includes('<EntrySignalContext trade={trade} activeSessionConfig={activeSessionConfig} />'),
    'EntrySignalContext JSX element should be rendered in TradeDetailContent'
  )

  // Check EntrySignalContext features
  assert.ok(
    content.includes('Entry Signal Context & Execution Metadata'),
    'EntrySignalContext should render header title'
  )
  assert.ok(
    content.includes('Warmup Candles:'),
    'EntrySignalContext should render warmup candle completion status'
  )
})

test('TradeDetailContent includes copy and paste actions for Active Exit Guard Config and Milestones', () => {
  const filePath = path.resolve(__dirname, '../components/trade/TradeDetailContent.jsx')
  const content = fs.readFileSync(filePath, 'utf8')

  // Check Active Config Copy/Paste handlers
  assert.ok(
    content.includes('handleCopyEditorConfigToClipboard'),
    'TradeDetailContent should define handleCopyEditorConfigToClipboard'
  )
  assert.ok(
    content.includes('handlePasteEditorConfigFromClipboard'),
    'TradeDetailContent should define handlePasteEditorConfigFromClipboard'
  )

  // Check Form Ladder Copy/Paste handlers
  assert.ok(
    content.includes('handleCopyFormLadderToClipboard'),
    'TradeDetailContent should define handleCopyFormLadderToClipboard'
  )
  assert.ok(
    content.includes('handlePasteFormLadderFromClipboard'),
    'TradeDetailContent should define handlePasteFormLadderFromClipboard'
  )

  // Check Copy Config / Paste Config buttons aria-labels
  assert.ok(
    content.includes('aria-label="Copy Active Exit Guard Config to Clipboard"'),
    'Copy Active Exit Guard Config button should have dynamic aria-label'
  )
  assert.ok(
    content.includes('aria-label="Paste Active Exit Guard Config from Clipboard"'),
    'Paste Active Exit Guard Config button should have dynamic aria-label'
  )

  // Check Copy / Paste Milestones buttons aria-labels inside editor
  assert.ok(
    content.includes('aria-label="Copy Guard Ladder Milestones to Clipboard"'),
    'Copy Guard Ladder Milestones button should specify aria-label'
  )
  assert.ok(
    content.includes('aria-label="Paste Guard Ladder Milestones from Clipboard"'),
    'Paste Guard Ladder Milestones button should specify aria-label'
  )
})

test('TradeDetailView and TradeDetailContent include accessible navigation and delay mode buttons', () => {
  const viewPath = path.resolve(__dirname, '../views/TradeDetailView.jsx')
  const contentPath = path.resolve(__dirname, '../components/trade/TradeDetailContent.jsx')

  const viewContent = fs.readFileSync(viewPath, 'utf8')
  const detailContent = fs.readFileSync(contentPath, 'utf8')

  // Check Trade Not Found back button accessibility in TradeDetailView
  assert.ok(
    viewContent.includes('aria-label="Back to Active Trades"'),
    'TradeDetailView fallback button must specify descriptive aria-label'
  )
  assert.ok(
    viewContent.includes('focus-visible:ring-2 focus-visible:ring-accent'),
    'TradeDetailView fallback button must include high-contrast focus-visible ring'
  )

  // Check Delay mode buttons accessibility in TradeDetailContent
  assert.ok(
    detailContent.includes('aria-label={`Switch delay mode for ${label} to time-based`}'),
    'Time-based delay button must specify descriptive aria-label'
  )
  assert.ok(
    detailContent.includes('aria-label={`Switch delay mode for ${label} to candle-based`}'),
    'Candle-based delay button must specify descriptive aria-label'
  )
})
