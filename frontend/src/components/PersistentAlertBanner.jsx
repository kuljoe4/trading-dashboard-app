import React, { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff, RefreshCw, XCircle, CheckCircle2 } from 'lucide-react';
import { useTradingStore } from '../store/trading';

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

    window.addEventListener('system-api-error', handleSystemApiError);
    return () => window.removeEventListener('system-api-error', handleSystemApiError);
  }, [setApiError]);

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
      // If sync succeeds without throwing, clear error
      clearApiError();
    } catch {
      // Keep error displayed if retry still fails
    } finally {
      setIsRetryingApi(false);
    }
  };

  const hasWsFailure = !!wsError || wsStatus === 'error';
  const hasApiFailure = !!apiError;

  if (!hasWsFailure && !hasApiFailure) {
    return null;
  }

  return (
    <aside
      aria-label="System Connectivity and API Diagnostics"
      className="w-full flex flex-col gap-2 p-3 sm:p-4 bg-background border-b border-border/80 z-50 sticky top-0 backdrop-blur-md shadow-lg"
    >
      {/* WebSocket Error Banner */}
      {hasWsFailure && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 shadow-md animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-red-900/60 text-red-400 shrink-0">
              <WifiOff className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-wider text-red-400">
                  WebSocket Connection Failed or Rejected
                </span>
                <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-ping" />
              </div>
              <p className="text-xs text-red-200/90 mt-0.5">
                {wsError?.message || 'WebSocket connection was closed unexpectedly or rejected by the server. Real-time ticker stream and PnL ticks are paused.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
            <button
              type="button"
              onClick={handleReconnectWs}
              disabled={isReconnecting}
              aria-label="Reconnect WebSocket connection"
              className="px-3 py-1.5 rounded-lg bg-red-800/80 hover:bg-red-700 active:bg-red-900 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isReconnecting ? 'Reconnecting...' : 'Reconnect WS'}</span>
            </button>
          </div>
        </div>
      )}

      {/* API / Presets Response Failure Banner */}
      {hasApiFailure && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-950/80 border border-amber-500/50 text-amber-200 shadow-md animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-900/60 text-amber-400 shrink-0">
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-wider text-amber-400">
                  {apiError?.type === 'non-json' ? 'API Returned Non-JSON / HTML Response' : 'Backend API Failure'}
                </span>
                {apiError?.url && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 font-mono">
                    {apiError.url}
                  </span>
                )}
              </div>
              <p className="text-xs text-amber-200/90 mt-0.5">
                {apiError?.message || 'A critical API endpoint returned HTML or failed. Check that the backend is running and that reverse proxy rules (/presets, /session, /auth) are properly configured.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
            <button
              type="button"
              onClick={handleRetryApi}
              disabled={isRetryingApi}
              aria-label="Retry API request"
              className="px-3 py-1.5 rounded-lg bg-amber-800/80 hover:bg-amber-700 active:bg-amber-900 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetryingApi ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isRetryingApi ? 'Retrying...' : 'Retry'}</span>
            </button>
            <button
              type="button"
              onClick={clearApiError}
              aria-label="Dismiss API error banner"
              className="p-1.5 rounded-lg hover:bg-amber-900/40 text-amber-400 hover:text-amber-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer"
            >
              <XCircle className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};

export default PersistentAlertBanner;
