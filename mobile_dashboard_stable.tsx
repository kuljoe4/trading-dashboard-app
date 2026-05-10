import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react"

// ── Theme ─────────────────────────────────────────────────────────────────────
const C = {
  bg:'#080c12',surf:'#0d1420',surf2:'#111b28',brd:'#1a2535',brd2:'#243040',
  tx:'#c8d6ea',tx2:'#7a95b8',tx3:'#3d5470',
  grn:'#00e5a0',grn2:'#00e5a014',grn3:'#00e5a035',
  red:'#ff4466',red2:'#ff446614',red3:'#ff446635',
  amb:'#f5a623',amb2:'#f5a62314',amb3:'#f5a62335',
  acc:'#5b6fff',acc2:'#5b6fff18',acc3:'#5b6fff45',
  pur:'#a78bff',pur2:'#a78bff15',pur3:'#a78bff40',
}
const M  = { fontFamily:"'IBM Plex Mono',ui-monospace,monospace" }
const pnlC = n => n >= 0 ? C.grn : C.red
const fmtU = n => n >= 0 ? `+$${Math.abs(n).toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`
const fmtV = v => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${(v/1e3).toFixed(0)}K`

// ── Atoms ─────────────────────────────────────────────────────────────────────
const Dot = memo(({ color = C.grn, size = 8 }) => (
  <span style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center', width:size, height:size, flexShrink:0 }}>
    <span style={{ position:'absolute', width:size, height:size, borderRadius:'50%', background:color, opacity:.3, animation:'ping 1.6s ease infinite' }} />
    <span style={{ width:size*.6, height:size*.6, borderRadius:'50%', background:color, flexShrink:0 }} />
  </span>
))

const Pill = memo(({ label, color, bg, border, dot, size=9 }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:5, border:`1px solid ${border}`, background:bg, fontSize:size, fontWeight:700, letterSpacing:.6, color, ...M }}>
    {dot && <Dot color={color} size={6} />}{label}
  </span>
))

const Tap = ({ children, onPress, style: s = {} }) => (
  <div onClick={onPress} style={{ cursor:'pointer', WebkitTapHighlightColor:'transparent', ...s }}>{children}</div>
)

const Card = memo(({ children, style: s = {}, border = C.brd }) => (
  <div style={{ background:C.surf, border:`1px solid ${border}`, borderRadius:12, ...s }}>{children}</div>
))

const SL = ({ children, style: s = {} }) => (
  <div style={{ fontSize:9, color:C.tx3, letterSpacing:1.5, fontWeight:700, marginBottom:8, ...M, ...s }}>{children}</div>
)

const ModeChip = memo(({ label, active, onPress, color = C.acc }) => (
  <Tap onPress={onPress} style={{ padding:'7px 14px', borderRadius:7, border:`1px solid ${active ? color+'50' : C.brd}`, background:active ? color+'18' : 'none', color:active ? color : C.tx3, fontSize:11, fontWeight:700, ...M, textAlign:'center' }}>
    {label}
  </Tap>
))

const Toggle = memo(({ value, onChange, label, color = C.acc }) => (
  <Tap onPress={() => onChange(!value)} style={{ display:'flex', alignItems:'center', gap:12 }}>
    <div style={{ width:46, height:26, borderRadius:13, background:value ? color : C.brd2, position:'relative', transition:'background .2s', flexShrink:0 }}>
      <div style={{ position:'absolute', top:3, left:value ? 23 : 3, width:20, height:20, borderRadius:'50%', background:'#fff', transition:'left .2s' }} />
    </div>
    {label && <span style={{ fontSize:13, color:value ? C.tx : C.tx2, ...M }}>{label}</span>}
  </Tap>
))

// ── Rate limit strip (only re-renders when weight changes) ────────────────────
const RLStrip = memo(({ weight }) => {
  const pct = weight / 2400 * 100
  const col = pct >= 90 ? C.red : pct >= 70 ? C.amb : C.grn
  return (
    <div style={{ background:C.surf2, borderBottom:`1px solid ${C.brd}`, padding:'5px 14px', display:'flex', gap:10, alignItems:'center', flexShrink:0 }}>
      <span style={{ fontSize:8, color:C.tx3, letterSpacing:1, ...M, flexShrink:0 }}>LIMITS</span>
      {[
        { l:'W/1M',  v:`${weight}/2400`, p:pct,  c:col },
        { l:'ORD',   v:'3/1200',         p:.25,  c:C.grn },
        { l:'WS',    v:'52/200',         p:26,   c:C.grn },
      ].map(r => (
        <div key={r.l} style={{ flex:1 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, ...M }}>
            <span style={{ color:C.tx3 }}>{r.l}</span>
            <span style={{ color:r.c, fontWeight:700 }}>{r.v}</span>
          </div>
          <div style={{ height:2, background:C.brd, borderRadius:1, marginTop:2 }}>
            <div style={{ width:`${Math.min(r.p,100)}%`, height:'100%', background:r.c, borderRadius:1, transition:'width .8s' }} />
          </div>
        </div>
      ))}
      <Pill label={pct >= 90 ? 'CRIT' : pct >= 70 ? 'WARN' : 'OK'} color={col} bg={col+'14'} border={col+'35'} size={8} />
    </div>
  )
})

// ── RR Ladder — stable structure, only numbers animate ───────────────────────
const RRLadder = memo(({ lrr, err, maxRR, liveRR, slDistAbs, entry, side, initialSL }) => {
  let activeIdx = -1
  for (let i = 0; i < lrr.length; i++) if (maxRR >= lrr[i]) activeIdx = i

  const slRR      = activeIdx >= 0 ? err[activeIdx] : null
  const slLabel   = slRR == null ? 'Initial SL' : slRR === 0 ? 'Breakeven' : `+${slRR}R locked`
  const currentSL = slRR == null
    ? initialSL.toFixed(4)
    : side === 'long'
      ? (entry + slDistAbs * slRR).toFixed(4)
      : (entry - slDistAbs * slRR).toFixed(4)

  const maxT    = lrr[lrr.length - 1] || 1
  const livePct = Math.max(0, Math.min((liveRR / maxT) * 100, 100))
  const maxPct  = Math.max(0, Math.min((maxRR  / maxT) * 100, 100))
  const nextIdx = activeIdx + 1

  return (
    <div style={{ background:C.bg, border:`1px solid ${C.pur3}`, borderRadius:10, padding:14, marginTop:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <span style={{ fontSize:9, color:C.pur, fontWeight:700, letterSpacing:.8, ...M }}>⟳ PROFIT BODYGUARD</span>
        <span style={{ fontSize:8, color:C.tx3, ...M }}>ticker-only · zero REST</span>
      </div>

      {/* Step pills — structural, won't rerender unless lrr/maxRR changes */}
      <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:12, overflowX:'auto' }}>
        {lrr.map((trigger, i) => {
          const triggered = maxRR >= trigger
          const isCur = i === activeIdx
          const col = isCur ? C.pur : triggered ? C.grn : C.tx3
          return [
            <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, minWidth:52 }}>
              <span style={{ fontSize:9, color:col, fontWeight:triggered ? 700 : 400, ...M }}>{triggered ? '✓' : '○'} {trigger}R</span>
              <div style={{ height:3, width:'100%', background:triggered ? col : C.brd, borderRadius:2, transition:'background .6s' }} />
              <span style={{ fontSize:8, color:triggered ? C.tx2 : C.tx3, ...M }}>→{err[i] === 0 ? 'BE' : `+${err[i]}R`}</span>
            </div>,
            i < lrr.length - 1 && <span key={`a${i}`} style={{ color:C.tx3, fontSize:10 }}>›</span>,
          ]
        })}
      </div>

      {/* Progress track — width transitions smoothly, no DOM teardown */}
      <div style={{ position:'relative', height:20, marginBottom:12 }}>
        <div style={{ position:'absolute', top:7, left:0, right:0, height:6, background:C.brd, borderRadius:3 }} />
        <div style={{ position:'absolute', top:7, left:0, height:6, width:`${maxPct}%`, background:C.pur2, borderRadius:3, transition:'width .8s ease' }} />
        <div style={{ position:'absolute', top:7, left:0, height:6, width:`${livePct}%`, background:C.pur, borderRadius:3, transition:'width .8s ease' }} />
        {lrr.map((t,i) => (
          <div key={i} style={{ position:'absolute', top:5, left:`${Math.min((t/maxT)*100,100)}%`, transform:'translateX(-50%)', width:1, height:10, background:C.brd2 }} />
        ))}
        {/* Needle — transitions with the width, no flicker */}
        <div style={{ position:'absolute', top:2, left:`${livePct}%`, transform:'translateX(-50%)', transition:'left .8s ease', display:'flex', flexDirection:'column', alignItems:'center' }}>
          <div style={{ width:2, height:5, background:C.pur }} />
          <div style={{ width:12, height:12, borderRadius:'50%', background:C.pur, border:`2px solid ${C.bg}` }} />
        </div>
        {maxRR > liveRR + 0.05 && (
          <span style={{ position:'absolute', top:0, left:`${maxPct}%`, transform:'translateX(-50%)', fontSize:8, color:C.grn, whiteSpace:'nowrap', ...M }}>↓{maxRR.toFixed(1)}R</span>
        )}
      </div>

      {/* Stats grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:10 }}>
        {[
          ['LIVE R:R',    `${liveRR >= 0 ? '+' : ''}${liveRR.toFixed(2)}`, C.pur,   C.surf],
          ['PEAK max_rr', `+${maxRR.toFixed(2)}`,                           C.grn,   C.surf],
          ['SL RATCHET',  slLabel,                              activeIdx >= 0 ? C.grn : C.tx3, activeIdx >= 0 ? C.grn2 : C.surf],
        ].map(([k, v, col, bg]) => (
          <div key={k} style={{ background:bg, border:`1px solid ${col}30`, borderRadius:8, padding:'8px 10px' }}>
            <div style={{ fontSize:8, color:C.tx3, marginBottom:2, letterSpacing:.8, ...M }}>{k}</div>
            <div style={{ fontSize:12, fontWeight:700, color:col, ...M, lineHeight:1.2 }}>{v}</div>
            {k === 'SL RATCHET' && <div style={{ fontSize:8, color:C.tx3, marginTop:2, ...M }}>@ ${currentSL}</div>}
          </div>
        ))}
      </div>

      <div style={{ fontSize:9, color:C.tx3, ...M }}>
        {nextIdx < lrr.length
          ? <><span style={{ color:C.pur }}>Next: +{lrr[nextIdx]}R</span> → <span style={{ color:C.grn }}>{err[nextIdx] === 0 ? 'Breakeven' : `+${err[nextIdx]}R`}</span> · need <span style={{ color:C.pur }}>{Math.max(0, lrr[nextIdx] - maxRR).toFixed(2)}R</span></>
          : <span style={{ color:C.grn }}>All steps triggered ✓</span>}
      </div>
    </div>
  )
})

// ── Trade Card — memo so it only re-renders when its own trade data changes ───
const TradeCard = memo(({ trade }) => {
  const [expanded, setExpanded] = useState(true)
  const isRR  = trade.tp_mode === 'exp_rr_seq'
  const slPct = ((Math.abs(trade.entry - trade.initial_sl) / trade.entry) * 100).toFixed(2)
  const mc    = isRR ? C.pur : C.acc
  const prog  = useMemo(() => {
    if (isRR || !trade.tp) return 0
    const p = trade.side === 'long'
      ? ((trade.current - trade.sl) / (trade.tp - trade.sl)) * 100
      : ((trade.sl - trade.current) / (trade.sl - trade.tp)) * 100
    return Math.max(0, Math.min(100, p))
  }, [isRR, trade.current, trade.sl, trade.tp, trade.side])

  return (
    <Card border={isRR ? C.pur3 : C.grn3} style={{ marginBottom:12, overflow:'hidden' }}>
      <Tap onPress={() => setExpanded(e => !e)} style={{ padding:'14px 14px 0' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <Dot color={C.grn} />
            <span style={{ fontSize:16, fontWeight:700, color:C.tx, ...M }}>{trade.symbol}</span>
            <Pill label={trade.side.toUpperCase()} color={trade.side==='long'?C.grn:C.red} bg={trade.side==='long'?C.grn2:C.red2} border={trade.side==='long'?C.grn3:C.red3} size={10} />
            <Pill label={isRR ? '⟳ EXP-RR' : `Fixed ${trade.tp_ratio}R`} color={mc} bg={mc+'18'} border={mc+'40'} size={9} />
          </div>
          {/* PnL updates in place — no DOM rebuild */}
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <div style={{ fontSize:20, fontWeight:700, color:pnlC(trade.live_pnl), ...M, transition:'color .3s' }}>{fmtU(trade.live_pnl)}</div>
            <div style={{ fontSize:10, color:C.tx3, ...M }}>R:R {trade.live_rr >= 0 ? '+' : ''}{trade.live_rr.toFixed(2)}</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
          {[['ENTRY', `$${trade.entry}`], ['CURRENT', `$${trade.current.toFixed(4)}`]].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize:8, color:C.tx3, letterSpacing:.8, marginBottom:1, ...M }}>{k}</div>
              <div style={{ fontSize:14, fontWeight:600, color:C.tx, ...M }}>{v}</div>
            </div>
          ))}
        </div>

        {!isRR && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, marginBottom:6 }}>
              <span style={{ color:C.red, ...M }}>SL ${trade.sl} (−{slPct}%)</span>
              <span style={{ color:C.grn, ...M }}>TP ${trade.tp}</span>
            </div>
            <div style={{ height:5, background:C.brd, borderRadius:3, overflow:'visible', position:'relative', marginBottom:4 }}>
              <div style={{ position:'absolute', inset:0, borderRadius:3, background:`linear-gradient(90deg,${C.red}20,${C.grn}20)` }} />
              {/* Needle transitions smoothly — no remount */}
              <div style={{ position:'absolute', left:`${prog}%`, top:'50%', transform:'translate(-50%,-50%)', width:12, height:12, borderRadius:'50%', background:pnlC(trade.live_pnl), border:`2px solid ${C.bg}`, transition:'left .8s ease, background .3s' }} />
            </div>
          </>
        )}
      </Tap>

      {expanded && (
        <div style={{ padding:'0 14px 14px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:isRR ? 0 : 8 }}>
            {[['QTY', trade.qty], ['NOTIONAL', `$${trade.notional}`], ['SL MODE', trade.sl_mode === 'lookback_hl' ? 'HL Lookback' : 'Fixed %'], ['MODE', trade.paper_mode ? 'Paper' : 'Live']].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize:8, color:C.tx3, letterSpacing:.8, marginBottom:1, ...M }}>{k}</div>
                <div style={{ fontSize:12, fontWeight:600, color:C.tx, ...M }}>{v}</div>
              </div>
            ))}
          </div>
          {isRR && (
            <RRLadder
              lrr={trade.live_rr_sequence}
              err={trade.exit_rr_sequence}
              maxRR={trade.max_rr}
              liveRR={trade.live_rr}
              slDistAbs={trade.sl_dist_abs}
              entry={trade.entry}
              side={trade.side}
              initialSL={trade.initial_sl}
            />
          )}
        </div>
      )}
    </Card>
  )
})

// ── Active window row — stable ─────────────────────────────────────────────────
const WindowRow = memo(({ win }) => {
  const pct = useMemo(() => Math.max(0, Math.min(100, (win.remaining_ms / (90 * 1000)) * 100)), [win.remaining_ms])
  const secs = Math.round(win.remaining_ms / 1000)
  return (
    <div style={{ padding:'10px 14px', borderBottom:`1px solid ${C.brd}`, display:'flex', alignItems:'center', gap:10 }}>
      <Dot color={win.direction === 'long' ? C.grn : C.red} size={7} />
      <span style={{ fontSize:13, fontWeight:700, ...M }}>{win.symbol.replace('USDT','')}</span>
      <Pill label={win.direction.toUpperCase()} color={win.direction==='long'?C.grn:C.red} bg={win.direction==='long'?C.grn2:C.red2} border={win.direction==='long'?C.grn3:C.red3} size={8} />
      <span style={{ fontSize:10, color:win.pct_change >= 0 ? C.grn : C.red, ...M, marginLeft:'auto' }}>
        {win.pct_change >= 0 ? '▲' : '▼'} {Math.abs(win.pct_change).toFixed(2)}%
      </span>
      <div style={{ display:'flex', flexDirection:'column', gap:2, minWidth:80 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, ...M }}>
          <span style={{ color:C.tx3 }}>window</span>
          <span style={{ color:pct > 30 ? C.amb : C.red, fontWeight:700 }}>{secs}s</span>
        </div>
        <div style={{ height:2, background:C.brd, borderRadius:1 }}>
          <div style={{ width:`${pct}%`, height:'100%', background:pct > 30 ? C.amb : C.red, borderRadius:1, transition:'width 1s linear' }} />
        </div>
      </div>
      <span style={{ fontSize:8, color:C.tx3, ...M }}>{win.checks} chk</span>
    </div>
  )
})

// ── Gate banner — shown when scanner is paused ────────────────────────────────
const GateBanner = memo(({ gateState, scannerPaused }) => {
  if (!gateState && !scannerPaused) return null
  const msgs = {
    max_trades: 'Max trades reached — scanner paused until a position closes',
    sl_guard:   'SL guard hit — scanner paused for this session',
    risk_pct:   'Risk % limit — scanner active, new entries gated',
  }
  const isPaused = scannerPaused
  return (
    <div style={{ margin:'0 14px 12px', padding:'10px 12px', borderRadius:8, background:isPaused ? C.red2 : C.amb2, border:`1px solid ${isPaused ? C.red3 : C.amb3}`, fontSize:10, color:isPaused ? C.red : C.amb, ...M, lineHeight:1.5 }}>
      {isPaused ? '⏸ ' : '⚠ '}{msgs[gateState] ?? 'Gate active'}
    </div>
  )
})

// ── Log lines — virtualized to avoid slow DOM ─────────────────────────────────
const LogLine = memo(({ line }) => {
  const lvc = { signal:C.grn, warn:C.amb, info:C.tx3, error:C.red }
  return (
    <div style={{ display:'flex', gap:8, padding:'4px 0', borderBottom:`1px solid ${C.brd}08` }}>
      <span style={{ color:C.tx3, fontSize:9, minWidth:44, flexShrink:0, ...M }}>{line.ts}</span>
      <span style={{ fontSize:8, fontWeight:700, letterSpacing:.8, minWidth:38, color:lvc[line.lv] ?? C.tx3, flexShrink:0, ...M }}>{line.lv?.toUpperCase()}</span>
      <span style={{ fontSize:10, color:line.lv === 'signal' ? C.tx : C.tx2, lineHeight:1.5, ...M }}>{line.msg}</span>
    </div>
  )
})

// ── Dashboard ─────────────────────────────────────────────────────────────────
const INIT_LOGS = [
  { ts:'14:41', lv:'signal', msg:'INJUSDT: max_rr≥1R → SL ratcheted to Breakeven @ $28.42' },
  { ts:'14:40', lv:'info',   msg:'INJUSDT: live_rr=1.40 — ladder: [1R✓, 2R○, 4R○]' },
  { ts:'14:38', lv:'signal', msg:'INJUSDT LONG @ 28.42 | HL-SL 27.64 | exp_rr_seq [1,2,4]→[BE,1R,2R]' },
  { ts:'14:37', lv:'signal', msg:'SOLUSDT SHORT @ 152.80 | SL 154.40 | Fixed TP 2.0R' },
  { ts:'14:35', lv:'info',   msg:'Scanner: 6 opps ≥2.0% — ticker-only, 0 REST' },
  { ts:'14:22', lv:'signal', msg:'SOLUSDT closed [sl_ratchet 2.1R] | PnL +$34.20' },
  { ts:'13:05', lv:'warn',   msg:'APTUSDT closed [SL] @ 8.87 | PnL -$10.00' },
]

const Dashboard = memo(({ trades, sessionActive, onToggle, paperBalance, totalPnl, maxRR, gateState, scannerPaused, activeWindows }) => {
  const showWindows = activeWindows?.length > 0
  return (
    <div style={{ flex:1, overflowY:'auto', padding:14 }}>
      {/* Session bar */}
      <Card style={{ padding:'12px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:10, border:sessionActive ? C.grn3 : C.brd }}>
        <Pill label={sessionActive ? 'LIVE' : 'STOPPED'} color={sessionActive ? C.grn : C.tx3} bg={sessionActive ? C.grn2 : C.surf2} border={sessionActive ? C.grn3 : C.brd} dot={sessionActive} />
        <Pill label="PAPER" color={C.amb} bg={C.amb2} border={C.amb3} />
        <Pill label="EXP-RR" color={C.pur} bg={C.pur2} border={C.pur3} />
        <Tap onPress={onToggle} style={{ marginLeft:'auto', padding:'8px 16px', borderRadius:7, border:`1px solid ${sessionActive ? C.red3 : C.grn3}`, background:sessionActive ? C.red2 : C.grn2, color:sessionActive ? C.red : C.grn, fontSize:11, fontWeight:700, ...M }}>
          {sessionActive ? '■ Stop' : '▶ Start'}
        </Tap>
      </Card>

      {/* Gate banner */}
      <GateBanner gateState={gateState} scannerPaused={scannerPaused} />

      {/* Stats — values update in-place */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
        {[
          ['PAPER BAL',  `$${paperBalance.toFixed(2)}`,     C.amb, C.brd],
          ['SESSION P&L', fmtU(totalPnl),                   pnlC(totalPnl), C.brd],
          ['PEAK MAX_RR', `+${maxRR.toFixed(2)}`,           C.pur, C.pur3],
          ['SL GUARD',   '$48 / $200',                      C.tx,  C.brd],
        ].map(([k, v, col, bd]) => (
          <Card key={k} border={bd} style={{ padding:'12px 14px' }}>
            <div style={{ fontSize:8, color:C.tx3, letterSpacing:1, marginBottom:4, ...M }}>{k}</div>
            <div style={{ fontSize:18, fontWeight:700, color:col, ...M, transition:'color .3s' }}>{v}</div>
          </Card>
        ))}
      </div>

      {/* Active windows (active_window scan mode) */}
      {showWindows && (
        <>
          <SL>ACTIVE WINDOWS ({activeWindows.length})</SL>
          <Card style={{ marginBottom:14, overflow:'hidden' }}>
            {activeWindows.map(w => <WindowRow key={w.symbol} win={w} />)}
          </Card>
        </>
      )}

      {/* Positions */}
      <SL>ACTIVE POSITIONS ({trades.length})</SL>
      {trades.length === 0
        ? <Card style={{ padding:28, textAlign:'center', marginBottom:14 }}>
            <span style={{ color:C.tx3, ...M, fontSize:13 }}>{sessionActive ? 'Scanning for entries…' : 'Start a session to begin'}</span>
          </Card>
        : trades.map(t => <TradeCard key={t.id} trade={t} />)
      }

      {/* Log */}
      <SL>DECISION LOG</SL>
      <Card style={{ padding:12, maxHeight:210, overflowY:'auto' }}>
        {INIT_LOGS.map((l, i) => <LogLine key={i} line={l} />)}
      </Card>
      <div style={{ height:80 }} />
    </div>
  )
})

// ── Scanner ───────────────────────────────────────────────────────────────────
const OPPS = [
  { symbol:'INJUSDT',  pct:2.84,  dir:'long',  vol:2140000, score:9.2 },
  { symbol:'SUIUSDT',  pct:2.41,  dir:'long',  vol:1870000, score:8.1 },
  { symbol:'SEIUSDT',  pct:-2.18, dir:'short', vol:960000,  score:6.4 },
  { symbol:'TIAUSDT',  pct:1.94,  dir:'long',  vol:1200000, score:5.9 },
  { symbol:'BONKUSDT', pct:1.44,  dir:'long',  vol:3100000, score:4.1 },
  { symbol:'APTUSDT',  pct:1.12,  dir:'long',  vol:880000,  score:2.8 },
  { symbol:'LDOUSDT',  pct:-.88,  dir:'short', vol:620000,  score:1.6 },
]

const OppCard = memo(({ opp, rank, threshold }) => {
  const pass = Math.abs(opp.pct) >= threshold
  const isL  = opp.dir === 'long'
  return (
    <Card style={{ padding:'12px 14px', marginBottom:8, opacity:pass ? 1 : .4 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:9, color:C.tx3, ...M }}>#{rank}</span>
          <span style={{ fontSize:14, fontWeight:700, ...M }}>{opp.symbol.replace('USDT','')}<span style={{ fontSize:10, color:C.tx3 }}>/USDT</span></span>
        </div>
        <span style={{ fontSize:15, fontWeight:700, color:isL ? C.grn : C.red, ...M }}>{isL ? '▲' : '▼'} {Math.abs(opp.pct).toFixed(2)}%</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ flex:1, height:3, background:C.brd, borderRadius:2 }}>
          <div style={{ width:`${Math.min((opp.score/12)*100,100)}%`, height:'100%', background:C.acc, borderRadius:2 }} />
        </div>
        <span style={{ fontSize:10, color:C.tx3, ...M }}>score {opp.score.toFixed(1)}</span>
        <span style={{ fontSize:10, color:C.tx2, ...M }}>{fmtV(opp.vol)}</span>
        {pass && <Pill label="PASS" color={C.grn} bg={C.grn2} border={C.grn3} size={8} />}
      </div>
    </Card>
  )
})

const Scanner = memo(() => (
  <div style={{ flex:1, overflowY:'auto', padding:14 }}>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
      <div>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:3 }}>Live Scanner</div>
        <div style={{ fontSize:10, color:C.tx3, ...M }}>5m · 3× lookback · ≥2.0%</div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:10, color:C.grn, ...M }}>
        <Dot /> LIVE
      </div>
    </div>
    {OPPS.map((o, i) => <OppCard key={o.symbol} opp={o} rank={i+1} threshold={2.0} />)}
    <div style={{ fontSize:9, color:C.tx3, textAlign:'center', marginTop:8, ...M }}>!miniTicker@arr + kline_5m WS · No REST polling</div>
    <div style={{ height:80 }} />
  </div>
))

// ── History ───────────────────────────────────────────────────────────────────
const HIST = [
  { symbol:'SOLUSDT',  side:'long',  entry:148.2, exit:151.9, pnl:34.2,  rr:2.1,  reason:'sl_ratchet', exit_sl_rr:2.1 },
  { symbol:'APTUSDT',  side:'long',  entry:9.14,  exit:8.87,  pnl:-10,   rr:-1,   reason:'sl',         exit_sl_rr:null },
  { symbol:'INJUSDT',  side:'short', entry:29.8,  exit:28.9,  pnl:45.3,  rr:2.4,  reason:'sl_ratchet', exit_sl_rr:1.8 },
  { symbol:'AVAXUSDT', side:'long',  entry:34.1,  exit:35.2,  pnl:22.8,  rr:1.9,  reason:'sl_ratchet', exit_sl_rr:.9 },
  { symbol:'SUIUSDT',  side:'long',  entry:1.31,  exit:1.30,  pnl:-10,   rr:-1,   reason:'sl',         exit_sl_rr:null },
  { symbol:'TIAUSDT',  side:'short', entry:6.44,  exit:6.11,  pnl:38.1,  rr:2.2,  reason:'sl_ratchet', exit_sl_rr:2.0 },
  { symbol:'SEIUSDT',  side:'long',  entry:.401,  exit:.419,  pnl:21.6,  rr:1.8,  reason:'sl_ratchet', exit_sl_rr:1.2 },
  { symbol:'ARBUSDT',  side:'short', entry:.912,  exit:.928,  pnl:-10,   rr:-1,   reason:'sl',         exit_sl_rr:null },
]

const HistCard = memo(({ t }) => {
  const isR = t.reason === 'sl_ratchet'
  return (
    <Card style={{ padding:'12px 14px', marginBottom:8, border:isR ? C.pur3 : C.brd }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:14, fontWeight:700, ...M }}>{t.symbol}</span>
          <Pill label={t.side.toUpperCase()} color={t.side==='long'?C.grn:C.red} bg={t.side==='long'?C.grn2:C.red2} border={t.side==='long'?C.grn3:C.red3} size={9} />
        </div>
        <span style={{ fontSize:15, fontWeight:700, color:pnlC(t.pnl), ...M }}>{fmtU(t.pnl)}</span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <Pill label={isR ? 'SL-RATCHET' : t.reason.toUpperCase()} color={isR?C.pur:pnlC(t.pnl)} bg={isR?C.pur2:t.pnl>=0?C.grn2:C.red2} border={isR?C.pur3:t.pnl>=0?C.grn3:C.red3} size={8} />
          {isR && <span style={{ fontSize:9, color:C.pur, ...M }}>+{t.exit_sl_rr}R locked</span>}
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:9, color:C.tx3, ...M }}>${t.entry} → ${t.exit}</div>
          <div style={{ fontSize:9, color:pnlC(t.rr), ...M }}>R:R {t.rr >= 0 ? '+' : ''}{t.rr.toFixed(1)}</div>
        </div>
      </div>
    </Card>
  )
})

const History = memo(() => {
  const totalPnl  = useMemo(() => HIST.reduce((s, t) => s + t.pnl, 0), [])
  const wins      = useMemo(() => HIST.filter(t => t.pnl > 0).length, [])
  const ratchets  = useMemo(() => HIST.filter(h => h.reason === 'sl_ratchet').length, [])
  return (
    <div style={{ flex:1, overflowY:'auto', padding:14 }}>
      <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>Trade History</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
        {[
          ['TOTAL P&L', fmtU(totalPnl),                              pnlC(totalPnl), C.brd],
          ['WIN RATE',  `${((wins/HIST.length)*100).toFixed(0)}%`,   wins/HIST.length >= .5 ? C.grn : C.red, C.brd],
          ['RATCHETS',  `${ratchets}/${HIST.length}`,                C.pur, C.pur3],
        ].map(([k, v, col, bd]) => (
          <Card key={k} border={bd} style={{ padding:'12px 12px' }}>
            <div style={{ fontSize:8, color:C.tx3, letterSpacing:.8, marginBottom:4, ...M }}>{k}</div>
            <div style={{ fontSize:17, fontWeight:700, color:col, ...M }}>{v}</div>
          </Card>
        ))}
      </div>
      {HIST.map((t, i) => <HistCard key={i} t={t} />)}
      <div style={{ height:80 }} />
    </div>
  )
})

// ── Config ────────────────────────────────────────────────────────────────────
const Inp = memo(({ label, defaultValue, type='number', opts, min, max, step }) => {
  const s = { background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.tx, padding:'9px 10px', fontSize:13, ...M, outline:'none', width:'100%' }
  return (
    <div>
      <div style={{ fontSize:9, color:C.tx3, marginBottom:5, letterSpacing:.8, ...M }}>{label}</div>
      {opts
        ? <select defaultValue={defaultValue} style={s}>{opts.map(o => <option key={o}>{o}</option>)}</select>
        : <input type={type} defaultValue={defaultValue} min={min} max={max} step={step} style={s} />}
    </div>
  )
})

const SIG_DEFS  = [{k:'momentum_pct',l:'% Momentum'},{k:'breakout_hl',l:'N-Bar Breakout'},{k:'ema_cross',l:'EMA Cross'},{k:'rsi_level',l:'RSI Level'},{k:'bollinger',l:'Bollinger'},{k:'vol_spike',l:'Vol Spike'}]
const EXIT_DEFS = [{k:'ema_reverse',l:'EMA Reverse'},{k:'rsi_reverse',l:'RSI Reverse'}]

const Config = memo(() => {
  const [tpMode,  setTpMode]  = useState('exp_rr_seq')
  const [slMode,  setSlMode]  = useState('lookback_hl')
  const [scanMode,setScanMode]= useState('active_window')
  const [seq,     setSeq]     = useState([[1,0],[2,1],[4,2]])
  const [sigs,    setSigs]    = useState({momentum_pct:true,breakout_hl:true,ema_cross:false,rsi_level:false,bollinger:false,vol_spike:false})
  const [sigMode, setSigMode] = useState('any')
  const [exitEn,  setExitEn]  = useState(false)
  const [exitSigs,setExitSigs]= useState({ema_reverse:true,rsi_reverse:false})
  const [liveMode,setLiveMode]= useState(false)
  const [showKeys,setShowKeys]= useState(false)
  const [saved,   setSaved]   = useState(false)
  const [sec,     setSec]     = useState('tp')

  const addSeq    = useCallback(() => setSeq(s => [...s, [s.length ? s[s.length-1][0]+2 : 1, s.length ? s[s.length-1][1]+1 : 0]]), [])
  const removeSeq = useCallback(i => setSeq(s => s.filter((_,j) => j !== i)), [])
  const updateSeq = useCallback((i, col, v) => setSeq(s => s.map((r,j) => j===i ? [col===0?+v:r[0], col===1?+v:r[1]] : r)), [])
  const doSave    = useCallback(() => { setSaved(true); setTimeout(() => setSaved(false), 1500) }, [])

  const inp = { background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, color:C.tx, padding:'9px 10px', fontSize:13, ...M, outline:'none', width:'100%' }
  const SECTIONS = [{id:'keys',l:'🔑 Keys'},{id:'mode',l:'⚡ Mode'},{id:'scan',l:'🔍 Scan'},{id:'sigs',l:'📶 Signals'},{id:'tp',l:'🎯 TP'},{id:'sl',l:'🛑 SL'},{id:'risk',l:'⚖️ Risk'}]

  return (
    <div style={{ flex:1, overflowY:'auto', padding:14 }}>
      <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>Config</div>

      {/* Section nav */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:16 }}>
        {SECTIONS.map(s => (
          <Tap key={s.id} onPress={() => setSec(s.id)} style={{ padding:'5px 10px', borderRadius:6, border:`1px solid ${sec===s.id ? C.acc3 : C.brd}`, background:sec===s.id ? C.acc2 : 'none', color:sec===s.id ? C.acc : C.tx3, fontSize:10, fontWeight:700, ...M }}>
            {s.l}
          </Tap>
        ))}
      </div>

      {/* Keys */}
      {sec === 'keys' && (
        <Card style={{ padding:14, marginBottom:14 }}>
          <SL>API KEYS (IN-MEMORY ONLY)</SL>
          <div style={{ padding:'10px 12px', borderRadius:6, background:C.amb2, border:`1px solid ${C.amb3}`, fontSize:10, color:C.amb, ...M, marginBottom:12, lineHeight:1.6 }}>
            ⚠ Memory only. Never on disk. Never logged. Futures-only permissions. Disable withdrawals.
          </div>
          {['API KEY','SECRET KEY'].map(k => (
            <div key={k} style={{ marginBottom:10 }}>
              <div style={{ fontSize:9, color:C.tx3, marginBottom:5, ...M }}>{k}</div>
              <input type={showKeys?'text':'password'} placeholder={`Paste ${k.toLowerCase()}…`} style={inp} />
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <Toggle value={showKeys} onChange={setShowKeys} label="Show keys" />
            <Tap onPress={() => {}} style={{ padding:'8px 18px', borderRadius:7, background:C.acc, color:'#fff', fontSize:12, fontWeight:700, ...M }}>Save Keys</Tap>
          </div>
        </Card>
      )}

      {/* Mode */}
      {sec === 'mode' && (
        <Card style={{ padding:14, marginBottom:14, border:liveMode ? C.grn3 : C.amb3 }}>
          <div style={{ marginBottom:14 }}>
            <Toggle value={liveMode} onChange={setLiveMode} label={liveMode ? 'Live Trading' : 'Paper Mode'} color={liveMode ? C.grn : C.amb} />
            <div style={{ fontSize:10, color:C.tx3, marginTop:6, ...M }}>
              {liveMode ? 'Real orders on Binance Futures — requires API keys' : 'Simulated fills — no real funds at risk'}
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <Inp label="PAPER BALANCE (USDT)" defaultValue={10000} min={100} step={1000} />
            <Inp label="LEVERAGE" defaultValue={10} min={1} max={50} />
          </div>
        </Card>
      )}

      {/* Scanner */}
      {sec === 'scan' && (
        <Card style={{ padding:14, marginBottom:14 }}>
          <SL>SCAN MODE</SL>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
            <ModeChip label="Interval" active={scanMode==='interval'} onPress={() => setScanMode('interval')} />
            <ModeChip label="Active Window" active={scanMode==='active_window'} onPress={() => setScanMode('active_window')} color={C.pur} />
          </div>

          {scanMode === 'active_window' && (
            <div style={{ padding:'10px 12px', borderRadius:8, background:C.pur2, border:`1px solid ${C.pur3}`, marginBottom:14, fontSize:10, color:C.tx2, ...M, lineHeight:1.7 }}>
              Interval scan opens a timed window per qualifying symbol. Window checks ticker price every N seconds for the full window duration — entry can fire any time during the window. Window expires silently and waits for the next interval trigger.
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <Inp label="INTERVAL" defaultValue="5m" opts={['1m','5m','15m','1h']} />
            <Inp label="LOOKBACK CANDLES" defaultValue={3} min={1} max={20} />
            <Inp label="% THRESHOLD" defaultValue={2.0} step={0.1} />
            <Inp label="MIN VOLUME (USDT)" defaultValue={500000} step={100000} />
            {scanMode === 'active_window' && <>
              <Inp label="WINDOW DURATION (s)" defaultValue={90} min={10} max={600} />
              <Inp label="CHECK INTERVAL (s)" defaultValue={5} min={2} max={60} />
            </>}
            <Inp label="WATCHLIST SIZE" defaultValue={50} min={10} max={100} />
            <Inp label="ENTRY SIDE" defaultValue="both" opts={['both','long','short']} />
          </div>
        </Card>
      )}

      {/* Signals */}
      {sec === 'sigs' && (
        <>
          <SL>ENTRY SIGNALS</SL>
          <Card style={{ padding:14, marginBottom:14 }}>
            <div style={{ display:'flex', gap:8, marginBottom:14 }}>
              <ModeChip label="ANY (OR)" active={sigMode==='any'} onPress={() => setSigMode('any')} />
              <ModeChip label="ALL (AND)" active={sigMode==='all'} onPress={() => setSigMode('all')} color={C.amb} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:sigs.ema_cross || sigs.rsi_level ? 14 : 0 }}>
              {SIG_DEFS.map(s => (
                <Tap key={s.k} onPress={() => setSigs(p => ({...p, [s.k]:!p[s.k]}))} style={{ padding:'8px 12px', borderRadius:7, border:`1px solid ${sigs[s.k] ? C.acc3 : C.brd}`, background:sigs[s.k] ? C.acc2 : 'none', color:sigs[s.k] ? C.acc : C.tx3, fontSize:11, fontWeight:700, ...M, textAlign:'center' }}>
                  {sigs[s.k] ? '✓ ' : ''}{s.l}
                </Tap>
              ))}
            </div>
            {sigs.ema_cross && <div style={{ paddingTop:14, borderTop:`1px solid ${C.brd}` }}><div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}><Inp label="EMA FAST" defaultValue={9} min={2} /><Inp label="EMA SLOW" defaultValue={21} min={5} /></div></div>}
            {sigs.rsi_level && <div style={{ paddingTop:14, borderTop:`1px solid ${C.brd}`, marginTop:sigs.ema_cross ? 10 : 0 }}><div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}><Inp label="RSI PERIOD" defaultValue={14} /><Inp label="OVERSOLD" defaultValue={35} /><Inp label="OVERBOUGHT" defaultValue={65} /></div></div>}
          </Card>
          <SL>EXIT SIGNALS</SL>
          <Card style={{ padding:14, marginBottom:14 }}>
            <Toggle value={exitEn} onChange={setExitEn} label="Counter-direction exit signals" />
            {exitEn && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:14, paddingTop:14, borderTop:`1px solid ${C.brd}` }}>
                {EXIT_DEFS.map(s => (
                  <Tap key={s.k} onPress={() => setExitSigs(p => ({...p, [s.k]:!p[s.k]}))} style={{ padding:'8px 12px', borderRadius:7, border:`1px solid ${exitSigs[s.k] ? C.acc3 : C.brd}`, background:exitSigs[s.k] ? C.acc2 : 'none', color:exitSigs[s.k] ? C.acc : C.tx3, fontSize:11, fontWeight:700, ...M, textAlign:'center' }}>
                    {exitSigs[s.k] ? '✓ ' : ''}{s.l}
                  </Tap>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* TP */}
      {sec === 'tp' && (
        <Card style={{ padding:14, marginBottom:14, border:tpMode==='exp_rr_seq' ? C.pur3 : C.brd }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:14 }}>
            <ModeChip label="Fixed R:R"  active={tpMode==='fixed'}       onPress={() => setTpMode('fixed')} />
            <ModeChip label="Series"     active={tpMode==='series'}      onPress={() => setTpMode('series')} />
            <ModeChip label="⟳ Exp RR"  active={tpMode==='exp_rr_seq'}  onPress={() => setTpMode('exp_rr_seq')} color={C.pur} />
          </div>
          {tpMode === 'fixed'  && <Inp label="TP RATIO (R:R)" defaultValue={2.0} step={.1} />}
          {tpMode === 'series' && <div style={{ color:C.tx3, fontSize:10, ...M, padding:12, background:C.bg, borderRadius:7 }}>Series: each step partially closes at trigger R:R and moves TP target.</div>}
          {tpMode === 'exp_rr_seq' && (
            <div>
              <div style={{ background:C.pur2, border:`1px solid ${C.pur3}`, borderRadius:8, padding:12, marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, color:C.pur, marginBottom:6, ...M }}>⟳ Exponential RR Sequence</div>
                <div style={{ fontSize:10, color:C.tx2, lineHeight:1.7, ...M }}>
                  Tracks <b style={{color:C.pur}}>max_rr</b> — peak R:R, only ever increases. When max_rr crosses a trigger, SL ratchets to exit level instantly via exchange update. <b style={{color:C.grn}}>Ticker-only — zero candle data.</b> No fixed TP — trade rides until ratcheted SL is hit.
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'20px 1fr 1fr 1fr 24px', gap:6, marginBottom:6, fontSize:8, color:C.tx3, letterSpacing:.8, ...M }}>
                <span /><span>TRIGGER (≥R)</span><span>SL TO (R)</span><span>RESULT</span><span />
              </div>
              {seq.map(([t, e], i) => (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'20px 1fr 1fr 1fr 24px', gap:6, marginBottom:8, alignItems:'center' }}>
                  <span style={{ fontSize:11, color:C.tx3, textAlign:'center', ...M }}>{i+1}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                    <input type="number" value={t} step=".5" min=".5" onChange={ev => updateSeq(i,0,ev.target.value)} style={inp} />
                    <span style={{ fontSize:9, color:C.tx3, ...M }}>R</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:3 }}>
                    <input type="number" value={e} step=".5" min="-1" onChange={ev => updateSeq(i,1,ev.target.value)} style={inp} />
                    <span style={{ fontSize:9, color:C.tx3, ...M }}>R</span>
                  </div>
                  <span style={{ fontSize:9, color:e >= 0 ? C.grn : C.red, ...M }}>{e === 0 ? 'BE' : `+${e}R`}</span>
                  <Tap onPress={() => removeSeq(i)} style={{ height:36, background:C.red2, border:`1px solid ${C.red3}`, borderRadius:6, color:C.red, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:14 }}>✕</Tap>
                </div>
              ))}
              <Tap onPress={addSeq} style={{ width:'100%', padding:10, background:'none', border:`1px dashed ${C.brd}`, borderRadius:7, color:C.tx3, ...M, fontSize:11, textAlign:'center', marginBottom:12 }}>+ Add Step</Tap>
              {seq.length > 0 && (
                <div style={{ background:C.bg, borderRadius:7, padding:10, fontSize:10, color:C.tx2, lineHeight:1.8, ...M }}>
                  {seq.map(([t,e],i) => <div key={i}>max_rr≥<span style={{color:C.pur}}>{t}R</span> → <span style={{color:e>=0?C.grn:C.red}}>{e===0?'BE':`+${e}R`}</span></div>)}
                  <div style={{ marginTop:6, color:C.tx3 }}>SL update sent to exchange instantly when threshold crossed.</div>
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginTop:12 }}>
                {[['Data','Ticker only',C.grn,C.grn3],['Latency','Zero (math)',C.grn,C.grn3],['TP Cap','None',C.pur,C.pur3]].map(([k,v,col,bd]) => (
                  <div key={k} style={{ background:C.bg, border:`1px solid ${bd}`, borderRadius:7, padding:'8px 10px' }}>
                    <div style={{ fontSize:8, color:C.tx3, marginBottom:2, ...M }}>{k}</div>
                    <div style={{ color:col, fontWeight:700, fontSize:11, ...M }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* SL */}
      {sec === 'sl' && (
        <Card style={{ padding:14, marginBottom:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
            <ModeChip label="Fixed %" active={slMode==='distance_pct'} onPress={() => setSlMode('distance_pct')} />
            <ModeChip label="Lookback H/L" active={slMode==='lookback_hl'} onPress={() => setSlMode('lookback_hl')} color={C.amb} />
          </div>
          {slMode === 'distance_pct' && <Inp label="SL DISTANCE %" defaultValue={0.8} step={0.1} />}
          {slMode === 'lookback_hl' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <Inp label="SL TIMEFRAME" defaultValue="15m" opts={['1m','5m','15m','1h','4h']} />
              <Inp label="LOOKBACK BARS" defaultValue={5} min={1} max={50} />
              <Inp label="MIN SL %" defaultValue={0.3} step={0.05} />
              <Inp label="MAX SL %" defaultValue={3.0} step={0.1} />
            </div>
          )}
          <div style={{ marginTop:12, background:C.bg, borderRadius:7, padding:10, fontSize:10, color:C.tx2, ...M, lineHeight:1.6 }}>
            {slMode === 'lookback_hl'
              ? 'SL placed at the actual candle low (long) or high (short) on the selected TF. SL distance = abs(entry – structural level). Clamped to [min%, max%] only if outside bounds — within range it sits exactly at the structural level.'
              : 'SL = entry ± (entry × distance%). Position size derived from this distance.'}
          </div>
        </Card>
      )}

      {/* Risk */}
      {sec === 'risk' && (
        <Card style={{ padding:14, marginBottom:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
            <Inp label="RISK % PER TRADE" defaultValue={1.0} step={0.1} />
            <Inp label="MAX OPEN TRADES"  defaultValue={5} min={1} />
            <Inp label="MAX TOTAL RISK %" defaultValue={5.0} step={0.5} />
            <Inp label="SL GUARD (USDT)"  defaultValue={200} step={10} />
          </div>
          <div style={{ background:C.bg, borderRadius:8, padding:12 }}>
            <div style={{ fontSize:8, color:C.tx3, letterSpacing:1, marginBottom:8, ...M }}>SIZING PREVIEW · $100 ENTRY · 0.8% SL</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {[['RISK AMT','$100',C.amb],['SL DIST','0.80%',C.red],['EST QTY','125.0',C.acc]].map(([k,v,col]) => (
                <div key={k}><div style={{ fontSize:8, color:C.tx3, marginBottom:2, ...M }}>{k}</div><div style={{ fontWeight:700, color:col, fontSize:13, ...M }}>{v}</div></div>
              ))}
            </div>
            <div style={{ marginTop:8, fontSize:10, color:C.tx3, ...M }}>qty = ($10k × 1%) ÷ ($100 × 0.8%) = <span style={{color:C.acc}}>125 units</span></div>
          </div>
          <div style={{ marginTop:12, padding:'10px 12px', background:C.surf2, borderRadius:7, fontSize:10, color:C.tx3, ...M, lineHeight:1.6 }}>
            One position per symbol enforced always. Scanner pauses automatically when max_trades or sl_guard is hit — resumes when a position closes.
          </div>
        </Card>
      )}

      <Tap onPress={doSave} style={{ width:'100%', padding:14, borderRadius:10, background:saved ? C.grn : C.acc, color:'#fff', fontSize:13, fontWeight:700, ...M, textAlign:'center', marginBottom:4, transition:'background .3s' }}>
        {saved ? '✓ Saved!' : 'Save Config'}
      </Tap>
      <div style={{ height:80 }} />
    </div>
  )
})

// ── Bottom nav ────────────────────────────────────────────────────────────────
const NAV = [{id:'dash',icon:'◈',l:'Dashboard'},{id:'scan',icon:'◉',l:'Scanner'},{id:'hist',icon:'⊟',l:'History'},{id:'cfg',icon:'⊞',l:'Config'}]

const BottomNav = memo(({ tab, setTab, tradeCount, oppCount }) => (
  <div style={{ height:60, background:C.surf, borderTop:`1px solid ${C.brd}`, display:'flex', flexShrink:0, zIndex:100 }}>
    {NAV.map(n => {
      const active = tab === n.id
      const badge  = (n.id === 'dash' && tradeCount > 0) ? tradeCount : (n.id === 'scan' && oppCount > 0) ? oppCount : null
      return (
        <Tap key={n.id} onPress={() => setTab(n.id)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:2, position:'relative', color:active ? C.acc : C.tx3 }}>
          {active && <div style={{ position:'absolute', top:0, left:'25%', right:'25%', height:2, background:C.acc, borderRadius:'0 0 2px 2px' }} />}
          <span style={{ fontSize:17, lineHeight:1 }}>{n.icon}</span>
          <span style={{ fontSize:9, fontWeight:active ? 700 : 400, letterSpacing:.5, ...M }}>{n.l}</span>
          {badge && <div style={{ position:'absolute', top:8, right:'20%', width:15, height:15, borderRadius:'50%', background:C.acc, color:'#fff', fontSize:8, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', ...M }}>{badge}</div>}
        </Tap>
      )
    })}
  </div>
))

// ── App — simulation only touches numeric state, not structural ───────────────
const INIT_TRADES = [
  { id:'t1', symbol:'INJUSDT', side:'long',  entry:28.42, current:28.42, sl:27.64, initial_sl:27.64, tp:null,  qty:87.4, notional:2485, risk:50, sl_mode:'lookback_hl', sl_dist_abs:.78,  tp_mode:'exp_rr_seq', live_rr_sequence:[1,2,4], exit_rr_sequence:[0,1,2], max_rr:0, live_rr:0, live_pnl:0, paper_mode:true, tp_ratio:null },
  { id:'t2', symbol:'SOLUSDT', side:'short', entry:152.8, current:152.8, sl:154.4, initial_sl:154.4, tp:147.2, qty:5.2,  notional:787,  risk:40, sl_mode:'distance_pct',sl_dist_abs:1.6,  tp_mode:'fixed',      live_rr_sequence:[],    exit_rr_sequence:[],    max_rr:0, live_rr:0, live_pnl:0, paper_mode:true, tp_ratio:2.0 },
]

export default function App() {
  const [tab,           setTab]           = useState('dash')
  const [sessionActive, setSessionActive] = useState(true)
  const [rlWeight,      setRlWeight]      = useState(142)
  const [trades,        setTrades]        = useState(INIT_TRADES)
  const tickRef = useRef(0)

  // Simulation — only updates trade numbers, no structural DOM changes
  useEffect(() => {
    const timer = setInterval(() => {
      tickRef.current++
      const k = tickRef.current
      setTrades(prev => prev.map(tr => {
        if (tr.id === 't1') {
          const wave  = Math.sin(k / 8) * .6 + Math.sin(k / 3) * .15
          const cur   = +(28.42 + .96 + wave).toFixed(4)
          const lr    = +((cur - 28.42) / .78).toFixed(3)
          const mr    = +Math.max(tr.max_rr, lr).toFixed(3)
          return { ...tr, current:cur, live_rr:lr, max_rr:mr, live_pnl:+((cur - 28.42) * 87.4).toFixed(2) }
        }
        if (tr.id === 't2') {
          const cur = +(152.8 - 1.4 + Math.sin(k / 6) * .35).toFixed(4)
          const lr  = +((152.8 - cur) / 1.6).toFixed(3)
          const mr  = +Math.max(tr.max_rr, lr).toFixed(3)
          return { ...tr, current:cur, live_rr:lr, max_rr:mr, live_pnl:+((152.8 - cur) * 5.2).toFixed(2) }
        }
        return tr
      }))
      setRlWeight(w => w < 2400 ? w + Math.floor(Math.random() * 5) : 142)
    }, 1600)
    return () => clearInterval(timer)
  }, [])

  // Derived values — computed once per render, not on every child
  const totalPnl   = useMemo(() => trades.reduce((s, t) => s + t.live_pnl, 0), [trades])
  const maxRR      = useMemo(() => trades.length ? Math.max(...trades.map(t => t.max_rr)) : 0, [trades])
  const paperBal   = useMemo(() => 10408.6 + totalPnl, [totalPnl])

  // Simulated gate/window state
  const gateState      = null
  const scannerPaused  = false
  const activeWindows  = useMemo(() => [
    { symbol:'SUIUSDT', direction:'long',  pct_change:2.41, remaining_ms:62000, checks:12, entries:0 },
    { symbol:'SEIUSDT', direction:'short', pct_change:-2.18, remaining_ms:31000, checks:23, entries:1 },
  ], [])

  const passCount = useMemo(() => OPPS.filter(o => Math.abs(o.pct) >= 2.0).length, [])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:C.bg, color:C.tx, ...M, fontSize:12, maxWidth:480, margin:'0 auto', position:'relative', overflow:'hidden' }}>
      <style>{`
        @keyframes ping { 75%,100% { transform:scale(2.2); opacity:0 } }
        * { box-sizing:border-box; -webkit-tap-highlight-color:transparent }
        ::-webkit-scrollbar { width:3px }
        ::-webkit-scrollbar-thumb { background:${C.brd2}; border-radius:2px }
        select option { background:${C.bg} }
        input[type=number]::-webkit-inner-spin-button { opacity:.5 }
      `}</style>

      {/* Topbar — numbers update via memo-safe props */}
      <div style={{ padding:'10px 14px 8px', background:C.surf, borderBottom:`1px solid ${C.brd}`, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:C.acc, flexShrink:0 }} />
          <span style={{ fontSize:13, fontWeight:700, letterSpacing:.5 }}>MOMENTUM ENGINE</span>
          <Pill label="PAPER" color={C.amb} bg={C.amb2} border={C.amb3} />
          <Pill label="EXP-RR" color={C.pur} bg={C.pur2} border={C.pur3} />
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:5, color:C.grn }}>
            <Dot color={C.grn} size={7} />
            <span style={{ fontSize:9 }}>WS</span>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:0 }}>
          {[
            ['PAPER',   `$${paperBal.toFixed(2)}`,      C.amb],
            ['LIVE',    '—',                             C.tx3],
            ['P&L',     fmtU(96.6 + totalPnl),          pnlC(totalPnl)],
            ['MAX_RR',  `+${maxRR.toFixed(2)}`,         C.pur],
          ].map(([k, v, col], i) => (
            <div key={k} style={{ padding:'0 12px', borderRight:i < 3 ? `1px solid ${C.brd}` : 'none', paddingLeft:i === 0 ? 0 : 12 }}>
              <div style={{ fontSize:8, color:C.tx3, letterSpacing:1, marginBottom:1 }}>{k}</div>
              <div style={{ fontSize:13, fontWeight:700, color:col, transition:'color .3s' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <RLStrip weight={rlWeight} />

      <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
        {tab === 'dash' && (
          <Dashboard
            trades={trades}
            sessionActive={sessionActive}
            onToggle={useCallback(() => setSessionActive(p => !p), [])}
            paperBalance={paperBal}
            totalPnl={96.6 + totalPnl}
            maxRR={maxRR}
            gateState={gateState}
            scannerPaused={scannerPaused}
            activeWindows={activeWindows}
          />
        )}
        {tab === 'scan' && <Scanner />}
        {tab === 'hist' && <History />}
        {tab === 'cfg'  && <Config />}
      </div>

      <BottomNav tab={tab} setTab={setTab} tradeCount={trades.length} oppCount={passCount} />
    </div>
  )
}
