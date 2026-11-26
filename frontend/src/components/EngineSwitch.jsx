import React, { useEffect, useState } from 'react';
import { sessionAPI } from '../api/client';
import { selectedEngine } from '../utils/engineMode.js';
import { cn } from './ui/utils';

export const EngineSwitch = ({ running = null, className = '' }) => {
  const [otherRunning, setOtherRunning] = useState(null);
  const [pendingMode, setPendingMode] = useState(null);
  const otherEngine = selectedEngine === 'live' ? 'paper' : 'live';

  useEffect(() => {
    if (!selectedEngine) return undefined;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const { data } = await sessionAPI.engineStatus(otherEngine, controller.signal);
        if (!controller.signal.aborted) {
          setOtherRunning(data.mode === otherEngine && typeof data.running === 'boolean' ? data.running : null);
        }
      } catch {
        if (!controller.signal.aborted) setOtherRunning(null);
      } finally {
        pending = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [otherEngine]);

  if (!selectedEngine) return null;

  const activeMode = pendingMode || selectedEngine;

  return (
    <nav
      aria-label="Trading engine"
      data-testid="engine-switch"
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1 select-none',
        className
      )}
    >
      {['live', 'paper'].map((mode) => {
        const active = mode === activeMode;
        const status = mode === selectedEngine ? running : otherRunning;
        const label = mode === 'live' ? 'Live' : 'Paper';
        const statusLabel = status === null ? 'Status unavailable' : status ? 'Running' : 'Stopped';
        let href = `?engine=${mode}#/`;
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('engine', mode);
          url.hash = '#/';
          href = url.href;
        }
        return (
          <a
            key={mode}
            href={href}
            onClick={() => {
              if (mode !== selectedEngine) setPendingMode(mode);
            }}
            aria-current={mode === selectedEngine ? 'page' : undefined}
            aria-label={`${label} · ${statusLabel}`}
            title={statusLabel}
            className={cn(
              'inline-flex min-h-8 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
              active ? 'bg-accent/15 text-accent shadow-xs' : 'text-dim hover:text-text'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-2 w-2 rounded-full transition-colors',
                status === null ? 'bg-amber' : status ? 'bg-green' : 'bg-dim/50'
              )}
            />
            {label}
          </a>
        );
      })}
    </nav>
  );
};
