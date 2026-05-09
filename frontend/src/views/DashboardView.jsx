import React, { useState } from 'react'
import { C, pnlColor, fmtUSD, fmt } from '../lib/theme'
import { useTradingStore } from '../store/trading'
import { sessionAPI } from '../api/client'
import { DecisionLog } from '../components/DecisionLog'
import { ActiveTradeBar } from '../components/ActiveTradeBar'
import { ConfigModal } from '../components/ConfigModal'
import { 
  StatCard, SectionLabel, Btn, StatusBadge, PaperBadge, 
  ConditionWidget, PnLBars, PulseDot 
} from '../components/ui/primitives'

// --- Strategy Card ---
const StrategyCard = ({ s, config, onClick }) => {
  const slPct = (s.totalSlUsed / config.total_sl_guard_usdt) * 100;
  const activeTrade = s.activeTrades && s.activeTrades.length > 0 ? s.activeTrades[0] : null;

  return (
    <div onClick={onClick} style={{ 
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, 
      padding: 18, cursor: "pointer", transition: "all 0.2s", position: "relative" 
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.borderHover}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <StatusBadge status={s.sessionActive} />
            {config.paper_mode && <PaperBadge />}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Momentum Strategy</div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>
            {config.scan_interval} · {config.scan_pct_threshold}% threshold
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: pnlColor(s.totalPnl), fontFamily: "monospace" }}>{fmtUSD(s.totalPnl)}</div>
          <div style={{ fontSize: 11, color: C.dim }}>{s.logs.filter(l => l.msg.includes('Entry')).length} hits</div>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.dim, marginBottom: 4 }}>
          <span>TOTAL SL GUARD</span>
          <span style={{ color: slPct > 70 ? C.red : C.dim }}>${s.totalSlUsed.toFixed(0)} / ${config.total_sl_guard_usdt}</span>
        </div>
        <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
          <div style={{ width: `${slPct}%`, height: "100%", background: slPct > 70 ? C.red : C.accent, borderRadius: 2, transition: "width 0.5s" }} />
        </div>
      </div>

      {activeTrade && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, background: C.greenDim, border: `1px solid ${C.greenBorder}` }}>
          <PulseDot color={C.green} />
          <span style={{ fontSize: 12, color: C.text, fontFamily: "monospace" }}>{activeTrade.symbol}</span>
          <span style={{ fontSize: 11, color: activeTrade.direction === 'LONG' ? C.green : C.red }}>{activeTrade.direction}</span>
          <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: pnlColor(activeTrade.pnl), fontFamily: "monospace" }}>{fmtUSD(activeTrade.pnl)}</span>
        </div>
      )}
    </div>
  );
}

// --- Detail View ---
const StrategyDetailView = ({ s, onBack }) => {
  const { config, scannerResults } = useTradingStore()
  const bestOpp = scannerResults[0] || { symbol: '---', pct: 0, dir: '---' }
  const scanMet = Math.abs(bestOpp.pct) >= config.scan_pct_threshold
  const entryMet = scanMet && s.activeTrades.length > 0

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.dim, padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Momentum Strategy</span>
            <StatusBadge status={s.sessionActive} />
            {config.paper_mode && <PaperBadge />}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>Loop mode · Active strategy</div>
        </div>
      </div>

      {/* Summary Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="TOTAL P&L" value={fmtUSD(s.totalPnl)} color={pnlColor(s.totalPnl)} />
        <StatCard label="HITS" value={s.logs.filter(l => l.msg.includes('Entry')).length.toString()} />
        <StatCard label="SL USED" value={`$${s.totalSlUsed.toFixed(0)} / $${config.total_sl_guard_usdt}`} color={s.totalSlUsed > config.total_sl_guard_usdt * 0.7 ? C.amber : C.text} />
        <StatCard label="OPEN RISK" value={`${s.totalRiskPct.toFixed(1)}%`} color={s.totalRiskPct > config.max_total_risk_pct * 0.8 ? C.amber : C.text} />
      </div>

      {/* Condition Widgets */}
      <SectionLabel>Entry Conditions</SectionLabel>
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <ConditionWidget
          label={`Scanner: % Move in last ${config.scan_lookback}×${config.scan_interval}`}
          value={bestOpp.pct}
          threshold={config.scan_pct_threshold}
          satisfied={scanMet}
          sublabel={`Best: ${bestOpp.symbol} ${bestOpp.dir.toUpperCase()}`}
        />
        <ConditionWidget
          label="Entry Confirmation"
          value={entryMet ? config.scan_pct_threshold + 0.3 : config.scan_pct_threshold - 0.5}
          threshold={config.scan_pct_threshold}
          unit=" confirm"
          satisfied={entryMet}
          sublabel="Breakout above N-bar high"
        />
      </div>

      {/* Active Position */}
      <SectionLabel>Active Position</SectionLabel>
      <div style={{ marginBottom: 24 }}>
        <ActiveTradeBar trade={s.activeTrades[0]} />
      </div>

      {/* P&L Chart + Timeline */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
          <SectionLabel>Session Logs</SectionLabel>
          <DecisionLog />
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
          <SectionLabel>P&L Performance</SectionLabel>
          <PnLBars trades={s.activeTrades} />
          <div style={{ marginTop: 20, fontSize: 12, color: C.dim, textAlign: 'center' }}>
            Real-time equity curve tracking
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardView() {
  const [selected, setSelected] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const { 
    sessionActive, balance, totalPnl, totalRiskPct, totalSlUsed, 
    activeTrades, logs, config, setSessionActive, updateConfig
  } = useTradingStore()
  const [loading, setLoading] = useState(false)

  // Mocking the current state as a single strategy object for the card/detail views
  const currentStrategy = {
    sessionActive, totalPnl, totalRiskPct, totalSlUsed, activeTrades, logs
  }

  async function handleCreateStrategy(newConfig) {
    setLoading(true)
    setShowConfig(false)
    try {
      updateConfig(newConfig)
      const res = await sessionAPI.start(newConfig)
      setSessionActive(true, res.data.strategyId || res.data.strategy_id)
    } catch (e) {
      alert(e?.response?.data?.detail || 'Failed to start')
    } finally {
      setLoading(false)
    }
  }

  async function handleStop() {
    setLoading(true)
    try {
      await sessionAPI.stop()
      setSessionActive(false, null)
    } catch (e) {
      if (e?.response?.status === 400) {
        // Backend says it's already stopped, so sync frontend
        setSessionActive(false, null)
      } else {
        alert(e?.response?.data?.detail || 'Failed to stop session')
      }
    } finally {
      setLoading(false)
    }
  }

  if (selected) {
    return <StrategyDetailView s={currentStrategy} onBack={() => setSelected(null)} />
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      
      {/* Controls */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        <StatusBadge status={sessionActive} />
        {config.paper_mode && <PaperBadge />}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {!sessionActive ? (
            <Btn variant="success" onClick={() => setShowConfig(true)}>{loading ? 'Starting…' : '▶ New Session'}</Btn>
          ) : (
            <Btn variant="danger" onClick={handleStop}>
              {loading ? 'Stopping…' : '■ Stop Session'}
            </Btn>
          )}
        </div>
      </div>

      <SectionLabel>Strategies</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
        <StrategyCard s={currentStrategy} config={config} onClick={() => setSelected(true)} />
        
        {/* Placeholder for "New Strategy" */}
        {!sessionActive && (
          <div 
            onClick={() => setShowConfig(true)}
            style={{ 
              border: `2px dashed ${C.border}`, borderRadius: 10, display: 'flex', 
              alignItems: 'center', justifyContent: 'center', minHeight: 180, 
              color: C.dim, cursor: 'pointer', transition: 'all 0.2s' 
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
          >
            + New Strategy
          </div>
        )}
      </div>

      {/* Quick Stats Overlay (matching Spec) */}
      <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="Account Balance" value={`$${balance.toLocaleString()}`} />
        <StatCard label="Total Session P&L" value={fmtUSD(totalPnl)} color={pnlColor(totalPnl)} />
        <StatCard label="Active Risk" value={`${totalRiskPct.toFixed(1)}%`} />
        <StatCard label="SL Guard Status" value={`$${totalSlUsed.toFixed(0)} / $${config.total_sl_guard_usdt}`} />
      </div>

      {showConfig && (
        <ConfigModal 
          initialConfig={config} 
          onSave={handleCreateStrategy} 
          onClose={() => setShowConfig(false)} 
        />
      )}
    </div>
  )
}
