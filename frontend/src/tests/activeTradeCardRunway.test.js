import test from 'node:test'
import assert from 'node:assert/strict'

function computeRunwayPositions(trade) {
  const entry = Number(trade.entry_price || 0)
  const mark = Number(trade.mark_price || trade.last_price || 0)
  const sl = Number(trade.sl_price || 0)
  const tp = Number(trade.tp_price || 0)
  const isLong = trade.direction === 'LONG'

  const initialSl = Number(trade.initial_sl || sl || 0)
  const rawRiskUnit = Math.abs(entry - initialSl)
  const riskUnit = rawRiskUnit > 0 ? rawRiskUnit : (entry > 0 ? entry * 0.01 : 1)

  const getR = (price) => {
    if (!price || !isFinite(price) || !entry) return 0
    return isLong ? (price - entry) / riskUnit : (entry - price) / riskUnit
  }

  const maxRr = Number(trade.max_rr ?? trade.max_rr_achieved ?? trade.rr ?? 0)
  const peakR = Math.max(0, maxRr)
  const slR = getR(sl)
  const markR = getR(mark)
  const estR = getR(trade.est_price || sl)
  const tpR = tp > 0 ? getR(tp) : 0

  const minActiveR = Math.min(-1, slR, markR, estR)
  const maxActiveR = Math.max(0, markR, peakR, tpR)
  const activeSpanR = maxActiveR - minActiveR

  const viewSpanR = Math.max(1.2, activeSpanR)
  const paddingR = Math.max(0.1, viewSpanR * 0.08)

  const leftEdgeR = minActiveR - paddingR
  const rightEdgeR = maxActiveR + paddingR
  const totalRangeR = rightEdgeR - leftEdgeR
  const targetR = tp > 0 ? tpR : maxActiveR

  const pos = (price) => {
    if (!totalRangeR || totalRangeR <= 0) return 50
    const r = getR(price)
    const frac = (r - leftEdgeR) / totalRangeR
    return Math.max(0, Math.min(100, frac * 100))
  }

  const progress = pos(mark)
  const entryMarkPos = pos(entry)
  const slPos = pos(sl)
  const tpPos = tp > 0 ? pos(tp) : null
  const peakPrice = isLong ? (entry + peakR * riskUnit) : (entry - peakR * riskUnit)
  const peakPos = pos(peakPrice)
  const rightLabelPrice = tp > 0 ? tp : (isLong ? entry + targetR * riskUnit : entry - targetR * riskUnit)

  return {
    riskUnit,
    targetR,
    activeSpanR,
    viewSpanR,
    rightEdgeR,
    leftEdgeR,
    progress,
    entryMarkPos,
    slPos,
    tpPos,
    peakPos,
    rightLabelPrice,
    getR
  }
}

test('R-multiple Price Runway: LONG position initial state with explicit TP', () => {
  const trade = {
    direction: 'LONG',
    entry_price: 100,
    initial_sl: 95,
    sl_price: 95,
    tp_price: 115,
    mark_price: 100,
    max_rr: 0
  }

  const res = computeRunwayPositions(trade)
  assert.equal(res.riskUnit, 5)
  assert.equal(res.targetR, 3)
  assert.ok(res.entryMarkPos > res.slPos)
  assert.ok(res.tpPos > res.entryMarkPos)
  assert.equal(res.progress, res.entryMarkPos)
})

test('Proximity Auto-Zoom: Enforces minimum view span when markers are tightly clustered', () => {
  const trade = {
    direction: 'LONG',
    entry_price: 100,
    initial_sl: 95,
    sl_price: 100, // Breakeven
    tp_price: 0,
    mark_price: 100.2, // Small movement +0.04R
    max_rr: 0.04
  }

  const res = computeRunwayPositions(trade)
  assert.ok(res.activeSpanR <= 1.1)
  assert.ok(res.viewSpanR >= 1.2, 'Auto-zooms to minimum view span')
  // Distance between entry and mark is amplified on screen for visual clarity
  const distOnBar = res.progress - res.entryMarkPos
  assert.ok(distOnBar > 2.0, 'Provides clear visual separation between close markers')
})

test('R-multiple Price Runway: Trailing SL past entry does NOT invert entry and mark', () => {
  const trade = {
    direction: 'LONG',
    entry_price: 100,
    initial_sl: 95,
    sl_price: 105,
    tp_price: 115,
    mark_price: 107,
    max_rr: 2.0
  }

  const res = computeRunwayPositions(trade)
  assert.ok(res.entryMarkPos < res.slPos)
  assert.ok(res.slPos < res.progress)
  assert.ok(res.progress < res.tpPos)
})

test('R-multiple Price Runway: SHORT position trailing SL past entry', () => {
  const trade = {
    direction: 'SHORT',
    entry_price: 100,
    initial_sl: 105,
    sl_price: 95,
    tp_price: 85,
    mark_price: 93,
    max_rr: 2.0
  }

  const res = computeRunwayPositions(trade)
  assert.ok(res.entryMarkPos < res.slPos)
  assert.ok(res.slPos < res.progress)
  assert.ok(res.progress < res.tpPos)
})
