import React from 'react'
import { useTradingStore } from '../store/trading'
import { cn } from './ui/primitives'
import { Activity } from 'lucide-react'
import { motion } from 'framer-motion'

const LogEntry = React.memo(({ log }) => (
  <div className="flex gap-3 text-[12px] font-mono border-b border-border pb-1">
    <span className="text-dim shrink-0 whitespace-nowrap">[{log.ts}]</span>
    <span className={cn(
      "break-all",
      log.level === 'warn' ? "text-amber font-bold" :
      log.level === 'error' ? "text-red font-bold" :
      "text-text font-normal"
    )}>
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
    <div className="flex flex-col gap-3 max-h-[400px] overflow-hidden">
      <div
        role="group"
        aria-label="Filter logs by level"
        className="flex flex-wrap gap-2 items-center"
      >
        {filterButtons.map((filter) => {
          const active = logFilters[filter.level]
          return (
            <button
              key={filter.level}
              type="button"
              aria-pressed={active}
              onClick={() => toggleLogFilter(filter.level)}
              className={cn(
                "px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all cursor-pointer",
                active ? "bg-surface opacity-100" : "bg-transparent opacity-55 hover:opacity-80",
                filter.level === 'warn' ? "border-amber/30 text-amber" :
                filter.level === 'error' ? "border-red/30 text-red" :
                "border-border text-text"
              )}
            >
              {filter.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto pr-1">
        {visibleLogs.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-10 text-center gap-3"
          >
            <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center">
              <Activity size={18} className="text-dim/40" aria-hidden="true" />
            </div>
            <div className="text-[13px] text-dim font-medium">
              {logs.length === 0 ? 'No logs yet...' : 'No logs match the selected filters.'}
            </div>
          </motion.div>
        ) : (
          visibleLogs.map((log) => (
            <LogEntry key={log.id} log={log} />
          ))
        )}
      </div>
    </div>
  )
})
