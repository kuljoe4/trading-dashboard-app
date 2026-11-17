import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import api from '../api/client';
import { useTradingStore } from '../store/trading';
import { ConfigModal } from '../components/ConfigModal';
import { TooltipProvider } from '../components/ui/tooltip';
import { resolveStrategyConfig } from '../utils/strategyConfig.js';
import '../index.css';

// Separate development entry: every API request is handled in memory.
if (!import.meta.env.DEV) throw new Error('Editor fixture is development-only');
api.defaults.adapter = async config => ({ data: config.url?.includes('presets') ? [] : {}, status: 200, statusText: 'Fixture', headers: {}, config });
useTradingStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
useTradingStore.setState({ sessionActive: false, fetchLifetimeAnalytics: async () => {}, wsStatus: 'live', apiStatus: { isBanned: false } });

const base = {
  ...useTradingStore.getState().config,
  strategy_label: 'Daily EMA', paper_mode: true, trading_mode: 'paper',
  scan_interval: '1d', scan_lookback: 3, max_open_trades: 3,
  sl_distance_pct: 1, risk_pct_per_trade: 1, max_total_risk_pct: 5,
  slippage_warning_threshold: 0.001, scanner_signal_depth: 1,
  scanner_weights: { momentum: 0.5, volatility: 0.3, trend: 0.2 },
  enabled_signals: ['htf_breakout', 'ema_dual'], exit_signals: ['ema_dual_cross'],
  signal_params: { entry_ema_fast: 2, entry_ema_slow: 5, exit_ema_fast: 5, exit_ema_slow: 14 },
  signal_timeframes: { ema_dual: '1h', ema_dual_cross: '1h' },
  strategy_variants: [{ strategy_label: 'Top HL · 1h', scan_interval: '5m', discovery_mode: 'change_pct', signal_timeframes: { ema_dual_cross: 'default' } }],
};

function Preview() {
  const [saved, setSaved] = useState(base);
  const [fail, setFail] = useState(false);
  const [message, setMessage] = useState('In-memory fixture · no trading connection');
  const [revision, setRevision] = useState(0);
  const [payload, setPayload] = useState(null);
  return <TooltipProvider><main style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border text-xs">
      <span role="status">{message}</span>
      <label className="flex items-center gap-1"><input type="checkbox" checked={fail} onChange={e => setFail(e.target.checked)}/>Fail next save</label>
      <button className="min-h-10 px-2" onClick={() => setRevision(v => v + 1)}>Reload saved</button>
      {payload && <details><summary>Saved payload</summary><pre className="max-h-40 overflow-auto">{JSON.stringify(payload, null, 2)}</pre></details>}
    </div>
    <ConfigModal key={revision} initialConfig={resolveStrategyConfig(saved, saved.strategy_variants[0])} baseConfig={saved} initialEditingVariantIndex={0} isEdit
      onClose={() => setMessage('Close requested; fixture stays open')}
      onSave={async value => {
        if (fail) { setMessage('Simulated save failure · draft retained'); return false; }
        const clean = JSON.parse(JSON.stringify(value));
        delete clean._presetLoaded; delete clean._isMergedRootConfig;
        setSaved(clean); setPayload(clean); setMessage('Saved in memory · reload to verify'); return true;
      }}/>
  </main></TooltipProvider>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
