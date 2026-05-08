import React from 'react'
import { C } from '../lib/theme'

export const TopBar = ({ balance, totalRisk, onKill, sessionActive }) => {
  return (
    <div style={{ height: 52, background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 20px", gap: 20, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: "auto" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: 0.5 }}>MOMENTUM ENGINE</span>
      </div>
      <div>
        <span style={{ fontSize: 10, color: C.dim }}>BALANCE </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>${balance.toLocaleString()}</span>
      </div>
      <div>
        <span style={{ fontSize: 10, color: C.dim }}>OPEN RISK </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: totalRisk > 3 ? C.amber : C.text, fontFamily: "monospace" }}>{totalRisk.toFixed(1)}%</span>
      </div>
      <button onClick={onKill} style={{ 
        padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.redBorder}`, 
        background: C.redDim, color: C.red, fontSize: 11, fontWeight: 700, 
        cursor: "pointer", letterSpacing: 1 
      }}>
        ⬛ KILL
      </button>
    </div>
  )
}
