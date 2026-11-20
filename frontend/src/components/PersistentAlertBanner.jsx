import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, WifiOff, RefreshCw, X } from 'lucide-react';
import { useTradingStore } from '../store/trading';

const BANNER_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] };

export const PersistentAlertBanner = () => {
  const wsError = useTradingStore((s) => s.wsError);
  const wsStatus = useTradingStore((s) => s.wsStatus);
  const connectWS = useTradingStore((s) => s.connectWS);
  const apiError = useTradingStore((s) => s.apiError);
  const setApiError = useTradingStore((s) => s.setApiError);
  const clearApiError = useTradingStore((s) => s.clearApiError);
  const sync = useTradingStore((s) => s.sync);

  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isRetryingApi, setIsRetryingApi] = useState(false);

  useEffect(() => {
    const handleSystemApiError = (event) => {
      if (event.detail) {
        setApiError(event.detail);
      }
    };

    const handleSystemApiResolved = (event) => {
      if (apiError && (!event.detail?.url || event.detail.url === apiError.url)) {
        clearApiError();
      }
    };

    window.addEventListener('system-api-error', handleSystemApiError);
    window.addEventListener('system-api-resolved', handleSystemApiResolved);
    return () => {
      window.removeEventListener('system-api-error', handleSystemApiError);
      window.removeEventListener('system-api-resolved', handleSystemApiResolved);
    };
  }, [setApiError, clearApiError, apiError]);

  const hasWsFailure = wsStatus === 'error' && !!wsError;
  const hasApiFailure = !!apiError;
  const [showReconnectingPill, setShowReconnectingPill] = useState(false);

  // SRE: Only show ambient bar if reconnection takes longer than 1.2s.
  // Sub-second wakeups resolve silently without layout shifts or alarms.
  useEffect(() => {
    let timer;
    if (wsStatus === 'reconnecting') {
      timer = setTimeout(() => {
        setShowReconnectingPill(true);
      }, 1200);
    } else {
      setShowReconnectingPill(false);
    }
    return () => clearTimeout(timer);
  }, [wsStatus]);

  // SRE: Auto-heal API status in background so transient 502/restart clears automatically
  useEffect(() => {
    if (!hasApiFailure) return;
    const timer = setInterval(async () => {
      try {
        await sync();
        clearApiError();
      } catch (_) {}
    }, 5000);
    return () => clearInterval(timer);
  }, [hasApiFailure, sync, clearApiError]);

  const handleReconnectWs = () => {
    setIsReconnecting(true);
    connectWS();
    setTimeout(() => {
      setIsReconnecting(false);
    }, 1500);
  };

  const handleRetryApi = async () => {
    setIsRetryingApi(true);
    try {
      await sync();
      clearApiError();
    } catch {
      // Keep banner displayed if retry still fails
    } finally {
      setIsRetryingApi(false);
    }
  };

  const wsMsg = wsError?.message || 'Live feed disconnected. Real-time ticks are paused.';
  const apiMsg = apiError?.message || 'Backend request failed. Check server or proxy configuration.';

  return (
    <aside
      aria-label="System Connectivity and API Diagnostics"
      className="fixed top-2 left-1/2 -translate-x-1/2 w-[calc(100%-1rem)] max-w-[920px] flex flex-col gap-1.5 z-[120] pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {/* Slim Inline Reconnection Notice */}
        {showReconnectingPill && !hasWsFailure && (
          <motion.div
            key="ws-reconnecting"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={BANNER_TRANSITION}
            className="pointer-events-auto flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-lg bg-surface/95 backdrop-blur-md border border-amber/35 text-amber text-[11px] shadow-lg"
          >
            <div className="flex items-center gap-2 min-w-0">
              <RefreshCw className="w-3 h-3 animate-spin text-amber shrink-0" aria-hidden="true" />
              <span className="font-medium text-text truncate">
                Re-establishing live WebSocket stream...
              </span>
            </div>
            <span className="text-[10px] text-amber/85 font-mono shrink-0">Reconnecting</span>
          </motion.div>
        )}

        {/* Slim Inline WebSocket Error Bar */}
        {hasWsFailure && (
          <motion.div
            key="ws-error"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={BANNER_TRANSITION}
            className="pointer-events-auto flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-lg bg-surface/95 backdrop-blur-md border border-red/45 text-[11px] shadow-lg"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <WifiOff className="w-3.5 h-3.5 text-red shrink-0" aria-hidden="true" />
              <span className="font-semibold text-red shrink-0">Connection lost</span>
              <span className="text-muted/40 shrink-0" aria-hidden="true">·</span>
              <span className="text-muted truncate" title={wsMsg}>
                {wsMsg}
              </span>
            </div>
            <button
              type="button"
              onClick={handleReconnectWs}
              disabled={isReconnecting}
              aria-label="Reconnect WebSocket connection"
              className="px-2 py-0.5 rounded bg-red/15 hover:bg-red/25 border border-red/30 text-[11px] font-medium text-red transition-colors flex items-center gap-1 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red/50 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${isReconnecting ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isReconnecting ? 'Connecting' : 'Reconnect'}</span>
            </button>
          </motion.div>
        )}

        {/* Slim Inline API Error Bar */}
        {hasApiFailure && (
          <motion.div
            key="api-error"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={BANNER_TRANSITION}
            className="pointer-events-auto flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-lg bg-surface/95 backdrop-blur-md border border-amber/45 text-[11px] shadow-lg"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber shrink-0" aria-hidden="true" />
              <span className="font-semibold text-amber shrink-0">
                {apiError?.type === 'non-json' ? 'Invalid API response' : 'API error'}
              </span>
              {apiError?.url && (
                <code className="text-[10px] px-1.5 py-0.5 rounded bg-amber/10 text-amber font-mono shrink-0 hidden sm:inline">
                  {apiError.url}
                </code>
              )}
              <span className="text-muted/40 shrink-0" aria-hidden="true">·</span>
              <span className="text-muted truncate" title={apiMsg}>
                {apiMsg}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleRetryApi}
                disabled={isRetryingApi}
                aria-label="Retry API request"
                className="px-2 py-0.5 rounded bg-amber/15 hover:bg-amber/25 border border-amber/30 text-[11px] font-medium text-amber transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isRetryingApi ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>{isRetryingApi ? 'Retrying' : 'Retry'}</span>
              </button>
              <button
                type="button"
                onClick={clearApiError}
                aria-label="Dismiss API error banner"
                className="p-0.5 rounded hover:bg-white/5 text-muted hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
};

export default PersistentAlertBanner;
