import React from 'react'
import { C, pnlColor, fmtUSD, fmt } from '../lib/theme'
import { PulseDot, PaperBadge } from './ui/primitives'

const price = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'None'
  const n = Number(value)
  return n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

const Pill = ({ children, color = C.text, bg = C.surface, border = C.border }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 22,
    padding: '2px 7px',
    borderRadius: 4,
    border: `1px solid ${border}`,
    background: bg,
    color,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
  }}>
    {children}
  </span>
)

const RRLadder = ({ trade }) => {
  const triggers = trade.live_rr_sequence || []
  const exits = trade.exit_rr_sequence || []
  const maxRR = trade.max_rr || 0
  const liveRR = trade.rr || 0
  const risk = Math.abs(trade.entry_price - trade.initial_sl)
  const activeIdx = triggers.reduce((idx, trigger, i) => maxRR >= trigger ? i : idx, -1)
  const currentExitRR = activeIdx >= 0 ? exits[activeIdx] : null
  const currentSl = currentExitRR == null
    ? trade.initial_sl
    : trade.direction === 'LONG'
      ? trade.entry_price + risk * currentExitRR
      : trade.entry_price - risk * currentExitRR
  const maxTarget = triggers[triggers.length - 1] || 1
  const livePct = Math.max(0, Math.min((liveRR / maxTarget) * 100, 100))
  const maxPct = Math.max(0, Math.min((maxRR / maxTarget) * 100, 100))
  const next = activeIdx + 1

  return (
    <div style={{ border: `1px solid ${C.accent}55`, background: C.accentDim, borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 1 }}>EXP RR BODYGUARD</div>
        <div style={{ fontSize: 10, color: C.dim }}>ticker-only</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(triggers.length, 1)}, minmax(54px, 1fr))`, gap: 6, marginBottom: 12, overflowX: 'auto' }}>
        {triggers.map((trigger, i) => {
          const done = maxRR >= trigger
          const current = i === activeIdx
          const color = current ? C.accent : done ? C.green : C.dim
          return (
            <div key={`${trigger}-${i}`} style={{ minWidth: 54 }}>
              <div style={{ fontSize: 10, color, fontWeight: done ? 700 : 500 }}>{trigger}R</div>
              <div style={{ height: 3, background: done ? color : C.border, borderRadius: 2, margin: '5px 0' }} />
              <div style={{ fontSize: 9, color: done ? C.text : C.dim }}>
                SL {exits[i] === 0 ? 'BE' : `${exits[i]}R`}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ position: 'relative', height: 18, marginBottom: 12 }}>
        <div style={{ position: 'absolute', top: 7, left: 0, right: 0, height: 5, background: C.border, borderRadius: 3 }} />
        <div style={{ position: 'absolute', top: 7, left: 0, height: 5, width: `${maxPct}%`, background: C.greenBorder, borderRadius: 3 }} />
        <div style={{ position: 'absolute', top: 7, left: 0, height: 5, width: `${livePct}%`, background: C.accent, borderRadius: 3, transition: 'width 0.4s ease' }} />
        <div style={{ position: 'absolute', top: 2, left: `${livePct}%`, width: 11, height: 11, borderRadius: 999, background: C.accent, border: `2px solid ${C.bg}`, transform: 'translateX(-50%)', transition: 'left 0.4s ease' }} />
      </div>

      <div className="rr-ladder__stats">
        <div>
          <span>LIVE RR</span>
          <strong style={{ color: pnlColor(liveRR) }}>{fmt(liveRR, 2)}</strong>
        </div>
        <div>
          <span>PEAK RR</span>
          <strong style={{ color: C.accent }}>{fmt(maxRR, 2)}</strong>
        </div>
        <div>
          <span>RATCHET SL</span>
          <strong style={{ color: activeIdx >= 0 ? C.green : C.dim }}>{price(currentSl)}</strong>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: C.dim }}>
        {next < triggers.length
          ? <>Next lock at <span style={{ color: C.accent }}>{triggers[next]}R</span></>
          : <span style={{ color: C.green }}>All configured locks have fired</span>}
      </div>
    </div>
  )
}

export const ActiveTradeBar = ({ trade, compact = false }) => {
  if (!trade) return (
    <div style={{ padding: 18, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.dim, fontSize: 13 }}>
      No active position. Scanner is waiting for a qualified setup.
    </div>
  )

  const direction = trade.direction?.toUpperCase()
  const isLong = direction === 'LONG'
  const isExpRR = trade.tp_mode === 'exp_rr_seq'
  const slDist = trade.entry_price ? ((Math.abs(trade.entry_price - trade.sl_price) / trade.entry_price) * 100).toFixed(2) : '0.00'
  const risk = Math.abs(trade.entry_price - (trade.initial_sl || trade.sl_price))
  const fixedTarget = trade.tp_price
  const runwayEnd = fixedTarget ?? (isLong ? trade.entry_price + risk * 4 : trade.entry_price - risk * 4)
  const range = Math.abs(runwayEnd - trade.sl_price)
  const progress = range > 0
    ? Math.max(0, Math.min(100, (Math.abs(trade.current_price - trade.sl_price) / range) * 100))
    : 50

  return (
    <div style={{
      padding: compact ? 12 : 16,
      borderRadius: 8,
      border: `1px solid ${trade.pnl >= 0 ? C.greenBorder : C.redBorder}`,
      background: trade.pnl >= 0 ? C.greenDim : C.redDim,
    }}>
      <div className="active-trade__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <PulseDot color={trade.pnl >= 0 ? C.green : C.red} />
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: 'monospace' }}>{trade.symbol}</span>
          <Pill color={isLong ? C.green : C.red} bg={isLong ? C.greenDim : C.redDim} border={isLong ? C.greenBorder : C.redBorder}>{direction}</Pill>
          <Pill color={isExpRR ? C.accent : C.green} bg={isExpRR ? C.accentDim : C.greenDim} border={isExpRR ? C.accent : C.greenBorder}>
            {isExpRR ? 'EXP RR' : `FIXED ${trade.tp_ratio}R`}
          </Pill>
          {trade.paper_mode && <PaperBadge />}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: pnlColor(trade.pnl), fontFamily: 'monospace' }}>{fmtUSD(trade.pnl)}</div>
          <div style={{ fontSize: 11, color: C.dim }}>R:R {fmt(trade.rr || 0, 2)}</div>
        </div>
      </div>

      <div className="active-trade__metrics">
        {[
          ['ENTRY', price(trade.entry_price)],
          ['CURRENT', price(trade.current_price)],
          ['QTY', `${trade.qty}`],
        ].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3, letterSpacing: 1 }}>{k}</div>
            <div style={{ fontSize: 13, color: C.text, fontFamily: 'monospace', fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 8, fontSize: 10, color: C.dim }}>
        <span style={{ color: C.red }}>SL {price(trade.sl_price)} ({slDist}%)</span>
        <span style={{ color: fixedTarget == null ? C.accent : C.green }}>{fixedTarget == null ? 'No fixed TP' : `TP ${price(fixedTarget)}`}</span>
      </div>

      <div style={{ height: 7, background: C.border, borderRadius: 4, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '100%', borderRadius: 4, background: `linear-gradient(90deg, ${C.red}35, ${C.green}35)` }} />
        <div style={{
          position: 'absolute',
          left: `${progress}%`,
          top: -3,
          width: 13,
          height: 13,
          borderRadius: '50%',
          background: pnlColor(trade.pnl),
          border: `2px solid ${C.bg}`,
          transform: 'translateX(-50%)',
          transition: 'left 0.3s ease-out, background 0.3s',
        }} />
      </div>

      {isExpRR && <RRLadder trade={trade} />}
    </div>
  )
}
