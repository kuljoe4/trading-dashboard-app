import React, { useEffect } from 'react'
import { C, fmtUSD, pnlColor } from '../lib/theme'
import { sessionAPI } from '../api/client'
import { useTradingStore } from '../store/trading'
import { SectionLabel } from '../components/ui/primitives'

const price = (value) => value == null ? 'None' : `$${Number(value).toFixed(Number(value) >= 100 ? 2 : 6).replace(/0+$/, '').replace(/\.$/, '')}`

export const HistoryView = () => {
  const { tradeHistory, updateStats, sessionSummary } = useTradingStore()
  const totalPnl = tradeHistory.reduce((sum, trade) => sum + (trade.pnl || 0), 0)
  const wins = tradeHistory.filter((trade) => (trade.pnl || 0) > 0).length
  const ratchets = tradeHistory.filter((trade) => trade.exit_reason?.toLowerCase().includes('sl') && (trade.max_rr || 0) > 0).length

  useEffect(() => {
    sessionAPI.history()
      .then((res) => updateStats({ tradeHistory: res.data.trades || [] }))
      .catch(() => {})
  }, [updateStats])

  return (
    <div className="dashboard-view">
      <div>
        <SectionLabel>Session Summary</SectionLabel>
        <div className="summary-grid">
          <div className="history-stat"><span>Total P&L</span><strong style={{ color: pnlColor(totalPnl) }}>{fmtUSD(totalPnl)}</strong></div>
          <div className="history-stat"><span>Trades</span><strong>{tradeHistory.length}</strong></div>
          <div className="history-stat"><span>Win Rate</span><strong>{tradeHistory.length ? `${Math.round((wins / tradeHistory.length) * 100)}%` : '0%'}</strong></div>
          <div className="history-stat"><span>SL Ratchets</span><strong style={{ color: C.accent }}>{ratchets}</strong></div>
        </div>
      </div>

      {sessionSummary && (
        <div className="gate-banner gate-banner--warn">
          Last session ended. Final tracked P&L was {fmtUSD(sessionSummary.totalPnl)} across {sessionSummary.tradeCount} closed trades.
        </div>
      )}

      <div>
        <SectionLabel>Closed Trades</SectionLabel>
        {tradeHistory.length === 0 ? (
          <div className="empty-panel">No closed trades yet. Completed positions will appear here after stop-loss, take-profit, signal exit, or session stop events.</div>
        ) : (
          <div className="history-list">
            {tradeHistory.map((trade, i) => (
              <div key={`${trade.id || trade.symbol}-${i}`} className="history-row">
                <div>
                  <strong>{trade.symbol}</strong>
                  <span>{trade.direction}</span>
                </div>
                <div>
                  <span>Entry</span>
                  <strong>{price(trade.entry_price)}</strong>
                </div>
                <div>
                  <span>Exit</span>
                  <strong>{price(trade.exit_price)}</strong>
                </div>
                <div>
                  <span>Reason</span>
                  <strong>{trade.exit_reason || trade.status || 'Closed'}</strong>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span>Result</span>
                  <strong style={{ color: pnlColor(trade.pnl || 0) }}>{fmtUSD(trade.pnl || 0)}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
