import React from 'react'
import { C, fmtVol } from '../lib/theme'
import { PulseDot } from './ui/primitives'
import { useTradingStore } from '../store/trading'

export const ScannerOverlay = ({ onClose }) => {
  const { scannerResults, activeWindows, config, scannerPaused, gateState } = useTradingStore()
  const threshold = config.scan_pct_threshold || 2.0

  return (
    <div className="scanner-overlay">
      <div className="scanner-panel" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PulseDot color={C.green} />
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Live Scanner</span>
            <span style={{ fontSize: 10, color: C.dim }}>threshold ≥ {threshold}%</span>
            {scannerPaused && <span style={{ fontSize: 10, color: C.red }}>paused: {gateState}</span>}
          </div>
          <button onClick={onClose} className="icon-button" aria-label="Close scanner">Close</button>
        </div>

        {activeWindows.length > 0 && (
          <div className="active-window-strip">
            {activeWindows.map((window) => (
              <div key={window.symbol}>
                <strong style={{ color: window.direction === 'long' ? C.green : C.red }}>{window.symbol}</strong>
                <span>{Math.round(window.remaining_ms / 1000)}s</span>
              </div>
            ))}
          </div>
        )}
        
        <div className="scanner-row scanner-row--head" style={{ color: C.dim, borderBottom: `1px solid ${C.border}` }}>
          <span>#</span><span>SYMBOL</span><span style={{ textAlign: "right" }}>MOVE</span><span style={{ textAlign: "right" }}>VOLUME</span><span>SCORE</span><span style={{ textAlign: "center" }}>PASS</span>
        </div>

        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {scannerResults.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.dim, fontSize: 13 }}>Waiting for scanner data...</div>
          ) : (
            scannerResults.map((opp, i) => {
              const passing = Math.abs(opp.pct) >= threshold
              const dir = (opp.dir || opp.direction || '').toLowerCase()
              const isLong = dir ? dir === 'long' : opp.pct >= 0
              return (
                <div key={opp.symbol} className="scanner-row" style={{ borderBottom: `1px solid ${C.border}`, opacity: passing ? 1 : 0.45 }}>
                  <span style={{ fontSize: 11, color: C.dim, fontFamily: "monospace" }}>#{i + 1}</span>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>{opp.symbol.replace("USDT", "")}</span>
                    <span style={{ fontSize: 10, color: C.dim }}>/USDT</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: isLong ? C.green : C.red, textAlign: "right" }}>
                    {isLong ? "▲" : "▼"} {Math.abs(opp.pct).toFixed(2)}%
                  </span>
                  <span style={{ fontSize: 11, color: C.dim, fontFamily: "monospace", textAlign: "right" }}>{fmtVol(opp.vol)}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2 }}>
                      <div style={{ width: `${(opp.score / 10) * 100}%`, height: "100%", background: C.accent, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, color: C.dim, fontFamily: "monospace", minWidth: 24 }}>{opp.score.toFixed(1)}</span>
                  </div>
                  {passing
                    ? <span style={{ fontSize: 10, fontWeight: 700, color: C.green, textAlign: "center" }}>PASS</span>
                    : <span style={{ fontSize: 10, color: C.dim, textAlign: "center" }}>WAIT</span>}
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
