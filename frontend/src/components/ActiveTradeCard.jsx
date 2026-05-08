import React from 'react'
import { C, fmtUSD, pnlColor } from '../lib/theme'

export const ActiveTradeCard = ({ trade }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontWeight: 'bold' }}>{trade.symbol} <span style={{ color: trade.direction === 'LONG' ? C.green : C.red }}>{trade.direction}</span></div>
      <div style={{ color: pnlColor(trade.pnl) }}>{fmtUSD(trade.pnl)}</div>
    </div>
    <div style={{ fontSize: 12, color: C.dim }}>
      Entry: {fmtUSD(trade.entry_price)} | Qty: {trade.qty}
    </div>
  </div>
)
