import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { Activity, XCircle, Search, Copy, CheckCircle2, Info, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTradingStore } from '../store/trading'
import { cn, CopyButton, Tooltip, VisuallyHidden } from './ui/primitives'

const HIGHLIGHTS = {
  positive: ['BUY', 'PROFIT', 'TP', 'HIT', 'SUCCESS', 'STARTED', 'ENTER'],
  negative: ['SELL', 'LOSS', 'SL', 'REJECTED', 'ERROR', 'FAILED', 'STOPPED', 'CRITICAL'],
  neutral: ['MONITORING', 'WARM-UP', 'SYNC', 'LIFECYCLE', 'RECONCILING', 'ADAPTIVE']
}

const formatMessage = (msg) => {
  if (typeof msg !== 'string') return msg == null ? '' : String(msg);
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
  const safeLog = (log && typeof log === 'object') ? log : {};
  const logLevel = String(safeLog.level ?? 'info').toLowerCase();
  const logMessage = typeof safeLog.msg === 'string' ? safeLog.msg : String(safeLog.msg ?? '');
  const logTimestamp = String(safeLog.ts ?? '');

  return (
    <>
      <div className="flex items-center gap-2.5 text-[11px] font-mono border-b border-border/40 py-1.5 min-w-fit hover:bg-white/[0.02] transition-colors group/entry pr-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen(true)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setIsOpen(true)}
          className="flex items-center gap-2.5 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent/50 rounded-sm"
          aria-label="View log details"
        >
          <span className="text-dim/60 whitespace-nowrap shrink-0">[{logTimestamp}]</span>
          <span className={cn(
            "transition-colors whitespace-nowrap min-w-fit",
            logLevel === 'warn' ? "text-amber font-black" :
            logLevel === 'error' ? "text-red font-black" :
            "text-text/90 font-medium"
          )}>
            {formatMessage(logMessage)}
          </span>
        </div>
        <CopyButton
          value={logMessage}
          className="opacity-0 group-hover/entry:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 -my-1"
          tooltip="Copy log message"
        />
      </div>

      <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] animate-in fade-in duration-300" />
          <Dialog.Content
            aria-labelledby="log-title"
            aria-describedby="log-description"
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-surface/95 border border-border/50 rounded-xl p-4 md:p-5 shadow-2xl backdrop-blur-xl z-[101] animate-in fade-in zoom-in-95 duration-300 focus:outline-none"
          >
            <VisuallyHidden>
              <Dialog.Title id="log-title">Log Detail</Dialog.Title>
              <Dialog.Description id="log-description">
                Details for log entry at {logTimestamp} with level {logLevel}.
              </Dialog.Description>
            </VisuallyHidden>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center border",
                  logLevel === 'error' ? "bg-red/10 border-red/20 text-red" :
                  logLevel === 'warn' ? "bg-amber/10 border-amber/20 text-amber" :
                  "bg-accent/10 border-accent/20 text-accent"
                )}>
                  <Info size={16} />
                </div>
                <div>
                  <div className="text-xs font-black uppercase tracking-widest">Log Detail</div>
                  <div className="text-[9px] text-dim font-mono font-bold uppercase">{logTimestamp} • {logLevel}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <CopyButton value={logMessage} />
                <Tooltip content="Close">
                  <Dialog.Close asChild>
                    <button className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-dim hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none" aria-label="Close dialog">
                      <X size={15} />
                    </button>
                  </Dialog.Close>
                </Tooltip>
              </div>
            </div>

            <div className="bg-background/40 border border-border/50 rounded-xl p-3.5 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap max-h-[40vh] overflow-y-auto">
              {logMessage}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-1.5 bg-surface border border-border rounded-lg text-[9px] font-black uppercase tracking-widest hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none transition-colors h-8"
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
  const listRef = useRef(null)
  const [isAtTop, setIsAtTop] = useState(true)
  const [search, setSearch] = useState('')

  const safeLogs = Array.isArray(logs) ? logs : [];
  const safeLogFilters = logFilters && typeof logFilters === 'object' ? logFilters : DEFAULT_LOG_FILTERS;

  const visibleLogs = useMemo(
    () => {
      // BOLT: Single-pass filter and pre-computed search term for O(N) efficiency
      const term = search ? search.toLowerCase() : null;
      return safeLogs.filter((log) => {
        if (!log) return false;
        // BOLT: Use pre-normalized properties from store but add defensive fallback to prevent crashes
        const level = log.level || 'info';
        const msg = typeof log.msg === 'string' ? log.msg : String(log.msg || '');

        if (safeLogFilters[level] === false) return false;
        if (term && !msg.toLowerCase().includes(term)) return false;
        return true;
      });
    },
    [safeLogs, safeLogFilters, search]
  )

  // Audit Item 41: Scroll-lock pattern
  useEffect(() => {
    if (isAtTop && listRef.current) {
      listRef.current.scrollTo({ top: 0 })
    }
  }, [visibleLogs, isAtTop])

  const handleScroll = useCallback((event) => {
    setIsAtTop(event.currentTarget.scrollTop < 10)
  }, [])

  const filterButtons = [
    { level: 'info', label: 'Info' },
    { level: 'warn', label: 'Warnings' },
    { level: 'error', label: 'Errors' },
  ]

  return (
    <div className="flex flex-col gap-3 max-h-[500px] overflow-hidden">
      <div className="space-y-3">
        <div className="relative group p-1.5">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-dim/40 group-focus-within:text-accent transition-colors" />
          <input
            type="text"
            placeholder="Search activity logs... [/]"
            aria-label="Search activity logs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
            className="w-full bg-surface border border-border rounded-xl pl-10 pr-4 py-2 text-[11px] font-bold focus:border-accent focus:outline-accent outline-offset-1 transition-all"
          />
          {search && (
              <Tooltip content="Clear Search">
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors" aria-label="Clear Search">
                  <XCircle size={16} />
                </button>
              </Tooltip>
          )}
        </div>

        <div
          role="group"
          aria-label="Filter logs by level"
          className="flex flex-wrap gap-2 items-center"
        >
          <div className="flex-1 flex gap-2 overflow-x-auto min-w-0">
            <CopyButton
              value={(visibleLogs || []).map(l => `[${l.ts}] ${l.msg}`).join('\n')}
              className="bg-surface border border-border"
              tooltip="Copy All Visible Logs"
            />
            {(filterButtons || []).map((filter) => {
              const active = (safeLogFilters[filter.level] ?? true)
              return (
                <button
                  key={filter.level}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleLogFilter(filter.level)}
                  className={cn(
                    "px-3 py-1 rounded-full border text-[11px] font-bold transition-all whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
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
          <span className="text-[9px] text-dim font-bold uppercase tracking-widest bg-background/50 px-2 py-1 rounded border border-border/50 shrink-0 mt-1 md:mt-0 w-full md:w-auto text-center md:text-left">Latest 500</span>
        </div>
      </div>

      <div
        aria-live="polite"
        className="flex-1 flex flex-col gap-1.5 max-h-[340px] relative"
      >
        {!isAtTop && (
          <div className="absolute top-2 inset-x-0 z-20 flex justify-center pointer-events-none">
            <button
              onClick={() => {
                if (listRef.current) listRef.current.scrollTo({ top: 0 })
                setIsAtTop(true)
              }}
              className="pointer-events-auto bg-accent text-white px-4 py-1.5 rounded-full text-[10px] font-bold shadow-xl border border-white/10 animate-in fade-in zoom-in slide-in-from-top-2 duration-300"
            >
              New logs above ↑
            </button>
          </div>
        )}
        {visibleLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center animate-in fade-in duration-500">
            <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center mb-4 text-dim/20">
              {safeLogs.length === 0 ? <Activity size={24} /> : <XCircle size={24} />}
            </div>
            <div className="text-[13px] text-dim font-bold uppercase tracking-widest">
              {safeLogs.length === 0 ? 'No logs yet...' : 'No matching results'}
            </div>
            <p className="text-[11px] text-dim/60 mt-1 max-w-[200px]">
              {safeLogs.length === 0
                ? 'System activity will appear here once the engine starts.'
                : 'Try adjusting your filters to see more activity.'}
            </p>
            {search && (
              <button
                onClick={() => setSearch('')}
                className="mt-4 px-4 py-1.5 bg-accent/10 border border-accent/20 text-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent/20 transition-all active:scale-95"
              >
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border hover:scrollbar-thumb-accent/50 overscroll-contain"
          >
            <div className="flex flex-col gap-1.5">
              {(visibleLogs || []).map((log) => (
                /* BOLT: Use stable log.id as key to reduce reconciliation cost from O(N) to O(1) when prepending */
                <div key={log.id} className="min-w-fit">
                  <LogEntry log={log} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
DecisionLog.displayName = 'DecisionLog'
