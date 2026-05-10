import React, { useEffect, useMemo, useState } from 'react'
import { C, pnlColor, fmtUSD, fmt, fmtVol } from '../lib/theme'
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
  const slPct = Math.min(((s.totalSlUsed / config.total_sl_guard_usdt) * 100) || 0, 100);
  const activeTrade = s.activeTrades && s.activeTrades.length > 0 ? s.activeTrades[0] : null;
  const activeDirection = activeTrade?.direction?.toUpperCase()

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
          <span style={{ fontSize: 11, color: activeDirection === 'LONG' ? C.green : C.red }}>{activeDirection}</span>
          <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: pnlColor(activeTrade.pnl), fontFamily: "monospace" }}>{fmtUSD(activeTrade.pnl)}</span>
        </div>
      )}
    </div>
  );
}

const RateLimitStrip = ({ rateLimit }) => {
  const used = rateLimit?.used_weight_1m || 0
  const limit = rateLimit?.limit || 1200
  const pct = Math.min((used / limit) * 100, 100)
  const color = pct >= 90 ? C.red : pct >= 70 ? C.amber : C.green

  return (
    <div className="rate-strip">
      <span>LIMITS</span>
      <div>
        <strong style={{ color }}>{used}/{limit}</strong>
        <i><b style={{ width: `${pct}%`, background: color }} /></i>
      </div>
      <em style={{ color }}>{pct >= 90 ? 'CRITICAL' : pct >= 70 ? 'WARN' : 'OK'}</em>
    </div>
  )
}

const GateBanner = ({ gateState, scannerPaused }) => {
  if (!gateState && !scannerPaused) return null
  const messages = {
    max_trades: 'Max open trades reached. Scanner is paused until a position closes.',
    sl_guard: 'Stop-loss guard has been reached. New entries are blocked for this session.',
    risk_pct: 'Total risk limit reached. Scanner can watch, but entries are gated.',
    risk: 'Risk gate is active. New entries are blocked.',
  }

  return (
    <div className={`gate-banner ${scannerPaused ? 'gate-banner--blocked' : 'gate-banner--warn'}`}>
      {messages[gateState] || 'Risk gate active.'}
    </div>
  )
}

const ActiveWindows = ({ windows }) => {
  if (!windows?.length) return null
  return (
    <div>
      <SectionLabel>Active Windows</SectionLabel>
      <div className="active-window-list">
        {windows.map((window) => {
          const pct = Math.max(0, Math.min((window.remaining_ms / 90000) * 100, 100))
          const color = window.direction === 'long' ? C.green : C.red
          return (
            <div key={window.symbol} className="active-window-card">
              <div>
                <strong>{window.symbol}</strong>
                <span style={{ color }}>{window.direction.toUpperCase()}</span>
              </div>
              <div>
                <span style={{ color }}>{Math.abs(window.pct_change).toFixed(2)}%</span>
                <small>{Math.round(window.remaining_ms / 1000)}s left</small>
              </div>
              <i><b style={{ width: `${pct}%`, background: pct > 30 ? C.amber : C.red }} /></i>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ScannerPreview = ({ scannerResults, config, onOpen }) => {
  const threshold = config.scan_pct_threshold || 2
  const top = scannerResults.slice(0, 5)
  return (
    <div className="panel">
      <div className="panel__header">
        <SectionLabel>Scanner</SectionLabel>
        <button className="ghost-button" onClick={onOpen}>Open Scanner</button>
      </div>
      {top.length === 0 ? (
        <div className="empty-panel empty-panel--compact">Waiting for scanner data.</div>
      ) : top.map((opp, i) => {
        const passing = Math.abs(opp.pct) >= threshold
        const color = opp.dir === 'short' ? C.red : C.green
        return (
          <div key={opp.symbol} className="scanner-preview-row" style={{ opacity: passing ? 1 : 0.5 }}>
            <span>#{i + 1}</span>
            <strong>{opp.symbol}</strong>
            <em style={{ color }}>{opp.pct >= 0 ? '+' : ''}{opp.pct.toFixed(2)}%</em>
            <small>{fmtVol(opp.vol)}</small>
            <b style={{ color: passing ? C.green : C.dim }}>{passing ? 'PASS' : 'WAIT'}</b>
          </div>
        )
      })}
    </div>
  )
}

// --- Detail View ---
const StrategyDetailView = ({ s, onBack }) => {
  const { config, scannerResults } = useTradingStore()
  const bestOpp = scannerResults[0] || { symbol: '---', pct: 0, dir: '---' }
  const scanMet = Math.abs(bestOpp.pct) >= config.scan_pct_threshold
  const entryMet = scanMet && s.activeTrades.length > 0

  return (
    <div className="strategy-detail">
      {/* Header */}
      <div className="strategy-detail__header">
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
      <div className="summary-grid">
        <StatCard label="TOTAL P&L" value={fmtUSD(s.totalPnl)} color={pnlColor(s.totalPnl)} />
        <StatCard label="HITS" value={s.logs.filter(l => l.msg.includes('Entry')).length.toString()} />
        <StatCard label="SL USED" value={`$${s.totalSlUsed.toFixed(0)} / $${config.total_sl_guard_usdt}`} color={s.totalSlUsed > config.total_sl_guard_usdt * 0.7 ? C.amber : C.text} />
        <StatCard label="OPEN RISK" value={`${s.totalRiskPct.toFixed(1)}%`} color={s.totalRiskPct > config.max_total_risk_pct * 0.8 ? C.amber : C.text} />
      </div>

      {/* Condition Widgets */}
      <SectionLabel>Entry Conditions</SectionLabel>
      <div className="condition-grid">
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
          sublabel={`${bestOpp.symbol} confirmation`}
        />
      </div>

      {/* Active Position */}
      <SectionLabel>Active Position</SectionLabel>
      <div style={{ marginBottom: 24 }}>
        <ActiveTradeBar trade={s.activeTrades[0]} />
      </div>

      {/* P&L Chart + Timeline */}
      <div className="detail-content-grid">
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
    activeTrades, logs, config, setSessionActive, updateConfig,
    scannerResults, activeWindows, gateState, scannerPaused, rateLimit,
    wsStatus, updateStats
  } = useTradingStore()
  const [loading, setLoading] = useState(false)

  // Mocking the current state as a single strategy object for the card/detail views
  const currentStrategy = {
    sessionActive, totalPnl, totalRiskPct, totalSlUsed, activeTrades, logs
  }

  const maxRR = useMemo(() => activeTrades.reduce((max, trade) => Math.max(max, trade.max_rr || 0), 0), [activeTrades])

  useEffect(() => {
    sessionAPI.rateLimit()
      .then((res) => updateStats({ rateLimit: res.data }))
      .catch(() => {})
  }, [updateStats])

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
    <div className="dashboard-view">
      
      {/* Controls */}
      <div className="dashboard-controls" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <StatusBadge status={sessionActive} />
        {config.paper_mode && <PaperBadge />}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {!sessionActive ? (
            <Btn variant="success" onClick={() => setShowConfig(true)}>{loading ? 'Starting...' : 'New Session'}</Btn>
          ) : (
            <Btn variant="danger" onClick={handleStop}>
              {loading ? 'Stopping...' : 'Stop Session'}
            </Btn>
          )}
        </div>
      </div>

      <RateLimitStrip rateLimit={rateLimit} />
      <GateBanner gateState={gateState} scannerPaused={scannerPaused} />

      <div className="summary-grid dashboard-summary">
        <StatCard label="Account Balance" value={`$${balance.toLocaleString()}`} />
        <StatCard label="Total Session P&L" value={fmtUSD(totalPnl)} color={pnlColor(totalPnl)} />
        <StatCard label="Active Risk" value={`${totalRiskPct.toFixed(1)}%`} color={totalRiskPct > config.max_total_risk_pct * 0.8 ? C.amber : C.text} />
        <StatCard label="Peak Max RR" value={`+${maxRR.toFixed(2)}`} color={C.accent} />
      </div>

      <div className="cockpit-grid">
        <div className="side-context">
          <div className="panel">
            <SectionLabel>Strategy</SectionLabel>
            <div className="strategy-grid">
              <StrategyCard s={currentStrategy} config={config} onClick={() => setSelected(true)} />
              {!sessionActive && (
                <button className="new-strategy-card" onClick={() => setShowConfig(true)}>
                  New Strategy
                </button>
              )}
            </div>
          </div>

          <div className="panel">
            <ActiveWindows windows={activeWindows} />

            <SectionLabel>Active Positions</SectionLabel>
            <div className="active-trade-stack">
              {activeTrades.length === 0
                ? <div className="empty-panel">{sessionActive ? `Scanner is live (${wsStatus}). No open position yet.` : 'Start a session to begin scanning.'}</div>
                : activeTrades.map((trade) => <ActiveTradeBar key={trade.id || trade.symbol} trade={trade} />)}
            </div>
          </div>
        </div>

        <div className="side-context">
          <ScannerPreview scannerResults={scannerResults} config={config} onOpen={() => window.dispatchEvent(new CustomEvent('open-scanner'))} />
          <div className="panel">
            <SectionLabel>Decision Log</SectionLabel>
            <DecisionLog />
          </div>
        </div>
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
