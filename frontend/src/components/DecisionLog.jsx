import React from 'react'
import { Activity, XCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { cn } from './ui/primitives'

const LogEntry = React.memo(({ log }) => (
  <div className="flex gap-3 text-[12px] font-mono border-b border-border pb-1">
    <span className="text-dim whitespace-nowrap">[{log.ts}]</span>
    <span className={cn(
      "transition-colors",
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
      <div className="flex flex-wrap gap-2 items-center">
        {filterButtons.map((filter) => {
          const active = logFilters[filter.level]
          return (
            <button
              key={filter.level}
              type="button"
              onClick={() => toggleLogFilter(filter.level)}
              aria-pressed={active}
              className={cn(
                "px-3 py-1 rounded-full border text-[11px] font-bold transition-all",
                active ? "bg-surface border-border opacity-100" : "bg-transparent border-border/50 opacity-55 hover:opacity-80",
                filter.level === 'warn' ? "text-amber" :
                filter.level === 'error' ? "text-red" :
                "text-text"
              )}
            >
              {filter.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-1.5 max-h-[340px] overflow-y-auto no-scrollbar">
        <AnimatePresence mode="popLayout">
          {visibleLogs.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center py-10 text-center"
            >
              <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center mb-4 text-dim/20">
                {logs.length === 0 ? <Activity size={24} /> : <XCircle size={24} />}
              </div>
              <div className="text-[13px] text-dim font-bold uppercase tracking-widest">
                {logs.length === 0 ? 'No logs yet...' : 'No matching results'}
              </div>
              <p className="text-[11px] text-dim/60 mt-1 max-w-[200px]">
                {logs.length === 0
                  ? 'System activity will appear here once the engine starts.'
                  : 'Try adjusting your filters to see more activity.'}
              </p>
            </motion.div>
          ) : (
            visibleLogs.map((log) => (
              <motion.div
                key={log.id}
                layout
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <LogEntry log={log} />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  )
})
