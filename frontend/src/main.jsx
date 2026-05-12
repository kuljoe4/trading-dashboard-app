import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardView } from './views/DashboardView';
import { SettingsView } from './views/SettingsView';
import { HistoryView } from './views/HistoryView';
import { useTradingStore } from './store/trading';
import { sessionAPI } from './api/client';
import './index.css';

const App = () => {
  const { 
    sessionActive, setSessionActive, balance, totalRiskPct, config, updateStats
  } = useTradingStore();

  const [view, setView] = useState('cockpit');

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await sessionAPI.status();
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
        console.error("Failed to fetch session status", e);
      }
    }
    checkStatus();

    const handleHashChange = () => {
      const hash = window.location.hash.replace('#/', '') || 'cockpit';
      setView(hash === 'dashboard' ? 'cockpit' : hash);
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
    return () => window.removeEventListener('hashchange', handleHashChange);
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
    <div className="min-h-screen bg-background text-text font-sans selection:bg-accent selection:text-white">
      {renderView()}
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
