import React, { useState } from 'react'
import { Activity, XCircle, Search, Filter, Copy, CheckCircle2, Info, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { cn, CopyButton, VisuallyHidden } from './ui/primitives'

const HIGHLIGHTS = {
  positive: ['BUY', 'PROFIT', 'TP', 'HIT', 'SUCCESS', 'STARTED', 'ENTER'],
  negative: ['SELL', 'LOSS', 'SL', 'REJECTED', 'ERROR', 'FAILED', 'STOPPED', 'CRITICAL'],
  neutral: ['MONITORING', 'WARM-UP', 'SYNC', 'LIFECYCLE', 'RECONCILING']
}

const formatMessage = (msg) => {
  if (!msg) return msg;
  const words = msg.split(/(\s+)/);
  return words.map((word, i) => {
    const clean = word.toUpperCase().trim();
    if (HIGHLIGHTS.positive.some(h => clean.includes(h))) return <span key={i} className="text-green font-black">{word}</span>;
    if (HIGHLIGHTS.negative.some(h => clean.includes(h))) return <span key={i} className="text-red font-black">{word}</span>;
    if (HIGHLIGHTS.neutral.some(h => clean.includes(h))) return <span key={i} className="text-accent font-black">{word}</span>;
    return word;
  });
}

const LogEntry = React.memo(({ log }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(true)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setIsOpen(true)}
        className="flex gap-2.5 text-[11px] font-mono border-b border-border/40 pb-1.5 min-w-0 cursor-pointer hover:bg-white/[0.02] transition-colors group/entry"
      >
        <span className="text-dim/60 whitespace-nowrap shrink-0">[{log.ts}]</span>
        <span className={cn(
          "transition-colors whitespace-nowrap",
          log.level === 'warn' ? "text-amber font-black" :
          log.level === 'error' ? "text-red font-black" :
          "text-text/90 font-medium"
        )}>
          {formatMessage(log.msg)}
        </span>
      </div>

      <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] animate-in fade-in duration-300" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-surface/95 border border-border/50 rounded-[2rem] p-6 shadow-2xl backdrop-blur-xl z-[101] animate-in fade-in zoom-in-95 duration-300 focus:outline-none">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center border",
                  log.level === 'error' ? "bg-red/10 border-red/20 text-red" :
                  log.level === 'warn' ? "bg-amber/10 border-amber/20 text-amber" :
                  "bg-accent/10 border-accent/20 text-accent"
                )}>
                  <Info size={20} />
                </div>
                <div>
                  <Dialog.Title className="text-sm font-black uppercase tracking-widest">Log Detail</Dialog.Title>
                  <div className="text-[10px] text-dim font-mono font-bold uppercase">{log.ts} • {log.level}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton value={log.msg} />
                <Dialog.Close asChild>
                  <button className="p-2 hover:bg-white/5 rounded-lg transition-colors text-dim hover:text-text" aria-label="Close">
                    <X size={18} />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            <div className="bg-background/40 border border-border/50 rounded-2xl p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap max-h-[40vh] overflow-y-auto">
              {log.msg}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-6 py-2 bg-surface border border-border rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-accent transition-colors"
              >
                Dismiss
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
})

const DEFAULT_LOG_FILTERS = { info: true, warn: true, error: true };

export const DecisionLog = React.memo(() => {
  const logs = useTradingStore(state => state.logs)
  const logFilters = useTradingStore(state => state.logFilters)
  const toggleLogFilter = useTradingStore(state => state.toggleLogFilter)
  const scrollRef = React.useRef(null)
  const [isAtTop, setIsAtTop] = React.useState(true)
  const [search, setSearch] = useState('')

  const visibleLogs = React.useMemo(
    () => logs.filter((log) => {
      const passLevel = (logFilters || DEFAULT_LOG_FILTERS)[log.level] !== false;
      const passSearch = !search || log.msg.toLowerCase().includes(search.toLowerCase());
      return passLevel && passSearch;
    }),
    [logs, logFilters, search]
  )

  // Audit Item 41: Scroll-lock pattern
  React.useEffect(() => {
    if (isAtTop && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [visibleLogs, isAtTop])

  const handleScroll = (e) => {
    const { scrollTop } = e.currentTarget
    setIsAtTop(scrollTop < 10)
  }

  const filterButtons = [
    { level: 'info', label: 'Info' },
    { level: 'warn', label: 'Warnings' },
    { level: 'error', label: 'Errors' },
  ]

  return (
    <div className="flex flex-col gap-3 max-h-[500px] overflow-hidden">
      <div className="space-y-3">
        <div className="relative group">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
          <input
            type="text"
            placeholder="Search activity logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface border border-border rounded-xl pl-9 pr-4 py-2 text-[11px] font-bold focus:border-accent outline-none transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors">
              <XCircle size={14} />
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Filter logs by level"
          className="flex flex-wrap gap-2 items-center"
        >
          <div className="flex-1 flex gap-2 overflow-x-auto">
            <CopyButton
              value={visibleLogs.map(l => `[${l.ts}] ${l.msg}`).join('\n')}
              className="bg-surface border border-border"
            />
            {filterButtons.map((filter) => {
              const active = (logFilters || DEFAULT_LOG_FILTERS)[filter.level]
              return (
                <button
                  key={filter.level}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleLogFilter(filter.level)}
                  className={cn(
                    "px-3 py-1 rounded-full border text-[11px] font-bold transition-all whitespace-nowrap",
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
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest bg-background/50 px-2 py-1 rounded border border-border/50 shrink-0">Latest 500</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        aria-live="polite"
        className="flex flex-col gap-1.5 max-h-[340px] overflow-auto relative"
      >
        {!isAtTop && (
          <div className="sticky top-2 inset-x-0 z-10 flex justify-center pointer-events-none">
            <button
              onClick={() => {
                if (scrollRef.current) scrollRef.current.scrollTop = 0
                setIsAtTop(true)
              }}
              className="pointer-events-auto bg-accent text-white px-4 py-1.5 rounded-full text-[10px] font-bold shadow-xl border border-white/10 animate-in fade-in zoom-in slide-in-from-top-2 duration-300"
            >
              New logs above ↑
            </button>
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {visibleLogs.length === 0 ? (
            <motion.div
              key="empty"
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
DecisionLog.displayName = 'DecisionLog'
