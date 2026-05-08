import React, { useState } from 'react'
import { C, fmtVol } from '../lib/theme'
import { PulseDot } from './ui/primitives'
import { useTradingStore } from '../store/trading'

export const ScannerOverlay = ({ onClose }) => {
  const { scannerResults, config } = useTradingStore()
  const threshold = config.scan_pct_threshold || 2.0

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, width: 640, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PulseDot color={C.green} />
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Live Scanner</span>
            <span style={{ fontSize: 10, color: C.dim }}>threshold ≥ {threshold}%</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        
        <div style={{ padding: "8px 14px 4px", display: "grid", gridTemplateColumns: "24px 1fr 80px 80px 80px 60px", gap: 12, fontSize: 10, color: C.dim, letterSpacing: 1, borderBottom: `1px solid ${C.border}` }}>
          <span>#</span><span>SYMBOL</span><span style={{ textAlign: "right" }}>MOVE</span><span style={{ textAlign: "right" }}>VOLUME</span><span>SCORE</span><span style={{ textAlign: "center" }}>PASS</span>
        </div>

        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {scannerResults.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.dim, fontSize: 13 }}>Waiting for scanner data...</div>
          ) : (
            scannerResults.map((opp, i) => {
              const passing = Math.abs(opp.pct) >= threshold
              return (
                <div key={opp.symbol} style={{ 
                  display: "grid", gridTemplateColumns: "24px 1fr 80px 80px 80px 60px", 
                  alignItems: "center", gap: 12, padding: "10px 14px", 
                  borderBottom: `1px solid ${C.border}`, opacity: passing ? 1 : 0.4 
                }}>
                  <span style={{ fontSize: 11, color: C.dim, fontFamily: "monospace" }}>#{i + 1}</span>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>{opp.symbol.replace("USDT", "")}</span>
                    <span style={{ fontSize: 10, color: C.dim }}>/USDT</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: opp.pct >= 0 ? C.green : C.red, textAlign: "right" }}>
                    {opp.pct >= 0 ? "▲" : "▼"} {Math.abs(opp.pct).toFixed(2)}%
                  </span>
                  <span style={{ fontSize: 11, color: C.dim, fontFamily: "monospace", textAlign: "right" }}>{fmtVol(opp.vol)}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2 }}>
                      <div style={{ width: `${(opp.score / 10) * 100}%`, height: "100%", background: C.accent, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, color: C.dim, fontFamily: "monospace", minWidth: 24 }}>{opp.score.toFixed(1)}</span>
                  </div>
                  {passing
                    ? <span style={{ fontSize: 10, fontWeight: 700, color: C.green, textAlign: "center" }}>✓</span>
                    : <span style={{ fontSize: 10, color: C.dim, textAlign: "center" }}>—</span>}
                </div>
              )
            })
          )}
        </div>

        <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.dim, textAlign: "center" }}>
          WS: !miniTicker@arr + kline · Real-time updates
        </div>
      </div>
    </div>
  )
}
