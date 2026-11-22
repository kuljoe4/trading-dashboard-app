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

  const rawWsMsg = wsError?.message || '';
  const wsMsg = rawWsMsg && !/websocket|socket|err_|econn/i.test(rawWsMsg)
    ? rawWsMsg
    : 'Live market prices paused. Tap Reconnect to restore real-time updates.';
  const rawApiMsg = apiError?.message || '';
  const apiMsg = rawApiMsg && !/non-json|unexpected token|502|503|html/i.test(rawApiMsg)
    ? rawApiMsg
    : 'We could not refresh your latest account data right now. Retrying automatically.';
  const showReconnecting = showReconnectingPill && !hasWsFailure;
  const hasVisibleAlert = showReconnecting || hasWsFailure || hasApiFailure;

  return (
    <aside
      aria-label="Live Connection and Service Notifications"
      data-banner-layout="inline"
      data-banner-style="top-slide-strip"
      className="w-full flex flex-col"
    >
      <AnimatePresence initial={false}>
        {/* Narrow Top Slide-Down Strip: Reconnecting */}
        {showReconnecting && (
          <motion.div
            key="ws-reconnecting"
            role="status"
            aria-live="polite"
            title="Re-establishing live WebSocket stream"
            initial={{ opacity: 0, height: 0, y: -12 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -12 }}
            transition={BANNER_TRANSITION}
            className="overflow-hidden border-b border-amber/30 bg-amber/[0.08] backdrop-blur-md"
          >
            <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 py-1.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-amber">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <RefreshCw className="w-3 h-3 animate-spin text-amber shrink-0" aria-hidden="true" />
                <span className="font-semibold text-text">
                  Reconnecting to live prices…
                </span>
                <span className="text-dim hidden sm:inline">
                  Updates will resume automatically.
                </span>
              </div>
              <span className="text-[10px] text-amber font-mono font-semibold shrink-0">
                Reconnecting
              </span>
            </div>
          </motion.div>
        )}

        {/* Narrow Top Slide-Down Strip: Connection Lost */}
        {hasWsFailure && (
          <motion.div
            key="ws-error"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, height: 0, y: -12 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -12 }}
            transition={BANNER_TRANSITION}
            className="overflow-hidden border-b border-red/35 bg-red/[0.09] backdrop-blur-md"
          >
            <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 py-1.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <WifiOff className="w-3.5 h-3.5 text-red shrink-0" aria-hidden="true" />
                <span className="font-semibold text-red shrink-0">Live updates paused</span>
                <span className="text-dim/40 shrink-0 hidden sm:inline" aria-hidden="true">·</span>
                <span className="text-text/85 leading-snug" title={rawWsMsg || wsMsg}>
                  {wsMsg}
                </span>
              </div>
              <button
                type="button"
                onClick={handleReconnectWs}
                disabled={isReconnecting}
                aria-label="Reconnect live market updates"
                className="px-2.5 py-0.5 rounded-md bg-red/15 hover:bg-red/25 border border-red/35 text-[11px] font-semibold text-red transition-colors flex items-center gap-1 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red/50 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isReconnecting ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>{isReconnecting ? 'Reconnecting…' : 'Reconnect'}</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* Narrow Top Slide-Down Strip: Service Refresh Notice */}
        {hasApiFailure && (
          <motion.div
            key="api-error"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, height: 0, y: -12 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -12 }}
            transition={BANNER_TRANSITION}
            className="overflow-hidden border-b border-amber/35 bg-amber/[0.09] backdrop-blur-md"
          >
            <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 py-1.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber shrink-0" aria-hidden="true" />
                <span className="font-semibold text-amber shrink-0">
                  Temporary connection hiccup
                </span>
                <span className="text-dim/40 shrink-0 hidden sm:inline" aria-hidden="true">·</span>
                <span className="text-text/85 leading-snug" title={rawApiMsg || apiMsg}>
                  {apiMsg}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleRetryApi}
                  disabled={isRetryingApi}
                  aria-label="Retry refreshing account data"
                  className="px-2.5 py-0.5 rounded-md bg-amber/15 hover:bg-amber/25 border border-amber/35 text-[11px] font-semibold text-amber transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isRetryingApi ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>{isRetryingApi ? 'Retrying…' : 'Try Again'}</span>
                </button>
                <button
                  type="button"
                  onClick={clearApiError}
                  aria-label="Dismiss notification"
                  className="p-0.5 rounded hover:bg-white/10 text-dim hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!hasVisibleAlert && null}
    </aside>
  );
};

export default PersistentAlertBanner;
