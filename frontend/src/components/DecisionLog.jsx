import React from 'react'
import { C } from '../lib/theme'
import { useTradingStore } from '../store/trading'

const LogEntry = React.memo(({ log }) => (
  <div style={{ display: 'flex', gap: 12, fontSize: 12, fontFamily: 'monospace', borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>
    <span style={{ color: C.dim, whiteSpace: 'nowrap' }}>[{log.ts}]</span>
    <span style={{
      color: log.level === 'warn' ? C.amber : log.level === 'error' ? C.red : C.text,
      fontWeight: log.level !== 'info' ? 'bold' : 'normal'
    }}>
      {log.msg}
    </span>
  </div>
))

export const DecisionLog = React.memo(() => {
  const logs = useTradingStore(state => state.logs)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
      {logs.length === 0 ? (
        <div style={{ fontSize: 13, color: C.dim, padding: '10px 0' }}>No logs yet...</div>
      ) : (
        logs.map((log) => (
          <LogEntry key={log.id} log={log} />
        ))
      )}
    </div>
  )
})
