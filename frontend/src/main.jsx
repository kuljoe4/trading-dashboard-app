import React, { useState, useEffect, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import ErrorBoundary from './components/ErrorBoundary';
import { useTradingStore } from './store/trading';
import api, { sessionAPI, setAdminApiKey, initializeAuth } from './api/client';
import { useVisibility } from './hooks/useVisibility';
import { AuthOverlay } from './components/AuthOverlay';
import { ShortcutsModal } from './components/ShortcutsModal';
import { GlobalToaster } from './components/ui/primitives';
import { lazyWithRetry } from './lib/lazy';
import './index.css';

const DashboardView = lazyWithRetry(() => import('./views/DashboardView').then(m => ({ default: m.DashboardView })));
const SettingsView = lazyWithRetry(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const HistoryView = lazyWithRetry(() => import('./views/HistoryView').then(m => ({ default: m.HistoryView })));
const TradesView = lazyWithRetry(() => import('./views/TradesView'));
const TradeDetailView = lazyWithRetry(() => import('./views/TradeDetailView'));

const LoadingView = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      <span className="text-[10px] text-dim font-bold uppercase tracking-[0.2em]">Synchronizing...</span>
    </div>
  </div>
);

const App = () => {
  const store = useTradingStore();
  const { 
    setSessionActive, updateStats, setThrottled, sync, debugToolsEnabled
  } = store;

  const [hydrated, setHydrated] = useState(() => {
    try {
      return useTradingStore.persist.hasHydrated() || true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.useTradingStore = useTradingStore;
    }

    // BOLT: Critical hydration guard to prevent 0-data flicker on cold starts
    const unsub = useTradingStore.persist.onFinishHydration(() => {
      console.log("[App] Hydration finished");
      setHydrated(true);
    });

    // Safety check: if hydration finished before effect mounted
    if (useTradingStore.persist.hasHydrated()) {
      setHydrated(true);
    }

    const fallbackTimer = setTimeout(() => {
      setHydrated(true);
    }, 500);

    return () => {
      unsub();
      clearTimeout(fallbackTimer);
    };
  }, []);

  const isHidden = useVisibility();

  // Global unhandled rejection handler for chunk load failures
  useEffect(() => {
    const handleRejection = (event) => {
      const error = event.reason;
      const isChunkError = error?.name === 'ChunkLoadError' ||
                          /failed to fetch dynamically imported module/i.test(error?.message) ||
                          /error loading dynamically imported module/i.test(error?.message);

      if (isChunkError) {
        console.error('Global chunk load error detected:', error);
        const lastReload = Number(sessionStorage.getItem('last-chunk-error-reload') || 0);
        if (Date.now() - lastReload > 10000) {
          sessionStorage.setItem('last-chunk-error-reload', String(Date.now()));
          window.location.reload();
        }
      }
    };

    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  // Initialize Auth with robust retry and exponential backoff to handle cold starts resiliently
  useEffect(() => {
    let active = true;

    async function initAuthWithRetry(attempt = 1, maxAttempts = 4, delay = 1000) {
      if (!active) return;
      console.log(`[Auth] Fetching auth config (Attempt ${attempt}/${maxAttempts})...`);
      try {
        // Enforce a hard 5-second timeout on each config check
        const res = await api.get('/auth/config', { timeout: 5000 });
        if (!active) return;

        console.log(`[Auth] Auth config fetched successfully on attempt ${attempt}`);
        if (res.data.adminApiKey) {
          setAdminApiKey(res.data.adminApiKey);
        } else {
          initializeAuth();
        }
      } catch (e) {
        if (!active) return;
        if (e.code === 'ERR_CANCELED') return;

        const isTimeout = e.code === 'ECONNABORTED' || e.message?.toLowerCase().includes('timeout');
        console.warn(
          `[Auth] Attempt ${attempt}/${maxAttempts} failed. ` +
          `Error: ${e.message || String(e)}. ` +
          `Type: ${isTimeout ? 'Timeout' : 'Network/Server Error'}.`
        );

        if (attempt < maxAttempts) {
          console.log(`[Auth] Retrying in ${delay}ms...`);
          setTimeout(() => {
            initAuthWithRetry(attempt + 1, maxAttempts, delay * 2);
          }, delay);
        } else {
          console.error(`[Auth] All ${maxAttempts} attempts exhausted. Proceeding with fallback resolution.`);
          initializeAuth();
        }
      }
    }

    initAuthWithRetry();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    console.log(`[App] Visibility changed: isHidden=${isHidden}`);
    // Sync BEFORE setThrottled to ensure data is updated as soon as unthrottling starts
    if (!isHidden) {
      console.log(`[App] Tab became visible. Triggering sync.`);
      sync();
    }
    setThrottled(isHidden);
  }, [isHidden, hydrated, setThrottled, sync]);

  useEffect(() => {
    let script = null;

    if (debugToolsEnabled) {
      const initEruda = () => {
        if (window.eruda && !window.__momentumDebugToolsActive) {
          window.eruda.init();
          window.__momentumDebugToolsActive = true;
        }
      };

      if (window.eruda) {
        initEruda();
      } else {
        const existingScript = document.querySelector('script[src*="eruda"]');
        if (!existingScript) {
          script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/eruda';
          script.async = true;
          script.onload = initEruda;
          document.body.appendChild(script);
        }
      }
    }

    return () => {
      if (window.__momentumDebugToolsActive && window.eruda && typeof window.eruda.destroy === 'function') {
        window.eruda.destroy();
        window.__momentumDebugToolsActive = false;
      }
    };
  }, [debugToolsEnabled]);

  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const toggleShortcuts = () => setShowShortcuts(prev => !prev);
    window.addEventListener('toggle-shortcuts', toggleShortcuts);
    return () => window.removeEventListener('toggle-shortcuts', toggleShortcuts);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        e.target.blur();
        return;
      }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      if (e.key === '1' || e.key.toLowerCase() === 'c') window.location.hash = '#/';
      if (e.key === '2' || e.key.toLowerCase() === 't') window.location.hash = '#/trades';
      if (e.key === '3' || e.key.toLowerCase() === 'h') window.location.hash = '#/history';
      if (e.key === '4') window.location.hash = '#/settings';
      if (e.key.toLowerCase() === 's') window.dispatchEvent(new Event('toggle-scanner'));
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
      }
      if (e.key === '/') {
        e.preventDefault();
        const searchInputs = Array.from(document.querySelectorAll('input[placeholder*="Search"]'));
        // Prioritize the first visible search input on the screen
        const visibleSearchInput = searchInputs.find(
          (input) => input.offsetWidth > 0 || input.offsetHeight > 0 || input.offsetParent !== null
        );
        const searchInput = visibleSearchInput || searchInputs.pop();
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [view, setView] = useState('cockpit');

  useEffect(() => {
    if (!hydrated) return;

    const controller = new AbortController();

    async function checkStatus() {
      try {
        const res = await sessionAPI.status({ signal: controller.signal });
        if (controller.signal.aborted) return;

        const currentState = useTradingStore.getState();
        const running = !!res.data.running;

        if (running) {
          setSessionActive(true, res.data.strategyId || res.data.strategy_id);
        } else if (currentState.sessionActive) {
          // BOLT: Defensive Termination Guard.
          // Only force clear if the backend is DEFINITIVELY stopped.
          // If the backend request failed or returned empty but we were running, we trust our persisted state
          // until the next polling cycle or WebSocket heartbeat confirm otherwise.
          if (res.data.status === 'stopped' || res.data.running === false) {
             console.log("[App] Backend confirmed session stopped. Clearing local session state.");
             setSessionActive(false, null);
          }
        }

        updateStats({
          ...res.data,
          sessionActive: running,
          activeTrades: res.data.activeTrades,
          variantStats: res.data.variant_stats,
          scannerResults: res.data.scannerResults,
          activeWindows: res.data.activeWindows,
          tradeHistory: res.data.history,
          config: res.data.config,
        });
      } catch (e) {
        if (!controller.signal.aborted && e.name !== 'CanceledError' && e.code !== 'ERR_CANCELED') {
          console.error("Failed to fetch session status", e);
        }
      }
    }
    checkStatus();

    const handleHashChange = () => {
      const fullHash = window.location.hash.replace('#/', '') || 'cockpit';
      const [path, query] = fullHash.split('?');
      setView(path === 'dashboard' ? 'cockpit' : path);
      setShowShortcuts(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => {
      controller.abort();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [setSessionActive, updateStats]);

  const renderView = () => {
    if (!hydrated) return <LoadingView />;

    if (view.startsWith('trade/')) {
      const id = view.replace('trade/', '');
      return <TradeDetailView tradeId={id} />;
    }
    if (view.startsWith('strategy/')) {
      const label = decodeURIComponent(view.replace('strategy/', ''));
      // Find strategy from store to pass to Dashboard's selected state
      // For now, we reuse the selected logic in DashboardView if it's there
      return <DashboardView initialStrategy={label} />;
    }

    switch (view) {
      case 'cockpit': return <DashboardView />;
      case 'trades': return <TradesView />;
      case 'history': return <HistoryView />;
      case 'settings': return <SettingsView />;
      default: return <DashboardView />;
    }
  };

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={0}>
      <AuthOverlay />
      <ShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <GlobalToaster />
      <div className="min-h-screen bg-background text-text font-sans selection:bg-accent selection:text-white">
        <Suspense fallback={<LoadingView />}>
          {renderView()}
        </Suspense>
      </div>
    </TooltipProvider>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );

  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.error('SW registration failed: ', err);
      });
    });
  }
}
