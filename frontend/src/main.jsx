import React, { useState, useEffect, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { useTradingStore } from './store/trading';
import { sessionAPI } from './api/client';
import { useVisibility } from './hooks/useVisibility';
import './index.css';

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('debug') === 'true') {
  import('eruda').then(m => m.default.init());
}

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
    sessionActive, setSessionActive, balance, totalRiskPct, config, updateStats, setThrottled
  } = useTradingStore();

  const isHidden = useVisibility();

  useEffect(() => {
    setThrottled(isHidden);
  }, [isHidden, setThrottled]);

  const [view, setView] = useState('cockpit');

  useEffect(() => {
    const controller = new AbortController();
    
    async function checkStatus() {
      try {
        const res = await sessionAPI.status({ signal: controller.signal });
        if (res.data.running) {
          setSessionActive(true, res.data.strategyId || res.data.strategy_id);
        }
        updateStats({
          balance: res.data.balance ?? balance,
          totalRiskPct: res.data.totalRiskPct ?? totalRiskPct,
          totalSlUsed: res.data.totalSlUsed ?? 0,
          activeTrades: res.data.activeTrades || [],
          scannerResults: res.data.scannerResults || [],
          activeWindows: res.data.activeWindows || [],
          tradeHistory: res.data.history || [],
          config: res.data.config ? { ...config, ...res.data.config } : config,
        });
      } catch (e) {
        if (e.name !== 'CanceledError') {
          console.error("Failed to fetch session status", e);
        }
      }
    }
    checkStatus();

    const handleHashChange = () => {
      const hash = (window.location.hash.replace('#/', '') || 'cockpit').split('?')[0];
      setView(hash === 'dashboard' ? 'cockpit' : hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();

    return () => {
      controller.abort();
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [setSessionActive, balance, totalRiskPct, config, updateStats]);

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
