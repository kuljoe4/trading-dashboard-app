import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardView } from './views/DashboardView';
import { SettingsView } from './views/SettingsView';
import { HistoryView } from './views/HistoryView';
import { C } from './lib/theme';
import { useTradingStore } from './store/trading';
import { sessionAPI } from './api/client';
import { TopBar } from './components/TopBar';
import { ScannerOverlay } from './components/ScannerOverlay';
import { PulseDot } from './components/ui/primitives';

const App = () => {
  const [view, setView] = useState('dashboard');
  const [showScanner, setShowScanner] = useState(false);
  
  const { 
    sessionActive, setSessionActive, balance, totalRiskPct, config, wsStatus, updateStats
  } = useTradingStore();

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
  }, [setSessionActive]);

  useEffect(() => {
    const openScanner = () => setShowScanner(true);
    window.addEventListener('open-scanner', openScanner);
    return () => window.removeEventListener('open-scanner', openScanner);
  }, []);

  const handleKill = async () => {
    if (window.confirm("Are you sure you want to KILL all sessions?")) {
      try {
        await sessionAPI.stop();
        setSessionActive(false, null);
      } catch (e) {
        alert("Kill command failed");
      }
    }
  };

  return (
    <div className="app-shell" style={{ background: C.bg, color: C.text }}>
      <TopBar 
        balance={balance} 
        totalRisk={totalRiskPct} 
        onKill={handleKill} 
        sessionActive={sessionActive} 
        paperMode={config.paper_mode}
        wsStatus={wsStatus}
      />

      {/* Nav */}
      <div className="app-nav" style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        {[["dashboard", "Dashboard"], ["history", "History"], ["settings", "Settings"]].map(([v, label]) => (
          <button 
            key={v} 
            onClick={() => setView(v)}
            className="app-nav__tab"
            style={{ 
              fontWeight: view === v ? 700 : 400, 
              color: view === v ? C.text : C.dim, background: "none", border: "none", 
              borderBottom: `2px solid ${view === v ? C.accent : "transparent"}`, cursor: "pointer",
              transition: 'all 0.2s'
            }}
          >
            {label}
          </button>
        ))}
        <button 
          onClick={() => setShowScanner(true)}
          className="scanner-trigger"
          style={{ 
            border: `1px solid ${C.border}`, 
            background: "none", color: C.text, fontSize: 11, cursor: "pointer" 
          }}
        >
          <PulseDot color={C.green} />
          Scanner Live
        </button>
      </div>

      {/* Main Content */}
      <div className="app-main">
        {view === 'dashboard' && <DashboardView />}
        {view === 'history' && <HistoryView />}
        {view === 'settings' && <SettingsView />}
      </div>

      {showScanner && <ScannerOverlay onClose={() => setShowScanner(false)} />}
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
