import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

test('DecisionLog Fetch, Limit Selectors & Non-Destructive Log Merge Standard', () => {
  const componentPath = path.join(process.cwd(), 'src/components/DecisionLog.jsx')
  const componentContent = fs.readFileSync(componentPath, 'utf8')

  // Verify limit options and localStorage persistence
  assert.ok(componentContent.includes("LIMIT_OPTIONS = ['50', '100', '250', '500', 'ALL']"), 'DecisionLog must define limit options starting from 50')
  assert.ok(componentContent.includes("localStorage.getItem('decision_log_limit')"), 'DecisionLog must load persisted log limit from localStorage')
  assert.ok(componentContent.includes("aria-label=\"Refresh decision logs\""), 'DecisionLog must feature an accessible manual refresh button')
  assert.ok(componentContent.includes('fetchLogs'), 'DecisionLog must call fetchLogs from trading store')

  const clientPath = path.join(process.cwd(), 'src/api/client.js')
  const clientContent = fs.readFileSync(clientPath, 'utf8')
  assert.ok(clientContent.includes("logs: (limit) => apiInstance.get('/session/logs', { params: { limit } })"), 'sessionAPI must expose logs method requesting /session/logs')

  const storePath = path.join(process.cwd(), 'src/store/trading.js')
  const storeContent = fs.readFileSync(storePath, 'utf8')
  assert.ok(storeContent.includes('fetchLogs: async'), 'Trading store must implement fetchLogs action')
  assert.ok(
    storeContent.includes('if (Array.isArray(d.logLines) && d.logLines.length > 0)'),
    'Trading store status handler must only merge logLines if non-empty, preventing empty logLine payloads from wiping in-memory logs'
  )
})
