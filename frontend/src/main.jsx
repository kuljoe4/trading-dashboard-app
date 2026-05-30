import React, { useState, useEffect, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './components/ui/tooltip';
import { useTradingStore } from './store/trading';
import { sessionAPI } from './api/client';
import { useVisibility } from './hooks/useVisibility';
import './index.css';

const DashboardView = lazy(() => import('./views/DashboardView').then(m => ({ default: m.DashboardView })));
const SettingsView = lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const HistoryView = lazy(() => import('./views/HistoryView').then(m => ({ default: m.HistoryView })));

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
    setSessionActive, updateStats, setThrottled, debugToolsEnabled
  } = useTradingStore();

  const isHidden = useVisibility();

  useEffect(() => {
    setThrottled(isHidden);
  }, [isHidden, setThrottled]);

  useEffect(() => {
    let cancelled = false;

    const toggleEruda = async () => {
      try {
        if (debugToolsEnabled) {
          const eruda = (await import('eruda')).default;
          if (cancelled || window.__momentumDebugToolsActive) return;
          
          // Defensive: ensure window.eruda doesn't conflict if it's not a real instance
          if (window.eruda && typeof window.eruda.destroy !== 'function') {
            delete window.eruda;
          }
          
          eruda.init();
          window.__momentumDebugToolsActive = true;
        } else if (window.__momentumDebugToolsActive) {
          const eruda = (await import('eruda')).default;
          if (eruda && typeof eruda.destroy === 'function') {
            eruda.destroy();
          }
          window.__momentumDebugToolsActive = false;
        }
      } catch (e) {
        console.error('Eruda lifecycle error:', e);
      }
    };

    toggleEruda();

    return () => {
      cancelled = true;
    };
  }, [debugToolsEnabled]);

  const [view, setView] = useState('cockpit');

  const { syncStatus } = useTradingStore();

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
          scannerResults: res.data.scannerResults || [],
          activeWindows: res.data.activeWindows || [],
          tradeHistory: res.data.history || [],
          config: res.data.config ? { ...currentState.config, ...res.data.config } : currentState.config,
        });
      } catch (e) {
        if (!controller.signal.aborted && e.name !== 'CanceledError' && e.code !== 'ERR_CANCELED') {
          console.error("Failed to fetch session status", e);
        }
      }
    }
    checkStatus();
  useEffect(() => {
    syncStatus();

    const handleHashChange = () => {
      const hash = (window.location.hash.replace('#/', '') || 'cockpit').split('?')[0];
      setView(hash === 'dashboard' ? 'cockpit' : hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [setSessionActive, updateStats]);

  const renderView = () => {
    switch (view) {
      case 'cockpit': return <DashboardView />;
      case 'history': return <HistoryView />;
      case 'settings': return <SettingsView />;
      default: return <DashboardView />;
    }
  };

  return (
    <TooltipProvider delayDuration={400}>
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
  root.render(<App />);

  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.error('SW registration failed: ', err);
      });
    });
  }
}
