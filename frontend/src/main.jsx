import React, { useState, useEffect, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import ErrorBoundary from './components/ErrorBoundary';
import { useTradingStore } from './store/trading';
import api, { sessionAPI, setAdminApiKey, initializeAuth } from './api/client';
import { useVisibility } from './hooks/useVisibility';
import { AuthOverlay } from './components/AuthOverlay';
import { ShortcutsModal } from './components/ShortcutsModal';
import { GlobalToaster } from './components/ui/primitives';
import { PersistentAlertBanner } from './components/PersistentAlertBanner';
import { Sidebar, BottomNav } from './components/Navigation';
import { SmoothSwap } from './components/ui/SmoothMotion';
import {
  DashboardSkeleton,
  TradesSkeleton,
  HistorySkeleton,
  SettingsSkeleton,
  TradeDetailSkeleton,
  StrategyDetailSkeleton,
} from './components/ui/Skeletons';
import { lazyWithRetry } from './lib/lazy';
import './index.css';

const DashboardView = lazyWithRetry(() => import('./views/DashboardView').then(m => ({ default: m.DashboardView })));
const SettingsView = lazyWithRetry(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const HistoryView = lazyWithRetry(() => import('./views/HistoryView').then(m => ({ default: m.HistoryView })));
const TradesView = lazyWithRetry(() => import('./views/TradesView'));
const TradeDetailView = lazyWithRetry(() => import('./views/TradeDetailView'));

const getViewFromHash = () => {
  if (typeof window === 'undefined') return 'cockpit';
  const fullHash = window.location.hash.replace('#/', '') || 'cockpit';
  const [path] = fullHash.split('?');
  return path === 'dashboard' ? 'cockpit' : path;
};

const LoadingView = ({ view = 'cockpit' }) => {
  if (view === 'trades') return <TradesSkeleton />;
  if (view === 'history') return <HistorySkeleton />;
  if (view === 'settings') return <SettingsSkeleton />;
  if (view.startsWith('trade/')) return <TradeDetailSkeleton />;
  if (view.startsWith('strategy/')) return <StrategyDetailSkeleton />;
  return <DashboardSkeleton />;
};

const App = () => {
  const store = useTradingStore();
  const { 
    setSessionActive, updateStats, setThrottled, debugToolsEnabled, sidebarCollapsed
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

  // Preload lazy route bundles when idle so screen switching has zero Suspense flash or CLS
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return undefined;
    const warmRoutes = () => {
      import('./views/DashboardView').catch(() => {});
      import('./views/TradesView').catch(() => {});
      import('./views/HistoryView').catch(() => {});
      import('./views/SettingsView').catch(() => {});
      import('./views/TradeDetailView').catch(() => {});
      import('./views/StrategyDetailView').catch(() => {});
      import('./components/TradeDetailModal').catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(warmRoutes, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = setTimeout(warmRoutes, 400);
    return () => clearTimeout(timer);
  }, [hydrated]);

  const isHidden = useVisibility();

  // Global unhandled rejection handler for chunk load failures
  useEffect(() => {
    const handleRejection = (event) => {
      const error = event.reason;
      const isChunkError = error?.name === 'ChunkLoadError' ||
                          /failed to fetch dynamically imported module/i.test(error?.message) ||
                          /error loading dynamically imported module/i.test(error?.message);

      const isWsHmrError = /createWebSocketModuleRunnerTransport/i.test(error?.message || error?.stack || '') ||
                           /websocket/i.test(error?.message || '') ||
                           /vite-hmr/i.test(error?.message || '');
      if (isWsHmrError) {
        event.preventDefault();
        return;
      }

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

    async function initAuthWithRetry(attempt = 1, maxAttempts = 12, delay = 800) {
      if (!active) return;
      try {
        const res = await api.get('/auth/config', { timeout: 5000 });
        if (!active) return;

        if (res.data.adminApiKey) {
          setAdminApiKey(res.data.adminApiKey);
        } else {
          initializeAuth();
        }
      } catch (e) {
        if (!active) return;
        if (e.code === 'ERR_CANCELED') return;

        if (attempt < maxAttempts) {
          const nextDelay = Math.min(delay, 2500);
          setTimeout(() => {
            initAuthWithRetry(attempt + 1, maxAttempts, Math.min(nextDelay * 1.5, 3000));
          }, nextDelay);
        } else {
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
    setThrottled(isHidden);
  }, [isHidden, hydrated, setThrottled]);

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

  const [view, setView] = useState(getViewFromHash);

  useEffect(() => {
    if (!hydrated) return;

    const controller = new AbortController();

    let retryTimer = null;

    async function checkStatus(retryCount = 0) {
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
          if (res.data.status === 'stopped' || res.data.running === false) {
             console.log("[App] Backend confirmed session stopped. Clearing local session state.");
             setSessionActive(false, null);
          }
        }

        updateStats({
          ...res.data,
          _authoritative: true,
          sessionActive: running,
          realizedPnl: res.data.realizedPnl ?? res.data.realized_pnl,
          activePnl: res.data.activePnl ?? res.data.active_pnl,
          totalPnl: res.data.totalPnl ?? res.data.total_pnl,
          entryCount: res.data.stats?.entryCount,
          hitCount: res.data.stats?.hitCount,
          activeTrades: res.data.activeTrades,
          variantStats: res.data.variant_stats,
          scannerResults: res.data.scannerResults,
          activeWindows: res.data.activeWindows,
          tradeHistory: res.data.history,
          config: res.data.config,
        });
      } catch (e) {
        if (!controller.signal.aborted && e.name !== 'CanceledError' && e.code !== 'ERR_CANCELED') {
          const httpStatus = e?.response?.status;
          if (httpStatus >= 400 && httpStatus < 500) {
            useTradingStore.setState({ initialStatusLoaded: true });
          } else if (retryCount < 8) {
            retryTimer = setTimeout(() => {
              if (!controller.signal.aborted) {
                checkStatus(retryCount + 1);
              }
            }, 1500);
          } else {
            console.error("Failed to fetch session status", e);
            useTradingStore.setState({ initialStatusLoaded: true });
          }
        }
      }
    }
    checkStatus();

    const handleHashChange = () => {
      setView(getViewFromHash());
      setShowShortcuts(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [hydrated, setSessionActive, updateStats]);

  const renderView = () => {
    if (!hydrated) return <LoadingView view={view} />;

    if (view.startsWith('trade/')) {
      const id = view.replace('trade/', '');
      return <TradeDetailView tradeId={id} />;
    }
    if (view.startsWith('strategy/')) {
      const label = decodeURIComponent(view.replace('strategy/', ''));
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

  const selectedStrategy = view.startsWith('strategy/')
    ? decodeURIComponent(view.replace('strategy/', ''))
    : null;

  const tradingMode = store.config?.trading_mode || (store.config?.paper_mode ? 'paper' : 'live');

  const routeGroupKey = view.startsWith('strategy/')
    ? 'cockpit'
    : view.startsWith('trade/')
      ? `trade:${view}`
      : view;

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={0}>
      <AuthOverlay />
      <ShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <GlobalToaster />
      <div className="min-h-screen bg-background text-text font-sans selection:bg-accent selection:text-white">
        {tradingMode === 'paper' && (
          <div className="fixed top-0 left-0 right-0 h-1 bg-amber z-[100] shadow-[0_2px_10px_rgba(245,166,35,0.5)]" />
        )}
        <Sidebar selected={selectedStrategy} activeRoute={view} />
        <div
          className={`min-h-screen transition-[padding] duration-300 ${
            sidebarCollapsed ? 'lg:pl-[80px]' : 'lg:pl-[260px]'
          } ${tradingMode === 'paper' ? 'pt-1' : ''}`}
        >
          <PersistentAlertBanner />
          <Suspense fallback={<LoadingView view={view} />}>
            <SmoothSwap contentKey={routeGroupKey} duration={0.14} yOffset={3}>
              {renderView()}
            </SmoothSwap>
          </Suspense>
        </div>
        <BottomNav selected={selectedStrategy} activeRoute={view} />
      </div>
    </TooltipProvider>
  );
};

const container = document.getElementById('root');
if (container) {
  if (!container._reactRoot) {
    container._reactRoot = createRoot(container);
  }
  container._reactRoot.render(
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
