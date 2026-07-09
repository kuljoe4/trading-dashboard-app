import React, { useState, useEffect, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import ErrorBoundary from './components/ErrorBoundary';
import { useTradingStore } from './store/trading';
import api, { sessionAPI, setAdminApiKey, initializeAuth } from './api/client';
import { useVisibility } from './hooks/useVisibility';
import { AuthOverlay } from './components/AuthOverlay';
import { AchievementToast } from './components/AchievementToast';
import { lazyWithRetry } from './lib/lazy';
import './index.css';

const LandingView = lazyWithRetry(() => import('./views/LandingView'));
const DashboardView = lazyWithRetry(() => import('./views/DashboardView').then(m => ({ default: m.DashboardView })));
const SettingsView = lazyWithRetry(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const HistoryView = lazyWithRetry(() => import('./views/HistoryView').then(m => ({ default: m.HistoryView })));
const LeaderboardView = lazyWithRetry(() => import('./views/LeaderboardView'));
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
  const { 
    setSessionActive, updateStats, setThrottled, sync, debugToolsEnabled
  } = useTradingStore();

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

  // Initialize Auth
  useEffect(() => {
    async function initAuth() {
      try {
        const res = await api.get('/auth/config');
        if (res.data.adminApiKey) {
          setAdminApiKey(res.data.adminApiKey);
        } else {
          // Even if no key is returned, resolve auth to prevent deadlocks
          initializeAuth();
        }
      } catch (e) {
        if (e.code === 'ERR_CANCELED') return;
        console.error("Failed to fetch auth config", e);
        initializeAuth();
      }
    }
    initAuth();
  }, []);

  useEffect(() => {
    setThrottled(isHidden);
    if (!isHidden) {
      sync();
    }
  }, [isHidden, setThrottled, sync]);

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

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      if (e.key === '1' || e.key.toLowerCase() === 'c') window.location.hash = '#/';
      if (e.key === '2' || e.key.toLowerCase() === 't') window.location.hash = '#/trades';
      if (e.key === '3' || e.key.toLowerCase() === 'h') window.location.hash = '#/history';
      if (e.key === '4') window.location.hash = '#/settings';
      if (e.key.toLowerCase() === 's') window.dispatchEvent(new Event('toggle-scanner'));
      if (e.key === '/') {
        e.preventDefault();
        const searchInputs = Array.from(document.querySelectorAll('input[placeholder*="Search"]'));
        const searchInput = searchInputs.pop();
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [view, setView] = useState('landing');

  useEffect(() => {
    const controller = new AbortController();

    async function checkStatus() {
      try {
        const res = await sessionAPI.status({ signal: controller.signal });
        if (controller.signal.aborted) return;

        const currentState = useTradingStore.getState();
        if (res.data.running) {
          setSessionActive(true, res.data.strategyId || res.data.strategy_id);
        }
        updateStats({
          balance: res.data.balance ?? currentState.balance,
          totalPnl: res.data.totalPnl ?? currentState.totalPnl,
          totalRiskPct: res.data.totalRiskPct ?? currentState.totalRiskPct,
          totalSlUsed: res.data.totalSlUsed ?? 0,
          activeTrades: res.data.activeTrades || [],
          variantStats: res.data.variant_stats || {},
          scannerResults: res.data.scannerResults || [],
          activeWindows: res.data.activeWindows || [],
          tradeHistory: res.data.history || [],
          config: res.data.config ? { ...currentState.config, ...res.data.config } : currentState.config,
          apiStatus: res.data.apiStatus || currentState.apiStatus,
        });
      } catch (e) {
        if (!controller.signal.aborted && e.name !== 'CanceledError' && e.code !== 'ERR_CANCELED') {
          console.error("Failed to fetch session status", e);
        }
      }
    }
    checkStatus();

    const handleHashChange = () => {
      const fullHash = window.location.hash.replace('#/', '') || 'landing';
      const [path, query] = fullHash.split('?');
      setView(path === 'dashboard' ? 'cockpit' : path);
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => {
      controller.abort();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [setSessionActive, updateStats]);

  const renderView = () => {
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
      case 'landing': return <LandingView />;
      case 'cockpit': return <DashboardView />;
      case 'leaderboard': return <LeaderboardView />;
      case 'trades': return <TradesView />;
      case 'history': return <HistoryView />;
      case 'settings': return <SettingsView />;
      default: return <DashboardView />;
    }
  };

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={0}>
      <AuthOverlay />
      <AchievementToast
        achievement={null} // Wire to store later
        onClose={() => {}}
      />
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
