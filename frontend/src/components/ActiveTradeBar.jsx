import React from 'react'
import { C, pnlColor, fmtUSD, fmt } from '../lib/theme'
import { PulseDot } from './ui/primitives'

export const ActiveTradeBar = ({ trade }) => {
  if (!trade) return (
    <div style={{ padding: "16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, textAlign: "center", color: C.dim, fontSize: 13 }}>
      No active position — scanning…
    </div>
  );

  const slDist = ((Math.abs(trade.entry_price - trade.sl_price) / trade.entry_price) * 100).toFixed(2);
  const tpDist = ((Math.abs(trade.tp_price - trade.entry_price) / trade.entry_price) * 100).toFixed(2);
  
  // Progress calculation for the bar
  const range = Math.abs(trade.tp_price - trade.sl_price);
  const progress = range > 0 
    ? Math.max(0, Math.min(100, (Math.abs(trade.current_price - trade.sl_price) / range) * 100))
    : 50;

  return (
    <div style={{ padding: 16, borderRadius: 8, border: `1px solid ${C.greenBorder}`, background: C.greenDim }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PulseDot color={C.green} />
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>{trade.symbol}</span>
          <span style={{ 
            fontSize: 11, padding: "2px 7px", borderRadius: 4, background: trade.direction === 'LONG' ? C.greenDim : C.redDim, 
            color: trade.direction === 'LONG' ? C.green : C.red, fontWeight: 700, border: `1px solid ${trade.direction === 'LONG' ? C.greenBorder : C.redBorder}` 
          }}>
            {trade.direction}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: pnlColor(trade.pnl), fontFamily: "monospace" }}>{fmtUSD(trade.pnl)}</div>
          <div style={{ fontSize: 11, color: C.dim }}>R:R {fmt(trade.rr || 0, 1)}</div>
        </div>
      </div>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        {[
          ["ENTRY", `$${trade.entry_price.toLocaleString()}`], 
          ["CURRENT", `$${trade.current_price.toLocaleString()}`], 
          ["QTY", `${trade.qty}`]
        ].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3, letterSpacing: 1 }}>{k}</div>
            <div style={{ fontSize: 13, color: C.text, fontFamily: "monospace", fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10, color: C.dim }}>
        <span style={{ color: C.red }}>SL ${trade.sl_price} (−{slDist}%)</span>
        <span style={{ color: C.green }}>TP ${trade.tp_price} (+{tpDist}%)</span>
      </div>
      
      <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: `linear-gradient(90deg, ${C.red}40, ${C.green}40)` }} />
        <div style={{ 
          position: "absolute", left: `${progress}%`, top: -2, width: 10, height: 10, 
          borderRadius: "50%", background: C.green, border: `2px solid ${C.bg}`, 
          transform: "translateX(-50%)", transition: 'left 0.3s ease-out'
        }} />
      </div>
    </div>
  );
}
