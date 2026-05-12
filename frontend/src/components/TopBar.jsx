import React from 'react'
import { C } from '../lib/theme'
import { PaperBadge, PulseDot, Btn } from './ui/primitives'

export const TopBar = ({ balance, totalRisk, onKill, sessionActive, paperMode, wsStatus }) => {
  const wsColor = wsStatus === 'live' ? C.green : wsStatus === 'connecting' ? C.amber : C.red
  return (
    <div className="top-bar" style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
      <div className="top-bar__brand">
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: 0.5 }}>MOMENTUM ENGINE</span>
        {paperMode && <PaperBadge />}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: wsColor, fontSize: 10 }}>
          <PulseDot color={wsColor} /> {wsStatus.toUpperCase()}
        </span>
      </div>
      <div className="top-bar__metric">
        <span style={{ fontSize: 10, color: C.dim }}>BALANCE </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>${balance.toLocaleString()}</span>
      </div>
      <div className="top-bar__metric">
        <span style={{ fontSize: 10, color: C.dim }}>OPEN RISK </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: totalRisk > 3 ? C.amber : C.text, fontFamily: "monospace" }}>{totalRisk.toFixed(1)}%</span>
      </div>
      <Btn
        variant="danger"
        onClick={onKill}
        className="top-bar__kill"
        aria-label="Kill all sessions"
        style={{ fontSize: 11, letterSpacing: 1 }}
      >
        KILL SESSION
      </Btn>
    </div>
  )
}
