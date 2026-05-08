import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardView } from './views/DashboardView';
import { SettingsView } from './views/SettingsView';
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
    sessionActive, setSessionActive, balance, totalRiskPct 
  } = useTradingStore();

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await sessionAPI.status();
        if (res.data.running) {
          setSessionActive(true, res.data.strategy_id);
        }
      } catch (e) {
        console.error("Failed to fetch session status", e);
      }
    }
    checkStatus();
  }, [setSessionActive]);

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, color: C.text }}>
      <TopBar 
        balance={balance} 
        totalRisk={totalRiskPct} 
        onKill={handleKill} 
        sessionActive={sessionActive} 
      />

      {/* Nav */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 24px", gap: 4 }}>
        {[["dashboard", "Dashboard"], ["settings", "Settings"]].map(([v, label]) => (
          <button 
            key={v} 
            onClick={() => setView(v)}
            style={{ 
              padding: "10px 16px", fontSize: 12, fontWeight: view === v ? 700 : 400, 
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
          style={{ 
            marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, 
            padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.border}`, 
            background: "none", color: C.text, fontSize: 11, cursor: "pointer" 
          }}
        >
          <PulseDot color={C.green} />
          Scanner Live
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {view === 'dashboard' ? <DashboardView /> : <SettingsView />}
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
