import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

test('DecisionLog UX & Keyboard Accessibility Standard', () => {
  const filePath = path.join(process.cwd(), 'frontend/src/components/DecisionLog.jsx')
  const content = fs.readFileSync(filePath, 'utf8')

  // 1. VariantGatingSummary button specifies aria-expanded and dynamic aria-label
  assert.ok(
    content.includes('aria-expanded={isOpen}'),
    'VariantGatingSummary header button must specify aria-expanded={isOpen}'
  )
  assert.ok(
    content.includes('aria-label={`Toggle variant gating details (${activeStrategies.length} active strategy${activeStrategies.length === 1 ? \'\' : \'s\'})`}'),
    'VariantGatingSummary header button must specify dynamic aria-label'
  )

  // 2. VariantGatingSummary specifies WCAG focus-visible ring
  assert.ok(
    content.includes('focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-t-xl'),
    'VariantGatingSummary button must specify focus-visible:ring-2 focus-visible:ring-accent'
  )

  // 3. LogEntry trigger specifies dynamic aria-label and aria-expanded
  assert.ok(
    content.includes('aria-label={shouldTruncate ? (isExpanded ? "Collapse log message" : "Expand log message") : "View log details"}'),
    'LogEntry trigger must specify dynamic aria-label based on truncation and expansion state'
  )
  assert.ok(
    content.includes('aria-expanded={shouldTruncate ? isExpanded : undefined}'),
    'LogEntry trigger must specify aria-expanded attribute when log message is truncated'
  )

  // 4. LogEntry modal dismiss button specifies button type and aria-label
  assert.ok(
    content.includes('type="button"'),
    'LogEntry modal dismiss button must specify type="button"'
  )
  assert.ok(
    content.includes('aria-label="Dismiss log details"'),
    'LogEntry modal dismiss button must specify aria-label="Dismiss log details"'
  )

  // 5. Log filter buttons specify descriptive aria-label
  assert.ok(
    content.includes('aria-label={`Filter by ${filter.label} logs`}'),
    'Log level filter buttons must specify descriptive aria-label'
  )
})
