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
  const logFilters = useTradingStore(state => state.logFilters)
  const toggleLogFilter = useTradingStore(state => state.toggleLogFilter)

  const visibleLogs = React.useMemo(
    () => logs.filter((log) => logFilters[log.level] !== false),
    [logs, logFilters]
  )

  const filterButtons = [
    { level: 'info', label: 'Info' },
    { level: 'warn', label: 'Warnings' },
    { level: 'error', label: 'Errors' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 400, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {filterButtons.map((filter) => {
          const active = logFilters[filter.level]
          return (
            <button
              key={filter.level}
              type="button"
              onClick={() => toggleLogFilter(filter.level)}
              style={{
                border: `1px solid ${C.border}`,
                background: active ? C.surface : 'transparent',
                color: filter.level === 'warn' ? C.amber : filter.level === 'error' ? C.red : C.text,
                padding: '4px 10px',
                borderRadius: 999,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 'bold',
                opacity: active ? 1 : 0.55,
              }}
            >
              {filter.label}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
        {visibleLogs.length === 0 ? (
          <div style={{ fontSize: 13, color: C.dim, padding: '10px 0' }}>
            {logs.length === 0 ? 'No logs yet...' : 'No logs match the selected filters.'}
          </div>
        ) : (
          visibleLogs.map((log) => (
            <LogEntry key={log.id} log={log} />
          ))
        )}
      </div>
    </div>
  )
})
